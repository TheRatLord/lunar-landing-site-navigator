"""Battery state of charge under generation and a piecewise-constant load.

Bus power balance at time t: net(t) = generation(t) - load(t). Stored energy E (Wh) evolves as

    dE/dt = eta_c * net     if net > 0   (charging; eta_c = charge efficiency)
    dE/dt = net / eta_d     if net < 0   (discharging; eta_d = discharge efficiency)

clamped to [0, capacity]. Generation is piecewise linear between the supplied samples and the load
piecewise constant, so net(t) is piecewise linear on the merged breakpoints and every segment is
integrated in closed form (E is quadratic in t there). Segments are split at net = 0 and at clamp
and threshold crossings, so energy, minimum state of charge and time below threshold are exact
for the piecewise-linear model (no step-size error); energy conservation is reported explicitly:

    E_end - E_start = eta_c * charged_wh - discharged_wh / eta_d          (battery closure)
    gen_wh - load_wh = charged_wh - discharged_wh + spilled_wh - unserved_wh  (bus closure)

where charged_wh / discharged_wh are bus-side energies accepted / delivered, `spilled_wh` is generation
discarded because the battery is full, and `unserved_wh` is load that could not be met because the battery
is empty (brown-out).

Depth of discharge. `max_dod` is the allowed fraction of capacity that may be drawn; the soft floor is
(1 - max_dod) * capacity. The model keeps discharging below the floor (physically, down to 0) so the
size of a violation is visible; `time_below_threshold_s` (default threshold: the floor) and
`energy_margin_wh` (minimum stored energy minus the floor, negative = violated) report it.
"""

from __future__ import annotations

from dataclasses import dataclass

import numba as nb
import numpy as np


@dataclass(frozen=True, slots=True)
class Battery:
    """Battery parameters. `initial_soc` is a fraction of capacity."""

    capacity_wh: float
    charge_efficiency: float = 0.95
    discharge_efficiency: float = 0.95
    max_dod: float = 0.8
    initial_soc: float = 1.0

    def __post_init__(self) -> None:
        if self.capacity_wh <= 0.0:
            raise ValueError("capacity must be positive")
        if not (0.0 < self.charge_efficiency <= 1.0 and 0.0 < self.discharge_efficiency <= 1.0):
            raise ValueError("efficiencies must lie in (0, 1]")
        if not 0.0 < self.max_dod <= 1.0:
            raise ValueError("max_dod must lie in (0, 1]")
        if not 0.0 <= self.initial_soc <= 1.0:
            raise ValueError("initial_soc must lie in [0, 1]")

    @property
    def floor_wh(self) -> float:
        return (1.0 - self.max_dod) * self.capacity_wh


@dataclass(frozen=True, slots=True)
class LoadProfile:
    """Piecewise-constant load: `power_w[i]` applies on [edges[i], edges[i+1]).

    `outside_w` is the load outside [edges[0], edges[-1]]. It has no default on purpose: if it is None, any
    simulation or lookup that leaves the profile raises instead of silently assuming zero load.
    """

    edges: np.ndarray
    power_w: np.ndarray
    outside_w: float | None = None

    def __post_init__(self) -> None:
        e = np.asarray(self.edges, dtype=np.float64)
        p = np.asarray(self.power_w, dtype=np.float64)
        if e.ndim != 1 or p.shape != (e.size - 1,) or np.any(np.diff(e) <= 0.0):
            raise ValueError("edges must be increasing with len(power_w) + 1 entries")
        if np.any(p < 0.0) or (self.outside_w is not None and self.outside_w < 0.0):
            raise ValueError("loads must be non-negative")
        object.__setattr__(self, "edges", e)
        object.__setattr__(self, "power_w", p)

    @staticmethod
    def constant(power_w: float) -> LoadProfile:
        """A load of `power_w` at all times."""
        return LoadProfile(np.array([-np.inf, np.inf]), np.array([power_w]), power_w)

    def at(self, t: np.ndarray) -> np.ndarray:
        """Load at times `t` (right-continuous at the edges); raises outside the profile if `outside_w` is None."""
        t = np.asarray(t, dtype=np.float64)
        i = np.searchsorted(self.edges, t, side="right") - 1
        inside = (i >= 0) & (i < self.power_w.size)
        if self.outside_w is None:
            if not np.all(inside):
                raise ValueError("load requested outside the profile and LoadProfile.outside_w is not set")
            return self.power_w[i]
        return np.where(inside, self.power_w[np.clip(i, 0, self.power_w.size - 1)], self.outside_w)


