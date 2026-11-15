"""Constraint values and verdicts for arbitrary arrays of landing epochs.

The same functions serve a single-site evaluation (one epoch) and the opportunity and slip scans
(10^4 to 10^5 epochs): every quantity is a vectorised query on pre-computed windows and sample arrays
(`windows.py`), so a scan is a few array operations rather than one evaluation per epoch.

Each constraint value is computed in three horizon *worlds* (nominal, optimistic, pessimistic; see
`signals.WORLDS`). Verdict rule: PASS if the limit holds in all three worlds, MARGINAL if it holds in
the nominal world only, FAIL if it fails in the nominal world (NaN values fail). The overall state is
the minimum over the known constraints; a constraint whose input is unavailable (slope without terrain)
is UNKNOWN and excluded from the overall state.
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass, field

import numpy as np

from lunarnav.visibility import (
    Battery,
    BatteryResult,
    BoundedSignal,
    LoadProfile,
    simulate_battery,
    simulate_battery_scan,
)

from .models import CONSTRAINT_KEYS, BatterySpec, Constraints, LoadSpec
from .signals import WORLDS, PowerSignals, SiteSignals, thread_budget
from .windows import SparseTable, WindowSet

FAIL, MARGINAL, PASS, UNKNOWN = 0, 1, 2, -1
STATE_NAMES = {FAIL: "fail", MARGINAL: "marginal", PASS: "pass", UNKNOWN: "unknown"}
HOUR_S = 3600.0
SCAN_EPOCHS_PER_THREAD = 1000

MARGIN_KINDS = ("worst_case", "nominal", "best_case")
TOTAL_KEYS = {"sunlit_h": "min_total_sunlit_h", "contact_h": "min_total_contact_h", "sunlit_contact_h": "min_total_sunlit_contact_h"}
RANK_BY = ("margin", *TOTAL_KEYS)
BEST_CASE_NOTE = ("no nominal: the lander heading is unknown; this is the margin at the upper bound over headings (the best heading "
                  "at each instant on the lowered horizon; no single heading achieves it), so every real heading does worse")


def margin_kind(state: str | None, margin: float | None, *, no_nominal: bool = False) -> str | None:
    """Which case a single normalised margin belongs to, by the rule of `Verdicts.worst_margin`: the pessimistic case
    (`"worst_case"`), except that a failing epoch reports the nominal case (`"nominal"`). Where the limiting constraint has no nominal
    (`no_nominal`: the minimum state of charge with an unknown lander heading), the failing epoch's margin is the one at the most
    favourable heading (`"best_case"`, see `BEST_CASE_NOTE`: the upper bound over headings). None without a finite margin or a state. `state` is a state name in any
    letter case."""
    if state is None or margin is None or not math.isfinite(margin):
        return None
    if state.lower() != STATE_NAMES[FAIL]:
        return "worst_case"
    return "best_case" if no_nominal else "nominal"


def margin_note(kind: str | None) -> str | None:
    """The sentence that goes with a margin kind that needs one (`best_case`); None otherwise."""
    return BEST_CASE_NOTE if kind == "best_case" else None


def has_no_nominal_margin(limiting: str | None, heading_unknown: bool) -> bool:
    """The margin of a point limited by `limiting` has no nominal case: the minimum state of charge with an unknown heading."""
    return heading_unknown and limiting == "min_state_of_charge"


def fractions(counts: dict[str, int], total: int | None = None) -> dict[str, float | None]:
    """Each count divided by `total` (default: their sum); None for every key when that total is zero."""
    n = sum(counts.values()) if total is None else total
    return {k: (v / n if n else None) for k, v in counts.items()}


@dataclass(frozen=True, slots=True)
class WorldWindows:
    """Windows of one horizon world over the data span."""

    sunlit: WindowSet
    dark: WindowSet
    contact: WindowSet
    gap: WindowSet
    both: WindowSet


@dataclass(frozen=True, slots=True)
class Analysis:
    """Everything the epoch queries need, for one site on one time grid."""

    t: np.ndarray
    sun_el_deg: np.ndarray
    contact_clearance: BoundedSignal
    link_margin_db: np.ndarray | None
    sunlight: BoundedSignal
    sunlit_threshold: float
    worlds: tuple[WorldWindows, WorldWindows, WorldWindows]
    power: PowerSignals | None

    @property
    def t0(self) -> float:
        return float(self.t[0])

    @property
    def t1(self) -> float:
        return float(self.t[-1])


def build_analysis(sig: SiteSignals, constraints: Constraints, power: PowerSignals | None) -> Analysis:
    """Windows for the three worlds from site signals."""
    thr = constraints.sunlit_flux_fraction.value
    t = sig.et
    worlds = []
    for b in WORLDS:
        sunlit = WindowSet.from_signal(t, getattr(sig.sunlight, b), thr)
        contact = WindowSet.from_signal(t, getattr(sig.contact, b), 0.0)
        worlds.append(WorldWindows(sunlit, sunlit.complement(), contact, contact.complement(), sunlit.intersection(contact)))
    return Analysis(t, sig.sun_el_deg, sig.contact, sig.link_margin_db, sig.sunlight, float(thr),
                    (worlds[0], worlds[1], worlds[2]), power)


@dataclass(frozen=True, slots=True)
class EpochValues:
    """Constraint values for `n` epochs. `values[key]` has shape (3, n) (worlds nominal/optimistic/
    pessimistic); `censored[key]` flags epochs whose nominal value is a bound because the data end."""

    values: dict[str, np.ndarray]
    censored: dict[str, np.ndarray]
    n: int
    skipped: dict[str, np.ndarray] = field(default_factory=dict)
    """Per key, epochs where the value was deliberately not computed (NaN); their verdict is UNKNOWN."""


def _hours_after_sunrise(ws: WindowSet, q: np.ndarray, t_end: float) -> tuple[np.ndarray, np.ndarray]:
    """Hours since the current sunrise (>= 0 when sunlit) or minus the hours to the next one (< 0).

    The second output flags values that are bounds: a sunlit window that begins at the data start, or
    a dark epoch with no further sunrise in the data (then the value is minus the time to the data end).
    """
    n = len(ws)
    if n == 0:
        return -(t_end - q) / HOUR_S, np.ones(q.shape, dtype=bool)
    i = ws.index_containing(q)
    inside = i >= 0
    safe = np.clip(i, 0, None)
    j = np.searchsorted(ws.starts, q, side="right")
    has_next = j < n
    nxt = np.where(has_next, ws.starts[np.clip(j, 0, n - 1)], t_end)
    val = np.where(inside, q - ws.starts[safe], -(nxt - q)) / HOUR_S
    return val, np.where(inside, ws.start_cens[safe], ~has_next)


def _sunlit_hours_after(ws: WindowSet, q: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    if not len(ws):
        return np.zeros(q.shape), np.zeros(q.shape, dtype=bool)
    i = ws.index_containing(q)
    safe = np.clip(i, 0, None)
    inside = i >= 0
    return np.where(inside, (ws.ends[safe] - q) / HOUR_S, 0.0), inside & ws.end_cens[safe]


def _min_link_margin(an: Analysis, q: np.ndarray, d_s: float) -> np.ndarray:
    lm = an.link_margin_db
    if lm is None:
        return np.full(q.shape, np.nan)
    neg = np.where(np.isfinite(lm), -lm, -np.inf)
    table = SparseTable(neg)
    lo = np.searchsorted(an.t, q, side="left")
    hi = np.searchsorted(an.t, q + d_s, side="right") - 1
    best = table.query(lo, hi)
    return np.where(np.isfinite(best), -best, np.nan)


def simulate_window(
    t: np.ndarray, gen: np.ndarray, sunlit: WindowSet, q: float, d_s: float, battery: BatterySpec, loads: LoadSpec
) -> BatteryResult:
    """Battery simulation over [q, q + d_s] with generation `gen` on `t` and the load switching between
    `sunlit_w` and `dark_w` on the `sunlit` windows."""
    lo = np.searchsorted(t, q, side="right")
    hi = np.searchsorted(t, q + d_s, side="left")
    ts = np.concatenate([[q], t[lo:hi], [q + d_s]])
    g = np.interp(ts, t, gen)
    inner = np.concatenate([sunlit.starts, sunlit.ends])
    inner = np.unique(inner[(inner > q) & (inner < q + d_s)])
    edges = np.concatenate([[q], inner, [q + d_s]])
    mid = 0.5 * (edges[:-1] + edges[1:])
    p = np.where(sunlit.contains(mid), loads.sunlit_w, loads.dark_w)
    return simulate_battery(ts, g, _battery(battery), LoadProfile(edges, p, loads.dark_w))


def _battery(spec: BatterySpec) -> Battery:
    return Battery(spec.capacity_wh, spec.charge_efficiency, spec.discharge_efficiency, spec.max_dod, spec.initial_soc)


def _sunlit_load_profile(sunlit: WindowSet, loads: LoadSpec) -> LoadProfile:
    if not len(sunlit):
        return LoadProfile.constant(loads.dark_w)
    edges = np.unique(np.concatenate([sunlit.starts, sunlit.ends]))
    mid = 0.5 * (edges[:-1] + edges[1:])
    power = np.where(sunlit.contains(mid), loads.sunlit_w, loads.dark_w)
    return LoadProfile(edges, power, loads.dark_w)


def min_soc_values(
    an: Analysis, q: np.ndarray, d_s: float, battery: BatterySpec, loads: LoadSpec, only: np.ndarray | None = None
) -> np.ndarray:
    """Minimum state of charge over [q, q + D] per world, shape (3, n); NaN where `only` is False.

    Generation per world is `Analysis.power`; the load switches between `sunlit_w` and `dark_w` on the
    nominal sunlit windows in every world."""
    if an.power is None:
        raise ValueError("min_state_of_charge needs array power signals")
    vp = an.power.verdict_power_w
    idx = np.arange(q.size) if only is None else np.flatnonzero(only)
    sunlit = an.worlds[0].sunlit
    out = np.full((3, q.size), np.nan)
    if idx.size == 0:
        return out
    bat = _battery(battery)
    load = _sunlit_load_profile(sunlit, loads)
    inside = q[idx] + d_s <= an.t[-1]
    fast, slow = idx[inside], idx[~inside]
    for w, gen in enumerate((vp.nominal, vp.optimistic, vp.pessimistic)):
        if fast.size:
            with thread_budget(fast.size, SCAN_EPOCHS_PER_THREAD):
                out[w, fast] = simulate_battery_scan(an.t, gen, bat, load, q[fast], d_s).min_soc
        for k in slow:
            out[w, k] = simulate_window(an.t, gen, sunlit, float(q[k]), d_s, battery, loads).min_soc
    return out


def epoch_values(
    an: Analysis, q: np.ndarray, d_s: float, keys: Iterable[str], *,
    battery: BatterySpec | None = None, loads: LoadSpec | None = None, slope_deg: float | None = None,
    skip_failed_with: Constraints | None = None,
) -> EpochValues:
    """Values of the constraint quantities `keys` (see `CONSTRAINT_KEYS`) at landing epochs `q` (ET s)
    for a mission of `d_s` seconds.

    `q + d_s` must not exceed the data end. When `skip_failed_with` (the constraint set) is given, the
    state-of-charge simulation runs only for epochs that do not already fail another of its constraints
    (the others get NaN, which a verdict treats as a failure); it is the cost control of the long scans.
    """
    q = np.asarray(q, dtype=np.float64)
    if q.size and (q.min() < an.t0 or q.max() + d_s > an.t1 + 1e-6):
        raise ValueError("epochs plus mission duration must lie inside the analysis span")
    keys = tuple(keys)
    n = q.size
    values: dict[str, np.ndarray] = {}
    censored: dict[str, np.ndarray] = {}
    no = np.zeros(n, dtype=bool)
    skipped: dict[str, np.ndarray] = {}

    def put(key: str, rows: list[np.ndarray], cens: np.ndarray = no) -> None:
        values[key] = np.vstack(rows)
        censored[key] = cens

    sun_el = np.interp(q, an.t, an.sun_el_deg)
    for key in keys:
        if key == "landing_sun_elevation_deg":
            put(key, [sun_el, sun_el, sun_el])
        elif key == "landing_hours_after_sunrise":
            res = [_hours_after_sunrise(w.sunlit, q, an.t1) for w in an.worlds]
            put(key, [r[0] for r in res], res[0][1])
        elif key == "dte_at_landing_deg":
            put(key, [np.interp(q, an.t, getattr(an.contact_clearance, b)) for b in WORLDS])
        elif key == "min_sunlit_hours_after_landing":
            res = [_sunlit_hours_after(w.sunlit, q) for w in an.worlds]
            put(key, [r[0] for r in res], res[0][1])
        elif key == "max_dark_span_h":
            put(key, [w.dark.longest_overlap(q, q + d_s) / HOUR_S for w in an.worlds])
        elif key == "min_total_sunlit_h":
            put(key, [w.sunlit.covered(q, q + d_s) / HOUR_S for w in an.worlds])
        elif key == "min_total_contact_h":
            put(key, [w.contact.covered(q, q + d_s) / HOUR_S for w in an.worlds])
        elif key == "min_total_sunlit_contact_h":
            put(key, [w.both.covered(q, q + d_s) / HOUR_S for w in an.worlds])
        elif key == "min_contact_fraction":
            put(key, [w.contact.covered(q, q + d_s) / d_s for w in an.worlds])
        elif key == "max_contact_gap_h":
            put(key, [w.gap.longest_overlap(q, q + d_s) / HOUR_S for w in an.worlds])
        elif key == "min_link_margin_db":
            lm = _min_link_margin(an, q, d_s)
            put(key, [lm, lm, lm])
        elif key == "max_slope_deg":
            v = np.full(n, np.nan if slope_deg is None else slope_deg)
            put(key, [v, v, v])
    if "min_state_of_charge" in keys:
        if battery is None or loads is None:
            raise ValueError("battery and loads are required for min_state_of_charge")
        only = None
        if skip_failed_with is not None and values:
            only = judge(EpochValues(values, censored, n), skip_failed_with).state != FAIL
        put("min_state_of_charge", list(min_soc_values(an, q, d_s, battery, loads, only)))
        if only is not None:
            skipped["min_state_of_charge"] = ~only
    ordered = {k: values[k] for k in CONSTRAINT_KEYS if k in values}
    return EpochValues(ordered, {k: censored[k] for k in ordered}, n, skipped)


def mission_totals(an: Analysis, q: np.ndarray, d_s: float) -> dict[str, np.ndarray]:
    ev = epoch_values(an, q, d_s, TOTAL_KEYS.values())
    return {name: ev.values[key][0] for name, key in TOTAL_KEYS.items()}


def rank_key(state: np.ndarray, worst_margin: np.ndarray, totals: dict[str, np.ndarray], rank_by: str) -> np.ndarray:
    if rank_by not in RANK_BY:
        raise ValueError(f"rank_by must be one of {RANK_BY}, got {rank_by!r}")
    margin = np.nan_to_num(worst_margin, nan=-1.0e5, posinf=1.0e5, neginf=-1.0e5)
    if rank_by == "margin":
        return state.astype(np.float64) * 1.0e6 + margin
    hours = np.round(np.nan_to_num(totals[rank_by], nan=-1.0), 2)
    return state.astype(np.float64) * 1.0e6 + hours + 1.0e-4 * np.clip(margin, -40.0, 40.0)


@dataclass(frozen=True, slots=True)
class Verdicts:
    """Verdicts for `n` epochs. `margin[key]` has shape (3, n) in the constraint's unit."""

    keys: tuple[str, ...]
    state: np.ndarray
    """Overall state per epoch (FAIL/MARGINAL/PASS); PASS when no constraint is active."""
    per_constraint: dict[str, np.ndarray]
    margin: dict[str, np.ndarray]
    limiting: np.ndarray
    """Index into `keys` of the limiting constraint per epoch (-1 without constraints)."""
    worst_margin: np.ndarray
    """Normalised (margin / margin_scale, dimensionless) margin of the limiting constraint: the pessimistic case, except nominal for a FAIL epoch. Never the nominal margin of a passing epoch."""
    extra: dict = field(default_factory=dict)


