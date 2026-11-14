"""Terrain for the web client: store catalogue, map tiles, elevation patches and point lookups.

Everything here reads the canonical stores (``<data_dir>/dem/store``) through their memory maps: tiles and
patches gather only the four bilinear neighbours of each output sample from one pyramid level, so no store
level is ever read whole. Rendering is plain numpy (thread-safe); point queries use the Numba
``TerrainStack`` kernels and are serialised on one dedicated thread.
"""

from __future__ import annotations

import asyncio
import functools
import hashlib
import io
import logging
import math
import os
import struct
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, TypeVar

import numpy as np
from PIL import Image

from lunarnav.api.diskbudget import DiskBudget
from lunarnav.api.json import dumps, loads
from lunarnav.constants import R_MOON_M
from lunarnav.terrain.derivatives import slope_at
from lunarnav.terrain.projection import POLAR, polar_forward, polar_inverse, polar_scale_factor
from lunarnav.terrain.stack import TerrainStack, angular_distance, destination
from lunarnav.terrain.store import TerrainStore

log = logging.getLogger("lunarnav.api.terrain")
T = TypeVar("T")

TILE = 256
RENDER_VERSION = "1"
"""Bump whenever the rendering of any layer changes (it is part of the tile cache key)."""
PATCH_VERSION = "1"
"""Bump whenever patch sampling changes (it is part of the patch cache key)."""
PATCH_MAGIC = b"LNP1"
POLAR_HALF_M = 931_080.0
SUN_AZIMUTH_DEG = 315.0
SUN_ALTITUDE_DEG = 45.0
SLOPE_RANGE_DEG = (0.0, 45.0)
CATALOG_TTL_S = 1.0
"""Tiles reuse a store scan this recent; ``GET /terrain/stores`` always rescans."""


ELEVATION_STOPS: tuple[tuple[float, str], ...] = (
    (0.0, "#1a0d6b"),
    (0.15, "#2a52be"),
    (0.30, "#3fa7d6"),
    (0.45, "#59c27a"),
    (0.60, "#c9d26b"),
    (0.75, "#d9a35a"),
    (0.90, "#a8673e"),
    (1.0, "#f5f5f5"),
)
"""Hypsometric ramp as (fraction of the tileset's fixed elevation range, colour)."""

SLOPE_STOPS: tuple[tuple[float, str], ...] = (
    (0.0, "#1a9850"),
    (5.0, "#91cf60"),
    (10.0, "#d9ef8b"),
    (15.0, "#fee08b"),
    (20.0, "#fc8d59"),
    (30.0, "#d73027"),
    (45.0, "#67001f"),
)
"""Slope ramp as (degrees, colour); values above 45 deg take the last colour."""


def _rgb(hexes: tuple[str, ...]) -> np.ndarray:
    return np.array([[int(h[i : i + 2], 16) for i in (1, 3, 5)] for h in hexes], dtype=np.float64)


_ELEV_T = np.array([s[0] for s in ELEVATION_STOPS])
_ELEV_RGB = _rgb(tuple(s[1] for s in ELEVATION_STOPS))
_SLOPE_V = np.array([s[0] for s in SLOPE_STOPS])
_SLOPE_RGB = _rgb(tuple(s[1] for s in SLOPE_STOPS))


@dataclass(frozen=True, slots=True)
class Tileset:
    id: str
    title: str
    proj4: str
    kind: str
    pole: int
    extent: tuple[float, float, float, float]
    units: str
    zoom_max: int
    elevation_range_m: tuple[float, float]
    lat_limits: tuple[float, float]

    def matrix(self, z: int) -> tuple[int, int]:
        """(width, height) in tiles at zoom ``z``."""
        return ((1 << (z + 1)) if self.kind == "global" else (1 << z)), 1 << z

    def resolution(self, z: int) -> float:
        """CRS units per pixel at zoom ``z``."""
        return (self.extent[3] - self.extent[1]) / (TILE * (1 << z))

    def nominal_res_m(self, z: int) -> float:
        """Ground size of a pixel used to pick pyramid levels (at the pole for polar, meridional for global)."""
        r = self.resolution(z)
        return math.radians(r) * R_MOON_M if self.kind == "global" else r


def _polar_corner_lat(pole: int) -> float:
    lat, _ = polar_inverse(POLAR_HALF_M, POLAR_HALF_M, pole)
    return float(lat)


TILESETS: dict[str, Tileset] = {
    "south-polar": Tileset(
        "south-polar", "South polar stereographic",
        "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs",
        "polar", -1, (-POLAR_HALF_M, -POLAR_HALF_M, POLAR_HALF_M, POLAR_HALF_M), "m", 11,
        (-5000.0, 4000.0), (-90.0, _polar_corner_lat(-1)),
    ),
    "north-polar": Tileset(
        "north-polar", "North polar stereographic",
        "+proj=stere +lat_0=90 +lat_ts=90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs",
        "polar", 1, (-POLAR_HALF_M, -POLAR_HALF_M, POLAR_HALF_M, POLAR_HALF_M), "m", 11,
        (-5000.0, 4000.0), (_polar_corner_lat(1), 90.0),
    ),
    "global": Tileset(
        "global", "Global plate carree (planetocentric, east-positive)",
        "+proj=longlat +R=1737400 +no_defs",
        "global", 0, (-180.0, -90.0, 180.0, 90.0), "degree", 6,
        (-9000.0, 10000.0), (-90.0, 90.0),
    ),
}

