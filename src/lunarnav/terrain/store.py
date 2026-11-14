"""Canonical on-disk terrain store: a memory-mappable multi-resolution pyramid.

Layout of ``<root>/<dem_id>/``::

    meta.json            projection, grid, pyramid description, provenance, array hashes
    L0_mean.f32          the source samples (height above the reference sphere, metres, NaN = no data)
    L{k}_mean.f32        k >= 1: mean of the 2x2 children (NaN-aware)
    L{k}_max.f32         k >= 1: upper bound of the bilinear surface over the cell (see below)
    L{k}_min.f32         k >= 1: lower bound of the bilinear surface over the cell
    L{k}_cov.u8          k >= 1: 2 = every level-0 cell in the cell is fully valid, 0 = none, 1 = some

Arrays are raw little-endian, C-order, ``float32`` (``uint8`` for coverage), shape
``(ceil(nrows/2^k), ceil(ncols/2^k))``.

Cell semantics.  Level-0 surface = bilinear interpolation between pixel centres, so level-0 *cell*
``(i, j)`` is the patch between pixel centres ``i..i+1`` x ``j..j+1`` (continuous coordinates
``[i, i+1) x [j, j+1)``).  A level-``k`` cell owns continuous coordinates
``[2^k i, 2^k (i+1)) x [2^k j, 2^k (j+1))`` and its ``max``/``min`` are the extrema of the pixel centres
``[2^k i, 2^k (i+1)]`` x ``[2^k j, 2^k (j+1)]`` (one extra pixel on the high side, so the bound covers the
bilinear surface exactly).  Level-0 ``max``/``min`` are the extrema of the four corners and are computed
on the fly instead of being stored.  Statistics ignore NaN; ``cov`` records whether the cell is entirely
backed by valid samples.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from lunarnav.constants import R_MOON_M
from lunarnav.terrain.mapping import map_array
from lunarnav.terrain.projection import GridGeometry

FORMAT_VERSION = 1
ERR_LAYER_FILE = "err_toterr.f32"
ERR_LAYER_INFO = "err_toterr.json"


MIN_TOP_LEVEL_DIM = 48
STRIP_ROWS = 256


def level_shape(nrows: int, ncols: int, level: int) -> tuple[int, int]:
    """Shape of pyramid level ``level``."""
    b = 1 << level
    return -(-nrows // b), -(-ncols // b)


def n_levels_for(nrows: int, ncols: int, periodic: bool) -> int:
    """Number of pyramid levels (including level 0) built for a grid of the given shape."""
    k = 0
    while True:
        r, c = level_shape(nrows, ncols, k + 1)
        if min(r, c) < MIN_TOP_LEVEL_DIM // 2:
            return k + 1
        if periodic and ncols % (1 << (k + 1)):
            return k + 1
        k += 1


def array_name(level: int, stat: str) -> str:
    return f"L{level}_{stat}." + ("u8" if stat == "cov" else "f32")


def sha256_file(path: Path, chunk: int = 1 << 24) -> str:
    """SHA-256 of a file, streamed."""
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while block := fh.read(chunk):
            h.update(block)
    return h.hexdigest()


class TerrainStore:
    """Read access to a store directory; arrays are memory-mapped read-only."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.meta: dict = json.loads((self.path / "meta.json").read_text())
        if self.meta.get("format_version") != FORMAT_VERSION:
            raise ValueError(f"{self.path}: unsupported store format {self.meta.get('format_version')}")
        self.dem_id: str = self.meta["dem_id"]
        self.geometry = GridGeometry.from_dict(self.meta["geometry"])
        self.n_levels: int = len(self.meta["levels"])
        self.mean: list[np.ndarray] = []
        self.max: list[np.ndarray | None] = []
        self.min: list[np.ndarray | None] = []
        self.cov: list[np.ndarray | None] = []
        for lv in self.meta["levels"]:
            shape = tuple(lv["shape"])
            files = lv["arrays"]
            self.mean.append(map_array(self.path / files["mean"], "<f4", shape))
            for name, store in (("max", self.max), ("min", self.min)):
                store.append(map_array(self.path / files[name], "<f4", shape) if name in files else None)
            self.cov.append(map_array(self.path / files["cov"], "u1", shape) if "cov" in files else None)
        raw = (self.path / "meta.json").read_bytes()
        self.meta_hash: str = hashlib.sha256(raw).hexdigest()
        err = self.path / ERR_LAYER_FILE
        self.err_layer: np.ndarray | None = map_array(err, "<f4", self.mean[0].shape) if err.exists() else None
        info = self.path / ERR_LAYER_INFO
        self.err_info: dict | None = json.loads(info.read_text()) if info.exists() else None

    @property
    def pixel_size_m(self) -> float:
        """Nominal ground size of a pixel (at the pole for polar grids, at the equator for equirect)."""
        return float(self.meta["pixel_size_m"])

    def height_rc(self, row, col) -> np.ndarray:
        """Bilinear height at continuous ``(row, col)``; NaN outside the grid or next to missing data."""
        g = self.geometry
        row = np.asarray(row, dtype=np.float64)
        col = np.asarray(col, dtype=np.float64)
        row, col = np.broadcast_arrays(row, col)
        inside = g.contains_rc(row, col)
        r0 = np.clip(np.floor(np.where(inside, row, 0.0)), 0, g.nrows - 2).astype(np.int64)
        c0 = np.floor(np.where(inside, col, 0.0)).astype(np.int64)
        if not g.periodic:
            c0 = np.clip(c0, 0, g.ncols - 2)
        fr = np.where(inside, row - r0, 0.0)
        fc = np.where(inside, col - c0, 0.0)
        c1 = (c0 + 1) % g.ncols if g.periodic else c0 + 1
        z = self.mean[0]
        z00, z01 = z[r0, c0].astype(np.float64), z[r0, c1].astype(np.float64)
        z10, z11 = z[r0 + 1, c0].astype(np.float64), z[r0 + 1, c1].astype(np.float64)
        h = (1 - fr) * ((1 - fc) * z00 + fc * z01) + fr * ((1 - fc) * z10 + fc * z11)
        return np.where(inside, h, np.nan)

    def height(self, lat_deg, lon_deg) -> np.ndarray:
        """Bilinear height (m above the reference sphere) at planetocentric degrees; NaN if not covered."""
        row, col = self.geometry.lonlat_to_rc(lat_deg, lon_deg)
        return self.height_rc(row, col)

    def layer_error(self, lat_deg, lon_deg) -> np.ndarray:
        """Per-pixel published total height uncertainty (m) of the pixel nearest to each point.

        NaN where the store has no error layer (``err_toterr.f32``, written by ``ingest build-err``), outside the
        grid, or where the layer holds no valid value.  The layer is a separate file beside the heights and is not
        part of ``meta.json``, so adding it changes no store hash.
        """
        row, col = self.geometry.lonlat_to_rc(lat_deg, lon_deg)
        row, col = np.broadcast_arrays(np.asarray(row, dtype=np.float64), np.asarray(col, dtype=np.float64))
        if self.err_layer is None:
            return np.full(row.shape, np.nan)
        g = self.geometry
        r = np.rint(row)
        c = np.rint(col)
        ok = np.isfinite(r) & np.isfinite(c) & (r >= 0) & (r < g.nrows) & (c >= 0) & (c < g.ncols)
        out = np.full(row.shape, np.nan)
        v = self.err_layer[np.where(ok, r, 0).astype(np.int64), np.where(ok, c, 0).astype(np.int64)].astype(np.float64)
        out[ok] = v[ok]
        out[~(out > 0)] = np.nan
        return out

    def window(self, row0: int, row1: int, col0: int, col1: int, level: int = 0) -> np.ndarray:
        """Copy of a window of the mean array at ``level`` (clipped to the grid)."""
        z = self.mean[level]
        return np.array(z[max(row0, 0) : row1, max(col0, 0) : col1])


