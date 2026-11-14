"""The tool set of an agent session: built-in CLI tools, harness tools, engine tools, saved-scenario tools."""

from __future__ import annotations

from .builtin_tools import builtin_tools
from .engine_tools import engine_tools
from .events import ToolInfo
from .policy import BUILTIN_TOOLS
from .registry import ToolRegistry
from .saved_scenarios import ScenarioSource, saved_scenario_tools

BUILTIN_TOOL_SPECS: dict[str, tuple[str, bool]] = {
    "Read": ("Read a file (workspace, repository src/ and docs/ only).", True),
    "Write": ("Create or overwrite a file (workspace only).", False),
    "Edit": ("Replace text in an existing file (workspace only).", False),
    "Glob": ("Find files by glob pattern (workspace, src/, docs/).", True),
    "Grep": ("Search file contents with a regular expression (workspace, src/, docs/).", True),
    "Bash": (
        (
            "Run any shell command inside the OS sandbox (writes only in the workspace; network open unless the "
            "operator set a domain list). Denied when the sandbox is not active."
        ),
        False,
    ),
    "BashOutput": ("Read output of a background Bash command.", True),
    "KillShell": ("Stop a background Bash command.", False),
    "WebSearch": ("Search the web.", True),
    "WebFetch": ("Fetch and read a web page.", True),
    "Agent": ("Start a subagent for a self-contained piece of work; its tool calls follow the same policy.", False),
    "Task": ("Start a subagent for a self-contained piece of work (same as Agent).", False),
    "TodoWrite": ("Keep a task list for long work.", False),
}
"""Harness-written ``(description, read_only)`` per built-in tool; the CLI supplies the exact tool schemas.
Bash is not read-only: it can write inside the workspace."""


def default_registry(scenarios: ScenarioSource | None) -> ToolRegistry:
    """Every registry tool the model sees, in order; the saved-scenario tools only with a `ScenarioSource`."""
    saved = saved_scenario_tools() if scenarios is not None else []
    return ToolRegistry([*builtin_tools(), *engine_tools(), *saved])


def describe_tools(registry: ToolRegistry) -> list[ToolInfo]:
    """Tools as shown to the model: built-ins first, then registry tools."""
    builtin = [
        ToolInfo(name=n, kind="builtin", description=BUILTIN_TOOL_SPECS[n][0], read_only=BUILTIN_TOOL_SPECS[n][1])
        for n in BUILTIN_TOOLS
    ]
    return builtin + registry.infos()
