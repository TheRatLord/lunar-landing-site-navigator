"""Terrain derivatives for planners: slope at a baseline and shaded relief."""

from __future__ import annotations

import numpy as np

from lunarnav.constants import R_MOON_M
from lunarnav.terrain.stack import TerrainStack, destination


def slope_at(stack: TerrainStack, lat_deg: float, lon_deg: float, baseline_m: float = 20.0) -> dict:
    """Slope of the terrain relative to the local horizontal plane, from a central difference at ``baseline_m``.

    Heights at ``baseline_m`` north/south/east/west (great-circle) are converted to the local frame
    (``z = (R+h) cos(theta) - (R+h0)``, ``x = (R+h) sin(theta)``) so the sphere's curvature is not
    mistaken for slope.  Returns ``slope_deg``, ``aspect_deg`` (azimuth the slope faces, i.e. the downhill
    direction, clockwise from north) and the centre height; NaN if any sample is outside the data.
    """
    h0 = float(stack.height(lat_deg, lon_deg)[0])
    pts = [destination(lat_deg, lon_deg, az, baseline_m) for az in (0.0, 90.0, 180.0, 270.0)]
    h = np.array([float(stack.height(la, lo)[0]) for la, lo in pts])
    th = baseline_m / R_MOON_M
    z = (R_MOON_M + h) * np.cos(th) - (R_MOON_M + h0)
    x = (R_MOON_M + h) * np.sin(th)
    d_north = (z[0] - z[2]) / (x[0] + x[2])
    d_east = (z[1] - z[3]) / (x[1] + x[3])
    slope = float(np.degrees(np.arctan(np.hypot(d_north, d_east))))
    aspect = float(np.degrees(np.arctan2(-d_east, -d_north)) % 360.0)
    return {"height_m": h0, "slope_deg": slope, "aspect_deg": aspect, "baseline_m": baseline_m}


def hillshade(z: np.ndarray, dx_m: float, dy_m: float, azimuth_deg: float = 315.0, altitude_deg: float = 45.0) -> np.ndarray:
    """Lambertian hillshade 0..1 of a height raster.  ``azimuth_deg`` is clockwise from the raster's +y axis
    (up in a north-up image; in polar grids "up" is the +y map axis, not geographic north).
    """
    gy, gx = np.gradient(z.astype(np.float64), dy_m, dx_m)
    gx_e, gy_n = gx, -gy
    az, alt = np.radians(azimuth_deg), np.radians(altitude_deg)
    nx, ny, nz = -gx_e, -gy_n, 1.0
    norm = np.sqrt(nx**2 + ny**2 + nz**2)
    lx, ly, lz = np.sin(az) * np.cos(alt), np.cos(az) * np.cos(alt), np.sin(alt)
    return np.clip((nx * lx + ny * ly + nz * lz) / norm, 0.0, 1.0).astype(np.float32)
