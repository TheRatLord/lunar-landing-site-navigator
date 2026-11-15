"""Terrain horizon computation: public API.

Geometry is on the sphere (R = 1737.4 km): terrain heights are radii ``R + h``, rays are great
circles from the observer, and elevation is measured from the plane perpendicular to the observer's
radial (see ``_march`` for the maths and the bounding argument).

Per azimuth ``az_k = k * 360/n_az`` three numbers are produced:

``elev_lo_deg``
    the highest terrain *sample* found on the exact ray (a point of the bilinear surface), so the true
    horizon at ``az_k`` of the source model is >= this value;
``elev_hi_deg``
    a rigorous upper bound of the horizon over the whole bin ``az_k +- 180/n_az`` (max statistics of the
    pyramid over footprints covering every terrain point the bin spans);
``elev_deg``
    the best estimate of the ray horizon: the middle of ``[lo, ray upper bound]`` where the ray upper bound
    is within ``ray_tol_deg`` of ``lo`` apart from sub-pixel nodes.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import math
import os
from collections.abc import Iterator, Sequence
from pathlib import Path

import numba
import numpy as np

from lunarnav.constants import HORIZON_READ_THREADS, R_MOON_M
from lunarnav.horizon import _march
from lunarnav.horizon.seams import seam_provenance
from lunarnav.terrain.paths import horizon_cache_dir
from lunarnav.terrain.stack import TerrainStack, angular_distance, mutual_visibility_range_m
from lunarnav.types import HorizonProfile, Site

ENGINE_VERSION = "horizon-bnb/4"
DEFAULT_TOL_DEG = 0.01
DEFAULT_RAY_TOL_DEG = 0.005
DEFAULT_LEAF_DIV = 256.0
DEFAULT_N_SEED = 32
CHUNK_SITES = 512
NEAR_FIELD_START_M = 1.0
READ_THREADS_MAX_SITES = 8


@contextlib.contextmanager
def _solver_threads(n_sites: int) -> Iterator[None]:
    current = numba.get_num_threads()
    want = current
    if n_sites <= READ_THREADS_MAX_SITES:
        want = max(current, min(HORIZON_READ_THREADS, numba.config.NUMBA_NUM_THREADS))
    if want == current:
        yield
        return
    try:
        numba.set_num_threads(want)
    except ValueError:
        yield
        return
    try:
        yield
    finally:
        numba.set_num_threads(current)


def observer_frames(lat_deg: np.ndarray, lon_deg: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Up, North, East unit vectors (ME frame) at each point; at a pole north follows from the longitude."""
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    sl, cl, so, co = np.sin(lat), np.cos(lat), np.sin(lon), np.cos(lon)
    up = np.stack([cl * co, cl * so, sl], axis=-1)
    north = np.stack([-sl * co, -sl * so, cl], axis=-1)
    east = np.stack([-so, co, np.zeros_like(so)], axis=-1)
    return np.ascontiguousarray(up), np.ascontiguousarray(north), np.ascontiguousarray(east)


