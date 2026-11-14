"""Assumptions, omissions and model limits that apply to one scenario, each tied to its validation report.

Every `LimitNote` names the report file and section it comes from and carries a `quote`: a phrase copied
from that report, so a
statement cannot outlive the evidence it rests on. Which notes apply is decided from the evaluation's own
facts (latitude, terrain store resolution, sampling step, shadow convention, profile estimates), never from
a fixed list.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import cache

from .errors import ReportInputError, need

DOCS = "docs/validation"

ASSUMED = "Assumed"
NOT_MODELLED = "Not modelled"
MODEL_LIMIT = "Model limit at this scenario"
MISS_IMAGES = "Known miss against orbital images"
MISS_PUBLISHED = "Known miss against published values"
MISS_LANDED = "Known miss against landed missions"
MISS_SEARCH = "Known miss against the exhaustive search"
MISS_ORDER = (MISS_IMAGES, MISS_PUBLISHED, MISS_LANDED, MISS_SEARCH)
KINDS = ("assumed", "not_modelled", "model_limit", "known_miss")
KIND_BY_CATEGORY = {
    ASSUMED: "assumed", NOT_MODELLED: "not_modelled", MODEL_LIMIT: "model_limit",
    MISS_IMAGES: "known_miss", MISS_PUBLISHED: "known_miss", MISS_LANDED: "known_miss", MISS_SEARCH: "known_miss",
}
"""The machine-readable kind of each display category; clients group on the kind, never on the category text."""
"""The misses in reading order: what a polar planner most needs first. Every other category keeps its place before them."""


@dataclass(frozen=True, slots=True)
class LimitNote:
    id: str
    """Stable dotted lower-case id, one per concept, never reused: a key of `REGISTRY`."""
    category: str
    text: str
    source: str
    """Report file and section, e.g. `scenario.md section 6`."""
    quote: str
    """Phrase from the report that supports `text`."""
    more: tuple[str, ...] = ()
    """Further phrases that carry the other numbers in `text`."""
    parameters: dict = field(default_factory=dict, kw_only=True)
    """The values `text` quotes from this instance (k sigma, pixel size, step, ...), under stable names; clients print these
    and never parse `text`."""

    @property
    def title(self) -> str:
        """One line for lists: the registry title of `id`."""
        return REGISTRY[self.id].title

    @property
    def kind(self) -> str:
        """`assumed`, `not_modelled`, `model_limit` or `known_miss`: fixed by the category."""
        return KIND_BY_CATEGORY[self.category]

    @property
    def file(self) -> str:
        return f"{DOCS}/{self.source.split()[0]}"


@dataclass(frozen=True, slots=True)
class NoteSpec:
    title: str
    applies: str
    """The engine field or fact the note is selected by."""


REGISTRY: dict[str, NoteSpec] = {
    "events.half_flux": NoteSpec("Sunrise and sunset are half-flux crossings", "always"),
    "terrain.error_budget": NoteSpec("Terrain-error widening of the horizon bracket", "provenance.horizons.{array,antenna}.widened (k_sigma = scenario.terrain_error.k_sigma)"),
    "terrain.error_basis": NoteSpec("Basis of the terrain-error figures", "provenance.horizons.{array,antenna}.widened"),
    "terrain.error_budget_scope": NoteSpec("What the terrain-error budget does not cover", "provenance.site_terrain is not None"),
    "terrain.height_outliers": NoteSpec("Isolated height outliers in the polar terrain stores", "provenance.site_terrain.pixel_m <= 10"),
    "terrain.barker_low_tail": NoteSpec("Open miss against the published Barker 1st percentile near the ground", "site latitude <= -80 and provenance.site_terrain.pixel_m <= 10"),
    "terrain.bracket_resolution": NoteSpec("Horizon bracket is numerical resolution only", "provenance.site_terrain is not None"),
    "terrain.global_coarse": NoteSpec("Coarse terrain store at the site", "provenance.site_terrain.pixel_m >= 100"),
    "terrain.polar_footprint": NoteSpec("Terrain at the lander footprint sets the polar horizon", "provenance.site_terrain is not None and abs(scenario.site.lat_deg) >= 80"),
    "terrain.mazarico_cr1": NoteSpec("Open miss against the published Mazarico CR1 figure", "provenance.site_terrain is not None"),
    "terrain.landed_missions": NoteSpec("Landed missions do not test the terrain horizon", "provenance.site_terrain is not None"),
    "terrain.polar_observed_coverage": NoteSpec("Terrain range contained 68 % of observed polar shadow edges", "provenance.site_terrain is not None and scenario.site.lat_deg <= -80"),
    "terrain.polar_small_shadows": NoteSpec("Cell-scale shadows are not predicted", "provenance.site_terrain is not None and scenario.site.lat_deg <= -80"),
    "terrain.polar_large_shadows": NoteSpec("Large shadows are placed to a few metres", "provenance.site_terrain is not None and scenario.site.lat_deg <= -80"),
    "terrain.avgvisib_comparison": NoteSpec("Average illumination against the published 60 m raster", "provenance.site_terrain is not None and scenario.site.lat_deg <= -80"),
    "terrain.bright_ridge_low": NoteSpec("Brightest ridge pixels read low", "provenance.site_terrain is not None and scenario.site.lat_deg <= -80"),
    "terrain.crest_observer_height": NoteSpec("Crest illumination depends on observer height", "provenance.site_terrain is not None and scenario.site.lat_deg <= -80 (scenario.profile.array_height_m, antenna_height_m)"),
    "terrain.near_field_seam": NoteSpec("Terrain-store seam within 1 000 m of the observer", "provenance.horizons.*.provenance.near_field_seam present and warning"),
    "terrain.pit_height": NoteSpec("Pit heights are below the terrain vertical accuracy", "an ellipse or a search result is reported"),
    "sphere.no_terrain": NoteSpec("Smooth-sphere horizon, no terrain", "provenance.site_terrain is None"),
    "sphere.blue_ghost_sunset": NoteSpec("Blue Ghost sunset is 1.9 h late on the smooth sphere", "provenance.site_terrain is None"),
    "heading.unknown": NoteSpec("Lander heading is unknown", "evaluation.heading.depends and not heading.known, or a slip or scan row is heading-dependent while scenario.profile.attitude.heading_known is false"),
    "heading.stated": NoteSpec("Lander heading is stated, with an uncertainty", "evaluation.heading.depends and heading.known"),
    "events.shallow_sun": NoteSpec("Shallow Sun at high latitude", "abs(scenario.site.lat_deg) >= 60"),
    "events.chandrayaan3_sunset": NoteSpec("Chandrayaan-3 sunset miss", "abs(scenario.site.lat_deg) >= 60"),
    "scan.step": NoteSpec("Edges are interpolated at the signal step", "always (provenance.analysis.step_s)"),
    "scan.feature_missed": NoteSpec("A feature shorter than the step can be missed", "always"),
    "eclipse.danjon": NoteSpec("Earth shadow uses the Danjon-enlarged Earth", "scenario.eclipse.shadow is danjon and earth_eclipse_fraction > 0 inside any span shown"),
    "eclipse.geometric": NoteSpec("Earth shadow uses the geometric Earth", "scenario.eclipse.shadow is not danjon and earth_eclipse_fraction > 0 inside any span shown"),
    "eclipse.no_atmosphere": NoteSpec("No atmospheric refraction in the eclipse", "earth_eclipse_fraction > 0 inside any span shown"),
    "ephemeris.eop": NoteSpec("Earth orientation from a predicted kernel", "any span ends after the coverage end of the loaded high-accuracy Earth-orientation kernel (kernels.files[].coverage_utc)"),
    "power.estimated_profile": NoteSpec("Lander power profile contains estimates", "scenario.profile.estimates() is not empty"),
    "power.model_scope": NoteSpec("Power model omits albedo, diffuse light, thermal and incidence losses", "always"),
    "power.battery_lumped": NoteSpec("Battery is a lumped model", "always"),
    "contact.geometric": NoteSpec("Contact is geometric", "scenario.network.stations, an active constraint in (dte_at_landing_deg, min_contact_fraction, max_contact_gap_h, min_link_margin_db), or a metric key starting contact, longest_outage, link_margin, dte or earth"),
    "link.budget": NoteSpec("Link margin uses user-supplied figures", "scenario.profile.link is not None"),
    "landed.slim_recovery": NoteSpec("SLIM recovery days are not predicted", "always"),
    "ellipse.binomial_error": NoteSpec("Ellipse probabilities are sample fractions", "an ellipse result is reported"),
    "ellipse.conditional": NoteSpec("Ellipse probabilities are conditional on landing inside it", "ellipse.truncated"),
    "search.pruning_heuristic": NoteSpec("Coarse search levels are a heuristic", "search.settings.exhaustive is false"),
    "search.recall_one_area": NoteSpec("Search recall was measured for one scenario and area", "search.settings.exhaustive is false"),
}


@dataclass(frozen=True, slots=True)
class LimitContext:
    """What `applicable_limits` reads from a result when no `SiteEvaluation` is at hand (a slip, scan or rank result): the
    scenario at the place evaluated and that result's provenance block. `heading` is the engine's `HeadingAnalysis` when there
    is one; `heading_rows` is True when the result's rows carry heading-dependent verdicts; `metrics` are `Metric` objects."""

    scenario: object
    provenance: dict
    heading: object = None
    metrics: tuple = ()
    heading_rows: bool = False


