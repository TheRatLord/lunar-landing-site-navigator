"""Light-weight evaluation of one scenario at many nearby points (ellipse samples, search candidates).

`evaluate_points` runs exactly the verdict pipeline of `evaluate_scenario` (same signals, windows,
`epoch_values` and `judge`) for each point, but shares one ephemeris table and one batched horizon request,
skips the series, intervals, attribution and provenance, and evaluates only the active constraints. A point
equals the full evaluation of the scenario moved to that point (tested).

Terrain hazards (`terrain_hazards`) are computed vectorised from the terrain stack:

- `slope_deg`: the central-difference slope at `baseline_m` of `lunarnav.terrain.derivatives.slope_at`
  (same formula, vectorised; tested equal);
- `roughness_m`: our definition, since the terrain module has no roughness product: the RMS residual of the
  nine heights (centre plus eight compass points at `baseline_m`, in the local frame) about their
  least-squares plane. It is zero on a perfect plane and grows with sub-baseline relief.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

import numpy as np

from lunarnav.constants import R_MOON_M
from lunarnav.ephem import BodyFixedEphemeris, utc_to_et

from .engine import HOUR_S, build_analysis, epoch_values, judge
from .horizons import HorizonProvider, fold_observers, observer_sites, observers_per_site
from .models import Scenario
from .opportunities import DEFAULT_LOOKBACK_H, DEFAULT_SIGNAL_STEP_S, scan_table
from .provenance import OUR_DEFINITIONS
from .signals import array_power, compute_signals, prepare_horizon
from .verdicts import unknown_heading_soc

CHUNK_POINTS = 256
"""Points per batched horizon request (bounds memory)."""


def wrap_lon(lon_deg: np.ndarray | float) -> np.ndarray | float:
    """Longitude in [-180, 180)."""
    return (np.asarray(lon_deg) + 180.0) % 360.0 - 180.0 if not np.isscalar(lon_deg) else (lon_deg + 180.0) % 360.0 - 180.0


RING_AZ_DEG = (0.0, 90.0, 180.0, 270.0, 45.0, 135.0, 225.0, 315.0)


def destination_arrays(lat_deg: np.ndarray | float, lon_deg: np.ndarray | float, east_m: np.ndarray, north_m: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Points at azimuthal-equidistant offsets (east, north metres) from a centre on the reference sphere.

    The offset is the great-circle distance `hypot(east, north)` along azimuth `atan2(east, north)`.
    Returns (lat, lon) in degrees with lon in [-180, 180); latitude is always within [-90, 90] (an offset that
    crosses the pole comes out on the far meridian, as a great circle does).
    """
    east = np.asarray(east_m, dtype=np.float64)
    north = np.asarray(north_m, dtype=np.float64)
    dist = np.hypot(east, north) / R_MOON_M
    az = np.arctan2(east, north)
    la0, lo0 = np.radians(lat_deg), np.radians(lon_deg)
    la = np.arcsin(np.clip(np.sin(la0) * np.cos(dist) + np.cos(la0) * np.sin(dist) * np.cos(az), -1.0, 1.0))
    lo = lo0 + np.arctan2(np.sin(az) * np.sin(dist) * np.cos(la0), np.cos(dist) - np.sin(la0) * np.sin(la))
    return np.degrees(la), np.asarray(wrap_lon(np.degrees(lo)))


def _offsets_ring(lat: np.ndarray, lon: np.ndarray, baseline_m: float) -> list[tuple[np.ndarray, np.ndarray]]:
    """Eight compass points (N, E, S, W, NE, SE, SW, NW) at `baseline_m` from each point."""
    out = []
    for az in RING_AZ_DEG:
        a = math.radians(az)
        out.append(destination_arrays(lat, lon, np.sin(a) * baseline_m, np.cos(a) * baseline_m))
    return out


def terrain_hazards(stack, lat_deg: np.ndarray, lon_deg: np.ndarray, baseline_m: float) -> tuple[np.ndarray, np.ndarray]:
    """(slope_deg, roughness_m) at points; NaN where any of the nine heights is outside the data.

    Why it exists: the terrain module has no slope or roughness API, and the search, ellipse and point analyses need
    both for thousands of points with one nine-point stencil each (one vectorised `stack.height` call). The slope
    uses the same formula as `TerrainProvider.slope_deg` (tested equal); the roughness is our definition (RMS
    residual about the best-fit plane over the nine heights), stated in the result provenance.
    """
    lat = np.atleast_1d(np.asarray(lat_deg, dtype=np.float64))
    lon = np.atleast_1d(np.asarray(lon_deg, dtype=np.float64))
    h0 = np.asarray(stack.height(lat, lon), dtype=np.float64)
    ring = _offsets_ring(lat, lon, baseline_m)
    h = np.stack([np.asarray(stack.height(la, lo), dtype=np.float64) for la, lo in ring])
    th = baseline_m / R_MOON_M
    z = (R_MOON_M + h) * np.cos(th) - (R_MOON_M + h0)
    x = (R_MOON_M + h) * np.sin(th)
    d_north = (z[0] - z[2]) / (x[0] + x[2])
    d_east = (z[1] - z[3]) / (x[1] + x[3])
    slope = np.degrees(np.arctan(np.hypot(d_north, d_east)))
    az = np.radians(RING_AZ_DEG)
    ex = np.concatenate([[0.0], np.sin(az) * baseline_m])
    ny = np.concatenate([[0.0], np.cos(az) * baseline_m])
    zz = np.concatenate([np.zeros((1, lat.size)), z], axis=0)
    a = np.column_stack([ex, ny, np.ones(9)])
    pinv = np.linalg.pinv(a)
    coef = pinv @ zz
    resid = zz - a @ coef
    rough = np.sqrt((resid**2).mean(axis=0))
    bad = ~np.isfinite(slope)
    rough[bad] = np.nan
    return slope, rough


