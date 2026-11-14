"""Single-site evaluation of a `Scenario`: signals, metrics, verdict, intervals, time series, provenance.

The ephemeris table is built once (`build_table`) and can be shared by any number of sites; a
`SiteEvaluation` holds the arrays behind its numbers so that `next_event`, attribution and the exports
need no recomputation.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace

import numpy as np

from lunarnav.ephem import BodyFixedEphemeris, et_to_utc, utc_to_et
from lunarnav.visibility import UncertainWindow, Window, bounded_windows, find_windows

from .edge_cause import ECLIPSE_CAUSE, MIXED_CAUSE, contact_edge, sunlight_edge_cause
from .engine import (
    HOUR_S,
    Analysis,
    EpochValues,
    Verdicts,
    build_analysis,
    epoch_values,
    judge,
    simulate_window,
)
from .heading import HeadingAnalysis, analyse_heading
from .horizons import HorizonProvider, SmoothSphereProvider, fold_observers, observer_sites
from .models import CONSTRAINT_KEYS, Scenario
from .provenance import build_provenance, check_terrain_stack
from .signals import (
    WORLDS,
    PowerSignals,
    SiteSignals,
    array_power,
    compute_signals,
    network_ground_stations,
    prepare_horizon,
)
from .verdicts import Verdict, apply_heading_to_verdict, build_verdict

EventKind = str
EVENT_KINDS: tuple[str, ...] = ("sunset", "sunrise", "earthset", "earthrise")
"""`sunset`/`sunrise`: end/start of array sunlight (terrain or Earth eclipse); `earthset`/`earthrise`:
loss/acquisition of contact (network contact, or the Earth centre above the antenna horizon plus margin
when the network is empty)."""


def build_table(
    et: np.ndarray, scenario_networks: list | tuple = (), *, grid_step_s: float = 3600.0,
    station_grid_step_s: float = 900.0,
) -> BodyFixedEphemeris:
    """Ephemeris table for epochs `et` containing the stations of every network in `scenario_networks`
    (de-duplicated by station id). Call once per analysis and pass the table to every site."""
    stations = {}
    for net in scenario_networks:
        for gs in network_ground_stations(net):
            stations.setdefault(gs.name, gs)
    return BodyFixedEphemeris.build(
        et, list(stations.values()), grid_step_s=grid_step_s, station_grid_step_s=station_grid_step_s)


def landing_grid(t_land_et: float, step_s: float, lookback_s: float, span_s: float) -> np.ndarray:
    """Regular epochs `t_land + k * step` covering `lookback` before and `span` after the landing."""
    k0 = -int(math.ceil(lookback_s / step_s))
    k1 = int(math.ceil(span_s / step_s))
    return t_land_et + np.arange(k0, k1 + 1, dtype=np.float64) * step_s


@dataclass(frozen=True, slots=True)
class IntervalRow:
    """One interval with edge-time uncertainty from the optimistic/pessimistic horizons (ET seconds).

    `start_range` / `end_range` are (earliest, latest) edge times over the three worlds; a range flagged
    `*_range_censored` has a bound that is only the edge of the data (not a time). A censored
    edge coincides with the analysed span and is not a transition. `nominal` is False when the
    interval exists only in the optimistic world; `certain` is False when the pessimistic world never
    opens it."""

    start_et: float
    end_et: float
    start_range: tuple[float, float]
    end_range: tuple[float, float]
    start_censored: bool
    end_censored: bool
    nominal: bool = True
    certain: bool = True
    start_range_censored: bool = False
    end_range_censored: bool = False
    """True when the earliest start / latest end of the range is only the edge of the data: the true bound lies
    beyond the analysed span, so the range is one-sided and that bound is not a time (exports leave it blank)."""
    start_worlds: tuple[str, str] | None = None
    """The horizon cases that give (earliest, latest) of `start_range`, from `START_WORLDS`/`END_WORLDS` by how the row was built:
    a sunlit or contact row starts earliest in the optimistic case and latest in the pessimistic one, and ends earliest in the
    pessimistic case and latest in the optimistic one; a dark or contact-gap row (the complement) inherits the swapped
    pair, so its start range is the previous row's end range and its end range the next row's start range. None: the
    edge does not depend on the horizon (eclipse rows, the analysed span's own edge). Where a row has no pessimistic
    window (`certain` False) the bound that case would give is the nominal interval's other edge, still labelled pessimistic."""
    end_worlds: tuple[str, str] | None = None
    """As `start_worlds`, for `end_range`."""

    @property
    def duration_s(self) -> float:
        return self.end_et - self.start_et


START_WORLDS = ("optimistic", "pessimistic")
"""Cases giving (earliest, latest) start of an interval that opens with a higher signal (`visibility.bounded_windows`)."""
END_WORLDS = ("pessimistic", "optimistic")
"""Cases giving (earliest, latest) end of such an interval."""


def rows_from_uncertain(wins: list[UncertainWindow]) -> tuple[IntervalRow, ...]:
    """Interval rows from `visibility.bounded_windows` output."""
    rows = []
    for u in wins:
        w = u.nominal
        if w is None:
            rows.append(IntervalRow(u.start_range[0], u.end_range[1], u.start_range, u.end_range,
                                    False, False, nominal=False, certain=False,
                                    start_range_censored=u.start_range_censored,
                                    end_range_censored=u.end_range_censored,
                                    start_worlds=START_WORLDS, end_worlds=END_WORLDS))
        else:
            rows.append(IntervalRow(w.start, w.end, u.start_range, u.end_range, w.start_censored,
                                    w.end_censored, certain=u.certain, start_range_censored=u.start_range_censored,
                                    end_range_censored=u.end_range_censored,
                                    start_worlds=START_WORLDS, end_worlds=END_WORLDS))
    return tuple(rows)


def rows_from_windows(wins: list[Window]) -> tuple[IntervalRow, ...]:
    """Rows without edge uncertainty (geometry that does not depend on terrain, e.g. eclipse)."""
    return tuple(IntervalRow(w.start, w.end, (w.start, w.start), (w.end, w.end), w.start_censored,
                             w.end_censored) for w in wins)


def complement_rows(rows: tuple[IntervalRow, ...], t0: float, t1: float) -> tuple[IntervalRow, ...]:
    """Gaps between interval rows inside [t0, t1]; each gap starts where the previous interval ends
    (inheriting its edge range and `*_worlds`) and ends where the next begins."""
    out: list[IntervalRow] = []
    cur, cur_range, cur_cens, cur_rc, cur_w = t0, (t0, t0), True, False, None
    for r in rows:
        if not r.nominal:
            continue
        if r.start_et > cur:
            out.append(IntervalRow(cur, r.start_et, cur_range, r.start_range, cur_cens, False,
                                   start_range_censored=cur_rc, end_range_censored=r.start_range_censored,
                                   start_worlds=cur_w, end_worlds=r.start_worlds))
        cur, cur_range, cur_cens, cur_rc, cur_w = r.end_et, r.end_range, False, r.end_range_censored, r.end_worlds
    if cur < t1:
        out.append(IntervalRow(cur, t1, cur_range, (t1, t1), cur_cens, True, start_range_censored=cur_rc,
                               start_worlds=cur_w))
    return tuple(o for o in out if o.end_et > o.start_et)


@dataclass(frozen=True, slots=True)
class Metric:
    """Headline number: nominal `value` and the (min, max) over the three horizon worlds."""

    key: str
    label: str
    value: float | None
    unit: str
    low: float | None
    high: float | None
    censored: bool = False
    note: str = ""
    one_sided: bool = False
    """The range is taken over the worlds that have the event only (the others have none in the analysed span)."""
    when: dict[str, MetricInstant | None] = field(default_factory=dict)
    """For an extreme (the minimum state of charge): the instant it occurs in each case, keys `nominal`, `optimistic`, `pessimistic`
    (the same cases as `value`, `low` and `high`); None where the case has no value (no nominal with an unknown heading). Empty for
    metrics that are not extremes."""
    when_basis: str = ""
    """How the instants in `when` are located and how exact they are; empty when `when` is empty."""
    when_resolution_s: float | None = None
    """The signal-grid step the instants are interpolated from, seconds (None when `when` is empty)."""


@dataclass(frozen=True, slots=True)
class MetricInstant:
    """When an extreme occurs in one case."""

    et: float
    utc: str
    """Whole-second UTC of `et`."""
    value: float
    """The extreme's value in this case, beside its instant. `Metric.low` and `Metric.high` are the lowest and the highest of the
    per-case values (the minimum over the cases); with an unknown heading `low` is the pessimistic case's `value` and `high` the optimistic
    case's, and there is no nominal."""
    hold_s: float
    """How long the quantity stays at the extreme from that instant (0 for a single instant; the whole mission for a battery that never
    leaves full). Ties report the first instant and this duration."""


MIN_SOC_WHEN_BASIS = (
    "The battery model's own integration: generation is linear between the signal samples and the load switches at the sunlit-window "
    "edges, so the stored energy is exactly quadratic within each piece and the minimum is located in closed form at the first instant "
    "the energy is lowest, a power-balance zero crossing interpolated between samples or an interval end (no step-size error in the "
    "integration). The instant inherits the timing of the generation it is given: the signal grid step limits how "
    "closely the generation's own edges (the end of an eclipse, a sunrise) are known, and the optimistic and pessimistic cases bracket "
    "the horizon and heading uncertainty. A flat minimum reports its first instant and how long the battery stays there.")


@dataclass(frozen=True, slots=True)
class NextEvent:
    """Next transition after an epoch: nominal time, hours from the epoch and the edge range."""

    kind: str
    et: float
    hours: float
    range_et: tuple[float, float]
    utc: str
    missing_worlds: tuple[str, ...] = ()
    """Worlds (`optimistic` / `pessimistic`) in which no such event occurs in the analysed span: `range_et` is then
    taken over the other worlds only and is one-sided (the true bound lies beyond the data)."""

    cause: str = "horizon"
    """What set the event: `horizon` (terrain or sphere horizon), `eclipse` (the Earth's shadow, with the Sun well above the horizon) or
    `horizon and eclipse` (both partly). Set for sunlight events; `horizon` for contact events."""
    name: str = ""
    """The event named by its cause, for clients to print: `sunset`/`sunrise` when the horizon sets it, `eclipse start`/`eclipse end`
    (Earth's shadow) when the eclipse does, `sunlight loss`/`sunlight return` when both do; `loss of contact`/`acquisition of contact`."""

    @property
    def one_sided(self) -> bool:
        return bool(self.missing_worlds)


def seam_sentence(seam: dict) -> str:
    """One readable sentence from a horizon provenance `near_field_seam` record (distance, the two stores, step, shift)."""
    def f(key: str, fmt: str, unit: str) -> str:
        v = seam.get(key)
        return "unknown" if v is None else f"{v:{fmt}} {unit}"

    return (f"The terrain changes source {f('distance_m', '.0f', 'm')} from the observer ({seam.get('ground_store')} under the observer, "
            f"{seam.get('other_store')} beyond the seam): the ground steps by {f('step_median_m', '.1f', 'm')} at the seam (95th percentile "
            f"{f('step_p95_m', '.1f', 'm')}, {seam.get('n_crossings', 'unknown')} crossings) and the horizon can shift by up to "
            f"{f('horizon_shift_deg', '.2f', 'deg')}; the near-field horizon (inside {f('near_field_m', '.0f', 'm')}) is an artefact "
            "of the join as much as of the terrain, so treat the illumination and visibility results near the observer with caution.")


def horizon_warnings(reports: dict[str, dict]) -> tuple[str, ...]:
    """The distinct near-field seam sentences of the array and antenna horizons (terrain providers; none otherwise).

    The horizon engine's `near_field_seam.warning` is a flag; the sentence is composed here from the same record."""
    out: list[str] = []
    for rep in reports.values():
        seam = (rep.get("provenance") or {}).get("near_field_seam") or {}
        if seam.get("warning"):
            text = seam_sentence(seam)
            if text not in out:
                out.append(text)
    return tuple(out)


@dataclass(frozen=True, slots=True)
class SiteEvaluation:
    """Result of `evaluate_scenario`."""

    scenario: Scenario
    provider_name: str
    t_land_et: float
    mission_s: float
    signals: SiteSignals
    analysis: Analysis
    power: PowerSignals
    soc: dict[str, np.ndarray]
    """State of charge on the grid per world (NaN outside the mission window)."""
    soc_result_nominal: object
    verdict: Verdict
    metrics: tuple[Metric, ...]
    intervals: dict[str, tuple[IntervalRow, ...]]
    slope_deg: float | None
    provenance: dict
    heading: HeadingAnalysis | None = None
    """Heading state and its effect on the power-dependent results (`scenario.heading`)."""
    warnings: tuple[str, ...] = ()
    """Readable warnings from the terrain horizon (near-field seam sentences from `near_field_seam`), de-duplicated."""

    def illumination(self, *, window: str = "mission", span_filter=None, earth_masks_deg=(0.0,), limb=None):
        """Named illumination and Earth-visibility definitions over the mission (or the analysis span):
        `(SunIllumination, EarthVisibility)` from `scenario.illumination` (average illumination, sunlit
        fractions by any-part / centre / half-flux definitions, longest light and shadow, optional
        quasi-continuous `SpanFilter`, Earth any/centre/full disc per elevation mask)."""
        from .illumination import SpanFilter, evaluation_illumination

        return evaluation_illumination(
            self, window=window, span_filter=span_filter or SpanFilter(), earth_masks_deg=earth_masks_deg, limb=limb)

    def bound_attribution(self, provider=None):
        """Which horizon events make the optimistic, nominal and pessimistic worlds differ, per constraint
        (`scenario.bound_attribution.BoundAttribution`); computed from this evaluation's own windows."""
        from .bound_attribution import bound_attribution

        return bound_attribution(self, provider)

    def metric(self, key: str) -> Metric:
        for m in self.metrics:
            if m.key == key:
                return m
        raise KeyError(key)

    def next_event(self, kind: EventKind, from_et: float | str | None = None) -> NextEvent | None:
        """Next `kind` transition strictly after `from_et` (default: the landing); None if the analysed
        span holds none. Edge ranges come from the optimistic and pessimistic worlds."""
        if kind not in EVENT_KINDS:
            raise ValueError(f"kind must be one of {EVENT_KINDS}")
        q = self.t_land_et if from_et is None else (utc_to_et(from_et) if isinstance(from_et, str) else float(from_et))
        per_world = []
        for w in self.analysis.worlds:
            ws = w.sunlit if kind in ("sunset", "sunrise") else w.contact
            edges = ws.ends[~ws.end_cens] if kind in ("sunset", "earthset") else ws.starts[~ws.start_cens]
            nxt = edges[edges > q]
            per_world.append(float(nxt.min()) if nxt.size else math.nan)
        if math.isnan(per_world[0]):
            return None
        finite = [x for x in per_world if not math.isnan(x)]
        missing = tuple(w for w, x in zip(WORLDS, per_world) if math.isnan(x))
        cause, name = self._event_cause(kind, per_world[0])
        return NextEvent(kind, per_world[0], (per_world[0] - q) / HOUR_S, (min(finite), max(finite)),
                         et_to_utc(per_world[0]), missing, cause, name)

    def _event_cause(self, kind: str, et: float) -> tuple[str, str]:
        """Cause and name of a nominal event. A sunlight event is an eclipse event when the horizon alone leaves the Sun's disc
        (nearly) fully visible at that instant (terrain flux >= 0.95) and the Earth's shadow covers part of it (eclipse fraction > 0.05)."""
        if kind in ("earthset", "earthrise"):
            return "horizon", "loss of contact" if kind == "earthset" else "acquisition of contact"
        cause = sunlight_edge_cause(self.signals, et)
        down = kind == "sunset"
        if cause == ECLIPSE_CAUSE:
            return cause, "eclipse start" if down else "eclipse end"
        if cause == MIXED_CAUSE:
            return cause, "sunlight loss" if down else "sunlight return"
        return cause, kind

    @property
    def no_nominal_series(self) -> tuple[str, ...]:
        """Heading-dependent series that have no nominal case (empty for a stated or irrelevant heading): with an unknown
        heading that matters, the nominal of `array_power_w` and `soc` would be a mean over headings, which is no expected
        outcome, so `time_series` returns NaN for them and the `_lo`/`_hi` series carry the lower and upper bound over headings."""
        return HEADING_DEPENDENT_SERIES if self.heading is not None and self.heading.unknown_and_matters else ()

    @property
    def series_notes(self) -> list[str]:
        """Why a series of `time_series()` is empty: one sentence naming `no_nominal_series` (an unknown heading that matters
        leaves no nominal heading); empty when every series has its nominal."""
        names = self.no_nominal_series
        if not names:
            return []
        return [f"{', '.join(names)} (nominal) are empty: the lander heading is unknown, so no nominal heading exists and the "
                "engine reports no nominal value; the _lo / _hi columns are the lower and the upper bound over headings (the worst and "
                "the best heading at each instant, on the raised and the lowered horizon; no single heading follows either)"]

    def time_series(self) -> dict[str, np.ndarray]:
        """All time series on the analysis grid; bounded quantities as `<name>` (nominal),
        `<name>_lo`/`<name>_hi` (pessimistic / optimistic world: lowest / highest value). With an unknown lander heading that
        matters `no_nominal_series` (`array_power_w`, `soc`) are all NaN and their `_lo`/`_hi` are the lower and upper bound over headings."""
        s, p = self.signals, self.power.power_w
        out: dict[str, np.ndarray] = {
            "et": s.et, "sun_az_deg": s.sun_az_deg, "sun_el_deg": s.sun_el_deg,
            "earth_az_deg": s.earth_az_deg, "earth_el_deg": s.earth_el_deg,
            "earth_range_km": s.earth_range_km, "eclipse_fraction": s.eclipse,
            "sunlight_fraction": s.sunlight.nominal, "sunlight_fraction_lo": s.sunlight.pessimistic,
            "sunlight_fraction_hi": s.sunlight.optimistic,
            "array_power_w": p.nominal, "array_power_w_lo": p.pessimistic, "array_power_w_hi": p.optimistic,
            "contact_clearance_deg": s.contact.nominal, "contact_clearance_deg_lo": s.contact.pessimistic,
            "contact_clearance_deg_hi": s.contact.optimistic,
            "soc": self.soc["nominal"], "soc_lo": self.soc["pessimistic"], "soc_hi": self.soc["optimistic"],
        }
        for name in self.no_nominal_series:
            out[name] = np.full_like(out[name], np.nan)
        if s.link_margin_db is not None:
            out["link_margin_db"] = s.link_margin_db
        for name, sig in s.station_clearance.items():
            out[f"clearance_deg:{name}"] = sig.nominal
            out[f"clearance_deg:{name}_lo"] = sig.pessimistic
            out[f"clearance_deg:{name}_hi"] = sig.optimistic
        return out


HEADING_DEPENDENT_SERIES = ("array_power_w", "soc")
NO_NOMINAL_NOTE = "lander heading unknown: no nominal value; range over all headings"

_METRIC_FOR_KEY: dict[str, tuple[str, str, str]] = {
    "landing_sun_elevation_deg": ("sun_elevation_at_landing_deg", "Sun elevation at landing", "deg"),
    "landing_hours_after_sunrise": ("hours_after_sunrise_at_landing", "Hours since last sunrise at landing", "h"),
    "dte_at_landing_deg": ("dte_clearance_at_landing_deg", "Earth clearance above the antenna horizon at landing", "deg"),
    "min_sunlit_hours_after_landing": ("continuous_sunlight_after_landing_h", "Continuous sunlight after landing", "h"),
    "max_dark_span_h": ("longest_dark_span_h", "Longest dark span during the mission", "h"),
    "min_contact_fraction": ("contact_fraction", "Fraction of the mission in contact", "fraction"),
    "max_contact_gap_h": ("longest_outage_h", "Longest contact outage during the mission", "h"),
    "min_link_margin_db": ("min_link_margin_db", "Lowest downlink margin while in contact", "dB"),
    "min_state_of_charge": ("min_state_of_charge", "Minimum battery state of charge", "fraction"),
    "max_slope_deg": ("slope_deg", "Terrain slope at the site", "deg"),
}


def _metrics(ev: EpochValues, slope_note: str) -> list[Metric]:
    out = []
    for key in CONSTRAINT_KEYS:
        if key not in ev.values:
            continue
        mk, label, unit = _METRIC_FOR_KEY[key]
        v = ev.values[key][:, 0]
        ok = np.all(np.isfinite(v))
        m = Metric(
            mk, label, float(v[0]) if np.isfinite(v[0]) else None, unit,
            float(v.min()) if ok else None, float(v.max()) if ok else None, bool(ev.censored[key][0]),
            slope_note if key == "max_slope_deg" else "")
        out.append(_dark_at_landing(m, v, bool(ev.censored[key][0])) if key == "landing_hours_after_sunrise" else m)
    return out


def _min_soc_when(power: PowerSignals, an: Analysis, prof, t_land: float, d_s: float, no_nominal: bool) -> dict[str, MetricInstant | None]:
    """Instant of the minimum state of charge in each case, from the same simulation as the metric's value (`verdict_power_w`)."""
    vp = power.verdict_power_w
    out: dict[str, MetricInstant | None] = {}
    for w, gen in zip(WORLDS, (vp.nominal, vp.optimistic, vp.pessimistic)):
        if no_nominal and w == "nominal":
            out[w] = None
            continue
        res = simulate_window(an.t, gen, an.worlds[0].sunlit, t_land, d_s, prof.battery, prof.loads)
        t_min = float(res.t_min_soc)
        at_min = res.soc <= res.min_soc + 1e-9
        i = int(np.searchsorted(res.t, t_min - 1e-6, side="left"))
        j = i
        if i < res.t.size and at_min[i]:
            while j + 1 < res.t.size and at_min[j + 1]:
                j += 1
            hold = float(res.t[j]) - t_min
        else:
            hold = 0.0
        out[w] = MetricInstant(t_min, et_to_utc(t_min, 0), float(res.min_soc), max(hold, 0.0))
    return out


def _dark_at_landing(m: Metric, v: np.ndarray, censored: bool) -> Metric:
    """`hours since the last sunrise` has no value where the array is dark at landing. The engine's signed convention (minus the hours to
    the next sunrise) stays inside the verdict; the metric is blank for a world that is dark (all three worlds blank the range) and
    says which world and when the Sun returns."""
    dark = [w for w, x in zip(WORLDS, v) if np.isfinite(x) and x < 0.0]
    if not dark:
        return m
    nominal_dark = v[0] < 0.0
    note = "the array is dark at landing in the " + " and ".join(dark) + " case"
    if nominal_dark:
        wait = -float(v[0])
        note += (f"; no sunrise within the analysed span (the next one is at least {wait:.1f} h after landing)" if censored
                 else f"; the next sunrise is {wait:.1f} h after landing")
    return replace(m, value=None if nominal_dark else m.value, low=None, high=None, note=note)


def evaluate_scenario(
    scenario: Scenario, provider: HorizonProvider | None = None, *, table: BodyFixedEphemeris | None = None,
    horizons: tuple | None = None,
) -> SiteEvaluation:
    """Evaluate one scenario end to end.

    `provider` defaults to `SmoothSphereProvider()`. `table`, when given, is used as the analysis grid
    (it must hold the network's stations and cover the mission; an analysis of many sites builds one
    table and passes it to each); otherwise a table is built on a grid anchored at the landing epoch
    (`sampling.step_s`, with `sampling.lookback_h` of history to find the last sunrise).
    `horizons` optionally supplies the already-fetched (array, antenna) provider horizons.
    """
    provider = provider or SmoothSphereProvider()
    check_terrain_stack(scenario, provider)
    prof, cons = scenario.profile, scenario.constraints
    t_land = utc_to_et(scenario.landing_utc)
    d_s = scenario.mission_duration_h * HOUR_S
    min_sun = cons.min_sunlit_hours_after_landing
    span = max(d_s, (min_sun.min or 0.0) * HOUR_S if min_sun else 0.0)
    if table is None:
        t = landing_grid(t_land, scenario.sampling.step_s, scenario.sampling.lookback_h * HOUR_S, span)
        table = build_table(t, [scenario.network])
    site_lon = scenario.site.lon_deg if scenario.site.lon_deg <= 180.0 else scenario.site.lon_deg - 360.0
    if horizons is None:
        ah_raw, nh_raw = fold_observers(provider.horizons(
            observer_sites(scenario.site.lat_deg, site_lon, prof, scenario.site.name)))
    else:
        ah_raw, nh_raw = fold_observers(horizons)
    ah, ah_rep = prepare_horizon(ah_raw, scenario.terrain_error, provider.models_terrain, provider)
    nh, nh_rep = prepare_horizon(nh_raw, scenario.terrain_error, provider.models_terrain, provider)
    reports = {"array": {**ah_rep, "provenance": ah_raw.provenance, "ground_height_m": ah_raw.ground_height_m},
               "antenna": {**nh_rep, "provenance": nh_raw.provenance, "ground_height_m": nh_raw.ground_height_m}}
    sig = compute_signals(table, ah, nh, prof, scenario.network, cons, scenario.eclipse, horizon_reports=reports)
    power = array_power(sig, prof)
    an = build_analysis(sig, cons, power)
    t = an.t
    if t_land < an.t0 or t_land + d_s > an.t1 + 1e-6:
        raise ValueError("the ephemeris table must cover the mission [landing, landing + duration]")

    slope = provider.slope_deg(scenario.site.lat_deg, site_lon, cons.slope_baseline_m.value)
    keys = [k for k in CONSTRAINT_KEYS if k != "min_link_margin_db" or prof.link is not None]
    if slope is None:
        keys = [k for k in keys if k != "max_slope_deg"]
    q = np.array([t_land])
    ev = epoch_values(an, q, d_s, keys, battery=prof.battery, loads=prof.loads, slope_deg=slope)
    vd: Verdicts = judge(ev, cons)
    verdict = build_verdict(ev, vd, cons, 0)
    if "max_slope_deg" in cons.active() and slope is None:
        verdict = _with_unknown_slope(verdict, cons)
    metrics = _metrics(ev, "")

    soc: dict[str, np.ndarray] = {}
    gens = (power.power_w.nominal, power.power_w.optimistic, power.power_w.pessimistic)
    nominal_result = None
    for w, gen in zip(WORLDS, gens):
        res = simulate_window(t, gen, an.worlds[0].sunlit, t_land, d_s, prof.battery, prof.loads)
        inside = (t >= t_land) & (t <= t_land + d_s)
        soc[w] = np.where(inside, np.interp(t, res.t, res.soc), np.nan)
        if w == "nominal":
            nominal_result = res
    in_mission = (t >= t_land) & (t <= t_land + d_s)
    heading = analyse_heading(power, prof, cons, t, an.worlds[0].sunlit, t_land, d_s, soc)
    verdict = apply_heading_to_verdict(verdict, heading, ev, cons)
    if heading.unknown_and_matters:
        metrics = [replace(m, value=None, note=NO_NOMINAL_NOTE) if m.key == "min_state_of_charge" else m for m in metrics]
    peak = Metric("peak_array_power_w", "Peak array power", float(power.power_w.nominal[in_mission].max()), "W",
                  float(power.power_w.pessimistic[in_mission].max()), float(power.power_w.optimistic[in_mission].max()))
    metrics.append(replace(peak, value=None, note=NO_NOMINAL_NOTE) if heading.unknown_and_matters else peak)
    if any(m.key == "min_state_of_charge" for m in metrics):
        when = _min_soc_when(power, an, prof, t_land, d_s, heading.unknown_and_matters)
        step = float(np.median(np.diff(t)))
        metrics = [replace(m, when=when, when_basis=MIN_SOC_WHEN_BASIS, when_resolution_s=step) if m.key == "min_state_of_charge" else m
                   for m in metrics]
    intervals = _intervals(sig, an, cons.sunlit_flux_fraction.value, cons.antenna_terrain_margin_deg.value)
    evaluation = SiteEvaluation(
        scenario=scenario, provider_name=provider.name, t_land_et=t_land, mission_s=d_s, signals=sig,
        analysis=an, power=power, soc=soc, soc_result_nominal=nominal_result, verdict=verdict,
        metrics=tuple(metrics), intervals=intervals, slope_deg=slope, heading=heading,
        warnings=horizon_warnings(reports),
        provenance=build_provenance(scenario, provider, table, horizons=reports, analysis={
            "t_first_utc": et_to_utc(float(t[0])), "t_last_utc": et_to_utc(float(t[-1])), "n_epochs": int(t.size),
            "step_s": float(np.median(np.diff(t))) if t.size > 1 else None,
            "limb_darkening": "default (alpha = 0.56)", "sunlit_flux_fraction": cons.sunlit_flux_fraction.value}))
    extra = []
    for kind, label in (("sunset", "Time to next sunset"), ("earthset", "Time to next loss of contact")):
        ne = evaluation.next_event(kind)
        if ne is not None and kind == "sunset":
            label = f"Time to next {ne.name}"
        extra.append(Metric(
            f"time_to_next_{kind}_h", label + " (from landing)", None if ne is None else ne.hours, "h",
            None if ne is None else (ne.range_et[0] - t_land) / HOUR_S,
            None if ne is None else (ne.range_et[1] - t_land) / HOUR_S,
            censored=ne is None, note="" if ne else "no such event in the analysed span",
            one_sided=bool(ne and ne.one_sided)))
    return _replace_metrics(evaluation, tuple(metrics) + tuple(extra))


def _replace_metrics(ev: SiteEvaluation, metrics: tuple[Metric, ...]) -> SiteEvaluation:
    return replace(ev, metrics=metrics)


def _with_unknown_slope(verdict: Verdict, cons) -> Verdict:
    from .verdicts import ConstraintVerdict

    lim = cons.max_slope_deg
    rows = verdict.constraints + (ConstraintVerdict(
        key="max_slope_deg", label=lim.label, state="unknown", value=None, value_range=None, limit_min=lim.min,
        limit_max=lim.max, unit=lim.unit, margin=None, margin_worst=None, censored=False,
        origin_basis=lim.origin.basis, origin_label=lim.origin.label, origin_source_url=lim.origin.source_url),)
    return Verdict(verdict.state, verdict.limiting, rows)


def _label_horizon_edges(rows: tuple[IntervalRow, ...], horizon_sets) -> tuple[IntervalRow, ...]:
    """Keep the case labels of an edge only when the horizon sets it: `horizon_sets(et, ending)` is the engine's own cause test at the
    nominal edge time (`edge_cause`); an edge at the span's end (censored) is no transition and carries none."""
    out = []
    for r in rows:
        start = r.start_worlds if r.start_worlds and not r.start_censored and horizon_sets(r.start_et, False) else None
        end = r.end_worlds if r.end_worlds and not r.end_censored and horizon_sets(r.end_et, True) else None
        out.append(replace(r, start_worlds=start, end_worlds=end))
    return tuple(out)


def _intervals(sig: SiteSignals, an: Analysis, sunlit_threshold: float, margin_deg: float) -> dict[str, tuple[IntervalRow, ...]]:
    t = sig.et
    sun = _label_horizon_edges(rows_from_uncertain(bounded_windows(
        t, sig.sunlight.nominal, sig.sunlight.optimistic, sig.sunlight.pessimistic, sunlit_threshold)),
        lambda et, ending: sunlight_edge_cause(sig, et) != ECLIPSE_CAUSE)
    contact = _label_horizon_edges(rows_from_uncertain(bounded_windows(
        t, sig.contact.nominal, sig.contact.optimistic, sig.contact.pessimistic, 0.0)),
        lambda et, ending: contact_edge(sig, margin_deg, et, ending).lander_limits)
    out = {
        "sunlit": sun, "dark": complement_rows(sun, float(t[0]), float(t[-1])),
        "eclipse": rows_from_windows(find_windows(t, sig.eclipse, 0.0)),
        "contact": contact, "contact_gap": complement_rows(contact, float(t[0]), float(t[-1])),
    }
    for name, c in sig.station_clearance.items():
        out[f"contact:{name}"] = _label_horizon_edges(
            rows_from_uncertain(bounded_windows(t, c.nominal, c.optimistic, c.pessimistic, 0.0)),
            lambda et, ending, name=name: contact_edge(sig, margin_deg, et, ending, name).lander_limits)
    return out
