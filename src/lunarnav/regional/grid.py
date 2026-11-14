"""Region specification and the polar-stereographic cell grid.

Cells are on the LOLA polar stereographic grid of the terrain stores (sphere of 1 737.4 km, true scale at the
pole, ``x = rho sin(lon)``, ``y = -pole rho cos(lon)``).  Row 0 is the northernmost row (largest ``y``) so a
layer is a north-up raster; cell *centres* are at ``x0 + col * spacing`` and ``y0 - row * spacing``
(pixel-centre registration, the convention of the stores and the LOLA rasters).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import UTC, datetime

import numpy as np

from lunarnav.constants import R_MOON_M
from lunarnav.terrain.projection import polar_forward, polar_inverse

PROJ4 = {
    -1: "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs",
    1: "+proj=stere +lat_0=90 +lat_ts=90 +lon_0=0 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs",
}


def _iso(utc: str) -> str:
    """Normalise an ISO-8601 UTC string to ``YYYY-MM-DDTHH:MM:SSZ`` (naive input is taken as UTC)."""
    t = datetime.fromisoformat(utc.replace("Z", "+00:00"))
    t = t.replace(tzinfo=UTC) if t.tzinfo is None else t.astimezone(UTC)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass(frozen=True, slots=True)
class RegionSpec:
    """A region (cell grid), an observer height and an analysis period.

    ``x0_m, y0_m`` are the polar-stereographic coordinates of the centre of cell ``(row 0, col 0)``;
    ``n_rows x n_cols`` cells of ``spacing_m`` (map metres).  Epochs are ``start + k * step_s`` for
    ``k = 0 .. floor((stop - start) / step_s)``.  ``sun_rule``: ``"any_part"`` (sunlit when any part of the disc
    is visible, the definition of the LOLA ``AVGVISIB`` rasters) or ``"half_flux"`` (limb-darkened flux
    fraction of at least 1/2, the planner convention of ``lunarnav.scenario``).  ``earth_rule``: ``"centre"`` or
    ``"any_part"`` (disc of mean radius 6371 km; the definition of the ``_EARTH`` rasters).
    """

    x0_m: float
    y0_m: float
    n_rows: int
    n_cols: int
    spacing_m: float
    start_utc: str
    stop_utc: str
    step_s: float = 3600.0
    mast_height_m: float = 0.0
    pole: int = -1
    sun_rule: str = "any_part"
    earth_rule: str = "any_part"
    earth_margin_deg: float = 0.0
    limb_alpha: float = 0.39
    dem_ids: tuple[str, ...] | None = None
    name: str = ""

    def __post_init__(self) -> None:
        if self.pole not in (-1, 1):
            raise ValueError("pole must be -1 or +1")
        if self.n_rows < 1 or self.n_cols < 1 or self.spacing_m <= 0 or self.step_s <= 0:
            raise ValueError("region needs positive size, spacing and step")
        if self.sun_rule not in ("any_part", "half_flux") or self.earth_rule not in ("centre", "any_part"):
            raise ValueError("unknown sun_rule or earth_rule")
        object.__setattr__(self, "start_utc", _iso(self.start_utc))
        object.__setattr__(self, "stop_utc", _iso(self.stop_utc))

    @classmethod
    def centred(cls, lat_deg: float, lon_deg: float, size_m: float, spacing_m: float, start_utc: str, stop_utc: str,
                *, snap_half: bool = False, **kw) -> RegionSpec:
        """Square region of about ``size_m`` centred on a point; cell centres lie on multiples of ``spacing_m``
        (or of ``spacing_m`` offset by half a cell with ``snap_half``, like the 60 m LOLA rasters)."""
        pole = -1 if lat_deg < 0 else 1
        cx, cy = polar_forward(lat_deg, lon_deg, pole)
        n = int(round(size_m / spacing_m))
        off = 0.5 if snap_half else 0.0
        x0 = (round(float(cx) / spacing_m - off - (n - 1) / 2.0) + off) * spacing_m
        ytop = (round(float(cy) / spacing_m - off + (n - 1) / 2.0) + off) * spacing_m
        return cls(x0, ytop, n, n, spacing_m, start_utc, stop_utc, pole=pole, **kw)

    def window(self, row0: int, row1: int, col0: int, col1: int) -> RegionSpec:
        """Sub-region of cells ``[row0, row1) x [col0, col1)`` (same grid lines, same observer and period)."""
        from dataclasses import replace

        return replace(self, x0_m=self.x0_m + col0 * self.spacing_m, y0_m=self.y0_m - row0 * self.spacing_m,
                       n_rows=row1 - row0, n_cols=col1 - col0)

    @property
    def shape(self) -> tuple[int, int]:
        return self.n_rows, self.n_cols

    @property
    def n_cells(self) -> int:
        return self.n_rows * self.n_cols

    @property
    def n_epochs(self) -> int:
        a, b = np.datetime64(self.start_utc[:-1]), np.datetime64(self.stop_utc[:-1])
        return int(np.floor(float((b - a) / np.timedelta64(1, "s")) / self.step_s)) + 1

    def xy(self, rows, cols):
        """Map coordinates (m) of cell centres."""
        return self.x0_m + np.asarray(cols, dtype=np.float64) * self.spacing_m, \
            self.y0_m - np.asarray(rows, dtype=np.float64) * self.spacing_m

    def lonlat(self, rows, cols):
        """Planetocentric latitude and east longitude (degrees, ME, longitude in [0, 360)) of cell centres."""
        x, y = self.xy(rows, cols)
        return polar_inverse(x, y, self.pole)

    def geotransform(self) -> tuple[float, float, float, float, float, float]:
        """GDAL geotransform of the north-up raster (top-left pixel *corner*)."""
        h = 0.5 * self.spacing_m
        return (self.x0_m - h, self.spacing_m, 0.0, self.y0_m + h, 0.0, -self.spacing_m)

    def scale_factor(self) -> float:
        """Map-to-ground length factor at the region centre, ``1 / cos^2(c / 2)``."""
        x, y = self.xy((self.n_rows - 1) / 2.0, (self.n_cols - 1) / 2.0)
        rho = math.hypot(float(x), float(y))
        return 1.0 + (rho / (2.0 * R_MOON_M)) ** 2

    def meridian_gamma_deg(self, lon_deg):
        """Grid azimuth minus true azimuth (deg) at a longitude: ``+lon`` for the south pole, ``-lon`` north."""
        return -self.pole * np.asarray(lon_deg, dtype=np.float64)


@dataclass(frozen=True, slots=True)
class Method:
    """Numerical parameters of the regional horizon method (their effect is measured in the validation report).

    ``strides``: node strides (cells) of the tiers; tier ``t`` covers cell distances ``[q m_t, q m_(t+1))`` where
    ``m_t = 1.5 stride_t spacing`` is the largest node-to-cell distance of its bilinear footprint, and the
    nearest tier is evaluated per cell.  ``kappa``: ladder step ``max(floor, d / kappa)``.  ``floor_m``: the
    smallest ladder step (default: a quarter of the finest terrain pixel in use).  ``n_az``: horizon azimuths (uniform, 360 / n_az deg).
    ``tile``: cells per tile side.  ``n_radii``: observer radii per node.
    """

    n_az: int = 360
    kappa: float = 64.0
    q: float = 24.0
    strides: tuple[int, ...] = (1, 4, 16, 64)
    floor_m: float | None = None
    tile: int = 128
    n_radii: int = 3
    max_range_km: float | None = None
    extra: dict = field(default_factory=dict, compare=False)
