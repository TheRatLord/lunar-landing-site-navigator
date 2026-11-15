"""Reference catalogue: sites, ground stations, lander profiles (each entry carries sources and confidence)."""

from __future__ import annotations

from collections import Counter
from typing import Annotated, Literal

from fastapi import APIRouter, Query

from lunarnav.api.errors import PROBLEM_RESPONSES, ApiProblem
from lunarnav.api.schemas import LanderPage, NetworkCount, SitePage, StationPage
from lunarnav.catalog import (
    Confidence,
    LanderEntry,
    SiteEntry,
    StationEntry,
    load_landers,
    load_sites,
    load_stations,
)

router = APIRouter(tags=["catalogue"], responses={404: PROBLEM_RESPONSES[404], 422: PROBLEM_RESPONSES[422]})

Region = Literal["south_polar", "south_high", "mid", "north_high", "north_polar"]
REGION_BANDS_DEG: dict[str, tuple[float, float]] = {
    "south_polar": (-90.0, -80.0),
    "south_high": (-80.0, -60.0),
    "mid": (-60.0, 60.0),
    "north_high": (60.0, 80.0),
    "north_polar": (80.0, 90.0),
}
"""Latitude bands (planetocentric, degrees; lower bound inclusive, upper bound inclusive at +90)."""

_BBOX = "lon_min,lat_min,lon_max,lat_max in degrees; lon_min > lon_max wraps across 180 degrees."


def _parse_bbox(text: str) -> tuple[float, float, float, float]:
    try:
        lon0, lat0, lon1, lat1 = (float(p) for p in text.split(","))
    except ValueError:
        raise ApiProblem(422, "Invalid bounding box", f"Expected {_BBOX}") from None
    if not (-90 <= lat0 <= lat1 <= 90):
        raise ApiProblem(422, "Invalid bounding box", "Latitudes must satisfy -90 <= lat_min <= lat_max <= 90.")
    return lon0, lat0, lon1, lat1


def _in_lon(lon: float, lon0: float, lon1: float) -> bool:
    lon = (lon + 180.0) % 360.0 - 180.0
    a, b = (lon0 + 180.0) % 360.0 - 180.0, (lon1 + 180.0) % 360.0 - 180.0
    return a <= lon <= b if a <= b else (lon >= a or lon <= b)


def _text_match(q: str | None, *fields: str) -> bool:
    return q is None or q.lower() in " ".join(fields).lower()


@router.get("/sites", response_model=SitePage, summary="Landing sites, regions and points of interest")
def list_sites(
    kind: Annotated[list[Literal["landed", "impact", "planned", "not_landed", "region", "poi"]] | None, Query(description="Entry kinds (repeatable).")] = None,
    region: Annotated[Region | None, Query(description="Latitude band: south_polar (<= -80), south_high (-80..-60), mid (-60..60), north_high, north_polar (>= 80).")] = None,
    bbox: Annotated[str | None, Query(description=_BBOX)] = None,
    q: Annotated[str | None, Query(max_length=100, description="Case-insensitive text in id, name, mission, operator, country, notes.")] = None,
    confidence: Annotated[Confidence | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 200,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> SitePage:
    """Filtered catalogue sites in file order. Coordinates are planetocentric, east-positive, ME frame."""
    box = _parse_bbox(bbox) if bbox else None
    kinds = set(kind or [])
    out: list[SiteEntry] = []
    for e in load_sites():
        if kinds and e.kind not in kinds:
            continue
        if confidence is not None and e.confidence != confidence:
            continue
        if region is not None:
            lo, hi = REGION_BANDS_DEG[region]
            if not (lo <= e.lat_deg < hi or (hi == 90.0 and e.lat_deg == 90.0)):
                continue
        if box is not None and not (box[1] <= e.lat_deg <= box[3] and _in_lon(e.lon_deg, box[0], box[2])):
            continue
        if not _text_match(q, e.id, e.name, e.mission, e.operator, e.country, e.notes):
            continue
        out.append(e)
    return SitePage(total=len(out), items=out[offset : offset + limit])


@router.get("/sites/{site_id}", response_model=SiteEntry, summary="One site")
def get_site(site_id: str) -> SiteEntry:
    for e in load_sites():
        if e.id == site_id:
            return e
    raise ApiProblem(404, "Site not found", f"No catalogue site {site_id!r}.")


@router.get("/stations", response_model=StationPage, summary="Earth ground stations")
def list_stations(
    network: Annotated[str | None, Query(description="Network name, e.g. DSN (case-insensitive exact match).")] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    bbox: Annotated[str | None, Query(description="Geodetic " + _BBOX)] = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 200,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> StationPage:
    """Filtered stations. Latitude/longitude are geodetic WGS84, `alt_m` above the ellipsoid, masks in degrees."""
    box = _parse_bbox(bbox) if bbox else None
    out: list[StationEntry] = []
    for e in load_stations():
        if network is not None and e.network.lower() != network.lower():
            continue
        if box is not None and not (box[1] <= e.lat_deg <= box[3] and _in_lon(e.lon_deg, box[0], box[2])):
            continue
        if not _text_match(q, e.id, e.name, e.network, e.operator, e.country, e.notes):
            continue
        out.append(e)
    return StationPage(total=len(out), items=out[offset : offset + limit])


@router.get("/stations/networks", response_model=list[NetworkCount], summary="Station networks")
def list_networks() -> list[NetworkCount]:
    counts = Counter(e.network for e in load_stations())
    return [NetworkCount(network=n, count=c) for n, c in sorted(counts.items())]


@router.get("/stations/{station_id}", response_model=StationEntry, summary="One station")
def get_station(station_id: str) -> StationEntry:
    for e in load_stations():
        if e.id == station_id:
            return e
    raise ApiProblem(404, "Station not found", f"No catalogue station {station_id!r}.")


@router.get("/landers", response_model=LanderPage, summary="Lander profiles")
def list_landers(
    q: Annotated[str | None, Query(max_length=100)] = None,
    status: Annotated[Literal["flown", "in_development", "retired", "cancelled"] | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 200,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> LanderPage:
    """Lander parameter sets; every parameter says whether it is published, derived or an estimate."""
    out: list[LanderEntry] = []
    for e in load_landers():
        if status is not None and e.status != status:
            continue
        if not _text_match(q, e.id, e.name, e.operator, e.country, e.notes, *e.missions):
            continue
        out.append(e)
    return LanderPage(total=len(out), items=out[offset : offset + limit])


@router.get("/landers/{lander_id}", response_model=LanderEntry, summary="One lander profile")
def get_lander(lander_id: str) -> LanderEntry:
    for e in load_landers():
        if e.id == lander_id:
            return e
    raise ApiProblem(404, "Lander not found", f"No catalogue lander {lander_id!r}.")
