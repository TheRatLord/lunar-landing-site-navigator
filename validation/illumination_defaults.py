"""Accuracy of the regional layers and coverage of their ``_lo`` / ``_hi`` brackets at the shipped defaults on the default stack.

Configuration = what ``python -m lunarnav.regional`` does by default: all terrain stores, mast 0 m, ``any_part`` Sun and Earth, 360
azimuths, hourly 2024-01-01 to 2026-01-01, brackets calibrated on 32 random cells (seed 0) that are not within
``SEAM_RADIUS_CELLS`` of a change of terrain product.  Five areas (20 km at 20 m at Connecting Ridge, Shackleton, 87 S, 83 S; 100 km at
240 m).  Per area, 192 independent random cells (seed 1) away from store changes are compared with the exact engine
(``horizon_arrays`` and the same statistics kernel): the error of every layer, and whether the exact value lies inside ``[<name>_lo,
<name>_hi]``.  Also reported separately: 48 random cells *near* a store change per area, and four cells named by the independent
review (Connecting Ridge row 203 col 966 and three others).

Writes ``data/validation/illumination/defaults_validation.json`` and ``src/lunarnav/regional/validation_reference.json`` (read by
``lunarnav.regional.support``).
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import illumination_common as C  # noqa: E402
from illumination_regional import AREAS, START, STOP  # noqa: E402
from illumination_series import stats_for_sites  # noqa: E402

from lunarnav.regional import Method, RegionSpec, calibrate_horizon_error, horizon_residuals  # noqa: E402
from lunarnav.regional import horizons as H  # noqa: E402
from lunarnav.regional.layers import _pack, near_store_change, run_configuration  # noqa: E402
from lunarnav.regional.tracks import build_geometry  # noqa: E402
from lunarnav.terrain import TerrainStack  # noqa: E402

N_CAL, N_EVAL, N_SEAM = 32, 192, 48
NAMED = [(203, 966), (281, 303), (473, 33), (54, 361)]
LAYERS = [
    ("average_illumination", "f", 2, 100.0, False), ("sun_mean_flux", "f", 1, 100.0, False), ("sunlit_fraction", "f", 3, 100.0, False),
    ("earth_fraction", "f", 4, 100.0, False), ("longest_sunlit_h", "i", 0, 1.0, False), ("longest_shadow_h", "i", 1, 1.0, True),
    ("longest_earth_outage_h", "i", 2, 1.0, True),
]
REFERENCE_OUT = Path(__file__).resolve().parents[1] / "src" / "lunarnav" / "regional" / "validation_reference.json"


def evaluate(spec, m, stack, g, rows, cols, eps):
    """Per layer: exact value, regional value, bracket and error (regional - exact) for the cells."""
    res = horizon_residuals(spec, m, stack, rows, cols)
    lat, lon = spec.lonlat(rows, cols)
    hg = res["ground_height_m"]
    kw = dict(sun_rule=spec.sun_rule, earth_rule=spec.earth_rule)
    f_reg, i_reg = stats_for_sites(lat, lon, hg, spec.mast_height_m, res["regional_deg"], g, offsets=(0.0, -eps[0], eps[1]), **kw)
    f_ex, i_ex = stats_for_sites(lat, lon, hg, spec.mast_height_m, res["exact_deg"], g, offsets=(0.0,), **kw)
    out = {"horizon_residual_deg": res["residual_deg"]}
    for name, kind, idx, scale, grows in LAYERS:
        reg = (f_reg if kind == "f" else i_reg)[:, :, idx].astype(float)
        ex = (f_ex if kind == "f" else i_ex)[:, 0, idx].astype(float)
        opt, pes = reg[:, 1], reg[:, 2]
        lo, hi = (opt, pes) if grows else (pes, opt)
        lo, hi = np.minimum(lo, reg[:, 0]), np.maximum(hi, reg[:, 0])
        out[name] = {"exact": ex * scale, "regional": reg[:, 0] * scale, "lo": lo * scale, "hi": hi * scale}
    return out


def summarise(ev_list):
    """Pool several ``evaluate`` results: error statistics, bracket coverage and widths per layer."""
    out = {}
    for name, *_ in LAYERS:
        ex = np.concatenate([e[name]["exact"] for e in ev_list])
        rg = np.concatenate([e[name]["regional"] for e in ev_list])
        lo = np.concatenate([e[name]["lo"] for e in ev_list])
        hi = np.concatenate([e[name]["hi"] for e in ev_list])
        tol = 1e-6 if name.endswith("_h") else 1e-4
        miss = ~((ex >= lo - tol) & (ex <= hi + tol))
        d = rg - ex
        a = np.abs(d)
        out[name] = {
            "unit": "hours" if name.endswith("_h") else "percentage points", "cells": int(ex.size), "misses": int(miss.sum()),
            "coverage": float(1.0 - miss.mean()),
            "measured_error": {"mean_signed": float(d.mean()), "mean_abs": float(a.mean()), "p95_abs": float(np.percentile(a, 95)),
                               "p99_abs": float(np.percentile(a, 99)), "max_abs": float(a.max())},
            "bracket_width": {"mean": float((hi - lo).mean()), "p50": float(np.percentile(hi - lo, 50)), "p95": float(np.percentile(hi - lo, 95)),
                              "max": float((hi - lo).max())},
        }
    r = np.concatenate([e["horizon_residual_deg"].ravel() for e in ev_list])
    out["horizon_residual_deg"] = {"mean": float(r.mean()), "p0.5": float(np.percentile(r, 0.5)), "p99.5": float(np.percentile(r, 99.5)),
                                   "min": float(r.min()), "max": float(r.max()), "share_below_-0.1": float((r < -0.1).mean())}
    return out


def main():
    out = {"configuration": None, "n_cal": N_CAL, "n_eval": N_EVAL, "n_seam": N_SEAM, "areas": {}}
    evs, seam_evs, ref_cfg = [], [], None
    for name, lat, lon, size, spacing, _ids in AREAS:
        t0 = time.time()
        stack = TerrainStack.open()
        spec = RegionSpec.centred(lat, lon, size * 1000.0, spacing, START, STOP)
        m = Method()
        g = build_geometry(spec)
        pk = _pack(spec, stack, m)
        cal = calibrate_horizon_error(spec, m, stack, n_cells=N_CAL, seed=0, geometry=g)
        eps = (cal["eps_lo_deg"], cal["eps_hi_deg"])
        cfg = run_configuration(spec, m, stack, n_cells=N_CAL, seed=0)
        ref_cfg = ref_cfg or cfg
        rng = np.random.default_rng(1)
        rr, cc = rng.integers(0, spec.n_rows, 8 * N_EVAL), rng.integers(0, spec.n_cols, 8 * N_EVAL)
        hg = H.ground_heights(spec, stack, pk, rr, cc)
        has = np.isfinite(hg)
        seam = near_store_change(spec, stack, pk, rr, cc) & has
        ok = np.flatnonzero(has & ~seam)[:N_EVAL]
        rows, cols = rr[ok], cc[ok]
        ev = evaluate(spec, m, stack, g, rows, cols, eps)
        evs.append(ev)
        rng2 = np.random.default_rng(2)
        sr, sc = rng2.integers(0, spec.n_rows, 100_000), rng2.integers(0, spec.n_cols, 100_000)
        shg = H.ground_heights(spec, stack, pk, sr, sc)
        sflag = near_store_change(spec, stack, pk, sr, sc) & np.isfinite(shg)
        pick = np.flatnonzero(sflag)[:N_SEAM]
        seam_share = float(sflag.sum() / max(np.isfinite(shg).sum(), 1))
        sev = evaluate(spec, m, stack, g, sr[pick], sc[pick], eps) if pick.size else None
        if sev:
            seam_evs.append(sev)
        named = {}
        for r0, c0 in NAMED:
            if r0 < spec.n_rows and c0 < spec.n_cols and np.isfinite(H.ground_heights(spec, stack, pk, np.array([r0]), np.array([c0]))[0]):
                e1 = evaluate(spec, m, stack, g, np.array([r0]), np.array([c0]), eps)
                named[f"{r0},{c0}"] = {k: {kk: float(vv[0]) for kk, vv in v.items()} for k, v in e1.items() if k != "horizon_residual_deg"}
        sm = summarise([ev])
        out["areas"][name] = {
            "spec": {"lat": lat, "lon": lon, "size_km": size, "spacing_m": spacing}, "stack_hash": stack.stack_hash, "calibration": cal,
            "calibration_cells_checked_for_store_change": cal["selection"], "layers": sm, "cells_near_store_change_share": seam_share,
            "near_store_change_cells": int(pick.size), "near_store_change": summarise([sev]) if sev else None, "named_cells": named,
            "wall_s": time.time() - t0,
        }
        print(f"{name}: eps {eps[0]:.3f}/{eps[1]:.3f} seam share {seam_share:.4f} misses "
              + " ".join(f"{k[:9]}={v['misses']}" for k, v in sm.items() if k != "horizon_residual_deg") + f"  ({time.time() - t0:.0f} s)", file=sys.stderr, flush=True)
    total = summarise(evs)
    out["total"] = total
    out["total_near_store_change"] = summarise(seam_evs) if seam_evs else None
    out["configuration"] = ref_cfg
    C.save_json("defaults_validation.json", out)
    ref = {
        "configuration": {**ref_cfg, "dem_ids": ref_cfg["dem_ids"]},
        "measured_by": f"validation/illumination_defaults.py ({len(AREAS)} areas x {N_EVAL} independent cells, seed 1, cells away from store changes)",
        "layers": {n: {"bracket_coverage": {"coverage": round(v["coverage"], 4), "misses": v["misses"], "cells": v["cells"], "calibration_target": 0.99},
                       "measured_error": {"unit": v["unit"], **{k: round(x, 4) for k, x in v["measured_error"].items()}}}
                   for n, v in total.items() if n != "horizon_residual_deg"},
    }
    REFERENCE_OUT.write_text(json.dumps(ref, indent=1) + "\n")
    for n, v in total.items():
        print(n, v if n == "horizon_residual_deg" else (v["misses"], v["cells"], v["measured_error"], v["bracket_width"]), file=sys.stderr)


if __name__ == "__main__":
    main()
