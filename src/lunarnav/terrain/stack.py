"""``TerrainStack``: an ordered set of stores presented as one composite terrain model."""

from __future__ import annotations

import contextlib
import hashlib
import math
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from lunarnav.constants import R_MOON_M
from lunarnav.terrain import _kernels as K
from lunarnav.terrain.paths import store_dir
from lunarnav.terrain.sources import ASSUMED_ERROR, error_for
from lunarnav.terrain.store import TerrainStore


def unit_vector(lat_deg, lon_deg) -> np.ndarray:
    """Planetocentric degrees -> unit vectors ``(..., 3)`` in the ME frame."""
    lat, lon = np.radians(np.asarray(lat_deg, dtype=np.float64)), np.radians(np.asarray(lon_deg, dtype=np.float64))
    return np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], axis=-1)


def angular_distance(lat1, lon1, lat2, lon2) -> np.ndarray:
    """Great-circle angle (radians) between points given in degrees."""
    a, b = unit_vector(lat1, lon1), unit_vector(lat2, lon2)
    cross = np.linalg.norm(np.cross(a, b), axis=-1)
    return np.arctan2(cross, np.sum(a * b, axis=-1))


@dataclass(frozen=True, slots=True)
class PackedStack:
    """Numba-friendly view of a set of stores (see ``_kernels`` for the layout)."""

    par: np.ndarray
    ptrs: np.ndarray
    shapes: np.ndarray
    dem_ids: tuple[str, ...]
    keepalive: tuple

    def args(self) -> tuple:
        """Arguments to pass to the jitted kernels."""
        return self.par, self.ptrs, self.shapes


def bounding_circle(store: TerrainStore, n: int = 64) -> tuple[float, float, float] | None:
    """(lat, lon, angular radius) of a circle containing the store footprint; None for global grids."""
    g = store.geometry
    if g.periodic:
        return None
    t = np.linspace(0, 1, n, endpoint=False)
    r_edge = np.concatenate([np.zeros(n), t * (g.nrows - 1), np.full(n, g.nrows - 1.0), (1 - t) * (g.nrows - 1)])
    c_edge = np.concatenate([t * (g.ncols - 1), np.full(n, g.ncols - 1.0), (1 - t) * (g.ncols - 1), np.zeros(n)])
    lat, lon = g.rc_to_lonlat(r_edge, c_edge)
    lat_c, lon_c = g.rc_to_lonlat((g.nrows - 1) / 2.0, (g.ncols - 1) / 2.0)
    rad = float(np.max(angular_distance(lat_c, lon_c, lat, lon)))
    return float(lat_c), float(lon_c), rad * 1.001 + 1e-6


_BASIS_RANK = {"published": 0, "published-method": 1, "measured": 2, "assumed": 3}


def precedence_key(store: TerrainStore) -> tuple[float, int, float]:
    """Sort key of the stack precedence rule: ``(pixel size, vertical-basis rank, sigma_z)``, smaller wins.

    Equal pixel sizes are ordered by the stated quality of the product, so the track-adjusted PGDA 5 m tiles (published
    sub-metre uncertainty) take precedence over the unadjusted PDS ``lola_875s_5m`` wherever both have data.
    """
    e = error_for(store.dem_id)
    sz = float(store.err_info["median_m"]) if store.err_layer is not None and store.err_info is not None else e.sigma_z_m
    return (store.pixel_size_m, _BASIS_RANK[e.basis_z], sz)


