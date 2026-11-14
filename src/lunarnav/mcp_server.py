"""Standalone MCP server over the lunarnav engine and history tools (``lunarnav mcp``).

Each `AgentTool` in `EXPOSED` is served under its own name with its pydantic JSON schema and runs through the
registry's `invoke`, so validation, the provenance ledger and output limits are the same as in the agent. Two control
tools are for the client program, not the model: ``record_planner_request`` puts the planner's request into the run
transcript (values the model passes are then checked against it), and ``set_blind_mission`` starts or ends a blind
backtest of one mission. In blind mode tool arguments are unaliased and tool outputs redacted (`lunarnav.history`).
"""

from __future__ import annotations

import json
import sys
from typing import Any

import mcp_types as types

from lunarnav import history
from lunarnav.agent.bus import EventBus
from lunarnav.agent.config import AgentConfig
from lunarnav.agent.engine_tools import engine_tools
from lunarnav.agent.events import UserPrompt
from lunarnav.agent.registry import AgentTool, ToolContext, invoke
from lunarnav.agent.store import EventLog, JsonlLedger, RunPaths, new_run_id

EXPOSED = (
    "catalog_search", "build_scenario", "evaluate_site", "scan_opportunities", "slip_analysis",
    "rank_alternative_sites", "sensitivity", "attribute_event", "compare_scenarios", "illumination_stats",
    "horizon_profile", "terrain_info", "ephemeris_track", "ellipse_statistics", "search_sites",
    "historical_landings", "mission_lessons", "similar_past_landings", "launch_vehicle_record", "launch_slip_risk",
)
CONTROL = {
    "record_planner_request": (
        "Client control, not for the model: record the planner's request text for this run.",
        {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}),
    "set_blind_mission": (
        "Client control, not for the model: start a blind backtest of one mission (null ends it).",
        {"type": "object", "properties": {"mission_id": {"type": ["string", "null"]}}, "required": ["mission_id"]}),
}


def _text(payload: Any, is_error: bool = False) -> types.CallToolResult:
    return types.CallToolResult(content=[types.TextContent(text=json.dumps(payload, ensure_ascii=False))],
                                is_error=is_error)


def build_server(*, no_tools: bool = False):
    """The MCP server and the run directory its ledger lives in."""
    from mcp.server.lowlevel.server import Server

    config = AgentConfig.load()
    paths = RunPaths.create(config.runs_dir, "mcp-" + new_run_id())
    bus = EventBus(paths.run_id, EventLog(paths.transcript))
    ctx = ToolContext(paths, config, JsonlLedger(paths.ledger), bus.emit)
    tools: dict[str, AgentTool[Any]] = {} if no_tools else {
        t.name: t for t in engine_tools() if t.name in EXPOSED}

    async def list_tools(_ctx: Any, _params: Any) -> types.ListToolsResult:
        listed = [types.Tool(name=t.name, description=history.redact(t.description),
                             input_schema=t.input_model.model_json_schema()) for t in tools.values()]
        listed += [types.Tool(name=n, description=d, input_schema=s) for n, (d, s) in CONTROL.items()]
        return types.ListToolsResult(tools=listed)

    async def call_tool(_ctx: Any, params: types.CallToolRequestParams) -> types.CallToolResult:
        args = params.arguments or {}
        if params.name == "record_planner_request":
            bus.emit(UserPrompt, text=str(args.get("text", "")))
            return _text({"ok": True})
        if params.name == "set_blind_mission":
            try:
                b = history.set_blind(args.get("mission_id"))
            except (KeyError, ValueError) as exc:
                return _text({"error": str(exc)}, True)
            return _text({"ok": True, "blind": b is not None})
        item = tools.get(params.name)
        if item is None:
            return _text({"error": f"unknown tool {params.name!r}"}, True)
        payload, is_error = await invoke(item, ctx, history.unalias(args))
        return _text(history.redact(payload), is_error)

    server = Server("lunarnav", version="0.1.0", on_list_tools=list_tools, on_call_tool=call_tool)
    return server, paths


def serve(*, http_port: int | None = None, blind_exclude: str | None = None, no_tools: bool = False) -> None:
    """Run the server over stdio, or streamable HTTP on 127.0.0.1 when ``http_port`` is given."""
    import anyio

    if blind_exclude:
        history.set_blind(blind_exclude)
    server, paths = build_server(no_tools=no_tools)
    print(f"lunarnav mcp: run directory {paths.root}", file=sys.stderr, flush=True)
    if http_port is not None:
        import uvicorn

        uvicorn.run(server.streamable_http_app(), host="127.0.0.1", port=http_port, log_level="warning")
        return

    async def main() -> None:
        from mcp.server.stdio import stdio_server

        async with stdio_server() as (read, write):
            await server.run(read, write, server.create_initialization_options())

    anyio.run(main)