def _solve(
    lat, lon, mast, stack: TerrainStack, az_rad: np.ndarray, hw_rad: float, max_range_km, tol_deg, ray_tol_deg, leaf_div,
    min_range_m, n_seed,
) -> dict[str, np.ndarray]:  # fmt: skip
    """Shared batch driver: ``az_rad`` is ``(n_sites, k)``; the wedge half width is ``hw_rad`` (0: rays only)."""
    ns = len(lat)
    hg = stack.height(lat, lon)
    if not np.all(np.isfinite(hg)):
        bad = np.flatnonzero(~np.isfinite(hg))[0]
        raise ValueError(f"site ({lat[bad]:.5f}, {lon[bad]:.5f}) is not covered by the terrain stack")
    ro = R_MOON_M + hg + mast
    up, north, east = observer_frames(lat, lon)
    th_start = np.full(ns, max(float(min_range_m), NEAR_FIELD_START_M) / R_MOON_M)
    rng = np.array([mutual_visibility_range_m(h, stack.height_min_m, stack.height_max_m) for h in hg + mast])
    if max_range_km is not None:
        rng = np.minimum(rng, max_range_km * 1000.0)
    th_max = np.minimum(rng / R_MOON_M, 1.0)
    centre = up.mean(axis=0)
    centre /= np.linalg.norm(centre)
    clat, clon = math.degrees(math.asin(centre[2])), math.degrees(math.atan2(centre[1], centre[0]))
    spread = float(np.max(angular_distance(clat, clon, lat, lon))) * R_MOON_M
    pk = stack.pack(clat, clon, spread + float(rng.max()) * 1.05)
    shape = az_rad.shape
    lo, ray_hi, hi, blk = (np.empty(shape) for _ in range(4))
    nodes = np.empty(shape, np.int32)
    nodata = np.empty(shape, np.int32)
    with _solver_threads(ns):
        _march.solve_batch(
            *pk.args(), up, north, east, ro, th_start, th_max, R_MOON_M, np.array(az_rad, dtype=np.float64, order="C"), hw_rad,
            math.radians(tol_deg), math.radians(ray_tol_deg), leaf_div, int(n_seed), lo, ray_hi, hi, blk, nodes, nodata,
        )  # fmt: skip
    empty = lo <= -0.5 * math.pi + 1e-12
    est = np.degrees(0.5 * (lo + ray_hi))
    lo_d, hi_d = np.degrees(lo), np.degrees(hi)
    for arr in (est, lo_d, hi_d):
        arr[empty] = np.nan
    return {
        "elev_deg": est,
        "elev_lo_deg": lo_d,
        "elev_hi_deg": hi_d,
        "blocker_dist_m": np.where(empty, np.nan, blk * R_MOON_M),
        "nodes": nodes,
        "nodata": nodata,
        "ground_height_m": hg,
        "max_range_m": rng,
    }


def _site_arrays(lat_deg, lon_deg, mast_height_m) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    lat = np.atleast_1d(np.asarray(lat_deg, dtype=np.float64))
    lon = np.atleast_1d(np.asarray(lon_deg, dtype=np.float64))
    return lat, lon, np.broadcast_to(np.asarray(mast_height_m, dtype=np.float64), lat.shape)


def horizon_arrays(
    lat_deg,
    lon_deg,
    mast_height_m,
    stack: TerrainStack,
    n_az: int = 720,
    max_range_km: float | None = None,
    tol_deg: float = DEFAULT_TOL_DEG,
    ray_tol_deg: float = DEFAULT_RAY_TOL_DEG,
    leaf_div: float = DEFAULT_LEAF_DIV,
    min_range_m: float = 0.0,
    n_seed: int = DEFAULT_N_SEED,
) -> dict[str, np.ndarray]:
    """Array-level batch kernel: no objects, no cache.  Returns arrays shaped ``(n_sites, n_az)``.

    Keys: ``elev_deg``, ``elev_lo_deg``, ``elev_hi_deg``, ``blocker_dist_m`` (NaN where the terrain has no
    data), ``nodes`` (work counter), ``nodata`` (nodes with no terrain data) and per-site ``ground_height_m``,
    ``max_range_m``.  Raises ``ValueError`` if a site is not covered by the stack.  Terrain closer than
    ``min_range_m`` to the observer is ignored (default 0: the search starts ``NEAR_FIELD_START_M`` out).
    ``n_seed`` exact samples along each ray seed the lower bound (pruning only; the bracket is unaffected).
    """
    lat, lon, mast = _site_arrays(lat_deg, lon_deg, mast_height_m)
    az = np.broadcast_to(np.arange(n_az) * (2.0 * math.pi / n_az), (len(lat), n_az))
    return _solve(lat, lon, mast, stack, az, math.pi / n_az, max_range_km, tol_deg, ray_tol_deg, leaf_div, min_range_m, n_seed)


