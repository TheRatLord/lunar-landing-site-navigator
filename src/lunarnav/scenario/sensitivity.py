"""Sensitivity of a scenario to observer heights and to the landing position.

All variants share one ephemeris table and one provider batch call, so the cost is the horizon work
only. `array_height_m` and `antenna_height_m` are varied separately (each has its own horizon); position
shifts go to 8 compass directions at configurable distances along great circles on the reference sphere.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

from lunarnav.constants import R_MOON_M
from lunarnav.ephem import BodyFixedEphemeris, utc_to_et

from .engine import HOUR_S
from .evaluate import SiteEvaluation, build_table, evaluate_scenario, landing_grid
from .horizons import HorizonProvider, SmoothSphereProvider, observer_sites, observers_per_site
from .models import Scenario, SiteSpec

COMPASS: tuple[tuple[str, float], ...] = (
    ("N", 0.0), ("NE", 45.0), ("E", 90.0), ("SE", 135.0), ("S", 180.0), ("SW", 225.0), ("W", 270.0), ("NW", 315.0))
DEFAULT_SHIFTS_M: tuple[float, ...] = (100.0, 500.0, 1000.0)


@dataclass(frozen=True, slots=True)
class SensitivityRow:
    """One variant: its parameter, the verdict and the headline metrics (key -> nominal value)."""

    label: str
    value: float
    """Height in metres, or shift distance in metres."""
    az_deg: float | None
    lat_deg: float
    lon_deg: float
    state: str
    limiting: str | None
    metrics: dict[str, float | None]
    margins: dict[str, float | None]
    """Nominal-world margin per active constraint."""
    evaluation: SiteEvaluation


@dataclass(frozen=True, slots=True)
class SensitivityResult:
    """Baseline and variants."""

    kind: str
    baseline: SensitivityRow
    rows: tuple[SensitivityRow, ...]


def destination(lat_deg: float, lon_deg: float, az_deg: float, dist_m: float) -> tuple[float, float]:
    """Great-circle destination on the reference sphere: latitude, longitude in (-180, 180] degrees."""
    lat, lon, az = math.radians(lat_deg), math.radians(lon_deg), math.radians(az_deg)
    d = dist_m / R_MOON_M
    sl = math.sin(lat) * math.cos(d) + math.cos(lat) * math.sin(d) * math.cos(az)
    lat2 = math.asin(max(-1.0, min(1.0, sl)))
    lon2 = lon + math.atan2(math.sin(az) * math.sin(d) * math.cos(lat), math.cos(d) - math.sin(lat) * sl)
    lon_deg2 = (math.degrees(lon2) + 180.0) % 360.0 - 180.0
    return math.degrees(lat2), lon_deg2


def _row(label: str, value: float, az: float | None, sc: Scenario, ev: SiteEvaluation) -> SensitivityRow:
    return SensitivityRow(
        label, float(value), az, sc.site.lat_deg, sc.site.lon_deg, ev.verdict.state, ev.verdict.limiting,
        {m.key: m.value for m in ev.metrics}, {c.key: c.margin for c in ev.verdict.constraints}, ev)


def _shared_table(scenario: Scenario) -> BodyFixedEphemeris:
    t_land = utc_to_et(scenario.landing_utc)
    cons = scenario.constraints
    min_sun = cons.min_sunlit_hours_after_landing
    span = max(scenario.mission_duration_h * HOUR_S, (min_sun.min or 0.0) * HOUR_S if min_sun else 0.0)
    grid = landing_grid(t_land, scenario.sampling.step_s, scenario.sampling.lookback_h * HOUR_S, span)
    return build_table(grid, [scenario.network])


def height_sensitivity(
    scenario: Scenario, provider: HorizonProvider | None = None, *, kind: str, heights_m: Sequence[float],
) -> SensitivityResult:
    """Vary one observer height: `kind="array"` (power horizon) or `"antenna"` (Earth link horizon)."""
    if kind not in ("array", "antenna"):
        raise ValueError("kind must be 'array' or 'antenna'")
    provider = provider or SmoothSphereProvider()
    prof = scenario.profile
    field = "array_height_m" if kind == "array" else "antenna_height_m"
    lat, lon = scenario.site.lat_deg, scenario.site.lon_deg
    heights = [getattr(prof, field), *heights_m]
    top = prof.antenna_height_max_m
    rows_prof = []
    for h in heights:
        upd = {field: float(h)}
        if kind == "antenna" and top is not None:
            upd["antenna_height_max_m"] = max(float(top), float(h))
        rows_prof.append(prof.model_copy(update=upd))
    flat = []
    for p in rows_prof:
        flat += observer_sites(lat, lon if lon <= 180.0 else lon - 360.0, p, scenario.site.name)
    profiles = provider.horizons(flat)
    table = _shared_table(scenario)
    rows, at = [], 0
    for h, p in zip(heights, rows_prof):
        g = observers_per_site(p)
        sc = scenario.model_copy(update={"profile": p})
        rows.append(_row(f"{kind} height {h:g} m", h, None, sc,
                         evaluate_scenario(sc, provider, table=table, horizons=tuple(profiles[at:at + g]))))
        at += g
    return SensitivityResult(f"{kind}_height", rows[0], tuple(rows[1:]))


def position_sensitivity(
    scenario: Scenario, provider: HorizonProvider | None = None, *, distances_m: Sequence[float] | None = None,
) -> SensitivityResult:
    """Shift the landing point in 8 compass directions at each distance (default: the ellipse's
    semi-minor and semi-major axes if the scenario has an ellipse, else 100, 500 and 1000 m)."""
    provider = provider or SmoothSphereProvider()
    if distances_m is None:
        e = scenario.ellipse
        distances_m = DEFAULT_SHIFTS_M if e is None else tuple(sorted({e.semi_minor_m, e.semi_major_m}))
    prof = scenario.profile
    points = [(scenario.site.lat_deg, scenario.site.lon_deg, "centre", 0.0, None)]
    for d in distances_m:
        for name, az in COMPASS:
            lat, lon = destination(scenario.site.lat_deg, scenario.site.lon_deg if scenario.site.lon_deg <= 180.0
                                   else scenario.site.lon_deg - 360.0, az, d)
            points.append((lat, lon, f"{d:g} m {name}", d, az))
    flat = []
    for lat, lon, *_ in points:
        flat += observer_sites(lat, lon if lon <= 180.0 else lon - 360.0, prof, scenario.site.name)
    profiles = provider.horizons(flat)
    g = observers_per_site(prof)
    table = _shared_table(scenario)
    rows = []
    for i, (lat, lon, label, d, az) in enumerate(points):
        sc = scenario.model_copy(update={"site": SiteSpec(lat_deg=lat, lon_deg=lon, name=scenario.site.name)})
        ev = evaluate_scenario(sc, provider, table=table, horizons=tuple(profiles[g * i:g * i + g]))
        rows.append(_row(label, d, az, sc, ev))
    return SensitivityResult("position", rows[0], tuple(rows[1:]))
