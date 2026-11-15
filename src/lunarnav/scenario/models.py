"""Scenario data model: lander profile, constraints, network, transfer, ellipse, terrain error, scenario.

Every model is a pydantic v2 model that round-trips through JSON (`model_dump_json` /
`model_validate_json`). Documents that stand alone (`LanderProfile`, `Scenario`) carry a
`schema_version`; a document with a different major version is rejected on load.

Units are in the field names (`_m`, `_deg`, `_h`, `_w`, `_wh`, `_db`...). Times at this boundary are
ISO-8601 UTC strings with a `Z` suffix; the engine converts them to ET.

Where a value has a provenance that the interface must show (published, derived, estimate, user
input), it is recorded as an `Origin`: in `LanderProfile.origins` keyed by field path, and on each
`Limit` / `Parameter` of the `Constraints`.
"""

from __future__ import annotations

import re
from typing import Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_serializer, model_validator

SCHEMA_VERSION = "1.0"
"""Version of the scenario document schema. Major changes are incompatible."""

_UTC_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$")

Basis = Literal["published", "derived", "estimate", "convention", "historical", "mission-specific", "user", "model-typed", "default", "unknown"]
"""Where a value comes from. `published`/`derived`/`estimate` follow the catalogue grades;
`historical` and `mission-specific` label research defaults that are not requirements for a new
mission; `convention` is a modelling choice of this tool; `user` is planner input (a person set it through the interface or stated it in the request); `model-typed` is a
value an automated assistant typed that the user did not state (it still has to be confirmed, like an estimate); `default` is a model
default nobody supplied (it is not data about the lander); `unknown` is a quantity nobody knows, which the
engine therefore evaluates over its whole range (the lander heading)."""


def check_utc(v: str) -> str:
    """Validate an ISO-8601 UTC instant with a `Z` suffix; seconds are added when absent."""
    m = _UTC_RE.match(v)
    if not m:
        raise ValueError(f"expected ISO-8601 UTC 'YYYY-MM-DDTHH:MM[:SS[.fff]]Z', got {v!r}")
    return v if m.group(1) else v[:-1] + ":00Z"


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Origin(_Model):
    """Provenance of one value: its basis, a human label and (when researched) the opened source."""

    basis: Basis
    label: str = ""
    source_url: str | None = None
    note: str = ""


def _check_major(v: str) -> str:
    if v.split(".")[0] != SCHEMA_VERSION.split(".")[0]:
        raise ValueError(f"unsupported schema_version {v!r}; this engine reads {SCHEMA_VERSION}")
    return v


class PanelSpec(_Model):
    """Flat solar panel in the lander body frame (x forward, y left, z up; see `visibility.power`)."""

    name: str
    normal_body: tuple[float, float, float]
    area_m2: float = Field(ge=0.0)
    efficiency: float = Field(ge=0.0, le=1.0)
    """Electrical output per unit incident beam power (cells, packing, temperature)."""
    tracking: bool = False
    """Rotates about the body z axis to face the Sun (single-axis vertical tracker when n_z = 0)."""

    @field_validator("normal_body")
    @classmethod
    def _nonzero(cls, v: tuple[float, float, float]) -> tuple[float, float, float]:
        if not np.linalg.norm(v) > 0.0:
            raise ValueError("panel normal must be non-zero")
        return v


UNKNOWN_HEADING_SAMPLES = 36
"""Headings evaluated when the lander heading is unknown (10 degree steps)."""


