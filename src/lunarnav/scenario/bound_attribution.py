"""Bound attribution: which horizon events make the optimistic, nominal and pessimistic worlds differ.

`SiteEvaluation.metrics` and the verdict report each constraint's value over the three horizon worlds but not
*why* the worlds differ. This module reads the same per-world windows (`Analysis.worlds`) and horizons
(`SiteSignals`) that produced those values and, per constraint whose value is set by one interval, reports:

* the margin-setting interval of each world (the world's own longest dark span, longest contact gap, the
  dark interval holding its minimum state of charge, or the sunlit interval holding the landing);
* its edge events (sunset / sunrise / Earth set / Earth rise): the time in each world, the azimuth where the
  limiting horizon point is, the horizon elevation there, and the range of the blocker;
* how much of the spread of the interval's (mission-clipped) duration each edge explains. The contributions are
  like-for-like: for the minimum state of charge every case is read at the nominal case's interval; for the longest
  dark span and contact gap each case holds its own longest interval, and when the longest and the shortest case hold
  different intervals (different nights) or a case has none, the row is `decomposable = False` and every contribution
  and share is None (a difference of two different events explains nothing). With world `a` the
  longest and `b` the shortest interval, `D_a - D_b = (end_a - end_b) - (start_a - start_b)`; the two terms
  are the contributions and the shares are each term over the total, so the two shares add to 1 (a share can
  be negative when the edge works against the spread). Edges outside the mission window are clipped to it and
  explain nothing.

Limits, stated in the result: the share explains the spread of the *interval duration*. For the minimum state
of charge the duration spread is the cause of the spread of the minimum, but the SOC spread is not linear in
it (it also depends on the array power in the lit hours before), so its `explained_quantity` says so and
`world_soc` is given. When the minimum is reached while sunlit (a power shortfall, as at a pole with a low Sun)
the edge shares are None and `explained_quantity` starts with "none". The blocker range is read from the nominal terrain profile at the limiting azimuth:
the optimistic and pessimistic horizons are algorithmic brackets of the same terrain and carry no blocker of
their own.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from lunarnav.ephem import et_to_utc
from lunarnav.visibility import horizon_elevation_at, horizon_grid

from .edge_cause import az_at, disc_clearance, sun_direction
from .engine import WORLDS
from .evaluate import SiteEvaluation
from .horizons import HorizonProvider, SmoothSphereProvider
from .windows import WindowSet

HOUR_S = 3600.0
WORLD_SOC_UNKNOWN_HEADING = (
    "The lander heading is unknown, so there is no nominal minimum state of charge: the optimistic value is the upper bound over "
    "headings (the best heading at each instant on the lowered horizon; no single heading achieves it) and the pessimistic value the "
    "lower bound (the worst heading at each instant on the raised horizon; no single heading is that bad at every instant).")
SUPPORTED = ("max_dark_span_h", "min_state_of_charge", "max_contact_gap_h", "min_sunlit_hours_after_landing")
EXPLAINED_DURATION = "interval_duration"
EXPLAINED_SHORTFALL = ("none: the minimum is reached while sunlit (array power below the load), so the edge times "
                       "do not set it; the events are the edges of that sunlit interval, for context")
EXPLAINED_SOC = "interval_duration (the minimum state of charge also depends on the array power before it)"


@dataclass(frozen=True, slots=True)
class WorldEvent:
    """One edge of the margin-setting interval in one world."""

    world: str
    et: float
    utc: str
    clipped: bool
    """The edge lies outside the mission window or at the data edge; durations use the clipped edge."""
    az_deg: float | None
    """Azimuth of the limiting horizon point (Sun events: the disc point with most clearance; contact events:
    the station or Earth direction)."""
    horizon_elev_deg: float | None
    blocker_dist_m: float | None
    blocker: dict[str, float] | None
    cause: str

    def to_dict(self) -> dict:
        return {"world": self.world, "et": self.et, "utc": self.utc, "clipped": self.clipped, "az_deg": self.az_deg,
                "horizon_elev_deg": self.horizon_elev_deg, "blocker_dist_m": self.blocker_dist_m,
                "blocker": self.blocker, "cause": self.cause}


@dataclass(frozen=True, slots=True)
class BoundEvent:
    """One edge kind (`role` start or end of the interval) over the three worlds."""

    kind: str
    role: str
    worlds: tuple[WorldEvent, ...]
    contribution_h: float | None
    """Contribution to (longest - shortest) interval duration, hours (signed): the same edge event in the two cases that bound the
    spread. None when the constraint is not decomposable (`ConstraintBound.decomposable` is False)."""
    share: float | None
    """`contribution / total spread`; None when the cases do not differ or the constraint is not decomposable."""

    def to_dict(self) -> dict:
        return {"kind": self.kind, "role": self.role, "worlds": [w.to_dict() for w in self.worlds],
                "contribution_h": self.contribution_h, "share": self.share}


@dataclass(frozen=True, slots=True)
class ConstraintBound:
    """Attribution of one constraint's spread over the horizon worlds."""

    key: str
    label: str
    unit: str
    value: float | None
    value_range: tuple[float, float] | None
    margin: float | None
    margin_worst: float | None
    interval_kind: str
    """`dark`, `contact_gap` or `sunlit`."""
    interval_hours: dict[str, float]
    """Mission-clipped duration of the interval per world."""
    same_interval: bool
    """All three worlds' intervals overlap in time (the worlds differ in the edges, not in which night)."""
    spread_h: float
    explained_quantity: str
    world_soc: dict[str, float | None] | None
    events: tuple[BoundEvent, ...]
    cause: str = "terrain"
    """Which bound moved this quantity: `heading` (the lander heading is unknown or uncertain), `terrain` (horizon
    error widening), `both`, or `none` (the three cases agree). Only the minimum state of charge depends on heading."""
    contributions: dict[str, tuple[float, float] | None] | None = None
    """For the minimum state of charge: the (pessimistic, optimistic) range under `total`, `heading` alone (horizon at
    nominal) and `terrain` alone (heading at nominal, or at the mean over headings when unknown)."""
    note: str = ""
    decomposable: bool = True
    """The edge contributions are like-for-like: the longest and the shortest case hold the same interval (same night, same contact
    gap), so each contribution is one edge event's time in two cases and the contributions add to `spread_h`. False when a case
    has no such interval or its interval is a different event; then every contribution and share is None."""
    decomposition_note: str = ""
    """Why the spread is not decomposed (empty when `decomposable`)."""
    world_soc_note: str = ""
    """What `world_soc` means when the lander heading is unknown and matters: there is no nominal case (`world_soc["nominal"]` is None),
    and the optimistic and pessimistic values are the upper and the lower bound over headings (envelopes on the lowered and the raised horizon; no single heading achieves them). Empty otherwise."""

    def to_dict(self) -> dict:
        return {"key": self.key, "label": self.label, "unit": self.unit, "value": self.value,
                "value_range": list(self.value_range) if self.value_range else None, "margin": self.margin,
                "margin_worst": self.margin_worst, "interval_kind": self.interval_kind,
                "interval_hours": self.interval_hours, "same_interval": self.same_interval,
                "spread_h": self.spread_h, "explained_quantity": self.explained_quantity,
                "world_soc": self.world_soc, "events": [e.to_dict() for e in self.events],
                "cause": self.cause, "contributions": None if self.contributions is None else
                {k: None if v is None else list(v) for k, v in self.contributions.items()}, "note": self.note,
                "decomposable": self.decomposable, "decomposition_note": self.decomposition_note,
                "world_soc_note": self.world_soc_note}


