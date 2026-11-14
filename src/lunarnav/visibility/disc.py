"""Fraction of a circular disc (the Sun) above a piecewise-linear terrain horizon.

Geometry. The disc is centred at (az0, el0) with angular radius r (< 1 deg for the Sun). We work in the
tangent plane at the disc centre: x = (az - az0) cos(el0), y = el - el0, and the horizon is linear in
azimuth between grid nodes, hence linear in x. The approximation is the use of cos(el0) for the azimuth
scale over the whole disc (the true scale cos(el) varies by about r tan(el0) across it), plus the flat
tangent plane itself. Both are second order in r; measured against exact spherical-cap quadrature the
area/flux error is below 2e-4 for horizons up to 20 deg elevation and 9e-4 at 60 deg
(docs/validation/visibility.md, section 1.3). Lunar terrain horizons are mostly below 20 deg.

Area. Visible area is the integral over x of the chord above the horizon,
    A = integral [ c(x) - clamp(y_h(x), -c(x), c(x)) ] dx,   c(x) = sqrt(r^2 - x^2).
Each linear horizon piece is split at its intersections with the circle (a quadratic), and every
sub-interval integrates in closed form, so the area is exact for the piecewise-linear horizon.

Flux. With radially symmetric weight w(rho), rho = d/r, the visible flux is
    F = integral w dA_vis.
Letting S(rho) be the visible area of the concentric disc of radius rho * r and using w = mu ** alpha,
mu = sqrt(1 - rho^2), integration by parts and t = mu ** alpha give the smooth integral
    F = integral_0^1 S(rho(t)) dt,   rho(t) = sqrt(1 - t ** (2 / alpha)),
evaluated by Gauss-Legendre quadrature with the exact S above. The normalisation is the full-disc flux
pi r^2 * 2 / (alpha + 2).
"""

from __future__ import annotations

from dataclasses import dataclass

import numba as nb
import numpy as np

from lunarnav.types import HorizonProfile, TargetTrack
from lunarnav.visibility._horizon import BOUNDS, _horizon_at_scalar, horizon_elevation_at, horizon_grid
from lunarnav.visibility.limb_darkening import DEFAULT_ALPHA, LimbDarkening

_COS_FLOOR = 1e-6
DEFAULT_FLUX_NODES = 24


@nb.njit(cache=True, inline="always")
def _prim(x: float, s: float) -> float:
    """Antiderivative of sqrt(s^2 - x^2)."""
    u = x / s
    if u > 1.0:
        u = 1.0
    elif u < -1.0:
        u = -1.0
    return 0.5 * (x * np.sqrt(max(s * s - x * x, 0.0)) + s * s * np.arcsin(u))


@nb.njit(cache=True)
def _piece_area(xa: float, xb: float, p: float, q: float, s: float) -> float:
    """Visible area of the circle of radius s over x in [xa, xb] where the horizon is y = p + q x."""
    lo = max(xa, -s)
    hi = min(xb, s)
    if hi <= lo:
        return 0.0
    brk = np.empty(6)
    nb_ = 0
    brk[nb_] = lo
    nb_ += 1
    a = 1.0 + q * q
    b = p * q
    c = p * p - s * s
    disc = b * b - a * c
    if disc > 0.0:
        sq = np.sqrt(disc)
        r1 = (-b - sq) / a
        r2 = (-b + sq) / a
        if r1 > lo and r1 < hi:
            brk[nb_] = r1
            nb_ += 1
        if r2 > lo and r2 < hi and r2 != r1:
            brk[nb_] = r2
            nb_ += 1
    brk[nb_] = hi
    nb_ += 1
    total = 0.0
    for k in range(nb_ - 1):
        x0 = brk[k]
        x1 = brk[k + 1]
        if x1 <= x0:
            continue
        xm = 0.5 * (x0 + x1)
        cm = np.sqrt(max(s * s - xm * xm, 0.0))
        ym = p + q * xm
        if ym >= cm:
            continue
        circ = _prim(x1, s) - _prim(x0, s)
        if ym <= -cm:
            total += 2.0 * circ
        else:
            total += circ - (p * (x1 - x0) + 0.5 * q * (x1 * x1 - x0 * x0))
    return total


