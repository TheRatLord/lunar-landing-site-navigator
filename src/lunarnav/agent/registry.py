"""Tool registry: typed Python functions exposed to the agent as an in-process MCP server.

Register a tool with `agent_tool`: give it a pydantic input model and an async handler that returns a
pydantic `ToolOutput`. The registry wraps every call so that, with no effort from the tool author:

* the input is validated by the pydantic model (the SDK also validates the JSON Schema first);
* the call is timed and appended to the run's provenance ledger (inputs, SHA-256 of the output,
  duration, and the ``data_versions`` the tool reports such as kernel or terrain hashes);
* the model receives the output JSON plus a ``provenance`` block holding the ledger id, so reports can
  cite the exact call that produced a number.

Engine tools (ephemeris, horizons, windows, search) are added the same way.
"""

from __future__ import annotations

import contextvars
import json
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, ClassVar, TypeVar

from claude_agent_sdk import SdkMcpTool, create_sdk_mcp_server, tool
from pydantic import BaseModel, Field, ValidationError

from . import fsafe
from .bus import Emitter
from .config import AgentConfig
from .events import ToolInfo, utc_now
from .store import JsonlLedger, RunPaths, canonical_json, sha256_bytes

if TYPE_CHECKING:
    from .saved_scenarios import ScenarioSource

SERVER_NAME = "lunarnav"
"""MCP server name; tools are visible to the model as ``mcp__lunarnav__<tool>``."""

LEDGER_INLINE_LIMIT = 8_000
"""Outputs up to this many characters are stored whole in the ledger; larger ones keep only the digest."""


class ToolError(Exception):
    """Raise from a handler for an expected failure; the message is returned to the model."""


class EngineRefusal(ToolError):
    """The engine raised on this call (a value error, a missing key, an arithmetic error); the model gets the tool, the
    error and its arguments, because the engine message alone ("x must contain at least 2 elements") names no input."""


class ToolOutput(BaseModel):
    """Base class of tool results.

    ``data_versions`` maps a data set or kernel name to its pinned version or SHA-256. Anything a tool
    computes from external data must report it here so the ledger records exactly what was used.
    """

    data_versions: dict[str, str] = Field(default_factory=dict)
    ROW_LISTS: ClassVar[dict[str, str]] = {}
    """Row lists of this output for the final-answer guard: dotted path of a list (keys only, ``*`` for any one key;
    ``sites``, ``sites.slips``, ``intervals.*.rows``) to the field that names its rows. A list of two or more such
    rows is cited to a row (``[L0006#key]``). An empty key declares a list that is not a table of rows (the
    quantities of one record) and stays part of its parent. Every list of objects in an output must be listed."""
    OUTPUT_KIND: ClassVar[str] = "engine_result"
    """Kind of source the output is (``trace.KINDS``): ``document`` for text the user supplied."""

    ledger_extra: dict[str, Any] = Field(default_factory=dict, exclude=True)
    """Fields merged into this call's ledger entry but not shown to the model: ``depends_on``
    (assumption ids), ``provenance`` (the engine's trimmed provenance block), ``invalid`` ..."""


@dataclass(frozen=True, slots=True)
class ToolContext:
    """What a tool handler may touch."""

    paths: RunPaths
    config: AgentConfig
    ledger: JsonlLedger
    emit: Emitter
    scenarios: ScenarioSource | None = None
    """The planner's saved scenarios (read-only), when the service supplied them; see `saved_scenarios`."""


CURRENT_CALL: contextvars.ContextVar[tuple[str, BaseModel] | None] = contextvars.ContextVar("agent_tool_call", default=None)
"""The tool name and validated arguments of the call being handled: an engine call reads its override arguments from it
(`typed_inputs.mark_overrides`) so that no tool can pass one on unmarked."""

InT = TypeVar("InT", bound=BaseModel)
Handler = Callable[[ToolContext, InT], Awaitable[ToolOutput]]


@dataclass(frozen=True, slots=True)
class AgentTool[InT: BaseModel]:
    """A registered tool: name, description, input model, handler and an explicit ``read_only`` classification.

    ``read_only`` is true only if a call changes nothing observable (no file, ledger or network side
    effect). It has no default on purpose: a tool without a classification fails at definition.
    """

    name: str
    description: str
    input_model: type[InT]
    handler: Handler[InT]
    read_only: bool

    @property
    def mcp_name(self) -> str:
        """Name as the model sees it."""
        return f"mcp__{SERVER_NAME}__{self.name}"

    def info(self) -> ToolInfo:
        """Description shown in the run-start event."""
        return ToolInfo(
            name=self.mcp_name,
            kind="engine",
            description=self.description,
            input_schema=self.input_model.model_json_schema(),
            read_only=self.read_only,
        )


def agent_tool[InT: BaseModel](
    name: str, description: str, input_model: type[InT], *, read_only: bool
) -> Callable[[Handler[InT]], AgentTool[InT]]:
    """Decorator turning an async ``handler(ctx, args)`` into an `AgentTool`."""

    def decorate(handler: Handler[InT]) -> AgentTool[InT]:
        return AgentTool(name, description, input_model, handler, read_only)

    return decorate


