from __future__ import annotations

import numpy as np

from lunarnav.ephem import BodyFixedEphemeris, earth_track, sun_track, utc_to_et
from lunarnav.horizon import compute_horizons
from lunarnav.types import HorizonProfile, Site
from lunarnav.visibility.disc import disc_fraction


def profiles(stack, lat, lon, mast_m: float, n_az: int = 720) -> list[HorizonProfile]:
    lat, lon = np.atleast_1d(lat), np.atleast_1d(lon)
    sites = [Site(float(a), float(b), float(mast_m)) for a, b in zip(lat, lon, strict=True)]
    return compute_horizons(sites, stack, n_az=n_az, use_cache=False)


def profile(stack, lat: float, lon: float, mast_m: float, n_az: int = 720) -> HorizonProfile:
    return profiles(stack, [lat], [lon], mast_m, n_az)[0]


def grid(start_utc: str, stop_utc: str, step_s: float) -> np.ndarray:
    t0, t1 = utc_to_et(start_utc), utc_to_et(stop_utc)
    return t0 + np.arange(0.0, t1 - t0 + step_s / 2, step_s)


def sun_signal(prof: HorizonProfile, et, horizon_deg: np.ndarray | None = None) -> dict[str, np.ndarray]:
    tab = et if isinstance(et, BodyFixedEphemeris) else BodyFixedEphemeris.build(np.asarray(et, float))
    track = sun_track(prof.site, prof.ground_height_m, tab)
    hz = prof.elev_deg if horizon_deg is None else horizon_deg
    area, flux = disc_fraction(track.az_deg, track.el_deg, track.ang_radius_deg, hz)
    return {"et": tab.et, "area": area, "flux": flux, "el": track.el_deg, "az": track.az_deg, "radius": track.ang_radius_deg}


def earth_signal(prof: HorizonProfile, et, horizon_deg: np.ndarray | None = None) -> dict[str, np.ndarray]:
    tab = et if isinstance(et, BodyFixedEphemeris) else BodyFixedEphemeris.build(np.asarray(et, float))
    track = earth_track(prof.site, prof.ground_height_m, tab)
    hz = prof.elev_deg if horizon_deg is None else horizon_deg
    area, _ = disc_fraction(track.az_deg, track.el_deg, track.ang_radius_deg, hz, flux=False)
    return {"et": tab.et, "area": area, "el": track.el_deg, "az": track.az_deg, "radius": track.ang_radius_deg}


def crossings(et: np.ndarray, y: np.ndarray, level: float, falling: bool) -> np.ndarray:
    a, b = y[:-1] - level, y[1:] - level
    hit = (a > 0) & (b <= 0) if falling else (a <= 0) & (b > 0)
    i = np.flatnonzero(hit)
    return et[i] + (et[i + 1] - et[i]) * a[i] / (a[i] - b[i])


def refined_crossings(prof: HorizonProfile, et: np.ndarray, falling: bool, level: float = 0.5, fine_s: float = 10.0) -> np.ndarray:
    coarse = crossings(et, sun_signal(prof, et)["flux"], level, falling)
    step = float(np.median(np.diff(et)))
    out = []
    for t in coarse:
        fine = t + np.arange(-step, step + fine_s / 2, fine_s)
        hit = crossings(fine, sun_signal(prof, fine)["flux"], level, falling)
        out.append(hit[np.argmin(np.abs(hit - t))] if hit.size else t)
    return np.array(out)
