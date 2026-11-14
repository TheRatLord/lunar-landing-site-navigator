"""The planner's saved scenarios, as a read-only view for the agent.

A planner saves scenarios in the interface; the service keeps them. When a run is started with a `ScenarioSource`
the agent gets two tools: `list_saved_scenarios` (bounded, newest first) and `load_saved_scenario`, which validates a
stored document through the engine's `Scenario` model, writes it into the run's own scenario store and returns the
run-local `scenario_id` that every analysis tool takes. Nothing is written to the service: the source only reads.
Both calls are ledgered like any engine input (the scenario's SHA-256 is the data version), so a number computed
from a saved scenario cites the exact document it came from.
"""

from __future__ import annotations

import asyncio
from typing import Any, ClassVar, Protocol

from pydantic import BaseModel, Field, ValidationError

from lunarnav.scenario import Scenario
from lunarnav.scenario.provenance import scenario_hash

from .engine_tools.common import Call, EngineOutput
from .engine_tools.scenario_build import heading_brief
from .registry import AgentTool, ToolContext, ToolError, agent_tool
from .store import canonical_json, sha256_bytes

DEFAULT_LIST_LIMIT = 20
"""Saved scenarios `list_saved_scenarios` returns when the model gives no limit."""

MAX_LIST_LIMIT = 50
"""Most saved scenarios one `list_saved_scenarios` call returns, whatever limit is asked."""

MAX_NAME_CHARS = 120
"""Characters of a saved scenario's name shown to the model (names are typed by people)."""

SAVED_ID_MAX_CHARS = 64
"""Longest saved-scenario id accepted by `load_saved_scenario`."""


class ScenarioSource(Protocol):
    """Read-only access to the service's stored scenarios; both calls are synchronous and run on a worker thread."""

    def list(self, limit: int) -> list[dict[str, Any]]:
        """At most `limit` summaries, newest first: ``scenario_id``, ``name``, ``site`` (``lat_deg``, ``lon_deg``),
        ``landing_utc``, ``scenario_sha256`` (the engine's scenario hash), ``updated_utc``."""
        ...

    def load(self, scenario_id: str) -> dict[str, Any] | None:
        """The stored scenario document, or None when there is no such scenario."""
        ...


class ListSavedInput(BaseModel):
    """Arguments of `list_saved_scenarios`."""

    limit: int = Field(default=DEFAULT_LIST_LIMIT, ge=1, le=MAX_LIST_LIMIT,
                       description=f"How many saved scenarios to list, newest first (at most {MAX_LIST_LIMIT}).")


class SavedScenarioRow(BaseModel):
    """One saved scenario."""

    scenario_id: str = Field(description="The service's id; pass it to `load_saved_scenario`.")
    name: str
    site: dict[str, Any] = Field(description="`lat_deg`, `lon_deg` of the landing site.")
    landing_utc: str | None
    scenario_sha256: str | None = Field(description="Engine scenario hash, equal to the hash every analysis states.")
    updated_utc: str | None


class ListSavedOutput(EngineOutput):
    """Result of `list_saved_scenarios`."""

    scenarios: list[SavedScenarioRow]
    ROW_LISTS: ClassVar[dict[str, str]] = {"scenarios": "scenario_id"}
    truncated: bool = Field(description="More saved scenarios exist than were listed; ask for a larger limit or name the one wanted.")


def _text(value: Any, limit: int) -> str | None:
    return None if value is None else str(value)[:limit]


def _row(raw: dict[str, Any]) -> SavedScenarioRow:
    site = raw.get("site") if isinstance(raw.get("site"), dict) else {}
    return SavedScenarioRow(
        scenario_id=str(raw["scenario_id"])[:SAVED_ID_MAX_CHARS], name=str(raw.get("name", ""))[:MAX_NAME_CHARS],
        site={k: site.get(k) for k in ("lat_deg", "lon_deg")}, landing_utc=_text(raw.get("landing_utc"), 40),
        scenario_sha256=_text(raw.get("scenario_sha256"), 64), updated_utc=_text(raw.get("updated_utc"), 40))


def _source(ctx: ToolContext) -> ScenarioSource:
    if ctx.scenarios is None:
        raise ToolError("this run has no saved scenarios to read")
    return ctx.scenarios