@dataclass(frozen=True, slots=True)
class BoundAttribution:
    """Per-constraint account of why the three worlds differ (see the module doc)."""

    constraints: tuple[ConstraintBound, ...]
    worlds: tuple[str, ...] = WORLDS
    note: str = ("Cases: nominal terrain, optimistic (lower horizon bracket, Earth link at the maximum antenna "
                 "height) and pessimistic (upper horizon bracket); computed from the same windows and horizons as "
                 "the verdict")

    def to_dict(self) -> dict:
        return {"worlds": list(self.worlds), "note": self.note, "constraints": [c.to_dict() for c in self.constraints]}

    def __getitem__(self, key: str) -> ConstraintBound:
        for c in self.constraints:
            if c.key == key:
                return c
        raise KeyError(key)


def _longest_index(ws: WindowSet, q0: float, q1: float) -> int:
    if not len(ws):
        return -1
    ov = np.minimum(ws.ends, q1) - np.maximum(ws.starts, q0)
    k = int(np.argmax(ov))
    return k if ov[k] > 0 else -1


def _containing_or_before(ws: WindowSet, t: float) -> int:
    if not len(ws):
        return -1
    k = int(np.searchsorted(ws.starts, t, side="right")) - 1
    return k


def _matching_index(ws: WindowSet, ref: WindowSet, k: int) -> int:
    """Index in `ws` of the interval that overlaps interval `k` of `ref` most (-1: this case has no such interval).

    Every case is read at the nominal case's interval so that an edge is the same event in all three cases."""
    if k < 0 or not len(ws):
        return -1
    return _longest_index(ws, float(ref.starts[k]), float(ref.ends[k]))


