"""Landing opportunities: every candidate epoch over months to years, evaluated with running windows.

`build_scan_context` computes the site signals once on a regular grid and the three-world windows
(`engine.Analysis`); `ScanContext.evaluate` then answers any array of landing epochs by vectorised
window queries (`windows.py`), so a 5-year scan at 1 h candidate spacing costs one signal pass plus a
few array operations. Candidate epochs lie on the signal lattice, so a scan over lattice epochs equals the
per-epoch single-site evaluation exactly (tested).

An *open window* is a run of consecutive candidates whose verdict is not FAIL; its `robust` runs are
the PASS subsets (the constraint holds in all three horizon worlds).
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass, replace

import numpy as np

from lunarnav.ephem import BodyFixedEphemeris, et_to_utc, utc_to_et

from .engine import (
    FAIL,
    HOUR_S,
    MARGINAL,
    PASS,
    STATE_NAMES,
    Analysis,
    EpochValues,
    Verdicts,
    build_analysis,
    epoch_values,
    fractions,
    has_no_nominal_margin,
    judge,
    margin_kind,
    margin_note,
)
from .evaluate import build_table
from .horizons import HorizonProvider, SmoothSphereProvider, fold_observers, observer_sites
from .lunation import Lunation, local_solar_time_h, lunation_index, lunations
from .models import MAX_STEP_S, Scenario
from .progress import scaled_progress
from .provenance import build_provenance, check_terrain_stack
from .signals import SiteSignals, array_power, compute_signals, prepare_horizon
from .verdicts import UNKNOWN_HEADING_NOTE, Verdict, blank_unknown_heading, build_verdict, unknown_heading_soc

DEFAULT_SIGNAL_STEP_S = 1800.0
DEFAULT_SPACING_S = 3600.0
DEFAULT_LOOKBACK_H = 720.0
SCAN_STATION_GRID_STEP_S = 3600.0
"""Station-ephemeris spline grid for long scans (15 min is the table default; see validation report)."""


EVAL_CHUNK = 500
"""Landing candidates evaluated between two progress calls."""


def _merge_chunks(parts: list[tuple[EpochValues, Verdicts]]) -> tuple[EpochValues, Verdicts]:
    """Concatenate chunked `evaluate` results along the epoch axis."""
    evs, vds = [p[0] for p in parts], [p[1] for p in parts]
    cat = lambda xs, ax=-1: np.concatenate(xs, axis=ax)  # noqa: E731
    ev = EpochValues(
        {k: cat([e.values[k] for e in evs]) for k in evs[0].values}, {k: cat([e.censored[k] for e in evs]) for k in evs[0].censored},
        sum(e.n for e in evs), {k: cat([e.skipped[k] for e in evs]) for k in evs[0].skipped})
    vd = Verdicts(vds[0].keys, cat([v.state for v in vds]), {k: cat([v.per_constraint[k] for v in vds]) for k in vds[0].per_constraint},
                  {k: cat([v.margin[k] for v in vds]) for k in vds[0].margin}, cat([v.limiting for v in vds]),
                  cat([v.worst_margin for v in vds]), vds[0].extra)
    return ev, vd


@dataclass(frozen=True, slots=True)
class ScanContext:
    """Pre-computed site signals and windows for evaluating landing epochs of one scenario."""

    scenario: Scenario
    provider_name: str
    table: BodyFixedEphemeris
    signals: SiteSignals
    analysis: Analysis
    mission_s: float
    slope_deg: float | None
    keys: tuple[str, ...]
    """Constraint keys evaluated (the active constraints; slope only when known)."""
    provenance: dict

    def _evaluate_raw(self, q: np.ndarray, skip_failed_soc: bool) -> tuple[EpochValues, Verdicts]:
        prof = self.scenario.profile
        ev = epoch_values(
            self.analysis, np.asarray(q, dtype=np.float64), self.mission_s, self.keys,
            battery=prof.battery, loads=prof.loads, slope_deg=self.slope_deg,
            skip_failed_with=self.scenario.constraints if skip_failed_soc else None)
        return ev, judge(ev, self.scenario.constraints)

    @property
    def heading_unknown(self) -> bool:
        """The minimum state of charge has no nominal outcome (heading unknown and it matters): its values are NaN."""
        return "min_state_of_charge" in self.keys and unknown_heading_soc(self.analysis)

    def evaluate(self, q: np.ndarray, *, skip_failed_soc: bool = True) -> tuple[EpochValues, Verdicts]:
        """Constraint values and verdicts at landing epochs `q` (ET s; any epochs, interpolated). With an unknown lander heading
        the `min_state_of_charge` values are NaN (no outcome at one heading); the states and margins already follow the heading rule."""
        ev, vd = self._evaluate_raw(q, skip_failed_soc)
        if self.heading_unknown:
            ev = replace(ev, values={**ev.values, "min_state_of_charge": np.full_like(ev.values["min_state_of_charge"], np.nan)})
        return ev, vd

    def evaluate_chunked(
        self, q: np.ndarray, progress: Callable[[float, str], None] | None = None, lo: float = 0.0, hi: float = 1.0,
        stage: str = "evaluating landing candidates",
    ) -> tuple[EpochValues, Verdicts]:
        """`evaluate` in chunks of `EVAL_CHUNK` candidates, calling `progress(fraction, stage)` before each chunk so
        that a cancel is honoured within one chunk. Identical results to `evaluate` (each epoch is independent)."""
        q = np.asarray(q, dtype=np.float64)
        if progress is None or q.size <= EVAL_CHUNK:
            if progress is not None:
                progress(lo, stage)
            return self.evaluate(q)
        parts = []
        for a in range(0, q.size, EVAL_CHUNK):
            progress(lo + (hi - lo) * a / q.size, stage)
            parts.append(self.evaluate(q[a:a + EVAL_CHUNK]))
        return _merge_chunks(parts)

    def verdict_and_margin_at(self, q: float) -> tuple[Verdict, float | None]:
        """Full verdict record at one landing epoch and its worst-case normalised margin (pessimistic case; None if not finite).
        An unknown lander heading is applied as in `evaluate_scenario` (`blank_unknown_heading`)."""
        ev, vd = self._evaluate_raw(np.array([q]), False)
        verdict = build_verdict(ev, vd, self.scenario.constraints, 0)
        if self.heading_unknown:
            verdict = blank_unknown_heading(verdict, ev, self.scenario.constraints, UNKNOWN_HEADING_NOTE)
        m = float(vd.worst_margin[0])
        return verdict, (m if np.isfinite(m) else None)

    def verdict_at(self, q: float) -> Verdict:
        """Full verdict record at one landing epoch."""
        return self.verdict_and_margin_at(q)[0]


MAX_SCAN_EPOCHS = 1_500_000
"""Largest signal grid `scan_table` builds (about 100 MB of table arrays); 5 years at 120 s is 1.3 million."""


def _check_scan_grid(t_first: float, t_last: float, n: int, step_s: float) -> None:
    """Refuse a scan grid the kernels do not cover or that is too large, before allocating it."""
    from lunarnav.ephem.kernels import load_kernels

    if not 0.0 < step_s <= MAX_STEP_S:
        raise ValueError(f"signal_step_s must be above 0 and at most {MAX_STEP_S:g} s (one hour), got {step_s:g}")
    lo, hi = load_kernels().valid_et
    if t_first < lo or t_last > hi:
        raise ValueError(
            f"the scan needs epochs {et_to_utc(t_first)} to {et_to_utc(t_last)} (landings, lookback and the mission after "
            f"the last landing) but the pinned kernels cover {et_to_utc(lo)} to {et_to_utc(hi)}; choose dates and a "
            "mission duration inside that span")
    if n > MAX_SCAN_EPOCHS:
        fit_days = (MAX_SCAN_EPOCHS - 1) * step_s / 86400.0
        raise ValueError(
            f"the scan needs {n:,} signal epochs (span {(t_last - t_first) / 86400.0:.0f} days at a {step_s:g} s signal "
            f"step), above the limit of {MAX_SCAN_EPOCHS:,}; at this step a span of up to {fit_days:.0f} days fits "
            "(shorten the scan, mission duration or lookback, or raise signal_step_s, up to the one-hour maximum)")


def scan_table(
    scenario: Scenario, first_et: float, last_et: float, *, signal_step_s: float = DEFAULT_SIGNAL_STEP_S,
    lookback_h: float = DEFAULT_LOOKBACK_H,
) -> BodyFixedEphemeris:
    """Ephemeris table for landings in [first_et, last_et]: grid `first_et + k * signal_step_s` from
    `lookback_h` before the first landing to the end of the last mission. Build it once and pass it to
    every site of an analysis (`table=`); it holds the scenario network's stations."""
    cons = scenario.constraints
    min_sun = cons.min_sunlit_hours_after_landing
    span = max(scenario.mission_duration_h * HOUR_S, (min_sun.min or 0.0) * HOUR_S if min_sun else 0.0)
    k0 = -int(math.ceil(lookback_h * HOUR_S / signal_step_s))
    k1 = int(math.ceil((last_et - first_et + span) / signal_step_s)) + 1
    _check_scan_grid(first_et + k0 * signal_step_s, first_et + k1 * signal_step_s, k1 - k0 + 1, signal_step_s)
    grid = first_et + np.arange(k0, k1 + 1, dtype=np.float64) * signal_step_s
    return build_table(grid, [scenario.network], station_grid_step_s=SCAN_STATION_GRID_STEP_S)