class AttitudeSpec(_Model):
    """Lander attitude at rest.

    Heading `yaw_deg` (body x, clockwise from north): `None` (the default) means the heading is **unknown**, as it is
    for every lander before it lands. The engine then has no nominal heading: power is evaluated on
    `UNKNOWN_HEADING_SAMPLES` evenly spaced headings over all 360 degrees and `yaw_uncertainty_deg` is ignored. A stated
    heading is uncertain by `yaw_uncertainty_deg` either side and power is evaluated on `yaw_samples` evenly spaced
    headings across that envelope (all 360 deg when the uncertainty is 180)."""

    yaw_deg: float | None = None
    yaw_uncertainty_deg: float = Field(default=0.0, ge=0.0, le=180.0)
    yaw_samples: int = Field(default=13, ge=1, le=361)
    tilt_deg: float = Field(default=0.0, ge=0.0, le=180.0)
    tilt_az_deg: float = 0.0

    @model_validator(mode="before")
    @classmethod
    def _unknown_heading_has_no_uncertainty(cls, data):
        """An unknown heading has one canonical document: the uncertainty field is dropped (it means nothing there)."""
        if isinstance(data, dict) and data.get("yaw_deg") is None:
            data = {k: v for k, v in data.items() if k not in ("yaw_deg", "yaw_uncertainty_deg")}
        return data

    @property
    def heading_known(self) -> bool:
        return self.yaw_deg is not None

    def yaws(self) -> np.ndarray:
        """Headings (deg) spanning the uncertainty envelope; the nominal yaw is always included. An unknown heading
        gives `UNKNOWN_HEADING_SAMPLES` headings over the full circle (0, 10, ... 350)."""
        if self.yaw_deg is None:
            return np.arange(UNKNOWN_HEADING_SAMPLES) * (360.0 / UNKNOWN_HEADING_SAMPLES)
        if self.yaw_uncertainty_deg == 0.0 or self.yaw_samples == 1:
            return np.array([self.yaw_deg])
        if self.yaw_uncertainty_deg >= 180.0:
            return self.yaw_deg + np.arange(self.yaw_samples) * (360.0 / self.yaw_samples)
        n = self.yaw_samples + (1 - self.yaw_samples % 2)
        return self.yaw_deg + np.linspace(-self.yaw_uncertainty_deg, self.yaw_uncertainty_deg, n)


class BatterySpec(_Model):
    """Battery; `initial_soc` is the state of charge at landing."""

    capacity_wh: float = Field(gt=0.0)
    charge_efficiency: float = Field(default=0.95, gt=0.0, le=1.0)
    discharge_efficiency: float = Field(default=0.95, gt=0.0, le=1.0)
    max_dod: float = Field(default=0.8, gt=0.0, le=1.0)
    initial_soc: float = Field(default=1.0, ge=0.0, le=1.0)


class LoadSpec(_Model):
    """Bus load: `sunlit_w` while the array is sunlit (nominal horizon), `dark_w` otherwise (survival)."""

    sunlit_w: float = Field(ge=0.0)
    dark_w: float = Field(ge=0.0)


class LinkSpec(_Model):
    """Direct-to-Earth downlink budget inputs (see `visibility.link_budget`). The receive G/T comes from
    each network station, or `default_g_over_t_dbk` when the station has none or no network is set."""

    eirp_dbw: float
    frequency_hz: float = Field(gt=0.0)
    data_rate_bps: float = Field(gt=0.0)
    required_ebn0_db: float
    losses_db: tuple[float, ...] = ()
    implementation_loss_db: float = 0.0
    required_margin_db: float = 0.0
    default_g_over_t_dbk: float | None = None


class LanderProfile(_Model):
    """Lander geometry, power and communication parameters used by every analysis.

    `array_height_m` and `antenna_height_m` are the two observer heights above local ground, so each
    site has two horizons. `origins` maps a field path (e.g. ``"antenna_height_m"``,
    ``"battery.capacity_wh"``) to its provenance; fields without an entry are user inputs.
    """

    schema_version: str = SCHEMA_VERSION
    id: str
    name: str
    description: str = ""
    array_height_m: float = Field(ge=0.0)
    antenna_height_m: float = Field(ge=0.0)
    antenna_height_max_m: float | None = Field(default=None, ge=0.0)
    """Upper bound of the Earth-link antenna height when the position is not known. The optimistic Earth-link
    horizon is evaluated at this height, the nominal and pessimistic ones at `antenna_height_m`, so the
    unknown antenna position is inside the reported range."""
    panels: tuple[PanelSpec, ...] = Field(min_length=1)
    attitude: AttitudeSpec = AttitudeSpec()
    battery: BatterySpec
    loads: LoadSpec
    link: LinkSpec | None = None
    origins: dict[str, Origin] = Field(default_factory=dict)

    _v = field_validator("schema_version")(_check_major)

    @model_validator(mode="after")
    def _antenna_range(self) -> "LanderProfile":
        if self.antenna_height_max_m is not None and self.antenna_height_max_m < self.antenna_height_m:
            raise ValueError("antenna_height_max_m must be at least antenna_height_m")
        return self

    def estimates(self) -> dict[str, Origin]:
        """Fields whose value is neither published nor stated by the user (estimate, derived, convention, model-typed, ...): flag these in the UI."""
        return {k: o for k, o in self.origins.items() if o.basis not in ("published", "user")}


