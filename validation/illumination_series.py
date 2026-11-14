"""Illumination statistics for arbitrary sites from horizons: the layer kernel applied outside a region grid.

``stats_for_sites`` gives, per site, the time fractions the published rasters define (any part of the Sun's disc
above the horizon; any part of the Earth's disc), plus flux, longest runs and sunlit fraction, for an epoch grid.
The same kernel (``lunarnav.regional._kernels.series_stats``) is used by ``compute_layers``.
"""

from __future__ import annotations

import numpy as np

from lunarnav.constants import R_SUN_KM
from lunarnav.horizon.engine import observer_frames
from lunarnav.regional import _kernels as K
from lunarnav.regional.grid import RegionSpec
from lunarnav.regional.tracks import RegionGeometry, build_geometry
from lunarnav.visibility.disc import _gauss_unit


def geometry_for(start_utc: str, stop_utc: str, step_s: float = 3600.0, ref_lat: float = -89.5, ref_lon: float = 200.0) -> RegionGeometry:
    """Ephemeris epoch grid and aberration shift evaluated at a reference point near the south pole (valid over
    a few hundred km; the shift varies by < 1e-9 rad)."""
    from lunarnav.terrain.projection import polar_forward

    x, y = polar_forward(ref_lat, ref_lon, -1)
    spec = RegionSpec(float(x), float(y), 1, 1, 60.0, start_utc, stop_utc, step_s=step_s)
    return build_geometry(spec)


def stats_for_sites(
    lat, lon, ground_h, mast_m: float, hz_deg: np.ndarray, geom: RegionGeometry, *, offsets=(0.0,), sun_rule: str = "any_part",
    earth_rule: str = "any_part", earth_margin_deg: float = 0.0, alpha: float = 0.39, point_sun: bool = False, do_earth: bool = True,
    epoch_stride: int = 1,
) -> tuple[np.ndarray, np.ndarray]:
    """``(out_f, out_i)`` as in ``series_stats`` for sites with horizons ``hz_deg`` (n, n_az), true azimuth.

    ``epoch_stride`` subsamples the geometry's epochs (time-step experiments); ``point_sun`` shrinks the disc to
    a point (radius 1 m) to measure the extended-disc effect.
    """
    lat, lon = np.asarray(lat, float), np.asarray(lon, float)
    up, north, east = observer_frames(lat, lon)
    spos = np.ascontiguousarray(up * ((1737400.0 + np.asarray(ground_h, float) + mast_m) / 1000.0)[:, None])
    gn, gw = _gauss_unit(24)
    sl = slice(None, None, epoch_stride)
    nb = len(offsets)
    out_f = np.empty((len(lat), nb, 5))
    out_i = np.empty((len(lat), nb, 4), np.int64)
    K.series_stats(
        np.ascontiguousarray(hz_deg, dtype=np.float64), np.asarray(offsets, np.float64), up, east, north, spos,
        np.ascontiguousarray(geom.sun_pos[sl]), np.ascontiguousarray(geom.sun_d[sl]), 1e-3 if point_sun else R_SUN_KM,
        np.ascontiguousarray(geom.earth_pos[sl]), np.ascontiguousarray(geom.earth_d[sl]), geom.r_earth_km, bool(do_earth),
        0 if sun_rule == "any_part" else 1, 0 if earth_rule == "centre" else 1, earth_margin_deg, alpha, gn, gw, out_f, out_i,
    )  # fmt: skip
    return out_f, out_i