@nb.njit(cache=True)
def _visible_area(az0: float, el0: float, s: float, grid: np.ndarray, hmin: float, hmax: float) -> float:
    """Visible area (deg^2, tangent plane) of a disc of radius s centred at (az0, el0)."""
    full = np.pi * s * s
    if el0 - s >= hmax:
        return full
    if el0 + s <= hmin:
        return 0.0
    n = grid.size
    step = 360.0 / n
    cosel = max(np.cos(np.radians(el0)), _COS_FLOOR)
    az0m = az0 % 360.0
    half = s / cosel
    k_lo = int(np.floor((az0m - half) / step))
    k_hi = int(np.ceil((az0m + half) / step))
    total = 0.0
    for k in range(k_lo, k_hi):
        ia = k % n
        ib = (k + 1) % n
        xa = (k * step - az0m) * cosel
        xb = ((k + 1) * step - az0m) * cosel
        ya = grid[ia] - el0
        yb = grid[ib] - el0
        q = (yb - ya) / (xb - xa)
        p = ya - q * xa
        total += _piece_area(xa, xb, p, q, s)
    return min(max(total, 0.0), full)


@nb.njit(cache=True, parallel=True)
def _disc_kernel(
    az: np.ndarray, el: np.ndarray, rad: np.ndarray, grid: np.ndarray, alpha: float,
    nodes: np.ndarray, weights: np.ndarray, want_flux: bool,
) -> tuple[np.ndarray, np.ndarray]:
    m = az.size
    area_f = np.empty(m)
    flux_f = np.empty(m)
    hmin = grid.min()
    hmax = grid.max()
    inv = 2.0 / alpha if alpha > 0.0 else 0.0
    for i in nb.prange(m):
        a0 = az[i]
        e0 = el[i]
        s = rad[i]
        if np.isnan(a0) or np.isnan(e0) or np.isnan(s):
            area_f[i] = np.nan
            flux_f[i] = np.nan
            continue
        if s <= 0.0:
            h = _horizon_at_scalar(a0, grid)
            v = 1.0 if e0 > h else 0.0
            area_f[i] = v
            flux_f[i] = v
            continue
        full = np.pi * s * s
        a_vis = _visible_area(a0, e0, s, grid, hmin, hmax)
        area_f[i] = a_vis / full
        if not want_flux:
            continue
        if a_vis >= full:
            flux_f[i] = 1.0
        elif alpha <= 0.0:
            flux_f[i] = a_vis / full
        else:
            flux_f[i] = _flux_fraction(a0, e0, s, grid, hmin, hmax, alpha, inv, nodes, weights)
    return area_f, flux_f


@nb.njit(cache=True)
def _flux_fraction(
    a0: float, e0: float, s: float, grid: np.ndarray, hmin: float, hmax: float,
    alpha: float, inv: float, nodes: np.ndarray, weights: np.ndarray,
) -> float:
    if e0 + s <= hmin:
        return 0.0
    acc = 0.0
    for j in range(nodes.size):
        t = nodes[j]
        rho2 = 1.0 - t**inv
        if rho2 <= 0.0:
            continue
        acc += weights[j] * _visible_area(a0, e0, s * np.sqrt(rho2), grid, hmin, hmax)
    return acc / (np.pi * s * s * 2.0 / (alpha + 2.0))


def _gauss_unit(n: int) -> tuple[np.ndarray, np.ndarray]:
    x, w = np.polynomial.legendre.leggauss(n)
    return 0.5 * (x + 1.0), 0.5 * w