def _first_seam(prov: dict) -> dict | None:
    """The near-field seam record of the first horizon (array, then antenna) whose store seam warns, with its observer."""
    for obs in ("array", "antenna"):
        seam = (((prov.get("horizons") or {}).get(obs) or {}).get("provenance") or {}).get("near_field_seam")
        if isinstance(seam, dict) and seam.get("present") and seam.get("warning"):
            return {"observer": obs, **seam}
    return None


def _step_s(analysis: dict) -> float:
    """The signal step of a result's provenance: `step_s` of an evaluation, `signal_step_s` of a slip or a scan."""
    return need(analysis, "step_s" if "step_s" in analysis else "signal_step_s", "provenance.analysis")


def facts(ev) -> dict:
    """The scenario facts that select the notes, read from the evaluation (absent facts raise)."""
    sc = need(ev, "scenario", "evaluation")
    prov = need(ev, "provenance", "evaluation")
    if "site_terrain" not in prov:
        raise ValueError("evaluation provenance has no 'site_terrain' entry")
    return {
        "lat": sc.site.lat_deg,
        "terrain": prov["site_terrain"],
        "step_s": _step_s(need(prov, "analysis", "provenance")),
        "shadow": sc.eclipse.shadow,
        "link": sc.profile.link is not None,
        "network": bool(sc.network.stations),
        "estimates": sorted(sc.profile.estimates()),
        "landing_utc": sc.landing_utc,
        "array_height_m": sc.profile.array_height_m,
        "antenna_height_m": sc.profile.antenna_height_m,
        "heading": getattr(ev, "heading", None),
        "antenna_range": sc.profile.antenna_height_max_m is not None
        and sc.profile.antenna_height_max_m != sc.profile.antenna_height_m,
        "terrain_widened": any((prov.get("horizons", {}).get(k) or {}).get("widened") for k in ("array", "antenna")),
        "constraints": tuple(sc.constraints.active()),
        "metrics": tuple(m.key for m in getattr(ev, "metrics", ())),
        "mission_h": sc.mission_duration_h,
        "k_sigma": sc.terrain_error.k_sigma,
        "earth_radius_km": sc.eclipse.earth_radius_km,
        "heading_rows": bool(getattr(ev, "heading_rows", False)) and not sc.profile.attitude.heading_known,
        "seam": _first_seam(prov),
    }


@dataclass(frozen=True, slots=True)
class Span:
    """A stretch of time at one place that an analysis evaluated: from a landing to the end of its mission."""

    start_utc: str
    end_utc: str
    lat_deg: float
    lon_deg: float


EARTH_ORIENTATION_ROLE = "high-accuracy historical"
ECLIPSE_STEP_S = 1800.0
"""Sampling step of the eclipse test over a span; an Earth shadow transit lasts hours, so no eclipse falls between two samples."""
CONTACT_CONSTRAINTS = ("dte_at_landing_deg", "min_contact_fraction", "max_contact_gap_h", "min_link_margin_db")
CONTACT_METRIC_PREFIXES = ("contact", "longest_outage", "link_margin", "dte", "earth")


