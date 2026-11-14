"""Solar-array power on a lander with arbitrarily oriented flat panels.

Frames. The local frame is East-North-Up (ENU), as in `lunarnav.types` (azimuth clockwise from north).
The lander body frame is x forward, y left, z up (right-handed). With zero tilt the body z axis is Up
and the body x axis points along the heading `yaw_deg` (clockwise from north). A tilt then rotates the body
z axis away from Up by `tilt_deg`, toward the azimuth `tilt_az_deg` (the lander leans toward that azimuth),
by the shortest rotation about the horizontal axis Up x lean-direction.

    R_body_to_enu = R_tilt(tilt, tilt_az) @ R_yaw(yaw)

Panels. A panel has an outward unit normal in the body frame, an area, and an efficiency (electrical
output per unit incident beam power, including packing, temperature and cell losses). An illuminated
panel receives  S cos(theta)  with S = S0 (1 au / r)^2 the solar irradiance at the Sun distance r and
theta the angle between panel normal and Sun direction; the back side receives nothing. Power scales
with the visible flux fraction of the solar disc (terrain occultation, limb-darkened) and, if given,
by (1 - eclipse_fraction). The two occultations are combined as independent factors; this is exact when
only one is active and approximate when both partially overlap (the disc cannot be hidden twice).
Albedo, diffuse light and cell degradation with incidence angle are not modelled.

Sun tracking. A tracking panel rotates about the body z axis (the lander's vertical axis, which is
tilted with the lander) to the optimum azimuth; its fixed canting is the z component of its body normal
n_z, so cos(theta) = n_z s_z + sqrt(1 - n_z^2) sqrt(s_x^2 + s_y^2) with s the Sun direction in the body frame
(clipped at 0). A vertical array has n_z = 0.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from lunarnav.constants import AU_KM, SOLAR_CONSTANT_W_M2


@dataclass(frozen=True, slots=True)
class Attitude:
    """Lander attitude relative to the local ENU frame (degrees)."""

    yaw_deg: float = 0.0
    tilt_deg: float = 0.0
    tilt_az_deg: float = 0.0

    def rotation(self) -> np.ndarray:
        """3x3 matrix taking body-frame vectors to ENU."""
        psi = np.radians(self.yaw_deg)
        c, s = np.cos(psi), np.sin(psi)
        r_yaw = np.array([[s, -c, 0.0], [c, s, 0.0], [0.0, 0.0, 1.0]])
        tau = np.radians(self.tilt_deg)
        beta = np.radians(self.tilt_az_deg)
        axis = np.array([-np.cos(beta), np.sin(beta), 0.0])
        k = np.array([[0.0, -axis[2], axis[1]], [axis[2], 0.0, -axis[0]], [-axis[1], axis[0], 0.0]])
        r_tilt = np.eye(3) + np.sin(tau) * k + (1.0 - np.cos(tau)) * (k @ k)
        return r_tilt @ r_yaw


@dataclass(frozen=True, slots=True)
class Panel:
    """Flat solar panel; `normal_body` need not be unit length (see `unit_normal`)."""

    normal_body: tuple[float, float, float]
    area_m2: float
    efficiency: float
    tracking: bool = False

    def __post_init__(self) -> None:
        n = np.asarray(self.normal_body, dtype=np.float64)
        if n.shape != (3,) or not np.linalg.norm(n) > 0.0:
            raise ValueError("panel normal must be a non-zero 3-vector")
        if self.area_m2 < 0.0 or not 0.0 <= self.efficiency <= 1.0:
            raise ValueError("panel area must be >= 0 and efficiency within [0, 1]")

    @property
    def unit_normal(self) -> np.ndarray:
        n = np.asarray(self.normal_body, dtype=np.float64)
        return n / np.linalg.norm(n)


def sun_direction_enu(az_deg: np.ndarray | float, el_deg: np.ndarray | float) -> np.ndarray:
    """Unit vectors (..., 3) east, north, up for azimuth/elevation in degrees."""
    az = np.radians(np.asarray(az_deg, dtype=np.float64))
    el = np.radians(np.asarray(el_deg, dtype=np.float64))
    return np.stack([np.sin(az) * np.cos(el), np.cos(az) * np.cos(el), np.sin(el)], axis=-1)


def cos_incidence(
    az_deg: np.ndarray | float, el_deg: np.ndarray | float, attitude: Attitude, panel: Panel
) -> np.ndarray:
    """Cosine of the Sun incidence angle on `panel`, clipped at 0 (back-lit panels receive nothing)."""
    s_body = sun_direction_enu(az_deg, el_deg) @ attitude.rotation()
    n = panel.unit_normal
    if panel.tracking:
        lateral = np.hypot(s_body[..., 0], s_body[..., 1])
        c = n[2] * s_body[..., 2] + np.sqrt(max(1.0 - n[2] ** 2, 0.0)) * lateral
    else:
        c = s_body @ n
    return np.clip(c, 0.0, None)


def solar_irradiance_w_m2(range_km: np.ndarray | float) -> np.ndarray:
    """Beam irradiance at Sun distance `range_km`: S0 (1 au / r)^2, S0 = 1361 W/m^2 (constants module)."""
    return SOLAR_CONSTANT_W_M2 * (AU_KM / np.asarray(range_km, dtype=np.float64)) ** 2


def array_power_w(
    az_deg: np.ndarray, el_deg: np.ndarray, range_km: np.ndarray, flux_fraction: np.ndarray,
    attitude: Attitude, panels: Sequence[Panel], eclipse_fraction: np.ndarray | None = None,
) -> np.ndarray:
    """Total electrical power (W) from all panels at each epoch.

    `flux_fraction` is the terrain-visible limb-darkened fraction of the solar disc (0..1); pass the
    nominal, optimistic or pessimistic version for bounds. `eclipse_fraction` (0..1) is the fraction of
    the disc hidden by Earth, or None.
    """
    flux = np.asarray(flux_fraction, dtype=np.float64)
    if eclipse_fraction is not None:
        flux = flux * (1.0 - np.asarray(eclipse_fraction, dtype=np.float64))
    irr = solar_irradiance_w_m2(range_km) * flux
    total = np.zeros(np.broadcast(irr, np.asarray(az_deg)).shape)
    for p in panels:
        total = total + p.area_m2 * p.efficiency * irr * cos_incidence(az_deg, el_deg, attitude, p)
    return total


@dataclass(frozen=True, slots=True)
class YawEnvelope:
    """Power evaluated for a set of yaws."""

    yaw_deg: np.ndarray
    power_w: np.ndarray
    """Shape (n_yaw, n_epochs)."""

    @property
    def worst(self) -> np.ndarray:
        return self.power_w.min(axis=0)

    @property
    def best(self) -> np.ndarray:
        return self.power_w.max(axis=0)

    @property
    def mean(self) -> np.ndarray:
        return self.power_w.mean(axis=0)


def power_over_yaws(
    az_deg: np.ndarray, el_deg: np.ndarray, range_km: np.ndarray, flux_fraction: np.ndarray,
    yaws_deg: Sequence[float] | np.ndarray, tilt_deg: float, tilt_az_deg: float, panels: Sequence[Panel],
    eclipse_fraction: np.ndarray | None = None,
) -> YawEnvelope:
    """Array power for each yaw in `yaws_deg` (an uncertain or unknown heading), without Monte Carlo.

    Use `YawEnvelope.worst` / `.best` / `.mean` over the set; a uniform grid of yaws spanning the
    uncertainty (or all 360 deg) gives the envelope up to the grid resolution.
    """
    yaws = np.asarray(yaws_deg, dtype=np.float64)
    rows = [array_power_w(az_deg, el_deg, range_km, flux_fraction, Attitude(y, tilt_deg, tilt_az_deg),
                          panels, eclipse_fraction) for y in yaws]
    return YawEnvelope(yaws, np.vstack(rows))