@dataclass(frozen=True, slots=True)
class BatteryResult:
    """Outcome of `simulate_battery`. Energies in Wh, times in the input unit (seconds)."""

    t: np.ndarray
    energy_wh: np.ndarray
    soc: np.ndarray
    min_soc: float
    t_min_soc: float
    time_below_threshold_s: float
    energy_margin_wh: float
    charged_wh: float
    discharged_wh: float
    spilled_wh: float
    unserved_wh: float
    generation_wh: float
    load_wh: float
    battery_closure_wh: float
    bus_closure_wh: float


@nb.njit(cache=True)
def _crossing(e0: float, k: float, pa: float, s: float, t_len: float, target: float) -> float:
    """Time in [0, t_len] where E(t) = e0 + k (pa t + s t^2 / 2) first equals `target` (-1 if never)."""
    f0 = e0 - target
    f1 = f0 + k * (pa * t_len + 0.5 * s * t_len * t_len)
    if f0 == 0.0:
        return 0.0
    if f0 * f1 > 0.0:
        return -1.0
    lo, hi = 0.0, t_len
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        fm = f0 + k * (pa * mid + 0.5 * s * mid * mid)
        if fm * f0 > 0.0:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


@nb.njit(cache=True)
def _piece(e0, pa, s, dur, cap, thr, ec, ed, acc):
    """One sign-definite piece (net power pa + s t, t in [0, dur]); updates acc, returns the end energy.

    acc: 0 min E, 1 t_min, 2 time below thr, 3 charged, 4 discharged, 5 spilled, 6 unserved, 7 clock
    (energies in W*s here; converted by the caller).
    """
    pe = pa + s * dur
    charging = (pa + pe) > 0.0
    k = ec if charging else 1.0 / ed
    e1 = e0 + k * (pa * dur + 0.5 * s * dur * dur)
    bus = pa * dur + 0.5 * s * dur * dur
    t_hit = dur
    clamped = False
    if charging and e1 > cap:
        t_hit = _crossing(e0, k, pa, s, dur, cap)
        t_hit = dur if t_hit < 0.0 else t_hit
        clamped = True
    elif (not charging) and e1 < 0.0:
        t_hit = _crossing(e0, k, pa, s, dur, 0.0)
        t_hit = dur if t_hit < 0.0 else t_hit
        clamped = True
    bus_free = pa * t_hit + 0.5 * s * t_hit * t_hit
    e_hit = e0 + k * bus_free
    if clamped:
        e_hit = cap if charging else 0.0
        rest = bus - bus_free
        if charging:
            acc[5] += rest
        else:
            acc[6] += -rest
        e1 = e_hit
    if charging:
        acc[3] += bus_free
    else:
        acc[4] += -bus_free
    t_below = 0.0
    tc = _crossing(e0, k, pa, s, t_hit, thr)
    if e0 < thr and e_hit < thr:
        t_below = dur
    elif e0 < thr:
        t_below = tc if tc >= 0.0 else t_hit
    elif e_hit < thr:
        t_below = dur - (tc if tc >= 0.0 else t_hit)
    acc[2] += t_below
    if e1 < acc[0]:
        acc[0] = e1
        acc[1] = acc[7] + (t_hit if clamped else dur)
    acc[7] += dur
    return e1


