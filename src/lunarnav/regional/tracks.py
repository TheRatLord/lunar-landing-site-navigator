"""Sun and Earth geometry shared by all cells of a region.

One ``BodyFixedEphemeris`` (the only SPICE use) gives the light-time-corrected Moon-centre to target vectors
in ME.  For every cell the kernel forms the exact site-to-target direction from them; stellar aberration is
a shift of the unit direction that varies by less than 1e-9 rad over a region (the Moon-fixed site velocity
differs by metres per second), so it is evaluated once at the region centre.  The light-time offset of a
displaced observer (target velocity times ``u.s / c``, 2.6e-5 deg for Earth, ``docs/validation/ephemeris.md``) is
neglected.  Agreement with ``lunarnav.ephem.sun_track`` / ``earth_track`` is the intended behaviour.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from lunarnav.constants import R_MOON_M, R_SUN_KM
from lunarnav.ephem import BodyFixedEphemeris, utc_to_et
from lunarnav.ephem.geometry import C_KM_S, aberrate, local_basis
from lunarnav.ephem.tracks import EARTH_MEAN_RADIUS_KM
from lunarnav.regional.grid import RegionSpec


@dataclass(frozen=True, slots=True)
class RegionGeometry:
    """Epoch grid and target vectors for a region (arrays in ME, km)."""

    et: np.ndarray
    sun_pos: np.ndarray
    sun_d: np.ndarray
    earth_pos: np.ndarray
    earth_d: np.ndarray
    r_sun_km: float
    r_earth_km: float
    provenance: dict


def epochs(spec: RegionSpec) -> np.ndarray:
    """TDB seconds of the epoch grid ``start + k step`` (``k = 0 .. n_epochs - 1``)."""
    et0 = float(utc_to_et(spec.start_utc))
    return et0 + np.arange(spec.n_epochs) * spec.step_s


def build_geometry(spec: RegionSpec, *, earth_radius_km: float = EARTH_MEAN_RADIUS_KM) -> RegionGeometry:
    """Targets over the epoch grid of ``spec`` (builds the shared ephemeris table)."""
    et = epochs(spec)
    tab = BodyFixedEphemeris.build(et)
    lat, lon = spec.lonlat((spec.n_rows - 1) / 2.0, (spec.n_cols - 1) / 2.0)
    east, north, up = local_basis(float(lat), float(lon))
    s0 = (R_MOON_M / 1000.0) * up
    beta = (tab.moon_vel_ssb_me + np.cross(tab.omega_me, s0)) / C_KM_S

    def shift(pos: np.ndarray) -> np.ndarray:
        d = pos - s0
        u = d / np.linalg.norm(d, axis=1, keepdims=True)
        return aberrate(u, beta) - u

    return RegionGeometry(
        et, np.ascontiguousarray(tab.sun_me), np.ascontiguousarray(shift(tab.sun_me)),
        np.ascontiguousarray(tab.earth_me), np.ascontiguousarray(shift(tab.earth_me)),
        R_SUN_KM, earth_radius_km, {"ephemeris": tab.provenance, "n_epochs": int(et.size)},
    )
