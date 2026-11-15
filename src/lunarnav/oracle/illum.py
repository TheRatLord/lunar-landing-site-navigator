from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from lunarnav.ephem import BodyFixedEphemeris, earth_track, sun_track, utc_to_et
from lunarnav.horizon import horizon_arrays
from lunarnav.types import Site
from lunarnav.visibility.disc import disc_fraction

CHUNK = 128


@dataclass
class SeriesStats:
    ground_height_m: np.ndarray
    average_illumination: np.ndarray
    sunlit_fraction: np.ndarray
    longest_dark_h: np.ndarray
    longest_light_h: np.ndarray
    earth_fraction: np.ndarray
    earth_window_mean_d: np.ndarray
    earth_outage_mean_d: np.ndarray
    earth_outage_longest_d: np.ndarray


def table(start_utc: str, stop_utc: str, step_s: float) -> BodyFixedEphemeris:
    t0, t1 = utc_to_et(start_utc), utc_to_et(stop_utc)
    return BodyFixedEphemeris.build(t0 + np.arange(0.0, t1 - t0 + step_s / 2, step_s))


def _runs(mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    edges = np.flatnonzero(np.diff(np.concatenate(([0], mask.astype(np.int8), [0]))))
    return edges[0::2], edges[1::2]


def _longest(mask: np.ndarray) -> int:
    a, b = _runs(mask)
    return int((b - a).max()) if a.size else 0


def _interior_mean(mask: np.ndarray) -> float:
    a, b = _runs(mask)
    keep = (a > 0) & (b < mask.size)
    return float((b - a)[keep].mean()) if keep.any() else float("nan")


def series(
    stack, lat, lon, mast_m: float, tab: BodyFixedEphemeris, *, n_az: int = 720, earth: bool = True, progress=None, min_range_m: float = 0.0
) -> SeriesStats:
    lat, lon = np.atleast_1d(np.asarray(lat, float)), np.atleast_1d(np.asarray(lon, float))
    n = lat.size
    step_h = float(np.median(np.diff(tab.et))) / 3600.0
    out = SeriesStats(*(np.full(n, np.nan) for _ in range(9)))
    for c0 in range(0, n, CHUNK):
        sl = slice(c0, min(n, c0 + CHUNK))
        hz = horizon_arrays(lat[sl], lon[sl], mast_m, stack, n_az=n_az, min_range_m=min_range_m)
        for j, i in enumerate(range(sl.start, sl.stop)):
            ground = float(hz["ground_height_m"][j])
            grid = hz["elev_deg"][j]
            if not np.isfinite(grid).all():
                continue
            site = Site(float(lat[i]), float(lon[i]), float(mast_m))
            sun = sun_track(site, ground, tab)
            area, _ = disc_fraction(sun.az_deg, sun.el_deg, sun.ang_radius_deg, grid, flux=False)
            lit = area > 0.0
            out.ground_height_m[i] = ground
            out.average_illumination[i] = float(area.mean())
            out.sunlit_fraction[i] = float(lit.mean())
            out.longest_dark_h[i] = _longest(~lit) * step_h
            out.longest_light_h[i] = _longest(lit) * step_h
            if earth:
                et = earth_track(site, ground, tab)
                ea, _ = disc_fraction(et.az_deg, et.el_deg, et.ang_radius_deg, grid, flux=False)
                vis = ea > 0.0
                out.earth_fraction[i] = float(vis.mean())
                out.earth_window_mean_d[i] = _interior_mean(vis) * step_h / 24.0
                out.earth_outage_mean_d[i] = _interior_mean(~vis) * step_h / 24.0
                out.earth_outage_longest_d[i] = _longest(~vis) * step_h / 24.0
        if progress:
            progress(sl.stop, n)
    return out


def summary(d: np.ndarray) -> dict[str, float]:
    a = np.abs(d)
    return {"n": int(d.size), "bias": float(d.mean()), "mean_abs": float(a.mean()), "median_abs": float(np.median(a)),
            "p95_abs": float(np.percentile(a, 95)), "p99_abs": float(np.percentile(a, 99)), "max_abs": float(a.max())}  # fmt: skip