def build_scan_context(
    scenario: Scenario, provider: HorizonProvider | None, first_et: float, last_et: float, *,
    signal_step_s: float = DEFAULT_SIGNAL_STEP_S, lookback_h: float = DEFAULT_LOOKBACK_H,
    table: BodyFixedEphemeris | None = None, horizons: tuple | None = None,
    progress: Callable[[float, str], None] | None = None,
) -> ScanContext:
    """Signals and windows covering landings in [first_et, last_et] (+ the mission after the last one
    and `lookback_h` before the first). The grid is anchored at `first_et`: `first_et + k * signal_step_s`.
    `progress(fraction, stage)`, when given, is called at each stage (fractions 0 to 0.6 of a scan)."""
    note = progress or (lambda f, s: None)
    provider = provider or SmoothSphereProvider()
    check_terrain_stack(scenario, provider)
    prof, cons = scenario.profile, scenario.constraints
    d_s = scenario.mission_duration_h * HOUR_S
    note(0.0, "ephemeris table")
    if table is None:
        table = scan_table(scenario, first_et, last_et, signal_step_s=signal_step_s, lookback_h=lookback_h)
    note(0.2, "terrain horizons")
    site_lon = scenario.site.lon_deg if scenario.site.lon_deg <= 180.0 else scenario.site.lon_deg - 360.0
    if horizons is None:
        ah_raw, nh_raw = fold_observers(provider.horizons(
            observer_sites(scenario.site.lat_deg, site_lon, prof, scenario.site.name)))
    else:
        ah_raw, nh_raw = fold_observers(horizons)
    ah, ah_rep = prepare_horizon(ah_raw, scenario.terrain_error, provider.models_terrain, provider)
    nh, nh_rep = prepare_horizon(nh_raw, scenario.terrain_error, provider.models_terrain, provider)
    reports = {"array": {**ah_rep, "provenance": ah_raw.provenance}, "antenna": {**nh_rep, "provenance": nh_raw.provenance}}
    note(0.4, "site signals")
    sig = compute_signals(table, ah, nh, prof, scenario.network, cons, scenario.eclipse, horizon_reports=reports)
    power = array_power(sig, prof) if "min_state_of_charge" in cons.active() else None
    an = build_analysis(sig, cons, power)
    slope = provider.slope_deg(scenario.site.lat_deg, site_lon, cons.slope_baseline_m.value)
    keys = tuple(k for k in cons.active() if not (k == "max_slope_deg" and slope is None))
    t = an.t
    prov = build_provenance(scenario, provider, table, horizons=reports, analysis={
        "kind": "scan", "t_first_utc": et_to_utc(float(t[0])), "t_last_utc": et_to_utc(float(t[-1])),
        "signal_step_s": float(signal_step_s), "n_signal_epochs": int(t.size),
        "station_grid_step_s": table.provenance.get("station_grid_step_s")})
    return ScanContext(scenario, provider.name, table, sig, an, d_s, slope, keys, prov)


