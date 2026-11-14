"""Named illumination and Earth-visibility definitions over a sampled period.

Published studies and planners use different quantities under the same word "illumination". This module
computes all of them from one set of tracks and one horizon so comparisons are like with like. Every
statistic carries its definition in its name; nothing is called just "illumination".

Sun (`SunIllumination`):

- `average_illumination`: time-mean visible *area* fraction of the extended solar disc (the quantity of
  Mazarico et al. 2011, Glaeser et al. 2014/2018 "average illumination"; uniform disc).
- `average_illumination_flux`: time-mean visible *flux* fraction with limb darkening (the engine's
  `terrain_flux`; this is what powers an array).
- Sunlit definitions (each with its sunlit fraction and its longest continuous light and shadow):
  `any_part` (some of the disc is visible: Glaeser "sunlit"/"solar visibility", Barker LCIP/LCSP, the ESA
  tool), `centre` (the disc centre is above the horizon: a point-Sun tool such as STK), `half_flux` (the
  limb-darkened flux fraction exceeds `sunlit_threshold`, default 0.5: the engine's verdict definition),
  and `half_flux_with_earth_eclipse` (the same on `flux * (1 - Earth-eclipse fraction)`: what reaches the
  array).
- Optional "quasi-continuous" filter (`SpanFilter`), as used by the ESA lander study (De Rosa et al. 2012,
  Planet. Space Sci. 74: darkness under 60 h and illumination under 10 h are filtered out): lit spans
  shorter than `min_light_span_h` are first counted as dark, then dark gaps shorter than `max_dark_gap_h`
  between lit spans are counted as lit. The order is our reading, the source does not state it. The
  filtered longest light is reported next to the raw one; the filtered longest shadow ignores lit spans
  shorter than `min_light_span_h`.

Earth (`EarthVisibility`): for each minimum-elevation mask (the effective horizon is the larger of the
terrain horizon and the mask), the visible fraction with `any_part`, `centre` and `full_disc` of the
Earth, with the longest visibility and the longest outage.

Spans are run lengths of the boolean state on the sample grid (the convention of the studies: consecutive
time steps times the step), so a span is uncertain by one sample step; spans that touch the start or end of
the period are flagged `censored` (they are lower bounds). Periods must be regularly sampled.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

import numpy as np

from lunarnav.ephem import EARTH_MEAN_RADIUS_KM
from lunarnav.visibility import LimbDarkening, disc_fraction, horizon_elevation_at, horizon_grid

from .provenance import OUR_DEFINITIONS

HOUR_S = 3600.0
FULL_DISC_TOL = 1.0e-9
SUN_DEFINITIONS: tuple[str, ...] = ("any_part", "centre", "half_flux", "half_flux_with_earth_eclipse")
EARTH_DEFINITIONS: tuple[str, ...] = ("any_part", "centre", "full_disc")

DEFINITION_TEXT: dict[str, str] = {
    "any_part": "some part of the disc is above the horizon (area fraction > 0)",
    "centre": "the disc centre is above the horizon",
    "half_flux": "limb-darkened visible flux fraction above the sunlit threshold (terrain only)",
    "half_flux_with_earth_eclipse": "as half_flux on flux * (1 - Earth-eclipse fraction)",
    "full_disc": "the whole disc is above the horizon (area fraction = 1)",
}


@dataclass(frozen=True, slots=True)
class SpanFilter:
    """Quasi-continuous filter (see module doc). Durations in hours; None disables a step."""

    max_dark_gap_h: float | None = None
    min_light_span_h: float | None = None

    @property
    def active(self) -> bool:
        return self.max_dark_gap_h is not None or self.min_light_span_h is not None

    def to_dict(self) -> dict:
        return {"max_dark_gap_h": self.max_dark_gap_h, "min_light_span_h": self.min_light_span_h}


ESA_QUASI_CONTINUOUS = SpanFilter(max_dark_gap_h=60.0, min_light_span_h=10.0)
"""De Rosa et al. 2012 (Planet. Space Sci. 74, 224-246), LQCIP at 2 m: darkness under 60 h and
illumination under 10 h filtered out. Source: https://arxiv.org/pdf/1208.5587 (see docs/research/literature.md)."""