class Limit(_Model):
    """One optional pass/fail constraint: `min <= value <= max` (either side optional).

    `margin_scale` (in `unit`) normalises the signed margin when constraints of different units are
    compared to name the limiting one: normalised margin = margin / margin_scale.
    """

    min: float | None = None
    max: float | None = None
    unit: str
    label: str
    origin: Origin = Origin(basis="user")
    margin_scale: float = Field(default=1.0, gt=0.0)

    @model_validator(mode="after")
    def _one_side(self) -> Limit:
        if self.min is None and self.max is None:
            raise ValueError("a limit needs min, max or both")
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError("limit min exceeds max")
        return self

    def margin(self, value: np.ndarray | float) -> np.ndarray:
        """Signed margin in `unit`: positive inside the limit; NaN values give NaN."""
        v = np.asarray(value, dtype=np.float64)
        out = np.full(v.shape, np.inf)
        if self.min is not None:
            out = np.minimum(out, v - self.min)
        if self.max is not None:
            out = np.minimum(out, self.max - v)
        return out


class Parameter(_Model):
    """A numeric setting (not pass/fail) with label, unit and origin."""

    value: float
    unit: str
    label: str
    origin: Origin = Origin(basis="user")


CONSTRAINT_KEYS: tuple[str, ...] = (
    "landing_sun_elevation_deg",
    "landing_hours_after_sunrise",
    "dte_at_landing_deg",
    "min_sunlit_hours_after_landing",
    "max_dark_span_h",
    "min_total_sunlit_h",
    "min_state_of_charge",
    "min_contact_fraction",
    "max_contact_gap_h",
    "min_total_contact_h",
    "min_total_sunlit_contact_h",
    "min_link_margin_db",
    "max_slope_deg",
)
"""Evaluation order of the constraints (also the tie-break order for the limiting constraint)."""


class Constraints(_Model):
    """Constraint set of a scenario. Every constraint is optional (None = not applied).

    Constraint semantics (value per landing epoch; see docs/validation/scenario.md):

    - `landing_sun_elevation_deg`: apparent Sun-centre elevation above the local horizontal at landing.
    - `landing_hours_after_sunrise`: hours since the array's last sunrise (flux > `sunlit_flux_fraction`).
    - `dte_at_landing_deg`: direct-to-Earth clearance at landing, degrees above the antenna horizon plus
      `antenna_terrain_margin_deg` (best station of the network, or the Earth centre without a network).
    - `min_sunlit_hours_after_landing`: continuous sunlit hours from landing.
    - `max_dark_span_h`: longest dark span of the array during the surface mission.
    - `min_total_sunlit_h`: total sunlit hours of the array during the surface mission (need not be continuous).
    - `min_state_of_charge`: minimum battery state of charge (fraction) during the mission.
    - `min_contact_fraction` / `max_contact_gap_h`: network contact fraction / longest outage.
    - `min_total_contact_h`: total hours in contact during the mission (best station of the network, or the Earth
      centre above the antenna horizon without a network).
    - `min_total_sunlit_contact_h`: total hours during the mission that are sunlit and in contact at the same time.
    - `min_link_margin_db`: lowest downlink margin while in contact.
    - `max_slope_deg`: terrain slope over `slope_baseline_m` (only with a provider that has terrain).
    """

    landing_sun_elevation_deg: Limit | None = None
    landing_hours_after_sunrise: Limit | None = None
    dte_at_landing_deg: Limit | None = None
    min_sunlit_hours_after_landing: Limit | None = None
    max_dark_span_h: Limit | None = None
    min_total_sunlit_h: Limit | None = None
    min_state_of_charge: Limit | None = None
    min_contact_fraction: Limit | None = None
    max_contact_gap_h: Limit | None = None
    min_total_contact_h: Limit | None = None
    min_total_sunlit_contact_h: Limit | None = None
    min_link_margin_db: Limit | None = None
    max_slope_deg: Limit | None = None
    sunlit_flux_fraction: Parameter = Parameter(
        value=0.5, unit="fraction", label="Solar flux fraction that counts as sunlit",
        origin=Origin(basis="convention", label="Half of the limb-darkened disc flux visible",
                      note="Tool convention; no published planning rule was found."))
    antenna_terrain_margin_deg: Parameter = Parameter(
        value=0.0, unit="deg", label="Antenna clearance required above the terrain horizon")
    slope_baseline_m: Parameter = Parameter(value=20.0, unit="m", label="Slope baseline")

    def active(self) -> dict[str, Limit]:
        """Applied constraints in evaluation order."""
        return {k: getattr(self, k) for k in CONSTRAINT_KEYS if getattr(self, k) is not None}