class ToolRegistry:
    """Ordered collection of `AgentTool`s."""

    def __init__(self, tools: list[AgentTool[Any]]) -> None:
        self._tools: dict[str, AgentTool[Any]] = {}
        for item in tools:
            if item.name in self._tools:
                raise ValueError(f"tool {item.name!r} is already registered")
            self._tools[item.name] = item

    def __iter__(self):
        return iter(self._tools.values())

    def mcp_names(self) -> list[str]:
        """Tool names as the model sees them."""
        return [item.mcp_name for item in self]

    def infos(self) -> list[ToolInfo]:
        """Tool descriptions for the run-start event."""
        return [item.info() for item in self]

    def mcp_server(self, ctx: ToolContext) -> Any:
        """Build the in-process MCP server config bound to ``ctx``."""
        return create_sdk_mcp_server(SERVER_NAME, tools=[_wrap(item, ctx) for item in self])


LEDGER_ID_PLACEHOLDER = "<this-result-ledger-id>"
"""A tool writes this where its own result's ledger id belongs. The id is known only when the call ends (another call may
append while the engine runs), so `invoke` fills it in with the id the ledger entry really gets, before the output is hashed,
stored or returned."""


def next_ledger_id(ctx: ToolContext) -> str:
    """Ledger id the next append to this run's ledger receives (valid only until the next await)."""
    return f"L{len(ctx.ledger) + 1:04d}"


def _fill_ledger_id(obj: Any, ledger_id: str) -> Any:
    if isinstance(obj, str):
        return obj.replace(LEDGER_ID_PLACEHOLDER, ledger_id)
    if isinstance(obj, dict):
        return {k: _fill_ledger_id(v, ledger_id) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_fill_ledger_id(v, ledger_id) for v in obj]
    return obj


async def invoke(item: AgentTool[Any], ctx: ToolContext, raw: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Run one tool call with validation, timing and ledger logging.

    Returns ``(payload, is_error)``; ``payload`` is what the model receives, as a JSON object.
    """
    started = time.monotonic()
    stamp = utc_now()
    body: dict[str, Any] | None = None
    error: str | None = None
    extra: dict[str, Any] = {}
    try:
        args = item.input_model.model_validate(raw)
        CURRENT_CALL.set((item.name, args))
        output = await item.handler(ctx, args)
        body = json.loads(output.model_dump_json())
        extra = {**({"rows": dict(output.ROW_LISTS)} if output.ROW_LISTS else {}),
                 **({"output_kind": output.OUTPUT_KIND} if output.OUTPUT_KIND != "engine_result" else {}),
                 **output.ledger_extra}
    except ValidationError as exc:
        error = f"invalid input: {exc.errors(include_url=False, include_context=False)}"
    except EngineRefusal as exc:
        error = (f"{item.name} failed: {exc}. The engine refused this call, usually because of a value in its arguments "
                 f"({canonical_json(raw)[:400]}); check each number against its documented range and, for a time step, "
                 "span or count, that it is neither zero nor too large for the span.")
    except ToolError as exc:
        error = str(exc)
    except Exception as exc:  # noqa: BLE001
        error = f"{type(exc).__name__}: {exc}"
    duration_ms = round((time.monotonic() - started) * 1000)

    ledger_id = next_ledger_id(ctx)
    if body is not None:
        body, extra = _fill_ledger_id(body, ledger_id), _fill_ledger_id(extra, ledger_id)
    out_text = canonical_json(body) if body is not None else None
    inline = out_text is not None and len(out_text) <= LEDGER_INLINE_LIMIT
    result_file = None
    if out_text is not None and not inline:
        try:
            result_file = _write_result(ctx, ledger_id, out_text)
        except OSError as exc:
            error = f"the full result could not be stored ({type(exc).__name__}: {exc})"
            body = out_text = None
    entry: dict[str, Any] = {
        **extra,
        "ledger_id": ledger_id,
        "ts": stamp,
        "tool": item.name,
        "status": "ok" if error is None else "error",
        "input": raw,
        "input_sha256": sha256_bytes(canonical_json(raw).encode()),
        "output_sha256": sha256_bytes(out_text.encode()) if out_text is not None else None,
        "output": body if inline else None,
        "result_file": result_file,
        "data_versions": (body or {}).get("data_versions", {}),
        "duration_ms": duration_ms,
        "error": error,
    }
    stored = ctx.ledger.append(entry)
    provenance = {"ledger_id": stored["ledger_id"], "output_sha256": stored["output_sha256"]}
    if error is not None:
        return {"error": error, "provenance": provenance}, True
    assert body is not None
    return {**body, "provenance": provenance}, False


def _write_result(ctx: ToolContext, ledger_id: str, text: str) -> str:
    """Store a large output as ``state/results/<ledger id>-<random>.json`` (exact bytes hashed in ``output_sha256``).

    The random part means a leftover file (a crashed earlier call) can never collide with a new result.
    """
    path = ctx.paths.results / f"{ledger_id}-{uuid.uuid4().hex[:8]}.json"
    fsafe.write_new(path, text.encode("utf-8"), mkdir=True)
    return ctx.paths.rel(path)


def _wrap(item: AgentTool[Any], ctx: ToolContext) -> SdkMcpTool[Any]:
    @tool(item.name, item.description, item.input_model.model_json_schema())
    async def run(args: dict[str, Any]) -> dict[str, Any]:
        payload, is_error = await invoke(item, ctx, args)
        return {
            "content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}],
            "is_error": is_error,
        }

    return run
