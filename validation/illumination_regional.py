"""Regional method vs the exact horizon engine, and throughput of ``compute_layers``.

``accuracy``: for several 20 km areas at 20 m (stores 20 m + 120 m + 240 m) and one 100 km area at 240 m
(stores 120 m + 240 m), the regional horizons of random cells are compared with ``horizon_arrays`` (same azimuth grid,
same range); then every layer is evaluated on both horizons (2 years hourly, observer 2 m).  The bound shifts are
calibrated on one random sample (seed 0) and checked on an independent sample (seed 1): coverage = fraction of
cells whose exact-horizon value lies inside the regional ``[lo, hi]``.

``throughput``: wall time of ``compute_layers`` for a whole region (``--throughput-size-km``, ``--throughput-spacing-m``).
Timings are only meaningful on a quiet machine; the thread count is recorded.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numba
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import illumination_common as C  # noqa: E402
from illumination_series import stats_for_sites  # noqa: E402

from lunarnav.regional import Method, RegionSpec, calibrate_horizon_error, compute_layers, horizon_residuals  # noqa: E402
from lunarnav.regional.tracks import build_geometry  # noqa: E402
from lunarnav.terrain import TerrainStack  # noqa: E402

START, STOP = "2024-01-01T00:00:00Z", "2026-01-01T00:00:00Z"
IDS_20 = ["lola_80s_20m", "lola_75s_120m", "lola_60s_240m"]
IDS_240 = ["lola_75s_120m", "lola_60s_240m"]
AREAS = [
    ("connecting_ridge", -89.44, 222.9, 20.0, 20.0, IDS_20),
    ("shackleton", -89.9, 129.8, 20.0, 20.0, IDS_20),
    ("south_87S", -87.0, 45.0, 20.0, 20.0, IDS_20),
    ("south_83S", -83.0, 300.0, 20.0, 20.0, IDS_20),
    ("regional_100km", -86.0, 120.0, 100.0, 240.0, IDS_240),
]
LAYERS = [("average_illumination", 0, 2, 100.0), ("sunlit_fraction", 0, 3, 100.0), ("earth_fraction", 0, 4, 100.0)]


def pct(a, q):
    return float(np.percentile(a, q))


def accuracy(n_cal=48, n_eval=96, n_az=360, mast=2.0):
    out = {"n_az": n_az, "mast_m": mast, "period": [START, STOP], "calibration_cells": n_cal, "evaluation_cells": n_eval, "areas": {}}
    geoms = {}
    for name, lat, lon, size, spacing, ids in AREAS:
        stack = TerrainStack.open(ids)
        spec = RegionSpec.centred(lat, lon, size * 1000.0, spacing, START, STOP, mast_height_m=mast, sun_rule="half_flux", earth_rule="centre")
        m = Method(n_az=n_az)
        t0 = time.time()
        cal = calibrate_horizon_error(spec, m, stack, n_cells=n_cal, seed=0)
        rng = np.random.default_rng(1)
        rows = rng.integers(0, spec.n_rows, 4 * n_eval)
        cols = rng.integers(0, spec.n_cols, 4 * n_eval)
        res = horizon_residuals(spec, m, stack, rows, cols)
        ok = np.isfinite(res["residual_deg"][:, 0])
        rows, cols = rows[ok][:n_eval], cols[ok][:n_eval]
        res = horizon_residuals(spec, m, stack, rows, cols)
        r = res["residual_deg"]
        h = {"bias": float(r.mean()), "rms": float(np.sqrt(np.mean(r**2))), "max_abs": float(np.abs(r).max()),
             **{f"p{q}": pct(r, q) for q in (0.5, 1, 5, 50, 95, 99, 99.5)}}
        lat_c, lon_c = spec.lonlat(rows, cols)
        key = (spec.start_utc, spec.stop_utc)
        if key not in geoms:
            geoms[key] = build_geometry(spec)
        g = geoms[key]
        eps_lo, eps_hi = cal["eps_lo_deg"], cal["eps_hi_deg"]
        hg = res["exact"]["ground_height_m"]
        f_reg, i_reg = stats_for_sites(lat_c, lon_c, hg, mast, res["regional_deg"], g, offsets=(0.0, -eps_lo, eps_hi), sun_rule="half_flux", earth_rule="centre")
        f_ex, i_ex = stats_for_sites(lat_c, lon_c, hg, mast, res["exact_deg"], g, offsets=(0.0,), sun_rule="half_flux", earth_rule="centre")
        layers = {}
        stats = [("sunlit_fraction", f_reg[:, :, 3], f_ex[:, 0, 3], 100.0, False), ("earth_fraction", f_reg[:, :, 4], f_ex[:, 0, 4], 100.0, False),
                 ("average_illumination", f_reg[:, :, 2], f_ex[:, 0, 2], 100.0, False), ("sun_mean_flux", f_reg[:, :, 1], f_ex[:, 0, 1], 100.0, False),
                 ("longest_sunlit_h", i_reg[:, :, 0].astype(float), i_ex[:, 0, 0].astype(float), 1.0, False),
                 ("longest_shadow_h", i_reg[:, :, 1].astype(float), i_ex[:, 0, 1].astype(float), 1.0, True),
                 ("longest_earth_outage_h", i_reg[:, :, 2].astype(float), i_ex[:, 0, 2].astype(float), 1.0, True)]
        for lname, reg, ex, scale, grows in stats:
            d = (reg[:, 0] - ex) * scale
            opt, pes = reg[:, 1], reg[:, 2]
            lo, hi = (opt, pes) if grows else (pes, opt)
            lo, hi = np.minimum(lo, reg[:, 0]), np.maximum(hi, reg[:, 0])
            cov = float(np.mean((ex >= lo - 1e-9) & (ex <= hi + 1e-9)))
            layers[lname] = {"unit": "percentage points" if scale == 100.0 else "hours", "bias": float(d.mean()), "mean_abs": float(np.abs(d).mean()),
                             "p50_abs": pct(np.abs(d), 50), "p95_abs": pct(np.abs(d), 95), "p99_abs": pct(np.abs(d), 99), "max_abs": float(np.abs(d).max()),
                             "coverage_lo_hi": cov, "mean_width": float(((hi - lo) * scale).mean()), "n_exact_value_zero": int((ex == 0).sum())}
        out["areas"][name] = {"lat": lat, "lon": lon, "size_km": size, "spacing_m": spacing, "dem_ids": ids, "stack_hash": stack.stack_hash,
                              "calibration": cal, "horizon_residual_deg": h, "layers": layers, "wall_s": time.time() - t0}
        print(f"{name:18s} horizon bias {h['bias']:+.3f} p1 {h['p1']:+.3f} p99 {h['p99']:+.3f} max|r| {h['max_abs']:.2f}  eps {eps_lo:.3f}/{eps_hi:.3f}  "
              f"cover(avg) {layers['average_illumination']['coverage_lo_hi']:.2f}  mean|d|(avg) {layers['average_illumination']['mean_abs']:.2f} pts", file=sys.stderr, flush=True)
    C.save_json("regional_accuracy.json", out)


def throughput(size_km, spacing_m, lat, lon, ids, step_s, bounds, years, tag):
    stack = TerrainStack.open(ids)
    start = "2024-01-01T00:00:00Z"
    stop = f"{2024 + years}-01-01T00:00:00Z"
    spec = RegionSpec.centred(lat, lon, size_km * 1000.0, spacing_m, start, stop, step_s=step_s, mast_height_m=2.0, sun_rule="half_flux", earth_rule="centre")
    t0 = time.time()
    res = compute_layers(spec, stack, Method(n_az=360), out_dir=C.results_dir() / f"throughput_{tag}", bounds=bounds, calibrate=32 if bounds else 0)
    wall = time.time() - t0
    out = {"tag": tag, "cells": spec.n_cells, "n_epochs": spec.n_epochs, "spacing_m": spacing_m, "size_km": size_km, "dem_ids": ids,
           "bounds": bounds, "threads": numba.get_num_threads(), "wall_s": wall, "timing": res.header["timing"],
           "bracket_calibration": res.header["bracket_calibration"]}
    C.save_json(f"regional_throughput_{tag}.json", out)
    print(tag, out["timing"], file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stage", choices=["accuracy", "throughput"])
    ap.add_argument("--size-km", type=float, default=20.0)
    ap.add_argument("--spacing-m", type=float, default=20.0)
    ap.add_argument("--lat", type=float, default=-89.44)
    ap.add_argument("--lon", type=float, default=222.9)
    ap.add_argument("--step-s", type=float, default=3600.0)
    ap.add_argument("--years", type=int, default=2)
    ap.add_argument("--no-bounds", action="store_true")
    ap.add_argument("--tag", default="20km_20m")
    a = ap.parse_args()
    if a.stage == "accuracy":
        accuracy()
    else:
        ids = IDS_240 if a.spacing_m >= 120 else IDS_20
        throughput(a.size_km, a.spacing_m, a.lat, a.lon, ids, a.step_s, not a.no_bounds, a.years, a.tag)


if __name__ == "__main__":
    main()