@cache
def earth_orientation_data_end_utc() -> str:
    """The last instant the high-accuracy Earth-orientation kernel covers, read from the loaded kernel set (after it the
    predicted kernel is used)."""
    from lunarnav.ephem.kernels import load_kernels

    ends = [k.coverage_utc[1] for k in load_kernels().files if EARTH_ORIENTATION_ROLE in k.role and k.coverage_utc]
    if not ends:
        raise ValueError("the loaded kernel set has no high-accuracy Earth-orientation kernel with a coverage")
    return max(ends)


def _span_et(span: Span) -> tuple[float, float]:
    from lunarnav.ephem.timeconv import utc_to_et

    return utc_to_et(span.start_utc), utc_to_et(span.end_utc)


def evaluation_span(ev) -> Span:
    """The span an evaluation covers: its landing to the end of its mission, at its site."""
    from lunarnav.ephem.timeconv import et_to_utc, utc_to_et

    sc = need(ev, "scenario", "evaluation")
    start = utc_to_et(sc.landing_utc)
    return Span(sc.landing_utc, et_to_utc(start + sc.mission_duration_h * 3600.0), sc.site.lat_deg, sc.site.lon_deg)


def _spans_from_landings(ev, landings) -> list[Span]:
    from lunarnav.ephem.timeconv import et_to_utc, utc_to_et

    sc = need(ev, "scenario", "evaluation")
    return [Span(u, et_to_utc(utc_to_et(u) + sc.mission_duration_h * 3600.0), sc.site.lat_deg, sc.site.lon_deg) for u in landings]


def _eclipse_inside(ev, spans) -> bool:
    """Whether the Earth hides any of the Sun's disc at any instant of any span (the engine's `earth_eclipse_fraction`, the
    scenario's shadow convention), clipped to the kernel coverage."""
    import numpy as np

    from lunarnav.ephem import earth_eclipse_fraction
    from lunarnav.ephem.kernels import load_kernels
    from lunarnav.types import Site

    sc = need(ev, "scenario", "evaluation")
    lo, hi = load_kernels().valid_et
    for span in spans:
        a, b = _span_et(span)
        a, b = max(a, lo), min(b, hi)
        if b <= a:
            continue
        et = np.arange(a, b + ECLIPSE_STEP_S, ECLIPSE_STEP_S)
        et = et[et <= hi]
        site = Site(span.lat_deg, span.lon_deg, sc.profile.array_height_m, "span")
        frac = earth_eclipse_fraction(site, 0.0, et, shadow=sc.eclipse.shadow, earth_radius_km=sc.eclipse.earth_radius_km,
                                      atmosphere_km=sc.eclipse.atmosphere_km)
        if float(np.max(frac)) > 0.0:
            return True
    return False


def applicable_limits(ev, spans=()) -> list[LimitNote]:
    """Notes for this evaluation, in reading order. `spans` are further stretches of time the report evaluates (slip rows, scan
    range, ...): the Earth-orientation and eclipse notes are selected over the evaluation's own span and these."""
    f = facts(ev)
    all_spans = [evaluation_span(ev), *spans]
    eclipse_in_span = _eclipse_inside(ev, all_spans)
    eop_end = earth_orientation_data_end_utc()
    from lunarnav.ephem.timeconv import utc_to_et

    beyond_eop = any(_span_et(x)[1] > utc_to_et(eop_end) for x in all_spans)
    return _select(f, eclipse_in_span, beyond_eop, eop_end)