@dataclass(frozen=True, slots=True)
class SourceInfo:
    """Provenance recorded in ``meta.json``."""

    description: str
    url: str
    sha256: str
    label: dict
    frame: str = "MOON_ME (mean Earth/polar axis, DE421)"
    radius_m: float = R_MOON_M
    vertical_datum: str = "heights above the 1737.4 km LOLA reference sphere"
    pixel_size_m: float = 0.0
    notes: str = ""


RowReader = Callable[[int, int], np.ndarray]
"""``read_rows(r0, r1) -> float32 array (r1-r0, ncols)`` with NaN for no data."""


def _fmax(arrs):
    out = arrs[0]
    for a in arrs[1:]:
        out = np.fmax(out, a)
    return out


def _fmin(arrs):
    out = arrs[0]
    for a in arrs[1:]:
        out = np.fmin(out, a)
    return out


def _nanmean_stack(arrs):
    s = np.zeros(arrs[0].shape, np.float64)
    n = np.zeros(arrs[0].shape, np.float64)
    for a in arrs:
        f = np.isfinite(a)
        s += np.where(f, a, 0.0)
        n += f
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(n > 0, s / np.maximum(n, 1), np.nan).astype(np.float32)


def _cov_from_counts(count: np.ndarray, total: int) -> np.ndarray:
    return np.where(count == total, 2, np.where(count == 0, 0, 1)).astype(np.uint8)


