"""Request and response models of the scenario-based endpoints (profiles, presets, analyses, exports).

Imports the scenario module directly, so it is only imported by routers that need it; `app.py` skips those
routers (and `/meta` reports `scenario_module_available: false`) if the import fails.
"""

from __future__ import annotations

import math
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator, model_validator

from lunarnav.api import limits as lim
from lunarnav.api.limits import MAX_REGIONAL_CELLS, MAX_SEARCH_LATTICE, ceil_2sf, finite_tree, span_s
from lunarnav.api.schemas import SCENARIO_ID_PATTERN
from lunarnav.api.schemas_ephem import check_utc
from lunarnav.scenario.models import Constraints, LanderProfile, Network, Scenario, TerrainErrorSettings


class Strict(BaseModel):
    """Request models refuse unknown fields and non-finite numbers (`NaN`, `Infinity`)."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


UtcStr = Annotated[str, AfterValidator(check_utc)]
"""A UTC instant `YYYY-MM-DDTHH:MM:SS[.fff]Z` naming a real calendar date; coverage of the ephemeris is checked
when the job runs (the refusal quotes the covered range)."""


class ProfileEstimate(BaseModel):
    """A profile field whose value is not published: flag it in the UI."""

    path: str = Field(description="Field path inside the profile, e.g. `battery.capacity_wh`.")
    basis: str = Field(description="`estimate`, `derived`, `convention`, `historical`, `mission-specific` or `model-typed`.")
    label: str
    source_url: str | None = None
    note: str = ""


class ProfileEntry(BaseModel):
    id: str = Field(description="Stable id: a catalogue lander id, `<lander>-polar`, or `generic-<layout>`.")
    source: Literal["catalog", "generic"]
    lander_id: str | None = Field(description="Catalogue lander id for `source = catalog`.")
    variant: str = Field(description="`default` or `polar` for catalogue entries; the layout name for generic ones.")
    name: str
    description: str
    profile: LanderProfile
    estimates: list[ProfileEstimate] = Field(description="Every origin that is not published or user-entered.")
    n_published: int = Field(description="Number of fields whose origin is published.")


class ProfilesResponse(BaseModel):
    profiles: list[ProfileEntry]
    layouts: list[str] = Field(description="Layout names accepted for generic profiles.")


class ConstraintPresetEntry(BaseModel):
    name: str
    description: str
    constraints: Constraints = Field(description="Each limit carries `origin` (basis, label, source_url).")


class ConstraintPresetsResponse(BaseModel):
    presets: list[ConstraintPresetEntry]


class NetworkPresetEntry(BaseModel):
    id: str
    label: str
    description: str
    station_ids: list[str]
    network: Network


class NetworkPresetsResponse(BaseModel):
    presets: list[NetworkPresetEntry]


TerrainMode = Literal["auto", "on", "off"]


class ScenarioRef(Strict):
    """Which scenario an analysis runs on: an inline document, or a stored id with optional overrides."""

    scenario: Scenario | None = Field(default=None, description="Inline scenario document.")
    scenario_id: str | None = Field(default=None, pattern=SCENARIO_ID_PATTERN, description="Id of a stored scenario (`scen-` and 12 hex digits).")
    overrides: dict[str, Any] = Field(
        default_factory=dict,
        description="JSON-merge-patch applied to the stored or inline document before validation: objects merge "
        "recursively, anything else replaces, `null` removes the key (use it to switch a constraint off). "
        "Example: `{\"site\": {\"lat_deg\": -89.5}, \"landing_utc\": \"2028-03-01T00:00Z\"}`.")
    terrain: TerrainMode = Field(
        default="auto",
        description="`on` uses the terrain stores (error if none are installed), `off` the smooth sphere, `auto` "
        "terrain when stores are installed and the sphere otherwise (the result's `provider` and `warnings` say which).")
    wait_s: float = Field(
        default=3.0, ge=0.0, le=30.0,
        description="Seconds to wait for the result before answering 202 with a job status.")

    @model_validator(mode="after")
    def _one_source(self) -> ScenarioRef:
        if (self.scenario is None) == (self.scenario_id is None):
            raise ValueError("give exactly one of `scenario` and `scenario_id`")
        if not finite_tree(self.overrides):
            raise ValueError("`overrides` must not contain NaN or Infinity")
        return self


class EvaluateRequest(ScenarioRef):
    from_utc: UtcStr | None = Field(
        default=None, description="Epoch for next-event countdowns (default: the landing).")
    max_points: int = Field(default=2000, ge=100, le=20000, description="Series size after min/max-preserving decimation.")
    window: Literal["mission", "all"] = Field(default="mission", description="Series span: landing to end, or the whole analysed span.")
    with_bounds: bool = Field(default=True, description="Add `bounds`: the cause of each constraint's range (`scenario.bound_attribution`).")


class ScanParams(Strict):
    start_utc: UtcStr = Field(description="First landing candidate (UTC).")
    end_utc: UtcStr = Field(description="Last landing candidate (UTC, inclusive).")
    spacing_s: float = Field(default=3600.0, ge=600.0, le=lim.MAX_SPACING_S, description="Candidate spacing; a multiple of `signal_step_s`.")
    signal_step_s: float = Field(default=1800.0, ge=300.0, le=3600.0, description="Signal step; at most 3600 s, the engine limit.")
    lookback_h: float = Field(default=720.0, ge=0.0, le=lim.MAX_LOOKBACK_H, description="Signal before the first candidate.")
    calendar_bin_h: float = Field(default=6.0, gt=0.0, le=720.0)
    max_candidates: int = Field(
        default=4000, ge=100, le=20000,
        description="Size of the candidate series after decimation (windows and calendar are never decimated). Every state "
        "change is kept, so `candidates.n_returned` can exceed this.")

    @model_validator(mode="after")
    def _bounded(self) -> ScanParams:
        span = span_s(self.start_utc, self.end_utc)
        if span < 0:
            raise ValueError(f"`end_utc` {self.end_utc} is before `start_utc` {self.start_utc}")
        n = int(span // self.spacing_s) + 1
        if n > lim.MAX_SCAN_CANDIDATES:
            fit_days = (lim.MAX_SCAN_CANDIDATES - 1) * self.spacing_s / 86_400.0
            raise ValueError(
                f"the scan has {n:,} landing candidates (limit {lim.MAX_SCAN_CANDIDATES:,}). At `spacing_s` {self.spacing_s:g} "
                f"a span of up to {fit_days:,.0f} days fits; for this {span / 86_400.0:,.0f}-day span use `spacing_s` of at "
                f"least {ceil_2sf(span / (lim.MAX_SCAN_CANDIDATES - 1)):g}")
        epochs = (span + self.lookback_h * 3600.0) / self.signal_step_s + 1
        if epochs > lim.MAX_SCAN_SIGNAL_EPOCHS:
            fit_days = ((lim.MAX_SCAN_SIGNAL_EPOCHS - 1) * self.signal_step_s - self.lookback_h * 3600.0) / 86_400.0
            raise ValueError(
                f"the scan needs {epochs:,.0f} signal epochs (span plus `lookback_h` at `signal_step_s` {self.signal_step_s:g}; "
                f"limit {lim.MAX_SCAN_SIGNAL_EPOCHS:,}). " + (
                    f"A span of up to {fit_days:,.0f} days fits at this step and lookback; or raise `signal_step_s`."
                    if fit_days > 0 else "Reduce `lookback_h` or raise `signal_step_s`."))
        return self


class ScanRequest(ScenarioRef, ScanParams):
    pass


class AltSite(Strict):
    name: str
    lat_deg: float = Field(ge=-90.0, le=90.0)
    lon_deg: float = Field(ge=-360.0, le=360.0)


class SlipParams(Strict):
    slips_h: list[Annotated[float, Field(ge=-lim.MAX_SLIP_H, le=lim.MAX_SLIP_H)]] = Field(
        min_length=1, max_length=200, description=f"Slips in hours (negative = earlier), each within +-{lim.MAX_SLIP_H:g}.")
    mode: Literal["landing", "launch"] = Field(
        default="landing", description="`launch` maps each slip through the scenario's transfer (needs `transfer`).")
    search_days: float = Field(default=60.0, gt=0.0, le=730.0, description="How far past the last slip to look for the next open landing.")
    spacing_s: float = Field(default=3600.0, ge=600.0, le=lim.MAX_SPACING_S)
    alternative_sites: list[str] = Field(
        default_factory=list, max_length=40,
        description="Catalogue site ids ranked as alternatives (the scenario's own site is always ranked too).")
    alternative_coordinates: list[AltSite] = Field(default_factory=list, max_length=40)

    @model_validator(mode="after")
    def _bounded(self) -> SlipParams:
        sites = 1 + len(self.alternative_sites) + len(self.alternative_coordinates)
        span = (max(self.slips_h) - min(self.slips_h)) * 3600.0 + self.search_days * 86_400.0
        n = int(span // self.spacing_s) + 1
        if n * sites > lim.MAX_SLIP_CANDIDATE_SITES:
            per_site = lim.MAX_SLIP_CANDIDATE_SITES // sites
            fit_days = max((per_site - 1) * self.spacing_s - (max(self.slips_h) - min(self.slips_h)) * 3600.0, 0.0) / 86_400.0
            raise ValueError(
                f"the slip analysis has {n:,} candidate landings at each of {sites} site(s) = {n * sites:,} (limit "
                f"{lim.MAX_SLIP_CANDIDATE_SITES:,}). With these slips and sites `search_days` of at most {fit_days:,.0f} fits "
                "at this spacing; or raise `spacing_s`, or give fewer slips or sites")
        return self


class SlipRequest(ScenarioRef, SlipParams):
    pass


class HeightSensitivityRequest(ScenarioRef):
    kind: Literal["array", "antenna"] = "antenna"
    heights_m: list[Annotated[float, Field(ge=0.0, le=lim.MAX_HEIGHT_M)]] = Field(
        min_length=1, max_length=40, description=f"Observer heights above ground, 0 to {lim.MAX_HEIGHT_M:g} m.")


class PositionSensitivityRequest(ScenarioRef):
    distances_m: list[Annotated[float, Field(gt=0.0, le=lim.MAX_SHIFT_M)]] | None = Field(
        default=None, max_length=20,
        description=f"Shift distances, each above 0 and at most {lim.MAX_SHIFT_M:,.0f} m (a landing-dispersion study around "
        "the site; a larger move is another site: use `slip` alternatives or `search`). Default: the ellipse axes or 100, 500, 1000 m.")


class AttributionRequest(ScenarioRef):
    """Attribute a sunrise/sunset/Earth event (`kind`, after `from_utc`) and/or an azimuth of the horizon
    (`az_deg`, seen by `observer`) to the terrain that blocks it."""

    kind: Literal["sunset", "sunrise", "earthset", "earthrise"] | None = None
    from_utc: UtcStr | None = None
    window_h: float = Field(default=12.0, gt=0.0, le=240.0)
    az_deg: float | None = Field(default=None, ge=-360.0, le=720.0, description="Azimuth clockwise from north.")
    observer: Literal["array", "antenna"] = Field(default="array", description="Which observer height `az_deg` refers to.")

    @model_validator(mode="after")
    def _something(self) -> AttributionRequest:
        if self.kind is None and self.az_deg is None:
            raise ValueError("give an event `kind` and/or an `az_deg`")
        return self


def refuse_item_options(items: list[ScenarioRef], where: str) -> None:
    """`terrain` and `wait_s` belong to the whole request, never to one scenario in it: setting them on an item
    would be silently ignored, so it is refused."""
    for i, item in enumerate(items):
        stray = sorted(item.model_fields_set & {"terrain", "wait_s"})
        if stray:
            raise ValueError(f"`{where}[{i}].{stray[0]}` has no effect: set `{stray[0]}` once, at the top level of the request")


class CompareRequest(Strict):
    items: Annotated[list[ScenarioRef], Field(min_length=2, max_length=12)]
    names: list[str] | None = Field(default=None, description="Display names (unique); default: each scenario's name.")
    terrain: TerrainMode = "auto"
    wait_s: float = Field(default=3.0, ge=0.0, le=30.0)

    @field_validator("items")
    @classmethod
    def _item_options(cls, items: list[ScenarioRef]) -> list[ScenarioRef]:
        refuse_item_options(items, "items")
        return items


class HorizonRequest(Strict):
    """Longitude is taken modulo 360 into [-180, 180) before the request is keyed and answered, so 190, -170 and
    -170.0 are one request (the result's `site.lon_deg` is the normalised value)."""

    lat_deg: float = Field(ge=-90.0, le=90.0)
    lon_deg: float = Field(ge=-360.0, le=360.0)
    height_m: float = Field(default=0.0, ge=0.0, le=500.0, description="Observer height above local ground.")
    antenna_height_max_m: float | None = Field(default=None, ge=0.0, le=500.0, description="The profile's `antenna_height_max_m`, for the antenna observer (`height_m` = `antenna_height_m`): the optimistic bound `elev_lo_deg` is then the lower of the horizon at `height_m` and at this height, exactly as the evaluation folds it (`fold_observers`); nominal and upper bound stay those of `height_m`. Must be at least `height_m`; the array observer takes none.")
    terrain: TerrainMode = "auto"
    n_az: int = Field(default=720, ge=36, le=3600)
    wait_s: float = Field(default=3.0, ge=0.0, le=30.0)
    apply_error_model: bool = Field(default=False, description="Widen the bounds with the terrain error settings, exactly as a scenario analysis does (`prepare_horizon`): `terrain_error` if given, else the defaults (per-product budgets, k = 2); the budget applied is recorded in `provenance.error_model`.")
    terrain_stores: list[str] | None = Field(default=None, description="The scenario's terrain stack choice (`Scenario.terrain_stores`): the store ids the horizon is computed on; null for the default stack. The reply's `terrain_stack` says which stack ran.")
    terrain_error: TerrainErrorSettings | None = Field(default=None, description="The scenario's `terrain_error` object (`enabled`, `mode`, `sigma_z_m`, `sigma_xy_m`, `k_sigma`), applied exactly as the evaluation applies it. Needs `apply_error_model`; `enabled: false` leaves the bounds unwidened.")

    @model_validator(mode="after")
    def _normalise(self) -> HorizonRequest:
        self.lon_deg = (self.lon_deg + 180.0) % 360.0 - 180.0
        if self.antenna_height_max_m is not None and self.antenna_height_max_m < self.height_m:
            raise ValueError("`antenna_height_max_m` must be at least `height_m`")
        if self.terrain_error is not None and not self.apply_error_model:
            raise ValueError("`terrain_error` is given but `apply_error_model` is false: set it to true to widen the bounds with these settings")
        if self.terrain_stores is not None:
            if not self.terrain_stores:
                raise ValueError("terrain_stores must list at least one store (use null for the default stack)")
            if len(set(self.terrain_stores)) != len(self.terrain_stores):
                raise ValueError("terrain_stores holds duplicate ids")
            self.terrain_stores = sorted(self.terrain_stores)
        return self


class ExportRequest(ScenarioRef):
    """Body of `POST /exports/{kind}`. The analysis the export needs is run (or served from
    the cache) first: `scan` is required for the opportunities and calendar CSVs, `slip` for the slip CSV and
    `compare_with` (at least one more scenario) for the comparison CSV. A bundle contains every export for
    which its inputs are given."""

    aem_horizon: Literal["antenna", "array"] = "antenna"
    aem_bound: Literal["nominal", "optimistic", "pessimistic"] = Field(
        default="nominal",
        description="Which horizon the AzElMask holds. `pessimistic` is the raised horizon (the upper bound of the horizon bracket, "
                    "the conservative mask for a link or power analysis: never below `nominal`); `optimistic` the lowered one "
                    "(never above `nominal`). The `.aem.provenance.json` sidecar names the field written (`export.elevation_field`).")
    max_points: int | None = Field(default=None, ge=100, le=100000, description="Time-series decimation (default: none).")
    window: Literal["mission", "all"] = "mission"
    scan: ScanParams | None = None
    slip: SlipParams | None = None
    compare_with: list[ScenarioRef] = Field(default_factory=list, max_length=11)

    @field_validator("compare_with")
    @classmethod
    def _item_options(cls, items: list[ScenarioRef]) -> list[ScenarioRef]:
        refuse_item_options(items, "compare_with")
        return items


class ReportRequest(ScenarioRef):
    """Body of `POST /report`: the scenario is always evaluated; `scan`, `slip`, `compare_with`, `ellipse` and `search`
    add their sections. Each analysis is run inside the report job with the parameters of its own endpoint (its result
    is not shared with a job of `/analyses/*`; a repeated report is served from the report's own cache). The slip
    section is for the scenario's own site, so `slip` takes no alternatives; `ellipse` needs the scenario's `ellipse`."""

    format: Literal["html", "pdf"] = "html"
    generated_utc: str | None = Field(
        default=None, pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$",
        description="The report's only time-dependent text. Give it for a byte-identical report; omitted, it is the time "
                    "the report was computed (a cached report keeps its original time).")
    scan: ScanParams | None = None
    slip: SlipParams | None = None
    compare_with: list[ScenarioRef] = Field(default_factory=list, max_length=11)
    ellipse: EllipseParams | None = Field(default=None, description="Landing-ellipse statistics section (parameters of `/analyses/ellipse`).")
    search: SearchParams | None = Field(default=None, description="Site search section (parameters of `/analyses/search`).")

    @field_validator("compare_with")
    @classmethod
    def _item_options(cls, items: list[ScenarioRef]) -> list[ScenarioRef]:
        refuse_item_options(items, "compare_with")
        return items


class ExportFile(BaseModel):
    name: str
    media_type: str
    size_bytes: int
    sha256: str
    url: str = Field(description="Download URL (GET).")


class ExportManifest(BaseModel):
    kind: str
    files: list[ExportFile]
    provenance: dict[str, Any]


class EllipseParams(Strict):
    """Parameters of the landing-ellipse statistics (`POST /analyses/ellipse`, and the report's `ellipse` section)."""

    n_samples: int = Field(default=512, ge=16, le=8192, description="Deterministic low-discrepancy samples.")
    seed: int = Field(default=0, ge=0, le=2**31 - 1)
    truncate: bool = Field(default=True, description="Keep Gaussian samples inside the ellipse.")
    hazard_slope_deg: float | None = Field(default=None, gt=0.0, le=90.0, description="Default: the scenario's slope limit.")
    hazard_roughness_m: float | None = Field(default=None, gt=0.0)
    map_cells: int | None = Field(default=17, ge=3, le=65, description="Nodes per side of the verdict map; null skips it.")
    convergence_tolerance: float = Field(default=0.02, gt=0.0, lt=0.5)
    with_samples: bool = Field(default=False, description="Also return every sample (`samples`; not used by the report).")


class EllipseRequest(ScenarioRef, EllipseParams):
    """Verdict statistics over the scenario's landing ellipse (`scenario.ellipse` must be set): probability of
    PASS / MARGINAL / FAIL / UNKNOWN and per constraint, percentiles, best / worst / centre samples, convergence
    with sample count and an optional verdict map. A job of tens of seconds at the defaults."""


class SearchRegionModel(Strict):
    """A disc (`radius_m` around the centre) or a polygon of `[lat, lon]` vertices anchored at the centre."""

    lat_deg: float = Field(ge=-90.0, le=90.0)
    lon_deg: float = Field(ge=-540.0, le=540.0)
    radius_m: float | None = Field(default=None, gt=0.0, le=200_000.0)
    polygon: list[tuple[float, float]] | None = Field(default=None, min_length=3, max_length=500)

    @model_validator(mode="after")
    def _shape(self) -> SearchRegionModel:
        if (self.radius_m is None) == (self.polygon is None):
            raise ValueError("give exactly one of `radius_m` and `polygon`")
        return self

    def half_width_m(self) -> float:
        if self.radius_m is not None:
            return self.radius_m
        lats = [p[0] for p in self.polygon or []]
        lons = [p[1] for p in self.polygon or []]
        dlat = (max(lats) - min(lats)) * 30_323.0
        dlon = (max(lons) - min(lons)) * 30_323.0 * max(math.cos(math.radians(self.lat_deg)), 0.01)
        return max(dlat, dlon) / 2.0 + 1.0


class SearchParams(Strict):
    """Parameters of the site search (`POST /analyses/search`, and the report's `search` section)."""

    region: SearchRegionModel
    final_spacing_m: float = Field(gt=0.0, le=20_000.0)
    first_utc: UtcStr | None = None
    last_utc: UtcStr | None = None
    epoch_spacing_h: float | None = Field(default=None, gt=0.0, le=8760.0)
    coarse_factor: int = Field(default=8, ge=1, le=64, description="Power of two; 1 = no coarse pruning.")
    slack: float = Field(default=0.5, ge=0.0, le=10.0)
    min_promote: int = Field(default=8, ge=1, le=100_000)
    max_promoted: int = Field(default=4000, ge=1, le=100_000)
    top_k: int = Field(default=20, ge=1, le=500)
    min_separation_m: float | None = Field(default=None, gt=0.0)
    exhaustive: bool = Field(default=False, description="Evaluate the whole final lattice with the full horizon.")
    prune_world: Literal["optimistic", "nominal"] = "optimistic"
    hazard_roughness_m: float | None = Field(default=None, gt=0.0)
    with_grid: bool = Field(default=True, description="Return the final lattice (score, state, status per node; not used by the report).")

    @model_validator(mode="after")
    def _bounded(self) -> SearchParams:
        if self.coarse_factor & (self.coarse_factor - 1):
            raise ValueError("`coarse_factor` must be a power of two")
        if (self.first_utc is None) != (self.last_utc is None):
            raise ValueError("give `first_utc` and `last_utc` together")
        if self.first_utc is not None:
            span = span_s(self.first_utc, self.last_utc)
            if span < 0:
                raise ValueError(f"`last_utc` {self.last_utc} is before `first_utc` {self.first_utc}")
            if self.epoch_spacing_h is not None:
                n = int(span / 3600.0 // self.epoch_spacing_h) + 1
                if n > lim.MAX_SEARCH_EPOCHS:
                    raise ValueError(
                        f"the search evaluates {n:,} landing epochs (limit {lim.MAX_SEARCH_EPOCHS:,}). Use `epoch_spacing_h` of at "
                        f"least {ceil_2sf(span / 3600.0 / (lim.MAX_SEARCH_EPOCHS - 1)):g} for this span, or a span of at most "
                        f"{(lim.MAX_SEARCH_EPOCHS - 1) * self.epoch_spacing_h / 24.0:,.0f} days at {self.epoch_spacing_h:g} h")
        n = (2.0 * self.region.half_width_m() / self.final_spacing_m) ** 2
        if n > MAX_SEARCH_LATTICE:
            side = 2.0 * self.region.half_width_m()
            edge = MAX_SEARCH_LATTICE**0.5
            fit_spacing = ceil_2sf(side / edge)
            fit_side = edge * self.final_spacing_m
            raise ValueError(
                f"the region implies about {n:,.0f} lattice points at this spacing (limit {MAX_SEARCH_LATTICE:,}). "
                f"Use `final_spacing_m` of at least {fit_spacing:g} m for this {side:,.0f} m region, or keep "
                f"{self.final_spacing_m:g} m and shrink the region to at most {fit_side:,.0f} m across"
                + (f" (`radius_m` {fit_side / 2:,.0f})." if self.region.radius_m is not None else "."))
        return self


class SearchRequest(ScenarioRef, SearchParams):
    """Multi-level search of a region for sites satisfying the scenario's constraints: a cheap coarse pass prunes
    the lattice, the full horizon runs on the promoted points, and the best sites are ranked. The scenario's own
    site is ignored (the region defines where sites are). Minutes for a 5 km region at 20 m spacing: use a job."""


class RegionalLimit(Strict):
    op: Literal[">=", "<="]
    value: float


class RegionalRequest(Strict):
    """Gridded illumination and Earth-visibility layers over a square region around a point (polar stereographic
    grid of the LOLA products): average illumination, mean flux, longest sunlit / shadow / Earth outage, slope, with
    pessimistic and optimistic bounds. Needs the terrain stores. A job of minutes to tens of minutes; the layers are
    GeoTIFFs listed in the result (`GET /exports/files/{digest}/{name}`)."""

    lat_deg: float = Field(ge=-90.0, le=90.0)
    lon_deg: float = Field(ge=-540.0, le=540.0)
    size_m: float = Field(gt=0.0, le=200_000.0, description="Side of the square region.")
    spacing_m: float = Field(gt=0.0, le=10_000.0)
    start_utc: UtcStr
    stop_utc: UtcStr
    step_s: float = Field(default=3600.0, ge=60.0, le=86_400.0)
    mast_height_m: float = Field(default=0.0, ge=0.0, le=100.0)
    sun_rule: Literal["any_part", "half_flux"] = "any_part"
    earth_rule: Literal["centre", "any_part"] = "any_part"
    earth_margin_deg: float = Field(default=0.0, ge=0.0, le=10.0)
    dem_ids: list[str] | None = Field(default=None, description="Stores to use (default: all complete stores).")
    bounds: bool = Field(default=True, description="Compute the estimated bracket layers `<layer>_lo` / `_hi` (calibrated for about 99 % coverage; they can miss the exact value).")
    calibrate: int = Field(default=32, ge=0, le=256, description="Cells used to calibrate the horizon error against the exact engine.")
    do_earth: bool = True
    limits: dict[str, RegionalLimit] | None = Field(
        default=None, description="Layer name -> limit; adds a `verdict` layer: 1 pass, -1 fail, 0 marginal, -128 no data.")
    inline: list[str] = Field(default_factory=list, description="Layers to return inline as 2-D arrays (row 0 north).")
    name: str = ""
    wait_s: float = Field(default=3.0, ge=0.0, le=30.0)

    @model_validator(mode="after")
    def _bounded(self) -> RegionalRequest:
        n = round(self.size_m / self.spacing_m)
        if n < 1 or n * n > MAX_REGIONAL_CELLS:
            edge = MAX_REGIONAL_CELLS**0.5
            if n < 1:
                raise ValueError(f"`spacing_m` ({self.spacing_m:g}) exceeds `size_m` ({self.size_m:g}): the region has no cell; "
                                 f"use a spacing of at most {self.size_m:g} m")
            raise ValueError(
                f"the region has {n}x{n} = {n * n:,} cells (limit {MAX_REGIONAL_CELLS:,}). Use `spacing_m` of at least "
                f"{ceil_2sf(self.size_m / edge):g} m for a {self.size_m:,.0f} m region, or keep {self.spacing_m:g} m "
                f"and shrink `size_m` to at most {edge * self.spacing_m:,.0f} m")
        span = span_s(self.start_utc, self.stop_utc)
        if span <= 0:
            raise ValueError(f"`stop_utc` {self.stop_utc} must be after `start_utc` {self.start_utc}")
        steps = int(span // self.step_s) + 1
        if steps > lim.MAX_REGIONAL_EPOCHS:
            raise ValueError(
                f"the span has {steps:,} time steps at `step_s` {self.step_s:g} (limit {lim.MAX_REGIONAL_EPOCHS:,}). Use a "
                f"`step_s` of at least {ceil_2sf(span / (lim.MAX_REGIONAL_EPOCHS - 1)):g}, or a span of at most "
                f"{(lim.MAX_REGIONAL_EPOCHS - 1) * self.step_s / 86_400.0:,.1f} days at this step")
        if self.inline and n * n > 65_536:
            raise ValueError(f"`inline` layers are limited to 65,536 cells (this region has {n * n:,}): use `spacing_m` of at least "
                             f"{ceil_2sf(self.size_m / 256.0):g} m or download the GeoTIFFs instead")
        return self