def _select(f: dict, eclipse_in_span: bool, beyond_eop: bool, eop_end: str) -> list[LimitNote]:
    """The notes the facts `f` select, given whether an eclipse falls inside a span and whether a span ends after the
    high-accuracy Earth-orientation coverage."""
    lat, ter, step = f["lat"], f["terrain"], f["step_s"]
    out: list[LimitNote] = []
    add = out.append

    add(LimitNote("events.half_flux", 
        ASSUMED, "Sunlit means a limb-darkened solar flux fraction above the scenario's threshold (default one half); "
        "event times are crossings of that threshold, not first or last limb.",
        "scenario.md section 1", "Sunlight = terrain flux"))
    h, widened = f["heading"], f["terrain_widened"]
    if widened:
        add(LimitNote("terrain.error_budget", 
            ASSUMED, f"Where the terrain-error bound applies, the optimistic and pessimistic cases widen the horizon by k = {f['k_sigma']:g} "
            "sigma of the terrain product's error with a first-order marginal model per azimuth; correlated DEM error is not modelled.",
            "visibility.md section 6", "Horizon widening is a first-order per-azimuth marginal model",
            parameters={"k_sigma": f["k_sigma"]}))
        add(LimitNote(
            "terrain.error_basis", ASSUMED, "The terrain-error range is only as good as the sigma behind it: each terrain product's vertical and "
            "horizontal sigma is published, published-method, measured here, or assumed (the global budget of 4 m and 10 m); the basis of each "
            "figure is listed in section 2.",
            "terrain.md section 5", "(global 4 m / 10 m: all north LDEMs"))
    if (h is not None and h.depends) or f["heading_rows"]:
        is_stated = h is not None and h.known
        stated = (f"The lander heading is stated ({h.nominal_yaw_deg:g} deg, uncertain by {h.uncertainty_deg:g} deg either side)"
                  if is_stated else "The lander heading is unknown, so all evaluated headings are in the bound and there is no nominal "
                  "state of charge")
        add(LimitNote("heading.stated" if is_stated else "heading.unknown", 
            ASSUMED, f"{stated}: the optimistic and pessimistic cases are the upper and the lower bound over headings, so the state-of-charge "
            "bounds measure the heading, not terrain, wherever the engine's attribution says so.",
            "scenario.md section 6", "Power and state-of-charge bounds come from the best and worst lander heading",
            parameters={"nominal_yaw_deg": h.nominal_yaw_deg, "uncertainty_deg": h.uncertainty_deg} if is_stated else {}))
    seam = f["seam"]
    if seam is not None:
        add(LimitNote(
            "terrain.near_field_seam", MODEL_LIMIT, f"Within {seam['near_field_m']:g} m of the {seam['observer']} observer the {seam['other_store']} store "
            f"supplies the ground instead of the {seam['ground_store']} store, {seam['distance_m']:g} m away: the height step across it "
            f"(median {seam['step_median_m']:g} m, 95th percentile {seam['step_p95_m']:g} m over {seam['n_crossings']} crossings) can move the "
            f"horizon by {seam['horizon_shift_deg']:g} deg, more than the horizon's own bracket, so the near-field horizon may carry an artefact of that size.",
            "terrain.md section 3.9", "a seam with 95th-percentile step `s` at distance `d` can move the horizon by `shift = atan(s / d)`",
            parameters={k: seam[k] for k in ("observer", "ground_store", "other_store", "distance_m", "step_median_m", "step_p95_m",
                                             "n_crossings", "horizon_shift_deg", "near_field_m")}))
    if ter is None:
        coincide = not widened and not f["antenna_range"] and (h is None or not h.depends or (h.known and h.uncertainty_deg == 0.0))
        add(LimitNote("sphere.no_terrain", 
            MODEL_LIMIT, "No terrain was used: the horizon is the smooth sphere at each observer height, the same in all three "
            "cases; sunrise and sunset ignore topography. "
            + ("Every bound therefore equals the nominal value." if coincide else
               "The bounds that remain come from the lander heading or the antenna height range, not from the horizon."),
            "scenario.md section 6", "the three cases coincide only when"))
        add(LimitNote("sphere.blue_ghost_sunset", 
            MISS_LANDED, "On the smooth sphere the modelled Blue Ghost Mission 1 sunset is 1.9 h later than Firefly's window.",
            "scenario.md section 5", "Blue Ghost sunset (+1.9 h, target 1 h)"))
    else:
        px = ter["pixel_m"]
        if px >= 100.0:
            add(LimitNote("terrain.global_coarse", 
                MODEL_LIMIT, f"The terrain store serving this site ({ter['dem_id']}) has {px:g} m pixels, which is coarse "
                "for a near-field horizon; the horizon bracket does not include that representation error.",
                "horizon.md section 5", "near-field horizon there is pixel-scale smooth",
                parameters={"dem_id": ter["dem_id"], "pixel_m": px}))
        add(LimitNote("terrain.bracket_resolution", 
            MODEL_LIMIT, "The horizon engine's bracket is numerical resolution only; DEM error enters through the terrain-error "
            "widening, whose sigma per terrain store is listed in section 2.",
            "horizon.md section 5", "DEM error is not included in the bracket"))
        if abs(lat) >= 80.0:
            add(LimitNote("terrain.polar_footprint", 
                MODEL_LIMIT, "At a polar site the terrain within a few metres of the lander can set the horizon at many "
                "azimuths; the engine has no minimum-distance option to exclude the footprint.",
                "horizon.md section 5", "Terrain within a few metres of the observer on a slope"))
        add(LimitNote("terrain.error_budget_scope", 
            MODEL_LIMIT, "The terrain-error budget does not cover interpolated pixels (most 5 m pixels carry no direct measurement), "
            "the correlation between the observer's ground and near blockers (the bound treats the two errors as independent), "
            "sub-pixel relief and boulders, or the observer's own ground height.",
            "scenario.md section 6", "The terrain-error budget does not cover: interpolated pixels"))
        if px <= 10.0:
            add(LimitNote(
                "terrain.height_outliers", MODEL_LIMIT,
                "The terrain-error budget also does not cover isolated pixels whose height is wrong by tens of metres: about 8 in a million "
                "pixels of the 5 m polar store differ from the 10 m store by more than 20 m, and in a comparison of 57,155 points four 5 m "
                "polar pixels differed from the PGDA tile by 29 to 47 m (none within 2 km of a catalogue site); a horizon limited by such a "
                "pixel falls outside the stated range.",
                "terrain.md section 3.3", "found **4 points of 57 155 compared with a difference above 25 m**",
                more=("8.4e-6",),
                parameters={"fraction_over_20m_5m_vs_10m": 8.4e-6, "points_compared": 57155, "points_differing": 4,
                            "difference_min_m": 29.04, "difference_max_m": 46.70}))
        add(LimitNote("terrain.mazarico_cr1", 
            MISS_PUBLISHED, "Against the published Mazarico CR1 figure the 240 m store's best post within 3 km is 74.90 % against 89.01 % "
            "(-14.1 points); the cause is not established.",
            "scenario.md section 6", "Open miss, Mazarico CR1 (section 11.4)"))
        if lat <= -80.0 and px <= 10.0:
            add(LimitNote(
                "terrain.barker_low_tail", MISS_PUBLISHED,
                "Near the ground at a south-polar site the pessimistic case is not as pessimistic as a published terrain-uncertainty study's "
                "1st percentile (Barker et al. 2021, 5 m tiles). At a 1 m observer height the pessimistic case's average illumination is 0.16 "
                "to 2.39 points above that percentile in seven of seven regions, and its longest continuous illumination period is 14.6 to "
                "36.5 days above it in six of seven; at 5 m it reaches the percentile (0.1 to 0.9 points below it in all seven regions). "
                "Treat a Pass with a small worst-case margin on sunlight, or on a long illuminated span, as less certain than the range suggests.",
                "scenario.md section 11.6",
                "At a 1 m observer height the pessimistic case's average illumination is 0.16 to 2.39 points above the published 1st percentile in seven of seven regions",
                ("its longest continuous illumination period is 14.6 to 36.5 days above it in six of seven",
                 "0.1 to 0.9 points below it in all seven regions"),
                parameters={"regions": 7, "avg_above_p1_1m_pp": [0.16, 2.39], "lcip_above_p1_1m_d": [14.6, 36.5], "lcip_regions_above_p1_1m": 6,
                            "avg_below_p1_5m_pp": [0.1, 0.9]}))
        south = lat <= -80.0
        add(LimitNote("terrain.landed_missions", 
            MISS_LANDED, "Surface event times from landed missions do not test the terrain horizon at this resolution (no ground truth "
            "at the required resolution), so the terrain bounds are not validated against an observed local horizon from the surface."
            + (" Orbital images do test it at the south pole; see the notes on orbital images." if south else
               " The orbital-image and published-illumination comparisons in this report's validation were made near the south pole "
               "and are not quoted for this site."),
            "scenario.md section 5", "terrain-horizon events (no ground truth at the required resolution)"))
        if south:
            add(LimitNote("terrain.polar_observed_coverage", 
                MISS_IMAGES, "Against ten orbital images of south-polar terrain (Sun elevation -2.0 to +6.3 deg) the stated optimistic-to-"
                "pessimistic range at k = 2 sigma contained 68.2 % of the 9,565 observed shadow-boundary cells (62.9 % at k = 1, 70.6 % at "
                "k = 3), and 39-40 % at Shackleton. A two-sigma interval would be expected to contain about 95 %; the stated range has "
                "contained about two thirds of observed shadow edges, so treat a Marginal verdict, or a narrow Pass, on sunlight timing "
                "at a polar site as less certain than the range suggests.",
                "imagery.md section 'What a planner can take from this', item 1",
                "Pooled over the ten scenes, at k = 1 / 2 / 3 sigma it contains 62.9 % / 68.2 % / 70.6 % of the 9,565 observed "
                "shadow-boundary cells",
                ("Sun elevation -2.0 to +6.3 deg", "k = 2 covers 39-40 % of boundary cells at Shackleton")))
            add(LimitNote("terrain.polar_small_shadows", 
                MISS_IMAGES, "Shadows one to three terrain cells across, seen from ground level with the Sun below 6.5 deg, are not "
                "predicted reliably: on 9 of 10 images the overlap (IoU) of predicted and observed shadow was below 0.2, and at Shackleton "
                "(Sun 1.2 deg) only 37 of 295 and 34 of 245 observed shadow cells were predicted shadow. No scene has the Sun higher than "
                "6.3 deg.",
                "imagery.md section 'What a planner can take from this', item 3",
                "It cannot be trusted for cell-scale (1-3 cell) shadows, nor at grazing Sun.",
                ("Overall 9 of 10 scenes have IoU below 0.2",
                 "only 37 of 295 and 34 of 245 observed shadow cells are predicted shadow",
                 "observer height 0",
                 "Sun elevation -2.0 to +6.3 deg",
                 "A \"higher Sun\" than about 6.5 deg is not reachable at 5-10 m store resolution")))
            add(LimitNote("terrain.polar_large_shadows", 
                MODEL_LIMIT, "Large shadows are placed well: shadows of at least 64 cells (about 4,000 m2 at 8 m cells) have a median "
                "boundary error of 5.7 to 8.0 m at Sun 5.6 to 6.3 deg. At the shadow-edge speeds measured (5-25 m/h) a displaced boundary "
                "is 26-41 minutes of sunrise and sunset timing at the Malapert scenes with a measurable speed, and 62 to 314 minutes at "
                "the four other scenes with one.",
                "imagery.md section 'What a planner can take from this', item 2",
                "Shadows of at least 64 cells (about 4,000 m2 at 8 m cells) are placed with a median boundary error of 5.7 to 8.0 m",
                ("26-41 min for the Malapert scenes with a measurable speed", "measured 5-25 m/h",
                 "62 min for pgda_m184288222", "136 min for Malapert03", "157 min for pgda_m139729686", "314 min for pgda_m1188426614")))
            add(LimitNote("terrain.avgvisib_comparison", 
                MODEL_LIMIT, "Against the published 60 m average-illumination raster AVGVISIB_85S_060M (1500 random pixels within 150 km "
                "of the south pole) the exact engine's average sunlight has a mean error of 0.59 points (95th percentile 2.72), and its "
                "Earth visibility a 95th percentile of 6.27 points, which misses the 5-point target.",
                "illumination.md section 'Summary for planners'",
                "Sun mean 0.59 points, p95 2.72; Earth p95 6.27 misses the 5-point target",
                ("n = 1500 pixels, rho < 150 km",)))
            add(LimitNote("terrain.bright_ridge_low", 
                MISS_PUBLISHED, "The brightest ridge pixels read low: at the published-maximum pixel (88.44 %) the engine on the 60 m terrain "
                "gives 84.38 %, and over the 50 brightest published pixels it is 4.0 points low on average. Crest values depend strongly "
                "on terrain resolution: the same 50 pixels read 53.7 % on the 20 m store and 38.9 % on the 10 m store. A site on a crest "
                "has the least certain sunlit fraction.",
                "illumination.md section 3.4",
                "So crest illumination is strongly resolution-dependent",
                ("Top-50 published pixels: mean published 79.97 %, engine 75.96 %, bias -4.01",
                 "Engine at that pixel (60 m store, exact): 84.38 %", "20 m store 53.7 %, 10 m store 38.9 %",
                 "published 88.444 %")))
            add(LimitNote("terrain.crest_observer_height", 
                MODEL_LIMIT, "Crest values depend on observer height: at the published-maximum pixel the exact engine reads 55.8 % with the "
                "default 0 m mast and 90.4 % with a 2 m mast (the regional layer's 8 output cells there average 47.7 % at 0 m). This "
                f"scenario's observers are {f['array_height_m']:g} m (array) and {f['antenna_height_m']:g} m (antenna) above local ground, "
                "so its sunlight depends on those heights.",
                "illumination.md section 'Summary for planners'",
                "observer height decides it",
                ("cell row 466, col 536: exact 55.8 %", "With a 2 m mast the same cell is 90.4 % exact",
                 "The 8 output cells inside that pixel average 47.7 % at the default mast of 0 m"),
                parameters={"array_height_m": f["array_height_m"], "antenna_height_m": f["antenna_height_m"]}))
    if abs(lat) >= 60.0:
        add(LimitNote("events.shallow_sun", 
            MODEL_LIMIT, f"At {lat:.1f} deg latitude the Sun meets the horizon at a shallow angle: half-flux and last-limb "
            "times can differ by hours, and event times are dominated by the horizon.",
            "scenario.md section 6", "Half-flux events differ from the last/first limb time, hours at high latitude",
            parameters={"latitude_deg": lat}))
        add(LimitNote("events.chandrayaan3_sunset", 
            MISS_LANDED, "The published Chandrayaan-3 sunset (69.4 S) is 5.2 h from the modelled horizon crossing; the published "
            "instant matches a local-solar-time label.",
            "scenario.md section 5", "Chandrayaan-3 sunset (-5.2 h, target 1-3 h)"))
    add(LimitNote("scan.step", 
        MODEL_LIMIT, f"Edges are linear interpolation at the {step_s_text(step)} signal step; the interpolation error is "
        "1.4 s at 600 s and 43 s at 1800 s.",
        "scenario.md section 6", "Linear interpolation at the signal step: up to 43 s at 1800 s, 1.4 s at 600 s",
        parameters={"step_s": step}))
    if eclipse_in_span and f["shadow"] == "danjon":
        add(LimitNote("eclipse.danjon", 
            ASSUMED, "Earth shadow uses the Danjon-enlarged Earth (radius x 1.01): the conservative direction for power; "
            "contact times differ from the bare-Earth model by up to about 2 min.",
            "scenario.md section 6", "The Danjon shadow is a proxy; differences from the geometric model are up to about 2 min",
            parameters={"shadow": f["shadow"], "earth_radius_km": f["earth_radius_km"]}))
    elif eclipse_in_span:
        add(LimitNote("eclipse.geometric", 
            ASSUMED, "Earth shadow uses the geometric (bare Earth) convention, which gives shorter eclipses than the Danjon default.",
            "ephemeris.md section 8", "lengthens eclipses relative to a bare Earth, the conservative direction for power",
            parameters={"shadow": f["shadow"], "earth_radius_km": f["earth_radius_km"]}))
    if eclipse_in_span:
        add(LimitNote("eclipse.no_atmosphere", 
            NOT_MODELLED, "No atmospheric refraction or extinction, no gravitational light deflection; the eclipse fraction is an "
        "obscuration proxy, not irradiance.",
        "ephemeris.md section 8", "no atmospheric refraction or extinction"))
    if beyond_eop:
        add(LimitNote("ephemeris.eop", 
            MODEL_LIMIT, f"Earth orientation after {eop_end[:10]} comes from a predicted kernel; ephemeris uncertainty grows with epoch.",
            "scenario.md section 6", "Earth orientation beyond 2026 uses the predicted EOP kernel",
            parameters={"coverage_end_utc": eop_end}))
    if f["estimates"]:
        add(LimitNote("power.estimated_profile", 
            ASSUMED, f"{len(f['estimates'])} lander profile parameter group(s) are estimates, or values set by an automated assistant and not stated by the user, not published values "
            f"({', '.join(f['estimates'])}); all battery and state-of-charge results depend on them and none is validated against telemetry.",
            "scenario.md section 5", "all battery and SOC results (lander",
            parameters={"groups": list(f["estimates"])}))
    add(LimitNote("power.model_scope", 
        NOT_MODELLED, "Power: no albedo, diffuse light, thermal derating or incidence-angle losses.",
        "visibility.md section 6", "Power: no albedo, diffuse light, thermal derating or incidence-angle losses"))
    add(LimitNote("power.battery_lumped", 
        NOT_MODELLED, "Battery: lumped efficiencies only; no temperature, ageing, voltage or converter effects.",
        "visibility.md section 6", "Battery: lumped efficiencies; no temperature, ageing, voltage or constant-power-converter effects"))
    if (f["network"] or any(k in f["constraints"] for k in CONTACT_CONSTRAINTS)
            or any(k.startswith(CONTACT_METRIC_PREFIXES) for k in f["metrics"])):
        add(LimitNote("contact.geometric", 
            NOT_MODELLED, "Contact is geometric: station mask and lander-side clearance only. No antenna pattern, pointing limit, "
            "station outage or scheduling conflict.",
            "scenario.md section 6", "a station outage or scheduling is not modelled"))
    if f["link"]:
        add(LimitNote("link.budget", 
            NOT_MODELLED, "Link margin uses the user-supplied G/T, losses and requirement; weather and atmospheric statistics are "
            "not modelled and only a published deep-space example was reproduced, not a lunar one.",
            "visibility.md section 6", "Link budget: the user supplies G/T, losses and requirement"))
    add(LimitNote("scan.feature_missed", 
        ASSUMED, "A rise, set or notch shorter than the signal step can be missed between two samples.",
        "visibility.md section 6", "Inputs are assumed sampled finely enough that a feature (rise, set, notch) is not missed"))
    add(LimitNote("landed.slim_recovery", 
        MISS_LANDED, "SLIM's recovery days are not predicted because its wake threshold is unpublished.",
        "scenario.md section 5", "SLIM recovery days"))
    return _in_reading_order(out)