@agent_tool(
    "list_saved_scenarios",
    "List the scenarios the planner has saved in the interface (newest first, at most 50): id, name, site, landing "
    "time and the engine's scenario hash (the one every analysis states). Use it when the planner refers to 'my scenario' or a saved "
    "one; then call `load_saved_scenario` with the id. Read-only.",
    ListSavedInput,
    read_only=True,
)
async def list_saved_scenarios(ctx: ToolContext, args: ListSavedInput) -> ListSavedOutput:
    source = _source(ctx)
    raw = await asyncio.to_thread(source.list, args.limit + 1)
    rows = [_row(r) for r in raw[: args.limit]]
    out = ListSavedOutput(
        scenarios=rows, truncated=len(raw) > args.limit,
        summary=f"{len(rows)} saved scenario(s)" + (" (more exist)" if len(raw) > args.limit else ""))
    out.data_versions = {"saved_scenarios": "sha256:" + sha256_bytes(canonical_json([r.model_dump() for r in rows]).encode())}
    return out


class LoadSavedInput(BaseModel):
    """Arguments of `load_saved_scenario`."""

    scenario_id: str = Field(max_length=SAVED_ID_MAX_CHARS, description="Id from `list_saved_scenarios` (`scen-` and 12 hex digits).")


class LoadSavedOutput(EngineOutput):
    """Result of `load_saved_scenario`."""

    scenario_id: str = Field(description="Run-local id (`sc-...`): the argument of every analysis tool.")
    saved_id: str
    scenario_sha256: str = Field(description="Engine scenario hash, equal to the hash every analysis states.")
    scenario: dict[str, Any] = Field(description="Brief: name, site, landing, duration, active constraints, heading, terrain_stores.")


@agent_tool(
    "load_saved_scenario",
    "Load one of the planner's saved scenarios by its id (from `list_saved_scenarios`). The stored document is "
    "validated by the engine's scenario model and put into this run; the returned `scenario_id` is what "
    "`evaluate_site`, `scan_windows` and the other analysis tools take. The saved scenario is not modified: change "
    "it only through `build_scenario` patches, which make a new scenario.",
    LoadSavedInput,
    read_only=False,
)
async def load_saved_scenario(ctx: ToolContext, args: LoadSavedInput) -> LoadSavedOutput:
    source = _source(ctx)
    call = Call(ctx, "load_saved_scenario")

    def work() -> tuple[Scenario, str]:
        document = source.load(args.scenario_id)
        if document is None:
            raise ToolError(f"no saved scenario {args.scenario_id!r}; list them with list_saved_scenarios")
        try:
            scenario = Scenario.model_validate(document)
        except ValidationError as exc:
            raise ToolError(f"the saved scenario {args.scenario_id} no longer validates against the engine's scenario "
                            f"model ({exc.error_count()} invalid field(s), first: {exc.errors(include_url=False)[0]['loc']}); "
                            "it needs to be re-saved in the interface") from exc
        return scenario, call.save_scenario(scenario, "load_saved_scenario")

    scenario, sid = await call.run(work)
    sha = scenario_hash(scenario)
    out = LoadSavedOutput(
        scenario_id=sid, saved_id=args.scenario_id, scenario_sha256=sha,
        scenario={"name": scenario.name, "site": {"name": scenario.site.name, "lat_deg": scenario.site.lat_deg, "lon_deg": scenario.site.lon_deg},
                  "landing_utc": scenario.landing_utc, "mission_duration_h": scenario.mission_duration_h,
                  "constraints": sorted(scenario.constraints.active()), "heading": heading_brief(scenario),
                  "terrain_stores": None if scenario.terrain_stores is None else list(scenario.terrain_stores)},
        summary=f"saved scenario {args.scenario_id} ({scenario.name}) loaded as {sid}")
    out.data_versions = {"saved_scenario": f"sha256:{sha}"}
    return call.finish(out)


def saved_scenario_tools() -> list[AgentTool[Any]]:
    """The two tools; the session registers them only when it has a `ScenarioSource`."""
    return [list_saved_scenarios, load_saved_scenario]
