"""Sourced reference catalogue: landing sites, Earth ground stations, lander profiles.

Data lives in YAML beside this module. Loaders validate against the pydantic schema in
`lunarnav.catalog.models` and cache the result; entries are immutable.
"""

from __future__ import annotations

from functools import cache
from importlib import resources

import yaml

from lunarnav.catalog.models import CatalogEntry, Confidence, LanderEntry, SiteEntry, StationEntry

__all__ = [
    "Confidence",
    "LanderEntry",
    "SiteEntry",
    "StationEntry",
    "load_landers",
    "load_sites",
    "load_stations",
]


def _load[T: CatalogEntry](filename: str, model: type[T]) -> tuple[T, ...]:
    text = resources.files(__package__).joinpath(filename).read_text(encoding="utf-8")
    doc = yaml.safe_load(text)
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