def _in_reading_order(notes: list[LimitNote]) -> list[LimitNote]:
    """Stable: notes that are not misses first, in the order they were selected, then each kind of miss in `MISS_ORDER`."""
    return sorted(notes, key=lambda n: MISS_ORDER.index(n.category) + 1 if n.category in MISS_ORDER else 0)


SEARCH_NOTE_SITES = 10
"""How many of the best ranked sites of a search select its notes."""


def evaluate_search_sites(scenario, search, provider) -> list:
    """The evaluations that select a search's notes: the scenario moved to each of the `SEARCH_NOTE_SITES` best ranked sites
    and to that site's own best landing epoch (to the region centre at the scenario's landing when no site survived), with the
    horizon provider the search used. One engine evaluation per site."""
    from lunarnav.scenario import evaluate_scenario

    region = need(search, "settings", "search result")["region"]
    places = [(x.lat_deg, x.lon_deg, x.landing_utc) for x in search.sites[:SEARCH_NOTE_SITES]] or [
        (region["lat_deg"], region["lon_deg"], scenario.landing_utc)]
    return [evaluate_scenario(scenario.model_copy(update={"landing_utc": landing, "site": scenario.site.model_copy(
        update={"lat_deg": lat, "lon_deg": lon, "name": "search site", "catalog_id": None})}), provider) for lat, lon, landing in places]