LAYERS = ("relief", "elevation", "slope", "heights")
URL_TEMPLATE = "/api/v1/terrain/tiles/{tileset}/{layer}/{z}/{x}/{y}.png"

_SLOPE_NOTE = (
    "Gradient by central differences along the map axes over a half-baseline of max(one tile pixel on the "
    "ground, pixel size of the store supplying the centre sample), i.e. the baseline is floored at the "
    "store's native pixel size; one-sided where one neighbour has no data. Curvature cancels in the "
    "central difference (heights are above the sphere)."
)


def layer_definitions(ts: Tileset) -> list[dict[str, Any]]:
    vmin, vmax = ts.elevation_range_m
    return [
        {
            "id": "relief", "title": "Shaded relief",
            "description": f"Lambertian hillshade, sun azimuth {SUN_AZIMUTH_DEG:g} deg clockwise from map-up (+y), "
            f"altitude {SUN_ALTITUDE_DEG:g} deg, vertical exaggeration 1, greyscale. " + _SLOPE_NOTE,
            "encoding": "PNG RGBA greyscale (R=G=B=round(255*shade)); alpha 0 where no data",
            "legend": {"type": "greyscale", "min": 0.0, "max": 1.0, "units": "cos(incidence)",
                       "sun_azimuth_deg": SUN_AZIMUTH_DEG, "sun_altitude_deg": SUN_ALTITUDE_DEG,
                       "vertical_exaggeration": 1.0},
        },
        {
            "id": "elevation", "title": "Elevation",
            "description": f"Hypsometric ramp over the fixed range {vmin:g}..{vmax:g} m above the 1737.4 km "
            "sphere (clamped outside it); the same constants for every tile of this tileset.",
            "encoding": "PNG RGBA colour ramp; alpha 0 where no data",
            "legend": {"type": "ramp", "min": vmin, "max": vmax, "units": "m",
                       "stops": [{"value": vmin + t * (vmax - vmin), "color": c} for t, c in ELEVATION_STOPS]},
        },
        {
            "id": "slope", "title": "Slope",
            "description": "Slope angle from the local horizontal, ramp over 0..45 deg (clamped above). " + _SLOPE_NOTE,
            "encoding": "PNG RGBA colour ramp; alpha 0 where no data",
            "legend": {"type": "ramp", "min": SLOPE_RANGE_DEG[0], "max": SLOPE_RANGE_DEG[1], "units": "deg",
                       "stops": [{"value": v, "color": c} for v, c in SLOPE_STOPS]},
        },
        {
            "id": "heights", "title": "Heights (Terrarium)",
            "description": "Heights in metres above the 1737.4 km sphere, Terrarium-packed for client-side "
            "decoding (3D, custom shading).",
            "encoding": "v = h_m + 32768; R = floor(v/256), G = floor(v) mod 256, B = floor((v - floor(v))*256), "
            "A = 255; decode h = R*256 + G + B/256 - 32768 (resolution 1/256 m); A = 0 where no data",
            "legend": {"type": "terrarium", "offset_m": 32768.0, "scale": 256.0, "units": "m",
                       "resolution_m": 1.0 / 256.0},
        },
    ]


def tileset_definitions() -> dict[str, Any]:
    out = []
    for ts in TILESETS.values():
        zooms = range(ts.zoom_max + 1)
        out.append({
            "id": ts.id, "title": ts.title, "proj4": ts.proj4, "crs_extent": list(ts.extent), "units": ts.units,
            "tile_size": TILE, "zoom_min": 0, "zoom_max": ts.zoom_max,
            "resolution_m_or_deg": [ts.resolution(z) for z in zooms],
            "origin": "top-left",
            "matrix": [{"z": z, "width": ts.matrix(z)[0], "height": ts.matrix(z)[1]} for z in zooms],
            "url_template": URL_TEMPLATE, "layers": layer_definitions(ts),
            "lat_limits": list(ts.lat_limits),
            "elevation_range_m": list(ts.elevation_range_m),
            "radius_m": R_MOON_M,
            "pixel_registration": "pixel (i, j) of tile (x, y) is centred at "
            "minx + (x*256 + i + 0.5)*res, maxy - (y*256 + j + 0.5)*res",
        })
    return {"render_version": RENDER_VERSION, "tilesets": out}