@dataclass(frozen=True, slots=True)
class OpenWindow:
    """A run of consecutive non-failing candidates.

    `start_et`/`end_et` are the first and last open candidate epochs and `duration_h` is the elapsed time between them
    (last minus first: 76 h for 77 hourly candidates; 0 for a single candidate). The true edges lie within one `spacing_h` beyond
    either end, so the open interval may be up to `duration_h + 2 * spacing_h` long. `best_*`: the candidate with the largest
    worst-case normalised margin (`best_margin`: the pessimistic-case margin of that candidate's limiting constraint divided
    by its `margin_scale`, dimensionless; it is not the nominal margin shown for a single site evaluation)."""

    start_et: float
    end_et: float
    n_candidates: int
    n_pass: int
    duration_h: float
    best_et: float
    best_margin: float
    best_state: str
    best_limiting: str | None
    robust: tuple[tuple[float, float], ...]
    """PASS-only sub-runs as (first, last) candidate epochs."""
    spacing_h: float = 0.0
    """Candidate spacing in hours."""
    best_margin_kind: str | None = None
    """`worst_case`, `nominal` (a failing best candidate reports the nominal margin) or `best_case` (the failing best candidate is limited
    by the minimum state of charge with an unknown heading: the margin at the upper bound over headings, which no single heading achieves): which case `best_margin` is."""
    best_margin_note: str | None = None
    """The sentence that goes with `best_margin_kind` where it needs one (`engine.BEST_CASE_NOTE`)."""


