"""Claude Agent SDK harness for the Moonwalker analysis agent.

Entry points: `AgentSession` (run, follow up, interrupt, resume), `ToolRegistry` and `agent_tool`
(plug engine tools in), the event models in `lunarnav.agent.events`, and the CLI
(``python -m lunarnav.agent``).
"""

from .config import AgentConfig
from .events import Event, parse_event
from .registry import AgentTool, ToolContext, ToolError, ToolOutput, ToolRegistry, agent_tool
from .saved_scenarios import ScenarioSource
from .session import AgentSession

__all__ = [
    "AgentConfig",
    "AgentSession",
    "AgentTool",
    "ScenarioSource",
    "Event",
    "ToolContext",
    "ToolError",
    "ToolOutput",
    "ToolRegistry",
    "agent_tool",
    "parse_event",
]
