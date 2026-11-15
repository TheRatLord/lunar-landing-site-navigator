from __future__ import annotations

import re
import sys
from pathlib import Path

import numpy as np

from lunarnav.oracle import illum
from lunarnav.oracle.model import Outcome, check
from lunarnav.terrain.projection import polar_inverse

LOLA = "lola_illumination_2016"
PERIOD = ("2020-01-01T00:00:00Z", "2038-08-07T00:00:00Z", 3600.0)
RASTERS = {
    "85s_060m": {"file": f"{LOLA}/AVGVISIB_85S_060M_201608", "store": "lola_75s_60m", "rho_km": 150.0, "seed": 8506},
    "75s_120m": {"file": f"{LOLA}/AVGVISIB_75S_120M_201608", "store": "lola_75s_120m", "rho_km": 300.0, "seed": 7512},
    "65s_240m": {"file": f"{LOLA}/AVGVISIB_65S_240M_201608", "store": "lola_60s_240m", "rho_km": 600.0, "seed": 6524},
    "65n_240m": {"file": "oracle/lola_illumination_2016_north/AVGVISIB_65N_240M_201608", "store": "lola_60n_240m", "rho_km": 600.0, "seed": 6525},
}


class PolarRaster:
    def __init__(self, img: Path, lbl: Path) -> None:
        text = lbl.read_text(encoding="latin-1")

        def num(key: str) -> float:
            return float(re.search(rf"^\s*{key}\s*=\s*([-+0-9.eE]+)", text, re.M).group(1))

        self.n_lines, self.n_samples = int(num("LINES")), int(num("LINE_SAMPLES"))
        self.px = num("MAP_SCALE")
        self.scale = num("SCALING_FACTOR")
        self.pole = 1 if num("CENTER_LATITUDE") > 0 else -1
        if num("SAMPLE_BITS") != 16 or "LSB_INTEGER" not in text:
            raise RuntimeError(f"{lbl.name}: expected 16-bit little-endian samples")
        self.dn = np.memmap(img, dtype="<i2", mode="r", shape=(self.n_lines, self.n_samples))
        self.origin = self.n_samples / 2.0 - 0.5

    def xy(self, line, sample):
        return (np.asarray(sample) - self.origin) * self.px, (self.origin - np.asarray(line)) * self.px

    def lat_lon(self, line, sample):
        x, y = self.xy(line, sample)
        return polar_inverse(x, y, self.pole)

    def value(self, line, sample) -> np.ndarray:
        return np.asarray(self.dn[line, sample], dtype=np.float64) * self.scale


def _open(ctx, stem: str, earth: bool = False) -> PolarRaster:
    name = stem + ("_EARTH" if earth else "")
    img, lbl = ctx.need(name + ".IMG", name + ".LBL")
    return PolarRaster(img, lbl)


def _sample(ctx, raster: PolarRaster, rho_km: float, seed: int, n: int) -> tuple[np.ndarray, np.ndarray]:
    rng = ctx.rng(seed)
    lines, samples = np.empty(0, int), np.empty(0, int)
    while lines.size < n:
        li = rng.integers(0, raster.n_lines, 4 * n)
        sa = rng.integers(0, raster.n_samples, 4 * n)
        x, y = raster.xy(li, sa)
        keep = np.hypot(x, y) < rho_km * 1000.0
        lines, samples = np.concatenate([lines, li[keep]]), np.concatenate([samples, sa[keep]])
    return lines[:n], samples[:n]


def _progress(label: str):
    def show(done: int, total: int) -> None:
        print(f"  {label}: {done}/{total}", file=sys.stderr, flush=True)

    return show


def _compare(ctx, key: str, n: int):
    spec = RASTERS[key]
    sun, earth = _open(ctx, spec["file"]), _open(ctx, spec["file"], earth=True)
    lines, samples = _sample(ctx, sun, spec["rho_km"], spec["seed"], n)
    lat, lon = sun.lat_lon(lines, samples)
    stack = ctx.stack([spec["store"]])
    tab = _table(ctx)
    s = illum.series(stack, lat, lon, 0.0, tab, progress=_progress(key))
    ok = np.isfinite(s.sunlit_fraction)
    return {
        "pub_sun": sun.value(lines, samples)[ok] * 100.0, "pub_earth": earth.value(lines, samples)[ok] * 100.0,
        "sun": s.sunlit_fraction[ok] * 100.0, "earth": s.earth_fraction[ok] * 100.0, "lat": lat[ok], "store": spec["store"],
    }  # fmt: skip


_TABLES: dict[tuple, object] = {}


def _table(ctx, period: tuple = PERIOD):
    ctx.furnish()
    if period not in _TABLES:
        _TABLES[period] = illum.table(*period)
    return _TABLES[period]