@nb.njit(cache=True)
def _advance(e, pa, pb, d, cap, thr, ec, ed, acc):
    """Integrate one merged-grid segment (net power pa -> pb over d seconds); returns the end energy."""
    if pa * pb < 0.0:
        tz = d * pa / (pa - pb)
        s = (pb - pa) / d
        e = _piece(e, pa, s, tz, cap, thr, ec, ed, acc)
        return _piece(e, 0.0, s, d - tz, cap, thr, ec, ed, acc)
    if pa == 0.0 and pb == 0.0:
        acc[7] += d
        if e < thr:
            acc[2] += d
        return e
    return _piece(e, pa, (pb - pa) / d, d, cap, thr, ec, ed, acc)


@nb.njit(cache=True)
def _simulate(gap, gbp, dur, e0, cap, thr, ec, ed):
    n = dur.size
    energy = np.empty(n + 1)
    energy[0] = e0
    acc = np.zeros(8)
    acc[0] = e0
    acc[1] = 0.0
    e = e0
    for i in range(n):
        e = _advance(e, gap[i], gbp[i], dur[i], cap, thr, ec, ed, acc)
        energy[i + 1] = e
    return energy, acc


@nb.njit(cache=True)
def _interp(t, y, x):
    """Scalar `np.interp(x, t, y)` for x inside [t[0], t[-1]]."""
    j = np.searchsorted(t, x, side="right") - 1
    if j >= t.size - 1:
        return y[t.size - 1]
    return y[j] + (y[j + 1] - y[j]) / (t[j + 1] - t[j]) * (x - t[j])


@nb.njit(cache=True, parallel=True)
def _scan(t, gen, edges, power, outside, starts, window, e0, cap, thr, ec, ed):
    """Battery runs over [q, q + window] for every q in `starts` (shared absolute-time load and generation)."""
    out = np.empty((starts.size, 8))
    for i in nb.prange(starts.size):
        q = starts[i]
        end = q + window
        acc = np.zeros(8)
        acc[0] = e0
        e = e0
        j = np.searchsorted(t, q, side="right")
        k = np.searchsorted(edges, q, side="right")
        tc = q
        gc = _interp(t, gen, q)
        while tc < end:
            tn = end
            if j < t.size and t[j] < tn:
                tn = t[j]
            if k < edges.size and edges[k] < tn:
                tn = edges[k]
            gn = _interp(t, gen, tn)
            idx = np.searchsorted(edges, 0.5 * (tc + tn), side="right") - 1
            lp = power[idx] if (idx >= 0 and idx < power.size) else outside
            e = _advance(e, gc - lp, gn - lp, tn - tc, cap, thr, ec, ed, acc)
            while j < t.size and t[j] <= tn:
                j += 1
            while k < edges.size and edges[k] <= tn:
                k += 1
            tc = tn
            gc = gn
        out[i, 0] = acc[0]
        out[i, 1] = acc[1]
        out[i, 2] = acc[2]
        out[i, 3] = acc[3]
        out[i, 4] = acc[4]
        out[i, 5] = acc[5]
        out[i, 6] = acc[6]
        out[i, 7] = e
    return out


def _threshold_fraction(battery: Battery, soc_threshold: float | None) -> float:
    if soc_threshold is None:
        return 1.0 - battery.max_dod
    if not 0.0 <= soc_threshold <= 1.0:
        raise ValueError("soc_threshold must be a state-of-charge fraction in [0, 1]")
    return float(soc_threshold)


def _outside_power(load: LoadProfile, t_first: float, t_last: float) -> float:
    """Load used outside the profile; raises if the span leaves the profile and none was specified."""
    if load.outside_w is not None:
        return float(load.outside_w)
    if t_first < load.edges[0] or t_last > load.edges[-1]:
        raise ValueError(
            f"simulated span [{t_first}, {t_last}] leaves the load profile [{load.edges[0]}, {load.edges[-1]}] "
            "and LoadProfile.outside_w is not set")
    return 0.0


