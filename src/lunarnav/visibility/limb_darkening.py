"""Solar limb-darkening law used to weight the visible part of the solar disc.

Law: Hestroffer & Magnan (1998), A&A 333, 338-342, their Eq. (1) with u = 1,

    I(mu) / I(1) = mu ** alpha,        mu = cos(theta) = sqrt(1 - (r/R)^2).

The paper tabulates alpha(lambda) fitted to the Pierce & Slaughter (1977) and Neckel & Labs (1994) solar
data (its Table 2; 303-2402 nm). Sunlight is a spectrum-weighted sum of such profiles, so the default is the
single exponent that best reproduces the flat-horizon flux fraction of the ASTM G173-03 extraterrestrial
spectrum weighted over 303-2402 nm (96.4 % of the irradiance): alpha = 0.3946 (rounded to 0.39), worst
flux-fraction misfit 1.2e-4. The derivation (`limb_spectrum.effective_alpha`)
and the sensitivity to other choices (uniform disc, 550 nm, silicon band, band edges) are in
docs/validation/visibility.md section 1.4. Other laws: pass `LimbDarkening(alpha)`.

The disc-integrated flux relative to disc-centre intensity times disc area is 2 / (alpha + 2).
"""

from __future__ import annotations

from dataclasses import dataclass

DEFAULT_ALPHA = 0.39
"""Irradiance-weighted effective exponent over 303-2402 nm (0.3946 fitted, rounded); see module doc."""


@dataclass(frozen=True, slots=True)
class LimbDarkening:
    """Power-law limb darkening `I(mu) = mu ** alpha`. `alpha = 0` is a uniformly bright disc."""

    alpha: float = DEFAULT_ALPHA

    def __post_init__(self) -> None:
        if not 0.0 <= self.alpha <= 4.0:
            raise ValueError("limb-darkening exponent alpha must lie in [0, 4]")

    def intensity(self, mu: float) -> float:
        """Intensity relative to disc centre at emergence-angle cosine `mu` (0..1)."""
        return mu**self.alpha

    @property
    def disc_mean(self) -> float:
        """Disc-averaged intensity relative to disc-centre intensity, 2 / (alpha + 2)."""
        return 2.0 / (self.alpha + 2.0)


UNIFORM = LimbDarkening(0.0)
"""Uniform disc: flux fraction equals area fraction."""