def search_spans(site_evaluations, search) -> list[Span]:
    """The stretch every landing epoch of the search evaluated, at the region centre: the first epoch to the end of the last one's
    mission (`provenance.first_landing_utc`, `last_landing_utc`; none when the result does not state them)."""
    from lunarnav.ephem.timeconv import et_to_utc, utc_to_et

    prov = getattr(search, "provenance", None) or {}
    first, last = prov.get("first_landing_utc"), prov.get("last_landing_utc")
    if not (first and last and site_evaluations):
        return []
    region = need(search, "settings", "search result")["region"]
    mission_s = site_evaluations[0].scenario.mission_duration_h * 3600.0
    return [Span(first, et_to_utc(utc_to_et(last) + mission_s), region["lat_deg"], region["lon_deg"])]


def search_limits(site_evaluations, search) -> list[LimitNote]:
    """Notes for a site-search section. They describe the sites the search returns, not the scenario's own site (the region
    defines where sites are, and latitude, terrain store and resolution select the notes): the union, first seen first (keyed by
    id and text), of `applicable_limits` over `site_evaluations` (from `evaluate_search_sites`), then `survey_limits`."""
    spans = search_spans(site_evaluations, search)
    return _union(*(applicable_limits(ev, spans) for ev in site_evaluations), survey_limits(search=search))