class TerrainStack:
    """Composite terrain: at any point the height comes from the finest store with valid data.

    ``stores`` are ordered by :func:`precedence_key`: finest pixel first; among equal pixel sizes the better stated error
    first (vertical basis ``published``, ``published-method``, ``measured``, ``assumed``; then smaller ``sigma_z``); remaining ties
    keep the input order.
    """

    def __init__(self, stores: Sequence[TerrainStore]):
        if not stores:
            raise ValueError("a TerrainStack needs at least one store")
        self.stores: tuple[TerrainStore, ...] = tuple(sorted(stores, key=precedence_key))
        self.dem_ids: tuple[str, ...] = tuple(s.dem_id for s in self.stores)
        self._circles = [bounding_circle(s) for s in self.stores]
        self._packed: dict[tuple[str, ...], PackedStack] = {}
        lo = [s.meta["height_range_m"][0] for s in self.stores]
        hi = [s.meta["height_range_m"][1] for s in self.stores]
        self.height_min_m = float(min(lo))
        self.height_max_m = float(max(hi))

    @classmethod
    def open(cls, dem_ids: Sequence[str] | None = None, root: str | Path | None = None) -> TerrainStack:
        """Open stores from ``root`` (default ``data/dem/store``); all complete stores if ``dem_ids`` is None."""
        root = Path(root) if root else store_dir()
        ids = list(dem_ids) if dem_ids is not None else sorted(p.parent.name for p in root.glob("*/meta.json"))
        return cls([TerrainStore(root / i) for i in ids])

    @property
    def stack_hash(self) -> str:
        """SHA-256 over the ordered store ``meta.json`` hashes (which embed array and source hashes)."""
        h = hashlib.sha256()
        for s in self.stores:
            h.update(s.meta_hash.encode())
        return h.hexdigest()

    def store(self, dem_id: str) -> TerrainStore:
        return self.stores[self.dem_ids.index(dem_id)]

    def pack(self, lat_deg: float | None = None, lon_deg: float | None = None, radius_m: float | None = None) -> PackedStack:
        """Packed kernels view; restricted to stores that may intersect the disc ``(lat, lon, radius)`` if given."""
        idx = list(range(len(self.stores)))
        if lat_deg is not None:
            ang = (radius_m or 0.0) / R_MOON_M
            idx = []
            for i, c in enumerate(self._circles):
                if c is None or float(angular_distance(lat_deg, lon_deg, c[0], c[1])) <= c[2] + ang:
                    idx.append(i)
        key = tuple(self.dem_ids[i] for i in idx)
        if key not in self._packed:
            self._packed[key] = self._pack([self.stores[i] for i in idx])
        return self._packed[key]

    @contextlib.contextmanager
    def random_reads(self, dem_ids: Sequence[str]) -> Iterator[None]:
        with contextlib.ExitStack() as reads:
            for i in dem_ids:
                reads.enter_context(self.store(i).random_reads())
            yield

    @staticmethod
    def _pack(stores: Sequence[TerrainStore]) -> PackedStack:
        ml = max(s.n_levels for s in stores)
        par = np.zeros((len(stores), K.N_PAR))
        par[:, :10] = np.array([s.geometry.kernel_params() for s in stores])
        par[:, K.P_SINR] = -1.0
        for si, s in enumerate(stores):
            circle = bounding_circle(s)
            if circle is not None and circle[2] < 1.5:
                par[si, K.P_CX : K.P_CZ + 1] = unit_vector(circle[0], circle[1])
                par[si, K.P_COSR], par[si, K.P_SINR] = np.cos(circle[2]), np.sin(circle[2])
        ptrs = np.zeros((len(stores) * ml, 3), np.int64)
        shapes = np.ones((len(stores) * ml, 2), np.int64)
        keep = []
        for si, s in enumerate(stores):
            par[si, K.P_NLEV] = s.n_levels
            par[si, K.P_ML] = ml
            for k in range(s.n_levels):
                for w, arr in enumerate((s.mean[k], s.max[k], s.cov[k])):
                    if arr is None:
                        continue
                    a = np.asarray(arr)
                    keep.append(a)
                    ptrs[si * ml + k, w] = a.ctypes.data
                    if w == 0 or k > 0:
                        shapes[si * ml + k] = a.shape
        return PackedStack(par, ptrs, shapes, tuple(s.dem_id for s in stores), tuple(keep) + tuple(stores))

    def height_and_store(self, lat_deg, lon_deg) -> tuple[np.ndarray, np.ndarray]:
        """Composite height (m, NaN where no store has data) and the index into ``self.stores`` (-1 if none)."""
        lat = np.atleast_1d(np.asarray(lat_deg, dtype=np.float64))
        lon = np.atleast_1d(np.asarray(lon_deg, dtype=np.float64))
        lat, lon = np.broadcast_arrays(lat, lon)
        v = unit_vector(lat.ravel(), lon.ravel())
        pk = self.pack()
        h = np.empty(len(v))
        si = np.empty(len(v), np.int64)
        for i in range(len(v)):
            h[i], si[i] = K.composite_height_rc(pk.par, pk.ptrs, pk.shapes, v[i, 0], v[i, 1], v[i, 2])
        return h.reshape(lat.shape), si.reshape(lat.shape)

    def height(self, lat_deg, lon_deg) -> np.ndarray:
        """Composite bilinear height (m above the 1737.4 km sphere); NaN where no store has data."""
        return self.height_and_store(lat_deg, lon_deg)[0]

    def error_at(self, lat_deg, lon_deg) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """``(sigma_z_m, sigma_xy_m, store_index)`` of the store that supplies the height at each point.

        Same precedence as :meth:`height` (finest store with valid data).  ``sigma_z_m`` is the per-pixel published
        uncertainty of the supplying pixel where the store has an error layer (PGDA ``*_toterr.tif``, see
        ``ingest build-err``), else the product figure of ``terrain.sources.PRODUCT_ERRORS``.  Where no store has
        data (``store_index == -1``) the assumed global budget is returned.  The registry lives in code.
        """
        lat = np.atleast_1d(np.asarray(lat_deg, dtype=np.float64))
        lon = np.atleast_1d(np.asarray(lon_deg, dtype=np.float64))
        lat, lon = np.broadcast_arrays(lat, lon)
        _, si = self.height_and_store(lat, lon)
        sz = np.array([error_for(s.dem_id).sigma_z_m for s in self.stores] + [ASSUMED_ERROR.sigma_z_m])[si]
        sxy = np.array([error_for(s.dem_id).sigma_xy_m for s in self.stores] + [ASSUMED_ERROR.sigma_xy_m])[si]
        for k, s in enumerate(self.stores):
            if s.err_layer is None:
                continue
            m = si == k
            if m.any():
                v = s.layer_error(lat[m], lon[m])
                sz[m] = np.where(np.isfinite(v), v, sz[m])
        return sz, sxy, si

    def error_table(self) -> list[dict]:
        """One row per store (finest first).

        Keys: ``dem_id``, ``sigma_z_m``, ``sigma_xy_m``, ``basis_z``, ``basis_xy``, ``source``, ``note``, ``per_pixel_layer`` (``error_at``
        then returns the per-pixel value and ``sigma_z_m`` is the layer median) and ``sigma_z_origin``.
        """
        rows = []
        for s in self.stores:
            e = error_for(s.dem_id)
            layer = s.err_layer is not None and s.err_info is not None
            rows.append({
                "dem_id": s.dem_id,
                "sigma_z_m": float(s.err_info["median_m"]) if layer else e.sigma_z_m,
                "sigma_xy_m": e.sigma_xy_m,
                "basis_z": e.basis_z,
                "basis_xy": e.basis_xy,
                "source": e.source,
                "note": e.note,
                "per_pixel_layer": layer,
                "sigma_z_origin": "per-pixel layer" if layer else "registry",
            })  # fmt: skip
        return rows

    def select(self, lat_deg: float, lon_deg: float, footprint_m: float = 0.0) -> TerrainStore | None:
        """Finest store with valid data at the point whose valid window also spans ``footprint_m`` around it.

        Returns None if no store covers the point.  The footprint test samples the four compass points
        at ``footprint_m``; a store failing it is skipped in favour of a coarser one.
        """
        for s in self.stores:
            row, col = s.geometry.lonlat_to_rc(lat_deg, lon_deg)
            if not np.isfinite(s.height_rc(row, col)):
                continue
            if footprint_m > 0:
                ok = True
                for az in (0.0, 90.0, 180.0, 270.0):
                    la, lo = destination(lat_deg, lon_deg, az, footprint_m)
                    if not np.isfinite(s.height(la, lo)):
                        ok = False
                        break
                if not ok:
                    continue
            return s
        return None


