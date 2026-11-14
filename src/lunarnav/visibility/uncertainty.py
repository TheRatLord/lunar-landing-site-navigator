"""Propagating DEM errors into horizon bounds and window-edge times.

Model (a first-order, per-azimuth approximation). The horizon at azimuth az is set by one blocking
terrain sample at ground (great-circle) distance d, `HorizonProfile.blocker_dist_m`, and elevation angle h
above the local horizontal, so its height above the observer is dz = d tan h and its slant distance is
d / cos h (curvature neglected). Errors of that sample:

- vertical, sigma_z (metres): h = atan(dz / d), so dh/ddz = d / (d^2 + dz^2) = cos^2(h) / d and
  dh = sigma_z cos^2(h) / d  (the error is seen at the slant range d / cos h, not at d);
- horizontal, sigma_xy (metres, per axis, isotropic):
    * across the line of sight, the blocker moves along the horizon by sigma_xy / d in azimuth, and the
      horizon elevation there changes by  g sigma_xy / d, with g = d(elev)/d(az) the local horizon
      gradient (deg per deg, centred difference on the azimuth grid);
    * along the line of sight (ground distance changes by sigma_xy at fixed dz):
      dh/dd = -dz / (d^2 + dz^2) = -sin h cos h / d, so dh = sigma_xy sin(h) cos(h) / d.

The three terms are independent and combine in quadrature:

    sigma_h^2 = (sigma_z cos^2 h / d)^2 + (g sigma_xy / d)^2 + (sigma_xy sin h cos h / d)^2     [rad^2]

`widen_horizon` returns a horizon whose bracket is extended by `k_sigma * sigma_h` on each side
(lo - k sigma, hi + k sigma). Limitations, all inherent to a per-azimuth marginal model:

- the horizon is the envelope of many samples; when two blockers have similar elevation, the chance that
  the other one takes over is not propagated (the single-blocker sigma slightly under-states the upper
  tail there);
- spatially correlated DEM errors (tilts, datum offsets) move the whole horizon together; the bracket
  is then conservative for single edges but not for the joint behaviour of many edges;
- `d` is the distance of the nominal blocker; the curvature term d / 2R is not differentiated (its error
  contribution is of order sigma_xy / R, negligible).

Edge-time uncertainty: for a crossing of a clearance signal c(t) = el(t) - h(az(t)) the time error is
sigma_t = sigma_h / |dc/dt|, evaluated at the crossing.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np

from lunarnav.types import HorizonProfile, TargetTrack
from lunarnav.visibility._horizon import horizon_elevation_at, horizon_grid
from lunarnav.visibility.disc import disc_fraction, point_clearance
from lunarnav.visibility.intervals import Method, UncertainWindow, bounded_windows, crossing_times
from lunarnav.visibility.limb_darkening import LimbDarkening


def _as_budget(value: float | np.ndarray, name: str) -> float | np.ndarray:
    """Validate one error term: a finite non-negative float, or a 1-D array of them (stored read-only)."""
    arr = np.asarray(value, dtype=np.float64)
    if arr.ndim > 1:
        raise ValueError(f"{name} must be a scalar or a 1-D array with one value per azimuth")
    if arr.size == 0 or not np.all(np.isfinite(arr)):
        raise ValueError(f"{name} must be finite and non-empty")
    if np.any(arr < 0.0):
        raise ValueError(f"{name} must be non-negative")
    if arr.ndim == 0:
        return float(arr)
    out = arr.copy()
    out.flags.writeable = False
    return out


@dataclass(frozen=True, slots=True, eq=False)
class TerrainErrorModel:
    """DEM error budget: 1-sigma vertical and (per-axis) horizontal error, metres.

    Each term is a float (the same budget at every azimuth) or a 1-D array with one value per azimuth of
    the horizon it is applied to (a terrain product's own published error for the azimuths it supplies).
    Both terms must be finite and non-negative; array lengths are checked against the horizon when applied.
    Equality compares values (arrays element-wise).
    """

    sigma_z_m: float | np.ndarray
    sigma_xy_m: float | np.ndarray

    def __post_init__(self) -> None:
        object.__setattr__(self, "sigma_z_m", _as_budget(self.sigma_z_m, "sigma_z_m"))
        object.__setattr__(self, "sigma_xy_m", _as_budget(self.sigma_xy_m, "sigma_xy_m"))

    @property
    def per_azimuth(self) -> bool:
        """True if either term is an array."""
        return bool(np.ndim(self.sigma_z_m) or np.ndim(self.sigma_xy_m))

    def for_azimuths(self, n: int) -> tuple[np.ndarray, np.ndarray]:
        """Both terms as float64 arrays of length `n`; raises if an array term has another length."""
        out = []
        for name, v in (("sigma_z_m", self.sigma_z_m), ("sigma_xy_m", self.sigma_xy_m)):
            a = np.asarray(v, dtype=np.float64)
            if a.ndim == 1 and a.size != n:
                raise ValueError(f"{name} has {a.size} values but the horizon has {n} azimuths")
            out.append(np.broadcast_to(a, (n,)))
        return out[0], out[1]

    def ranges(self) -> dict[str, float]:
        """JSON-safe minimum and maximum of each term."""
        return {
            "sigma_z_m_min": float(np.min(self.sigma_z_m)), "sigma_z_m_max": float(np.max(self.sigma_z_m)),
            "sigma_xy_m_min": float(np.min(self.sigma_xy_m)), "sigma_xy_m_max": float(np.max(self.sigma_xy_m)),
        }

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, TerrainErrorModel):
            return NotImplemented
        return (np.array_equal(self.sigma_z_m, other.sigma_z_m)
                and np.array_equal(self.sigma_xy_m, other.sigma_xy_m))

    def __hash__(self) -> int:
        return hash((np.asarray(self.sigma_z_m).tobytes(), np.asarray(self.sigma_xy_m).tobytes()))


def horizon_sigma_deg(horizon: HorizonProfile, model: TerrainErrorModel) -> np.ndarray:
    """1-sigma horizon elevation error per azimuth sample (degrees); see module doc for the formula.

    Per-azimuth budgets in `model` are applied element-wise; their length must equal the horizon's.
    """
    elev = np.asarray(horizon.elev_deg, dtype=np.float64)
    d = np.asarray(horizon.blocker_dist_m, dtype=np.float64)
    if np.any(~(d > 0.0)):
        raise ValueError("blocker_dist_m must be positive and finite for every azimuth")
    n = elev.size
    sz, sxy = model.for_azimuths(n)
    step = 360.0 / n
    grad = (np.roll(elev, -1) - np.roll(elev, 1)) / (2.0 * step)
    h = np.radians(elev)
    vert = sz * np.cos(h) ** 2 / d
    across = grad * sxy / d
    along = sxy * np.sin(h) * np.cos(h) / d
    return np.degrees(np.sqrt(vert**2 + across**2 + along**2))


def widen_horizon(horizon: HorizonProfile, model: TerrainErrorModel, k_sigma: float = 2.0) -> HorizonProfile:
    """Horizon with its lo/hi bracket widened by `k_sigma` terrain-error sigmas on each side."""
    if k_sigma < 0.0:
        raise ValueError("k_sigma must be non-negative")
    sig = horizon_sigma_deg(horizon, model)
    prov = dict(horizon.provenance)
    ranges = model.ranges()
    entry: dict = {}
    if not model.per_azimuth:
        entry["sigma_z_m"] = float(model.sigma_z_m)
        entry["sigma_xy_m"] = float(model.sigma_xy_m)
    entry.update(ranges)
    entry["per_azimuth"] = model.per_azimuth
    entry["k_sigma"] = k_sigma
    prov["terrain_error_widening"] = entry
    return replace(
        horizon,
        elev_lo_deg=np.asarray(horizon.elev_lo_deg) - k_sigma * sig,
        elev_hi_deg=np.asarray(horizon.elev_hi_deg) + k_sigma * sig,
        provenance=prov,
    )


@dataclass(frozen=True, slots=True)
class EdgeTimeUncertainty:
    """Nominal clearance crossings with their 1-sigma time uncertainty from terrain error."""

    time: np.ndarray
    rising: np.ndarray
    sigma_s: np.ndarray
    clearance_rate_deg_s: np.ndarray


def edge_time_uncertainty(
    track: TargetTrack, horizon: HorizonProfile, model: TerrainErrorModel, margin_deg: float = 0.0,
    method: Method = "hermite",
) -> EdgeTimeUncertainty:
    """1-sigma time error of each point-target rise/set edge: `sigma_h / |d clearance / dt|`."""
    grid = horizon_grid(horizon, "nominal")
    t = np.asarray(track.et, dtype=np.float64)
    clr = point_clearance(track.az_deg, track.el_deg, grid, margin_deg)
    times, rising = crossing_times(t, clr, 0.0, method=method)
    sig_grid = horizon_sigma_deg(horizon, model)
    rate = np.gradient(clr, t)
    az_at = np.interp(times, t, np.unwrap(np.radians(track.az_deg)))
    az_deg = np.degrees(az_at) % 360.0
    s_h = horizon_elevation_at(az_deg, sig_grid)
    r = np.abs(np.interp(times, t, rate))
    with np.errstate(divide="ignore"):
        sigma_t = np.where(r > 0.0, s_h / r, np.inf)
    return EdgeTimeUncertainty(times, rising, sigma_t, r)


def disc_window_edge_ranges(
    track: TargetTrack, horizon: HorizonProfile, model: TerrainErrorModel, *, k_sigma: float = 2.0,
    flux_threshold: float = 0.5, limb: LimbDarkening | None = None, method: Method = "linear",
) -> list[UncertainWindow]:
    """Sunlit windows (flux fraction > threshold) with edge ranges from terrain-error-widened horizons.

    The optimistic/pessimistic signals use the brackets of `widen_horizon(horizon, model, k_sigma)`.
    """
    wide = widen_horizon(horizon, model, k_sigma)
    sigs = []
    for bound in ("nominal", "optimistic", "pessimistic"):
        _, f = disc_fraction(track.az_deg, track.el_deg, track.ang_radius_deg,
                             horizon_grid(wide, bound), limb)
        sigs.append(f)
    return bounded_windows(np.asarray(track.et, dtype=np.float64), sigs[0], sigs[1], sigs[2],
                           flux_threshold, method=method)
