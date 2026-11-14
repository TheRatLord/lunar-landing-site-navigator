"""Regional horizons: a tiered, shared-node ray sweep.

For a set of cells the horizon is the maximum over *tiers* of distance.  Tier 0 (cell distances up to ``A_1``)
is marched per cell.  Tier ``t >= 1`` (cell distances ``[A_t, A_t+1)``, ``A_t = q m_t``) is marched once per node of
a coarser grid (stride ``S_t`` cells) over node distances ``[A_t - m_t, A_(t+1) + m_t]`` and interpolated to
each cell bilinearly in the map plane (at the node azimuth with the same map direction, linearly in observer
radius over the ``K`` radii that bracket the cells using the node).  ``m_t = 1.5 S_t`` cell spacings bounds
the node-to-cell distance of the bilinear footprint, so every terrain point is covered by the tier whose
range contains it, from any of the four nodes.  The interpolation error is the neglect of the bearing change
of a blocker between node and cell (at most ``1/q`` rad), measured against the exact engine in
``validation/illumination_regional.py``.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from lunarnav.constants import R_MOON_M
from lunarnav.horizon.engine import observer_frames
from lunarnav.regional import _kernels as K
from lunarnav.regional.grid import Method, RegionSpec
from lunarnav.terrain.stack import PackedStack, TerrainStack, mutual_visibility_range_m, unit_vector


@dataclass(frozen=True, slots=True)
class Tier:
    stride: int
    cell_lo_m: float
    cell_hi_m: float
    node_lo_m: float
    node_hi_m: float


def plan_tiers(spec: RegionSpec, method: Method, range_m: float) -> list[Tier]:
    """Tier boundaries for the region and method (cell distances ``[cell_lo, cell_hi)`` per tier)."""
    sp = spec.spacing_m
    strides = [s for s in method.strides if s >= 1]
    margins = [1.5 * s * sp for s in strides]
    starts = [0.0] + [method.q * m for m in margins[1:]]
    tiers = []
    for t, s in enumerate(strides):
        lo = starts[t]
        if lo >= range_m:
            break
        hi = starts[t + 1] if t + 1 < len(strides) and starts[t + 1] < range_m else range_m
        m = margins[t] if s > 1 else 0.0
        tiers.append(Tier(s, lo, hi, max(lo - m, 1.0), min(hi + m, range_m)))
    return tiers


def ladder(d0: float, d1: float, floor_m: float, kappa: float) -> tuple[np.ndarray, np.ndarray]:
    """Sample distances ``d0 .. d1`` with step ``max(floor, d / kappa)`` and the step at each sample."""
    d = [d0]
    st = []
    while d[-1] < d1:
        s = max(floor_m, d[-1] / kappa)
        st.append(s)
        d.append(d[-1] + s)
    d = np.array(d)
    st = np.array(st + [st[-1] if st else floor_m])
    keep = d <= d1 + st
    return d[keep], st[keep]


def store_pixels(pk: PackedStack, stack: TerrainStack) -> np.ndarray:
    """Native pixel size (map metres, or ground metres for geographic grids) of each store of a packed view."""
    return np.array([stack.store(i).pixel_size_m for i in pk.dem_ids], dtype=np.float64)


def _frames(lat, lon):
    up, north, east = observer_frames(lat, lon)
    return up, north, east


def ground_heights(spec: RegionSpec, stack: TerrainStack, pk: PackedStack, rows, cols) -> np.ndarray:
    """Composite bilinear terrain height (m) at cell centres (NaN where no store has data)."""
    lat, lon = spec.lonlat(rows, cols)
    vec = np.ascontiguousarray(unit_vector(lat, lon))
    return K.heights(*pk.args(), store_pixels(pk, stack), vec)


def range_for(stack: TerrainStack, ro_max_m: float, method: Method) -> float:
    rng = mutual_visibility_range_m(ro_max_m - R_MOON_M, stack.height_min_m, stack.height_max_m)
    if method.max_range_km is not None:
        rng = min(rng, method.max_range_km * 1000.0)
    return rng


CHECK_UNITS = 256
"""Work between two calls of the ``check`` hook: this many (observer, radius) marches, about a second or less at 4 threads on a loaded machine."""


def _march(pk: PackedStack, pxs, up, north, east, ro, caz, saz, ct, sth, preq, out, check, per_item: int = 1) -> None:
    """``K.march`` over blocks of observers; ``check()`` runs before each block (it may raise to cancel).  Every observer is marched
    independently, so the blocks give the same array as one call."""
    n = len(up)
    block = max(1, CHECK_UNITS // per_item)
    for a in range(0, n, block):
        if check is not None:
            check()
        b = min(a + block, n)
        K.march(*pk.args(), pxs, up[a:b], north[a:b], east[a:b], ro[a:b], caz, saz, ct, sth, preq, R_MOON_M, out[a:b])


def tile_horizons(
    spec: RegionSpec, method: Method, stack: TerrainStack, pk: PackedStack, rows: np.ndarray, cols: np.ndarray,
    hg: np.ndarray, range_m: float, check: Callable[[], None] | None = None,
) -> np.ndarray:
    """Horizon elevation (deg, ``(n_cells, n_az)``, true azimuth ``k * 360 / n_az``) for the given cells.

    ``hg`` are the cell ground heights (all finite).  The observer is ``mast_height_m`` above them.  ``check`` is called at least
    every ``CHECK_UNITS`` marches (an exception it raises propagates); the result does not depend on it.
    """
    n_az = method.n_az
    az = np.arange(n_az) * (2.0 * math.pi / n_az)
    caz, saz = np.ascontiguousarray(np.cos(az)), np.ascontiguousarray(np.sin(az))
    pxs = store_pixels(pk, stack)
    floor_m = method.floor_m if method.floor_m is not None else 0.25 * float(pxs.min())
    ro_cell = R_MOON_M + hg + spec.mast_height_m
    lat, lon = spec.lonlat(rows, cols)
    gamma_cell = spec.meridian_gamma_deg(lon)
    hz = np.full((len(rows), n_az), -90.0)
    for tier in plan_tiers(spec, method, range_m):
        d, st = ladder(tier.node_lo_m, tier.node_hi_m, floor_m, method.kappa)
        th = d / R_MOON_M
        ct, sth = np.ascontiguousarray(np.cos(th)), np.ascontiguousarray(np.sin(th))
        preq = np.ascontiguousarray(st)
        if tier.stride == 1:
            up, north, east = _frames(lat, lon)
            out = np.empty((len(rows), 1, n_az))
            _march(pk, pxs, up, north, east, np.ascontiguousarray(ro_cell[:, None]), caz, saz, ct, sth, preq, out, check)
            np.maximum(hz, np.degrees(out[:, 0, :]), out=hz)
            continue
        S = tier.stride
        I0, J0 = rows // S, cols // S
        fi, fj = (rows - I0 * S) / S, (cols - J0 * S) / S
        keys = np.stack([I0, I0, I0 + 1, I0 + 1], 1) * 1_000_003 + np.stack([J0, J0 + 1, J0, J0 + 1], 1)
        wgt = np.stack([(1 - fi) * (1 - fj), (1 - fi) * fj, fi * (1 - fj), fi * fj], 1)
        uniq, inv = np.unique(keys.ravel(), return_inverse=True)
        nidx = inv.reshape(-1, 4)
        nrow, ncol = uniq // 1_000_003 * S, uniq % 1_000_003 * S
        nlat, nlon = spec.lonlat(nrow, ncol)
        ngamma = spec.meridian_gamma_deg(nlon)
        rmin = np.full(len(uniq), np.inf)
        rmax = np.full(len(uniq), -np.inf)
        for q in range(4):
            m = wgt[:, q] > 0
            np.minimum.at(rmin, nidx[m, q], ro_cell[m])
            np.maximum.at(rmax, nidx[m, q], ro_cell[m])
        used = np.isfinite(rmin)
        rmin = np.where(used, rmin, R_MOON_M)
        rmax = np.where(used & (rmax - rmin >= 1.0), rmax, rmin + 1.0)
        node_ro = rmin[:, None] + (rmax - rmin)[:, None] * np.linspace(0.0, 1.0, method.n_radii)[None, :]
        node_ro[~used] = R_MOON_M
        up, north, east = _frames(nlat, nlon)
        far_rad = np.empty((len(uniq), method.n_radii, n_az))
        _march(pk, pxs, up, north, east, np.ascontiguousarray(node_ro), caz, saz, ct, sth, preq, far_rad, check, per_item=method.n_radii)
        K.merge_tier(hz, np.degrees(far_rad), node_ro, ro_cell, gamma_cell, ngamma, nidx.astype(np.int64),
                     np.ascontiguousarray(wgt))
    return hz