def _sun_world_event(ev: SiteEvaluation, world: str, kind: str, te: float, provider: HorizonProvider) -> tuple:
    sig = ev.signals
    grid = horizon_grid(sig.array_horizon, world)
    az0, el0 = sun_direction(sig, te, te)(te)
    r = float(np.interp(te, sig.et, sig.sun_ang_radius_deg))
    _, a_lim, _ = disc_clearance(az0, el0, r, grid)
    h = float(horizon_elevation_at(np.array([a_lim]), grid)[0])
    if float(np.interp(te, sig.et, sig.eclipse)) > 0.05:
        return az0, None, None, None, "Earth eclipse"
    n = len(sig.array_horizon.az_deg)
    dist = float(sig.array_horizon.blocker_dist_m[int(round(a_lim / (360.0 / n))) % n])
    cause = "terrain horizon" if provider.models_terrain else "smooth-sphere horizon"
    return (a_lim, h, dist if np.isfinite(dist) else None, provider.blocker_point(sig.array_horizon, a_lim), cause)


def _contact_world_event(ev: SiteEvaluation, world: str, kind: str, te: float, provider: HorizonProvider,
                         station: str | None) -> tuple:
    sig = ev.signals
    grid = horizon_grid(sig.antenna_horizon, world)
    if station is not None:
        az = az_at(sig.et, sig.station_az_deg[station], te)
    else:
        az = az_at(sig.et, sig.earth_az_deg, te)
    h = float(horizon_elevation_at(np.array([az]), grid)[0])
    n = len(sig.antenna_horizon.az_deg)
    dist = float(sig.antenna_horizon.blocker_dist_m[int(round(az / (360.0 / n))) % n])
    return (az, h, dist if np.isfinite(dist) else None, provider.blocker_point(sig.antenna_horizon, az),
            "contact horizon plus margin")


def _contact_station(ev: SiteEvaluation, kind: str, te: float) -> str | None:
    sig = ev.signals
    if not sig.station_clearance:
        return None
    probe = te - 120.0 if kind == "earthset" else te + 120.0
    return max(sig.station_clearance, key=lambda n: float(np.interp(probe, sig.et, sig.station_clearance[n].nominal)))


def _world_event(ev: SiteEvaluation, world: str, kind: str, te: float, clipped: bool, provider: HorizonProvider,
                 station: str | None) -> WorldEvent:
    t = ev.signals.et
    if not (t[0] < te < t[-1]) or not math.isfinite(te):
        return WorldEvent(world, te, et_to_utc(te), True, None, None, None, None, "data edge")
    if kind in ("sunset", "sunrise"):
        az, h, d, b, cause = _sun_world_event(ev, world, kind, te, provider)
    else:
        az, h, d, b, cause = _contact_world_event(ev, world, kind, te, provider, station)
    return WorldEvent(world, te, et_to_utc(te), clipped, az, h, d, b, cause)


def _pick_windows(ev: SiteEvaluation, key: str) -> tuple[str, tuple[WindowSet, ...], list[int], str, str, str]:
    """(interval kind, per-world window sets, per-world index, start event kind, end event kind, horizon)."""
    an, q0 = ev.analysis, ev.t_land_et
    q1 = q0 + ev.mission_s
    if key == "max_dark_span_h":
        sets = tuple(w.dark for w in an.worlds)
        return "dark", sets, [_longest_index(s, q0, q1) for s in sets], "sunset", "sunrise", "array"
    if key == "max_contact_gap_h":
        sets = tuple(w.gap for w in an.worlds)
        return "contact_gap", sets, [_longest_index(s, q0, q1) for s in sets], "earthset", "earthrise", "antenna"
    if key == "min_state_of_charge":
        tmins = [float(an.t[int(np.nanargmin(ev.soc[w]))]) if np.any(np.isfinite(ev.soc[w])) else q0 for w in WORLDS]
        in_dark = an.worlds[0].dark.index_containing(np.array([tmins[0]]))[0] >= 0
        kind, ks, ke = ("dark", "sunset", "sunrise") if in_dark else ("sunlit", "sunrise", "sunset")
        sets = tuple((w.dark if in_dark else w.sunlit) for w in an.worlds)
        ref = _containing_or_before(sets[0], tmins[0])
        return kind, sets, [ref] + [_matching_index(s, sets[0], ref) for s in sets[1:]], ks, ke, "array"
    sets = tuple(w.sunlit for w in an.worlds)
    return "sunlit", sets, [int(s.index_containing(np.array([q0]))[0]) for s in sets], "sunrise", "sunset", "array"