def horizon_arrays_at(
    lat_deg,
    lon_deg,
    mast_height_m,
    stack: TerrainStack,
    az_deg,
    bin_half_width_deg: float,
    max_range_km: float | None = None,
    tol_deg: float = DEFAULT_TOL_DEG,
    ray_tol_deg: float = DEFAULT_RAY_TOL_DEG,
    leaf_div: float = DEFAULT_LEAF_DIV,
    min_range_m: float = 0.0,
    n_seed: int = DEFAULT_N_SEED,
) -> dict[str, np.ndarray]:
    """Horizon at chosen azimuths: ``az_deg`` is ``(n_sites, k)`` (clockwise from north, per-site values).

    Same outputs and semantics as :func:`horizon_arrays` but shaped ``(n_sites, k)``; ``elev_hi_deg`` bounds the
    horizon over ``az +- bin_half_width_deg`` (0: the ray only, ``hi`` is then the ray upper bound).
    """
    lat, lon, mast = _site_arrays(lat_deg, lon_deg, mast_height_m)
    az = np.asarray(az_deg, dtype=np.float64)
    if az.ndim != 2 or az.shape[0] != len(lat):
        raise ValueError("az_deg must have shape (n_sites, k)")
    return _solve(
        lat, lon, mast, stack, np.radians(az), math.radians(bin_half_width_deg), max_range_km, tol_deg, ray_tol_deg,
        leaf_div, min_range_m, n_seed,
    )  # fmt: skip


def _provenance(stack: TerrainStack, site: Site, n_az, max_range_km, tol_deg, ray_tol_deg, leaf_div, min_range_m, n_seed, out, i) -> dict:
    _, gs = stack.height_and_store(site.lat_deg, site.lon_deg)
    gi = int(gs[0])
    row = stack.error_table()[gi] if gi >= 0 else None
    sz, sxy, _ = stack.error_at(site.lat_deg, site.lon_deg)
    return {
        "ground_store": stack.stores[gi].dem_id if gi >= 0 else None,
        "ground_error": None if row is None else {
            "sigma_z_m": float(sz[0]), "sigma_xy_m": float(sxy[0]), "basis_z": row["basis_z"], "basis_xy": row["basis_xy"],
        },
        "near_field_seam": seam_provenance(stack, site.lat_deg, site.lon_deg, out["elev_lo_deg"][i], out["elev_hi_deg"][i]),
        "store_order": [s.dem_id for s in stack.stores],
        "engine": ENGINE_VERSION,
        "n_az": n_az,
        "max_range_km": None if max_range_km is None else float(max_range_km),
        "max_range_used_m": float(out["max_range_m"][i]),
        "tol_deg": tol_deg,
        "ray_tol_deg": ray_tol_deg,
        "leaf_div": leaf_div,
        "min_range_m": float(min_range_m),
        "n_seed": int(n_seed),
        "stack_hash": stack.stack_hash,
        "terrain_hashes": {s.dem_id: s.meta_hash for s in stack.stores},
        "terrain_sources": {s.dem_id: s.meta["source"]["sha256"] for s in stack.stores},
        "nodes_evaluated": int(out["nodes"][i].sum()),
        "nodes_without_data": int(out["nodata"][i].sum()),
        "mast_height_m": site.mast_height_m,
    }