@dataclass(slots=True)
class StoreEntry:
    """An opened store plus the metadata the service derives once per ``meta.json`` version."""

    store: TerrainStore
    stamp: tuple[int, int]
    summary: dict[str, Any]
    bbox: dict[str, tuple[float, float, float, float] | None]
    """Bounding box per tileset id in that tileset's CRS (None: never intersects)."""
    circle: tuple[float, float, float] | None
    """(lat, lon, angular radius rad) containing the footprint; None for periodic grids."""
    px_m: float
    """Nominal ground pixel of level 0 (polar: map pixel; equirectangular: meridional)."""

    def level_for(self, res_m: float) -> int:
        """Coarsest pyramid level whose pixel is not larger than ``res_m`` (level 0 if the data is coarser)."""
        if res_m <= self.px_m:
            return 0
        return min(math.floor(math.log2(res_m / self.px_m) + 1e-9), self.store.n_levels - 1)


def _to180(lon):
    return (np.asarray(lon, dtype=np.float64) + 180.0) % 360.0 - 180.0


FOOTPRINT_TOLERANCE_DEG = 0.05
"""Douglas-Peucker tolerance (degrees of lon/lat) of the simplified footprints."""


def simplify_ring(ring: list[list[float]], tol: float = FOOTPRINT_TOLERANCE_DEG) -> list[list[float]]:
    """Douglas-Peucker simplification of a closed lon/lat ring (planar in degrees; corners are kept)."""
    pts = np.asarray(ring, dtype=np.float64)
    n = len(pts)
    if n <= 5:
        return [list(map(float, p)) for p in pts]
    keep = np.zeros(n, dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        a, b = pts[i], pts[j]
        d = b - a
        norm = float(np.hypot(*d))
        seg = pts[i + 1:j]
        if norm == 0.0:
            dist = np.hypot(*(seg - a).T)
        else:
            dist = np.abs(d[0] * (seg[:, 1] - a[1]) - d[1] * (seg[:, 0] - a[0])) / norm
        k = int(np.argmax(dist))
        if dist[k] > tol:
            m = i + 1 + k
            keep[m] = True
            stack += [(i, m), (m, j)]
    return [[float(x), float(y)] for x, y in pts[keep]]


def _describe(store: TerrainStore, stamp: tuple[int, int]) -> StoreEntry:
    g = store.geometry
    m = store.meta
    xs = sorted((g.x0, g.x0 + (g.ncols - 1) * g.dx))
    ys = sorted((g.y0, g.y0 + (g.nrows - 1) * g.dy))
    n = 64
    t = np.linspace(0.0, 1.0, n, endpoint=False)
    bx = np.concatenate([xs[0] + t * (xs[1] - xs[0]), np.full(n, xs[1]), xs[1] - t * (xs[1] - xs[0]), np.full(n, xs[0])])
    by = np.concatenate([np.full(n, ys[1]), ys[1] - t * (ys[1] - ys[0]), np.full(n, ys[0]), ys[0] + t * (ys[1] - ys[0])])
    bbox: dict[str, tuple[float, float, float, float] | None] = {}
    circle = None
    if g.kind == POLAR:
        px = abs(g.dx)
        lat_b, lon_b = polar_inverse(bx, by, g.pole)
        near_x, near_y = min(max(0.0, xs[0]), xs[1]), min(max(0.0, ys[0]), ys[1])
        lat_near = float(polar_inverse(near_x, near_y, g.pole)[0])
        encloses = near_x == 0.0 and near_y == 0.0
        if encloses:
            order = np.argsort(_to180(lon_b))
            lo, la = _to180(lon_b)[order], lat_b[order]
            span = (lo[0] + 360.0) - lo[-1]
            w = (180.0 - lo[-1]) / span if span > 0 else 0.5
            lat_seam = float(la[-1] + w * (la[0] - la[-1]))
            ring = [[-180.0, lat_seam], *[[float(a), float(b)] for a, b in zip(lo, la, strict=True)], [180.0, lat_seam],
                    [180.0, 90.0 * g.pole], [-180.0, 90.0 * g.pole], [-180.0, lat_seam]]
            far = float(np.min(np.abs(lat_b)))
            lat_extent = [-90.0, -far] if g.pole < 0 else [far, 90.0]
            gbox = (-180.0, -90.0, 180.0, -far) if g.pole < 0 else (-180.0, far, 180.0, 90.0)
        else:
            lon_u = _to180(lon_b)
            ring = [[float(a), float(b)] for a, b in zip(lon_u, lat_b, strict=True)]
            ring.append(ring[0])
            lats = np.append(lat_b, lat_near)
            lat_extent = [float(lats.min()), float(lats.max())]
            if np.abs(np.diff(lon_u)).max() > 180.0:
                gbox = (-180.0, lat_extent[0], 180.0, lat_extent[1])
            else:
                gbox = (float(lon_u.min()), lat_extent[0], float(lon_u.max()), lat_extent[1])
        for ts in TILESETS.values():
            if ts.kind == "global":
                bbox[ts.id] = gbox
            elif ts.pole == g.pole:
                bbox[ts.id] = (xs[0] - px, ys[0] - px, xs[1] + px, ys[1] + px)
            else:
                bbox[ts.id] = None
        lat_c, lon_c2 = polar_inverse(0.5 * sum(xs), 0.5 * sum(ys), g.pole)
        rad = float(np.max(angular_distance(lat_c, lon_c2, lat_b, lon_b)))
        circle = (float(lat_c), float(lon_c2), rad * 1.001 + 1e-6)
        units = "m"
    else:
        px = math.radians(abs(g.dy)) * R_MOON_M
        lat_extent = [ys[0], ys[1]]
        if g.periodic:
            ring = [[-180.0, ys[0]], [180.0, ys[0]], [180.0, ys[1]], [-180.0, ys[1]], [-180.0, ys[0]]]
            gbox = (-180.0, ys[0], 180.0, ys[1])
        else:
            l0, l1 = float(_to180(xs[0])), float(_to180(xs[0])) + (xs[1] - xs[0])
            gbox = (-180.0, ys[0], 180.0, ys[1]) if l1 > 180.0 else (l0, ys[0], l1, ys[1])
            if l1 > 180.0:
                l0, l1 = (l0, 180.0) if 180.0 - l0 >= l1 - 180.0 else (-180.0, l1 - 360.0)
            ring = [[l0, ys[0]], [l1, ys[0]], [l1, ys[1]], [l0, ys[1]], [l0, ys[0]]]
            lat_b, lon_b = by, bx
            lat_c, lon_c2 = 0.5 * sum(ys), 0.5 * sum(xs)
            rad = float(np.max(angular_distance(lat_c, lon_c2, lat_b, lon_b)))
            circle = (lat_c, lon_c2, rad * 1.001 + 1e-6)
        for ts in TILESETS.values():
            if ts.kind == "global":
                bbox[ts.id] = gbox
            else:
                lo, hi = ts.lat_limits
                bbox[ts.id] = ts.extent if (ys[0] <= hi and ys[1] >= lo) else None
        units = "deg"
    summary = {
        "id": store.dem_id,
        "description": m["description"],
        "kind": g.kind,
        "pole": g.pole,
        "pixel_size_m": store.pixel_size_m,
        "ncols": g.ncols,
        "nrows": g.nrows,
        "n_levels": store.n_levels,
        "height_range_m": list(m["height_range_m"]),
        "bbox_map": {"xmin": xs[0], "xmax": xs[1], "ymin": ys[0], "ymax": ys[1], "units": units},
        "footprint": {"type": "Polygon", "coordinates": [ring]},
        "footprint_simple": {"type": "Polygon", "coordinates": [simplify_ring(ring)]},
        "lat_extent_deg": lat_extent,
        "source": m["source"],
        "meta_hash": store.meta_hash,
    }
    return StoreEntry(store, stamp, summary, bbox, circle, px)


@dataclass(slots=True)
class Snapshot:
    """The stores present at one scan in the ``TerrainStack`` order (`precedence_key`); the hash is the stack's."""

    entries: tuple[StoreEntry, ...]
    stack_hash: str
    scanned_at: float
    _stack: TerrainStack | None = None

    def stack(self) -> TerrainStack | None:
        """Composite stack over the same opened stores (built on first use; call on the query thread)."""
        if self._stack is None and self.entries:
            self._stack = TerrainStack([e.store for e in self.entries])
        return self._stack


class StoreCatalog:
    """Scans ``root/*/meta.json``; re-opens a store only when its ``meta.json`` changes."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self._lock = threading.Lock()
        self._entries: dict[str, StoreEntry] = {}
        self._snap: Snapshot | None = None
        self._key: tuple | None = None

    def snapshot(self, max_age_s: float = 0.0) -> Snapshot:
        with self._lock:
            now = time.monotonic()
            if self._snap is not None and now - self._snap.scanned_at < max_age_s:
                return self._snap
            stamps: dict[str, tuple[int, int]] = {}
            if self.root.is_dir():
                for d in sorted(self.root.iterdir()):
                    try:
                        st = (d / "meta.json").stat()
                    except OSError:
                        continue
                    stamps[d.name] = (st.st_mtime_ns, st.st_size)
            key = tuple(sorted(stamps.items()))
            if self._snap is not None and key == self._key:
                self._snap.scanned_at = now
                return self._snap
            entries: dict[str, StoreEntry] = {}
            for name, stamp in stamps.items():
                old = self._entries.get(name)
                if old is not None and old.stamp == stamp:
                    entries[name] = old
                    continue
                try:
                    entries[name] = _describe(TerrainStore(self.root / name), stamp)
                except Exception:
                    log.warning("terrain store %s unreadable; skipped", name, exc_info=True)
            self._entries = entries
            by_id = {e.store.dem_id: e for e in entries.values()}
            if by_id:
                stack = TerrainStack([by_id[k].store for k in sorted(by_id)])
                self._snap = Snapshot(tuple(by_id[i] for i in stack.dem_ids), stack.stack_hash, now, stack)
            else:
                self._snap = Snapshot((), hashlib.sha256().hexdigest(), now)
            self._key = key
            return self._snap


def _bilinear(z: np.ndarray, row: np.ndarray, col: np.ndarray, periodic: bool) -> np.ndarray:
    """Bilinear sample of a (memory-mapped) level at continuous (row, col); NaN outside or next to no-data.

    Only the four neighbours of each sample are read (fancy indexing touches the needed pages only).
    """
    nr, nc = z.shape
    out = np.full(row.shape, np.nan)
    inside = (row >= 0.0) & (row <= nr - 1.0)
    if not periodic:
        inside &= (col >= 0.0) & (col <= nc - 1.0)
    if nr < 2 or nc < 2 or not inside.any():
        return out
    r, c = row[inside], col[inside]
    r0 = np.minimum(r.astype(np.int64), nr - 2)
    fr = r - r0
    if periodic:
        cf = np.floor(c)
        c0 = cf.astype(np.int64) % nc
        fc = c - cf
        c1 = (c0 + 1) % nc
    else:
        c0 = np.minimum(c.astype(np.int64), nc - 2)
        fc = c - c0
        c1 = c0 + 1
    z00 = z[r0, c0].astype(np.float64)
    z01 = z[r0, c1].astype(np.float64)
    z10 = z[r0 + 1, c0].astype(np.float64)
    z11 = z[r0 + 1, c1].astype(np.float64)
    out[inside] = (1 - fr) * ((1 - fc) * z00 + fc * z01) + fr * ((1 - fc) * z10 + fc * z11)
    return out


def sample_composite(
    entries: tuple[StoreEntry, ...] | list[StoreEntry],
    lat: np.ndarray,
    lon: np.ndarray,
    res_m: float,
    xy: tuple[np.ndarray, np.ndarray] | None = None,
    pole: int = 0,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Composite bilinear heights at ``(lat, lon)`` (flat arrays): finest entry first, NaN filled from coarser.

    Each store is sampled at ``entry.level_for(res_m)``. ``xy`` are the same points in the polar
    stereographic of ``pole`` (lets same-projection stores skip the trigonometry). Returns heights,
    the index of the supplying entry (-1 none) and the level used per entry (-1 unused).
    """
    h = np.full(lat.shape, np.nan)
    src = np.full(lat.shape, -1, np.int16)
    levels = np.full(len(entries), -1, np.int64)
    todo = np.arange(lat.size)
    for i, e in enumerate(entries):
        if todo.size == 0:
            break
        g = e.store.geometry
        if g.kind == POLAR:
            if xy is not None and g.pole == pole:
                x, y = xy[0][todo], xy[1][todo]
            else:
                la = lat[todo]
                keep = la * g.pole > 0.0
                if not keep.any():
                    continue
                x, y = polar_forward(np.where(keep, la, g.pole * 89.0), lon[todo], g.pole)
                x = np.where(keep, x, np.nan)
        else:
            x, y = g.x0 + np.mod(lon[todo] - g.x0, 360.0), lat[todo]
        row, col = g.xy_to_rc(x, y)
        level = e.level_for(res_m)
        b = 1 << level
        off = (b - 1) / 2.0
        rl, cl = (row - off) / b, (col - off) / b
        z = e.store.mean[level]
        if g.periodic:
            cl = np.mod(cl, z.shape[1])
        vals = _bilinear(z, rl, cl, g.periodic)
        ok = np.isfinite(vals)
        if ok.any():
            levels[i] = level
            hit = todo[ok]
            h[hit] = vals[ok]
            src[hit] = i
            todo = todo[~ok]
    return h, src, levels


def _png(rgba: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, format="PNG", compress_level=4)
    return buf.getvalue()


EMPTY_PNG = _png(np.zeros((TILE, TILE, 4), np.uint8))
"""Fully transparent tile (no data)."""


def _overlaps(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> bool:
    return a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]


def _diff(hp: np.ndarray, hm: np.ndarray, h0: np.ndarray, bp: np.ndarray, bm: np.ndarray) -> np.ndarray:
    """Central difference (hp - hm)/(bp + bm); one-sided where a neighbour is missing."""
    with np.errstate(invalid="ignore", divide="ignore"):
        d = (hp - hm) / (bp + bm)
        d = np.where(np.isfinite(d), d, (hp - h0) / bp)
        return np.where(np.isfinite(d), d, (h0 - hm) / bm)


def _gradient(entries, ts: Tileset, z: int, lat, lon, x, y, h, src) -> tuple[np.ndarray, np.ndarray]:
    """dh/d(ground) along the map +x and +y axes at the given samples (flat arrays)."""
    res = ts.resolution(z)
    res_m = ts.nominal_res_m(z)
    floor_m = np.array([e.store.pixel_size_m for e in entries])[np.maximum(src, 0)]

    def at(la, lo, xx=None, yy=None):
        return sample_composite(entries, la, lo, res_m, None if xx is None else (xx, yy), ts.pole)[0]

    if ts.kind == "polar":
        k = polar_scale_factor(lat, ts.pole)
        dg = np.maximum(res / k, floor_m)
        dm = dg * k
        out = []
        for ax in (0, 1):
            pts = []
            for sgn in (1.0, -1.0):
                xx = x + sgn * dm if ax == 0 else x
                yy = y + sgn * dm if ax == 1 else y
                la, lo = polar_inverse(xx, yy, ts.pole)
                pts.append(at(la, lo, xx, yy))
            out.append(_diff(pts[0], pts[1], h, dg, dg))
        return out[0], out[1]
    cl = np.cos(np.radians(lat))
    unit = math.radians(res) * R_MOON_M
    dgx = np.maximum(unit * cl, floor_m)
    dgy = np.maximum(unit, floor_m)
    dlon = np.minimum(np.degrees(dgx / (R_MOON_M * np.maximum(cl, 1e-12))), 90.0)
    bx = np.radians(dlon) * R_MOON_M * cl
    he, hw = at(lat, lon + dlon), at(lat, lon - dlon)
    la_n = np.minimum(lat + np.degrees(dgy / R_MOON_M), 90.0)
    la_s = np.maximum(lat - np.degrees(dgy / R_MOON_M), -90.0)
    hn, hs = at(la_n, lon), at(la_s, lon)
    gx = _diff(he, hw, h, bx, bx)
    gy = _diff(hn, hs, h, np.radians(la_n - lat) * R_MOON_M, np.radians(lat - la_s) * R_MOON_M)
    return gx, gy


def _ramp(values: np.ndarray, stops: np.ndarray, rgb: np.ndarray) -> np.ndarray:
    return np.stack([np.interp(values, stops, rgb[:, c]) for c in range(3)], axis=-1)


def render_tile(snap: Snapshot, ts: Tileset, layer: str, z: int, tx: int, ty: int) -> bytes:
    """PNG bytes of one tile (see ``tileset_definitions`` for the encodings)."""
    res = ts.resolution(z)
    minx, _, _, maxy = ts.extent
    i = np.arange(TILE) + 0.5
    xs = minx + (tx * TILE + i) * res
    ys = maxy - (ty * TILE + i) * res
    w = TILE * res
    region = (xs[0] - res / 2 - w, ys[-1] - res / 2 - w, xs[-1] + res / 2 + w, ys[0] + res / 2 + w)
    entries = [e for e in snap.entries if (b := e.bbox.get(ts.id)) is not None and _overlaps(b, region)]
    if not entries:
        return EMPTY_PNG
    X, Y = np.meshgrid(xs, ys)
    X, Y = X.ravel(), Y.ravel()
    if ts.kind == "global":
        lat, lon = Y, X
        xy = None
    else:
        lat, lon = polar_inverse(X, Y, ts.pole)
        xy = (X, Y)
    h, src, _ = sample_composite(entries, lat, lon, ts.nominal_res_m(z), xy, ts.pole)
    valid = np.isfinite(h)
    if not valid.any():
        return EMPTY_PNG
    rgba = np.zeros((TILE * TILE, 4), np.uint8)
    if layer == "heights":
        v = h[valid] + 32768.0
        fv = np.floor(v)
        rgba[valid, 0] = np.clip(np.floor(v / 256.0), 0, 255)
        rgba[valid, 1] = np.mod(fv, 256.0)
        rgba[valid, 2] = np.clip(np.floor((v - fv) * 256.0), 0, 255)
        rgba[valid, 3] = 255
    elif layer == "elevation":
        vmin, vmax = ts.elevation_range_m
        t = np.clip((h[valid] - vmin) / (vmax - vmin), 0.0, 1.0)
        rgba[valid, :3] = np.rint(_ramp(t, _ELEV_T, _ELEV_RGB))
        rgba[valid, 3] = 255
    else:
        idx = np.flatnonzero(valid)
        gx, gy = _gradient(entries, ts, z, lat[idx], lon[idx], X[idx], Y[idx], h[idx], src[idx])
        ok = np.isfinite(gx) & np.isfinite(gy)
        idx, gx, gy = idx[ok], gx[ok], gy[ok]
        if layer == "slope":
            slope = np.degrees(np.arctan(np.hypot(gx, gy)))
            rgba[idx, :3] = np.rint(_ramp(slope, _SLOPE_V, _SLOPE_RGB))
        else:
            az, alt = math.radians(SUN_AZIMUTH_DEG), math.radians(SUN_ALTITUDE_DEG)
            lx, ly, lz = math.sin(az) * math.cos(alt), math.cos(az) * math.cos(alt), math.sin(alt)
            shade = np.clip((-gx * lx - gy * ly + lz) / np.sqrt(gx * gx + gy * gy + 1.0), 0.0, 1.0)
            rgba[idx, :3] = np.rint(shade * 255.0)[:, None]
        rgba[idx, 3] = 255
    return _png(rgba.reshape(TILE, TILE, 4))


def _align4(n: int) -> int:
    return (n + 3) & ~3


def build_patch(snap: Snapshot, lat: float, lon: float, size_m: float, n: int, include_source: bool) -> tuple[bytes, dict]:
    """LNP1 elevation patch: returns the file bytes and the header."""
    spacing = size_m / (n - 1)
    half = size_m / 2.0
    e = -half + np.arange(n) * spacing
    nn = half - np.arange(n) * spacing
    E, N = np.meshgrid(e, nn)
    dist = np.hypot(E, N).ravel()
    az = np.degrees(np.arctan2(E, N)).ravel()
    plat, plon = destination(lat, lon, az, dist)
    reach = (half * math.sqrt(2.0) + 1.0) / R_MOON_M
    entries = [x for x in snap.entries
               if x.circle is None or float(angular_distance(lat, lon, x.circle[0], x.circle[1])) <= x.circle[2] + reach]
    h, src, levels = sample_composite(entries, plat, plon, spacing)
    used = sorted({int(s) for s in np.unique(src) if s >= 0})
    remap = np.full(len(entries) + 1, 255, np.uint8)
    sources = []
    for k, i in enumerate(used):
        remap[i] = k
        ent = entries[i]
        lv = int(levels[i])
        sources.append({"id": ent.store.dem_id, "pixel_size_m": ent.store.pixel_size_m,
                        "projection": ent.store.geometry.kind, "level": lv,
                        "level_pixel_size_m": ent.px_m * (1 << lv)})
    finite = np.isfinite(h)
    corners = {}
    for name, idx in (("nw", 0), ("ne", n - 1), ("sw", (n - 1) * n), ("se", n * n - 1)):
        corners[name] = {"lat_deg": float(plat[idx]), "lon_deg": float(_to180(plon[idx]))}
    drop = (half * math.sqrt(2.0)) ** 2 / (2.0 * R_MOON_M)
    header: dict[str, Any] = {
        "format": "LNP1",
        "lat_deg": lat,
        "lon_deg": lon,
        "size_m": size_m,
        "n": n,
        "spacing_m": spacing,
        "radius_m": R_MOON_M,
        "east_m": [float(e[0]), float(e[-1])],
        "north_m": [float(nn[0]), float(nn[-1])],
        "corners": corners,
        "nodata": "NaN",
        "data_offset": 0,
        "dtype": "float32le",
        "row_order": "row 0 = north edge, column 0 = west edge",
        "include_source": include_source,
        "source_dtype": "uint8" if include_source else None,
        "source_nodata": 255,
        "sources": sources,
        "height_range_m": [float(h[finite].min()), float(h[finite].max())] if finite.any() else None,
        "n_nodata": int((~finite).sum()),
        "effective_resolution_m": min((s["level_pixel_size_m"] for s in sources), default=None),
        "notes": "Sample (row i, col j) is the point reached from the centre along the great circle with "
        "azimuth atan2(east_m, north_m) for distance hypot(east_m, north_m) (azimuthal-equidistant tangent "
        "grid). Height = bilinear sample from the finest store with valid data, at the coarsest pyramid level "
        "whose pixel is not larger than spacing_m (level 0 if the data is coarser than the spacing).",
        "curvature": "Heights are above the 1737.4 km sphere. A flat east/north tangent-plane 3D view must "
        "subtract the sphere drop d^2/(2R), d = hypot(east_m, north_m), R = radius_m "
        f"({drop:.3f} m at the corners of this patch).",
        "curvature_drop_corner_m": drop,
        "patch_version": PATCH_VERSION,
        "stack_hash": snap.stack_hash,
    }
    off = 0
    while True:
        header["data_offset"] = off
        hb = dumps(header)
        new = _align4(8 + len(hb))
        if new == off:
            break
        off = new
    parts = [PATCH_MAGIC, struct.pack("<I", len(hb)), hb, b"\0" * (off - 8 - len(hb)), h.astype("<f4").tobytes()]
    if include_source:
        parts.append(remap[np.where(src >= 0, src, len(entries))].astype(np.uint8).tobytes())
    return b"".join(parts), header


def parse_patch_header(blob: bytes) -> dict:
    """Header of an LNP1 blob (first bytes are enough)."""
    if blob[:4] != PATCH_MAGIC:
        raise ValueError("not an LNP1 patch")
    (hl,) = struct.unpack("<I", blob[4:8])
    return loads(blob[8 : 8 + hl])


def _write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


@dataclass
class TerrainService:
    """Per-process terrain state: catalogue, disk caches and the two executors."""

    data_dir: Path
    tile_max_bytes: int = 1024**3
    patch_max_bytes: int = 1024**3
    catalog: StoreCatalog = field(init=False)
    render_pool: ThreadPoolExecutor = field(init=False)
    query_pool: ThreadPoolExecutor = field(init=False)

    def __post_init__(self) -> None:
        self.catalog = StoreCatalog(self.data_dir / "dem" / "store")
        self.tiles_dir = self.data_dir / "service" / "tiles"
        self.patch_dir = self.data_dir / "service" / "patches"
        self.render_pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="terrain-render")
        self.query_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="terrain-query")
        self.tile_budget = DiskBudget(self.tiles_dir, self.tile_max_bytes, "file", min_interval_s=20.0)
        self.patch_budget = DiskBudget(self.patch_dir, self.patch_max_bytes, "file")

    async def _run(self, pool: ThreadPoolExecutor, fn: Callable[..., T], *args: Any) -> T:
        return await asyncio.get_running_loop().run_in_executor(pool, functools.partial(fn, *args))

    def tile_path(self, stack_hash: str, tileset: str, layer: str, z: int, x: int, y: int) -> Path:
        return self.tiles_dir / stack_hash[:24] / f"r{RENDER_VERSION}" / tileset / layer / str(z) / str(x) / f"{y}.png"

    def _render_and_store(self, snap: Snapshot, ts: Tileset, layer: str, z: int, x: int, y: int, path: Path) -> bytes:
        data = render_tile(snap, ts, layer, z, x, y)
        _write_atomic(path, data)
        self.tile_budget.maybe_prune()
        return data

    async def tile(self, snap: Snapshot, ts: Tileset, layer: str, z: int, x: int, y: int) -> tuple[bytes, bool]:
        """(png, cache_hit)."""
        path = self.tile_path(snap.stack_hash, ts.id, layer, z, x, y)
        try:
            return path.read_bytes(), True
        except FileNotFoundError:
            pass
        return await self._run(self.render_pool, self._render_and_store, snap, ts, layer, z, x, y, path), False

    def patch_key(self, snap: Snapshot, lat: float, lon: float, size_m: float, n: int, include_source: bool) -> str:
        req = {"v": PATCH_VERSION, "stack": snap.stack_hash, "lat": lat, "lon": lon, "size_m": size_m, "n": n,
               "src": include_source}
        return hashlib.sha256(dumps(req, canonical=True)).hexdigest()

    def _patch(self, snap: Snapshot, key: str, lat: float, lon: float, size_m: float, n: int,
               include_source: bool, header_only: bool) -> tuple[bytes | dict, bool]:
        path = self.patch_dir / f"{key}.lnp"
        try:
            if header_only:
                with open(path, "rb") as fh:
                    head = fh.read(8)
                    (hl,) = struct.unpack("<I", head[4:8])
                    out: bytes | dict = loads(fh.read(hl))
            else:
                out = path.read_bytes()
            os.utime(path)
            return out, True
        except (FileNotFoundError, struct.error):
            pass
        blob, header = build_patch(snap, lat, lon, size_m, n, include_source)
        _write_atomic(path, blob)
        self.patch_budget.prune(keep=[path])
        return (header if header_only else blob), False

    async def patch(self, lat: float, lon: float, size_m: float, n: int, include_source: bool,
                    header_only: bool = False) -> tuple[bytes | dict, str, bool]:
        """(blob or header, cache key, cache_hit)."""
        snap = self.catalog.snapshot(CATALOG_TTL_S)
        key = self.patch_key(snap, lat, lon, size_m, n, include_source)
        out, hit = await self._run(self.render_pool, self._patch, snap, key, lat, lon, size_m, n, include_source,
                                   header_only)
        return out, key, hit

    def _points(self, snap: Snapshot, pts: list[tuple[float, float]], baseline_m: float) -> list[dict]:
        stack = snap.stack()
        out = []
        for lat, lon in pts:
            if stack is None:
                h, s, sl, asp = math.nan, -1, math.nan, math.nan
            else:
                lon360 = lon % 360.0
                hh, ss = stack.height_and_store(lat, lon360)
                h, s = float(hh.ravel()[0]), int(ss.ravel()[0])
                d = slope_at(stack, lat, lon360, baseline_m)
                sl, asp = d["slope_deg"], d["aspect_deg"]
            st = stack.stores[s] if (stack is not None and s >= 0) else None
            out.append({
                "lat_deg": lat, "lon_deg": lon,
                "height_m": h if math.isfinite(h) else None,
                "slope_deg": sl if math.isfinite(sl) else None,
                "aspect_deg": asp if math.isfinite(sl) else None,
                "baseline_m": baseline_m,
                "store_id": st.dem_id if st is not None else None,
                "pixel_size_m": st.pixel_size_m if st is not None else None,
            })
        return out

    async def points(self, pts: list[tuple[float, float]], baseline_m: float) -> list[dict]:
        snap = self.catalog.snapshot(CATALOG_TTL_S)
        return await self._run(self.query_pool, self._points, snap, pts, baseline_m)

    def close(self) -> None:
        self.render_pool.shutdown(wait=False, cancel_futures=True)
        self.query_pool.shutdown(wait=False, cancel_futures=True)
