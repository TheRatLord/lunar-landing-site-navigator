"""Per-site Sun, Earth and station geometry from a shared `BodyFixedEphemeris` (pure numpy).

Every function accepts either a prebuilt `BodyFixedEphemeris` (share one table across thousands of
sites) or an array of ET epochs (a table is built on the fly). Epoch semantics: `et` is the
instant of *reception at the site*; directions are apparent (light time and stellar aberration),
elevation is measured from the plane perpendicular to the Moon-centre radial through the observer.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np

from lunarnav.constants import R_MOON_M, R_SUN_KM
from lunarnav.ephem.geometry import (
    C_KM_S,
    aberrate,
    angular_separation_deg,
    az_el_deg,
    disc_overlap_fraction,
    local_basis,
)
from lunarnav.ephem.table import WGS84_A_KM, WGS84_INV_F, BodyFixedEphemeris
from lunarnav.types import GroundStation, Site, TargetTrack

EARTH_MEAN_RADIUS_KM = float((WGS84_A_KM**2 * WGS84_A_KM * (1.0 - 1.0 / WGS84_INV_F)) ** (1.0 / 3.0))
"""Volumetric mean radius of the WGS84 ellipsoid (6371.0 km): the default Earth disc radius of `earth_track`."""

DANJON_EARTH_RADIUS_KM = 1.01 * WGS84_A_KM
"""Occulting radius of the Danjon-enlarged shadow (1.01 x equatorial radius, 6441.9 km).