def utc_lattice(first_et: float, n: int, spacing_s: float) -> np.ndarray:
    """ET epochs of the `n` UTC instants `first + k * spacing` (k = 0 .. n-1), `first` being the UTC of `first_et`.

    Rounding rule (stated once): candidate epochs are whole-spacing steps in UTC, not in ET. UTC and ET differ by the slowly
    varying TDB - TT term (up to 1.7 ms over a year), so an ET lattice drifts off the UTC minute by sub-millisecond amounts that
    print as `...:59.999Z`. SPICE converts a coarse (about daily) set of exact UTC instants and the rest is interpolated linearly
    (error below 1e-9 s); times are printed to the millisecond by SPICE rounding. `utc_lattice(t, 1, s)` equals `t`."""
    if n <= 1:
        return np.array([first_et])[:n]
    start = np.datetime64(et_to_utc(first_et, 6).rstrip("Z"), "us")
    step = max(1, int(86400.0 / spacing_s))
    knots = np.unique(np.concatenate([np.arange(0, n, step), [n - 1]]))
    stamps = start + np.rint(knots * spacing_s * 1.0e6).astype("timedelta64[us]")
    ets = np.asarray(utc_to_et(stamps), dtype=np.float64)
    ets[0] = first_et
    return np.interp(np.arange(n), knots, ets)


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """(first, last) index pairs of consecutive True runs."""
    if not mask.any():
        return []
    edges = np.diff(np.concatenate([[0], mask.astype(np.int8), [0]]))
    return list(zip(np.flatnonzero(edges == 1), np.flatnonzero(edges == -1) - 1))


@dataclass(frozen=True, slots=True)
class Calendar:
    """Lunation x time-in-lunation grid. Row i is `lunations[i]`; column j covers hours
    `[j * bin_h, (j + 1) * bin_h)` after its new moon. `state` is the best state of the candidates in
    the cell (FAIL/MARGINAL/PASS; -1 = no candidate), `open_fraction` the share of non-failing candidates,
    `limiting` the limiting-constraint index (into `keys`) most common among the cell's failing candidates
    (-1 if none fail), `local_solar_time_h` and `sun_el_deg` the values at the first candidate of the cell."""

    lunations: tuple[Lunation, ...]
    bin_h: float
    keys: tuple[str, ...]
    state: np.ndarray
    open_fraction: np.ndarray
    limiting: np.ndarray
    local_solar_time_h: np.ndarray
    sun_el_deg: np.ndarray