def _build_level1_strip(z: np.memmap, a: int, b: int, periodic: bool):
    """Level-1 statistics for output rows ``[a, b)`` from the level-0 samples."""
    nr, nc = z.shape
    n1c = -(-nc // 2)
    nrow_in = 2 * (b - a) + 1
    rows = np.asarray(z[2 * a : min(2 * a + nrow_in, nr)])
    pad = np.full((nrow_in, 2 * n1c + 1), np.nan, np.float32)
    pad[: rows.shape[0], :nc] = rows
    if periodic:
        pad[: rows.shape[0], nc : 2 * n1c + 1] = rows[:, : 2 * n1c + 1 - nc]
    nrw = b - a
    blocks3 = [pad[dr : dr + 2 * nrw : 2, dc : dc + 2 * n1c : 2] for dr in range(3) for dc in range(3)]
    blocks2 = [pad[dr : dr + 2 * nrw : 2, dc : dc + 2 * n1c : 2] for dr in range(2) for dc in range(2)]
    fin = np.isfinite(pad)
    valid = fin[:-1, :-1] & fin[1:, :-1] & fin[:-1, 1:] & fin[1:, 1:]
    vpad = np.zeros((nrow_in, 2 * n1c + 1), bool)
    vpad[:-1, :-1] = valid
    count = sum(vpad[dr : dr + 2 * nrw : 2, dc : dc + 2 * n1c : 2].astype(np.uint8) for dr in range(2) for dc in range(2))
    return _nanmean_stack(blocks2), _fmax(blocks3), _fmin(blocks3), _cov_from_counts(count, 4)


def _build_level_strip(prev: dict[str, np.ndarray], a: int, b: int):
    """Level-``k`` statistics for output rows ``[a, b)`` from level ``k-1`` arrays."""
    pr, pc = prev["mean"].shape
    nc = -(-pc // 2)
    nrw = b - a
    lo, hi = 2 * a, min(2 * b, pr)

    def view(name, fill, dtype):
        out = np.full((2 * nrw, 2 * nc), fill, dtype)
        out[: hi - lo, :pc] = np.asarray(prev[name][lo:hi])
        return [out[dr::2, dc::2] for dr in range(2) for dc in range(2)]

    mean = _nanmean_stack(view("mean", np.nan, np.float32))
    mx = _fmax(view("max", np.nan, np.float32))
    mn = _fmin(view("min", np.nan, np.float32))
    cov = view("cov", 0, np.uint8)
    count = sum((c == 2).astype(np.uint8) for c in cov)
    none = sum((c == 0).astype(np.uint8) for c in cov)
    cov_out = np.where(count == 4, 2, np.where(none == 4, 0, 1)).astype(np.uint8)
    return mean, mx, mn, cov_out


def _open_w(path: Path, dtype, shape):
    return np.memmap(path, np.dtype(dtype), "w+", shape=shape)


def build_store(
    root: str | Path,
    dem_id: str,
    geometry: GridGeometry,
    read_rows: RowReader,
    source: SourceInfo,
    hash_arrays: bool = True,
) -> TerrainStore:
    """Build the pyramid for ``dem_id`` in row strips (memory stays at a few strips) and write ``meta.json``.

    ``read_rows`` supplies level-0 samples (float32, NaN = no data); it is called with consecutive
    row windows.  The existing directory is replaced.
    """
    out = Path(root) / dem_id
    out.mkdir(parents=True, exist_ok=True)
    (out / "meta.json").unlink(missing_ok=True)
    nr, nc = geometry.nrows, geometry.ncols
    nlev = n_levels_for(nr, nc, geometry.periodic)

    z0 = _open_w(out / array_name(0, "mean"), "<f4", (nr, nc))
    zmin, zmax = np.inf, -np.inf
    for r0 in range(0, nr, STRIP_ROWS * 4):
        r1 = min(nr, r0 + STRIP_ROWS * 4)
        rows = np.asarray(read_rows(r0, r1), dtype=np.float32)
        if rows.shape != (r1 - r0, nc):
            raise ValueError(f"reader returned {rows.shape}, expected {(r1 - r0, nc)}")
        z0[r0:r1] = rows
        if np.isfinite(rows).any():
            zmin, zmax = min(zmin, float(np.nanmin(rows))), max(zmax, float(np.nanmax(rows)))
    z0.flush()
    if not np.isfinite(zmin):
        raise ValueError("DEM contains no valid samples")
    z0 = np.memmap(out / array_name(0, "mean"), np.dtype("<f4"), "r", shape=(nr, nc))

    levels = [{"level": 0, "shape": [nr, nc], "arrays": {"mean": array_name(0, "mean")}}]
    prev: dict[str, np.ndarray] = {}
    for k in range(1, nlev):
        shape = level_shape(nr, nc, k)
        arrays = {s: _open_w(out / array_name(k, s), "u1" if s == "cov" else "<f4", shape) for s in ("mean", "max", "min", "cov")}
        for a in range(0, shape[0], STRIP_ROWS):
            b = min(shape[0], a + STRIP_ROWS)
            if k == 1:
                res = _build_level1_strip(z0, a, b, geometry.periodic)
            else:
                res = _build_level_strip(prev, a, b)
            for s, v in zip(("mean", "max", "min", "cov"), res, strict=True):
                arrays[s][a:b] = v
        for arr in arrays.values():
            arr.flush()
        prev = {s: np.memmap(out / array_name(k, s), np.dtype("u1" if s == "cov" else "<f4"), "r", shape=shape) for s in arrays}
        del arrays
        levels.append({"level": k, "shape": list(shape), "arrays": {s: array_name(k, s) for s in ("mean", "max", "min", "cov")}})

    hashes = {}
    if hash_arrays:
        for lv in levels:
            for fname in lv["arrays"].values():
                hashes[fname] = sha256_file(out / fname)
    meta = {
        "format_version": FORMAT_VERSION,
        "dem_id": dem_id,
        "description": source.description,
        "geometry": geometry.to_dict(),
        "registration": "pixel_centre",
        "pixel_size_m": source.pixel_size_m,
        "dtype": "<f4",
        "levels": levels,
        "height_range_m": [zmin, zmax],
        "frame": source.frame,
        "radius_m": source.radius_m,
        "vertical_datum": source.vertical_datum,
        "source": {"url": source.url, "sha256": source.sha256, "label": source.label, "notes": source.notes},
        "array_sha256": hashes,
        "statistics": "level>=1 max/min: extrema of pixel centres [2^k i, 2^k (i+1)] (bounds the bilinear "
        "surface over the cell); level-0 extrema are taken on the fly from the four corners; "
        "cov: 2 = all level-0 cells fully valid, 0 = none, 1 = partly",
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    return TerrainStore(out)
