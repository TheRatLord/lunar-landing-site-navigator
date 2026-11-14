"""Horizon grid access shared by the visibility kernels.

A horizon is stored as elevations (degrees) on a uniform azimuth grid starting at 0 deg with step
360/N (see `HorizonProfile`). Between grid nodes it is piecewise linear in azimuth, and it wraps at
360 deg.
"""

from __future__ import annotations

from typing import Literal

import numba as nb
import numpy as np

from lunarnav.types import HorizonProfile

Bound = Literal["nominal", "optimistic", "pessimistic"]
"""Which horizon to test against: `elev_deg`, `elev_lo_deg` (more visible), `elev_hi_deg` (less visible)."""

BOUNDS: tuple[Bound, Bound, Bound] = ("nominal", "optimistic", "pessimistic")


def horizon_grid(horizon: HorizonProfile, bound: Bound = "nominal") -> np.ndarray:
    """Return the horizon elevation grid (degrees, float64, contiguous) for one bound.

    "optimistic" uses the lower bracket `elev_lo_deg` (a lower horizon shows more of the target);
    "pessimistic" uses `elev_hi_deg`. Validates the uniform-grid convention of `HorizonProfile`.
    """
    az = np.asarray(horizon.az_deg, dtype=np.float64)
    n = az.size
    if n < 2:
        raise ValueError("horizon needs at least two azimuth samples")
    expected = np.arange(n) * (360.0 / n)
    if not np.allclose(az, expected, rtol=0.0, atol=1e-6):
        raise ValueError("horizon azimuths must be uniform with az[0] == 0 and step 360/N")
    field = {"nominal": horizon.elev_deg, "optimistic": horizon.elev_lo_deg,
             "pessimistic": horizon.elev_hi_deg}[bound]
    grid = np.ascontiguousarray(field, dtype=np.float64)
    if grid.shape != (n,):
        raise ValueError(f"{bound} horizon has shape {grid.shape}, expected ({n},)")
    if not np.all(np.isfinite(grid)):
        raise ValueError(f"{bound} horizon contains non-finite values")
    return grid


@nb.njit(cache=True, inline="always")
def _horizon_at_scalar(az_deg: float, grid: np.ndarray) -> float:
    n = grid.size
    step = 360.0 / n
    u = (az_deg % 360.0) / step
    i = int(np.floor(u))
    f = u - i
    i0 = i % n
    i1 = (i + 1) % n
    return grid[i0] * (1.0 - f) + grid[i1] * f


@nb.njit(cache=True)
def _horizon_at(az_deg: np.ndarray, grid: np.ndarray) -> np.ndarray:
    out = np.empty(az_deg.size)
    for k in range(az_deg.size):
        a = az_deg[k]
        out[k] = np.nan if np.isnan(a) else _horizon_at_scalar(a, grid)
    return out


def horizon_elevation_at(az_deg: np.ndarray | float, grid: np.ndarray) -> np.ndarray:
    """Horizon elevation (degrees) at arbitrary azimuths by linear interpolation with 360 wrap-around."""
    az = np.ascontiguousarray(np.atleast_1d(az_deg), dtype=np.float64)
    return _horizon_at(az.ravel(), np.ascontiguousarray(grid, dtype=np.float64)).reshape(az.shape)