def destination(lat_deg, lon_deg, az_deg, dist_m, radius_m: float = R_MOON_M):
    """Point reached from ``(lat, lon)`` along the great circle with azimuth ``az_deg`` for ``dist_m`` (degrees)."""
    lat = np.radians(np.asarray(lat_deg, dtype=np.float64))
    lon = np.radians(np.asarray(lon_deg, dtype=np.float64))
    az = np.radians(np.asarray(az_deg, dtype=np.float64))
    d = np.asarray(dist_m, dtype=np.float64) / radius_m
    sl = np.sin(lat) * np.cos(d) + np.cos(lat) * np.sin(d) * np.cos(az)
    lat2 = np.arcsin(np.clip(sl, -1, 1))
    lon2 = lon + np.arctan2(np.sin(az) * np.sin(d) * np.cos(lat), np.cos(d) - np.sin(lat) * sl)
    return np.degrees(lat2), np.mod(np.degrees(lon2), 360.0)


def mutual_visibility_range_m(obs_height_m: float, h_min_m: float, h_max_m: float, radius_m: float = R_MOON_M) -> float:
    """Largest great-circle distance at which any terrain can be seen from an observer.

    The line of sight to a point at height ``h_max`` cannot pass below the lowest terrain ``h_min``
    anywhere on the body (it would be inside the Moon), so with ``Rm = R + h_min`` the angular range is
    ``acos(Rm/(R + h_obs)) + acos(Rm/(R + h_max))`` and the distance is ``R`` times that.
    """
    rm = radius_m + h_min_m
    t1 = math.acos(min(1.0, rm / (radius_m + max(obs_height_m, h_min_m))))
    t2 = math.acos(min(1.0, rm / (radius_m + h_max_m)))
    return radius_m * (t1 + t2)
