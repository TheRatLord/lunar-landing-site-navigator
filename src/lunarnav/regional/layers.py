"""Regional layers: chunked, resumable computation of illumination and visibility rasters over a region.

Layers (float32, NaN = no terrain data; row 0 is north; see ``RegionSpec``):

``average_illumination``  fraction of epochs with any part of the Sun above the horizon (the definition of the
                          LOLA ``AVGVISIB`` rasters, 0..1)
``sun_mean_flux``         mean limb-darkened flux fraction of the solar disc (0..1)
``sunlit_fraction``       fraction of epochs sunlit by ``spec.sun_rule``
``longest_sunlit_h``, ``longest_shadow_h``   longest run of sunlit / shadowed epochs, hours (run length x step)
``earth_fraction``        fraction of epochs with Earth visible by ``spec.earth_rule``
``longest_earth_outage_h``   longest run of epochs without Earth, hours
``slope_deg``, ``ground_height_m``   terrain slope (central difference at the cell spacing) and height
``censoring_flags`` (uint8)  bit 0/1/2: the longest sunlit run / shadow run / Earth outage touches the first or last
                          epoch, so the true run may be longer than the period shows

With ``bounds`` every statistic also has ``<name>_lo`` and ``<name>_hi`` (an estimated lower and upper bracket of the statistic, not a guaranteed bound), evaluated
against the horizon shifted by the *measured* regional-versus-exact horizon error (``calibrate``): the exact engine
runs on a random sample of cells and the shifts are the quantile ``bound_quantile`` of the residual in each
direction.  The header records the residual statistics and the shifts.
"""

from __future__ import annotations

import hashlib
import json
import math
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path

import numba
import numpy as np

from lunarnav.constants import R_MOON_M
from lunarnav.horizon.engine import ENGINE_VERSION as HORIZON_VERSION
from lunarnav.horizon.engine import horizon_arrays, observer_frames
from lunarnav.regional import _kernels as K
from lunarnav.regional import horizons as H
from lunarnav.regional.grid import PROJ4, Method, RegionSpec
from lunarnav.regional.support import HORIZON_SHIFT_LOWERED, LAYER_SUPPORT, support_table
from lunarnav.regional.tracks import RegionGeometry, build_geometry
from lunarnav.terrain.stack import TerrainStack, unit_vector
from lunarnav.visibility.disc import _gauss_unit

VERSION = "regional/3"
STAT_LAYERS = (
    "average_illumination", "sun_mean_flux", "sunlit_fraction", "longest_sunlit_h", "longest_shadow_h",
    "earth_fraction", "longest_earth_outage_h",
)  # fmt: skip
TERRAIN_LAYERS = ("slope_deg", "ground_height_m")
FLAG_LAYER = "censoring_flags"
FLAG_NEAR_STORE_CHANGE = 8
FLAG_BRACKET_SHIFT = 4
"""``censoring_flags``: bits 0-2 the nominal sunlit / shadow / Earth-outage run touches an end of the period; bit 3 (value 8) the cell is within
``SEAM_RADIUS_CELLS`` cells of a change of ground store (terrain product); bits 4-6 (16, 32, 64) the same run censoring in any of the
``_lo`` / ``_hi`` brackets."""
SEAM_RADIUS_CELLS = 2
BOUND_ELEVATION_FLOOR = -90.0


@dataclass(slots=True)
class RegionalLayers:
    """Computed layers with their grid and provenance (see module doc for the layer list)."""

    spec: RegionSpec
    layers: dict[str, np.ndarray]
    header: dict
    out_dir: Path | None = None

    def xy(self) -> tuple[np.ndarray, np.ndarray]:
        """Map coordinates (m) of cell centres, ``(n_rows, n_cols)`` each."""
        r, c = np.meshgrid(np.arange(self.spec.n_rows), np.arange(self.spec.n_cols), indexing="ij")
        return self.spec.xy(r, c)

    def lonlat(self) -> tuple[np.ndarray, np.ndarray]:
        """Planetocentric latitude and east longitude ([0, 360) deg, ME) of cell centres."""
        r, c = np.meshgrid(np.arange(self.spec.n_rows), np.arange(self.spec.n_cols), indexing="ij")
        return self.spec.lonlat(r, c)

    @property
    def lat_deg(self) -> np.ndarray:
        return self.lonlat()[0]

    @property
    def lon_deg(self) -> np.ndarray:
        return self.lonlat()[1]

    def __getitem__(self, name: str) -> np.ndarray:
        return self.layers[name]


