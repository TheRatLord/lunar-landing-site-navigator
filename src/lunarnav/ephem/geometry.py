"""Pure-numpy geometry shared by the ephemeris tracks: local frames, aberration, disc overlap.

Nothing here touches SPICE. Vectors are in the ME body-fixed frame unless stated; angles in degrees
at the public boundary, radians internally.
"""

from __future__ import annotations

import numpy as np

C_KM_S = 299_792.458
"""Speed of light, km/s (exact)."""


def local_basis(lat_deg: float, lon_deg: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """East, North, Up unit vectors (each shape (3,)) at a planetocentric latitude/longitude.

    Up is the sphere radial. The closed forms need no division, so they are exact at the poles:
    at lat = +-90 deg `east = (-sin lon, cos lon, 0)` and `north = -+(cos lon, sin lon, 0)`, i.e. the
    local north is continued from the stated longitude.
    """
    phi = np.radians(lat_deg)
    lam = np.radians(lon_deg)
    sp, cp = np.sin(phi), np.cos(phi)
    sl, cl = np.sin(lam), np.cos(lam)
    east = np.array([-sl, cl, 0.0])
    north = np.array([-sp * cl, -sp * sl, cp])
    up = np.array([cp * cl, cp * sl, sp])
    return east, north, up


def aberrate(u: np.ndarray, beta: np.ndarray) -> np.ndarray:
    """Relativistic stellar aberration of unit directions `u` (N,3) for observer velocity `beta` = v/c (N,3).

    Returns the unit direction as seen by the moving observer (displaced toward the velocity):
    `p' = (p/g + (1 + (p.b)/(1 + 1/g)) b) / (1 + p.b)` with `g = 1/sqrt(1 - b.b)`.
    """
    b2 = np.einsum("ij,ij->i", beta, beta)
    inv_g = np.sqrt(1.0 - b2)
    pb = np.einsum("ij,ij->i", u, beta)
    num = u * inv_g[:, None] + (1.0 + pb / (1.0 + inv_g))[:, None] * beta
    out = num / (1.0 + pb)[:, None]
    return out / np.linalg.norm(out, axis=1, keepdims=True)


def az_el_deg(
    u: np.ndarray, east: np.ndarray, north: np.ndarray, up: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Azimuth (deg clockwise from north, [0, 360)) and elevation (deg above the Up-normal plane).

    `u` need not be normalised. Elevation is `asin(u.up/|u|)`, computed from the unit vector.
    """
    n = np.linalg.norm(u, axis=1)
    ue = (u @ east) / n
    un = (u @ north) / n
    uz = np.clip((u @ up) / n, -1.0, 1.0)
    az = np.degrees(np.arctan2(ue, un)) % 360.0
    az = np.where(az >= 360.0, 0.0, az)
    el = np.degrees(np.arcsin(uz))
    return az, el


def disc_overlap_fraction(sep: np.ndarray, r_small: np.ndarray, r_big: np.ndarray) -> np.ndarray:
    """Fraction of the small disc's area covered by the big disc (planar circle-circle lens area).

    `sep` is the centre separation; all three in the same angular unit. NaN in any input gives NaN. Valid for discs of
    angular radius up to a few degrees (relative area error ~ r^2 of the spherical-cap curvature,
    < 1e-3 for the 1.3 deg Earth disc as seen from the Moon).
    """
    sep, rs, rb = np.broadcast_arrays(*(np.asarray(a, dtype=np.float64) for a in (sep, r_small, r_big)))
    out = np.zeros(sep.shape)
    out[sep <= rb - rs] = 1.0
    undefined = np.isnan(sep) | np.isnan(rs) | np.isnan(rb)
    partial = (sep > rb - rs) & (sep < rb + rs)
    if partial.any():
        d, a, b = sep[partial], rs[partial], rb[partial]
        ca = np.clip((d * d + a * a - b * b) / (2 * d * a), -1.0, 1.0)
        cb = np.clip((d * d + b * b - a * a) / (2 * d * b), -1.0, 1.0)
        alpha, beta = np.arccos(ca), np.arccos(cb)
        lens = a * a * (alpha - np.sin(alpha) * ca) + b * b * (beta - np.sin(beta) * cb)
        out[partial] = np.clip(lens / (np.pi * a * a), 0.0, 1.0)
    out[undefined] = np.nan
    return out


def angular_separation_deg(u1: np.ndarray, u2: np.ndarray) -> np.ndarray:
    """Angle in degrees between row-wise vectors (N,3), via atan2 of cross and dot (stable at 0 and 180)."""
    cross = np.linalg.norm(np.cross(u1, u2), axis=1)
    dot = np.einsum("ij,ij->i", u1, u2)
    return np.degrees(np.arctan2(cross, dot))