@dataclass(frozen=True, slots=True)
class OpportunityScan:
    """Result of `scan_opportunities` (arrays indexed by candidate)."""

    context: ScanContext
    et: np.ndarray
    spacing_s: float
    values: EpochValues
    verdicts: Verdicts
    windows: tuple[OpenWindow, ...]
    calendar: Calendar
    local_solar_time_h: np.ndarray
    sun_el_deg: np.ndarray
    provenance: dict

    @property
    def state(self) -> np.ndarray:
        return self.verdicts.state

    def counts(self) -> dict[str, int]:
        """Candidates per overall state."""
        return {STATE_NAMES[s]: int((self.state == s).sum()) for s in (PASS, MARGINAL, FAIL)}

    def closing_constraints(self) -> dict[str, int]:
        """For failing candidates: how many each constraint is the limiting one for."""
        fail = self.state == FAIL
        keys = self.verdicts.keys
        return {k: int((self.verdicts.limiting[fail] == i).sum()) for i, k in enumerate(keys)}

    def margin_kinds(self) -> list[str | None]:
        """`margin_kind` of every candidate's `verdicts.worst_margin` (`engine.margin_kind`; `best_case` where the failing candidate is
        limited by the minimum state of charge with an unknown heading, whose margin is the upper bound over headings)."""
        keys, unknown = self.verdicts.keys, self.context.heading_unknown
        return [margin_kind(STATE_NAMES[int(s)], float(m), no_nominal=has_no_nominal_margin(keys[int(li)] if li >= 0 else None, unknown))
                for s, m, li in zip(self.verdicts.state, self.verdicts.worst_margin, self.verdicts.limiting)]

    def state_fraction(self) -> dict[str, float | None]:
        """Share of candidates per overall state (`counts` over the number of candidates; None when there are none)."""
        return fractions(self.counts(), int(self.state.size))

    def closing_fraction(self) -> dict[str, float | None]:
        """Share of the failing candidates that each constraint is the limiting one for (None when none fail)."""
        return fractions(self.closing_constraints())

    def verdict_at(self, index: int) -> Verdict:
        """Full verdict record (every constraint evaluated, including those the scan skipped) at candidate `index`."""
        return self.context.verdict_at(float(self.et[index]))


def _open_windows(et: np.ndarray, vd: Verdicts, spacing_s: float, keys: tuple[str, ...], heading_unknown: bool = False) -> tuple[OpenWindow, ...]:
    out = []
    for a, b in _runs(vd.state >= MARGINAL):
        sl = slice(a, b + 1)
        best = a + int(np.argmax(vd.worst_margin[sl]))
        li = int(vd.limiting[best])
        kind = margin_kind(STATE_NAMES[int(vd.state[best])], float(vd.worst_margin[best]),
                           no_nominal=has_no_nominal_margin(keys[li] if li >= 0 else None, heading_unknown))
        robust = tuple((float(et[x]), float(et[y])) for x, y in
                       ((a + p, a + r) for p, r in _runs(vd.state[sl] == PASS)))
        out.append(OpenWindow(
            float(et[a]), float(et[b]), b - a + 1, int((vd.state[sl] == PASS).sum()),
            float(et[b] - et[a]) / HOUR_S, float(et[best]), float(vd.worst_margin[best]),
            STATE_NAMES[int(vd.state[best])], keys[li] if li >= 0 else None, robust, spacing_s / HOUR_S,
            kind, margin_note(kind)))
    return tuple(out)


def build_calendar(
    et: np.ndarray, vd: Verdicts, lst_h: np.ndarray, sun_el: np.ndarray, *, bin_h: float = 6.0
) -> Calendar:
    """Calendar of candidate verdicts by lunation and time within the lunation."""
    lunas = lunations(float(et[0]), float(et[-1]))
    idx, elapsed = lunation_index(et, lunas)
    n_bins = int(math.ceil(max(lu.length_d for lu in lunas) * 24.0 / bin_h))
    shape = (len(lunas), n_bins)
    state = np.full(shape, -1, dtype=np.int8)
    open_frac = np.full(shape, np.nan)
    limiting = np.full(shape, -1, dtype=np.int64)
    lst = np.full(shape, np.nan)
    sel = np.full(shape, np.nan)
    col = np.clip(np.nan_to_num(elapsed / (bin_h * HOUR_S)).astype(np.int64), 0, n_bins - 1)
    members = np.flatnonzero(idx >= 0)
    if members.size:
        cell, first, inverse = np.unique(idx[members] * n_bins + col[members], return_index=True, return_inverse=True)
        row, column = np.divmod(cell, n_bins)
        st = vd.state[members]
        cell_state = np.full(cell.size, -1, dtype=np.int8)
        np.maximum.at(cell_state, inverse, st)
        state[row, column] = cell_state
        open_frac[row, column] = (np.bincount(inverse, weights=(st >= MARGINAL).astype(np.float64), minlength=cell.size)
                                  / np.bincount(inverse, minlength=cell.size))
        lim = vd.limiting[members]
        failing = (st == FAIL) & (lim >= 0)
        if failing.any():
            n_lim = int(lim[failing].max()) + 1
            counts = np.bincount(inverse[failing] * n_lim + lim[failing], minlength=cell.size * n_lim)
            counts = counts.reshape(cell.size, n_lim)
            has = counts.any(axis=1)
            limiting[row[has], column[has]] = counts[has].argmax(axis=1)
        lst[row, column] = lst_h[members[first]]
        sel[row, column] = sun_el[members[first]]
    return Calendar(tuple(lunas), bin_h, vd.keys, state, open_frac, limiting, lst, sel)


