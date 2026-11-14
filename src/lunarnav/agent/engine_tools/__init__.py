"""Engine tools: the typed, ledgered window of the agent onto the deterministic engine."""

from __future__ import annotations

from typing import Any

from ..registry import AgentTool
from .analysis import analysis_tools
from .export import export_tools
from .geo import geo_tools
from .ingest_tools import ingest_tools
from .scenario_build import catalog_tools


def engine_tools() -> list[AgentTool[Any]]:
    """Every engine tool, in the order the model sees them."""
    return [*catalog_tools(), *analysis_tools(), *geo_tools(), *export_tools(), *ingest_tools()]
