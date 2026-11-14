"""Body-fixed (ME) ephemeris tables: the only place SPICE is called for track geometry.

Design (justified and measured in docs/validation/ephemeris.md)
----------------------------------------------------------------
A table stores, for every epoch, quantities that are *independent of the observer site* and
*smooth in time*:

* Sun and Earth-centre positions relative to the Moon centre in the ME frame, corrected for
  light time only (`CN`; target taken at `et - lt`, frame evaluated at the reception epoch `et`);
* the SSB velocities (expressed in ME) of the Sun, Earth and Moon centre, and the angular velocity
  of the ME frame, which are needed to apply stellar aberration and the light-time offset of a
  displaced observer per site;
* for each ground station: the retarded position relative to the Moon centre (station-specific
  light time), its SSB velocity, and its geodetic up vector, all in ME.

Per-site apparent directions are then pure numpy (`tracks.py`): the site offset is subtracted, the
residual light-time difference (a site displaced by `s` sees the target at `et - lt + (u.s)/c`)
is applied with the target velocity, and relativistic stellar aberration is applied with the
site's inertial velocity `v_moon + omega x s`. This reproduces SPICE's constant-position-observer
`CN+S` solution; the residual against SPICE is reported in docs/validation/ephemeris.md.

Epoch grids: SPICE is fast per call but not for ~1e5 epochs inside a one second budget. When there
are more epochs than grid nodes, SPICE is sampled on a regular grid (default 1 h) and interpolated
with a not-a-knot cubic spline of the vectors. Stations need no per-epoch SPICE at all: the Earth
orientation is split into the analytic diurnal rotation and a slowly varying remainder that is splined
on a coarser grid (default 2 h), see `_stations_from_orientation`. The error bounds are measured in
the validation report.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

import numpy as np
import spiceypy as spice
from scipy.interpolate import CubicSpline

from lunarnav.constants import BODY_FIXED_FRAME
from lunarnav.ephem.geometry import C_KM_S
from lunarnav.ephem.kernels import SPICE_LOCK, load_kernels
from lunarnav.types import GroundStation

WGS84_A_KM = 6378.137
"""WGS84 equatorial radius, km."""
WGS84_INV_F = 298.257223563
"""WGS84 inverse flattening."""

DEFAULT_GRID_STEP_S = 3600.0
DEFAULT_STATION_GRID_STEP_S = 7200.0
OMEGA_EARTH_RAD_S = 7.2921150e-5
"""Nominal mean Earth rotation rate (IERS), rad/s; used only to split off the fast diurnal rotation."""
_PAD_NODES = 4

_SUN, _EARTH, _MOON = 10, 399, 301


@dataclass(frozen=True, slots=True)
class StationEphemeris:
    """A ground station as seen from the Moon, in the ME frame at each epoch."""

    station: GroundStation
    pos_me: np.ndarray
    """(N,3) km, light-time-retarded station position relative to the Moon centre."""
    vel_ssb_me: np.ndarray
    """(N,3) km/s, inertial (SSB) velocity of the station at the retarded time, in ME components."""
    up_me: np.ndarray
    """(N,3) geodetic (WGS84) local vertical of the station at the retarded time, unit, ME components."""
    earth_omega_me: np.ndarray
    """(N,3) rad/s, Earth rotation vector (ITRF93 relative to J2000) in ME components; rotates `up_me` with time."""


@dataclass(frozen=True, slots=True)
class BodyFixedEphemeris:
    """Site-independent Sun, Earth and station geometry in the Moon ME frame for N epochs.

    Build with `BodyFixedEphemeris.build`. All vectors are relative to the Moon centre, in km,
    corrected for light time (target at `et - lt`) but not for stellar aberration; the ME frame is
    evaluated at the reception epoch `et`.
    """

    et: np.ndarray
    sun_me: np.ndarray
    earth_me: np.ndarray
    sun_vel_ssb_me: np.ndarray
    earth_vel_ssb_me: np.ndarray
    moon_vel_ssb_me: np.ndarray
    omega_me: np.ndarray
    """(N,3) rad/s, angular velocity of the ME frame relative to J2000, in ME components."""
    stations: dict[str, StationEphemeris] = field(default_factory=dict)
    provenance: dict = field(default_factory=dict)

    def __len__(self) -> int:
        return int(self.et.shape[0])

    @classmethod
    def build(
        cls,
        et: Sequence[float] | np.ndarray,
        stations: Sequence[GroundStation] = (),
        *,
        grid_step_s: float = DEFAULT_GRID_STEP_S,
        station_grid_step_s: float = DEFAULT_STATION_GRID_STEP_S,
        interpolate: bool | None = None,
    ) -> BodyFixedEphemeris:
        """Compute the table for epochs `et` (TDB s past J2000, any order, 1-D).

        `interpolate=None` samples SPICE directly when that needs fewer evaluations than a
        regular grid would, and otherwise samples the grid and splines; `True`/`False` force the
        choice (`False` is the exact per-epoch SPICE reference used by the validation).
        Epochs outside the pinned kernel coverage raise `ValueError`.
        """
        kernels = load_kernels()
        et = np.atleast_1d(np.asarray(et, dtype=np.float64))
        if et.ndim != 1:
            raise ValueError(f"et must be a scalar or a 1-D array, got shape {et.shape}")
        et = np.ascontiguousarray(et)
        if et.size == 0:
            raise ValueError("at least one epoch is required")
        lo, hi = kernels.valid_et
        if not (np.isfinite(et).all() and et.min() >= lo and et.max() <= hi):
            raise ValueError(f"epochs must lie within kernel coverage [{lo:.0f}, {hi:.0f}] s past J2000")
        names = [s.name for s in stations]
        if len(set(names)) != len(names):
            raise ValueError("station names must be unique")

        grid = _grid(et, grid_step_s, (lo, hi))
        use_grid = (grid is not None and et.size > grid.size) if interpolate is None else interpolate
        if use_grid and grid is None:
            raise ValueError(
                "interpolation requested but the epoch span is too short or too close to kernel limits"
            )
        if use_grid:
            core = _spline_eval(grid, _core_samples(grid), et)
        else:
            core = _core_samples(et)
        sun, earth, vsun, vearth, vmoon, omega = (core[:, 3 * i : 3 * i + 3] for i in range(6))

        station_tables: dict[str, StationEphemeris] = {}
        station_spline = False
        if stations:
            sgrid = _grid(et, station_grid_step_s, (lo, hi))
            fast = (sgrid is not None and et.size > sgrid.size) if interpolate is None else interpolate
            station_spline = bool(fast and sgrid is not None)
            if station_spline:
                station_tables = _stations_from_orientation(et, sgrid, stations, earth, vearth)
            else:
                for st in stations:
                    data = _station_samples(et, st)
                    up = data[:, 6:9] / np.linalg.norm(data[:, 6:9], axis=1, keepdims=True)
                    station_tables[st.name] = StationEphemeris(
                        st, data[:, 0:3], data[:, 3:6], up, data[:, 9:12]
                    )

        prov = {
            "kernels": kernels.provenance(),
            "grid_step_s": float(grid_step_s) if use_grid else None,
            "station_grid_step_s": float(station_grid_step_s) if station_spline else None,
            "frame": BODY_FIXED_FRAME,
            "aberration_in_vectors": "none (light time only)",
        }
        return cls(et, sun, earth, vsun, vearth, vmoon, omega, station_tables, prov)


def _grid(et: np.ndarray, step: float, valid: tuple[float, float]) -> np.ndarray | None:
    """Regular node grid covering `et` padded by `_PAD_NODES` nodes, or None if it leaves `valid`."""
    if step <= 0:
        raise ValueError("grid step must be positive")
    t0 = np.floor(et.min() / step) * step - _PAD_NODES * step
    t1 = np.ceil(et.max() / step) * step + _PAD_NODES * step
    if t0 < valid[0] or t1 > valid[1]:
        return None
    return np.arange(t0, t1 + 0.5 * step, step)


def _spline_eval(nodes: np.ndarray, samples: np.ndarray, et: np.ndarray) -> np.ndarray:
    return CubicSpline(nodes, samples, axis=0)(et)


def _to_me(ets: np.ndarray, *vectors: np.ndarray) -> tuple[np.ndarray, ...]:
    """Rotate J2000 vectors to ME at each epoch; also returns the ME angular velocity (rad/s, ME components)."""
    with SPICE_LOCK:
        xf = spice.sxform("J2000", BODY_FIXED_FRAME, ets)
    xf = xf.reshape(-1, 6, 6)
    rot = xf[:, :3, :3]
    rotated = tuple(np.einsum("nij,nj->ni", rot, v) for v in vectors)
    skew = -np.einsum("nij,nkj->nik", xf[:, 3:, :3], rot)
    omega = np.stack([skew[:, 2, 1], skew[:, 0, 2], skew[:, 1, 0]], axis=1)
    return (*rotated, omega)


def _core_samples(ets: np.ndarray) -> np.ndarray:
    """(N,18) rows: sun_cn, earth_cn, sun_v, earth_v, moon_v (ME) and omega, from SPICE at each epoch."""
    n = ets.size
    sun = np.empty((n, 3))
    earth = np.empty((n, 3))
    vsun = np.empty((n, 3))
    vearth = np.empty((n, 3))
    vmoon = np.empty((n, 3))
    with SPICE_LOCK:
        for i, t in enumerate(ets.tolist()):
            sun[i] = spice.spkez(_SUN, t, "J2000", "CN", _MOON)[0][:3]
            earth[i] = spice.spkez(_EARTH, t, "J2000", "CN", _MOON)[0][:3]
            vsun[i] = spice.spkez(_SUN, t, "J2000", "NONE", 0)[0][3:]
            vearth[i] = spice.spkez(_EARTH, t, "J2000", "NONE", 0)[0][3:]
            vmoon[i] = spice.spkez(_MOON, t, "J2000", "NONE", 0)[0][3:]
    *rotated, omega = _to_me(ets, sun, earth, vsun, vearth, vmoon)
    return np.hstack([*rotated, omega])


def _rz(angle: np.ndarray) -> np.ndarray:
    """(N,3,3) rotation matrices about z by `angle` (rad): active rotation of vectors, `[[c,-s,0],[s,c,0],[0,0,1]]`."""
    c, sn = np.cos(angle), np.sin(angle)
    out = np.zeros((angle.size, 3, 3))
    out[:, 0, 0], out[:, 0, 1], out[:, 1, 0], out[:, 1, 1], out[:, 2, 2] = c, -sn, sn, c, 1.0
    return out


def _stations_from_orientation(
    et: np.ndarray,
    grid: np.ndarray,
    stations: Sequence[GroundStation],
    earth: np.ndarray,
    vearth: np.ndarray,
) -> dict[str, StationEphemeris]:
    """Station geometry for many epochs and stations with no per-epoch SPICE calls.

    A station is the Earth-centre vector (already in the table) plus an Earth-fixed vector turned by the
    Earth orientation `R(t)`: ITRF93 -> J2000. `R` is dominated by the diurnal rotation, which is
    removed analytically (`R = Q(t) Rz(theta(t))`, `theta` linear in time at the nominal rate), so the
    remainder `Q` (precession, nutation, polar motion, UT1 drift; all slow, diurnal polar motion
    of ~1e-6 rad) is splined from SPICE `sxform` on `grid`, as is the J2000 -> ME rotation. The
    station-specific light time differs from the Earth-centre one by at most ~21 ms, so the
    retarded position, velocity and up vector follow from a first-order shift along the station's
    SSB velocity (second-order terms are below 1e-8 km).
    """
    n = len(et)
    g0 = grid[0]
    with SPICE_LOCK:
        to_me_6 = spice.sxform("J2000", BODY_FIXED_FRAME, grid)
        r_i_6 = spice.sxform("ITRF93", "J2000", grid)
    to_me = to_me_6.reshape(-1, 6, 6)[:, :3, :3]
    rme = CubicSpline(grid, to_me.reshape(-1, 9), axis=0)(et).reshape(n, 3, 3)
    r_i = r_i_6.reshape(-1, 6, 6)[:, :3, :3]
    theta0 = float(np.arctan2(r_i[0, 1, 0], r_i[0, 0, 0]))
    q = r_i @ _rz(-(theta0 + OMEGA_EARTH_RAD_S * (grid - g0)))
    q_spline = CubicSpline(grid, q.reshape(-1, 9), axis=0)

    lt_c = np.linalg.norm(earth, axis=1) / C_KM_S
    tc = et - lt_c
    r_tc = np.einsum(
        "nij,njk->nik", q_spline(tc).reshape(n, 3, 3), _rz(theta0 + OMEGA_EARTH_RAD_S * (tc - g0))
    )
    omega_me = OMEGA_EARTH_RAD_S * np.einsum("nij,nj->ni", rme, r_tc[:, :, 2])

    out: dict[str, StationEphemeris] = {}
    for st in stations:
        lon, lat = np.radians(st.lon_deg), np.radians(st.lat_deg)
        up_itrf = np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
        p_me = np.einsum("nij,nj->ni", rme, r_tc @ station_position_itrf_km(st))
        up_me = np.einsum("nij,nj->ni", rme, r_tc @ up_itrf)
        v_rot = np.cross(omega_me, p_me)
        pos0, vel0 = earth + p_me, vearth + v_rot
        tau = np.zeros(n)
        for _ in range(3):
            tau = np.linalg.norm(pos0 - vel0 * tau[:, None], axis=1) / C_KM_S - lt_c
        pos = pos0 - vel0 * tau[:, None]
        vel = vel0 - np.cross(omega_me, v_rot) * tau[:, None]
        up = up_me - np.cross(omega_me, up_me) * tau[:, None]
        out[st.name] = StationEphemeris(
            st, pos, vel, up / np.linalg.norm(up, axis=1, keepdims=True), omega_me
        )
    return out


def station_position_itrf_km(station: GroundStation) -> np.ndarray:
    """ITRF93 Cartesian position (km, Earth-centre relative) of a WGS84 geodetic station (lat/lon east-positive, deg)."""
    lon, lat = np.radians(station.lon_deg), np.radians(station.lat_deg)
    with SPICE_LOCK:
        return np.asarray(spice.georec(lon, lat, station.alt_m / 1000.0, WGS84_A_KM, 1.0 / WGS84_INV_F))


def _station_samples(ets: np.ndarray, st: GroundStation) -> np.ndarray:
    """(N,12) rows: retarded station position, SSB velocity, geodetic up, Earth rotation vector, all in ME at `ets`."""
    lon, lat = np.radians(st.lon_deg), np.radians(st.lat_deg)
    p_itrf = station_position_itrf_km(st)
    up_itrf = np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
    n = ets.size
    pos = np.empty((n, 3))
    vel = np.empty((n, 3))
    up = np.empty((n, 3))
    omega = np.empty((n, 3))
    with SPICE_LOCK:
        _station_loop(ets, p_itrf, up_itrf, pos, vel, up, omega)
    pos, vel, up, omega, _ = _to_me(ets, pos, vel, up, omega)
    return np.hstack([pos, vel, up, omega])


def _station_loop(
    ets: np.ndarray,
    p_itrf: np.ndarray,
    up_itrf: np.ndarray,
    pos: np.ndarray,
    vel: np.ndarray,
    up: np.ndarray,
    omega: np.ndarray,
) -> None:
    """Fill the per-epoch station arrays from SPICE; the caller holds `SPICE_LOCK`."""
    for i, t in enumerate(ets.tolist()):
        state, lt = spice.spkcpt(p_itrf, "EARTH", "ITRF93", t, "J2000", "OBSERVER", "CN", "MOON")
        t_tx = t - lt
        pos[i] = state[:3]
        xf = spice.sxform("ITRF93", "J2000", t_tx)
        up[i] = xf[:3, :3] @ up_itrf
        skew = xf[3:, :3] @ xf[:3, :3].T
        omega[i] = (skew[2, 1], skew[0, 2], skew[1, 0])
        vel[i] = spice.spkez(_EARTH, t_tx, "J2000", "NONE", 0)[0][3:] + xf[3:, :3] @ p_itrf
