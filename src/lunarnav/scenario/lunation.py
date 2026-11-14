"""Lunation definition and local solar time.

A lunation runs from one new moon to the next. New moon is the instant at which the geocentric
apparent ecliptic longitude of the Moon equals that of the Sun (Moon minus Sun crossing zero upward),
found from SPICE (`spkpos`, Earth-centred, `ECLIPJ2000`, `LT+S`) on a 12 h scan and refined by
Brent's method to 1 ms. Apparent places use light time and stellar aberration (the Sun's 20.5"
aberration shifts the instant by about 40 s), matching almanac conventions. The ecliptic of J2000 is
used because precession and nutation shift both longitudes equally.

Numbering: Meeus' lunation number k (k = 0 at the new moon of 2000-01-06) and the Brown number
`k + 953` (Brown lunation 1 began 1923-01-17). The index of an epoch is `k` of the new moon that
started the lunation containing it.

Local solar time at a site is `12 h + (site longitude - sub-solar longitude) / 15` (hours, mod 24):
solar noon is when the (aberrated) Sun-centre meridian passes the site; a lunar "hour" is 1/24 of the
synodic day. This is apparent solar time, so it differs from a mean local time by the lunar
equation of time (a few hours at most, mostly from the orbit's eccentricity).
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import numpy as np
import spiceypy as spice
from scipy.optimize import brentq

from lunarnav.ephem import load_kernels, subsolar_point
from lunarnav.ephem.kernels import SPICE_LOCK

MEAN_SYNODIC_MONTH_D = 29.530588861
"""Mean synodic month (days), Meeus, Astronomical Algorithms 2nd ed., ch. 49."""
MEEUS_K0_JDE = 2451550.09766
"""Mean new moon of lunation k = 0 (Meeus ch. 49), a numbering reference only."""
BROWN_OFFSET = 953
SECONDS_PER_DAY = 86400.0
JD_J2000 = 2451545.0
SCAN_STEP_S = 12.0 * 3600.0


def _elongation(et: float) -> float:
    """Moon minus Sun apparent ecliptic longitude (J2000 ecliptic), wrapped to (-pi, pi]."""
    with SPICE_LOCK:
        moon = spice.spkpos("MOON", float(et), "ECLIPJ2000", "LT+S", "EARTH")[0]
        sun = spice.spkpos("SUN", float(et), "ECLIPJ2000", "LT+S", "EARTH")[0]
    d = np.arctan2(moon[1], moon[0]) - np.arctan2(sun[1], sun[0])
    return float((d + np.pi) % (2.0 * np.pi) - np.pi)


def new_moons(et0: float, et1: float) -> np.ndarray:
    """ET of every new moon in [et0, et1] (ascending)."""
    load_kernels()
    grid = np.arange(et0, et1 + SCAN_STEP_S, SCAN_STEP_S)
    f = np.array([_elongation(t) for t in grid])
    out = []
    for i in range(grid.size - 1):
        if f[i] < 0.0 <= f[i + 1] and f[i + 1] - f[i] < 1.0:
            out.append(brentq(_elongation, grid[i], grid[i + 1], xtol=1e-3))
    return np.array([t for t in out if et0 <= t <= et1])


def lunation_number(new_moon_et: float) -> int:
    """Meeus lunation number k of the new moon at `new_moon_et`."""
    jde = new_moon_et / SECONDS_PER_DAY + JD_J2000
    return int(round((jde - MEEUS_K0_JDE) / MEAN_SYNODIC_MONTH_D))


@dataclass(frozen=True, slots=True)
class Lunation:
    """One lunation: new moon to next new moon (ET seconds)."""

    number: int
    start_et: float
    end_et: float

    @property
    def brown_number(self) -> int:
        return self.number + BROWN_OFFSET

    @property
    def length_d(self) -> float:
        return (self.end_et - self.start_et) / SECONDS_PER_DAY


@lru_cache(maxsize=16)
def _lunations_cached(et0: float, et1: float) -> tuple[Lunation, ...]:
    pad = 32.0 * SECONDS_PER_DAY
    nm = new_moons(et0 - pad, et1 + pad)
    return tuple(Lunation(lunation_number(a), float(a), float(b)) for a, b in zip(nm[:-1], nm[1:]))


def lunations(et0: float, et1: float) -> list[Lunation]:
    """Lunations that overlap [et0, et1] (the first may begin before `et0`, the last end after `et1`)."""
    return [lu for lu in _lunations_cached(float(et0), float(et1)) if lu.end_et > et0 and lu.start_et < et1]


def lunation_index(et: np.ndarray, lunas: list[Lunation]) -> tuple[np.ndarray, np.ndarray]:
    """For epochs `et`: position in `lunas` of the containing lunation (-1 if outside) and the elapsed
    time since its new moon (seconds)."""
    starts = np.array([lu.start_et for lu in lunas])
    ends = np.array([lu.end_et for lu in lunas])
    et = np.asarray(et, dtype=np.float64)
    i = np.searchsorted(starts, et, side="right") - 1
    ok = (i >= 0) & (et < ends[np.clip(i, 0, None)])
    return np.where(ok, i, -1), np.where(ok, et - starts[np.clip(i, 0, None)], np.nan)


def local_solar_time_h(site_lon_deg: float, et) -> np.ndarray:
    """Local (apparent) solar time in hours [0, 24): 12 at the sub-solar meridian.

    `et` is an epoch array or a `BodyFixedEphemeris` (then its epochs are used)."""
    if not hasattr(et, "sun_me"):
        et = np.atleast_1d(np.asarray(et, dtype=np.float64))
    _, sub_lon = subsolar_point(et)
    return (12.0 + (site_lon_deg - sub_lon) / 15.0) % 24.0