This is the convention of the NASA/GSFC (Espenak) lunar-eclipse contact times
(https://eclipse.gsfc.nasa.gov/LEcat5/shadow.html): the geometric Earth enlarged by about 1% to stand
in for the atmosphere. It reproduced all twelve 2025 contact times within 4.6 s
(`docs/validation/ephemeris.md`, Section 6)."""

ShadowModel = Literal["danjon", "geometric"]
"""`"danjon"`: occulting sphere of `DANJON_EARTH_RADIUS_KM` (default, matches published contacts).
`"geometric"`: bare sphere of `EARTH_MEAN_RADIUS_KM` (optimistic; contacts ~1-2 min late/early)."""


@dataclass(frozen=True, slots=True)
class StationTrack:
    """A ground station as seen from a lunar site, and the site as seen from the station."""

    et: np.ndarray
    az_deg: np.ndarray
    """Azimuth of the station from the site (clockwise from local north)."""
    el_deg: np.ndarray
    """Elevation of the station above the site's local horizontal plane (no terrain)."""
    range_km: np.ndarray
    station_el_deg: np.ndarray
    """Elevation of the lunar site above the station's geodetic horizon (compare with `min_elevation_deg`)."""


def _table(et, stations: tuple[GroundStation, ...] = ()) -> BodyFixedEphemeris:
    if isinstance(et, BodyFixedEphemeris):
        return et
    return BodyFixedEphemeris.build(np.atleast_1d(np.asarray(et, dtype=np.float64)), stations)


def _observer(site: Site, ground_height_m: float) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """East, North, Up unit vectors and the observer position (km, ME) for a site."""
    east, north, up = local_basis(site.lat_deg, site.lon_deg)
    radius_km = (R_MOON_M + ground_height_m + site.mast_height_m) / 1000.0
    return east, north, up, radius_km * up


def _site_velocity_beta(tab: BodyFixedEphemeris, s: np.ndarray) -> np.ndarray:
    """Inertial velocity of the (ME-fixed) site over c, in ME components: (v_moon + omega x s)/c."""
    return (tab.moon_vel_ssb_me + np.cross(tab.omega_me, s)) / C_KM_S


def _site_to_target(center_vec: np.ndarray, target_vel: np.ndarray, s: np.ndarray) -> np.ndarray:
    """Geometric site->target vectors for a light-time-retarded target.

    `center_vec` is the target position at `et - lt_c` relative to the Moon centre. A site at `s`
    receives the signal at `et` from the target at `et - lt_c + (u.s)/c`, i.e. displaced by
    `target_vel * (u.s)/c`; this is the term that makes per-site results match a per-site SPICE
    solution (2.6e-5 deg for Earth if dropped).
    """
    u0 = center_vec / np.linalg.norm(center_vec, axis=1, keepdims=True)
    shift = (u0 @ s) / C_KM_S
    return center_vec - s + target_vel * shift[:, None]


def _target_track(
    tab: BodyFixedEphemeris,
    site: Site,
    ground_height_m: float,
    center_vec: np.ndarray,
    target_vel: np.ndarray,
    radius_km: float,
) -> TargetTrack:
    east, north, up, s = _observer(site, ground_height_m)
    d = _site_to_target(center_vec, target_vel, s)
    rng = np.linalg.norm(d, axis=1)
    u = aberrate(d / rng[:, None], _site_velocity_beta(tab, s))
    az, el = az_el_deg(u, east, north, up)
    ang = np.degrees(np.arcsin(np.minimum(radius_km / rng, 1.0)))
    return TargetTrack(tab.et, az, el, rng, ang)


def sun_track(site: Site, ground_height_m: float, et) -> TargetTrack:
    """Apparent Sun-centre direction from `site` standing `ground_height_m` above the reference sphere.

    The observer is at `ground_height_m + site.mast_height_m`. `et` is a `BodyFixedEphemeris` or
    ET epochs. `ang_radius_deg` uses the IAU photospheric radius (`R_SUN_KM`).
    """
    tab = _table(et)
    return _target_track(tab, site, ground_height_m, tab.sun_me, tab.sun_vel_ssb_me, R_SUN_KM)


def earth_track(
    site: Site, ground_height_m: float, et, *, earth_radius_km: float = EARTH_MEAN_RADIUS_KM
) -> TargetTrack:
    """Apparent Earth-centre direction from `site`; `ang_radius_deg` is that of a sphere of `earth_radius_km`."""
    tab = _table(et)
    return _target_track(tab, site, ground_height_m, tab.earth_me, tab.earth_vel_ssb_me, earth_radius_km)


def station_track(site: Site, ground_height_m: float, et, station: GroundStation) -> StationTrack:
    """Direction of `station` from the site and elevation of the site as seen from the station.

    The ray arrives at the site at `et` and left the station at `et - lt`; the station is taken
    at its own retarded position and orientation. The station-side elevation is the pointing
    direction a transmitting antenna would use (transmission aberration), measured from the
    station's WGS84 geodetic horizon.
    """
    tab = _table(et, (station,))
    if station.name not in tab.stations:
        raise KeyError(f"station {station.name!r} not in this ephemeris table")
    st = tab.stations[station.name]
    held = st.station
    if (held.lat_deg, held.lon_deg, held.alt_m) != (station.lat_deg, station.lon_deg, station.alt_m):
        raise ValueError(
            f"station {station.name!r} in the table is at ({held.lat_deg}, {held.lon_deg}, {held.alt_m} m) "
            f"but the argument is at ({station.lat_deg}, {station.lon_deg}, {station.alt_m} m)"
        )
    east, north, up, s = _observer(site, ground_height_m)
    d = _site_to_target(st.pos_me, st.vel_ssb_me, s)
    u0 = st.pos_me / np.linalg.norm(st.pos_me, axis=1, keepdims=True)
    up_st = st.up_me + np.cross(st.earth_omega_me, st.up_me) * ((u0 @ s) / C_KM_S)[:, None]
    rng = np.linalg.norm(d, axis=1)
    u = aberrate(d / rng[:, None], _site_velocity_beta(tab, s))
    az, el = az_el_deg(u, east, north, up)
    back = -d / rng[:, None]
    back = aberrate(back, -st.vel_ssb_me / C_KM_S)
    st_el = np.degrees(np.arcsin(np.clip(np.einsum("ij,ij->i", back, up_st), -1.0, 1.0)))
    return StationTrack(tab.et, az, el, rng, st_el)


def eclipse_occulting_radius_km(
    shadow: ShadowModel = "danjon", earth_radius_km: float | None = None, atmosphere_km: float = 0.0
) -> float:
    """Radius of the Earth occulting sphere used by `earth_eclipse_fraction` (km).

    `earth_radius_km`, when given, replaces the radius of the named `shadow` model; `atmosphere_km`
    is then added on top. Record `shadow`, `earth_radius_km` and `atmosphere_km` (or this result) as provenance.
    """
    if shadow == "danjon":
        base = DANJON_EARTH_RADIUS_KM
    elif shadow == "geometric":
        base = EARTH_MEAN_RADIUS_KM
    else:
        raise ValueError(f"unknown shadow model {shadow!r}; expected 'danjon' or 'geometric'")
    return (base if earth_radius_km is None else earth_radius_km) + atmosphere_km


def earth_eclipse_fraction(
    site: Site,
    ground_height_m: float,
    et,
    *,
    shadow: ShadowModel = "danjon",
    earth_radius_km: float | None = None,
    atmosphere_km: float = 0.0,
) -> np.ndarray:
    """Geometric obscuration of the Sun by the Earth, seen from the site: fraction (0..1) of the solar disc hidden.

    Discs are the apparent Sun (`R_SUN_KM`) and an occulting sphere of radius
    `eclipse_occulting_radius_km(shadow, earth_radius_km, atmosphere_km)`, both at their
    site-specific ranges; the overlap is the planar circle-circle lens area, with uniform Sun
    brightness (limb darkening is applied downstream, see `lunarnav.visibility`).

    **Default shadow model, `"danjon"`**: the Earth is enlarged to 1.01 x its equatorial radius,
    the convention of published lunar-eclipse contact times. It reproduced the P1..P4 contacts of two
    2025 total eclipses within 4.6 s; the bare sphere (`shadow="geometric"`, 6371 km) is off by up to
    129 s and understates the eclipse. Planners should keep the default.

    **Physical meaning and limits.** Under the enlarged-shadow convention the result is a geometric
    obscuration *proxy*: it is 0 outside the enlarged penumbra, 1 inside the enlarged umbra, and
    marks where published contacts fall. It is **not** the received irradiance. Real penumbral and
    umbral light also depends on refraction through the Earth's atmosphere (which bends reddened
    light into the geometric shadow) and on atmospheric extinction (aerosols, ozone, clouds,
    which vary by event); neither is modelled. Inside the umbra the Sun is therefore not dark:
    treat 1.0 as "direct disc fully hidden", not "zero flux". The enlargement also hides slightly
    more of the disc than the true opaque Earth would near the limb.

    `earth_radius_km` overrides the model's base radius and `atmosphere_km` adds a further uniform
    thickness (default 0).
    """
    tab = _table(et)
    radius = eclipse_occulting_radius_km(shadow, earth_radius_km, atmosphere_km)
    sun = sun_track(site, ground_height_m, tab)
    earth = earth_track(site, ground_height_m, tab, earth_radius_km=radius)
    sep = _separation_deg(site, ground_height_m, tab)
    return disc_overlap_fraction(sep, sun.ang_radius_deg, earth.ang_radius_deg)


def _separation_deg(site: Site, ground_height_m: float, tab: BodyFixedEphemeris) -> np.ndarray:
    _, _, _, s = _observer(site, ground_height_m)
    beta = _site_velocity_beta(tab, s)
    sun_d = _site_to_target(tab.sun_me, tab.sun_vel_ssb_me, s)
    earth_d = _site_to_target(tab.earth_me, tab.earth_vel_ssb_me, s)
    sun_u = aberrate(sun_d / np.linalg.norm(sun_d, axis=1, keepdims=True), beta)
    earth_u = aberrate(earth_d / np.linalg.norm(earth_d, axis=1, keepdims=True), beta)
    return angular_separation_deg(sun_u, earth_u)


def _subpoint(vec: np.ndarray, beta: np.ndarray, stellar_aberration: bool) -> tuple[np.ndarray, np.ndarray]:
    u = vec / np.linalg.norm(vec, axis=1, keepdims=True)
    if stellar_aberration:
        u = aberrate(u, beta)
    lat = np.degrees(np.arcsin(np.clip(u[:, 2], -1.0, 1.0)))
    lon = np.degrees(np.arctan2(u[:, 1], u[:, 0]))
    return lat, lon


def subsolar_point(et, *, stellar_aberration: bool = True) -> tuple[np.ndarray, np.ndarray]:
    """Planetocentric latitude and east longitude (deg, ME, longitude in (-180, 180]) of the sub-solar point.

    Direction of the Sun from the Moon centre, light-time corrected and, by default, aberrated
    for the Moon's SSB velocity (the same convention as `sun_track`).
    """
    tab = _table(et)
    return _subpoint(tab.sun_me, tab.moon_vel_ssb_me / C_KM_S, stellar_aberration)


def subearth_point(
    et, *, earth_view: bool = False, stellar_aberration: bool = True
) -> tuple[np.ndarray, np.ndarray]:
    """Latitude and east longitude (deg, ME, longitude in (-180, 180]) of the sub-Earth point.

    Default (`earth_view=False`): the point where the Earth centre appears at the zenith for a
    lunar observer, i.e. the same apparent direction as `earth_track` (light time, and stellar
    aberration if `stellar_aberration`). `et` is the reception epoch at the Moon.

    `earth_view=True`: the centre of the lunar disc as seen from the Earth centre (optical
    libration, the convention of JPL Horizons' `ObsSub-LON/LAT`). The Earth is taken where it will
    be when light leaving the Moon at `et` arrives (`et + lt`, first-order in `v_earth * 2 lt`,
    error < 1 cm), with no stellar aberration. `et` is then the *Moon-side* epoch.
    """
    tab = _table(et)
    if earth_view:
        lt = np.linalg.norm(tab.earth_me, axis=1) / C_KM_S
        return _subpoint(tab.earth_me + 2.0 * lt[:, None] * tab.earth_vel_ssb_me, tab.moon_vel_ssb_me, False)
    return _subpoint(tab.earth_me, tab.moon_vel_ssb_me / C_KM_S, stellar_aberration)
