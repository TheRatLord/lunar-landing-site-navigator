from __future__ import annotations

import re
import sys

import numpy as np
import rasterio
from scipy import ndimage
from scipy.stats import rankdata

from lunarnav.ephem import BodyFixedEphemeris, sun_track, utc_to_et
from lunarnav.horizon import horizon_arrays
from lunarnav.oracle.model import Outcome, check
from lunarnav.terrain.projection import polar_inverse
from lunarnav.types import Site
from lunarnav.visibility.disc import disc_fraction

FOLDER = "pgda_barker2023_nac_sim"
FRAMES = {"m1188426614": "M1188426614", "m139729686": "M139729686", "m184288222": "M184288222"}
CHUNK = 128
COARSE = ["lola_80s_20m", "lola_75s_120m", "lola_60s_240m"]


def _mid_time(label) -> tuple[str, float]:
    text = label.read_text(encoding="latin-1")
    start, stop = (re.search(rf"^\s*{k}\s*=\s*(\S+)", text, re.M).group(1) for k in ("START_TIME", "STOP_TIME"))
    return start, 0.5 * (utc_to_et(start + "Z") + utc_to_et(stop + "Z"))


def _auc(dark: np.ndarray, lit: np.ndarray) -> float:
    if not dark.size or not lit.size:
        return float("nan")
    rank = rankdata(np.concatenate([dark, lit]))
    u = rank[: dark.size].sum() - dark.size * (dark.size + 1) / 2.0
    return float(1.0 - u / (dark.size * lit.size))


def _frame(ctx, key: str) -> dict:
    stem = FRAMES[key]
    model_file, le, re_, label = ctx.need(
        f"{FOLDER}/{stem}_20MPP_MODEL.TIF", f"{FOLDER}/{stem}LE_20MPP.TIF", f"{FOLDER}/{stem}RE_20MPP.TIF", f"{FOLDER}/{stem}LE.EDR_LABEL.LBL"
    )  # fmt: skip
    with rasterio.open(model_file) as src:
        model, tf = src.read(1), src.transform
    px = float(tf.a)
    shadow = model == 0
    near_edge = (ndimage.binary_dilation(shadow) & ~shadow) | (shadow & ~ndimage.binary_erosion(shadow))
    rng = ctx.rng(int(stem[1:]) % 100000)
    n = 150 if ctx.quick else 1000
    rows, cols, bright = np.empty(0, int), np.empty(0, int), np.empty(0)
    images = []
    for path in (le, re_):
        with rasterio.open(path) as src:
            images.append((src.read(1), src.transform))
    while rows.size < n:
        r, c = rng.integers(0, model.shape[0], 20 * n), rng.integers(0, model.shape[1], 20 * n)
        x, y = tf.c + (c + 0.5) * px, tf.f - (r + 0.5) * px
        b = np.full(r.size, np.nan)
        for img, itf in images:
            ci, ri = np.floor((x - itf.c) / itf.a).astype(int), np.floor((itf.f - y) / -itf.e).astype(int)
            ok = (ci >= 0) & (ci < img.shape[1]) & (ri >= 0) & (ri < img.shape[0]) & np.isnan(b)
            v = img[ri[ok], ci[ok]].astype(float)
            v[v < -1e30] = np.nan
            b[ok] = v
        keep = np.isfinite(b) & np.isfinite(model[r, c])
        rows, cols, bright = np.concatenate([rows, r[keep]]), np.concatenate([cols, c[keep]]), np.concatenate([bright, b[keep]])
    rows, cols, bright = rows[:n], cols[:n], bright[:n]
    lat, lon = polar_inverse(tf.c + (cols + 0.5) * px, tf.f - (rows + 0.5) * px, -1)
    start, et = _mid_time(label)
    tab = BodyFixedEphemeris.build(np.array([et]), interpolate=False)
    area, sun_az, sun_el = _engine(ctx.default_stack, lat, lon, tab, key)
    sub = slice(0, min(n, 400))
    coarse = np.full(n, np.nan)
    coarse[sub], _, _ = _engine(ctx.stack(COARSE), lat[sub], lon[sub], tab, key + " on 20 m terrain")
    ok = np.isfinite(area)
    return {
        "stem": stem, "start": start, "n": int(ok.sum()), "engine_shadow": area[ok] == 0.0, "coarse": coarse[ok],
        "model_shadow": shadow[rows, cols][ok], "near_edge": near_edge[rows, cols][ok], "bright": bright[ok],
        "sun_az": float(np.nanmedian(sun_az)), "sun_el": float(np.nanmedian(sun_el)),
    }  # fmt: skip