@dataclass(frozen=True, slots=True)
class PointResults:
    """Verdicts at `n` points for `m` landing epochs (arrays `(n, m)` unless noted)."""

    lat_deg: np.ndarray
    lon_deg: np.ndarray
    landing_et: np.ndarray
    keys: tuple[str, ...]
    state: np.ndarray
    """Overall state FAIL/MARGINAL/PASS/UNKNOWN per point and epoch."""
    per_constraint: dict[str, np.ndarray]
    """State per constraint, `(n, m)`."""
    worst_margin: np.ndarray
    """Normalised margin of the limiting constraint."""
    optimistic_margin: np.ndarray
    """Smallest normalised margin over the constraints in the optimistic horizon world."""
    limiting: np.ndarray
    """Index into `keys` of the limiting constraint."""
    values: dict[str, np.ndarray]
    """Nominal-world constraint values `(n, m)`. With an unknown lander heading `min_state_of_charge` is NaN (no outcome at one
    heading exists); the states and margins follow the heading rule (`PowerSignals.verdict_power_w`)."""
    slope_deg: np.ndarray | None
    roughness_m: np.ndarray | None
    censored: dict[str, np.ndarray] = field(default_factory=dict)
    """Per constraint `(n, m)`: the value is a lower or upper bound because the quantity runs to the end of the table."""
    provenance: dict = field(default_factory=dict)
    heading_unknown: bool = False
    """The lander heading is unknown and the minimum state of charge depends on it: its `values` are NaN."""

    @property
    def n(self) -> int:
        return int(self.lat_deg.size)

    def best_epoch(self) -> np.ndarray:
        """Per point, the epoch index with the best (state, margin)."""
        key = self.state.astype(np.float64) * 1.0e6 + np.nan_to_num(self.worst_margin, nan=-1.0e5, posinf=1.0e5, neginf=-1.0e5)
        return np.argmax(key, axis=1)


def landing_epochs(scenario: Scenario, first_utc: str | None = None, last_utc: str | None = None,
                   spacing_h: float | None = None) -> np.ndarray:
    """The scenario's landing epoch (ET), or a regular range `first..last` every `spacing_h` hours."""
    if first_utc is None:
        if last_utc is not None or spacing_h is not None:
            raise ValueError("last_utc and epoch_spacing_h need first_utc; without first_utc the scenario's landing epoch is used")
        return np.array([utc_to_et(scenario.landing_utc)])
    t0 = utc_to_et(first_utc)
    t1 = utc_to_et(last_utc or first_utc)
    if t1 < t0:
        raise ValueError(f"last_utc ({last_utc}) precedes first_utc ({first_utc})")
    if spacing_h is not None and not spacing_h > 0.0:
        raise ValueError(f"epoch_spacing_h must be above 0, got {spacing_h:g}")
    if spacing_h is None or t1 == t0:
        return np.array([t0])
    return t0 + np.arange(0.0, (t1 - t0) / HOUR_S + 1e-9, spacing_h) * HOUR_S


def points_table(scenario: Scenario, epochs_et: np.ndarray, *, signal_step_s: float = DEFAULT_SIGNAL_STEP_S,
                 lookback_h: float | None = None) -> BodyFixedEphemeris:
    """The shared ephemeris table for landings at `epochs_et` (grid anchored at the first epoch)."""
    lookback = scenario.sampling.lookback_h if lookback_h is None else lookback_h
    return scan_table(scenario, float(epochs_et[0]), float(epochs_et[-1]), signal_step_s=signal_step_s,
                      lookback_h=lookback if lookback > 0.0 else DEFAULT_LOOKBACK_H)