class NetworkStation(_Model):
    """Earth ground station with receive (downlink) and transmit (uplink) elevation masks."""

    id: str
    name: str = ""
    network: str = ""
    lat_deg: float = Field(ge=-90.0, le=90.0)
    lon_deg: float = Field(ge=-180.0, le=180.0)
    alt_m: float = 0.0
    alt_basis: Literal["published", "derived", "unknown", "user"] = "user"
    """How `alt_m` is known: the catalogue's `published` / `derived` / `unknown` (then `alt_m` is the 0.0 placeholder,
    used at lunar distance where the effect is below 0.001 deg), or `user` for a hand-entered station."""
    rx_mask_deg: float = Field(ge=0.0, le=45.0)
    tx_mask_deg: float = Field(ge=0.0, le=45.0)
    g_over_t_dbk: float | None = None
    origin: Origin = Origin(basis="user")


class Network(_Model):
    """Ground network. Empty means 'geometric direct-to-Earth': the Earth centre above the antenna
    horizon plus margin, with no Earth-side mask.

    `direction` selects the station mask that defines contact: `"downlink"` uses `rx_mask_deg`,
    `"uplink"` uses `tx_mask_deg`, `"two_way"` uses the larger of the two.
    """

    stations: tuple[NetworkStation, ...] = ()
    label: str = ""
    direction: Literal["downlink", "uplink", "two_way"] = "downlink"

    @model_validator(mode="after")
    def _unique(self) -> Network:
        ids = [s.id for s in self.stations]
        if len(set(ids)) != len(ids):
            raise ValueError("station ids must be unique")
        return self


class TransferRow(_Model):
    launch_utc: str
    landing_utc: str

    _l = field_validator("launch_utc", "landing_utc")(check_utc)


class Transfer(_Model):
    """How a launch epoch maps to a landing epoch.

    `kind="fixed"`: landing = launch + `duration_days`.
    `kind="table"`: discrete launch opportunities from flight dynamics; a launch that is ready at L
    takes the first row whose launch is at or after L (one cannot launch before being ready), and
    lands at that row's landing epoch. Ready times after the last row have no landing.
    """

    kind: Literal["fixed", "table"]
    duration_days: float | None = Field(default=None, gt=0.0)
    table: tuple[TransferRow, ...] = ()
    label: str = ""
    origin: Origin = Origin(basis="user")

    @model_validator(mode="after")
    def _consistent(self) -> Transfer:
        if self.kind == "fixed" and self.duration_days is None:
            raise ValueError("fixed transfer needs duration_days")
        if self.kind == "table":
            if not self.table:
                raise ValueError("table transfer needs at least one row")
            launches = [r.launch_utc for r in self.table]
            if launches != sorted(launches) or len(set(launches)) != len(launches):
                raise ValueError("transfer table launches must be strictly increasing")
        return self


class Ellipse(_Model):
    """Landing dispersion ellipse centred on the site. `azimuth_deg` orients the semi-major axis
    (clockwise from north). `dispersion="gaussian"`: the semi-axes are `sigma_level` sigmas of a
    bivariate normal; `"uniform"`: points are uniformly distributed inside the ellipse."""

    semi_major_m: float = Field(gt=0.0)
    semi_minor_m: float = Field(gt=0.0)
    azimuth_deg: float = 0.0
    dispersion: Literal["gaussian", "uniform"] = "gaussian"
    sigma_level: float = Field(default=3.0, gt=0.0)
    origin: Origin = Origin(basis="user")

    @model_validator(mode="after")
    def _axes(self) -> Ellipse:
        if self.semi_minor_m > self.semi_major_m:
            raise ValueError("semi_minor_m must not exceed semi_major_m")
        return self


class TerrainErrorSettings(_Model):
    """DEM error budget widening the horizon bracket by `k_sigma` sigmas (see `visibility.uncertainty`).

    Applied only when the horizon provider models terrain. `mode`:

    * `"product"` (default): at every azimuth the budget of the product that supplies the height at the
      limiting blocker (`TerrainStack.error_at`; figures and citations in `terrain.sources.PRODUCT_ERRORS`).
      A product with no published figure carries the assumed global budget below, flagged `assumed`.
    * `"custom"`: `sigma_z_m` and `sigma_xy_m` apply to every azimuth. Their defaults are the vertical accuracy of
      LOLA-based global products about 3-4 m (SLDEM2015) and geolocation under 10 m (Smith et al. 2017,
      Icarus 283, Appendix table and abstract; docs/research/literature.md section 4.1).

    `sigma_z_m` / `sigma_xy_m` apply in `custom` mode only (in `product` mode they are reset to their defaults).
    """

    enabled: bool = True
    mode: Literal["product", "custom"] = "product"
    sigma_z_m: float = Field(default=4.0, ge=0.0)
    sigma_xy_m: float = Field(default=10.0, ge=0.0)
    k_sigma: float = Field(default=2.0, ge=0.0)

    @model_validator(mode="before")
    @classmethod
    def _reset_product_sigmas(cls, data):
        """In `product` mode the custom sigmas are not used: drop them so they stay at their defaults."""
        if isinstance(data, dict) and data.get("mode", "product") == "product":
            data = {k: v for k, v in data.items() if k not in ("sigma_z_m", "sigma_xy_m")}
        return data

    origin: Origin = Origin(
        basis="published", label="LOLA accuracy: SLDEM2015 3-4 m vertical; geolocation < 10 m",
        source_url="https://ntrs.nasa.gov/api/citations/20160008718/downloads/20160008718.pdf",
        note="Smith et al. 2017, Icarus 283, 70-91; global products. Local high-resolution DEMs differ.")