def verdict_layer(layers: RegionalLayers | dict[str, np.ndarray], limits: dict[str, tuple[str, float]]) -> np.ndarray:
    """Constraint verdict per cell: ``1`` pass on the pessimistic end of the estimated bracket, ``-1`` fail on the optimistic end,
    ``0`` marginal (between), ``-128`` no data or near a boundary between terrain products (flag bit 3: not reliable).  The brackets are estimates (measured coverage in ``support.py``), so a pass or fail can
    be wrong in the few cells where the bracket misses the exact value.

    ``limits`` maps a layer name to ``(op, value)`` with ``op`` in ``{">=", "<="}``.  Brackets come from the
    ``<name>_lo`` / ``<name>_hi`` layers (exact layers such as ``slope_deg`` use the value itself).  For ``>=``
    the pessimistic end is the lower one; for ``<=`` the upper one.  A cell passes when every limit passes,
    fails when any limit fails.
    """
    arrs = layers.layers if isinstance(layers, RegionalLayers) else layers
    shape = next(iter(arrs.values())).shape
    passed = np.ones(shape, bool)
    failed = np.zeros(shape, bool)
    nodata = np.zeros(shape, bool)
    for name, (op, value) in limits.items():
        if op not in (">=", "<="):
            raise ValueError(f"unsupported operator {op!r}; use '>=' or '<='")
        v = arrs[name]
        lo, hi = arrs.get(name + "_lo", v), arrs.get(name + "_hi", v)
        nodata |= ~np.isfinite(v)
        if op == ">=":
            passed &= lo >= value
            failed |= hi < value
        else:
            passed &= hi <= value
            failed |= lo > value
    if FLAG_LAYER in arrs:
        nodata |= (arrs[FLAG_LAYER] & FLAG_NEAR_STORE_CHANGE) != 0
    out = np.where(failed, -1, np.where(passed, 1, 0)).astype(np.int8)
    out[nodata] = -128
    return out