def evaluate_points(
    scenario: Scenario, provider: HorizonProvider, lat_deg: Sequence[float] | np.ndarray,
    lon_deg: Sequence[float] | np.ndarray, epochs_et: np.ndarray | None = None, *,
    table: BodyFixedEphemeris | None = None, signal_step_s: float = DEFAULT_SIGNAL_STEP_S,
    lookback_h: float | None = None, with_hazards: bool = True, skip_failed_soc: bool = True,
    slope_deg: np.ndarray | None = None, roughness_m: np.ndarray | None = None,
    progress: Callable[[float, str], None] | None = None, chunk_points: int | None = None,
) -> PointResults:
    """Verdict of `scenario` moved to each point, at each landing epoch (default: the scenario's own).

    `table` must cover [epoch - lookback, epoch + mission]; by default one is built with
    `points_table` and shared by every point. Constraints that are not active are not evaluated; the slope
    constraint uses the terrain slope at the point (unknown without terrain); precomputed `slope_deg` and
    `roughness_m` arrays (one per point) skip the terrain lookup.

    `progress(fraction, stage)` is called after every chunk of `chunk_points` points (default `CHUNK_POINTS`) with
    the fraction of points done; an exception it raises propagates unchanged. Results do not depend on the chunking.
    """
    lat = np.asarray(lat_deg, dtype=np.float64)
    lon = np.asarray(wrap_lon(np.asarray(lon_deg, dtype=np.float64)), dtype=np.float64)
    if lat.shape != lon.shape or lat.ndim != 1:
        raise ValueError("lat_deg and lon_deg must be 1-D arrays of equal length")
    prof, cons = scenario.profile, scenario.constraints
    q = np.asarray(epochs_et if epochs_et is not None else landing_epochs(scenario), dtype=np.float64)
    d_s = scenario.mission_duration_h * HOUR_S
    if table is None:
        table = points_table(scenario, q, signal_step_s=signal_step_s, lookback_h=lookback_h)
    n, m = lat.size, q.size
    stack = getattr(provider, "stack", None) if provider.models_terrain else None
    slope, rough = slope_deg, roughness_m
    if slope is None and stack is not None and (with_hazards or "max_slope_deg" in cons.active()):
        slope, rough = terrain_hazards(stack, lat, lon, cons.slope_baseline_m.value)
    active = cons.active()
    base_keys = tuple(k for k in active if not (k == "max_slope_deg" and slope is None))

    state = np.empty((n, m), dtype=np.int8)
    wmargin = np.empty((n, m))
    omargin = np.empty((n, m))
    limiting = np.empty((n, m), dtype=np.int64)
    per = {k: np.empty((n, m), dtype=np.int8) for k in base_keys}
    values = {k: np.full((n, m), np.nan) for k in base_keys}
    cens = {k: np.zeros((n, m), dtype=bool) for k in base_keys}
    keys = base_keys
    heading_unknown = False
    chunk = CHUNK_POINTS if chunk_points is None else max(1, int(chunk_points))
    for c0 in range(0, n, chunk):
        c1 = min(n, c0 + chunk)
        sites = []
        for i in range(c0, c1):
            sites += observer_sites(float(lat[i]), float(lon[i]), prof, scenario.site.name)
        raw = provider.horizons(sites)
        g = observers_per_site(prof)
        for j, i in enumerate(range(c0, c1)):
            ah_raw, nh_raw = fold_observers(raw[g * j:g * j + g])
            ah, _ = prepare_horizon(ah_raw, scenario.terrain_error, provider.models_terrain, provider)
            nh, _ = prepare_horizon(nh_raw, scenario.terrain_error, provider.models_terrain, provider)
            sig = compute_signals(table, ah, nh, prof, scenario.network, cons, scenario.eclipse)
            power = array_power(sig, prof) if "min_state_of_charge" in active else None
            an = build_analysis(sig, cons, power)
            if q[0] < an.t0 - 1e-6 or q[-1] + d_s > an.t1 + 1e-6:
                raise ValueError("the ephemeris table must cover [first landing - lookback, last landing + mission]")
            ev = epoch_values(an, q, d_s, base_keys, battery=prof.battery, loads=prof.loads,
                              slope_deg=None if slope is None else float(slope[i]),
                              skip_failed_with=cons if skip_failed_soc else None)
            vd = judge(ev, cons)
            keys = vd.keys
            state[i] = vd.state
            wmargin[i] = vd.worst_margin
            limiting[i] = vd.limiting
            heading_unknown = heading_unknown or (power is not None and unknown_heading_soc(an))
            for k in vd.keys:
                per[k][i] = vd.per_constraint[k]
                values[k][i] = np.nan if k == "min_state_of_charge" and power is not None and unknown_heading_soc(an) else ev.values[k][0]
                cens[k][i] = ev.censored[k]
            opt = np.full(m, np.inf)
            for k in vd.keys:
                with np.errstate(invalid="ignore"):
                    mk = np.nan_to_num(vd.margin[k][1], nan=np.inf) / active[k].margin_scale
                opt = np.minimum(opt, mk)
            omargin[i] = opt
        if progress is not None:
            progress(c1 / n, f"{c1} of {n} points")
    prov = {"provider": provider.provenance(), "n_points": int(n), "n_epochs": int(m),
            "signal_step_s": float(signal_step_s), "our_definitions": {"roughness": OUR_DEFINITIONS["roughness"]}}
    return PointResults(lat, lon, q, keys, state, {k: per[k] for k in keys}, wmargin, omargin, limiting,
                        {k: values[k] for k in keys}, slope, rough, {k: cens[k] for k in keys}, prov, heading_unknown)