def _engine(stack, lat, lon, tab, label: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    n = lat.size
    area, sun_az, sun_el = np.full(n, np.nan), np.full(n, np.nan), np.full(n, np.nan)
    for c0 in range(0, n, CHUNK):
        sl = slice(c0, min(n, c0 + CHUNK))
        hz = horizon_arrays(lat[sl], lon[sl], 0.0, stack, n_az=720)
        for j, i in enumerate(range(sl.start, sl.stop)):
            grid = hz["elev_deg"][j]
            if not np.isfinite(grid).all():
                continue
            sun = sun_track(Site(float(lat[i]), float(lon[i]), 0.0), float(hz["ground_height_m"][j]), tab)
            a, _ = disc_fraction(sun.az_deg, sun.el_deg, sun.ang_radius_deg, grid, flux=False)
            area[i], sun_az[i], sun_el[i] = float(a[0]), float(sun.az_deg[0]), float(sun.el_deg[0])
        print(f"  {label}: {sl.stop}/{n}", file=sys.stderr, flush=True)
    return area, sun_az, sun_el


def _outcomes(ctx, key: str) -> dict[str, Outcome]:
    ctx.furnish()
    f = _frame(ctx, key)
    e, m, edge, b = f["engine_shadow"], f["model_shadow"], f["near_edge"], f["bright"]
    c = np.isfinite(f["coarse"])
    k = f["coarse"][c] == 0.0
    away = ~edge
    differ_away = float((e[away] != m[away]).mean()) * 100.0
    differ_all = float((e != m).mean()) * 100.0
    auc_engine, auc_model = _auc(b[e], b[~e]), _auc(b[m], b[~m])
    where = (f"LROC NAC frame {f['stem']} ({f['start']} UTC, Sun about {f['sun_el']:.1f}° up at azimuth {f['sun_az']:.0f}°), "
             f"{f['n']} random 20 m pixels inside the photographed strip, engine on the default stack with the observer on the ground. "
             "A pixel is in shadow for the engine when no part of the Sun's disc clears the horizon.")  # fmt: skip
    rows = [
        ("Pixels in shadow, Barker's simulated frame (%)", round(float(m.mean()) * 100.0, 2)),
        ("Pixels in shadow, engine (%)", round(float(e.mean()) * 100.0, 2)),
        ("Pixels within one pixel of Barker's shadow edge (%)", round(float(edge.mean()) * 100.0, 2)),
        ("Engine differs from Barker's frame, away from the edge (%)", round(differ_away, 2)),
        ("Engine differs from Barker's frame, all pixels (%)", round(differ_all, 2)),
        ("Engine says shadow, Barker lit (pixels)", int((e & ~m).sum())),
        ("Engine says lit, Barker shadow (pixels)", int((~e & m).sum())),
        ("Photo: chance an engine-shadow pixel is darker than an engine-lit one", round(auc_engine, 4)),
        ("Photo: the same for Barker's frame", round(auc_model, 4)),
        (f"For information, {int(c.sum())} of the pixels with the engine on 20 m LOLA terrain only: differs from Barker, away from the edge (%)",
         round(float((k[away[c]] != m[c][away[c]]).mean()) * 100.0, 2)),
        ("For information, the same pixels on the default stack: differs from Barker, away from the edge (%)",
         round(float((e[c][away[c]] != m[c][away[c]]).mean()) * 100.0, 2)),
        ("For information, 20 m LOLA terrain only: the photo measure", round(_auc(b[c][k], b[c][~k]), 4)),
        ("For information, the same pixels on the default stack: the photo measure", round(_auc(b[c][e[c]], b[c][~e[c]]), 4)),
    ]
    return {
        f"nac.simulated.{key}": Outcome(differ_away, where + " Barker's frame is in shadow where its value is exactly zero.",
                                        ("Quantity", "Value"), rows, int(away.sum())),
        f"nac.photo.{key}": Outcome(
            auc_model - auc_engine, where + " The photo is not thresholded: the measure is the chance that a pixel the model calls "
            f"shadowed is darker in the photo than one it calls lit. Engine {auc_engine:.4f}, Barker's simulation {auc_model:.4f} on "
            "the same pixels; the value is Barker's minus the engine's. Table under the matching `nac.simulated` case.", n=f["n"]),
    }  # fmt: skip


@check("nac.simulated.m1188426614", "nac.photo.m1188426614")
def frame_m1188426614(ctx) -> dict[str, Outcome]:
    return _outcomes(ctx, "m1188426614")


@check("nac.simulated.m139729686", "nac.photo.m139729686")
def frame_m139729686(ctx) -> dict[str, Outcome]:
    return _outcomes(ctx, "m139729686")


@check("nac.simulated.m184288222", "nac.photo.m184288222")
def frame_m184288222(ctx) -> dict[str, Outcome]:
    return _outcomes(ctx, "m184288222")
