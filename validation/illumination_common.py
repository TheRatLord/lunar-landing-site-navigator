"""Shared helpers for the illumination validation scripts (published rasters, stores, results directory)."""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
REF = ROOT / "data" / "validation" / "reference"
LOLA16 = REF / "lola_illumination_2016"
RESULTS = ROOT / "data" / "validation" / "illumination"
IMG_DIR = ROOT / "docs" / "validation" / "img"

START_2020 = "2020-01-01T00:00:00Z"
CYCLE_DAYS = 6793


def cycle_period(start_year: int = 2020, days: int = CYCLE_DAYS) -> tuple[str, str]:
    """``(start_utc, stop_utc)`` of an 18.6-year analysis window starting on 1 January of ``start_year``."""
    from datetime import datetime, timedelta

    t0 = datetime(start_year, 1, 1)
    return t0.strftime("%Y-%m-%dT00:00:00Z"), (t0 + timedelta(days=days)).strftime("%Y-%m-%dT00:00:00Z")


EIGHTEEN_YEARS_STOP = cycle_period(2020)[1]

STORE_60M = ["lola_75s_60m"]


def results_dir() -> Path:
    RESULTS.mkdir(parents=True, exist_ok=True)
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    return RESULTS


def save_json(name: str, obj) -> None:
    (results_dir() / name).write_text(json.dumps(obj, indent=1, default=_jd))


def load_json(name: str):
    return json.loads((RESULTS / name).read_text())


def _jd(o):
    if isinstance(o, (np.floating, np.integer)):
        return o.item()
    if isinstance(o, np.ndarray):
        return o.tolist()
    raise TypeError(type(o))


class Img:
    """A LOLA 2016 PDS polar raster: int16 little-endian, ``value = DN * scale``, north-up.

    Pixel addressing: with 0-based ``line, sample`` and the label ``*_PROJECTION_OFFSET`` ``O = n / 2 - 0.5`` (the image
    centre in 0-based pixel-centre coordinates, the same convention as the LDEM labels and the terrain stores),
    ``x = (sample - O) * px`` and ``y = (O - line) * px`` (cell centres at ``(k + 0.5) * px``).  This corrects the
    one-pixel shift of an earlier reading of these rasters; evidence in docs/validation/illumination.md (PSR agreement
    with Barker 2023 and the engine offset scan).
    """

    def __init__(self, path: Path, n: int, px: float, scale: float = 4e-5):
        self.path, self.n, self.px, self.scale = Path(path), n, px, scale
        self.dn = np.memmap(path, dtype="<i2", mode="r", shape=(n, n))
        self.o = n / 2.0 - 0.5

    def xy(self, line, sample):
        return (np.asarray(sample) - self.o) * self.px, (self.o - np.asarray(line)) * self.px

    def rc(self, x, y):
        """Nearest (line, sample) of map coordinates."""
        s = np.rint(np.asarray(x) / self.px + self.o).astype(int)
        r = np.rint(self.o - np.asarray(y) / self.px).astype(int)
        return r, s

    def value(self, line, sample):
        return np.asarray(self.dn[line, sample], dtype=np.float64) * self.scale


def avgvisib(product: str = "85S_060M", earth: bool = False) -> Img:
    n, px = {"85S_060M": (5058, 60.0), "75S_120M": (7624, 120.0), "65S_240M": (6420, 240.0)}[product]
    return Img(LOLA16 / f"AVGVISIB_{product}_201608{'_EARTH' if earth else ''}.IMG", n, px)


class Timer:
    def __enter__(self):
        self.t = time.time()
        return self

    def __exit__(self, *a):
        self.dt = time.time() - self.t


def stats(d: np.ndarray) -> dict:
    """Summary of differences (model minus published): mean, median, p95/p99 of the absolute value, max, bias, rms."""
    d = np.asarray(d, float)
    a = np.abs(d)
    return {
        "n": int(d.size), "bias": float(d.mean()), "mean_abs": float(a.mean()), "median_abs": float(np.median(a)),
        "p95_abs": float(np.percentile(a, 95)), "p99_abs": float(np.percentile(a, 99)), "max_abs": float(a.max()),
        "rms": float(np.sqrt(np.mean(d**2))),
    }