def simulate_battery(
    t: np.ndarray, generation_w: np.ndarray, battery: Battery, load: LoadProfile,
    soc_threshold: float | None = None,
) -> BatteryResult:
    """Integrate battery energy over `t` (seconds). See the module docstring for the model.

    Args:
        t: strictly increasing sample times (seconds).
        generation_w: array output (W) at `t`, linearly interpolated between samples.
        battery: capacity, efficiencies, depth-of-discharge limit, initial state.
        load: piecewise-constant load; edges inside (t[0], t[-1]) become integration breakpoints.
        soc_threshold: state-of-charge fraction for `time_below_threshold_s`; default is the
            depth-of-discharge floor `1 - max_dod`.
    """
    t = np.asarray(t, dtype=np.float64)
    gen = np.asarray(generation_w, dtype=np.float64)
    if t.ndim != 1 or gen.shape != t.shape or t.size < 2 or np.any(np.diff(t) <= 0.0):
        raise ValueError("t must be strictly increasing with at least 2 samples, one generation value each")
    if np.any(gen < 0.0) or not np.all(np.isfinite(gen)):
        raise ValueError("generation must be finite and non-negative")
    _outside_power(load, float(t[0]), float(t[-1]))
    inner = load.edges[(load.edges > t[0]) & (load.edges < t[-1])]
    grid = np.unique(np.concatenate([t, inner]))
    g = np.interp(grid, t, gen)
    mid = 0.5 * (grid[:-1] + grid[1:])
    lp = load.at(mid)
    gap = g[:-1] - lp
    gbp = g[1:] - lp
    dur = np.diff(grid)
    cap = battery.capacity_wh * 3600.0
    thr_frac = _threshold_fraction(battery, soc_threshold)
    energy, acc = _simulate(
        gap, gbp, dur, battery.initial_soc * cap, cap, thr_frac * cap,
        battery.charge_efficiency, battery.discharge_efficiency)
    wh = 1.0 / 3600.0
    e_wh = energy * wh
    charged, discharged, spilled, unserved = acc[3] * wh, acc[4] * wh, acc[5] * wh, acc[6] * wh
    gen_wh = float(np.sum(0.5 * (g[:-1] + g[1:]) * dur)) * wh
    load_wh = float(np.sum(lp * dur)) * wh
    closure = e_wh[-1] - e_wh[0] - (battery.charge_efficiency * charged - discharged / battery.discharge_efficiency)
    bus = (gen_wh - load_wh) - (charged - discharged + spilled - unserved)
    return BatteryResult(
        t=grid, energy_wh=e_wh, soc=e_wh / battery.capacity_wh, min_soc=acc[0] * wh / battery.capacity_wh,
        t_min_soc=float(grid[0] + acc[1]), time_below_threshold_s=float(acc[2]),
        energy_margin_wh=acc[0] * wh - battery.floor_wh, charged_wh=charged, discharged_wh=discharged,
        spilled_wh=spilled, unserved_wh=unserved, generation_wh=gen_wh, load_wh=load_wh,
        battery_closure_wh=float(closure), bus_closure_wh=float(bus))


@dataclass(frozen=True, slots=True)
class BatteryScan:
    """Per-start summaries from `simulate_battery_scan` (one entry per start epoch). Energies in Wh."""

    starts: np.ndarray
    min_soc: np.ndarray
    t_min_soc: np.ndarray
    time_below_threshold_s: np.ndarray
    energy_margin_wh: np.ndarray
    final_soc: np.ndarray
    charged_wh: np.ndarray
    discharged_wh: np.ndarray
    spilled_wh: np.ndarray
    unserved_wh: np.ndarray


