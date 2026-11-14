"""Site features shared by past landings and candidates, for `similar_past_landings`.

Every feature is computed the same way for a past site and a candidate, from the stock terrain stack and the SPICE
Sun direction at the landing time. Past-site features are precomputed with ``lunarnav history-features`` into
``<data>/history_features.json``; a feature that cannot be computed (no terrain, no landing time) is ``None``.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np

from lunarnav.terrain.paths import data_root
from lunarnav.types import Site

MOON_RADIUS_M = 1_737_400.0
SLOPE_BASELINE_M = 20.0
DISC_RADIUS_M = 300.0
RELIEF_RADIUS_M = 1000.0
FEATURES = ("abs_lat_deg", "slope_deg", "slope_p95_300m_deg", "local_relief_1km_m", "sun_elev_deg",
            "sun_margin_deg", "terrain_resolution_m")
"""Feature names in a fixed order. ``sun_margin_deg`` is the Sun centre's height above the terrain horizon at the
Sun's azimuth (negative: the site is in terrain shadow)."""
COMPARED = ("abs_lat_deg", "slope_deg", "slope_p95_300m_deg", "local_relief_1km_m", "sun_elev_deg", "sun_margin_deg")


def features_path() -> Path:
    return data_root() / "history_features.json"


def _disc(lat: float, lon: float, radius_m: float, rings: int = 3, per_ring: int = 12) -> tuple[np.ndarray, np.ndarray]:
    lats, lons = [lat], [lon]
    coslat = max(math.cos(math.radians(lat)), 1e-3)
    for k in range(1, rings + 1):
        r = radius_m * k / rings
        for j in range(per_ring):
            a = 2 * math.pi * j / per_ring
            lats.append(lat + math.degrees(r * math.cos(a) / MOON_RADIUS_M))
            lons.append(lon + math.degrees(r * math.sin(a) / (MOON_RADIUS_M * coslat)))
    return np.array(lats), np.array(lons)


def _finite(x: Any) -> float | None:
    return None if x is None or not math.isfinite(float(x)) else round(float(x), 3)


def site_features(provider: Any, lat_deg: float, lon_deg: float, landing_utc: str | None) -> dict[str, float | None]:
    """Features of one site from a terrain provider (``TerrainProvider``) and the landing time."""
    from lunarnav.ephem import utc_to_et
    from lunarnav.ephem.kernels import load_kernels
    from lunarnav.ephem.tracks import sun_track

    out: dict[str, float | None] = dict.fromkeys(FEATURES)
    out["abs_lat_deg"] = round(abs(lat_deg), 3)
    stack = provider.stack
    h, idx = stack.height_and_store(lat_deg, lon_deg)
    i = int(idx[0])
    if i < 0 or not math.isfinite(float(h[0])):
        return out
    out["terrain_resolution_m"] = _finite(stack.stores[i].pixel_size_m)
    out["slope_deg"] = _finite(provider.slope_deg(lat_deg, lon_deg, SLOPE_BASELINE_M))
    lats, lons = _disc(lat_deg, lon_deg, DISC_RADIUS_M)
    slopes = [s for s in (provider.slope_deg(a, b, SLOPE_BASELINE_M) for a, b in zip(lats, lons)) if s is not None]
    out["slope_p95_300m_deg"] = _finite(np.percentile(slopes, 95)) if slopes else None
    rl, ro = _disc(lat_deg, lon_deg, RELIEF_RADIUS_M, rings=4, per_ring=16)
    heights = stack.height(rl, ro)
    heights = heights[np.isfinite(heights)]
    out["local_relief_1km_m"] = _finite(heights.max() - heights.min()) if heights.size else None
    if landing_utc:
        load_kernels()
        site = Site(lat_deg=lat_deg, lon_deg=lon_deg, mast_height_m=2.0, name="")
        track = sun_track(site, float(h[0]), np.atleast_1d(utc_to_et(landing_utc)))
        el, az = float(track.el_deg[0]), float(track.az_deg[0])
        out["sun_elev_deg"] = _finite(el)
        prof = provider.horizon(site)
        hz = float(np.interp(az % 360.0, np.append(prof.az_deg, 360.0), np.append(prof.elev_deg, prof.elev_deg[0])))
        out["sun_margin_deg"] = _finite(el - hz)
    return out


def load_features() -> dict[str, dict[str, Any]]:
    """Precomputed past-site features keyed by mission id (empty if not computed yet)."""
    p = features_path()
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def nearest(candidate: dict[str, float | None], past: dict[str, dict[str, Any]], top_k: int) -> list[dict[str, Any]]:
    """Past missions closest to ``candidate``: z-scored Euclidean distance over the features both have.

    A feature is ``matched`` when the two values lie within half a standard deviation (over the past sites).
    """
    sd: dict[str, float] = {}
    for f in COMPARED:
        vals = [p["features"][f] for p in past.values() if p["features"].get(f) is not None]
        sd[f] = float(np.std(vals)) if len(vals) > 1 and float(np.std(vals)) > 0 else 1.0
    rows = []
    for mid, p in past.items():
        shared = [f for f in COMPARED if candidate.get(f) is not None and p["features"].get(f) is not None]
        if not shared:
            continue
        z = [(candidate[f] - p["features"][f]) / sd[f] for f in shared]
        rows.append({"mission_id": mid, "distance": round(math.sqrt(sum(v * v for v in z) / len(z)), 3),
                     "matched": [f for f, v in zip(shared, z) if abs(v) <= 0.5], "compared": shared})
    rows.sort(key=lambda r: r["distance"])
    return rows[:top_k]
