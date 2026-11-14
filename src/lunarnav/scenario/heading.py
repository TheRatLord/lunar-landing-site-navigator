"""Lander heading: what a case is, and what the planner can act on.

A *case* (world) of the product is two bounds taken together: the **horizon bound** (terrain-error widening of the
horizon) and the **heading bound** (the lander heading is unknown, or known only to `yaw_uncertainty_deg`). A quantity
that depends on array power (the battery state of charge) can move because of either; the other quantities (dark span,
contact gap, sunlit hours) move with the horizon only.

`HeadingAnalysis` reports, for the minimum state of charge:

* whether the heading is stated (planner input, or a catalogue value with a source) or unknown, and then that **no
  nominal heading exists**: the nominal case is the mean over headings, flagged `nominal_basis`;
* the battery simulated at each evaluated heading as one physical constant heading (nominal horizon), the best and the
  worst heading with their angles, and the arcs of headings over which the constraint passes;
* the state-of-charge minimum under the full bound, under the heading bound alone and under the horizon bound alone, and the
  `cause` that follows: `heading`, `terrain`, `both` or `none`.

Passing arcs are reported at the grid of evaluated headings (10 degrees when the heading is unknown): an arc runs
clockwise from `from_deg` to `to_deg` (inclusive of those sampled headings; `from_deg` > `to_deg` wraps through north).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from .engine import simulate_window
from .models import Constraints, LanderProfile
from .signals import PowerSignals

CAUSE_TOLERANCE = 1e-6
"""Smallest state-of-charge spread (fraction) counted as a movement."""
POWER_CONSTRAINTS = ("min_state_of_charge",)
"""Constraints whose value depends on array power, hence on heading."""


REFINE_RESOLUTION_DEG = 1.0
"""Arc boundaries are located to this width by bisection between adjacent grid headings."""


def _bisect(good: float, bad: float, holds: Callable[[float], bool]) -> float:
    """Heading at the `good` side of the boundary between `good` (holds) and `bad` (does not), to `REFINE_RESOLUTION_DEG`.
    Whole-degree ends stay whole degrees (10 -> 5 -> 2 or 3 -> 1)."""
    while abs(good - bad) > REFINE_RESOLUTION_DEG + 1e-9:
        mid = (good + bad) / 2.0
        if float(good).is_integer() and float(bad).is_integer():
            mid = float(int(mid))
        if holds(mid % 360.0):
            good = mid
        else:
            bad = mid
    return good


def _arcs(ok: np.ndarray, yaws: np.ndarray, circular: bool, holds: Callable[[float], bool]) -> list[tuple[float, float]]:
    """Maximal runs of True in `ok` as (from_deg, to_deg), each boundary refined by bisection against `holds`.

    A circular grid may wrap (from > to). Ends of a non-circular range are the first / last sampled heading."""
    n = len(ok)
    if not ok.any():
        return []
    if ok.all():
        return [(float(yaws[0]), float(yaws[-1]))]
    start = 0
    if circular and ok[0] and ok[-1]:
        start = int(np.flatnonzero(~ok)[0])
    order = [(start + i) % n for i in range(n)] if circular else list(range(n))
    runs, cur = [], []
    for i in order:
        if ok[i]:
            cur.append(i)
        elif cur:
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    step = 360.0 / n if circular else (float(yaws[1] - yaws[0]) if n > 1 else 0.0)
    out = []
    for r in runs:
        first, last = float(yaws[r[0]]), float(yaws[r[-1]])
        if circular:
            lo = _bisect(first, first - step, holds)
        elif r[0] > 0:
            lo = _bisect(first, float(yaws[r[0] - 1]), holds)
        else:
            lo = first
        if circular or r[-1] < n - 1:
            nxt = last + step if circular else float(yaws[r[-1] + 1])
            hi = _bisect(last, nxt, holds)
        else:
            hi = last
        out.append((lo % 360.0 if circular else lo, hi % 360.0 if circular else hi))
    return out


@dataclass(frozen=True, slots=True)
class HeadingConstraint:
    """One power-dependent constraint evaluated at every heading."""

    key: str
    unit: str
    limit_min: float | None
    values_by_heading: tuple[float, ...]
    """The constraint value (nominal horizon) at each evaluated heading, same order as `HeadingAnalysis.yaws_deg`."""
    passing_deg: tuple[tuple[float, float], ...]
    """Arcs of headings over which the constraint passes, (from_deg, to_deg) clockwise, wrapping through north if from > to.
    Each boundary is located to `resolution_deg` by bisection between adjacent evaluated headings."""
    all_pass: bool
    none_pass: bool

    def to_dict(self) -> dict:
        return {"key": self.key, "unit": self.unit, "limit_min": self.limit_min,
                "values_by_heading": list(self.values_by_heading), "passing_deg": [list(a) for a in self.passing_deg],
                "all_pass": self.all_pass, "none_pass": self.none_pass}


@dataclass(frozen=True, slots=True)
class HeadingAnalysis:
    """Heading state and its effect on the power-dependent results (see the module doc)."""

    known: bool
    """The heading is stated by the planner or the catalogue. False: unknown, no nominal heading exists."""
    nominal_yaw_deg: float | None
    nominal_basis: str
    uncertainty_deg: float
    """Stated heading's uncertainty either side (0 when unknown: all headings are evaluated)."""
    depends: bool
    """Array power differs between headings at some instant. False: heading is irrelevant for this lander and site."""
    yaws_deg: tuple[float, ...]
    best_yaw_deg: float | None
    worst_yaw_deg: float | None
    worst_arc_deg: tuple[tuple[float, float], ...]
    """Arcs of headings that tie the worst minimum state of charge (to 1e-9), (from_deg, to_deg) clockwise, to
    `REFINE_RESOLUTION_DEG`. `worst_yaw_deg` is the first evaluated heading of the first arc; when the worst value is an
    isolated minimum the arc is a single point."""
    """Heading with the highest / lowest minimum state of charge on the nominal horizon (None when heading is irrelevant)."""
    constraints: tuple[HeadingConstraint, ...]
    soc_min_total: tuple[float, float] | None
    """(pessimistic, optimistic) minimum state of charge under the full bound."""
    soc_min_heading_only: tuple[float, float] | None
    soc_min_horizon_only: tuple[float, float] | None
    cause: str
    """`heading`, `terrain`, `both` or `none`: which bound moved the minimum state of charge."""

    @property
    def unknown_and_matters(self) -> bool:
        return (not self.known) and self.depends

    def __getitem__(self, key: str) -> HeadingConstraint:
        for c in self.constraints:
            if c.key == key:
                return c
        raise KeyError(key)

    def to_dict(self) -> dict:
        return {"known": self.known, "nominal_yaw_deg": self.nominal_yaw_deg, "nominal_basis": self.nominal_basis,
                "uncertainty_deg": self.uncertainty_deg, "depends": self.depends, "yaws_deg": list(self.yaws_deg),
                "best_yaw_deg": self.best_yaw_deg, "worst_yaw_deg": self.worst_yaw_deg,
                "worst_arc_deg": [list(a) for a in self.worst_arc_deg],
                "constraints": [c.to_dict() for c in self.constraints],
                "soc_min_total": None if self.soc_min_total is None else list(self.soc_min_total),
                "soc_min_heading_only": None if self.soc_min_heading_only is None else list(self.soc_min_heading_only),
                "soc_min_horizon_only": None if self.soc_min_horizon_only is None else list(self.soc_min_horizon_only),
                "cause": self.cause}


