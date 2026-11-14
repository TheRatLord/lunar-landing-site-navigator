"""Blocker attribution: which terrain point sets the horizon at a given azimuth."""

from __future__ import annotations

import numpy as np

from lunarnav.terrain.stack import TerrainStack, destination
from lunarnav.types import HorizonProfile


def blocker_point(profile: HorizonProfile, stack: TerrainStack, az_deg: float) -> dict:
    """Latitude, longitude and height of the terrain sample that sets ``elev_lo_deg`` at ``az_deg``.

    ``az_deg`` is snapped to the nearest profile azimuth.  The point lies on the great circle from the
    site at that azimuth, ``blocker_dist_m`` away.  Returns ``dist_m``/``height_m``/``lat_deg``/``lon_deg``
    plus the profile azimuth and elevation; all values are NaN if the profile has no terrain data there.
    """
    n = len(profile.az_deg)
    k = int(round((az_deg % 360.0) / (360.0 / n))) % n
    d = float(profile.blocker_dist_m[k])
    out = {"az_deg": float(profile.az_deg[k]), "elev_deg": float(profile.elev_deg[k]), "dist_m": d}
    if not np.isfinite(d):
        return out | {"lat_deg": np.nan, "lon_deg": np.nan, "height_m": np.nan}
    lat, lon = destination(profile.site.lat_deg, profile.site.lon_deg, profile.az_deg[k], d)
    h = float(stack.height(lat, lon)[0])
    return out | {"lat_deg": float(lat), "lon_deg": float(lon), "height_m": h}


def blocker_points(profile: HorizonProfile, stack: TerrainStack) -> dict[str, np.ndarray]:
    """Vectorised :func:`blocker_point`: the limiting terrain sample of every profile azimuth.

    Returns arrays of the profile's length: ``lat_deg``, ``lon_deg``, ``height_m`` (NaN where the profile has no
    terrain data) and ``store_index`` (index into ``stack.stores`` of the store supplying the height, -1 if none).
    Feed ``lat_deg``/``lon_deg`` to ``stack.error_at`` for the per-azimuth error budget.
    """
    d = np.asarray(profile.blocker_dist_m, dtype=np.float64)
    ok = np.isfinite(d)
    lat = np.full(d.shape, np.nan)
    lon = np.full(d.shape, np.nan)
    h = np.full(d.shape, np.nan)
    si = np.full(d.shape, -1, dtype=np.int64)
    if ok.any():
        la, lo = destination(profile.site.lat_deg, profile.site.lon_deg, np.asarray(profile.az_deg)[ok], d[ok])
        lat[ok], lon[ok] = la, lo
        h[ok], si[ok] = stack.height_and_store(la, lo)
    return {"lat_deg": lat, "lon_deg": lon, "height_m": h, "store_index": si}
