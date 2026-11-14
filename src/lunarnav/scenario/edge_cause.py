"""What sets an interval edge: the rules shared by event attribution, next-event naming and the interval case labels.

An interval edge carries horizon-case labels (`IntervalRow.start_worlds`) only when the terrain horizon (or, for contact, the
lander-side horizon) sets it. The Earth's shadow, the end of the analysed span and a station's own elevation mask do not depend on
the horizon case.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
from scipy.interpolate import CubicSpline

from lunarnav.visibility import horizon_elevation_at, horizon_grid

from .signals import SiteSignals

ECLIPSE_CAUSE = "eclipse"
"""Cause of a sunlight edge the Earth's shadow sets: the horizon alone leaves the Sun's disc (nearly) fully visible."""
MIXED_CAUSE = "horizon and eclipse"
HORIZON_CAUSE = "horizon"
TERRAIN_FLUX_CLEAR = 0.95
ECLIPSE_PRESENT = 0.05
DISC_AZ_SAMPLES = 721


def sunlight_edge_cause(sig: SiteSignals, et: float) -> str:
    """`ECLIPSE_CAUSE` when the horizon alone leaves the Sun's disc (nearly) fully visible at `et` (terrain flux >= 0.95) and the
    Earth's shadow covers part of it (eclipse fraction > 0.05); `MIXED_CAUSE` when both act; else `HORIZON_CAUSE`."""
    terrain = float(np.interp(et, sig.et, sig.terrain_flux.nominal))
    ecl = float(np.interp(et, sig.et, sig.eclipse))
    if terrain >= TERRAIN_FLUX_CLEAR and ecl > ECLIPSE_PRESENT:
        return ECLIPSE_CAUSE
    if terrain < TERRAIN_FLUX_CLEAR and ecl > ECLIPSE_PRESENT:
        return MIXED_CAUSE
    return HORIZON_CAUSE


def az_at(t: np.ndarray, az_deg: np.ndarray, te: float) -> float:
    """Azimuth (degrees, 0 to 360) at `te` from a sampled azimuth series, interpolated through the unwrapped angle."""
    return math.degrees(float(np.interp(te, t, np.unwrap(np.radians(az_deg))))) % 360.0


def sun_direction(sig: SiteSignals, t0: float, t1: float) -> Callable[[float], tuple[float, float]]:
    sel = (sig.et >= t0 - 3600.0) & (sig.et <= t1 + 3600.0)
    ts = sig.et[sel]
    az_s = CubicSpline(ts, np.unwrap(np.radians(sig.sun_az_deg[sel])))
    el_s = CubicSpline(ts, sig.sun_el_deg[sel])

    def at(x: float) -> tuple[float, float]:
        return math.degrees(float(az_s(x))) % 360.0, float(el_s(x))

    return at


def disc_clearance(az0: float, el0: float, r: float, grid: np.ndarray) -> tuple[float, float, float]:
    """(max clearance, azimuth of the maximum, top elevation there) over the azimuth span of the disc."""
    half = r / max(math.cos(math.radians(el0)), 0.05)
    a = az0 + np.linspace(-half, half, DISC_AZ_SAMPLES)
    dx = (a - az0) * math.cos(math.radians(el0))
    top = el0 + np.sqrt(np.maximum(r * r - dx * dx, 0.0))
    clr = top - horizon_elevation_at(np.mod(a, 360.0), grid)
    k = int(np.argmax(clr))
    return float(clr[k]), float(a[k] % 360.0), float(top[k])


@dataclass(frozen=True, slots=True)
class ContactEdge:
    """The two sides of a contact edge: `lander_side` and `station_side` are the clearances (degrees) of the lander horizon plus
    margin and of the station's elevation mask; the smaller one sets the edge (`lander_limits` when it is the lander side)."""

    station: str | None
    az_deg: float
    horizon_deg: float
    direction_el_deg: float
    lander_side_deg: float
    station_side_deg: float
    lander_limits: bool


def contact_edge(sig: SiteSignals, margin_deg: float, te: float, ending: bool, station: str | None = None) -> ContactEdge:
    """Which side sets a contact edge at `te` (`ending`: the contact ends, else it begins). Without `station`, the station that was
    (ending) or becomes (beginning) the last or first usable one is taken; with no stations the Earth centre is tested against the
    lander horizon alone."""
    t = sig.et
    grid = horizon_grid(sig.antenna_horizon, "nominal")
    if sig.station_clearance:
        if station is None:
            probe = te - 120.0 if ending else te + 120.0
            station = max(sig.station_clearance, key=lambda n: float(np.interp(probe, t, sig.station_clearance[n].nominal)))
        az = az_at(t, sig.station_az_deg[station], te)
        el_dir = float(np.interp(te, t, sig.station_dir_el_deg[station]))
        h = float(horizon_elevation_at(np.array([az]), grid)[0])
        lander_side = el_dir - h - margin_deg
        station_side = float(np.interp(te, t, sig.station_el_deg[station])) - sig.station_mask_deg[station]
        return ContactEdge(station, az, h, el_dir, lander_side, station_side, lander_side <= station_side)
    az = az_at(t, sig.earth_az_deg, te)
    el_dir = float(np.interp(te, t, sig.earth_el_deg))
    h = float(horizon_elevation_at(np.array([az]), grid)[0])
    return ContactEdge(None, az, h, el_dir, el_dir - h - margin_deg, math.inf, True)