def _outcomes(key: str, r: dict) -> dict[str, Outcome]:
    out = {}
    cols = ("Statistic", "Value (points)")
    for body in ("sun", "earth"):
        d = r[body] - r[f"pub_{body}"]
        st = illum.summary(d)
        corr = float(np.corrcoef(r[body], r[f"pub_{body}"])[0, 1])
        rows = [("bias (engine − published)", st["bias"]), ("mean |difference|", st["mean_abs"]), ("median |difference|", st["median_abs"]),
                ("95th percentile", st["p95_abs"]), ("99th percentile", st["p99_abs"]), ("largest", st["max_abs"]), ("Pearson correlation", corr)]  # fmt: skip
        what = "the Sun's" if body == "sun" else "the Earth's"
        out[f"avgvisib.{body}.{key}"] = Outcome(
            st["p95_abs"], f"Share of hourly steps over 18.6 years from 2020 with any part of {what} disc above the horizon, observer "
            f"on the surface, at {st['n']} pixels drawn uniformly from the raster (latitude {np.abs(r['lat']).min():.1f}° to "
            f"{np.abs(r['lat']).max():.1f}°). Engine terrain: `{r['store']}` alone, the store on the raster's own grid; 720 azimuths, "
            "full range, horizons computed afresh.", cols, rows, st["n"])  # fmt: skip
    return out


def _psr(r: dict) -> tuple[int, int, int, int]:
    pub, eng = r["pub_sun"] <= 0.0, r["sun"] <= 0.0
    return int((pub & eng).sum()), int((~pub & eng).sum()), int((pub & ~eng).sum()), int((~pub & ~eng).sum())


def _psr_outcome(parts: list[tuple[str, dict]], note: str) -> Outcome:
    rows, tot = [], np.zeros(4, int)
    for name, r in parts:
        c = _psr(r)
        tot += c
        rows.append((name, *c, round(100.0 * (c[1] + c[2]) / sum(c), 2)))
    tp, fp, fn, tn = (int(v) for v in tot)
    prec = tp / (tp + fp) if tp + fp else float("nan")
    rec = tp / (tp + fn) if tp + fn else float("nan")
    return Outcome(
        100.0 * (fp + fn) / int(tot.sum()), f"{note} Pooled: {tp} pixels in permanent shadow in both, {fp} only in the engine, {fn} only "
        f"in the published map, {tn} in neither; precision {prec:.3f}, recall {rec:.3f}.",
        ("Raster", "Both", "Engine only", "Published only", "Neither", "Disagree (%)"), rows, int(tot.sum()))  # fmt: skip


_SOUTH: dict[str, dict] = {}


def _south(ctx, key: str) -> dict:
    if key not in _SOUTH:
        _SOUTH[key] = _compare(ctx, key, 120 if ctx.quick else 1000)
    return _SOUTH[key]


@check("avgvisib.sun.85s_060m", "avgvisib.earth.85s_060m")
def raster_85s(ctx) -> dict[str, Outcome]:
    return _outcomes("85s_060m", _south(ctx, "85s_060m"))


@check("avgvisib.sun.75s_120m", "avgvisib.earth.75s_120m")
def raster_75s(ctx) -> dict[str, Outcome]:
    return _outcomes("75s_120m", _south(ctx, "75s_120m"))


@check("avgvisib.sun.65s_240m", "avgvisib.earth.65s_240m")
def raster_65s(ctx) -> dict[str, Outcome]:
    return _outcomes("65s_240m", _south(ctx, "65s_240m"))


@check("psr.lola2016.south")
def psr_south(ctx) -> dict[str, Outcome]:
    parts = [(k, _south(ctx, k)) for k in ("85s_060m", "75s_120m", "65s_240m")]
    return {"psr.lola2016.south": _psr_outcome(parts, "A pixel is in permanent shadow when no hourly step in 18.6 years has any part of "
            "the Sun's disc above the horizon; in the published rasters it is a value of 0. Same pixels as the average-visibility cases.")}  # fmt: skip


@check("avgvisib.sun.65n_240m", "avgvisib.earth.65n_240m", "psr.lola2016.north")
def raster_65n(ctx) -> dict[str, Outcome]:
    r = _compare(ctx, "65n_240m", 120 if ctx.quick else 1000)
    out = _outcomes("65n_240m", r)
    out["psr.lola2016.north"] = _psr_outcome([("65n_240m", r)], "Same definition as the south case, on the north raster's sample.")
    return out


@check("avgvisib.crest_pixels", "literature.no_eternal_light")
def crest(ctx) -> dict[str, Outcome]:
    spec = RASTERS["85s_060m"]
    raster = _open(ctx, spec["file"])
    flat = np.asarray(raster.dn).ravel()
    top = np.argpartition(flat, -50)[-50:]
    lines, samples = np.unravel_index(top, raster.dn.shape)
    lat, lon = raster.lat_lon(lines, samples)
    s = illum.series(ctx.stack([spec["store"]]), lat, lon, 0.0, _table(ctx), earth=False)
    pub = raster.value(lines, samples) * 100.0
    eng = s.sunlit_fraction * 100.0
    d = eng - pub
    k = int(np.argmax(pub))
    x, y = raster.xy(lines[k], samples[k])
    return {
        "avgvisib.crest_pixels": Outcome(
            float(np.abs(d).mean()), f"The 50 brightest pixels of the published 60 m raster (published {pub.min():.1f} to {pub.max():.1f} %). "
            f"Engine minus published: bias {d.mean():+.2f}, median |difference| {np.median(np.abs(d)):.2f}, largest {np.abs(d).max():.1f} points. "
            f"At the published maximum ({pub[k]:.2f} % at x = {x:.0f} m, y = {y:.0f} m) the engine gives {eng[k]:.2f} %.", n=50),
        "literature.no_eternal_light": Outcome(
            float(eng.max()), "Highest engine value among the same 50 crest pixels, surface level, 18.6 years. No published study finds a "
            "place near the south pole that is lit all the time.", n=50),
    }  # fmt: skip