def simulate_battery_scan(
    t: np.ndarray, generation_w: np.ndarray, battery: Battery, load: LoadProfile,
    starts: np.ndarray, window_s: float, soc_threshold: float | None = None,
) -> BatteryScan:
    """Run the `simulate_battery` physics over [q, q + window_s] for every candidate start q, in parallel.

    Equivalent, entry by entry, to calling `simulate_battery` with sample times
    `[q, t strictly inside (q, q + window_s), q + window_s]`, generation linearly interpolated from the shared
    series at those times, the same absolute-time `load` and the same `battery` (each run starts from
    `battery.initial_soc`). Only the summary quantities are returned (no energy time series, no closure
    residuals). Every window must lie inside [t[0], t[-1]].
    """
    t = np.asarray(t, dtype=np.float64)
    gen = np.asarray(generation_w, dtype=np.float64)
    q = np.ascontiguousarray(np.atleast_1d(starts), dtype=np.float64)
    if t.ndim != 1 or gen.shape != t.shape or t.size < 2 or np.any(np.diff(t) <= 0.0):
        raise ValueError("t must be strictly increasing with at least 2 samples, one generation value each")
    if np.any(gen < 0.0) or not np.all(np.isfinite(gen)):
        raise ValueError("generation must be finite and non-negative")
    if not window_s > 0.0:
        raise ValueError("window_s must be positive")
    if q.ndim != 1 or not np.all(np.isfinite(q)) or (q.size and (q.min() < t[0] or q.max() + window_s > t[-1])):
        raise ValueError("every start window must be finite and lie inside the generation series")
    cap = battery.capacity_wh * 3600.0
    thr_frac = _threshold_fraction(battery, soc_threshold)
    outside = _outside_power(load, float(q.min()) if q.size else t[0], float(q.max()) + window_s if q.size else t[0])
    raw = _scan(t, gen, load.edges, load.power_w, outside, q, float(window_s),
                battery.initial_soc * cap, cap, thr_frac * cap,
                battery.charge_efficiency, battery.discharge_efficiency)
    wh = 1.0 / 3600.0
    return BatteryScan(
        starts=q, min_soc=raw[:, 0] * wh / battery.capacity_wh, t_min_soc=q + raw[:, 1],
        time_below_threshold_s=raw[:, 2], energy_margin_wh=raw[:, 0] * wh - battery.floor_wh,
        final_soc=raw[:, 7] * wh / battery.capacity_wh, charged_wh=raw[:, 3] * wh,
        discharged_wh=raw[:, 4] * wh, spilled_wh=raw[:, 5] * wh, unserved_wh=raw[:, 6] * wh)


@dataclass(frozen=True, slots=True)
class DarkSpanSurvival:
    """Result of `dark_span_survival`."""

    survives: bool
    """True if stored energy stays at or above the depth-of-discharge floor for the whole span."""
    min_soc: float
    time_to_floor_s: float
    """Time from the span start until the floor is reached; `inf` if never."""
    time_to_empty_s: float
    """Time until the battery is empty; `inf` if never."""


def dark_span_survival(
    battery: Battery, load: LoadProfile, duration_s: float, start_soc: float | None = None,
    generation_w: float = 0.0, t_start: float = 0.0,
) -> DarkSpanSurvival:
    """Can the battery carry the load through a dark span of `duration_s` seconds starting at `t_start`?

    `generation_w` is a constant residual generation (0 for a full eclipse or terrain shadow).
    `start_soc` defaults to `battery.initial_soc` (never more optimistic than a full battery, so the survival
    verdict is not flattered by an unstated assumption); pass `start_soc=1.0` for the fully charged case.
    """
    b = battery if start_soc is None else Battery(
        battery.capacity_wh, battery.charge_efficiency, battery.discharge_efficiency, battery.max_dod, start_soc)
    t = np.array([t_start, t_start + duration_s])
    res = simulate_battery(t, np.full(2, generation_w), b, load)
    def reached(level_wh: float) -> float:
        if res.min_soc * b.capacity_wh > level_wh + 1e-9:
            return float("inf")
        lo, hi = 0.0, duration_s
        for _ in range(60):
            mid = 0.5 * (lo + hi)
            r = simulate_battery(np.array([t_start, t_start + mid]), np.full(2, generation_w), b, load)
            if r.min_soc * b.capacity_wh <= level_wh + 1e-9:
                hi = mid
            else:
                lo = mid
        return 0.5 * (lo + hi)

    return DarkSpanSurvival(
        survives=bool(res.energy_margin_wh >= -1e-9), min_soc=res.min_soc,
        time_to_floor_s=reached(battery.floor_wh), time_to_empty_s=reached(0.0))