def _cache_key(site: Site, stack: TerrainStack, n_az, max_range_km, tol_deg, ray_tol_deg, leaf_div, min_range_m, n_seed) -> str:
    payload = {
        "v": ENGINE_VERSION,
        "lat": round(site.lat_deg, 10),
        "lon": round(site.lon_deg, 10),
        "mast": site.mast_height_m,
        "n_az": n_az,
        "rng": max_range_km,
        "tol": tol_deg,
        "rtol": ray_tol_deg,
        "leaf": leaf_div,
        "minr": float(min_range_m),
        "seed": int(n_seed),
        "stack": stack.stack_hash,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def _cache_path(root: Path, key: str) -> Path:
    return root / key[:2] / f"{key}.npz"


def _cache_load(root: Path, key: str, site: Site) -> HorizonProfile | None:
    p = _cache_path(root, key)
    if not p.exists():
        return None
    try:
        with np.load(p, allow_pickle=False) as z:
            return HorizonProfile(
                site=site,
                ground_height_m=float(z["ground_height_m"]),
                az_deg=z["az_deg"],
                elev_deg=z["elev_deg"],
                elev_lo_deg=z["elev_lo_deg"],
                elev_hi_deg=z["elev_hi_deg"],
                blocker_dist_m=z["blocker_dist_m"],
                provenance=json.loads(str(z["provenance"])),
            )
    except (OSError, ValueError, KeyError):
        return None


def _cache_store(root: Path, key: str, prof: HorizonProfile) -> None:
    p = _cache_path(root, key)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(f".{os.getpid()}.tmp.npz")
    np.savez_compressed(
        tmp,
        ground_height_m=np.float64(prof.ground_height_m),
        az_deg=prof.az_deg,
        elev_deg=prof.elev_deg,
        elev_lo_deg=prof.elev_lo_deg,
        elev_hi_deg=prof.elev_hi_deg,
        blocker_dist_m=prof.blocker_dist_m,
        provenance=np.array(json.dumps(prof.provenance)),
    )
    os.replace(tmp, p)


def compute_horizons(
    sites: Sequence[Site],
    stack: TerrainStack,
    n_az: int = 720,
    max_range_km: float | None = None,
    tol_deg: float = DEFAULT_TOL_DEG,
    ray_tol_deg: float = DEFAULT_RAY_TOL_DEG,
    leaf_div: float = DEFAULT_LEAF_DIV,
    min_range_m: float = 0.0,
    n_seed: int = DEFAULT_N_SEED,
    use_cache: bool = True,
    cache_dir: str | Path | None = None,
) -> list[HorizonProfile]:
    """Horizon profiles for many sites (parallel Numba; cached on disk by site, parameters and terrain hashes).

    ``max_range_km`` caps the search range; by default the mutual-visibility distance for the stack's
    height range is used (``mutual_visibility_range_m``).  ``min_range_m`` excludes the terrain closer than that
    to the observer (the lander's immediate footprint); the default 0 searches from ``NEAR_FIELD_START_M``.
    """
    cache = (Path(cache_dir) if cache_dir else horizon_cache_dir()) if use_cache else None
    keys = [_cache_key(s, stack, n_az, max_range_km, tol_deg, ray_tol_deg, leaf_div, min_range_m, n_seed) for s in sites]
    result: list[HorizonProfile | None] = [None] * len(sites)
    todo = []
    for i, (s, k) in enumerate(zip(sites, keys, strict=True)):
        hit = _cache_load(cache, k, s) if cache else None
        if hit is not None:
            result[i] = hit
        else:
            todo.append(i)
    az_deg = np.arange(n_az) * (360.0 / n_az)
    for c0 in range(0, len(todo), CHUNK_SITES):
        idx = todo[c0 : c0 + CHUNK_SITES]
        sub = [sites[i] for i in idx]
        out = horizon_arrays(
            [s.lat_deg for s in sub], [s.lon_deg for s in sub], [s.mast_height_m for s in sub], stack,
            n_az, max_range_km, tol_deg, ray_tol_deg, leaf_div, min_range_m, n_seed,
        )  # fmt: skip
        for j, i in enumerate(idx):
            prof = HorizonProfile(
                site=sites[i],
                ground_height_m=float(out["ground_height_m"][j]),
                az_deg=az_deg,
                elev_deg=out["elev_deg"][j],
                elev_lo_deg=out["elev_lo_deg"][j],
                elev_hi_deg=out["elev_hi_deg"][j],
                blocker_dist_m=out["blocker_dist_m"][j],
                provenance=_provenance(stack, sites[i], n_az, max_range_km, tol_deg, ray_tol_deg, leaf_div, min_range_m, n_seed, out, j),
            )
            result[i] = prof
            if cache:
                _cache_store(cache, keys[i], prof)
    return result  # type: ignore[return-value]


def compute_horizon(
    site: Site,
    stack: TerrainStack,
    n_az: int = 720,
    max_range_km: float | None = None,
    **kwargs,
) -> HorizonProfile:
    """Horizon profile for one site; see ``compute_horizons`` for the keyword options."""
    return compute_horizons([site], stack, n_az=n_az, max_range_km=max_range_km, **kwargs)[0]