@check("psr.barker2023")
def psr_barker(ctx) -> dict[str, Outcome]:
    import rasterio
    from rasterio.windows import Window

    (path,) = ctx.need("pgda_barker2023_psr/LPSR_80S_20MPP_ADJ.TIF")
    n = 100 if ctx.quick else 600
    rng = ctx.rng(2023)
    with rasterio.open(path) as src:
        tr = src.transform
        rows, cols, vals = [], [], []
        while len(rows) < n:
            r, c = int(rng.integers(0, src.height)), int(rng.integers(0, src.width))
            x, y = tr * (c + 0.5, r + 0.5)
            if np.hypot(x, y) >= 300_000.0:
                continue
            rows.append(r)
            cols.append(c)
            vals.append(int(src.read(1, window=Window(c, r, 1, 1))[0, 0]))
        xs, ys = zip(*(tr * (c + 0.5, r + 0.5) for r, c in zip(rows, cols, strict=True)), strict=True)
    lat, lon = polar_inverse(np.array(xs), np.array(ys), -1)
    stores = ["lola_80s_20m", "lola_75s_120m", "lola_60s_240m"]
    s = illum.series(ctx.stack(stores), lat, lon, 0.0, _table(ctx), earth=False, progress=_progress("barker2023"))
    ok = np.isfinite(s.sunlit_fraction)
    r = {"pub_sun": np.where(np.array(vals)[ok] == 1, 0.0, 1.0), "sun": s.sunlit_fraction[ok]}
    return {"psr.barker2023": _psr_outcome(
        [("LPSR_80S_20MPP_ADJ", r)], f"{int(ok.sum())} pixels of the 20 m map drawn uniformly within 300 km of the pole. Engine terrain: "
        f"{', '.join(f'`{i}`' for i in stores)}; surface observer, hourly for 18.6 years from 2020.")}  # fmt: skip


@check("wac.observed_illumination")
def wac(ctx) -> dict[str, Outcome]:
    from scipy.stats import spearmanr

    (path,) = ctx.need("lroc_wac_polar_illumination/WAC_POLE_ILL_PCT_SOUTH_100M.IMG")
    n_px, header = 1214, 9712
    if path.stat().st_size != header + 4 * n_px * n_px:
        raise RuntimeError("unexpected size of the WAC illumination image")
    img = np.memmap(path, dtype="<f4", mode="r", offset=header, shape=(n_px, n_px))
    origin = n_px / 2.0 - 0.5
    valid = np.argwhere(np.isfinite(img) & (img >= 0.0) & (img <= 100.0))
    k = int(np.argmax(img[valid[:, 0], valid[:, 1]]))
    peak_xy = ((valid[k, 1] - origin) * 100.0, (origin - valid[k, 0]) * 100.0)
    pick = valid[ctx.rng(2010).choice(len(valid), 100 if ctx.quick else 600, replace=False)]
    x, y = (pick[:, 1] - origin) * 100.0, (origin - pick[:, 0]) * 100.0
    lat, lon = polar_inverse(x, y, -1)
    tab = _table(ctx, ("2010-02-15T00:00:00Z", "2011-02-05T00:00:00Z", 3600.0))
    s = illum.series(ctx.stack(["lola_75s_60m"]), lat, lon, 0.0, tab, earth=False, progress=_progress("wac"))
    pub = np.asarray(img[pick[:, 0], pick[:, 1]], dtype=float)
    eng = s.sunlit_fraction * 100.0
    ok = np.isfinite(eng)
    rho = float(spearmanr(eng[ok], pub[ok]).statistic)
    d = eng[ok] - pub[ok]
    return {"wac.observed_illumination": Outcome(
        rho, f"Share of 3,807 LROC wide-angle images from 15 February 2010 to 5 February 2011 in which each 100 m pixel was lit, against "
        f"the engine's share of hourly steps in the same period with any part of the Sun up, at {int(ok.sum())} pixels drawn uniformly. "
        f"The value is the rank correlation. Engine minus observed: bias {d.mean():+.1f}, mean |difference| {np.abs(d).mean():.1f} points; "
        f"the observed map counts a pixel lit by its brightness in an image, so it reads lower by construction. The image's brightest "
        f"pixel is at x = {peak_xy[0]:.0f} m, y = {peak_xy[1]:.0f} m.", n=int(ok.sum()))}  # fmt: skip