def near_store_change(spec: RegionSpec, stack: TerrainStack, pk, rows, cols, radius: int = SEAM_RADIUS_CELLS) -> np.ndarray:
    """True where a cell centre within ``radius`` cells (Chebyshev) of the cell has a different ground store (terrain product) than the
    cell itself, or no terrain.  Cells beside such a change see a height step of the stack as a wall that the regional ladder and the exact
    engine can resolve differently; their values are flagged ``FLAG_NEAR_STORE_CHANGE``."""
    rows, cols = np.asarray(rows), np.asarray(cols)
    px = H.store_pixels(pk, stack)
    ids = []
    for dr in range(-radius, radius + 1):
        for dc in range(-radius, radius + 1):
            la, lo = spec.lonlat(rows + dr, cols + dc)
            ids.append(K.ground_store(*pk.args(), px, np.ascontiguousarray(unit_vector(la, lo))))
    ids = np.stack(ids, 1)
    centre = ids[:, ids.shape[1] // 2][:, None]
    return (ids != centre).any(1)


def select_calibration_cells(spec: RegionSpec, stack: TerrainStack, pk, n_cells: int, seed: int = 0) -> tuple[np.ndarray, np.ndarray, dict]:
    """Random cells with terrain that are not within ``SEAM_RADIUS_CELLS`` cells of a change of ground store."""
    rng = np.random.default_rng(seed)
    n_draw = 8 * n_cells
    rr = rng.integers(0, spec.n_rows, n_draw)
    cc = rng.integers(0, spec.n_cols, n_draw)
    hg = H.ground_heights(spec, stack, pk, rr, cc)
    has = np.isfinite(hg)
    seam = near_store_change(spec, stack, pk, rr, cc) & has
    ok = np.flatnonzero(has & ~seam)[:n_cells]
    info = {"seed": seed, "drawn": int(n_draw), "with_terrain": int(has.sum()), "near_store_change_excluded": int(seam.sum())}
    return rr[ok], cc[ok], info


def _layer_errors(spec, method, geom, rows, cols, hg, regional_deg, exact_deg, do_earth) -> dict:
    """Regional minus exact value of every statistic on the given cells (fractions in percentage points, run lengths in hours)."""
    h = spec.step_s / 3600.0
    fr, ir = _stats_tile(spec, method, geom, regional_deg, hg, rows, cols, [0.0], do_earth)
    fe, ie = _stats_tile(spec, method, geom, exact_deg, hg, rows, cols, [0.0], do_earth)
    parts = {
        "average_illumination": (100.0 * (fr[:, 0, 2] - fe[:, 0, 2]), "percentage points"),
        "sun_mean_flux": (100.0 * (fr[:, 0, 1] - fe[:, 0, 1]), "percentage points"),
        "sunlit_fraction": (100.0 * (fr[:, 0, 3] - fe[:, 0, 3]), "percentage points"),
        "longest_sunlit_h": (h * (ir[:, 0, 0] - ie[:, 0, 0]), "hours"),
        "longest_shadow_h": (h * (ir[:, 0, 1] - ie[:, 0, 1]), "hours"),
    }
    if do_earth:
        parts["earth_fraction"] = (100.0 * (fr[:, 0, 4] - fe[:, 0, 4]), "percentage points")
        parts["longest_earth_outage_h"] = (h * (ir[:, 0, 2] - ie[:, 0, 2]), "hours")
    out = {}
    for name, (e, unit) in parts.items():
        e = np.asarray(e, float)
        a = np.abs(e)
        out[name] = {"unit": unit, "n_cells": int(e.size), "mean_signed": float(e.mean()), "mean_abs": float(a.mean()),
                     "p95_abs": float(np.percentile(a, 95)), "max_abs": float(a.max())}
    return out


def calibrate_horizon_error(
    spec: RegionSpec, method: Method, stack: TerrainStack, *, n_cells: int = 32, seed: int = 0, quantile: float = 0.99,
    cells: tuple[np.ndarray, np.ndarray] | None = None, geometry: RegionGeometry | None = None, do_earth: bool = True,
    check: Callable[[], None] | None = None,
) -> dict:
    """Regional minus exact horizon on a random sample of cells (exact: ``lunarnav.horizon.horizon_arrays``).

    Cells within ``SEAM_RADIUS_CELLS`` of a change of ground store are never drawn (a height step of the stack beside the cell would set the
    pooled quantile for the whole area).  The result also holds the regional-minus-exact error of every statistic on the same cells
    (``layer_errors``) and the configuration it was measured at.  ``check`` is called between blocks of work (see ``horizon_residuals``).
    """
    pk = _pack(spec, stack, method)
    sel = None
    if cells is None:
        rows, cols, sel = select_calibration_cells(spec, stack, pk, n_cells, seed)
    else:
        rows, cols = cells
    if len(rows) == 0:
        raise ValueError("no calibration cell with terrain away from a change of terrain product")
    out = horizon_residuals(spec, method, stack, rows, cols, check=check)
    r = out["residual_deg"]
    eps_hi = max(0.0, float(np.quantile(-r, quantile)))
    eps_lo = max(0.0, float(np.quantile(r, quantile)))
    geom = geometry or build_geometry(spec)
    if check is not None:
        check()
    layer_errors = _layer_errors(spec, method, geom, rows, cols, out["ground_height_m"], out["regional_deg"], out["exact_deg"], do_earth)
    return {
        "n_cells": int(len(rows)), "n_az": method.n_az, "quantile": quantile, "eps_hi_deg": eps_hi, "eps_lo_deg": eps_lo,
        "bias_deg": float(r.mean()), "rms_deg": float(np.sqrt(np.mean(r**2))),
        "percentiles_deg": {str(p): float(np.percentile(r, p)) for p in (0.5, 1, 5, 25, 50, 75, 95, 99, 99.5)},
        "max_abs_deg": float(np.abs(r).max()), "exact_engine": HORIZON_VERSION,
        "selection": sel, "layer_errors": layer_errors,
        "configuration": run_configuration(spec, method, stack, n_cells=int(len(rows)), seed=seed),
    }


def run_configuration(spec: RegionSpec, method: Method, stack: TerrainStack, *, n_cells: int, seed: int) -> dict:
    """The settings an error measurement of this run holds for."""
    return {
        "mast_height_m": spec.mast_height_m, "sun_rule": spec.sun_rule, "earth_rule": spec.earth_rule, "spacing_m": spec.spacing_m,
        "step_s": spec.step_s, "start_utc": spec.start_utc, "stop_utc": spec.stop_utc, "n_az": method.n_az, "kappa": method.kappa,
        "dem_ids": list(stack.dem_ids), "stack_hash": stack.stack_hash, "calibration_cells": n_cells, "calibration_seed": seed,
        "calibration_cells_exclude_store_changes": True,
    }


EXACT_BLOCK = 2
"""Sites per call of the exact horizon engine when a ``check`` hook is given (about a second at 4 sites per second)."""


def horizon_residuals(spec: RegionSpec, method: Method, stack: TerrainStack, rows, cols, check: Callable[[], None] | None = None) -> dict:
    """Regional horizon, exact horizon and their difference (deg) for the listed cells (same azimuth grid).

    ``check`` is called between blocks of the regional march and between blocks of ``EXACT_BLOCK`` exact sites (an exception it raises
    propagates); the arrays do not depend on it."""
    pk = _pack(spec, stack, method)
    rows, cols = np.asarray(rows), np.asarray(cols)
    hg = H.ground_heights(spec, stack, pk, rows, cols)
    rng_m = H.range_for(stack, float(np.nanmax(hg)) + spec.mast_height_m + R_MOON_M, method)
    hz = H.tile_horizons(spec, method, stack, pk, rows, cols, hg, rng_m, check=check)
    lat, lon = spec.lonlat(rows, cols)
    lat, lon = np.atleast_1d(lat), np.atleast_1d(lon)
    if check is None or len(lat) <= EXACT_BLOCK:
        if check is not None:
            check()
        ex = horizon_arrays(lat, lon, spec.mast_height_m, stack, n_az=method.n_az, max_range_km=rng_m / 1000.0)
    else:
        parts = []
        for a in range(0, len(lat), EXACT_BLOCK):
            check()
            parts.append(horizon_arrays(lat[a : a + EXACT_BLOCK], lon[a : a + EXACT_BLOCK], spec.mast_height_m, stack, n_az=method.n_az,
                                        max_range_km=rng_m / 1000.0))
        ex = {k: np.concatenate([q[k] for q in parts]) for k in parts[0]}
    return {"regional_deg": hz, "exact_deg": ex["elev_deg"], "residual_deg": hz - ex["elev_deg"], "exact": ex, "ground_height_m": hg}


def _centre(spec: RegionSpec) -> tuple[float, float, float]:
    lat, lon = spec.lonlat((spec.n_rows - 1) / 2.0, (spec.n_cols - 1) / 2.0)
    return float(lat), float(lon), 0.0


def _half_diag(spec: RegionSpec) -> float:
    return 0.5 * spec.spacing_m * math.hypot(spec.n_rows, spec.n_cols) * 1.05 + spec.spacing_m


def _pack(spec: RegionSpec, stack: TerrainStack, method: Method):
    """Packed stores that can intersect the region or any ray out to the maximum search range."""
    lat, lon, _ = _centre(spec)
    return stack.pack(lat, lon, _half_diag(spec) + (method.max_range_km or 1000.0) * 1000.0)


def slope_tile(spec: RegionSpec, stack: TerrainStack, pk, rows, cols) -> np.ndarray:
    """Terrain slope (deg) by central differences at one cell spacing on the composite bilinear terrain."""
    lat0, lon0 = spec.lonlat(rows, cols)
    px = H.store_pixels(pk, stack)
    out = np.empty((4, len(rows)))
    b = spec.spacing_m
    for q, (dr, dc) in enumerate(((0, 1), (0, -1), (-1, 0), (1, 0))):
        la, lo = spec.lonlat(rows + dr, cols + dc)
        out[q] = K.heights(*pk.args(), px, np.ascontiguousarray(unit_vector(la, lo)))
    k = 1.0 + (np.hypot(*spec.xy(rows, cols)) / (2.0 * R_MOON_M)) ** 2
    dx = (out[0] - out[1]) / (2.0 * b / k)
    dy = (out[3] - out[2]) / (2.0 * b / k)
    return np.degrees(np.arctan(np.hypot(dx, dy)))


class RegionalInputError(ValueError):
    """The request cannot be computed as given (nothing to compute, or it would not fit in memory)."""


def estimate_memory_bytes(spec: RegionSpec, bounds: bool, do_earth: bool) -> int:
    """Memory the program itself needs for a region (full-size layer arrays, one transient copy while writing, tile working set).

    Memory-mapped terrain is not counted: it is file backed and evictable."""
    n_float = (7 if do_earth else 5) * (3 if bounds else 1) + 2
    return int(spec.n_cells * (4 * n_float + 1) * 1.1 + 4 * spec.n_cells * 4 + 0.4e9)


def available_memory_bytes() -> int | None:
    """Memory this process can still allocate (``MemAvailable`` of the machine, lowered by a cgroup limit), or ``None`` if unknown."""
    avail = None
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemAvailable:"):
                avail = int(line.split()[1]) * 1024
    except OSError:
        return None
    try:
        lim = Path("/sys/fs/cgroup/memory.max").read_text().strip()
        if lim.isdigit():
            anon = 0
            for line in Path("/sys/fs/cgroup/memory.stat").read_text().splitlines():
                if line.startswith("anon "):
                    anon = int(line.split()[1])
            room = max(int(lim) - anon, 0)
            avail = room if avail is None else min(avail, room)
    except OSError:
        pass
    return avail


def _check_inputs(spec: RegionSpec, stack: TerrainStack, pk, mask: np.ndarray, bounds: bool, do_earth: bool, max_memory_bytes: int | None) -> None:
    need = estimate_memory_bytes(spec, bounds, do_earth)
    limit = max_memory_bytes if max_memory_bytes is not None else (None if (a := available_memory_bytes()) is None else int(0.8 * a))
    if limit is not None and need > limit:
        raise RegionalInputError(
            f"the region ({spec.n_rows} x {spec.n_cols} = {spec.n_cells:,} cells) needs about {need / 1e9:.1f} GB of memory for its layers; "
            f"{limit / 1e9:.1f} GB is allowed. Use a smaller region or a coarser spacing, or drop the brackets or the Earth layers.")
    idx = np.flatnonzero(mask.ravel())
    if idx.size == 0:
        raise RegionalInputError("the cell mask selects no cell")
    pick = idx[np.linspace(0, idx.size - 1, min(idx.size, 4096)).astype(np.int64)]
    hg = H.ground_heights(spec, stack, pk, pick // spec.n_cols, pick % spec.n_cols)
    if not np.isfinite(hg).any():
        lat, lon = spec.lonlat((spec.n_rows - 1) / 2.0, (spec.n_cols - 1) / 2.0)
        raise RegionalInputError(
            f"no cell of the region has terrain data in the terrain stack ({list(stack.dem_ids)}); the region centre is at latitude "
            f"{float(lat):.3f}, longitude {float(lon):.3f}. The terrain products cover the polar caps only.")


def _bracket_widths(layers: dict[str, np.ndarray]) -> dict:
    """Distribution of the bracket width ``hi - lo`` of every bracketed layer over the cells that are not near a store change."""
    flag = layers[FLAG_LAYER]
    out = {}
    for name in STAT_LAYERS:
        if name + "_lo" not in layers:
            continue
        w = layers[name + "_hi"].astype(np.float64) - layers[name + "_lo"].astype(np.float64)
        keep = np.isfinite(w) & ((flag & FLAG_NEAR_STORE_CHANGE) == 0)
        if not keep.any():
            continue
        w = w[keep]
        frac = not name.endswith("_h")
        if frac:
            w = 100.0 * w
        rec = {"unit": "percentage points" if frac else "hours", "cells": int(w.size), "mean": float(w.mean()),
               **{f"p{q}": float(np.percentile(w, q)) for q in (5, 50, 95, 99)}, "max": float(w.max())}
        if frac:
            rec["share_wider_than_5_points"] = float((w > 5.0).mean())
        out[name] = rec
    return out


def _config_hash(spec: RegionSpec, method: Method, stack: TerrainStack, bounds: bool, eps: tuple[float, float],
                 mask_hash: str) -> str:
    payload = {"v": VERSION, "spec": asdict(spec), "method": {k: v for k, v in asdict(method).items() if k != "extra"},
               "stack": stack.stack_hash, "bounds": bounds, "eps": eps, "mask": mask_hash}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def _empty_layers(shape: tuple[int, int], bounds: bool, do_earth: bool) -> dict[str, np.ndarray]:
    names = [n for n in STAT_LAYERS if do_earth or not n.startswith(("earth", "longest_earth"))]
    out: dict[str, np.ndarray] = {}
    for n in names:
        out[n] = np.full(shape, np.nan, np.float32)
        if bounds:
            out[n + "_lo"] = np.full(shape, np.nan, np.float32)
            out[n + "_hi"] = np.full(shape, np.nan, np.float32)
    for n in TERRAIN_LAYERS:
        out[n] = np.full(shape, np.nan, np.float32)
    out[FLAG_LAYER] = np.zeros(shape, np.uint8)
    return out


STATS_BLOCK = 128
"""Cells per call of the statistics kernel when a ``check`` hook is given (a few tenths of a second at 4 threads, 17,545 epochs)."""


def _stats_tile(spec, method, geom: RegionGeometry, hz, hg, rows, cols, offsets, do_earth, check=None):
    lat, lon = spec.lonlat(rows, cols)
    up, north, east = observer_frames(lat, lon)
    spos = np.ascontiguousarray(up * ((R_MOON_M + np.nan_to_num(hg) + spec.mast_height_m) / 1000.0)[:, None])
    gn, gw = _gauss_unit(24)
    nb = len(offsets)
    out_f = np.empty((len(rows), nb, 5))
    out_i = np.empty((len(rows), nb, 4), np.int64)
    hz = np.ascontiguousarray(hz)
    offs = np.asarray(offsets, np.float64)
    block = STATS_BLOCK if check is not None else max(1, len(rows))
    for a in range(0, len(rows), block):
        if check is not None:
            check()
        b = min(a + block, len(rows))
        K.series_stats(
            hz[a:b], offs, up[a:b], east[a:b], north[a:b], spos[a:b], geom.sun_pos, geom.sun_d,
            geom.r_sun_km, geom.earth_pos, geom.earth_d, geom.r_earth_km, bool(do_earth),
            0 if spec.sun_rule == "any_part" else 1, 0 if spec.earth_rule == "centre" else 1, spec.earth_margin_deg,
            spec.limb_alpha, gn, gw, out_f[a:b], out_i[a:b],
        )  # fmt: skip
    return out_f, out_i


def compute_layers(
    spec: RegionSpec,
    stack: TerrainStack,
    method: Method | None = None,
    *,
    out_dir: str | Path | None = None,
    cell_mask: np.ndarray | None = None,
    bounds: bool = True,
    calibrate: int = 32,
    bound_quantile: float = 0.99,
    do_earth: bool = True,
    threads: int | None = None,
    progress: Callable[[int, int], None] | None = None,
    geometry: RegionGeometry | None = None,
    max_memory_bytes: int | None = None,
) -> RegionalLayers:
    """Compute the layers of ``spec`` on ``stack``.

    ``out_dir``: tiles are written to ``out_dir/tiles`` as they finish and a second call with the same inputs
    resumes after the last finished tile (a tile file is reused only if its configuration hash matches).
    ``cell_mask``: boolean ``(n_rows, n_cols)``; only those cells are computed (others stay NaN).
    ``calibrate``: sample cells for the exact-engine calibration that sets the bracket shifts and gives this run's own measured error
    of every layer (0: none, and no brackets unless a prior calibration is passed through ``Method.extra['eps']`` as
    ``(eps_lo_deg, eps_hi_deg)``).  ``max_memory_bytes``: refuse regions whose layers need more (default: 80 % of the available memory).
    Raises ``RegionalInputError`` when the region has no terrain or does not fit.
    """
    method = method or Method()
    if threads:
        numba.set_num_threads(threads)
    t_start = time.time()
    shape = spec.shape
    mask = np.ones(shape, bool) if cell_mask is None else np.asarray(cell_mask, bool)
    if mask.shape != shape:
        raise ValueError(f"cell_mask shape {mask.shape} != region shape {shape}")
    mask_hash = hashlib.sha256(np.packbits(mask).tobytes()).hexdigest()[:16]
    if stack is None:
        raise ValueError("a TerrainStack is required")
    try:
        pk = _pack(spec, stack, method)
    except ValueError as exc:
        raise RegionalInputError(f"no cell of the region has terrain data: no store of {list(stack.dem_ids)} reaches the region ({exc})") from exc
    use_bounds = bool(bounds and (calibrate > 0 or "eps" in method.extra))
    _check_inputs(spec, stack, pk, mask, use_bounds, do_earth, max_memory_bytes)
    geom = geometry or build_geometry(spec)
    cal = None
    eps = tuple(method.extra.get("eps", (0.0, 0.0)))
    tile = method.tile
    tiles = [(r0, c0) for r0 in range(0, spec.n_rows, tile) for c0 in range(0, spec.n_cols, tile)]
    done = 0

    def tick() -> None:
        """The cancellation point: ``progress`` (which may raise) with the tiles finished so far, between blocks of work inside a tile and
        during the calibration."""
        if progress:
            progress(done, len(tiles))

    if calibrate > 0:
        t0 = time.time()
        cal = calibrate_horizon_error(spec, method, stack, n_cells=calibrate, quantile=bound_quantile, geometry=geom, do_earth=do_earth,
                                      check=tick)
        cal["wall_s"] = time.time() - t0
        if bounds:
            eps = (cal["eps_lo_deg"], cal["eps_hi_deg"])
    offsets = [0.0] + ([-eps[0], eps[1]] if use_bounds else [])
    chash = _config_hash(spec, method, stack, use_bounds, eps, mask_hash)
    tdir = None
    if out_dir is not None:
        out_dir = Path(out_dir)
        tdir = out_dir / "tiles"
        tdir.mkdir(parents=True, exist_ok=True)
    layers = _empty_layers(shape, use_bounds, do_earth)
    n_cells_done = 0
    t_hz = t_st = 0.0
    resumed = 0
    for r0, c0 in tiles:
        r1, c1 = min(r0 + tile, spec.n_rows), min(c0 + tile, spec.n_cols)
        sub = mask[r0:r1, c0:c1]
        if not sub.any():
            continue
        tfile = tdir / f"tile_{r0}_{c0}.npz" if tdir else None
        loaded = False
        if tfile is not None and tfile.exists():
            try:
                z = np.load(tfile)
                if str(z["config_hash"]) == chash:
                    rr, cc = np.nonzero(sub)
                    for name in layers:
                        layers[name][r0:r1, c0:c1][rr, cc] = z[name][rr, cc]
                    loaded = True
                    resumed += 1
            except (OSError, ValueError, KeyError):
                loaded = False
        if not loaded:
            rr, cc = np.nonzero(sub)
            rows, cols = rr + r0, cc + c0
            t0 = time.time()
            hg = H.ground_heights(spec, stack, pk, rows, cols)
            ok = np.isfinite(hg)
            tile_out = _empty_layers((r1 - r0, c1 - c0), use_bounds, do_earth)
            if ok.any():
                ro_max = float(np.max(hg[ok])) + spec.mast_height_m + R_MOON_M
                rng_m = H.range_for(stack, ro_max, method)
                hz = np.full((len(rows), method.n_az), np.nan)
                hz[ok] = H.tile_horizons(spec, method, stack, pk, rows[ok], cols[ok], hg[ok], rng_m, check=tick)
                t1 = time.time()
                f, i = _stats_tile(spec, method, geom, hz, hg, rows, cols, offsets, do_earth, check=tick)
                t2 = time.time()
                t_hz += t1 - t0
                t_st += t2 - t1
                _fill_tile(tile_out, spec, f, i, rr, cc, hg, slope_tile(spec, stack, pk, rows, cols), use_bounds, do_earth)
                seam = near_store_change(spec, stack, pk, rows[ok], cols[ok])
                tile_out[FLAG_LAYER][rr[ok], cc[ok]] |= (seam * FLAG_NEAR_STORE_CHANGE).astype(np.uint8)
            for name in layers:
                layers[name][r0:r1, c0:c1][rr, cc] = tile_out[name][rr, cc]
            if tfile is not None:
                tmp = tfile.with_name(tfile.stem + ".partial.npz")
                np.savez(tmp, config_hash=chash, **tile_out)
                tmp.replace(tfile)
        done += 1
        n_cells_done += int(sub.sum())
        tick()
    wall = time.time() - t_start
    covered = np.isfinite(layers["ground_height_m"]) & mask
    n_selected = int(mask.sum())
    if not covered.any():
        raise RegionalInputError("no cell of the region has terrain data in the terrain stack")
    header = _header(spec, method, stack, geom, cal, eps, use_bounds, chash, mask_hash, n_cells_done, wall, t_hz, t_st, resumed,
                     len(tiles), do_earth)
    n_seam = int(((layers[FLAG_LAYER] & FLAG_NEAR_STORE_CHANGE) != 0).sum())
    header["coverage"] = {"cells_selected": n_selected, "cells_with_terrain": int(covered.sum()), "cells_without_terrain": n_selected - int(covered.sum())}
    header["store_changes"] = {
        "radius_cells": SEAM_RADIUS_CELLS, "radius_m": SEAM_RADIUS_CELLS * spec.spacing_m, "flag_bit_value": FLAG_NEAR_STORE_CHANGE,
        "cells_flagged": n_seam, "share_of_cells_with_terrain": n_seam / int(covered.sum()),
        "meaning": "cells within radius_cells of a cell whose ground store (terrain product) differs: values are written but not reliable; "
                   "they are excluded from the calibration and from the bracket-width statistics",
    }
    if use_bounds:
        header["bracket_widths"] = _bracket_widths(layers)
    warns = []
    if n_selected > int(covered.sum()):
        warns.append(f"{n_selected - int(covered.sum())} of {n_selected} cells have no terrain data and are NaN")
    if n_seam:
        warns.append(f"{n_seam} cells are within {SEAM_RADIUS_CELLS} cells of a change of terrain product (flag bit {FLAG_NEAR_STORE_CHANGE}): not reliable")
    if spec.scale_factor() > 1.02:
        warns.append(f"map scale factor {spec.scale_factor():.3f} at the region centre: cell spacing is {spec.spacing_m:g} map metres, not ground metres")
    header["warnings"] = warns
    header["layer_support"] = support_table(layers, cal)
    result = RegionalLayers(spec, layers, header, out_dir)
    if out_dir is not None:
        from lunarnav.regional.io import write_all

        write_all(result, out_dir)
    return result


def _fill_tile(out, spec, f, i, rr, cc, hg, slope, bounds, do_earth):
    h = spec.step_s / 3600.0
    sel = (rr, cc)
    out["ground_height_m"][sel] = hg
    out["slope_deg"][sel] = slope
    cols = {
        "average_illumination": f[:, :, 2],
        "sun_mean_flux": f[:, :, 1],
        "sunlit_fraction": f[:, :, 3],
        "longest_sunlit_h": i[:, :, 0] * h,
        "longest_shadow_h": i[:, :, 1] * h,
    }
    if do_earth:
        cols["earth_fraction"] = f[:, :, 4]
        cols["longest_earth_outage_h"] = i[:, :, 2] * h
    for name, v in cols.items():
        v = np.where(np.isfinite(hg)[:, None] & (i[:, :, 3] >= 0), v, np.nan)
        out[name][sel] = v[:, 0]
        if bounds:
            opt, pes = v[:, 1], v[:, 2]
            lo, hi = (opt, pes) if LAYER_SUPPORT[name]["bracket_low_horizon"] == HORIZON_SHIFT_LOWERED else (pes, opt)
            out[name + "_lo"][sel] = np.minimum(lo, v[:, 0])
            out[name + "_hi"][sel] = np.maximum(hi, v[:, 0])
    flags = np.where(i[:, 0, 3] >= 0, i[:, 0, 3], 0).astype(np.uint8)
    for b in range(1, i.shape[1]):
        flags |= (np.where(i[:, b, 3] >= 0, i[:, b, 3], 0).astype(np.uint8) << FLAG_BRACKET_SHIFT).astype(np.uint8)
    out[FLAG_LAYER][sel] = flags


def _header(spec, method, stack, geom, cal, eps, bounds, chash, mask_hash, n_cells, wall, t_hz, t_st, resumed, n_tiles, do_earth):
    return {
        "version": VERSION,
        "horizon_engine_reference": HORIZON_VERSION,
        "config_hash": chash,
        "spec": asdict(spec),
        "method": {k: v for k, v in asdict(method).items() if k != "extra"},
        "grid": {
            "crs_proj4": PROJ4[spec.pole],
            "geotransform": list(spec.geotransform()), "registration": "pixel centre of cell (row, col) at x0 + col*dx, y0 - row*dy",
            "row0": "north", "lon_range": "[0, 360) east, planetocentric ME",
        },
        "terrain": {"stack_hash": stack.stack_hash, "dem_ids": list(stack.dem_ids),
                    "meta_hashes": {s.dem_id: s.meta_hash for s in stack.stores}},
        "time": {"start_utc": spec.start_utc, "stop_utc": spec.stop_utc, "step_s": spec.step_s, "n_epochs": spec.n_epochs},
        "ephemeris": geom.provenance,
        "conventions": {"sun_rule": spec.sun_rule, "earth_rule": spec.earth_rule, "earth_margin_deg": spec.earth_margin_deg,
                        "limb_darkening_alpha": spec.limb_alpha, "earth_radius_km": geom.r_earth_km, "sun_radius_km": geom.r_sun_km,
                        "observer": "terrain height + mast_height_m", "longest_runs": "run length x step; censoring_flags bits 0-2 nominal, 3 near a store change, 4-6 any bracket variant"},
        "bracket_calibration": ({"calibration": cal, "shift_lo_deg": eps[0], "shift_hi_deg": eps[1],
                         "meaning": "<name>_lo/_hi re-evaluate the statistic against the regional horizon shifted by "
                                    "-eps_lo / +eps_hi (the 0.99 / 0.01 quantile of this run's measured regional-minus-exact residual, "
                                    "cells near a store change excluded); an estimated bracket, not a guaranteed bound"}
                        if bounds else None),
        "cell_mask_hash": mask_hash,
        "timing": {"wall_s": wall, "cells": n_cells, "ms_per_cell": 1e3 * wall / max(n_cells, 1), "horizon_s": t_hz, "stats_s": t_st,
                   "tiles": n_tiles, "tiles_resumed": resumed, "n_az": method.n_az, "n_epochs": spec.n_epochs,
                   "spacing_m": spec.spacing_m, "threads": numba.get_num_threads()},
        "do_earth": do_earth,
    }