def classify_cause(total: tuple[float, float], heading_only: tuple[float, float], horizon_only: tuple[float, float]) -> str:
    """Which bound moved a quantity, from its (low, high) range under the full, heading-only and horizon-only bounds."""
    w_t = total[1] - total[0]
    w_h = heading_only[1] - heading_only[0]
    w_z = horizon_only[1] - horizon_only[0]
    if w_t <= CAUSE_TOLERANCE:
        return "none"
    moved_h, moved_z = w_h > CAUSE_TOLERANCE, w_z > CAUSE_TOLERANCE
    if moved_h and moved_z:
        return "both"
    if moved_h:
        return "heading"
    if moved_z:
        return "terrain"
    return "both"


def _soc_min(t, gen, sunlit, q, d_s, profile: LanderProfile) -> float:
    return float(np.min(simulate_window(t, gen, sunlit, q, d_s, profile.battery, profile.loads).soc))


def analyse_heading(power: PowerSignals, profile: LanderProfile, constraints: Constraints, t: np.ndarray, sunlit, q: float,
                    d_s: float, soc: dict[str, np.ndarray]) -> HeadingAnalysis:
    """Per-heading state-of-charge scan and the heading/terrain split of the minimum state of charge.

    `soc` is the evaluation's per-world state of charge (nominal, optimistic, pessimistic); `sunlit` the nominal sunlit
    windows. The scan runs only when the heading matters (power differs between headings)."""
    att = profile.attitude
    yaws = power.yaw_deg
    active = constraints.active()
    lim = active.get("min_state_of_charge")
    nominal_basis = ("stated heading" if att.heading_known else
                     "mean over all evaluated headings: the heading is unknown, so this is not an expected outcome")
    if not power.heading_depends:
        nominal_basis = "heading-independent array: every heading gives the same power"
    total = (float(np.nanmin(soc["pessimistic"])), float(np.nanmin(soc["optimistic"])))
    cons: list[HeadingConstraint] = []
    best = worst = None
    worst_arc: tuple[tuple[float, float], ...] = ()
    h_only = z_only = None
    cause = "terrain" if total[1] - total[0] > CAUSE_TOLERANCE else "none"
    if power.heading_depends:
        vals = np.array([_soc_min(t, row, sunlit, q, d_s, profile) for row in power.yaw_power_w])
        best, worst = float(yaws[int(np.argmax(vals))]), float(yaws[int(np.argmin(vals))])
        circular = (not att.heading_known) or att.yaw_uncertainty_deg >= 180.0

        def soc_at(y: float) -> float:
            return _soc_min(t, power.power_at_yaw(y), sunlit, q, d_s, profile)

        tie = vals <= float(vals.min()) + 1e-9
        worst_arc = tuple(_arcs(tie, yaws, circular, lambda y: soc_at(y) <= float(vals.min()) + 1e-9))
        if lim is not None and lim.min is not None:
            ok = vals >= lim.min
            cons.append(HeadingConstraint("min_state_of_charge", lim.unit, lim.min, tuple(float(v) for v in vals),
                                          tuple(_arcs(ok, yaws, circular, lambda y: soc_at(y) >= lim.min)),
                                          bool(ok.all()), bool(not ok.any())))
        ho = (power.heading_only.pessimistic, power.heading_only.optimistic)
        zo = (power.horizon_only.pessimistic, power.horizon_only.optimistic)
        h_only = tuple(_soc_min(t, g, sunlit, q, d_s, profile) for g in ho)
        z_only = tuple(_soc_min(t, g, sunlit, q, d_s, profile) for g in zo)
        cause = classify_cause(total, h_only, z_only)
    return HeadingAnalysis(
        known=att.heading_known, nominal_yaw_deg=att.yaw_deg, nominal_basis=nominal_basis,
        uncertainty_deg=att.yaw_uncertainty_deg if att.heading_known else 0.0, depends=power.heading_depends,
        yaws_deg=tuple(float(y) for y in yaws), best_yaw_deg=best, worst_yaw_deg=worst, worst_arc_deg=worst_arc, constraints=tuple(cons),
        soc_min_total=total, soc_min_heading_only=h_only, soc_min_horizon_only=z_only, cause=cause)