class EclipseSettings(_Model):
    """Earth-shadow convention passed explicitly to `ephem.earth_eclipse_fraction`.

    Default `"danjon"`: the Earth enlarged to 1.01 x its equatorial radius, the convention of the
    NASA/GSFC eclipse contacts, which the engine reproduces within 4.6 s
    (docs/validation/ephemeris.md section 6). `"geometric"` is the bare 6371 km sphere.
    """

    shadow: Literal["danjon", "geometric"] = "danjon"
    earth_radius_km: float | None = Field(default=None, gt=0.0)
    atmosphere_km: float = Field(default=0.0, ge=0.0)
    origin: Origin = Origin(
        basis="published", label="Danjon-enlarged shadow (Earth radius x 1.01)",
        source_url="https://eclipse.gsfc.nasa.gov/LEcat5/shadow.html")


MAX_STEP_S = 3600.0
"""Longest time step of an analysis grid, seconds."""


class Sampling(_Model):
    """Time sampling of a site evaluation."""

    step_s: float = Field(default=600.0, gt=0.0, le=MAX_STEP_S)
    """Seconds between epochs, above 0 and at most `MAX_STEP_S` (one hour): an event (sunrise, eclipse, Earth rise) needs at least
    two samples within an hour of it to be located and attributed; a longer step cannot resolve a lunar day's events."""
    lookback_h: float = Field(default=720.0, ge=0.0)
    """History before landing evaluated to find the last sunrise (30 d covers one synodic month)."""


class SiteSpec(_Model):
    """Landing site (planetocentric ME degrees, east-positive)."""

    lat_deg: float = Field(ge=-90.0, le=90.0)
    lon_deg: float = Field(ge=-180.0, le=360.0)
    name: str = ""
    catalog_id: str | None = None


class Scenario(_Model):
    """A complete, serialisable planning case."""

    schema_version: str = SCHEMA_VERSION
    name: str
    site: SiteSpec
    landing_utc: str
    mission_duration_h: float = Field(gt=0.0)
    profile: LanderProfile
    constraints: Constraints = Constraints()
    network: Network = Network()
    transfer: Transfer | None = None
    ellipse: Ellipse | None = None
    terrain_error: TerrainErrorSettings = TerrainErrorSettings()
    eclipse: EclipseSettings = EclipseSettings()
    sampling: Sampling = Sampling()
    notes: str = ""
    terrain_stores: tuple[str, ...] | None = None
    """Terrain stores (DEM ids) the analysis may use; None is the engine's default stack (every store). A list is stored sorted
    (the engine orders stores by its own precedence, so the order of the list is not a setting) and must be non-empty and unique;
    each id is `[A-Za-z0-9_.-]+`. It is omitted from the JSON, and so from the scenario hash, when None. A horizon provider whose
    stack holds other stores, or a smooth-sphere provider, is refused (`provenance.check_terrain_stack`)."""

    _v = field_validator("schema_version")(_check_major)
    _u = field_validator("landing_utc")(check_utc)

    @field_validator("terrain_stores")
    @classmethod
    def _stores(cls, v: tuple[str, ...] | None) -> tuple[str, ...] | None:
        if v is None:
            return None
        if not v:
            raise ValueError("terrain_stores must list at least one store (use null for the default stack)")
        bad = [x for x in v if not re.fullmatch(r"[A-Za-z0-9_.-]+", x)]
        if bad:
            raise ValueError(f"terrain store ids may only contain letters, digits, '_', '.', '-': {bad}")
        if len(set(v)) != len(v):
            raise ValueError("terrain_stores holds duplicate ids")
        return tuple(sorted(v))

    @model_serializer(mode="wrap")
    def _omit_default_stack(self, handler):
        out = handler(self)
        if out.get("terrain_stores") is None:
            out.pop("terrain_stores", None)
        return out
