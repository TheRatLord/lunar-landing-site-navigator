"""Provenance block attached to every result and export: inputs, kernels, terrain, code, schema.

No timestamps and no host paths, so that the same inputs give the same block (deterministic tests and
reproducible exports).
"""

from __future__ import annotations

import hashlib
import json
from functools import cache
from importlib import metadata
from typing import Any

from lunarnav.ephem import BodyFixedEphemeris, eclipse_occulting_radius_km
from lunarnav.source import source_sha256

from .horizons import HorizonProvider
from .models import SCHEMA_VERSION, EclipseSettings, Scenario

OUR_DEFINITIONS = {
    "roughness": ("our definition, not a published product: RMS residual about the best-fit plane over 9 heights "
                  "(the site and eight compass points at the slope baseline)"),
    "quasi_continuous_filter_order": ("our definition: the order of the De Rosa et al. 2012 filter (lit spans shorter "
                                      "than the minimum first counted dark, then dark gaps shorter than the maximum "
                                      "counted lit) is our reading, the source does not state it"),
    "case": ("our definition: a case (nominal, optimistic, pessimistic) is a horizon bound together with a heading bound; "
             "optimistic power takes the best heading at each instant, pessimistic the worst, so no single heading achieves "
             "them; with the heading unknown there is no nominal heading and the nominal power is the mean over headings"),
}
"""Definitions that are ours rather than taken from a source; carried in every result's provenance."""


@cache
def code_version() -> dict[str, str]:
    """Package version and the `results`-scope source hash (see `source_sha256`)."""
    try:
        version = metadata.version("lunarnav")
    except metadata.PackageNotFoundError:
        version = "unknown"
    return {"package_version": version, "source_sha256": source_sha256("results")}


def engine_blocks() -> dict[str, Any]:
    """The `schema_version`, `code` and `kernels` blocks every result's provenance carries."""
    from lunarnav.ephem.kernels import load_kernels

    return {"schema_version": SCHEMA_VERSION, "code": code_version(), "kernels": dict(load_kernels().provenance())}


def eclipse_provenance(settings: EclipseSettings) -> dict[str, Any]:
    """Shadow convention as passed to `ephem.earth_eclipse_fraction`, with the occulting radius used."""
    return {
        "shadow": settings.shadow, "earth_radius_km_override": settings.earth_radius_km,
        "atmosphere_km": settings.atmosphere_km,
        "occulting_radius_km": eclipse_occulting_radius_km(
            settings.shadow, settings.earth_radius_km, settings.atmosphere_km),
        "origin": settings.origin.model_dump(mode="json"),
    }


def canonical_scenario_json(scenario: Scenario) -> str:
    """The canonical serialisation of a scenario: `json.dumps(model_dump(mode="json"), sort_keys=True)` with the default
    separators. Its UTF-8 bytes are what `scenario_hash` hashes, so `sha256sum` of a file holding exactly this string
    reproduces the printed hash."""
    return json.dumps(scenario.model_dump(mode="json"), sort_keys=True)


def scenario_hash(scenario: Scenario) -> str:
    """SHA-256 of `canonical_scenario_json(scenario)` (UTF-8)."""
    return hashlib.sha256(canonical_scenario_json(scenario).encode()).hexdigest()


def site_terrain(scenario: Scenario, provider: HorizonProvider) -> dict[str, Any] | None:
    """The terrain store that serves the site (finest store with valid data there): `dem_id`, `pixel_m`,
    `meta_hash`; None for a provider without terrain or a site outside the data."""
    stack = getattr(provider, "stack", None)
    if stack is None or not provider.models_terrain:
        return None
    lon = scenario.site.lon_deg if scenario.site.lon_deg <= 180.0 else scenario.site.lon_deg - 360.0
    store = stack.select(scenario.site.lat_deg, lon)
    if store is None:
        return None
    return {"dem_id": store.dem_id, "pixel_m": store.pixel_size_m, "meta_hash": store.meta_hash}


def load_model(scenario: Scenario) -> dict[str, Any]:
    """The battery load model in force: sunlit-window loads from the profile, and the load applied where the
    profile has no segment (outside the evaluated span), which is the profile's dark load."""
    loads = scenario.profile.loads
    return {"sunlit_w": loads.sunlit_w, "dark_w": loads.dark_w, "outside_profile_w": loads.dark_w,
            "note": "the load profile spans the whole simulated window, so the outside load is never applied to a result; it is set to the dark load (the survival state) rather than to zero"}


def antenna_height_record(scenario: Scenario) -> dict[str, Any]:
    """Earth-link antenna height used (nominal, upper bound) and how well it is known: the catalogue flags it as an
    estimate (half the vehicle height) when the operator does not publish the antenna position."""
    prof = scenario.profile
    o = prof.origins.get("antenna_height_m")
    return {"antenna_height_m": prof.antenna_height_m, "antenna_height_max_m": prof.antenna_height_max_m,
            "basis": None if o is None else o.basis, "note": None if o is None else o.note,
            "optimistic_world": "Earth-link horizon at antenna_height_max_m" if prof.antenna_height_max_m is not None
            and prof.antenna_height_max_m > prof.antenna_height_m else "same height as nominal"}


