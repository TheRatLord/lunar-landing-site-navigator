"""Sourced reference catalogue: landing sites, Earth ground stations, lander profiles.

Data lives in YAML beside this module. Loaders validate against the pydantic schema in
`lunarnav.catalog.models` and cache the result; entries are immutable.
"""

from __future__ import annotations

from functools import cache
from importlib import resources

import yaml

from lunarnav.catalog.models import (
    CatalogEntry,
    CauseCategory,
    Confidence,
    Criterion,
    LanderEntry,
    LaunchVehicleEntry,
    MissionEntry,
    SiteEntry,
    StationEntry,
)

__all__ = [
    "CauseCategory",
    "Confidence",
    "Criterion",
    "LanderEntry",
    "LaunchVehicleEntry",
    "MissionEntry",
    "SiteEntry",
    "StationEntry",
    "load_criterion_map",
    "load_landers",
    "load_launch_vehicles",
    "load_missions",
    "load_sites",
    "load_stations",
]


def _doc(filename: str) -> dict:
    return yaml.safe_load(resources.files(__package__).joinpath(filename).read_text(encoding="utf-8"))


def _load[T: CatalogEntry](filename: str, model: type[T]) -> tuple[T, ...]:
    doc = _doc(filename)
    entries = tuple(model.model_validate(item) for item in doc["entries"])
    ids = [e.id for e in entries]
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    if dupes:
        raise ValueError(f"{filename}: duplicate ids {dupes}")
    return entries


@cache
def load_sites() -> tuple[SiteEntry, ...]:
    """All landing sites, regions and points of interest from ``sites.yaml``."""
    return _load("sites.yaml", SiteEntry)


@cache
def load_stations() -> tuple[StationEntry, ...]:
    """All Earth ground stations from ``stations.yaml``; use `.to_ground_station()` for the engine."""
    return _load("stations.yaml", StationEntry)


@cache
def load_landers() -> tuple[LanderEntry, ...]:
    """All lander profiles from ``landers.yaml``."""
    return _load("landers.yaml", LanderEntry)


@cache
def load_launch_vehicles() -> tuple[LaunchVehicleEntry, ...]:
    """All launch vehicle flight records from ``launch_vehicles.yaml``."""
    return _load("launch_vehicles.yaml", LaunchVehicleEntry)


@cache
def load_missions() -> tuple[MissionEntry, ...]:
    """All landing attempts from ``missions.yaml``, checked against the site, lander and vehicle catalogues."""
    entries = _load("missions.yaml", MissionEntry)
    sites = {s.id for s in load_sites()}
    landers = {e.id for e in load_landers()}
    vehicles = {v.id for v in load_launch_vehicles()}
    for m in entries:
        for field, value, known in (("site_id", m.site_id, sites), ("target_site_id", m.target_site_id, sites),
                                    ("lander_id", m.lander_id, landers),
                                    ("launch_vehicle_id", m.launch_vehicle_id, vehicles)):
            if value is not None and value not in known:
                raise ValueError(f"missions.yaml: {m.id}: unknown {field} {value!r}")
    return entries


@cache
def load_criterion_map() -> dict[CauseCategory, Criterion | None]:
    """Review criterion each cause category counts against (``None``: not a site matter)."""
    raw = _doc("missions.yaml")["criterion_map"]
    out = {CauseCategory(k): v for k, v in raw.items()}
    missing = set(CauseCategory) - set(out)
    if missing:
        raise ValueError(f"missions.yaml: criterion_map lacks {sorted(missing)}")
    return out