NO_SPAN_FILTER = SpanFilter()
"""Default span filter: both steps disabled (shared instance; `SpanFilter` is frozen)."""


@dataclass(frozen=True, slots=True)
class SpanStat:
    """Longest run of a state: hours, start/end sample epochs (ET), run count and censoring."""

    longest_h: float
    start_et: float
    end_et: float
    n_spans: int
    censored: bool

    def to_dict(self) -> dict:
        return {"longest_h": self.longest_h, "start_et": self.start_et, "end_et": self.end_et,
                "n_spans": self.n_spans, "censored": self.censored}


@dataclass(frozen=True, slots=True)
class DefinitionStats:
    """Statistics of one sunlit/visible definition."""

    definition: str
    fraction: float
    """Fraction of samples in the state."""
    longest_light: SpanStat
    longest_shadow: SpanStat
    longest_light_filtered: SpanStat | None = None
    longest_shadow_filtered: SpanStat | None = None

    def to_dict(self) -> dict:
        return {
            "definition": self.definition, "meaning": DEFINITION_TEXT[self.definition], "fraction": self.fraction,
            "longest_light": self.longest_light.to_dict(), "longest_shadow": self.longest_shadow.to_dict(),
            "longest_light_filtered": None if self.longest_light_filtered is None else self.longest_light_filtered.to_dict(),
            "longest_shadow_filtered": None if self.longest_shadow_filtered is None else self.longest_shadow_filtered.to_dict()}


@dataclass(frozen=True, slots=True)
class SunIllumination:
    """All Sun illumination definitions over one sampled period."""

    n_samples: int
    step_s: float
    start_et: float
    end_et: float
    average_illumination: float
    """Time-mean visible area fraction of the uniform solar disc."""
    average_illumination_flux: float
    """Time-mean limb-darkened visible flux fraction."""
    definitions: dict[str, DefinitionStats]
    sunlit_threshold: float
    span_filter: SpanFilter
    horizon_note: str = ""

    def __getitem__(self, definition: str) -> DefinitionStats:
        return self.definitions[definition]

    def to_dict(self) -> dict:
        return {
            "n_samples": self.n_samples, "step_s": self.step_s, "start_et": self.start_et, "end_et": self.end_et,
            "average_illumination": self.average_illumination,
            "average_illumination_flux": self.average_illumination_flux,
            "sunlit_threshold": self.sunlit_threshold, "span_filter": self.span_filter.to_dict(),
            "definitions": {k: v.to_dict() for k, v in self.definitions.items()}, "horizon_note": self.horizon_note,
            "our_definitions": {"quasi_continuous_filter_order": OUR_DEFINITIONS["quasi_continuous_filter_order"]}}


@dataclass(frozen=True, slots=True)
class EarthVisibility:
    """Earth visibility per minimum-elevation mask: `by_mask[mask_deg][definition]`."""

    n_samples: int
    step_s: float
    start_et: float
    end_et: float
    by_mask: dict[float, dict[str, DefinitionStats]]
    span_filter: SpanFilter = field(default_factory=SpanFilter)

    def to_dict(self) -> dict:
        return {"n_samples": self.n_samples, "step_s": self.step_s, "start_et": self.start_et, "end_et": self.end_et,
                "span_filter": self.span_filter.to_dict(),
                "by_mask": {f"{m:g}": {k: v.to_dict() for k, v in d.items()} for m, d in self.by_mask.items()}}


