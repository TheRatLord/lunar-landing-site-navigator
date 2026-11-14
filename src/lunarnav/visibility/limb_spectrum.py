"""Spectral limb darkening: wavelength-dependent exponents and a band-effective single exponent.

Data: Hestroffer & Magnan (1998), A&A 333, 338-342, their Table 2 (transcribed from the paper): the power-law
exponent alpha(lambda) of I(mu)/I(1) = mu**alpha fitted to the Pierce & Slaughter (1977, "PS") and Pierce,
Slaughter & Weinberger (1977, "PSW") polynomial coefficients (303-2402 nm), and to the Neckel & Labs (1994,
"NL") coefficients (303-1099 nm). Those polynomials were derived from the solar observations by the original
authors; this module uses only the exponents tabulated in HM98.

The sunlight reaching a panel is a spectrum-weighted sum of such profiles, which is not itself a power law.
`effective_alpha` returns the single exponent whose flat-horizon flux-fraction curve is closest (minimax) to the
spectrum-weighted curve, together with the residual of that approximation.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from scipy.optimize import minimize_scalar
from scipy.special import beta as beta_fn

_PS = """303.327 0.967 306.982 0.942 310.843 0.904 320.468 0.867 329.897 0.816 338.953 0.779 349.949 0.753
356.352 0.749 362.650 0.714 365.875 0.684 374.088 0.751 377.992 0.739 385.202 0.808 390.928 0.790 395.425 0.782
398.815 0.744 401.970 0.741 406.944 0.731 411.723 0.693 416.320 0.712 421.905 0.705 427.930 0.670 431.645 0.643
443.885 0.652 445.125 0.648 454.355 0.633 456.792 0.620 457.345 0.631 461.510 0.614 468.306 0.600 471.900 0.582
477.435 0.588 481.157 0.580 483.075 0.569 490.560 0.575 492.905 0.569 498.090 0.573 503.800 0.554 510.210 0.539
519.930 0.529 526.535 0.542 533.460 0.522 541.760 0.511 552.200 0.503 559.950 0.502 569.560 0.482 579.880 0.473
587.430 0.465 601.015 0.464 610.975 0.452 620.590 0.434 632.600 0.429 640.970 0.420 649.250 0.413 660.400 0.401
669.400 0.396 679.140 0.397 691.600 0.388 700.875 0.383 710.425 0.368 719.925 0.375 729.675 0.372"""

_PSW = """740.460 0.359 748.710 0.348 770.820 0.342 789.900 0.324 811.760 0.325 828.410 0.315 847.510 0.307
869.600 0.303 903.380 0.284 948.850 0.280 997.920 0.270 1046.700 0.262 1098.950 0.246 1158.350 0.242
1197.750 0.231 1251.500 0.220 1299.000 0.219 1307.400 0.194 1338.100 0.208 1339.400 0.194 1402.000 0.196
1430.100 0.163 1457.900 0.183 1493.100 0.166 1500.100 0.172 1564.200 0.146 1580.300 0.165 1595.100 0.143
1622.200 0.162 1642.000 0.137 1659.800 0.154 1670.000 0.145 1686.000 0.126 1695.700 0.138 1704.300 0.151
1719.800 0.155 1748.300 0.146 1789.100 0.136 1798.400 0.150 1813.800 0.134 1894.500 0.146 1925.000 0.151
1969.200 0.125 2022.000 0.132 2100.200 0.136 2185.500 0.133 2216.300 0.127 2312.800 0.127 2401.800 0.123"""

_NL = """303.327 0.939 310.843 0.914 320.468 0.871 329.897 0.817 349.947 0.763 365.875 0.695 374.086 0.750
390.915 0.791 401.970 0.751 416.319 0.724 427.930 0.682 443.885 0.649 445.125 0.646 457.345 0.628 477.427 0.594
492.905 0.570 519.930 0.538 541.760 0.514 559.950 0.496 579.880 0.477 610.975 0.447 640.970 0.428 669.400 0.407
700.875 0.386 748.710 0.361 811.760 0.333 869.600 0.311 948.850 0.292 1046.600 0.274 1098.950 0.260"""


@dataclass(frozen=True, slots=True)
class AlphaTable:
    """Power-law exponents versus wavelength: `wavelength_nm` ascending, `alpha` same length."""

    name: str
    wavelength_nm: NDArray[np.float64]
    alpha: NDArray[np.float64]

    def at(self, wavelength_nm: float | NDArray[np.float64]) -> NDArray[np.float64]:
        """Linear interpolation in wavelength (clamped to the end values outside the table)."""
        return np.interp(wavelength_nm, self.wavelength_nm, self.alpha)


def _table(name: str, *blocks: str) -> AlphaTable:
    values = np.array(" ".join(blocks).split(), dtype=float).reshape(-1, 2)
    return AlphaTable(name, values[:, 0], values[:, 1])


HM98_PS_PSW = _table("HM98 Table 2, PS+PSW", _PS, _PSW)
"""Pierce & Slaughter / Pierce, Slaughter & Weinberger exponents, 303.3-2401.8 nm."""
HM98_NL = _table("HM98 Table 2, NL", _NL)
"""Neckel & Labs exponents, 303.3-1099.0 nm."""


def visible_flux_flat_horizon(alpha: float, height: NDArray[np.float64]) -> NDArray[np.float64]:
    """Fraction of the flux of a `mu**alpha` disc lying above a straight horizon.

    `height` is the horizon-line offset from the disc centre in disc radii (-1..1, positive = line above
    centre, so less of the disc is visible). Exact chord integral: the intensity integrated along a chord at
    height y is proportional to (1 - y^2)^((alpha + 1) / 2); the profile is then integrated over y > height.
    """
    grid = np.linspace(-1.0, 1.0, 4001)
    integrand = (1.0 - grid**2) ** ((alpha + 1.0) / 2.0) * beta_fn(0.5, alpha / 2.0 + 1.0)
    cumulative = np.concatenate(([0.0], np.cumsum(0.5 * (integrand[1:] + integrand[:-1]) * np.diff(grid))))
    return np.asarray(1.0 - np.interp(height, grid, cumulative) / cumulative[-1])


@dataclass(frozen=True, slots=True)
class EffectiveAlpha:
    """Result of `effective_alpha`."""

    alpha: float
    """Single exponent that best reproduces the spectrum-weighted flat-horizon flux fraction."""
    max_flux_error: float
    """Largest |single-exponent flux fraction - spectrum-weighted flux fraction| over the sweep."""
    mean_alpha: float
    """Irradiance-weighted mean of alpha(lambda) over the band (for comparison only)."""
    irradiance_fraction: float
    """Share of the full supplied spectrum's irradiance that lies inside the band and the table range."""
    band_nm: tuple[float, float]
    """Band actually used (requested band clipped to the table range)."""