def survey_limits(ellipse=None, search=None) -> list[LimitNote]:
    """Notes for the landing-ellipse and site-search sections, each tied to `scenario.md` like the others."""
    out: list[LimitNote] = []
    if ellipse is not None:
        out.append(LimitNote("ellipse.binomial_error", 
            ASSUMED, "Ellipse probabilities are sample fractions with a binomial standard error that is conservative for the "
            "low-discrepancy sample" + ("; with the truncated dispersion they are conditional on landing inside the ellipse." if ellipse.truncated else "."),
            "scenario.md section 9", "conservative for a low-discrepancy sequence",
            parameters={"n_samples": ellipse.n_samples, "truncated": bool(ellipse.truncated)}))
        if ellipse.truncated:
            out.append(LimitNote("ellipse.conditional", 
                ASSUMED, "The truncated dispersion makes every ellipse probability conditional on landing inside the ellipse.",
                "scenario.md section 9", "probabilities are conditional on landing inside the ellipse",
                parameters={"n_samples": ellipse.n_samples}))
    if search is not None and not search.settings["exhaustive"]:
        out.append(LimitNote("search.pruning_heuristic", 
            ASSUMED, "The coarse levels of the search are a heuristic: a site whose neighbourhood looks hopeless at coarse spacing can "
            "still be good at the final spacing.",
            "scenario.md section 10", "The coarse promotion is a heuristic",
            parameters={"final_spacing_m": search.settings["final_spacing_m"], "coarse_factor": search.settings["coarse_factor"]}))
        out.append(LimitNote("search.recall_one_area", 
            MISS_SEARCH, "Recall of the pruned search was measured for one scenario and one area only; with other constraints it may lose sites.",
            "scenario.md section 10", "The recall result is for one scenario and one area",
            parameters={"final_spacing_m": search.settings["final_spacing_m"], "coarse_factor": search.settings["coarse_factor"]}))
    if ellipse is not None or search is not None:
        out.append(LimitNote("terrain.pit_height", 
            MODEL_LIMIT, "Heights of a few metres, which matter at a pit, are below the terrain store's vertical accuracy.",
            "scenario.md section 6", "are below the store's vertical accuracy"))
    return _in_reading_order(out)


def step_s_text(step_s: float) -> str:
    return f"{step_s:g} s"


def _union(*groups) -> list[LimitNote]:
    """The notes of the groups, first seen first, one per (id, text): two instances of one id that quote different parameters
    (another site's pixel size, another step) both stay."""
    seen: dict[tuple[str, str], LimitNote] = {}
    for group in groups:
        for note in group:
            seen.setdefault((note.id, note.text), note)
    return list(seen.values())


def _heading_rows(rows) -> bool:
    """Whether any row's verdict is heading-dependent (the engine's `ConstraintVerdict.heading_dependent`, set on the state-of-charge
    row of every slip, launch-slip and rank row while the heading is unknown)."""
    return any(r.verdict is not None and any(c.heading_dependent for c in r.verdict.constraints) for r in rows)


def result_context(scenario, result, *, heading_rows: bool = False) -> LimitContext:
    """The context of a slip, scan or rank result when no `SiteEvaluation` is at hand: `scenario` at the result's own site (a slip
    result names it in `result.site`) and the result's own provenance block."""
    site = getattr(result, "site", None)
    sc = scenario if site is None else scenario.model_copy(update={"site": site})
    return LimitContext(sc, result.provenance, heading_rows=heading_rows)


def _t_last(result) -> str | None:
    return ((getattr(result, "provenance", None) or {}).get("analysis") or {}).get("t_last_utc")


def slip_spans(ev, slip) -> list[Span]:
    """The span of every slip row that has a landing (a row with no landing evaluated nothing), and from the first landing to the
    end of the last candidate mission (`provenance.analysis.t_last_utc`, which covers the next-open search) when the result states it."""
    from lunarnav.ephem.timeconv import utc_to_et

    landings = [r.landing_utc for r in need(slip, "rows", "slip result") if r.landing_utc]
    spans = _spans_from_landings(ev, landings)
    last = _t_last(slip)
    if landings and last:
        sc = ev.scenario
        spans.append(Span(min(landings, key=utc_to_et), last, sc.site.lat_deg, sc.site.lon_deg))
    return spans


def scan_spans(ev, scan) -> list[Span]:
    """One span from the first scanned landing to the end of the last mission (`provenance.analysis.t_last_utc` when the result
    states it, else the last landing plus the mission)."""
    from lunarnav.ephem.timeconv import et_to_utc

    sc = need(ev, "scenario", "evaluation")
    et = need(scan, "et", "scan result")
    end = _t_last(scan) or et_to_utc(float(et[-1]) + sc.mission_duration_h * 3600.0)
    return [Span(et_to_utc(float(et[0])), end, sc.site.lat_deg, sc.site.lon_deg)]


def _with_result_step(ctx: LimitContext, result, spans: list[Span]) -> list[LimitNote]:
    """`applicable_limits` over `spans`, and when the result sampled at another signal step than the evaluation did (a scan or a
    slip uses its own), also the notes with the result's own provenance, so `scan.step` states both."""
    notes = applicable_limits(ctx, spans)
    own = result.provenance
    if _step_s(own.get("analysis") or {}) == _step_s(ctx.provenance["analysis"]):
        return notes
    return _union(notes, applicable_limits(LimitContext(ctx.scenario, own, ctx.heading, ctx.metrics, ctx.heading_rows), spans))


def slip_limits(ev, slip) -> list[LimitNote]:
    """Notes over everything a slip analysis evaluated. `ev` is the baseline `SiteEvaluation`, or `result_context(scenario, slip)`
    when only the slip result is at hand. Site facts come from `ev`'s provenance; the Earth-orientation and eclipse notes are selected
    over the evaluation's span and every slip row's span; the heading note from every row's verdict flags."""
    ctx = LimitContext(ev.scenario, ev.provenance, getattr(ev, "heading", None), tuple(getattr(ev, "metrics", ())),
                       _heading_rows(slip.rows) or bool(getattr(ev, "heading_rows", False)))
    return _with_result_step(ctx, slip, slip_spans(ev, slip))


