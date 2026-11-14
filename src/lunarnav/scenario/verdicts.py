"""Verdict records: per-constraint value, limit, signed margin, unit, state; and the overall verdict."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field, replace

import numpy as np

from .engine import STATE_NAMES, EpochValues, Verdicts
from .heading import REFINE_RESOLUTION_DEG
from .models import Constraints, Limit
from .signals import WORLDS


@dataclass(frozen=True, slots=True)
class ConstraintVerdict:
    """One constraint evaluated at one epoch.

    `value` and `margin` belong to the **nominal** case; `value_range` spans the nominal, optimistic and pessimistic cases.
    `margin_worst` is the smallest margin of the three cases (`worst_world` names it; with the unit of the constraint). Both
    margins are positive inside the limit and in `unit`, so the nominal margin can exceed `margin_worst` (+10.17 h against
    +7.44 h for the same epoch): screens must say which one they show."""

    key: str
    label: str
    state: str
    value: float | None
    value_range: tuple[float, float] | None
    limit_min: float | None
    limit_max: float | None
    unit: str
    margin: float | None
    margin_worst: float | None
    censored: bool
    """The nominal value is a bound because the analysed data ends before the quantity does."""
    origin_basis: str
    origin_label: str
    origin_source_url: str | None
    heading_dependent: bool = False
    """The state is set by the lander heading, which is unknown: `value` and `margin` are None (no nominal heading
    exists) and `value_range` spans the lower and the upper bound over headings."""
    heading_note: str = ""
    """For a heading-dependent row: the best and worst single heading and the headings over which the constraint passes."""
    heading_best: dict | None = None
    """For a heading-dependent row evaluated as a single landing: the best single heading of the evaluated set, `{"yaw_deg", "value",
    "horizon": "nominal"}` (value in the constraint's unit). None for a row built in a scan, slip or rank (no per-heading
    scan there) and for rows that are not heading-dependent."""
    heading_worst: dict | None = None
    """The worst single heading, `{"yaw_deg", "arcs_deg", "value", "horizon": "nominal"}`; `yaw_deg` is the first heading of the first arc
    of headings that tie the worst value and `arcs_deg` lists the arcs, `[[from_deg, to_deg], ...]` clockwise."""
    heading_basis: str = ""
    """What `heading_best` and `heading_worst` are (`HEADING_FACTS_BASIS`); empty when they are None."""
    value_worlds: dict[str, float | None] = field(default_factory=dict)
    """The value in each case, keys `nominal`, `optimistic`, `pessimistic`. `nominal` is None when the constraint has no nominal
    (heading-dependent row); a case with no finite value is None."""
    margin_worlds: dict[str, float | None] = field(default_factory=dict)
    """The signed margin in each case (same keys, `unit`, positive inside the limit)."""
    margin_limits: dict[str, str | None] = field(default_factory=dict)
    """For each case, the limit its margin is measured against: `min` or `max` (the nearer of a two-sided limit's sides); None
    without a margin."""
    worst_world: str | None = None
    """The case that gives `margin_worst` (the smallest margin; the pessimistic case on a tie). It is not always `pessimistic`: with a
    two-sided limit or an Earth link the optimistic case can be the worse one."""
    worst_limit: str | None = None
    """The limit `margin_worst` is measured against: `min` or `max`."""
    case_basis: str = "horizon"
    """What the three cases are: `horizon` (nominal terrain, lower and upper horizon bracket; the terrain-error widening is inside
    the optimistic and pessimistic cases) or `heading` (unknown lander heading: optimistic is the upper bound over headings, the best heading at each instant
    on the lowered horizon, and pessimistic the lower bound, the worst heading at each instant on the raised horizon; no single heading
    achieves either, and there is no nominal)."""


@dataclass(frozen=True, slots=True)
class Verdict:
    """Overall pass / marginal / fail with the limiting constraint and every constraint's record."""

    state: str
    limiting: str | None
    constraints: tuple[ConstraintVerdict, ...]

    def to_dict(self) -> dict:
        return asdict(self)

    def get(self, key: str) -> ConstraintVerdict:
        for c in self.constraints:
            if c.key == key:
                return c
        raise KeyError(key)


def _finite(x: float) -> float | None:
    return float(x) if np.isfinite(x) else None


def margin_side(lim: Limit, value: float) -> str | None:
    """The limit (`min` or `max`) the margin of `value` is measured against: the nearer side of a two-sided limit."""
    if not np.isfinite(value):
        return None
    if lim.min is not None and lim.max is not None:
        return "min" if value - lim.min <= lim.max - value else "max"
    return "min" if lim.min is not None else "max"


def case_facts(lim: Limit, vals: np.ndarray, no_nominal: bool = False) -> dict:
    """Per-case values, margins and binding limits of one constraint, and the case that gives the worst margin.

    `vals` is the (nominal, optimistic, pessimistic) value triple; `no_nominal` drops the nominal case (heading unknown)."""
    vals = np.asarray(vals, dtype=np.float64)
    marg = lim.margin(vals)
    use = [w for w in range(3) if np.isfinite(marg[w]) and not (no_nominal and w == 0)]
    worst = min(reversed(use), key=lambda w: marg[w]) if use else None
    return {
        "value_worlds": {w: None if (no_nominal and i == 0) else _finite(vals[i]) for i, w in enumerate(WORLDS)},
        "margin_worlds": {w: None if (no_nominal and i == 0) else _finite(marg[i]) for i, w in enumerate(WORLDS)},
        "margin_limits": {w: None if (no_nominal and i == 0) else margin_side(lim, vals[i]) for i, w in enumerate(WORLDS)},
        "worst_world": None if worst is None else WORLDS[worst],
        "worst_limit": None if worst is None else margin_side(lim, vals[worst]),
        "case_basis": "heading" if no_nominal else "horizon"}


def build_verdict(ev: EpochValues, vd: Verdicts, constraints: Constraints, i: int = 0) -> Verdict:
    """Verdict record for epoch index `i` of a batch evaluation."""
    active = constraints.active()
    rows = []
    for k in vd.keys:
        lim = active[k]
        vals = ev.values[k][:, i]
        marg = vd.margin[k][:, i]
        unknown = np.all(np.isnan(vals)) and k == "max_slope_deg"
        rows.append(ConstraintVerdict(
            key=k, label=lim.label, state=STATE_NAMES[int(vd.per_constraint[k][i])],
            value=_finite(vals[0]), value_range=None if unknown or not np.all(np.isfinite(vals))
            else (float(vals.min()), float(vals.max())),
            limit_min=lim.min, limit_max=lim.max, unit=lim.unit, margin=_finite(marg[0]),
            margin_worst=_finite(np.nanmin(marg)) if np.any(np.isfinite(marg)) else None,
            censored=bool(ev.censored[k][i]), origin_basis=lim.origin.basis, origin_label=lim.origin.label,
            origin_source_url=lim.origin.source_url, **case_facts(lim, vals)))
    lim_idx = int(vd.limiting[i])
    return Verdict(STATE_NAMES[int(vd.state[i])], vd.keys[lim_idx] if lim_idx >= 0 else None, tuple(rows))


def describe_constraint(c: ConstraintVerdict) -> str:
    """One-line explanation of why a constraint is not a clean pass (empty for PASS)."""
    if c.state == "pass":
        return ""
    if c.heading_dependent and c.state != "pass":
        return f"{c.label}: depends on the lander heading, which is unknown. {c.heading_note}"
    if c.state == "unknown":
        return f"{c.label}: not evaluated (no terrain data, or skipped because another constraint already fails)"
    limit = " to ".join(f"{x:g}" for x in (c.limit_min, c.limit_max) if x is not None)
    side = "within" if c.limit_min is not None and c.limit_max is not None else (
        "at least" if c.limit_min is not None else "at most")
    value = "no value" if c.value is None else f"{c.value:.3g} {c.unit}"
    if c.state == "fail":
        gap = "" if c.margin is None else f" (margin {c.margin:.3g} {c.unit})"
        return f"{c.label}: {value}, required {side} {limit} {c.unit}{gap}"
    worst = "" if c.margin_worst is None else f" (worst-case margin {c.margin_worst:.3g} {c.unit})"
    return (f"{c.label}: {value} meets {side} {limit} {c.unit} on the nominal horizon only; fails under the "
            f"optimistic or pessimistic terrain bound{worst}")


_RANK = {"pass": 0, "marginal": 1, "fail": 2}


def _arc_text(arcs) -> str:
    return ", ".join(f"{a:g} to {b:g} deg" if a != b else f"{a:g} deg" for a, b in arcs)


def heading_note(h, key: str, unit: str, limit: float | None) -> str:
    """One sentence the report, the web interface and the agent print as is: best and worst heading (the worst as an arc
    when several headings tie), the headings over which `key` passes, boundaries located to 1 degree.

    A state of charge (unit `fraction`) is printed as a percentage, the project convention."""
    c = h[key]
    vals = c.values_by_heading

    def q(v: float) -> str:
        return f"{100 * v:.1f} %" if unit == "fraction" else f"{v:.3g} {unit}"

    pas = ("no heading passes" if c.none_pass else "every heading passes" if c.all_pass else
           "passes for headings " + _arc_text(c.passing_deg))
    arcs = h.worst_arc_deg
    worst = _arc_text(arcs) if arcs else f"{h.worst_yaw_deg:g} deg"
    plural = "headings " if len(arcs) > 1 or (arcs and arcs[0][0] != arcs[0][1]) else ""
    lim = "" if limit is None else f"limit {q(limit)}, "
    return (f"Best heading {h.best_yaw_deg:g} deg ({q(max(vals))}), worst {plural}{worst} ({q(min(vals))}); {pas} "
            f"({lim}nominal horizon, headings clockwise from north, boundaries to {REFINE_RESOLUTION_DEG:g} deg).")


UNKNOWN_HEADING_NOTE = ("lander heading unknown: no outcome at one heading exists. The state is decided over all headings (passes only if "
                        "every heading passes, fails only if none does, otherwise Marginal); the per-heading scan and the passing "
                        "arcs are in the evaluation of a single landing at this site.")


def unknown_heading_soc(analysis) -> bool:
    """True when the minimum state of charge has no nominal outcome: no stated heading and the array's power depends on it."""
    p = getattr(analysis, "power", None)
    return p is not None and not p.heading_known and p.heading_depends


HEADING_FACTS_BASIS = ("Single constant headings on the nominal horizon. Both lie inside the upper and lower bounds over headings, "
                       "because no single heading is the best or the worst at every instant.")


def single_heading_facts(h, key: str) -> dict:
    """`heading_best`, `heading_worst` and `heading_basis` of the heading-dependent row `key`, from the heading analysis (no new
    computation): the extremes of the constraint value over the evaluated headings on the nominal horizon."""
    vals = h[key].values_by_heading
    arcs = h.worst_arc_deg
    return {
        "heading_best": {"yaw_deg": float(h.best_yaw_deg), "value": float(max(vals)), "horizon": "nominal"},
        "heading_worst": {"yaw_deg": float(h.worst_yaw_deg), "arcs_deg": [[float(a), float(b)] for a, b in arcs],
                          "value": float(min(vals)), "horizon": "nominal"},
        "heading_basis": HEADING_FACTS_BASIS}


def blank_unknown_heading(verdict: Verdict, ev: EpochValues, constraints: Constraints, note: str, heading_facts: dict | None = None) -> Verdict:
    """Replace the state-of-charge row of an unknown-heading result: no `value`, no nominal `margin`, `heading_dependent`.

    The state already follows `PowerSignals.verdict_power_w` (passes if every heading passes, fails if none does, Marginal "depends
    on heading" between); `value` and `margin` would be a number at no particular heading, so they are removed and `note` attached.
    Every analysis (evaluate, scan, slip, rank, ellipse, search) applies this rule."""
    key = "min_state_of_charge"
    if key not in constraints.active():
        return verdict
    lim = constraints.active()[key]
    vals = ev.values[key][:, 0]
    rows = []
    for r in verdict.constraints:
        if r.key == key:
            facts = case_facts(lim, vals, no_nominal=True)
            worst = facts["margin_worlds"].get(facts["worst_world"]) if facts["worst_world"] else None
            r = replace(r, value=None, margin=None, margin_worst=worst, **facts,
                        value_range=(float(min(vals[1], vals[2])), float(max(vals[1], vals[2]))) if np.all(np.isfinite(vals[1:])) else None,
                        heading_dependent=True, heading_note=note, **(heading_facts or {}))
        rows.append(r)
    return Verdict(verdict.state, verdict.limiting, tuple(rows))


def apply_heading_to_verdict(verdict: Verdict, h, ev: EpochValues, constraints: Constraints) -> Verdict:
    """`blank_unknown_heading` with the full heading note (best/worst heading, passing arcs) of a single-landing `HeadingAnalysis`.
    A stated heading (or a heading-independent array) leaves the verdict unchanged."""
    key = "min_state_of_charge"
    if h is None or not h.unknown_and_matters or key not in constraints.active() or not h.constraints:
        return verdict
    return blank_unknown_heading(verdict, ev, constraints, heading_note(h, key, constraints.active()[key].unit, constraints.active()[key].min),
                                 single_heading_facts(h, key))