def effective_alpha(
    table: AlphaTable,
    wavelength_nm: NDArray[np.float64],
    irradiance: NDArray[np.float64],
    band_nm: tuple[float, float],
    response: NDArray[np.float64] | None = None,
) -> EffectiveAlpha:
    """Band-effective power-law exponent for a spectrum `irradiance(wavelength_nm)` and optional `response`.

    Each wavelength contributes its own flux-fraction curve `visible_flux_flat_horizon(alpha(lambda), .)`
    weighted by its share of the band's absorbed irradiance (`irradiance * response * d lambda`); the returned
    exponent minimises the largest deviation from that weighted curve. The spectrum is clipped to `band_nm` and
    to the table's wavelength range; `irradiance_fraction` reports how much of the spectrum that keeps.
    """
    wl = np.asarray(wavelength_nm, dtype=float)
    ir = np.asarray(irradiance, dtype=float)
    lo = max(band_nm[0], float(table.wavelength_nm[0]))
    hi = min(band_nm[1], float(table.wavelength_nm[-1]))
    if hi <= lo:
        raise ValueError("band does not overlap the exponent table")
    keep = (wl >= lo) & (wl <= hi)
    if keep.sum() < 3:
        raise ValueError("spectrum has fewer than 3 samples inside the band")
    w, e = wl[keep], ir[keep]
    if response is not None:
        e = e * np.asarray(response, dtype=float)[keep]
    weight = e * np.gradient(w)
    weight = weight / weight.sum()
    alphas = table.at(w)
    height = np.linspace(-1.0, 1.0, 801)
    target = sum(wi * visible_flux_flat_horizon(ai, height) for wi, ai in zip(weight, alphas, strict=True))

    def worst(a: float) -> float:
        return float(np.max(np.abs(visible_flux_flat_horizon(a, height) - target)))

    res = minimize_scalar(worst, bounds=(0.02, 1.5), method="bounded", options={"xatol": 1e-7})
    total = float(np.trapezoid(ir, wl))
    return EffectiveAlpha(
        alpha=float(res.x),
        max_flux_error=float(res.fun),
        mean_alpha=float(np.sum(weight * alphas)),
        irradiance_fraction=float(np.trapezoid(ir[keep], w) / total),
        band_nm=(float(lo), float(hi)),
    )