def judge(ev: EpochValues, constraints: Constraints) -> Verdicts:
    """Apply the three-state rule to epoch values (see module doc)."""
    active = constraints.active()
    keys = tuple(k for k in active if k in ev.values)
    n = ev.n
    per: dict[str, np.ndarray] = {}
    margins: dict[str, np.ndarray] = {}
    for k in keys:
        m = active[k].margin(ev.values[k])
        margins[k] = m
        ok = m >= 0.0
        per[k] = np.where(ok.all(axis=0), PASS, np.where(ok[0], MARGINAL, FAIL)).astype(np.int8)
        if k == "max_slope_deg" and np.all(np.isnan(ev.values[k])):
            per[k] = np.full(n, UNKNOWN, dtype=np.int8)
        if k in ev.skipped:
            per[k] = np.where(ev.skipped[k], UNKNOWN, per[k]).astype(np.int8)
    known = [np.where(per[k] == UNKNOWN, PASS, per[k]) for k in keys]
    state = np.minimum.reduce(known) if known else np.full(n, PASS, dtype=np.int8)
    limiting = np.full(n, -1, dtype=np.int64)
    worst = np.full(n, np.inf)
    if keys:
        norm = np.empty((len(keys), n))
        for r, k in enumerate(keys):
            scale = active[k].margin_scale
            nominal = np.nan_to_num(margins[k][0], nan=-np.inf)
            across = np.nan_to_num(margins[k].min(axis=0), nan=-np.inf)
            val = np.where(state == FAIL, nominal, across) / scale
            norm[r] = np.where(per[k] == UNKNOWN, np.inf, val)
        limiting = np.argmin(norm, axis=0)
        worst = norm[limiting, np.arange(n)]
    return Verdicts(keys, state.astype(np.int8), per, margins, limiting, worst)
