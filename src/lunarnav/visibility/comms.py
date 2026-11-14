"""Direct-to-Earth contact windows for a network of ground stations.

A station is *usable* at an epoch when both hold:

1. the station direction seen from the lander is above the lander terrain horizon by at least
   `horizon_margin_deg` (the antenna needs clearance), and
2. the lander is above the station elevation mask as seen from the station.

Each condition is a clearance in degrees; the station signal is their minimum, so usable <=> signal > 0
and the edges are refined like any other threshold crossing (`intervals`). Network windows are the union
over stations. Handovers come from a greedy minimum-handover schedule: on a continuous stretch of
coverage, stay on the current station until it ends, then switch to the station covering that instant
with the latest end (this minimises the number of switches for a union of intervals).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from lunarnav.types import HorizonProfile
from lunarnav.visibility._horizon import Bound, horizon_grid
from lunarnav.visibility.disc import point_clearance
from lunarnav.visibility.intervals import (
    Method,
    UncertainWindow,
    Window,
    WindowStats,
    bounded_windows,
    find_windows,
    window_stats,
)


@dataclass(frozen=True, slots=True)
class StationTrack:
    """Geometry of one ground station over the common time grid `et` of the contact analysis.

    `az_deg`/`el_deg`: direction of the station seen from the lander (local ENU frame).
    `station_el_deg`: elevation of the lander above the station local horizon.
    `min_elevation_deg`: the station elevation mask (e.g. 10 deg for DSN-like stations).
    """

    name: str
    az_deg: np.ndarray
    el_deg: np.ndarray
    station_el_deg: np.ndarray
    min_elevation_deg: float = 10.0


def station_signal(
    track: StationTrack, horizon_grid_deg: np.ndarray, horizon_margin_deg: float = 0.0
) -> np.ndarray:
    """Clearance (deg) of the tighter of the two constraints; positive means the station is usable."""
    lander_side = point_clearance(track.az_deg, track.el_deg, horizon_grid_deg, horizon_margin_deg)
    station_side = np.asarray(track.station_el_deg, dtype=np.float64) - track.min_elevation_deg
    return np.minimum(lander_side, station_side)


@dataclass(frozen=True, slots=True)
class Pass:
    """One scheduled stretch on one station."""

    station: str
    start: float
    end: float


@dataclass(frozen=True, slots=True)
class NetworkContacts:
    """Contact analysis result over [t0, t1] (seconds)."""

    per_station: dict[str, list[Window]]
    per_station_stats: dict[str, WindowStats]
    union: list[Window]
    stats: WindowStats
    """Union statistics: `fraction_visible` is the contact fraction, `longest_dark` the longest gap."""
    schedule: list[Pass] = field(default_factory=list)
    handovers: int = 0
    """Station switches while coverage is continuous (new acquisitions after a gap are not counted)."""
    acquisitions: int = 0
    """Number of continuous coverage stretches (union windows)."""


def merge_windows(windows: list[Window]) -> list[Window]:
    """Union of possibly overlapping windows, sorted."""
    out: list[Window] = []
    for w in sorted(windows, key=lambda w: w.start):
        if out and w.start <= out[-1].end:
            last = out[-1]
            if w.end > last.end:
                out[-1] = Window(last.start, w.end, last.start_censored, w.end_censored)
        else:
            out.append(w)
    return out


def _schedule(per_station: dict[str, list[Window]], union: list[Window]) -> tuple[list[Pass], int]:
    passes: list[Pass] = []
    handovers = 0
    for u in union:
        cursor = u.start
        first = True
        while cursor < u.end:
            best_name, best_end = None, cursor
            for name, ws in per_station.items():
                for w in ws:
                    if w.start <= cursor <= w.end and w.end > best_end:
                        best_name, best_end = name, w.end
            if best_name is None:
                break
            passes.append(Pass(best_name, cursor, best_end))
            if not first:
                handovers += 1
            first = False
            cursor = best_end
    return passes, handovers


def contact_windows(
    et: np.ndarray, tracks: list[StationTrack], horizon: HorizonProfile, *, horizon_margin_deg: float = 0.0,
    bound: Bound = "nominal", method: Method = "linear",
) -> NetworkContacts:
    """Per-station and network contact windows over the span of `et`.

    `bound` selects the horizon bracket ("optimistic" = lower horizon, "pessimistic" = higher).
    """
    t = np.asarray(et, dtype=np.float64)
    grid = horizon_grid(horizon, bound)
    per: dict[str, list[Window]] = {}
    for tr in tracks:
        if tr.name in per:
            raise ValueError(f"duplicate station name {tr.name!r}")
        per[tr.name] = find_windows(t, station_signal(tr, grid, horizon_margin_deg), 0.0, method=method)
    union = merge_windows([w for ws in per.values() for w in ws])
    t0, t1 = float(t[0]), float(t[-1])
    passes, handovers = _schedule(per, union)
    return NetworkContacts(
        per_station=per,
        per_station_stats={k: window_stats(v, t0, t1) for k, v in per.items()},
        union=union, stats=window_stats(union, t0, t1), schedule=passes, handovers=handovers,
        acquisitions=len(union))


def station_window_edge_ranges(
    et: np.ndarray, track: StationTrack, horizon: HorizonProfile, *, horizon_margin_deg: float = 0.0,
    method: Method = "linear",
) -> list[UncertainWindow]:
    """Windows of one station with edge ranges from the horizon lo/hi brackets."""
    t = np.asarray(et, dtype=np.float64)
    sigs = [station_signal(track, horizon_grid(horizon, b), horizon_margin_deg)
            for b in ("nominal", "optimistic", "pessimistic")]
    return bounded_windows(t, sigs[0], sigs[1], sigs[2], 0.0, method=method)