def disc_fraction(
    az_deg: np.ndarray | float,
    el_deg: np.ndarray | float,
    ang_radius_deg: np.ndarray | float,
    grid_deg: np.ndarray,
    limb: LimbDarkening | None = None,
    *,
    flux: bool = True,
    n_nodes: int = DEFAULT_FLUX_NODES,
) -> tuple[np.ndarray, np.ndarray]:
    """Fractions of a disc above a piecewise-linear horizon.

    Args:
        az_deg, el_deg: disc-centre direction (broadcastable arrays or scalars, degrees).
        ang_radius_deg: angular radius (scalar or array); 0 gives the point-target result (0 or 1).
        grid_deg: horizon elevation on the uniform azimuth grid az = k * 360 / N, wrapping at 360.
        limb: limb-darkening law (default `LimbDarkening()`); `LimbDarkening(0.0)` is uniform.
        flux: also compute the flux fraction (otherwise the second output is NaN).
        n_nodes: Gauss-Legendre nodes for the flux integral.

    Returns:
        `(area_fraction, flux_fraction)`, each shaped like the broadcast inputs; NaN where an input
        is NaN. The flux fraction is the limb-darkened visible flux divided by the full-disc flux.
    """
    law = limb if limb is not None else LimbDarkening(DEFAULT_ALPHA)
    az, el, rad = np.broadcast_arrays(
        np.asarray(az_deg, dtype=np.float64), np.asarray(el_deg, dtype=np.float64),
        np.asarray(ang_radius_deg, dtype=np.float64))
    if np.any(rad < 0.0):
        raise ValueError("ang_radius_deg must be non-negative")
    shape = az.shape
    nodes, weights = _gauss_unit(n_nodes)
    grid = np.ascontiguousarray(grid_deg, dtype=np.float64)
    if grid.ndim != 1 or grid.size < 2:
        raise ValueError("grid_deg must be a 1-D horizon with at least two samples")
    area_f, flux_f = _disc_kernel(
        np.ascontiguousarray(az.ravel()), np.ascontiguousarray(el.ravel()),
        np.ascontiguousarray(rad.ravel()), grid, float(law.alpha), nodes, weights, bool(flux))
    if not flux:
        flux_f[:] = np.nan
    return area_f.reshape(shape), flux_f.reshape(shape)


@dataclass(frozen=True, slots=True)
class BoundedSignal:
    """A visibility signal evaluated against the best, optimistic (`elev_lo`) and pessimistic (`elev_hi`) horizons."""

    nominal: np.ndarray
    optimistic: np.ndarray
    pessimistic: np.ndarray

    def __post_init__(self) -> None:
        if not (self.nominal.shape == self.optimistic.shape == self.pessimistic.shape):
            raise ValueError("bound arrays must share one shape")


@dataclass(frozen=True, slots=True)
class DiscVisibility:
    """Area and flux fractions of the target disc for the three horizon brackets."""

    area: BoundedSignal
    flux: BoundedSignal


def disc_visibility(
    track: TargetTrack,
    horizon: HorizonProfile,
    limb: LimbDarkening | None = None,
    *,
    n_nodes: int = DEFAULT_FLUX_NODES,
) -> DiscVisibility:
    """Area and limb-darkened flux fractions of `track` against `horizon` and its lo/hi brackets."""
    areas, fluxes = [], []
    for bound in BOUNDS:
        a, f = disc_fraction(track.az_deg, track.el_deg, track.ang_radius_deg,
                             horizon_grid(horizon, bound), limb, n_nodes=n_nodes)
        areas.append(a)
        fluxes.append(f)
    return DiscVisibility(BoundedSignal(*areas), BoundedSignal(*fluxes))


def point_clearance(
    az_deg: np.ndarray | float,
    el_deg: np.ndarray | float,
    grid_deg: np.ndarray,
    margin_deg: float = 0.0,
) -> np.ndarray:
    """Elevation of a point target above the horizon plus `margin_deg` requirement (degrees).

    Positive means the target clears the horizon by at least the margin (e.g. an antenna
    needing 2 deg of clearance); the sign change is the visibility edge, and the value is
    smooth in time, so it can be passed to the interval tools directly.
    """
    el = np.asarray(el_deg, dtype=np.float64)
    return el - horizon_elevation_at(az_deg, grid_deg).reshape(np.shape(el)) - margin_deg


def point_clearance_bounds(
    az_deg: np.ndarray, el_deg: np.ndarray, horizon: HorizonProfile, margin_deg: float = 0.0
) -> BoundedSignal:
    """`point_clearance` against the nominal, optimistic (lo) and pessimistic (hi) horizons."""
    vals = [point_clearance(az_deg, el_deg, horizon_grid(horizon, b), margin_deg) for b in BOUNDS]
    return BoundedSignal(*vals)
