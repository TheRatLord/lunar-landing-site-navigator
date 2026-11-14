"""Typed schema of the shipped reference catalogue (sites, ground stations, lander profiles).

Every entry carries `sources` (at least one opened URL) and a `confidence` grade:

- ``high``: value read from an opened primary source (agency, operator, peer-reviewed paper).
- ``medium``: opened secondary source, or a value converted/derived from a primary one.
- ``low``: engineering estimate or inference; see the entry's notes.
- ``unverified``: recalled but not confirmed by opening a source.

Lunar coordinates are planetocentric, east-positive degrees in the mean-Earth/polar-axis frame.
Each site records the frame its source states in `frame_note`.
Earth coordinates are geodetic WGS84, east-positive, height above the ellipsoid in metres.
"""

from __future__ import annotations

import re
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from lunarnav.types import GroundStation, Site

_UTC_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$")
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_\-]*$")


class Confidence(StrEnum):
    """Evidence grade of a catalogue entry or value."""

    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    UNVERIFIED = "unverified"


class _Frozen(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Source(_Frozen):
    """A document that was opened to obtain a value."""

    url: str
    title: str
    locator: str = ""
    """Where in the document the value appears (section, table, page, paragraph)."""

    @field_validator("url")
    @classmethod
    def _http(cls, v: str) -> str:
        if not v.startswith(("http://", "https://")):
            raise ValueError(f"source url must be http(s): {v!r}")
        return v


class CatalogEntry(_Frozen):
    id: str
    name: str
    confidence: Confidence
    sources: tuple[Source, ...] = Field(min_length=1)
    notes: str = ""

    @field_validator("id")
    @classmethod
    def _id(cls, v: str) -> str:
        if not _ID_RE.match(v):
            raise ValueError(f"id must be lowercase [a-z0-9_-]: {v!r}")
        return v


SiteKind = Literal["landed", "impact", "planned", "not_landed", "region", "poi"]


class SiteEntry(CatalogEntry):
    """A historical, planned or reference point on the Moon."""

    kind: SiteKind
    lat_deg: float = Field(ge=-90.0, le=90.0)
    lon_deg: float = Field(gt=-180.0, le=180.0)
    frame_note: str
    """Frame and convention stated by the source, and any conversion applied."""
    mission: str = ""
    operator: str = ""
    country: str = ""
    status: str = ""
    landing_utc: str | None = None
    """ISO-8601 UTC with ``Z`` suffix; touchdown or impact time for flown missions."""
    landing_date: str | None = None
    """UTC calendar date (YYYY-MM-DD) when the source gives no time of day."""
    planned_date: str = ""
    """Free-text planned landing date for future missions, as published."""
    extent_km: float | None = Field(default=None, gt=0.0)
    """Characteristic size in km; `extent_kind` says what it measures."""
    extent_kind: Literal["side", "diameter"] | None = None
    """``side``: side length of a nominal square region or area; ``diameter``: diameter of the feature
    (gazetteer features, craters, albedo swirls). Required when `extent_km` is set."""

    @model_validator(mode="after")
    def _extent_kind(self) -> SiteEntry:
        if (self.extent_km is None) != (self.extent_kind is None):
            raise ValueError(f"{self.id}: extent_km and extent_kind must be given together")
        return self

    @field_validator("landing_date")
    @classmethod
    def _date(cls, v: str | None) -> str | None:
        if v is not None and not re.match(r"^\d{4}-\d{2}-\d{2}$", v):
            raise ValueError(f"landing_date must be YYYY-MM-DD: {v!r}")
        return v

    @field_validator("landing_utc")
    @classmethod
    def _utc(cls, v: str | None) -> str | None:
        if v is not None and not _UTC_RE.match(v):
            raise ValueError(f"landing_utc must be ISO-8601 UTC with Z suffix: {v!r}")
        return v

    def to_site(self, mast_height_m: float = 2.0) -> Site:
        """Engine observer at this location, `mast_height_m` above local terrain."""
        return Site(lat_deg=self.lat_deg, lon_deg=self.lon_deg, mast_height_m=mast_height_m, name=self.name)


class StationEntry(CatalogEntry):
    """An Earth ground station antenna (or complex) used for lunar communications."""

    network: str
    operator: str
    country: str
    lat_deg: float = Field(ge=-90.0, le=90.0)
    lon_deg: float = Field(gt=-180.0, le=180.0)
    alt_m: float = Field(ge=-500.0, le=6000.0)
    alt_known: bool = True
    """False only when no source gives an altitude (``alt_basis == "unknown"``); `alt_m` is then a 0.0 placeholder."""
    alt_basis: Literal["published", "derived", "unknown"] = "published"
    """``published``: altitude printed in or computed from an opened source's coordinates; ``derived``: from a
    DEM height plus geoid undulation (see notes, about 30 m accuracy); ``unknown``: no source (placeholder)."""
    dish_m: float | None = Field(default=None, gt=0.0)
    bands: tuple[str, ...] = ()
    min_elevation_deg: float = Field(ge=0.0, le=45.0)
    min_elevation_source: str
    """Where the elevation mask comes from (document and locator, or 'assumed default')."""
    lunar_missions: tuple[str, ...] = ()
    status: str = "active"

    @model_validator(mode="after")
    def _altitude_consistent(self) -> StationEntry:
        if (self.alt_basis == "unknown") != (not self.alt_known):
            raise ValueError(f"{self.id}: alt_known and alt_basis disagree")
        if self.alt_basis == "unknown" and self.alt_m != 0.0:
            raise ValueError(f"{self.id}: unknown altitude must be the 0.0 placeholder")
        if self.alt_basis != "published" and not self.notes.strip():
            raise ValueError(f"{self.id}: a derived or unknown altitude must be explained in notes")
        return self

    def to_ground_station(self, *, assume_zero_altitude: bool = False) -> GroundStation:
        """Convert to the engine's shared `GroundStation` type.

        An unknown altitude is not silently turned into 0 m: this raises `ValueError` unless the caller
        passes ``assume_zero_altitude=True`` (the effect at lunar distance is below 0.001 deg).
        """
        if not self.alt_known and not assume_zero_altitude:
            raise ValueError(f"station {self.id!r} has no published altitude; pass assume_zero_altitude=True")
        return GroundStation(
            name=self.id,
            lat_deg=self.lat_deg,
            lon_deg=self.lon_deg,
            alt_m=self.alt_m,
            min_elevation_deg=self.min_elevation_deg,
            network=self.network,
        )


Basis = Literal["published", "derived", "estimate"]
Scalar = float | int | bool | str


class Quantity(_Frozen):
    """One lander parameter with its provenance.

    `basis` says whether the value is printed in the source (``published``), computed from
    published values (``derived``), or an engineering estimate (``estimate``). `source` indexes
    the entry's `sources` list.
    """

    value: Scalar | tuple[Scalar, ...]
    unit: str = ""
    basis: Basis
    source: int | None = Field(default=None, ge=0)
    note: str = ""

    @model_validator(mode="after")
    def _estimate_needs_note(self) -> Quantity:
        if self.basis == "published" and self.source is None:
            raise ValueError("a published value must reference a source index")
        if self.basis != "published" and not self.note:
            raise ValueError("derived/estimate values need a note explaining how they were obtained")
        return self


class FrozenParams(dict[str, "Quantity"]):
    """A dict that rejects every mutation, so cached catalogue entries cannot be altered by callers."""

    def _blocked(self, *_a: object, **_k: object) -> None:
        raise TypeError("lander params are read-only")

    __setitem__ = __delitem__ = __ior__ = _blocked  # type: ignore[assignment]
    clear = pop = popitem = setdefault = update = _blocked  # type: ignore[assignment]

    def __reduce__(self) -> tuple[type[FrozenParams], tuple[dict[str, Quantity]]]:
        return (FrozenParams, (dict(self),))

    def __copy__(self) -> FrozenParams:
        return self

    def __deepcopy__(self, memo: dict[int, object]) -> FrozenParams:
        return FrozenParams({k: v.model_copy(deep=True) for k, v in self.items()})


LanderStatus = Literal["flown", "in_development", "retired", "cancelled"]


class LanderEntry(CatalogEntry):
    """A lander constraint profile. Absent fields are unknown, not zero."""

    operator: str
    country: str
    status: LanderStatus
    missions: tuple[str, ...] = ()
    params: dict[str, Quantity]
    """Named parameters (read-only); keys are listed in `LANDER_PARAM_KEYS`."""

    @field_validator("params")
    @classmethod
    def _freeze_params(cls, v: dict[str, Quantity]) -> dict[str, Quantity]:
        """The loaders cache entries, so the parameter mapping must not be mutable."""
        return FrozenParams(v)

    @model_validator(mode="after")
    def _check_params(self) -> LanderEntry:
        unknown = set(self.params) - set(LANDER_PARAM_KEYS)
        if unknown:
            raise ValueError(f"unknown lander params: {sorted(unknown)}")
        n = len(self.sources)
        for key, q in self.params.items():
            if q.source is not None and q.source >= n:
                raise ValueError(f"param {key!r} cites source {q.source} but entry has {n} sources")
        return self


LANDER_PARAM_KEYS: dict[str, str] = {
    "launch_mass_kg": "Wet mass at launch.",
    "dry_mass_kg": "Dry mass.",
    "payload_capacity_kg": "Payload mass delivered to the surface.",
    "height_m": "Overall lander height.",
    "power_type": "Power source (solar array, RTG, battery).",
    "array_geometry": "Solar array mounting and orientation.",
    "array_area_m2": "Solar array area.",
    "array_power_w": "Solar array power (state the condition in the note).",
    "battery_capacity_wh": "Battery energy capacity.",
    "payload_power_w": "Power available to payloads, W.",
    "payload_specific_power_w_per_kg": "Payload power per kilogram of payload mass, W/kg.",
    "antenna_height_m": (
        "Conservative (lowest plausible) height of the Earth-link antenna above local ground, m. "
        "Where the operator does not publish the antenna position this is an estimate (half the vehicle height)."
    ),
    "antenna_height_max_m": "Upper bound of the Earth-link antenna height above local ground, m.",
    "array_height_m": "Height of the solar array centre above the surface.",
    "comm_bands": "Lander-to-Earth radio bands.",
    "payload_downlink_rate_kbps_per_kg": "Payload data rate per kilogram of payload mass, kbps/kg.",
    "downlink_rate_kbps": "Lander downlink data rate, kbps.",
    "landing_accuracy_m": "Single published landing accuracy as a distance from the target (radius), m.",
    "landing_area_m": "(length, width) of the published landing ellipse or area, m, exactly as printed in the source.",
    "achieved_landing_error_m": "Distance between achieved and target landing point on flown missions.",
    "max_slope_deg": "Maximum surface slope tolerated at touchdown.",
    "max_hazard_m": "Maximum rock/hazard size tolerated.",
    "surface_lifetime_days": "Design surface operations duration.",
    "night_survival": "Designed to survive the lunar night.",
    "landing_sun_elevation_deg": "Sun elevation range at landing (min, max).",
    "transfer_days": "Launch-to-landing duration.",
    "thermal_limits": "Operational thermal constraints.",
}
