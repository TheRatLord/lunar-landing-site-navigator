"""Scenario building blocks: lander profiles, constraint presets, network presets and JSON Schemas."""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

from fastapi import APIRouter

from lunarnav.api.errors import PROBLEM_RESPONSES, ApiProblem
from lunarnav.api.schemas_scenario import (
    ConstraintPresetEntry,
    ConstraintPresetsResponse,
    NetworkPresetEntry,
    NetworkPresetsResponse,
    ProfileEntry,
    ProfileEstimate,
    ProfilesResponse,
)
from lunarnav.catalog import load_landers, load_stations
from lunarnav.scenario import (
    constraints_preset,
    generic_layouts,
    generic_profile,
    network_from_catalog,
    profile_from_catalog,
)
from lunarnav.scenario import constraints_preset as _preset_fn
from lunarnav.scenario.models import Constraints, LanderProfile, Network, Scenario, SiteSpec, Transfer

router = APIRouter(tags=["scenarios"], responses={404: PROBLEM_RESPONSES[404]})

PRESET_NAMES = ("apollo-lighting", "peregrine-lighting", "viper-polar", "power-reserve")
"""Names accepted by `lunarnav.scenario.constraints_preset` (listed in its docstring)."""

SCHEMAS: dict[str, type] = {
    "scenario": Scenario, "lander-profile": LanderProfile, "constraints": Constraints, "network": Network,
    "site": SiteSpec, "transfer": Transfer,
}


def _entry(pid: str, source: str, lander_id: str | None, variant: str, profile: LanderProfile) -> ProfileEntry:
    est = [ProfileEstimate(path=k, basis=o.basis, label=o.label, source_url=o.source_url, note=o.note)
           for k, o in sorted(profile.estimates().items())]
    published = sum(1 for o in profile.origins.values() if o.basis == "published")
    return ProfileEntry(id=pid, source=source, lander_id=lander_id, variant=variant, name=profile.name,  # type: ignore[arg-type]
                        description=profile.description, profile=profile, estimates=est, n_published=published)


def build_profiles() -> ProfilesResponse:
    out: list[ProfileEntry] = []
    for lander in load_landers():
        for polar in (False, True):
            p = profile_from_catalog(lander, polar=polar)
            out.append(_entry(p.id, "catalog", lander.id, "polar" if polar else "default", p))
    for layout in generic_layouts():
        p = generic_profile(layout)
        out.append(_entry(p.id, "generic", None, layout, p))
    return ProfilesResponse(profiles=out, layouts=list(generic_layouts()))


def _preset_descriptions() -> dict[str, str]:
    doc = _preset_fn.__doc__ or ""
    return {m.group(1): m.group(2).strip() for m in re.finditer(r"^- `([a-z-]+)`: (.+)$", doc, re.M)}


def build_constraint_presets() -> ConstraintPresetsResponse:
    desc = _preset_descriptions()
    return ConstraintPresetsResponse(presets=[
        ConstraintPresetEntry(name=n, description=desc.get(n, ""), constraints=constraints_preset(n))
        for n in PRESET_NAMES])


def build_network_presets() -> NetworkPresetsResponse:
    groups: dict[str, list[str]] = defaultdict(list)
    for s in load_stations():
        groups[s.network].append(s.id)
    presets = [NetworkPresetEntry(
        id="dsn-complexes", label="DSN: one 70 m / 34 m station per complex",
        description="DSS-14 (Goldstone), DSS-43 (Canberra), DSS-63 (Madrid) with their published receive masks.",
        station_ids=["dss-14", "dss-43", "dss-63"], network=network_from_catalog())]
    for net, ids in sorted(groups.items()):
        if len(ids) < 2:
            continue
        label = f"All catalogue stations of {net}"
        presets.append(NetworkPresetEntry(
            id=f"{net.lower()}-all", label=label, description=f"{len(ids)} stations, published masks where the catalogue has them.",
            station_ids=sorted(ids), network=network_from_catalog(sorted(ids), label=label)))
    return NetworkPresetsResponse(presets=presets)


@router.get("/profiles", response_model=ProfilesResponse, summary="Lander profiles with published/estimate flags")
def profiles() -> ProfilesResponse:
    """Catalogue-derived starting profiles (default and polar variant per lander) and generic layout templates.

    Each entry carries the full `LanderProfile` plus `estimates`: every field whose origin is not published or
    user-entered, so the editor can flag it."""
    return build_profiles()


@router.get("/constraints/presets", response_model=ConstraintPresetsResponse, summary="Constraint presets with sources")
def constraint_presets() -> ConstraintPresetsResponse:
    """Named starting constraint sets. Each limit carries its `origin` (basis, label, source URL). None is a
    general requirement."""
    return build_constraint_presets()


@router.get("/networks/presets", response_model=NetworkPresetsResponse, summary="Ground-station network presets")
def network_presets() -> NetworkPresetsResponse:
    """Networks built from the station catalogue (published receive masks)."""
    return build_network_presets()


@router.get("/schemas/{name}", summary="JSON Schema of a scenario building block")
def schema(name: str) -> dict[str, Any]:
    """JSON Schema (draft 2020-12) of `scenario`, `lander-profile`, `constraints`, `network`, `site`, `transfer`,
    for deriving forms at run time."""
    model = SCHEMAS.get(name)
    if model is None:
        raise ApiProblem(404, "Unknown schema", f"No schema {name!r}; available: {sorted(SCHEMAS)}.")
    return model.model_json_schema()  # type: ignore[attr-defined]
