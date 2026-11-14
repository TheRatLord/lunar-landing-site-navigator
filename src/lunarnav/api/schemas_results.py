"""Typed bodies of the analysis results (`POST /analyses/<kind>` and the `result` of the matching job).

Every model forbids unknown fields, so a result the builders in `compute/analyses.py` produce that the schema
does not describe fails validation.

Conventions: times are ISO-8601 UTC strings with millisecond resolution; ET is TDB seconds past J2000. NaN or
infinite engine values ("no such instant", "not defined") are `null`. Sample arrays are JSON arrays.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel

from lunarnav.api.schemas_scenario import ExportFile, ExportManifest


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


Num = float | None
MARGIN_KIND = Literal["worst_case", "nominal", "best_case"] | None
NumArray = list[float | None]


class HeadingBest(Model):
    yaw_deg: float = Field(description="The best single heading of the evaluated set.")
    value: float = Field(description="The constraint value at that heading, in the constraint's `unit`.")
    horizon: Literal["nominal"] = Field(description="The horizon the single headings are evaluated on.")


class HeadingWorst(Model):
    yaw_deg: float = Field(description="The first heading of the first arc of headings that tie the worst value.")
    arcs_deg: list[list[float]] = Field(description="The arcs of headings that tie the worst value, `[[from_deg, to_deg], ...]` clockwise.")
    value: float = Field(description="The constraint value at the worst heading, in the constraint's `unit`.")
    horizon: Literal["nominal"] = Field(description="The horizon the single headings are evaluated on.")


class ConstraintVerdict(Model):
    key: str
    label: str
    state: str
    value: Num = Field(description="The NOMINAL case value, in `unit`; null for a heading-dependent row (see `heading_dependent`).")
    value_range: list[float] | None
    limit_min: Num
    limit_max: Num
    unit: str
    margin: Num = Field(description="Signed margin of the NOMINAL case, in `unit` (positive inside the limit); null for a heading-dependent row.")
    margin_worst: Num = Field(description="The smallest signed margin of the cases (`worst_world` names it; positive inside the limit, in "
                                          "`unit`). Not always the pessimistic case: with a two-sided limit or an Earth link the optimistic "
                                          "case can be the worse one. For a heading-dependent row: the smaller of optimistic and pessimistic.")
    censored: bool
    origin_basis: str
    origin_label: str
    origin_source_url: str | None
    heading_dependent: bool = Field(description="The state is set by the lander heading, which is unknown: `value` and `margin` "
                                                "are null (no nominal heading exists) and `value_range` spans the best and worst heading.")
    heading_note: str = Field(description="For a heading-dependent row: the best and worst heading and the headings over which the "
                                          "constraint passes; empty otherwise.")
    value_worlds: dict[str, float | None] = Field(description="The value in each case, keys `nominal`, `optimistic`, `pessimistic`; `nominal` is "
                                                              "null for a heading-dependent row, a case with no finite value is null.")
    margin_worlds: dict[str, float | None] = Field(description="The signed margin in each case (same keys, `unit`, positive inside the limit).")
    margin_limits: dict[str, Literal["min", "max"] | None] = Field(
        description="For each case, the side of the limit its margin is measured against (the nearer side of a two-sided limit); null without a margin.")
    worst_world: Literal["nominal", "optimistic", "pessimistic"] | None = Field(description="The case that gives `margin_worst`.")
    worst_limit: Literal["min", "max"] | None = Field(description="The limit `margin_worst` is measured against.")
    heading_best: HeadingBest | None = Field(
        description="For a heading-dependent row evaluated as a single landing: the best single heading of the evaluated set. null for a row built in a scan, slip or rank (no per-heading scan there) and for rows that are not heading-dependent.")
    heading_worst: HeadingWorst | None = Field(description="For the same rows: the worst single heading and the arcs of headings that tie it; null otherwise.")
    heading_basis: str = Field(description="What `heading_best` and `heading_worst` are (single constant headings on the nominal horizon, inside the bounds over headings); empty when they are null.")
    case_basis: Literal["horizon", "heading"] = Field(
        description="What the cases are: `horizon` (nominal terrain, lower and upper horizon bracket) or `heading` (unknown lander heading: "
                    "optimistic is the best heading, pessimistic the worst, no nominal).")


class Verdict(Model):
    state: str = Field(description="pass | marginal | fail")
    limiting: str | None
    constraints: list[ConstraintVerdict]


class MetricInstant(Model):
    et: float = Field(description="Ephemeris time (TDB seconds past J2000) of the extreme.")
    utc: str = Field(description="UTC of the extreme, whole seconds.")
    value: float = Field(description="The extreme's value in this case, beside its instant. `Metric.low` and `Metric.high` are the lowest and highest of the per-case values; with an unknown heading `low` is the pessimistic case's value and `high` the optimistic case's, and there is no nominal.")
    hold_s: float = Field(description="How long the quantity stays at the extreme from that instant (0 for a single instant). Ties report the first instant.")


class Metric(Model):
    key: str
    label: str
    value: Num
    unit: str
    low: Num
    high: Num
    censored: bool
    note: str
    one_sided: bool = Field(description="The range is taken over the worlds that have the event only (the others have none in the analysed span).")
    when: dict[str, MetricInstant | None] = Field(
        description="When the extreme occurs, by horizon case (`nominal`, `optimistic`, `pessimistic`; null for a case with no instant, `nominal` null when the heading is unknown). Only the minimum-state-of-charge metric has it; `{}` for every other metric.")
    when_basis: str = Field(description="How the instants in `when` are located and how exact they are; empty when `when` is empty.")
    when_resolution_s: float | None = Field(description="The signal-grid step the instants are interpolated from, seconds; null when `when` is empty.")


class HazardOrigin(Model):
    origin: Literal["request", "scenario_constraint", "none"]
    label: str | None
    basis: str | None
    source_url: str | None


class Interval(Model):
    start_worlds: list[str] | None = Field(description="The horizon cases (`optimistic`, `nominal`, `pessimistic`) that give the (earliest, latest) of `start_range_utc`; null when the edge does not depend on the horizon.")
    end_worlds: list[str] | None = Field(description="As `start_worlds`, for `end_range_utc`.")
    start_utc: str | None
    end_utc: str | None
    duration_h: Num
    start_range_utc: list[str | None]
    end_range_utc: list[str | None]
    start_censored: bool
    end_censored: bool
    start_range_censored: bool = Field(description="The earliest start in start_range_utc is only the edge of the analysed span: the true bound lies beyond it (one-sided range).")
    end_range_censored: bool = Field(description="The latest end in end_range_utc is only the edge of the analysed span (one-sided range).")
    nominal: bool
    certain: bool


class NextEvent(Model):
    kind: str
    utc: str | None
    et: float
    hours: Num
    range_utc: list[str | None]
    missing_worlds: list[str] = Field(description="Worlds (`optimistic` / `pessimistic`) with no such event in the analysed span: "
                                                  "`range_utc` is then taken over the other worlds only.")
    one_sided: bool = Field(description="`missing_worlds` is not empty: the true bound of the range lies beyond the data.")
    cause: str = Field(description="What set the event: `horizon`, `eclipse` (the Earth's shadow, Sun well above the horizon) or `horizon and eclipse`. `horizon` for contact events.")
    name: str = Field(description="The event named by its cause, to print: `sunset`/`sunrise`, `eclipse start`/`eclipse end`, `sunlight loss`/`sunlight return`, `loss of contact`/`acquisition of contact`.")


class Explanation(Model):
    key: str
    text: str


class Landing(Model):
    utc: str | None
    et: float
    mission_end_utc: str | None
    mission_h: float


class HorizonCurve(Model):
    height_m: float
    ground_height_m: Num
    az_deg: NumArray
    elev_deg: NumArray
    elev_lo_deg: NumArray
    elev_hi_deg: NumArray
    blocker_dist_m: NumArray


class SeriesMeta(Model):
    window: Literal["mission", "all"]
    n_window: int
    n_returned: int
    max_points: int
    decimated: bool
    decimation: str


class Series(BaseModel):
    """Time series on the analysis grid. Per-station curves (`clearance_deg:<station>`, `station_az_deg:<station>`,
    `station_dir_el_deg:<station>` and their `_lo`/`_hi`) are extra keys, all arrays of the same length."""

    model_config = ConfigDict(extra="allow")
    __pydantic_extra__: dict[str, NumArray]

    et: NumArray
    utc: list[str | None]
    t_ms: list[int | None] = Field(description="UTC epoch milliseconds.")
    sun_az_deg: NumArray
    sun_el_deg: NumArray
    sun_ang_radius_deg: NumArray
    earth_az_deg: NumArray
    earth_el_deg: NumArray
    earth_range_km: NumArray
    earth_ang_radius_deg: NumArray = Field(
        description="Angular radius of the Earth's geometric disc (mean radius 6371 km) seen from the site; the "
                    "eclipse fraction uses the Danjon-enlarged occulting radius instead.")
    eclipse_fraction: NumArray
    sunlight_fraction: NumArray
    sunlight_fraction_lo: NumArray
    sunlight_fraction_hi: NumArray
    array_power_w: NumArray
    array_power_w_lo: NumArray
    array_power_w_hi: NumArray
    contact_clearance_deg: NumArray
    contact_clearance_deg_lo: NumArray
    contact_clearance_deg_hi: NumArray
    soc: NumArray
    soc_lo: NumArray
    soc_hi: NumArray
    link_margin_db: NumArray | None = None


class TerrainStackUsed(Model):
    """The terrain stack an analysis ran on (the scenario's `terrain_stores`, or the default stack)."""

    dem_ids: list[str] = Field(description="The stores in the engine's precedence order (finest first); empty for the smooth sphere.")
    stack_hash: str | None = Field(description="SHA-256 over the stores' metadata (the horizon caches are keyed by it); null for the smooth sphere.")
    is_default: bool = Field(description="The provider's stack is exactly the default stack (every installed store). Not the opposite of "
                                         "`restricted`: a list naming every store is restricted and default.")
    restricted: bool = Field(description="The scenario named `terrain_stores`.")
    chosen_by: Literal["scenario", "default", "caller", "none"] = Field(
        description="`scenario`: the scenario's `terrain_stores`; `default`: the engine's default stack; `caller`: a provider supplied by "
                    "the caller (not the service); `none`: smooth sphere, no terrain.")


class ResultBase(Model):
    scenario_sha256: str | None = Field(description="SHA-256 of the canonical scenario (null for multi-scenario results).")
    provider: str = Field(description="`terrain` or `smooth_sphere`.")
    warnings: list[str]
    terrain_stack: TerrainStackUsed | None = Field(description="The terrain stack used (also `provenance.terrain_stack`); null only for results that carry none.")
    provenance: dict[str, Any]


class ScenarioResult(ResultBase):
    scenario: dict[str, Any] | None = Field(description="The scenario document that was evaluated (as resolved).")


class LimitNote(Model):
    """A stated limit of the model that applies to this result, with the validation report it rests on."""

    id: str = Field(description="Stable dotted lower-case id, one per concept and never reused (the registry is `lunarnav.report.limits`): key on this, not on `text` or `category`.")
    title: str = Field(description="One-line title of the note.")
    kind: Literal["assumed", "not_modelled", "model_limit", "known_miss"] = Field(description="Machine-readable kind: group and highlight on this, never on `category`.")
    category: str = Field(description="Display heading of the note (what it is measured against, for a known miss). Text for people; its wording may change.")
    text: str = Field(description="The statement, with the measured numbers.")
    parameters: dict[str, Any] = Field(description="The values `text` quotes, by name (e.g. `k_sigma`, `step_s`, `dem_id`, `pixel_m`), for a screen that formats its own sentence.")
    source: str = Field(description="Validation report and section, e.g. `imagery.md section 'What a planner can take from this', item 1`; the file is under `docs/validation/`.")
    quote: str = Field(description="Phrase copied from that report that supports `text`.")
    more: list[str] = Field(description="Further quoted phrases that carry the other numbers in `text`; empty when `quote` covers it.")


class HeadingConstraint(Model):
    key: str
    unit: str
    limit_min: Num
    values_by_heading: NumArray = Field(description="Constraint value (nominal horizon) at each heading of `heading.yaws_deg`.")
    passing_deg: list[list[float]] = Field(description="Arcs of headings over which the constraint passes, [from, to] clockwise, wrapping through north if from > to.")
    all_pass: bool
    none_pass: bool


class HeadingResult(Model):
    """Heading state and its effect on the power-dependent results."""

    known: bool = Field(description="The heading is stated by the planner or the catalogue. False: unknown, no nominal heading exists.")
    nominal_yaw_deg: Num
    nominal_basis: str
    uncertainty_deg: float = Field(description="Stated heading's uncertainty either side (0 when unknown: all headings are evaluated).")
    depends: bool = Field(description="Array power differs between headings at some instant; false: heading is irrelevant here.")
    yaws_deg: list[float]
    best_yaw_deg: Num = Field(description="Heading with the highest minimum state of charge on the nominal horizon.")
    worst_yaw_deg: Num = Field(description="Heading with the lowest minimum state of charge on the nominal horizon.")
    worst_arc_deg: list[list[float]] = Field(description="Arcs of headings, [from, to] clockwise, that tie the worst minimum state of charge (a single point for an isolated minimum).")
    constraints: list[HeadingConstraint]
    soc_min_total: list[float] | None = Field(description="(pessimistic, optimistic) minimum state of charge under the full bound.")
    soc_min_heading_only: list[float] | None
    soc_min_horizon_only: list[float] | None
    cause: str = Field(description="`heading`, `terrain`, `both` or `none`: which bound moved the minimum state of charge.")


class WorldEvent(Model):
    """One edge of the margin-setting interval in one horizon world (`scenario.bound_attribution.WorldEvent`)."""

    world: str = Field(description="`nominal`, `optimistic` or `pessimistic`.")
    et: Num = Field(description="Ephemeris seconds of the edge; null when this world has no such interval.")
    utc: str = Field(description="UTC of the edge; empty when this world has no such interval.")
    clipped: bool = Field(description="The edge lies outside the mission window or at the data edge; durations use the clipped edge.")
    az_deg: Num = Field(description="Azimuth of the limiting horizon point (Sun events) or of the station / Earth (contact events).")
    horizon_elev_deg: Num
    blocker_dist_m: Num
    blocker: dict[str, float] | None
    cause: str


class BoundEvent(Model):
    """One edge kind (`role` start or end of the interval) over the three worlds."""

    kind: str
    role: str
    worlds: list[WorldEvent]
    contribution_h: Num = Field(description="Contribution to (longest - shortest) interval duration, hours (signed); null when the constraint is not `decomposable`.")
    share: Num = Field(description="`contribution_h` over the total spread; null when the worlds do not differ.")


class ConstraintBound(Model):
    """Why one constraint's three cases differ (`scenario.bound_attribution.ConstraintBound`)."""

    key: str
    label: str
    unit: str
    value: Num
    value_range: list[float] | None
    margin: Num
    margin_worst: Num
    interval_kind: str = Field(description="`dark`, `contact_gap` or `sunlit`.")
    interval_hours: dict[str, float] = Field(description="Mission-clipped duration of the margin-setting interval per world.")
    same_interval: bool = Field(description="All three worlds' intervals overlap in time (the worlds differ in the edges, not in which night).")
    spread_h: float
    decomposable: bool = Field(description="The event contributions are like-for-like (the same interval in the longest and the shortest case) and add up to `spread_h`.")
    decomposition_note: str = Field(description="Why the contributions are, or are not, a decomposition of `spread_h`.")
    explained_quantity: str = Field(description="What the edge shares explain; says when they do not set the value.")
    world_soc: dict[str, float | None] | None = Field(description="Minimum state of charge per case; the nominal one is null when the lander heading is unknown.")
    world_soc_note: str = Field(description="What world_soc means when the heading is unknown and matters (no nominal case); empty otherwise.")
    events: list[BoundEvent]
    cause: str = Field(description="`heading`, `terrain`, `both` or `none`: which bound moves the quantity. Only the minimum state of charge depends on heading.")
    contributions: dict[str, list[float] | None] | None = Field(
        description="Minimum state of charge: the (pessimistic, optimistic) range under `total`, `heading` alone and `terrain` alone; null otherwise.")
    note: str


class EvaluateResult(ScenarioResult):
    kind: Literal["evaluate"]
    limits: list[LimitNote] = Field(description="The model limits that apply to this evaluation (chosen from its latitude, terrain store, sampling, shadow convention and profile), in reading order. The same notes as the report's limits section.")
    landing: Landing
    verdict: Verdict
    explanations: list[Explanation]
    metrics: list[Metric]
    intervals: dict[str, list[Interval]] = Field(description="Keys: `sunlit`, `dark`, `eclipse`, `contact`, `contact:<station id>` (one per station) and `contact_gap`.")
    next_events_from_utc: str | None
    next_events: dict[str, NextEvent | None] = Field(description="null when the event does not occur in the analysed span.")
    slope_deg: Num
    horizons: dict[Literal["array", "antenna"], HorizonCurve]
    series_meta: SeriesMeta
    series: Series
    heading: HeadingResult | None = Field(description="Heading state and its effect on the power-dependent results (null if not evaluated).")
    bounds: list[ConstraintBound] | None = Field(
        description="Per constraint set by one interval whose three cases differ: which bound (heading, terrain, both, none) moves it and "
                    "which horizon edges. Null when the request set `with_bounds` false.")


class Lunation(Model):
    number: int
    start_utc: str | None
    end_utc: str | None


class Calendar(Model):
    bin_h: float
    keys: list[str]
    lunations: list[Lunation]
    state: list[list[float | None]]
    open_fraction: list[list[float | None]]
    limiting: list[list[float | None]]
    local_solar_time_h: list[list[float | None]]
    sun_el_deg: list[list[float | None]]
    legend: str


NORMALISED_MARGIN = (
    "Dimensionless normalised margin: the signed margin of the limiting constraint divided by its `margin_scale` "
    "(a constraint property in its own unit; see `margin_scales`). 0 is on the limit, positive inside it, 1 is one "
    "scale unit of headroom; margins of constraints in different units are compared in this scale. It is the "
    "pessimistic-case margin of the limiting constraint (the nominal one only for a FAIL epoch), and null where the "
    "limiting quantity is undefined (for example the minimum state of charge at an unknown heading).")


class MarginScale(Model):
    unit: str
    margin_scale: float = Field(description="Size of the margin, in `unit`, that counts as 1.0 normalised.")


class OpenWindow(Model):
    start_utc: str | None
    end_utc: str | None
    n_candidates: int
    n_pass: int
    duration_h: float = Field(description="Hours from the first to the last open candidate (0 for a single candidate). The true edges lie "
                                          "within one `spacing_h` beyond either end, so the open interval can be up to `duration_h + 2 * spacing_h` long.")
    best_utc: str | None
    best_margin: Num = Field(description=NORMALISED_MARGIN)
    best_margin_physical: Num = Field(
        description="The same margin in the unit of the limiting constraint (`best_margin_unit`): normalised margin x "
                    "that constraint's `margin_scale`. Positive inside the limit. null when no constraint limits.")
    best_margin_unit: str | None = Field(description="Unit of `best_margin_physical` (deg, h, %, ...).")
    best_state: str
    best_margin_kind: MARGIN_KIND = Field(description="`worst_case`, `nominal` (a failing candidate) or `best_case` (see `best_margin_note`).")
    best_margin_note: str | None = Field(description="The engine's sentence for a `best_case` margin (no nominal: the heading is unknown), else null.")
    best_limiting: str | None
    robust: list[list[str | None]]
    spacing_h: float = Field(description="Candidate spacing in hours.")


class Candidates(Model):
    n_candidates: int
    n_returned: int
    decimated: bool
    et: NumArray
    utc: list[str | None]
    t_ms: list[int | None]
    state: list[int] = Field(description="0 fail, 1 marginal, 2 pass (see `states`).")
    worst_margin: NumArray = Field(description=NORMALISED_MARGIN + " Per candidate, for its worst (limiting) constraint.")
    worst_margin_physical: NumArray = Field(description="`worst_margin` x the limiting constraint's `margin_scale`, in `margin_unit`.")
    margin_unit: list[str | None] = Field(description="Unit of `worst_margin_physical` per candidate (that of its limiting constraint).")
    margin_kind: list[Literal["worst_case", "nominal", "best_case"] | None] = Field(
        description="Per candidate (`OpportunityScan.margin_kinds`): which case `worst_margin` is, `worst_case` (pessimistic), `nominal` (a failing candidate) or `best_case` (a failing candidate limited by the minimum state of charge with an unknown heading); null without a margin.")
    margin_note: list[str | None] = Field(description="Per candidate: the engine's sentence for a `best_case` margin, else null.")
    margin_scales: dict[str, MarginScale] = Field(description="`margin_scale` and unit of every applied constraint (the normalisation).")
    limiting: list[str | None]
    local_solar_time_h: NumArray
    sun_el_deg: NumArray
    values: dict[str, NumArray] = Field(description="Nominal value of each scanned constraint quantity per candidate.")
    values_optimistic: dict[str, NumArray] = Field(description="The same quantities in the optimistic world (the engine's second value).")
    values_pessimistic: dict[str, NumArray] = Field(description="The same quantities in the pessimistic world (the engine's third value).")


class ScanResult(ScenarioResult):
    kind: Literal["scan"]
    start_utc: str
    end_utc: str
    spacing_s: float
    states: dict[str, int]
    counts: dict[str, int]
    closing_constraints: dict[str, int]
    state_fraction: dict[str, Num] = Field(description="`counts` over the number of candidates.")
    closing_fraction: dict[str, Num] = Field(description="`closing_constraints` over the number of failing candidates (null when none fails).")
    limits: list[LimitNote] = Field(description="The model limits of the scenario's evaluation selected over the whole scanned range (as the report's limits section for a report with this scan).")
    windows: list[OpenWindow]
    calendar: Calendar
    candidates: Candidates


class SlipRow(Model):
    slip_h: float
    launch_utc: str | None
    landing_utc: str | None
    state: str
    limiting: str | None
    margin: Num = Field(description=NORMALISED_MARGIN)
    margin_kind: MARGIN_KIND = Field(description="`worst_case`, `nominal` (a failing row) or `best_case` (see `margin_note`); null without a margin.")
    margin_note: str | None = Field(description="Why the row has no margin, in the engine's words (no landing for the launch, or the heading-dependent constraints); null when it has one.")
    verdict: Verdict | None
    explanation: str
    next_open_utc: str | None
    next_open_wait_h: Num
    next_open_state: str | None
    next_open_candidates: int | None = Field(description="Number of consecutive open candidates in the open window that starts at `next_open_utc`.")
    next_open_span_h: Num = Field(description="Hours from the first to the last open candidate of that window (0 for a single candidate).")
    candidate_spacing_h: Num = Field(description="Spacing of the candidate landings the window is counted on, hours.")


class SlipSiteResult(Model):
    scenario_name: str = Field(description="Unique within the result: `<scenario> @ <site name>`; alternatives that share a "
                                           "name carry their catalogue id or coordinates in brackets.")
    site_id: str | None = Field(description="Catalogue id of the site (null for a free coordinate).")
    site_name: str | None = Field(description="Display name of the site, made unique among the alternatives.")
    site: dict[str, Any]
    mode: str
    n_pass: int
    n_open: int
    mean_margin: Num = Field(description="Mean over the slip rows of `rows[].margin` (rows without a margin are skipped): the same "
                                         "case and normalisation as `SlipRow.margin`. Null when no row has a margin. Used with `n_pass` and "
                                         "`n_open` to rank sites.")
    scenario_sha256: str | None
    provenance: dict[str, Any] = Field(description="Provenance of this site's analysis (its own scenario hash and horizon provider).")
    rows: list[SlipRow]


class SlipResult(ResultBase):
    kind: Literal["slip"]
    scenario: dict[str, Any] | None
    mode: str
    slips_h: list[float]
    ranked: bool
    ranking_key: str
    limits: list[LimitNote] = Field(description="The model limits of everything the slip evaluated: the scenario's evaluation selected over every slip row (`slip_limits`), or with `alternative_sites` the union over every ranked site (`rank_limits`).")
    results: list[SlipSiteResult]


class SensitivityRow(Model):
    label: str
    value: float
    az_deg: Num
    lat_deg: float
    lon_deg: float
    state: str
    limiting: str | None
    metrics: dict[str, Num]
    margins: dict[str, Num]
    when: dict[str, dict[str, MetricInstant | None]] = Field(
        description="When the extreme of a metric occurs in this variant, by metric key then horizon case (as `Metric.when`; only the minimum state of charge has it, so `{}` for a variant without it).")


class SensitivityResult(ScenarioResult):
    kind: Literal["sensitivity-height", "sensitivity-position"]
    limits: list[LimitNote] = Field(description="The limits that apply to the baseline evaluation (as `evaluate`).")
    variant: str
    baseline: SensitivityRow
    rows: list[SensitivityRow]


class EventAttribution(Model):
    kind: str
    et: float
    utc: str
    az_deg: float
    horizon_elev_deg: float
    object_elev_deg: float
    blocker_dist_m: Num
    blocker: dict[str, float] | None
    cause: str
    station: str | None
    limiting_side: str | None
    detail: str
    time_basis: str = Field(description="What `utc` is: `limb crossing` (the Sun's disc crossing the horizon) or `half-flux event` "
                                        "(the Earth eclipse or the flux threshold set the event; not a limb crossing).")
    eclipse_fraction: float = Field(description="Fraction of the Sun's disc covered by the Earth at the event instant (0 = none).")
    limb_crossing: bool = Field(description="The event is a terrain-limb crossing; false: do not present `utc` as a crossing.")


class AzimuthAttribution(Model):
    az_deg: float
    requested_az_deg: float
    observer: Literal["array", "antenna"]
    observer_height_m: float
    horizon_elev_deg: float
    blocker_dist_m: Num
    blocker: dict[str, float] | None


class AttributionResult(ScenarioResult):
    kind: Literal["attribution"]
    event_kind: str | None
    from_utc: str | None
    limits: list[LimitNote] = Field(description="The model limits of the evaluation the attribution read (`attribution_limits`).")
    event: EventAttribution | None = None
    message: str | None = None
    azimuth: AzimuthAttribution | None = None


class CompareMetric(Model):
    key: str
    label: str
    unit: str
    values: list[float | None]
    low: list[float | None]
    high: list[float | None]
    when: list[dict[str, MetricInstant | None]] = Field(
        description="Per compared scenario, aligned with `values`: when the extreme occurs by horizon case (as `Metric.when`); `{}` for a metric without it. The basis and resolution are those of `evaluate`'s `Metric.when_basis` and `when_resolution_s`.")


class CompareScenario(Model):
    name: str
    state: str
    limiting: str | None
    verdict: Verdict
    scenario_sha256: str | None
    landing_utc: str | None
    site: dict[str, Any]


class CompareResult(ResultBase):
    kind: Literal["compare"]
    names: list[str]
    limits: list[LimitNote] = Field(description="The union of the limits of every compared scenario's own evaluation (as the report's limits section for a report with this comparison).")
    metrics: list[CompareMetric]
    scenarios: list[CompareScenario]


class HorizonSite(Model):
    lat_deg: float
    lon_deg: float
    height_m: float


class HorizonPeak(Model):
    az_deg: float
    elev_deg: float
    blocker_dist_m: Num
    blocker: dict[str, float] | None


class HorizonResult(ResultBase):
    kind: Literal["horizon"]
    limits: list[LimitNote] = Field(description="The terrain and smooth-sphere limits that apply to a horizon at this place (`horizon_limits`; no scenario, so no time, power or contact note).")
    site: HorizonSite
    ground_height_m: Num
    n_az: int
    az_deg: NumArray
    elev_deg: NumArray
    elev_lo_deg: NumArray
    elev_hi_deg: NumArray
    blocker_dist_m: NumArray
    max_elev_deg: float
    max_elev_az_deg: float
    sphere_dip_deg: float
    peaks: list[HorizonPeak]


class SampleRef(Model):
    index: int
    lat_deg: float
    lon_deg: float
    east_m: float
    north_m: float
    state: str
    worst_margin: Num = Field(description="Normalised margin of the limiting constraint: the worst-case (pessimistic) margin, except the nominal one for a FAIL sample.")
    worst_margin_physical: Num = Field(description="`worst_margin` x the limiting constraint's `margin_scale`, in `margin_unit`; null when no constraint limits.")
    margin_unit: str | None = Field(description="Unit of `worst_margin_physical` (that of the limiting constraint).")
    margin_kind: MARGIN_KIND = Field(description="`worst_case`, `nominal` (a failing point) or `best_case` (see `margin_note`); the engine's rule, `lunarnav.scenario.margin_kind`. Null without a margin.")
    margin_note: str | None = Field(description="The engine's sentence for a `best_case` margin (no nominal: the heading is unknown), else null.")
    limiting: str | None
    slope_deg: Num
    roughness_m: Num


class EllipseMapGrid(Model):
    spacing_m: float
    east_m: list[list[float]] = Field(description="East offset of each node from the site (m), rows north to south.")
    north_m: list[list[float]]
    state: list[list[int]] = Field(description="Verdict code per node (rows north to south); outside the ellipse the engine's `OUTSIDE` code.")
    worst_margin: list[list[Num]] = Field(description=NORMALISED_MARGIN + " null outside the ellipse or when undefined.")


class EllipseResult(ScenarioResult):
    kind: Literal["ellipse"]
    limits: list[LimitNote] = Field(description="The limits of the ellipse analysis (sample fractions, truncated dispersion, terrain vertical accuracy).")
    scenario_name: str
    n_samples: int
    seed: int
    scheme: str
    truncated_to_ellipse: bool
    keys: list[str]
    state_probability: dict[str, Num]
    state_probability_non_hazardous: dict[str, Num]
    hazard_fraction: Num
    hazard_limits: dict[str, Num]
    hazard_origins: dict[str, HazardOrigin] = Field(description="Where each hazard limit (`slope_deg`, `roughness_m`) came from: the request, the scenario's constraint (with its label and basis), or none.")
    closing_constraints: dict[str, int] = Field(description="Failing samples per constraint that limits them (the ellipse counterpart of the scan's `closing_constraints`).")
    closing_fraction: dict[str, Num] = Field(description="`closing_constraints` over the number of failing samples (null when no sample fails).")
    constraint_probability: dict[str, dict[str, Num]] = Field(description="Per constraint: `pass`, `not_fail`, `unknown`.")
    percentiles: dict[str, dict[str, Num]]
    best: SampleRef
    worst: SampleRef
    centre: SampleRef
    convergence: dict[str, Any]
    map: EllipseMapGrid | None
    samples: dict[str, Any] | None = Field(default=None, description="Only with `with_samples`: per-sample arrays `east_m`, `north_m`, `lat_deg`, `lon_deg`, `state`, "
                                                                    "`worst_margin`, and the service's `limiting`, `worst_margin_physical`, `margin_unit` (the margin in the limiting constraint's unit) and "
                                                                    "`margin_kind` (`worst_case` | `nominal` | null per sample). Typed as a free object: the arrays are all the length of `state`.")


class RankedSite(Model):
    rank: int
    lat_deg: float
    lon_deg: float
    east_m: float
    north_m: float
    state: str
    worst_margin: Num = Field(description=NORMALISED_MARGIN)
    worst_margin_physical: Num = Field(description="`worst_margin` x the limiting constraint's `margin_scale`, in `margin_unit`; null when no constraint limits.")
    margin_unit: str | None = Field(description="Unit of `worst_margin_physical` (that of the limiting constraint).")
    margin_kind: MARGIN_KIND = Field(description="`worst_case`, `nominal` (a failing point) or `best_case` (see `margin_note`); the engine's rule, `lunarnav.scenario.margin_kind`. Null without a margin.")
    margin_note: str | None = Field(description="The engine's sentence for a `best_case` margin (no nominal: the heading is unknown), else null.")
    limiting: str | None
    landing_utc: str
    n_epochs_pass: int
    n_epochs: int
    slope_deg: Num
    roughness_m: Num
    values: dict[str, Num]
    constraint_state: dict[str, str]


class SearchLevel(Model):
    spacing_m: float
    n_candidates: int
    n_slope_pruned: int
    n_evaluated: int
    n_promoted: int
    horizon: str
    seconds: float
    capped: bool


class SearchResult(ScenarioResult):
    kind: Literal["search"]
    limits: list[LimitNote] = Field(description="The limits of the site search (pruning heuristic and its measured recall, terrain vertical accuracy).")
    sites: list[RankedSite]
    levels: list[SearchLevel]
    counts: dict[str, int]
    settings: dict[str, Any]
    seconds: float
    n_full_evaluations: int
    n_exhaustive_equivalent: int
    grid: dict[str, Any] | None = Field(default=None, description="Final lattice (`score`, `state`, `status`, ...); only with `with_grid`.")


class BracketCoverage(Model):
    """How often the estimated bracket contained the exact value on independent cells (it can miss; it is not a guaranteed bound)."""

    coverage: float = Field(description="Share of the independent cells whose exact value lay inside [lo, hi].")
    misses: int
    cells: int
    calibration_target: float = Field(description="The coverage the bracket was calibrated for.")


class RegionalValidation(Model):
    """A measurement at the reference configuration (mast 0 m, default stack, any_part / any_part, 32 calibration cells)."""

    configuration: str = Field(description="The reference configuration the measurement was made at.")
    applies_to_run: bool | None = Field(description="Whether this run uses that configuration (null when the run's is not known).")
    bracket_coverage: BracketCoverage
    measured_error: dict[str, Any] = Field(description="`unit`, `mean_signed`, `mean_abs`, `p95_abs`, `p99_abs`, `max_abs`: regional minus exact, in the layer's `error_unit`.")
    measured_by: str = Field(description="Where the error was measured.")


class RegionalSupport(Model):
    """What a layer's per-cell value can be relied on for (`lunarnav.regional.support`, measured in docs/validation/illumination.md)."""

    point_value: Literal["supported", "approximate", "bracket_only", "exact_input", "bracket"] = Field(
        description="`supported` / `approximate`: the value may be shown with its measured error; `bracket_only`: never show the value "
                    "alone, show [lo, hi] from `bracket_layers`; `exact_input`: an input of the computation; `bracket`: this layer is "
                    "the low or high end of the estimated bracket of `bracket_of`.")
    unit: str | None = Field(description="Unit of the value: `fraction (0-1)` (not percentage points), hours, degrees, metres.")
    error_unit: str | None = Field(description="Unit of the errors: `percentage points` for fractions, `hours` for run lengths; null for an exact input.")
    role: str = Field(description="`estimate`, `input`, `bracket low` or `bracket high`.")
    bracket_layers: list[str] = Field(description="The `<layer>_lo` / `<layer>_hi` layers that bracket this one (empty for exact inputs and for the bracket layers themselves).")
    run_measured_error: dict[str, float] | None = Field(
        description="Error of THIS run on its calibration cells, regional minus exact, in `error_unit` (`mean_signed`, `mean_abs`, `p95_abs`, "
                    "`max_abs`, `n_cells`); null when the run did not calibrate (`calibrate` 0) or for an input / bracket layer.")
    run_measured_on: str | None = Field(description="The configuration of this run's calibration; null with `run_measured_error`.")
    validation: RegionalValidation | None = Field(
        description="Measurement at the reference configuration, with the measured bracket coverage; null for an exact input. The `_lo` / `_hi` "
                    "records carry the base layer's. `applies_to_run` says whether this run uses that configuration.")
    note: str
    bracket_of: str | None = Field(default=None, description="For a bracket layer: the layer it brackets.")
    bracket_low_horizon: Literal["raised", "lowered"] | None = Field(
        default=None, description="How the horizon is moved to make the `_lo` layer: `lowered` for a statistic that grows with the horizon (a run of shadow or outage is "
                                  "smallest there), `raised` for one that falls with it (illumination). Null for an exact input and for a bracket layer.")
    bracket_high_horizon: Literal["raised", "lowered"] | None = Field(default=None, description="The other direction: how the horizon is moved to make the `_hi` layer.")
    horizon_shift: Literal["raised", "lowered"] | None = Field(default=None, description="For a bracket layer: the way its horizon is moved (`raised` or `lowered`).")


class RegionalLayerInfo(Model):
    name: str
    support: RegionalSupport | None = Field(description="Null for a layer without a support record (the `verdict` layer).")
    file: ExportFile
    dtype: str
    n_nodata: int
    min: Num
    max: Num
    mean: Num


class RegionalResult(Model):
    kind: Literal["regional"]
    warnings: list[str]
    spec: dict[str, Any] = Field(description="Grid: polar-stereographic origin (centre of cell row 0, col 0), size, spacing, period, rules.")
    geotransform: list[float]
    layers: list[RegionalLayerInfo]
    files: list[ExportFile] = Field(description="GeoTIFF per layer and `header.json` (method, calibration, timings).")
    inline: dict[str, list[list[Num]]]
    layer_support: dict[str, RegionalSupport] = Field(description="Support record of every layer that has one (also in `header.layer_support` and in the GeoTIFF band tags).")
    header: dict[str, Any]
    provenance: dict[str, Any]


RESULT_MODELS: dict[str, type[BaseModel]] = {
    "evaluate": EvaluateResult,
    "scan": ScanResult,
    "slip": SlipResult,
    "sensitivity-height": SensitivityResult,
    "sensitivity-position": SensitivityResult,
    "attribution": AttributionResult,
    "compare": CompareResult,
    "horizon": HorizonResult,
    "ellipse": EllipseResult,
    "search": SearchResult,
    "regional": RegionalResult,
}


class JobResult(RootModel[
    EvaluateResult | ScanResult | SlipResult | SensitivityResult | AttributionResult | CompareResult | HorizonResult
    | EllipseResult | SearchResult | RegionalResult | ExportManifest
]):
    """Everything `GET /jobs/{id}/result` can return: the result model of the job's kind (`analysis.evaluate` ->
    `EvaluateResult`, ..., `analysis.export` -> `ExportManifest`); other kinds (ephemeris, ...) return their own
    documented bodies. Analysis results carry a `kind` field naming the model."""