def runs(mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Start (inclusive) and end (exclusive) sample indices of the True runs of a boolean array."""
    m = np.concatenate([[False], np.asarray(mask, dtype=bool), [False]])
    d = np.diff(m.astype(np.int8))
    return np.flatnonzero(d == 1), np.flatnonzero(d == -1)


def filter_lit(mask: np.ndarray, step_s: float, span_filter: SpanFilter) -> np.ndarray:
    """Apply the quasi-continuous filter to a lit mask: drop short lit spans, then fill short interior dark gaps."""
    out = np.asarray(mask, dtype=bool).copy()
    if span_filter.min_light_span_h is not None:
        s, e = runs(out)
        for a, b in zip(s, e):
            if (b - a) * step_s / HOUR_S < span_filter.min_light_span_h:
                out[a:b] = False
    if span_filter.max_dark_gap_h is not None:
        s, e = runs(~out)
        for a, b in zip(s, e):
            if a > 0 and b < out.size and (b - a) * step_s / HOUR_S < span_filter.max_dark_gap_h:
                out[a:b] = True
    return out


def longest_span(mask: np.ndarray, et: np.ndarray, step_s: float) -> SpanStat:
    """Longest True run of `mask` on the sample grid `et` (hours = samples x step)."""
    s, e = runs(mask)
    if s.size == 0:
        return SpanStat(0.0, float("nan"), float("nan"), 0, False)
    k = int(np.argmax(e - s))
    n = mask.size
    return SpanStat(float((e[k] - s[k]) * step_s / HOUR_S), float(et[s[k]]), float(et[e[k] - 1]), int(s.size),
                    bool(s[k] == 0 or e[k] == n))


def _definition_stats(
    name: str, lit: np.ndarray, et: np.ndarray, step_s: float, span_filter: SpanFilter,
) -> DefinitionStats:
    filt_light = filt_shadow = None
    if span_filter.active:
        keep = filter_lit(lit, step_s, span_filter)
        filt_light = longest_span(keep, et, step_s)
        only_short_light = filter_lit(lit, step_s, SpanFilter(None, span_filter.min_light_span_h))
        filt_shadow = longest_span(~only_short_light, et, step_s)
    return DefinitionStats(name, float(lit.mean()), longest_span(lit, et, step_s), longest_span(~lit, et, step_s),
                           filt_light, filt_shadow)


def _regular_step(et: np.ndarray) -> float:
    et = np.asarray(et, dtype=np.float64)
    if et.ndim != 1 or et.size < 2:
        raise ValueError("illumination statistics need at least two regularly sampled epochs")
    d = np.diff(et)
    step = float(np.median(d))
    if step <= 0.0 or np.max(np.abs(d - step)) > 1.0e-3 * step + 1.0e-6:
        raise ValueError("illumination statistics need a regular sampling grid")
    return step


def sun_illumination(
    et: np.ndarray, sun_az_deg: np.ndarray, sun_el_deg: np.ndarray, sun_ang_radius_deg: np.ndarray | float,
    horizon_deg: np.ndarray, *, eclipse: np.ndarray | None = None, limb: LimbDarkening | None = None,
    sunlit_threshold: float = 0.5, span_filter: SpanFilter = NO_SPAN_FILTER, horizon_note: str = "",
) -> SunIllumination:
    """Every Sun illumination definition for a Sun track above a horizon grid (uniform in azimuth, degrees).

    `eclipse` is the Earth-eclipse fraction per sample (0..1); without it the `half_flux_with_earth_eclipse`
    definition equals `half_flux`.
    """
    et = np.asarray(et, dtype=np.float64)
    step = _regular_step(et)
    az = np.asarray(sun_az_deg, dtype=np.float64)
    el = np.asarray(sun_el_deg, dtype=np.float64)
    area, flux = disc_fraction(az, el, sun_ang_radius_deg, np.asarray(horizon_deg, dtype=np.float64), limb)
    centre = el - horizon_elevation_at(az, np.asarray(horizon_deg, dtype=np.float64)) > 0.0
    ecl = np.zeros_like(flux) if eclipse is None else np.asarray(eclipse, dtype=np.float64)
    states = {"any_part": area > 0.0, "centre": centre, "half_flux": flux > sunlit_threshold,
              "half_flux_with_earth_eclipse": flux * (1.0 - ecl) > sunlit_threshold}
    return SunIllumination(
        et.size, step, float(et[0]), float(et[-1]), float(area.mean()), float(flux.mean()),
        {k: _definition_stats(k, v, et, step, span_filter) for k, v in states.items()}, float(sunlit_threshold),
        span_filter, horizon_note)


def earth_visibility(
    et: np.ndarray, earth_az_deg: np.ndarray, earth_el_deg: np.ndarray, earth_ang_radius_deg: np.ndarray | float,
    horizon_deg: np.ndarray, *, masks_deg: Sequence[float] = (0.0,), span_filter: SpanFilter = NO_SPAN_FILTER,
) -> EarthVisibility:
    """Earth visibility with `any_part`, `centre` and `full_disc` definitions for each elevation mask.

    The effective horizon for a mask is `max(horizon, mask)` at every azimuth; the visible fractions are
    those of the Earth disc (angular radius `earth_ang_radius_deg`, uniform brightness) above it.
    """
    et = np.asarray(et, dtype=np.float64)
    step = _regular_step(et)
    az = np.asarray(earth_az_deg, dtype=np.float64)
    el = np.asarray(earth_el_deg, dtype=np.float64)
    grid0 = np.asarray(horizon_deg, dtype=np.float64)
    out: dict[float, dict[str, DefinitionStats]] = {}
    for mask in masks_deg:
        grid = np.maximum(grid0, float(mask))
        area, _ = disc_fraction(az, el, earth_ang_radius_deg, grid, None, flux=False)
        centre = el - horizon_elevation_at(az, grid) > 0.0
        states = {"any_part": area > 0.0, "centre": centre, "full_disc": area >= 1.0 - FULL_DISC_TOL}
        out[float(mask)] = {k: _definition_stats(k, v, et, step, span_filter) for k, v in states.items()}
    return EarthVisibility(et.size, step, float(et[0]), float(et[-1]), out, span_filter)


def evaluation_illumination(
    evaluation, *, window: str = "mission", span_filter: SpanFilter = NO_SPAN_FILTER,
    earth_masks_deg: Sequence[float] = (0.0,), limb: LimbDarkening | None = None,
) -> tuple[SunIllumination, EarthVisibility]:
    """Illumination and Earth visibility of a `SiteEvaluation` over its mission window or the whole analysis span.

    `window="mission"` uses landing to landing + duration; `"analysis"` uses every table epoch (including
    the look-back before landing).
    """
    sig = evaluation.signals
    t = sig.et
    if window == "mission":
        sel = (t >= evaluation.t_land_et - 1e-6) & (t <= evaluation.t_land_et + evaluation.mission_s + 1e-6)
    elif window == "analysis":
        sel = np.ones(t.size, dtype=bool)
    else:
        raise ValueError("window must be 'mission' or 'analysis'")
    thr = evaluation.scenario.constraints.sunlit_flux_fraction.value
    sun = sun_illumination(
        t[sel], sig.sun_az_deg[sel], sig.sun_el_deg[sel], sig.sun_ang_radius_deg[sel],
        horizon_grid(sig.array_horizon, "nominal"), eclipse=sig.eclipse[sel], limb=limb, sunlit_threshold=thr,
        span_filter=span_filter, horizon_note=f"array horizon at mast height {sig.array_horizon.site.mast_height_m:g} m")
    earth_radius_deg = np.degrees(np.arcsin(EARTH_MEAN_RADIUS_KM / sig.earth_range_km))
    earth = earth_visibility(
        t[sel], sig.earth_az_deg[sel], sig.earth_el_deg[sel], earth_radius_deg[sel],
        horizon_grid(sig.antenna_horizon, "nominal"), masks_deg=earth_masks_deg, span_filter=span_filter)
    return sun, earth