def scan_limits(ev, scan) -> list[LimitNote]:
    """Notes over everything a scan evaluated: the evaluation (or `result_context(scenario, scan, heading_rows=...)`) and the whole
    scanned range, with the heading note when the scan's context says the heading matters (`scan.context.heading_unknown`)."""
    ctx = LimitContext(ev.scenario, ev.provenance, getattr(ev, "heading", None), tuple(getattr(ev, "metrics", ())),
                       bool(getattr(getattr(scan, "context", None), "heading_unknown", False)) or bool(getattr(ev, "heading_rows", False)))
    return _with_result_step(ctx, scan, scan_spans(ev, scan))


def rank_limits(scenario, results, evaluation=None) -> list[LimitNote]:
    """Notes over everything a ranking of sites evaluated: `results` are the `SlipResult` of each ranked site (each carries its own
    site and provenance); `scenario` supplies the lander, constraints and shadow convention. `evaluation`, when the ranking also
    evaluated the scenario's own site (its baseline), adds that evaluation's notes (its heading analysis, for one), so a ranking
    never has fewer notes than the single-site slip of the same site."""
    own = [applicable_limits(evaluation)] if evaluation is not None else []
    return _union(*own, *(slip_limits(result_context(scenario, r), r) for r in results))


def compare_limits(ev, comparison) -> list[LimitNote]:
    """Notes over the evaluation and every compared scenario's own evaluation (its site, profile, span)."""
    return _union(applicable_limits(ev), *(applicable_limits(e) for e in need(comparison, "evaluations", "comparison")))


def sensitivity_limits(ev, sensitivity) -> list[LimitNote]:
    """Notes over the baseline evaluation and every variant of a position or height sensitivity (each row carries its own evaluation)."""
    return _union(applicable_limits(ev), *(applicable_limits(r.evaluation) for r in need(sensitivity, "rows", "sensitivity result")))


def attribution_limits(ev) -> list[LimitNote]:
    """Notes over what an event attribution evaluated: the evaluation and its bound worlds (`SiteEvaluation.bound_attribution` and
    `attribute_event` re-read the same scenario, so the evaluation's own span and facts are the whole of it)."""
    return applicable_limits(ev)


def illumination_limits(ev, *, whole_span: bool = False) -> list[LimitNote]:
    """Notes over an illumination or Earth-visibility statistic: the evaluation's mission, or with `whole_span` (a statistic over the
    whole analysed span, `window="analysis"`) the whole span of the evaluation's signals."""
    from lunarnav.ephem.timeconv import et_to_utc

    if not whole_span:
        return applicable_limits(ev)
    sc = need(ev, "scenario", "evaluation")
    et = need(need(ev, "signals", "evaluation"), "et", "evaluation.signals")
    return applicable_limits(ev, [Span(et_to_utc(float(et[0])), et_to_utc(float(et[-1])), sc.site.lat_deg, sc.site.lon_deg)])


def horizon_limits(lat_deg: float, *, models_terrain: bool, pixel_m: float | None = None, dem_id: str = "", seam: dict | None = None,
                   k_sigma: float = 2.0) -> list[LimitNote]:
    """Notes over a horizon profile at one place: the terrain and smooth-sphere notes only (no scenario, so no time, power or contact
    note). `models_terrain` says the provider reads terrain (then its bracket is widened by `k_sigma`), `pixel_m` and `dem_id` are the
    serving store's, `seam` is the horizon provenance's `near_field_seam` record."""
    ter = {"dem_id": dem_id, "pixel_m": pixel_m if pixel_m is not None else 0.0} if models_terrain else None
    f = {
        "lat": lat_deg, "terrain": ter, "step_s": 0.0, "shadow": "danjon", "link": False, "network": False, "estimates": [],
        "landing_utc": "", "array_height_m": 0.0, "antenna_height_m": 0.0, "heading": None, "antenna_range": False,
        "terrain_widened": models_terrain, "constraints": (), "metrics": (), "mission_h": 0.0, "k_sigma": k_sigma,
        "earth_radius_km": 0.0, "heading_rows": False,
        "seam": ({"observer": "array", **seam} if isinstance(seam, dict) and seam.get("present") and seam.get("warning") else None),
    }
    notes = _select(f, False, False, "")
    return _in_reading_order([n for n in notes if n.id.startswith("terrain.") or n.id == "sphere.no_terrain"])


def ellipse_limits(ev, ellipse) -> list[LimitNote]:
    """Notes of the evaluation (every ellipse sample is evaluated at its landing and site neighbourhood) and the ellipse survey."""
    return _union(applicable_limits(ev), survey_limits(ellipse=ellipse))


def report_limits(ev, *, scan=None, slip=None, comparison=None, ellipse=None, search=None, search_site_evaluations=None) -> list[LimitNote]:
    """Every note a report over these analyses prints: the evaluation's, selected over its own span and every slip row's and the
    scan range's, then each compared scenario's, the ellipse survey's, and the searched sites' (`search_site_evaluations`, from
    `evaluate_search_sites`, required with `search`). The union, first seen first, in reading order."""
    spans = [*(slip_spans(ev, slip) if slip is not None else []), *(scan_spans(ev, scan) if scan is not None else [])]
    heading_rows = (slip is not None and _heading_rows(slip.rows)) or bool(getattr(getattr(scan, "context", None), "heading_unknown", False))
    ctx = LimitContext(ev.scenario, ev.provenance, getattr(ev, "heading", None), tuple(getattr(ev, "metrics", ())), heading_rows)
    groups = [applicable_limits(ctx, spans), *(_with_result_step(ctx, r, spans) for r in (slip, scan) if r is not None)]
    if comparison is not None:
        groups.append(compare_limits(ev, comparison))
    if search is not None:
        if search_site_evaluations is None:
            raise ReportInputError("the site-search notes need the evaluations of the searched sites (`evaluate_search_sites`)")
        groups.append(search_limits(search_site_evaluations, search))
    if ellipse is not None:
        groups.append(survey_limits(ellipse=ellipse))
    return _in_reading_order(_union(*groups))