def scan_opportunities(
    scenario: Scenario, provider: HorizonProvider | None = None, *, start_utc: str, end_utc: str,
    spacing_s: float = DEFAULT_SPACING_S, signal_step_s: float = DEFAULT_SIGNAL_STEP_S,
    lookback_h: float = DEFAULT_LOOKBACK_H, calendar_bin_h: float = 6.0, table: BodyFixedEphemeris | None = None,
    horizons: tuple | None = None, context: ScanContext | None = None,
    progress: Callable[[float, str], None] | None = None,
) -> OpportunityScan:
    """Evaluate every landing candidate from `start_utc` to `end_utc` (inclusive) at `spacing_s`.

    `spacing_s` must be a multiple of `signal_step_s`. A prepared `context` (from `build_scan_context`)
    is reused when given. The scenario's own `landing_utc` is ignored; its mission duration, profile,
    constraints, network and site define the evaluation. `progress(fraction, stage)` is called at every stage and
    every `EVAL_CHUNK` candidates (a raising callback cancels the scan)."""
    if signal_step_s <= 0.0 or abs(spacing_s / signal_step_s - round(spacing_s / signal_step_s)) > 1e-9:
        raise ValueError("spacing_s must be a positive multiple of signal_step_s")
    t0, t1 = utc_to_et(start_utc), utc_to_et(end_utc)
    if t1 < t0:
        raise ValueError("end_utc precedes start_utc")
    ctx = context or build_scan_context(
        scenario, provider, t0, t1, signal_step_s=signal_step_s, lookback_h=lookback_h, table=table,
        horizons=horizons, progress=scaled_progress(progress, 0.0, 0.6))
    q = utc_lattice(t0, int(math.floor((t1 - t0) / spacing_s)) + 1, spacing_s)
    q = q[(q >= ctx.analysis.t0) & (q + ctx.mission_s <= ctx.analysis.t1 + 1e-6)]
    ev, vd = ctx.evaluate_chunked(q, progress, 0.6, 0.95)
    lst_all = local_solar_time_h(ctx.scenario.site.lon_deg, ctx.table)
    lattice = np.rint((q - ctx.analysis.t[0]) / (ctx.analysis.t[1] - ctx.analysis.t[0])).astype(np.int64)
    lattice = np.clip(lattice, 0, ctx.analysis.t.size - 1)
    lst = lst_all[lattice]
    sun_el = np.interp(q, ctx.analysis.t, ctx.analysis.sun_el_deg)
    windows = _open_windows(q, vd, spacing_s, vd.keys, ctx.heading_unknown)
    cal = build_calendar(q, vd, lst, sun_el, bin_h=calendar_bin_h)
    prov = dict(ctx.provenance)
    prov["analysis"] = {**prov["analysis"], "kind": "opportunity_scan", "start_utc": start_utc, "end_utc": end_utc,
                        "spacing_s": float(spacing_s), "n_candidates": int(q.size),
                        "soc_evaluated_only_for_candidates_not_failing_other_constraints": True}
    if progress is not None:
        progress(1.0, "done")
    return OpportunityScan(ctx, q, float(spacing_s), ev, vd, windows, cal, lst, sun_el, prov)
