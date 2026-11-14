"""Per-run engine state shared by the engine tools: scenario store, terrain providers, overlays."""

from __future__ import annotations

import json
import threading
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from lunarnav.scenario import HorizonProvider, Scenario, SmoothSphereProvider, TerrainProvider

from .. import fsafe
from ..config import AgentConfig
from ..ids import SCENARIO_ID_RE, scenario_id_from_dump
from ..registry import ToolError
from ..signoff import require_intact, status_by_id
from ..store import RunPaths, write_json_atomic

DEFAULT_N_AZ = 720
TERRAIN_CHOICES = "'stock' (default: LOLA terrain stack), 'sphere' (no terrain) or 'user:<dem_id>' (an ingested user DEM)"


def scenario_id_of(scenario: Scenario) -> str:
    """Content-addressed scenario id: ``sc-`` plus 10 hex digits of the canonical JSON hash."""
    return scenario_id_from_dump(scenario.model_dump(mode="json"))


class EngineState:
    """Scenario files, terrain providers and ingested overlays of one run.

    Engine calls are serialised by ``lock``: the horizon caches are not thread safe, and one call
    already uses the machine's cores.
    """

    def __init__(self, paths: RunPaths, config: AgentConfig) -> None:
        self.paths = paths
        self.config = config
        self.lock = threading.RLock()
        self._stock: TerrainProvider | None = None
        self._stock_by_stores: dict[tuple[str, ...], TerrainProvider] = {}
        self._overlays: dict[str, TerrainProvider] = {}


    @property
    def scenario_dir(self) -> Path:
        """``state/scenarios``: written only here, read-only for the sandbox."""
        return self.paths.scenarios

    def save_scenario(self, scenario: Scenario, depends_on: Iterable[str] = (), created_by: str | None = None,
                      limits: Iterable[str] = (), limit_notes: dict[str, list[str]] | None = None) -> str:
        """Store a scenario (idempotent) and return its id.

        Dependencies and limits accumulate across saves: they are the lineage of the scenario (the assumptions and
        model limits of what it was built from, such as constraints interpreted from a document), and every analysis
        of the scenario carries them (`Call.scenario`).
        """
        sid = scenario_id_of(scenario)
        path = self.scenario_dir / f"{sid}.json"
        deps, lim = set(depends_on), set(limits)
        notes = {k: set(v) for k, v in (limit_notes or {}).items()}
        if fsafe.exists(path):
            old = json.loads(fsafe.read_text(path))
            deps |= set(old["depends_on"])
            lim |= set(old["limits"])
            for k, v in old["limit_notes"].items():
                notes.setdefault(k, set()).update(v)
        write_json_atomic(path, {"scenario_id": sid, "depends_on": sorted(deps), "limits": sorted(lim),
                                 "limit_notes": {k: sorted(v) for k, v in sorted(notes.items())},
                                 "created_by": created_by, "scenario": scenario.model_dump(mode="json")}, mkdir=True)
        return sid

    def load_scenario(self, sid: str) -> tuple[Scenario, dict[str, Any]]:
        """Scenario and its stored record (``depends_on``, ``limits``, ``limit_notes``: its lineage, see `save_scenario`);
        unknown ids are a tool error.

        The stored scenario is re-hashed and must reproduce its id; a file that does not is refused.
        """
        if not isinstance(sid, str) or not SCENARIO_ID_RE.match(sid):
            raise ToolError(f"{sid!r} is not a scenario id (use the scenario_id returned by build_scenario)")
        path = self.scenario_dir / f"{sid}.json"
        if not fsafe.exists(path):
            raise ToolError(f"unknown scenario {sid!r}; build it with build_scenario")
        doc = json.loads(fsafe.read_text(path))
        scenario = Scenario.model_validate(doc["scenario"])
        if scenario_id_of(scenario) != sid:
            raise ToolError(f"stored scenario {sid} does not match its content hash; it was altered and is refused")
        return scenario, doc


    def check_not_rejected(self, assumption_ids: Iterable[str]) -> None:
        """Refuse to compute from something a planner rejected (or when the ledgers fail verification)."""
        try:
            require_intact(self.paths)
        except ValueError as exc:
            raise ToolError(str(exc)) from exc
        status = status_by_id(self.paths)
        bad = [a for a in assumption_ids if status.get(a) == "rejected"]
        if bad:
            notes = []
            from ..signoff import assumption_status

            for a in assumption_status(self.paths):
                if a["assumption_id"] in bad and a["signoffs"]:
                    last = a["signoffs"][-1]
                    notes.append(f"{a['assumption_id']} ({a['statement']}) rejected by {last['who']}: {last['note']}")
            raise ToolError(
                "this input depends on rejected assumption(s): " + "; ".join(notes)
                + ". Do not reuse results that depend on them; rebuild the scenario with the planner's values "
                "(build_scenario patch) and recompute.")


    def provider(self, terrain: str, stores: tuple[str, ...] | None = None) -> tuple[HorizonProvider, tuple[str, ...]]:
        """Horizon provider for a ``terrain`` choice and the assumptions it depends on."""
        if terrain == "sphere":
            return SmoothSphereProvider(DEFAULT_N_AZ), ()
        if terrain == "stock":
            return self.stock_provider(stores), ()
        if terrain.startswith("user:"):
            dem_id = terrain[5:]
            info = self.overlays().get(dem_id)
            if info is None:
                raise ToolError(f"unknown user DEM {dem_id!r}; ingest it first (ingest_terrain_dem). Known: "
                                f"{sorted(self.overlays())}")
            return self._overlay_provider(dem_id, info), (info["assumption_id"], *info.get("override_assumption_ids", ()))
        raise ToolError(f"terrain must be {TERRAIN_CHOICES}")

    def stock_provider(self, stores: tuple[str, ...] | None = None) -> TerrainProvider:
        """The stock stack; with ``stores`` only those stores (a scenario that names its terrain stores)."""
        from lunarnav.terrain import TerrainStack

        if stores is not None:
            if stores not in self._stock_by_stores:
                self._stock_by_stores[stores] = TerrainProvider(TerrainStack.open(dem_ids=list(stores)), n_az=DEFAULT_N_AZ)
            return self._stock_by_stores[stores]
        if self._stock is None:
            self._stock = TerrainProvider(TerrainStack.open(), n_az=DEFAULT_N_AZ)
        return self._stock

    @property
    def overlay_registry_path(self) -> Path:
        return self.paths.ingest / "dems.json"

    def overlays(self) -> dict[str, dict[str, Any]]:
        """Ingested user DEMs: ``dem_id -> {store, assumption_id, ...}``."""
        path = self.overlay_registry_path
        return json.loads(fsafe.read_text(path)) if fsafe.exists(path) else {}

    def register_overlay(self, dem_id: str, info: dict[str, Any]) -> None:
        path = self.overlay_registry_path
        reg = self.overlays()
        reg[dem_id] = info
        write_json_atomic(path, reg, mkdir=True)
        self._overlays.pop(dem_id, None)

    def _overlay_provider(self, dem_id: str, info: dict[str, Any]) -> TerrainProvider:
        if dem_id not in self._overlays:
            from lunarnav.terrain import TerrainStore

            from ..ingest.terrain_dem import overlay_stack

            rel = str(info["store"])
            store_path = self.paths.root / rel
            if not rel.startswith("state/ingest/stores/") or ".." in Path(rel).parts or not fsafe.is_dir(store_path):
                raise ToolError(f"user DEM {dem_id!r} has no valid store; ingest it again")
            store = TerrainStore(store_path)
            stack = overlay_stack(self.stock_provider().stack, store)
            self._overlays[dem_id] = TerrainProvider(
                stack, n_az=DEFAULT_N_AZ, cache_dir=str(self.paths.state_cache / "horizons"))
        return self._overlays[dem_id]