def _constraint_bound(ev: SiteEvaluation, row, provider: HorizonProvider) -> ConstraintBound:
    key = row.key
    q0, q1 = ev.t_land_et, ev.t_land_et + ev.mission_s
    kind, sets, idx, k_start, k_end, _ = _pick_windows(ev, key)
    clipped_edges, dur = [], []
    for s, k in zip(sets, idx):
        if k < 0:
            clipped_edges.append(None)
            dur.append(0.0)
            continue
        a, b = float(s.starts[k]), float(s.ends[k])
        clipped_edges.append((a, b, max(a, q0), min(b, q1)))
        dur.append(max(min(b, q1) - max(a, q0), 0.0))
    ia, ib = int(np.argmax(dur)), int(np.argmin(dur))
    total = dur[ia] - dur[ib]
    c_start = c_end = 0.0
    decomposable, why = True, ""
    if total > 0:
        ea, eb = clipped_edges[ia], clipped_edges[ib]
        if ea is None or eb is None:
            decomposable, why = False, (f"the {WORLDS[ib if eb is None else ia]} case has no such interval, so there is no edge "
                                        "event to compare with")
        elif max(ea[0], eb[0]) >= min(ea[1], eb[1]):
            decomposable, why = False, (f"the {WORLDS[ia]} and {WORLDS[ib]} cases hold different intervals (different nights or "
                                        "gaps), so their edges are not the same event")
        else:
            c_end = ea[3] - eb[3]
            c_start = -(ea[2] - eb[2])
    events = []
    for role, kind_e, c, edge_i in (("start", k_start, c_start, 0), ("end", k_end, c_end, 1)):
        station = None
        if kind_e in ("earthset", "earthrise") and clipped_edges[0]:
            station = _contact_station(ev, kind_e, clipped_edges[0][edge_i])
        wes = []
        for w, e in zip(WORLDS, clipped_edges):
            if e is None:
                wes.append(WorldEvent(w, math.nan, "", True, None, None, None, None, "no such interval"))
                continue
            raw = e[edge_i]
            wes.append(_world_event(ev, w, kind_e, raw, e[2 + edge_i] != raw, provider, station))
        events.append(BoundEvent(kind_e, role, tuple(wes), c / HOUR_S if decomposable else None,
                                 c / total if decomposable and total > 0 else None))
    overlap = all(e is not None for e in clipped_edges) and max(e[0] for e in clipped_edges) < min(
        e[1] for e in clipped_edges)
    soc = ({w: float(np.nanmin(ev.soc[w])) for w in WORLDS} if key == "min_state_of_charge" else None)
    soc_note = ""
    if soc is not None and "soc" in ev.no_nominal_series:
        soc["nominal"] = None
        soc_note = WORLD_SOC_UNKNOWN_HEADING
    explained = EXPLAINED_DURATION
    if key == "min_state_of_charge":
        explained = EXPLAINED_SOC if kind == "dark" else EXPLAINED_SHORTFALL
        if kind != "dark":
            events = [BoundEvent(e.kind, e.role, e.worlds, 0.0, None) for e in events]
            decomposable, why = True, ""
    cause = "terrain" if total > 0 else "none"
    contributions, note = None, ""
    h = ev.heading
    if key == "min_state_of_charge" and h is not None:
        cause = h.cause
        contributions = {"total": h.soc_min_total, "heading": h.soc_min_heading_only, "terrain": h.soc_min_horizon_only}
        note = _heading_note(h)
    return ConstraintBound(
        key, row.label, row.unit, row.value, tuple(row.value_range) if row.value_range else None, row.margin,
        row.margin_worst, kind, {w: d / HOUR_S for w, d in zip(WORLDS, dur)}, bool(overlap), total / HOUR_S,
        explained, soc, tuple(events), cause, contributions, note, decomposable, why, soc_note)


def _heading_note(h) -> str:
    """Plain statement of which bound moved the minimum state of charge."""
    if not h.depends:
        return "array power does not depend on heading for this lander and site; only the horizon bound applies"
    fmt = lambda r: "n/a" if r is None else f"{r[0]:.3g} to {r[1]:.3g}"  # noqa: E731
    who = "unknown" if not h.known else f"uncertain by {h.uncertainty_deg:g} deg"
    return (f"lander heading {who}: minimum state of charge {fmt(h.soc_min_total)} overall; {fmt(h.soc_min_heading_only)} "
            f"from heading alone; {fmt(h.soc_min_horizon_only)} from terrain error alone; moved by: {h.cause}")


def bound_attribution(ev: SiteEvaluation, provider: HorizonProvider | None = None) -> BoundAttribution:
    """Per-constraint account of which events separate the three horizon worlds (see the module doc).

    Covers the constraints that one interval sets: `max_dark_span_h`, `min_state_of_charge`,
    `max_contact_gap_h`, `min_sunlit_hours_after_landing`; the others are omitted. Pass the provider that
    produced the evaluation so blocker coordinates can be resolved."""
    provider = provider or SmoothSphereProvider()
    rows = [r for r in ev.verdict.constraints if r.key in SUPPORTED and (r.value is not None or r.heading_dependent)]
    return BoundAttribution(tuple(_constraint_bound(ev, r, provider) for r in rows))
