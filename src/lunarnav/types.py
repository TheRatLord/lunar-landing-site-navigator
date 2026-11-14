"""Cross-module value types. Conventions are normative."""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np


def _check_lat_lon(kind: str, lat_deg: float, lon_deg: float) -> None:
    if not (math.isfinite(lat_deg) and math.isfinite(lon_deg)):
        raise ValueError(f"{kind}: latitude and longitude must be finite, got ({lat_deg}, {lon_deg})")
    if not -90.0 <= lat_deg <= 90.0:
        raise ValueError(f"{kind}: latitude {lat_deg} deg is outside [-90, 90]")


@dataclass(frozen=True, slots=True)
class Site:
    """Observer location on the Moon.

    Latitude/longitude are planetocentric in the mean-Earth/polar-axis (ME) frame,
    longitude east-positive. The observer sits `mast_height_m` above the local terrain.
    """

    lat_deg: float
    lon_deg: float
    mast_height_m: float = 2.0
    name: str = ""

    def __post_init__(self) -> None:
        _check_lat_lon("Site", self.lat_deg, self.lon_deg)


@dataclass(frozen=True, slots=True)
class GroundStation:
    """Earth ground station. Geodetic WGS84 latitude/longitude, east-positive, height above ellipsoid."""

    name: str
    lat_deg: float
    lon_deg: float
    alt_m: float
    min_elevation_deg: float = 10.0
    network: str = ""

    def __post_init__(self) -> None:
        _check_lat_lon("GroundStation", self.lat_deg, self.lon_deg)


@dataclass(frozen=True, slots=True)
class HorizonProfile:
    """Terrain horizon seen from a site.

    Azimuth is clockwise from local north (0 = N, 90 = E), uniformly sampled with
    az_deg[0] == 0 and step 360/N. Elevation is measured from the plane perpendicular
    to the Moon-centre radial through the observer. `elev_lo_deg <= elev_deg <= elev_hi_deg`
    bracket the true horizon of the source terrain model (algorithmic bounds only).
    `blocker_dist_m` is the great-circle distance to the terrain sample that sets `elev_deg`.
    """

    site: Site
    ground_height_m: float
    az_deg: np.ndarray
    elev_deg: np.ndarray
    elev_lo_deg: np.ndarray
    elev_hi_deg: np.ndarray
    blocker_dist_m: np.ndarray
    provenance: dict = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class TargetTrack:
    """Apparent direction of a target from a site over time (same local frame as HorizonProfile)."""

    et: np.ndarray
    az_deg: np.ndarray
    el_deg: np.ndarray
    range_km: np.ndarray
    ang_radius_deg: np.ndarray