def terrain_error_record(scenario: Scenario, provider: HorizonProvider) -> dict[str, Any]:
    """Terrain-error budget in force: the settings (`mode`, `k_sigma`, and in `custom` mode the sigmas) and the stack's
    `error_table()` rows (figure, `published`/`assumed` basis, source of each store). The budget actually applied per
    horizon (range of sigmas, stores used) is in `horizons[...]["budget"]`. Without terrain nothing is widened."""
    te = scenario.terrain_error
    rec: dict[str, Any] = {"enabled": bool(te.enabled and provider.models_terrain), "mode": te.mode, "k_sigma": te.k_sigma}
    if te.mode == "custom":
        rec |= {"sigma_z_m": te.sigma_z_m, "sigma_xy_m": te.sigma_xy_m, "origin": te.origin.model_dump(mode="json")}
    table = getattr(provider, "error_table", None)
    rec["stores"] = table() if (table is not None and provider.models_terrain) else None
    return rec


def check_terrain_stack(scenario: Scenario, provider: HorizonProvider) -> None:
    """Refuse a provider that is not the scenario's terrain choice (`Scenario.terrain_stores`; no check when it is None)."""
    ids = scenario.terrain_stores
    if ids is None:
        return
    stack = getattr(provider, "stack", None)
    have = None if stack is None else tuple(sorted(stack.dem_ids))
    if have != ids:
        shown = "no terrain (smooth sphere)" if have is None else str(list(have))
        raise ValueError(f"scenario terrain_stores {list(ids)} does not match the provider's stack {shown}")


def _default_stack_identity() -> tuple[tuple[str, ...], str]:
    """(store ids in engine order, stack hash) of the engine's default stack for the data directory, from the terrain package
    (`TerrainStack.open()`); cached per set of complete stores on disk."""
    from lunarnav.terrain.paths import store_dir

    return _default_identity(tuple(sorted(p.parent.name for p in store_dir().glob("*/meta.json"))))


@cache
def _default_identity(listing: tuple[str, ...]) -> tuple[tuple[str, ...], str]:
    from lunarnav.terrain import TerrainStack

    stack = TerrainStack.open()
    return stack.dem_ids, stack.stack_hash


def terrain_stack_record(scenario: Scenario, provider: HorizonProvider) -> dict[str, Any]:
    """Which terrain stack produced the horizons, as facts about the provider's stack and who chose it.

    `dem_ids` (engine order) and `stack_hash` describe the provider's stack (`[]`/None for a smooth sphere). `is_default`: the stack is
    exactly the engine's default stack for the data directory. `restricted`: the scenario named its stores (`terrain_stores`).
    `chosen_by`: `scenario` (named in the scenario), `default` (no choice made and the stack is the default), `caller` (the caller
    built the provider on another stack while the scenario names none) or `none` (no terrain: smooth sphere). A report must not
    present a `caller` stack as the default."""
    stack = getattr(provider, "stack", None)
    restricted = scenario.terrain_stores is not None
    if stack is None:
        return {"dem_ids": [], "stack_hash": None, "is_default": False, "restricted": restricted, "chosen_by": "none"}
    ids, digest = _default_stack_identity()
    is_default = tuple(stack.dem_ids) == ids and stack.stack_hash == digest
    chosen = "scenario" if restricted else ("default" if is_default else "caller")
    return {"dem_ids": list(stack.dem_ids), "stack_hash": stack.stack_hash, "is_default": is_default, "restricted": restricted,
            "chosen_by": chosen}


def build_provenance(
    scenario: Scenario, provider: HorizonProvider, table: BodyFixedEphemeris, *,
    horizons: dict[str, dict] | None = None, analysis: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Provenance block of an analysis.

    `horizons` carries the per-horizon reports (nodata counts, widening) and `analysis` the analysis
    parameters (grids, window, scan settings)."""
    check_terrain_stack(scenario, provider)
    return {
        "schema_version": SCHEMA_VERSION,
        "code": code_version(),
        "terrain_stack": terrain_stack_record(scenario, provider),
        "kernels": dict(table.provenance["kernels"]),
        "ephemeris": {k: v for k, v in table.provenance.items() if k != "kernels"},
        "horizon_provider": provider.provenance(),
        "site_terrain": site_terrain(scenario, provider),
        "terrain_error": terrain_error_record(scenario, provider),
        "load_model": load_model(scenario),
        "antenna_height": antenna_height_record(scenario),
        "our_definitions": OUR_DEFINITIONS,
        "horizons": horizons or {},
        "eclipse": eclipse_provenance(scenario.eclipse),
        "scenario_sha256": scenario_hash(scenario),
        "scenario": scenario.model_dump(mode="json"),
        "analysis": analysis or {},
    }
