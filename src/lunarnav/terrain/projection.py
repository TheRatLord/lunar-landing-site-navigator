"""Map projections and pixel registration for terrain stores.

Two grid kinds are supported, both on the LOLA reference sphere (R = 1 737 400 m):

``polar_stereographic``
    Spherical polar stereographic centred on a pole (``pole = +1`` north, ``-1`` south), true scale
    at the pole.  With ``rho = 2 R tan((90 deg - pole*lat)/2)`` the map coordinates are::

        x = rho * sin(lon)
        y = -pole * rho * cos(lon)

    so in the south longitude 0 points towards +y and 90 E towards +x (the PROJ/GeoTIFF convention
    of the PGDA mosaics); in the north longitude 0 points towards -y (the LOLA PDS convention).

``equirectangular``
    Plate carree in degrees: ``x`` = east longitude, ``y`` = planetocentric latitude.

Pixels are addressed by continuous ``(row, col)`` where integer values are pixel *centres*
(pixel-centre registration): ``x = x0 + col*dx`` and ``y = y0 + row*dy`` (``dy`` is usually
negative for north-up rasters).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

from lunarnav.constants import R_MOON_M

POLAR = "polar_stereographic"
EQUIRECT = "equirectangular"


@dataclass(frozen=True, slots=True)
class GridGeometry:
    """Pixel grid in a map projection. All fields are persisted in a store's ``meta.json``."""

    kind: str
    pole: int
    radius_m: float
    x0: float
    y0: float
    dx: float
    dy: float
    ncols: int
    nrows: int
    periodic: bool = False

    def __post_init__(self) -> None:
        if self.kind not in (POLAR, EQUIRECT):
            raise ValueError(f"unknown projection kind {self.kind!r}")
        if self.kind == POLAR and self.pole not in (-1, 1):
            raise ValueError("polar grids need pole = +1 or -1")
        if self.periodic and self.kind != EQUIRECT:
            raise ValueError("only equirectangular grids can be periodic in x")

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> GridGeometry:
        return cls(**d)

    def lonlat_to_xy(self, lat_deg, lon_deg):
        """Planetocentric degrees -> map coordinates (metres for polar, degrees for equirect)."""
        lat = np.asarray(lat_deg, dtype=np.float64)
        lon = np.asarray(lon_deg, dtype=np.float64)
        if self.kind == POLAR:
            return polar_forward(lat, lon, self.pole, self.radius_m)
        x = self.x0 + np.mod(lon - self.x0, 360.0)
        return x, lat

    def xy_to_lonlat(self, x, y):
        """Map coordinates -> ``(lat_deg, lon_deg)`` with longitude in ``[0, 360)``."""
        x = np.asarray(x, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64)
        if self.kind == POLAR:
            return polar_inverse(x, y, self.pole, self.radius_m)
        return y, np.mod(x, 360.0)

    def xy_to_rc(self, x, y):
        """Map coordinates -> continuous ``(row, col)``."""
        x = np.asarray(x, dtype=np.float64)
        col = (x - self.x0) / self.dx
        if self.periodic:
            col = np.mod(col, self.ncols)
        return (np.asarray(y, dtype=np.float64) - self.y0) / self.dy, col

    def rc_to_xy(self, row, col):
        """Continuous ``(row, col)`` -> map coordinates."""
        return self.x0 + np.asarray(col, dtype=np.float64) * self.dx, self.y0 + np.asarray(row, dtype=np.float64) * self.dy

    def lonlat_to_rc(self, lat_deg, lon_deg):
        """Planetocentric degrees -> continuous ``(row, col)``."""
        x, y = self.lonlat_to_xy(lat_deg, lon_deg)
        return self.xy_to_rc(x, y)

    def rc_to_lonlat(self, row, col):
        """Continuous ``(row, col)`` -> ``(lat_deg, lon_deg)``."""
        x, y = self.rc_to_xy(row, col)
        return self.xy_to_lonlat(x, y)

    def contains_rc(self, row, col):
        """True where a bilinear sample at ``(row, col)`` has all four neighbours inside the grid."""
        row = np.asarray(row)
        col = np.asarray(col)
        ok_r = (row >= 0) & (row <= self.nrows - 1)
        ok_c = np.ones_like(ok_r) if self.periodic else (col >= 0) & (col <= self.ncols - 1)
        return ok_r & ok_c

    def kernel_params(self) -> np.ndarray:
        """Float64 parameter vector consumed by the Numba kernels (see ``_kernels.P_*``)."""
        return np.array(
            [
                0.0 if self.kind == POLAR else 1.0,
                float(self.pole),
                self.radius_m,
                self.x0,
                self.y0,
                self.dx,
                self.dy,
                float(self.ncols),
                float(self.nrows),
                1.0 if self.periodic else 0.0,
            ]
        )


def polar_forward(lat_deg, lon_deg, pole: int, radius_m: float = R_MOON_M):
    """Latitude/longitude (degrees) -> polar stereographic ``(x, y)`` in metres (see module doc)."""
    lat = np.radians(np.asarray(lat_deg, dtype=np.float64))
    lon = np.radians(np.asarray(lon_deg, dtype=np.float64))
    rho = 2.0 * radius_m * np.tan((np.pi / 2.0 - pole * lat) / 2.0)
    return rho * np.sin(lon), -pole * rho * np.cos(lon)


def polar_inverse(x, y, pole: int, radius_m: float = R_MOON_M):
    """Polar stereographic ``(x, y)`` in metres -> ``(lat_deg, lon_deg)``, longitude in ``[0, 360)``."""
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    rho = np.hypot(x, y)
    colat = 2.0 * np.arctan(rho / (2.0 * radius_m))
    lat = pole * (90.0 - np.degrees(colat))
    lon = np.mod(np.degrees(np.arctan2(x, -pole * y)), 360.0)
    return lat, lon


def polar_scale_factor(lat_deg, pole: int):
    """Map-to-ground length factor ``k = 1/cos^2(c/2)`` (c = angular distance from the pole)."""
    c = np.pi / 2.0 - pole * np.radians(np.asarray(lat_deg, dtype=np.float64))
    return 1.0 / np.cos(c / 2.0) ** 2
