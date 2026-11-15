"""Brute-force horizon references used only for verification (no pyramid, no pruning).

``ray_reference`` (R1)
    Dense sampling along the exact great-circle ray of the composite bilinear surface.  Every sample is a
    point of the surface, so R1 is a valid lower bound of the true horizon: ``R1 <= elev_hi`` must hold
    always, and ``R1 <= elev_lo + tol`` for the engine's ray tolerance.  Its own error is the sampling
    miss between steps (reported as ``R1 - elev``, expected slightly negative).
``pixel_reference`` (R2)
    Every native pixel centre of every store within range, binned by azimuth (+- half bin) and reduced to
    the maximum elevation.  Independent of ray tracing and of the pyramid; also a lower bound of the
    bin-wide supremum, so ``R2 <= elev_hi`` must hold; it can lie below ``elev_lo`` (pixel centres miss
    the exact ray).
"""

from __future__ import annotations

import math

import numpy as np
from numba import njit, prange

from lunarnav.constants import R_MOON_M
from lunarnav.horizon._march import elev
from lunarnav.horizon.engine import near_field_start_m, observer_frames
from lunarnav.terrain._kernels import composite_height_rc
from lunarnav.terrain.stack import TerrainStack, destination


@njit(cache=True, parallel=True)
def _rays(par, ptrs, shapes, o, n, e, ro, radius, az, th, out_e, out_th):
    for k in prange(az.shape[0]):
        ca, sa = math.cos(az[k]), math.sin(az[k])
        best = -math.pi / 2
        bt = np.nan
        for t in th:
            ct, st = math.cos(t), math.sin(t)
            vx = ct * o[0] + st * (ca * n[0] + sa * e[0])
            vy = ct * o[1] + st * (ca * n[1] + sa * e[1])
            vz = ct * o[2] + st * (ca * n[2] + sa * e[2])
            h, _ = composite_height_rc(par, ptrs, shapes, vx, vy, vz)
            if math.isfinite(h):
                v = elev(radius + h, t, ro)
                if v > best:
                    best = v
                    bt = t
        out_e[k] = best
        out_th[k] = bt


def ray_reference(
    stack: TerrainStack,
    lat_deg: float,
    lon_deg: float,
    mast_height_m: float,
    az_deg: np.ndarray,
    max_range_m: float,
    step_floor_m: float = 1.25,
    step_rel: float = 1e-3,
) -> tuple[np.ndarray, np.ndarray]:
    """R1: exact-ray dense sampling from the engine's near-field start.  Step = ``max(step_floor_m, d * step_rel)``.

    Returns (elev_deg, dist_m)."""
    hg = float(stack.height(lat_deg, lon_deg)[0])
    ro = R_MOON_M + hg + mast_height_m
    d = [max(step_floor_m, float(near_field_start_m(stack, lat_deg, lon_deg)[0]))]
    while d[-1] < max_range_m:
        d.append(d[-1] + max(step_floor_m, d[-1] * step_rel))
    th = np.array(d) / R_MOON_M
    up, north, east = observer_frames(np.array([lat_deg]), np.array([lon_deg]))
    pk = stack.pack(lat_deg, lon_deg, max_range_m * 1.05)
    az = np.radians(np.asarray(az_deg, dtype=np.float64))
    out_e = np.empty(len(az))
    out_t = np.empty(len(az))
    _rays(*pk.args(), up[0], north[0], east[0], ro, R_MOON_M, az, th, out_e, out_t)
    out_e[out_e <= -math.pi / 2 + 1e-12] = np.nan
    return np.degrees(out_e), out_t * R_MOON_M


@njit(cache=True, parallel=True)
def _eval_composite(par, ptrs, shapes, v, out):
    for i in prange(v.shape[0]):
        out[i], _ = composite_height_rc(par, ptrs, shapes, v[i, 0], v[i, 1], v[i, 2])


def pixel_reference(
    stack: TerrainStack,
    lat_deg: float,
    lon_deg: float,
    mast_height_m: float,
    n_az: int,
    max_range_m: float,
    chunk: int = 2_000_000,
) -> np.ndarray:
    """R2: max elevation (deg) per azimuth bin over all native pixel centres within ``max_range_m``."""
    hg = float(stack.height(lat_deg, lon_deg)[0])
    ro = R_MOON_M + hg + mast_height_m
    up, north, east = observer_frames(np.array([lat_deg]), np.array([lon_deg]))
    up, north, east = up[0], north[0], east[0]
    pk = stack.pack(lat_deg, lon_deg, max_range_m * 1.05)
    th_max = max_range_m / R_MOON_M
    th_min = float(near_field_start_m(stack, lat_deg, lon_deg)[0]) / R_MOON_M
    best = np.full(n_az, -90.0)
    ring = np.linspace(0, 360, 361)
    for dem_id in pk.dem_ids:
        g = stack.store(dem_id).geometry
        rl, ro_ = destination(lat_deg, lon_deg, ring, max_range_m * 1.02)
        rows, cols = g.lonlat_to_rc(np.append(rl, lat_deg), np.append(ro_, lon_deg))
        r0, r1 = max(int(np.floor(rows.min())), 0), min(int(np.ceil(rows.max())) + 1, g.nrows)
        if g.periodic:
            c0 = int(np.floor(np.min(np.unwrap(cols * 2 * np.pi / g.ncols)) * g.ncols / (2 * np.pi)))
            c1 = int(np.ceil(np.max(np.unwrap(cols * 2 * np.pi / g.ncols)) * g.ncols / (2 * np.pi))) + 1
            c1 = min(c1, c0 + g.ncols)
        else:
            c0, c1 = max(int(np.floor(cols.min())), 0), min(int(np.ceil(cols.max())) + 1, g.ncols)
        if r1 <= r0 or c1 <= c0:
            continue
        cc = np.arange(c0, c1, dtype=np.float64)
        step = max(1, chunk // max(len(cc), 1))
        for ra in range(r0, r1, step):
            rr = np.arange(ra, min(ra + step, r1), dtype=np.float64)
            R_, C_ = np.meshgrid(rr, cc, indexing="ij")
            la, lo = g.rc_to_lonlat(R_.ravel(), C_.ravel())
            v = np.stack(np.broadcast_arrays(*(np.atleast_1d(x) for x in _vec(la, lo))), axis=-1)
            cos_t = np.clip(v @ up, -1, 1)
            th = np.arccos(cos_t)
            ok = (th >= th_min) & (th <= th_max)
            if not ok.any():
                continue
            v = np.ascontiguousarray(v[ok])
            th = th[ok]
            h = np.empty(len(v))
            _eval_composite(*pk.args(), v, h)
            good = np.isfinite(h)
            v, th, h = v[good], th[good], h[good]
            az = np.degrees(np.arctan2(v @ east, v @ north)) % 360.0
            e = np.degrees(np.arctan2((R_MOON_M + h) * np.cos(th) - ro, (R_MOON_M + h) * np.sin(th)))
            b = np.rint(az / (360.0 / n_az)).astype(int) % n_az
            np.maximum.at(best, b, e)
    best[best <= -89.999] = np.nan
    return best


def _vec(lat, lon):
    la, lo = np.radians(lat), np.radians(lon)
    return np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)


__all__ = ["pixel_reference", "ray_reference"]
