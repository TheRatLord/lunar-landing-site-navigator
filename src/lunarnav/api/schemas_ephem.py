"""Request and response models of the ephemeris endpoints.

Conventions: angles in degrees; azimuth clockwise from local north; elevation above the
plane perpendicular to the Moon-centre radial through the observer; smooth reference sphere of radius
1 737 400 m (no terrain); apparent directions (light time and stellar aberration); times ISO-8601 UTC
with ``Z`` suffix, internal time TDB seconds past J2000.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$")
UTC_DESC = "ISO-8601 UTC instant with Z suffix, e.g. 2027-03-14T06:58:41Z."


def check_utc(value: str) -> str:
    """Validate the boundary time format (`YYYY-MM-DDTHH:MM:SS[.fff]Z`); leap second 23:59:60 allowed."""
    if not _UTC.match(value):
        raise ValueError(f"not an ISO-8601 UTC instant with Z suffix: {value!r}")
    stamp = value[:19].replace("T", " ")
    try:
        datetime.strptime(stamp.replace(":60", ":59"), "%Y-%m-%d %H:%M:%S")
    except ValueError as exc:
        raise ValueError(f"invalid calendar instant: {value!r}") from exc
    return value


def _instant(value: str) -> datetime:
    return datetime.fromisoformat(value[:-1].replace(":60", ":59"))


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SiteIn(_Strict):
    """Observer location on the Moon (planetocentric, ME frame, east-positive longitude)."""

    lat_deg: float = Field(ge=-90.0, le=90.0, description="Planetocentric latitude, degrees.")
    lon_deg: float = Field(ge=-180.0, le=360.0, description="East longitude, degrees (ME frame).")
    mast_height_m: float = Field(default=2.0, ge=0.0, le=1000.0, description="Observer height above local terrain, metres.")
    ground_height_m: float = Field(
        default=0.0, ge=-12000.0, le=12000.0, description="Terrain height above the 1737.4 km reference sphere, metres."
    )
    name: str = Field(default="", max_length=120)


class TrackRange(_Strict):
    """UTC interval and sampling step shared by the time-series endpoints."""

    start_utc: str = Field(description="First epoch. " + UTC_DESC)
    end_utc: str = Field(description="Last epoch (inclusive when aligned to the step). " + UTC_DESC)
    step_s: float = Field(default=3600.0, ge=0.001, le=86400.0 * 366, description="Sampling step, SI seconds.")
    max_points: int | None = Field(
        default=2000,
        ge=2,
        description="If the range has more samples than this, the step is enlarged by an integer factor so "
        "that at most this many are returned (`step_s_effective` reports it). null returns every sample.",
    )

    @field_validator("start_utc", "end_utc")
    @classmethod
    def _utc(cls, v: str) -> str:
        return check_utc(v)

    @model_validator(mode="after")
    def _order(self) -> Self:
        if _instant(self.end_utc) < _instant(self.start_utc):
            raise ValueError("end_utc must not precede start_utc")
        return self


class TracksRequest(TrackRange):
    """Sun, Earth and station tracks for one site."""

    site: SiteIn | None = Field(default=None, description="Explicit site; exclusive with `site_id`.")
    site_id: str | None = Field(default=None, description="Catalogue site id (see /sites); exclusive with `site`.")
    bodies: list[Literal["sun", "earth"]] = Field(default_factory=lambda: ["sun", "earth"], max_length=2)
    station_ids: list[str] = Field(
        default_factory=list, max_length=12, description="Catalogue station ids (see /stations)."
    )
    include_eclipse_fraction: bool = Field(
        default=False, description="Add the fraction of the solar disc hidden by the Earth disc (uniform brightness)."
    )

    @model_validator(mode="after")
    def _one_site(self) -> Self:
        if (self.site is None) == (self.site_id is None):
            raise ValueError("give exactly one of `site` and `site_id`")
        return self


class SubpointsRequest(TrackRange):
    """Sub-solar and sub-Earth points over time."""

    stellar_aberration: bool = Field(default=True, description="Apply stellar aberration (as `sun_track`).")
    earth_view: bool = Field(
        default=False,
        description="Sub-Earth point as the lunar disc centre seen from Earth (optical libration, Horizons "
        "ObsSub convention) instead of the Earth's apparent zenith point; epochs are then Moon-side.",
    )


class TargetSeries(BaseModel):
    """Apparent direction of a target from the site."""

    az_deg: list[float] = Field(description="Azimuth, degrees clockwise from local north.")
    el_deg: list[float] = Field(description="Elevation above the local horizontal plane, degrees (no terrain).")
    range_km: list[float] = Field(description="Distance from the observer, km.")
    ang_radius_deg: list[float] = Field(description="Apparent angular radius of the target disc, degrees.")


class StationSeries(BaseModel):
    """A ground station as seen from the site."""

    network: str
    min_elevation_deg: float = Field(description="Station elevation mask from the catalogue, degrees.")
    az_deg: list[float]
    el_deg: list[float] = Field(description="Elevation of the station above the site's smooth horizon, degrees.")
    range_km: list[float]
    station_el_deg: list[float] = Field(
        description="Elevation of the site above the station's geodetic horizon; compare with `min_elevation_deg`."
    )


class SeriesProvenance(BaseModel):
    kernels: dict[str, str] = Field(description="Kernel file name to SHA-256.")
    code_version: str
    frame: str
    table_grid_step_s: float | None = Field(description="Spline grid of the ephemeris table, or null when SPICE was sampled directly.")


class TracksResponse(BaseModel):
    """Time series for one site. Arrays share the index of `et_tdb_s`."""

    site: SiteIn
    site_id: str | None
    start_utc: str
    end_utc: str
    step_s_requested: float
    step_s_effective: float
    n_samples_full: int = Field(description="Samples the unthinned range would contain.")
    n_samples: int = Field(description="Samples returned.")
    et_tdb_s: list[float]
    utc: list[str]
    sun: TargetSeries | None
    earth: TargetSeries | None
    earth_eclipse_fraction: list[float] | None
    stations: dict[str, StationSeries]
    conventions: str
    provenance: SeriesProvenance


class SubpointsResponse(BaseModel):
    start_utc: str
    end_utc: str
    step_s_requested: float
    step_s_effective: float
    n_samples_full: int
    n_samples: int
    et_tdb_s: list[float]
    utc: list[str]
    subsolar_lat_deg: list[float]
    subsolar_lon_deg: list[float] = Field(description="East longitude in (-180, 180], degrees.")
    subearth_lat_deg: list[float]
    subearth_lon_deg: list[float]
    conventions: str
    provenance: SeriesProvenance


class TimeConvertRequest(_Strict):
    """Convert between UTC and TDB seconds past J2000 (exactly one list)."""

    utc: list[str] | None = Field(default=None, max_length=1000, description="UTC instants to convert to ET.")
    et_tdb_s: list[float] | None = Field(default=None, max_length=1000, description="ET values to convert to UTC.")
    digits: int = Field(default=3, ge=0, le=9, description="Fractional-second digits in returned UTC strings.")

    @field_validator("utc")
    @classmethod
    def _utc(cls, v: list[str] | None) -> list[str] | None:
        return None if v is None else [check_utc(x) for x in v]

    @model_validator(mode="after")
    def _one(self) -> Self:
        if (self.utc is None) == (self.et_tdb_s is None):
            raise ValueError("give exactly one of `utc` and `et_tdb_s`")
        return self


class TimeConvertResponse(BaseModel):
    utc: list[str]
    et_tdb_s: list[float]
    leap_seconds_kernel: str = Field(description="Leap-second kernel in force (instants after its last entry assume no new leap second).")
