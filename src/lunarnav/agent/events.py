"""Normalised, typed event stream of an agent run.

Every client (terminal renderer, web interface, tests) consumes these events and nothing else; the
SDK's message types never leak past `lunarnav.agent.translate`. Each event is one JSON object with a
``type`` discriminator, the run id, a per-run sequence number ``seq`` (strictly increasing, continued
across turns and resumes), a UTC timestamp and the turn index.

Delta events (`TextDelta`, `ReasoningDelta`) are live-only: they are streamed but not written to the
transcript, which keeps the complete `Text` and `Reasoning` blocks that supersede them.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter


def utc_now() -> str:
    """Current UTC time as ISO-8601 with ``Z`` suffix and millisecond resolution."""
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class _Base(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str
    seq: int = -1
    ts: str = Field(default_factory=utc_now)
    turn: int = 0


class ToolInfo(BaseModel):
    """A tool as the model sees it."""

    model_config = ConfigDict(extra="forbid")

    name: str
    kind: Literal["builtin", "engine"]
    description: str
    input_schema: dict[str, Any] | None = None
    read_only: bool


class Usage(BaseModel):
    """Token usage and cost of one turn or a whole run, as reported by the CLI.

    ``cost_usd`` is known only when the CLI sends the turn's result message, so it first appears on the `TurnEnd` (and in
    ``run.json`` after that turn): there is no cost estimate while a turn runs, and none is invented. None means the CLI
    reported no cost."""

    model_config = ConfigDict(extra="forbid")

    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_creation_tokens: int = 0
    cost_usd: float | None = None
    duration_ms: int | None = None
    api_duration_ms: int | None = None
    model_usage: dict[str, Any] = Field(default_factory=dict)


class RunStart(_Base):
    """First event of a run: everything the model was told, plus how the harness is configured."""

    type: Literal["run_start"] = "run_start"
    model: str
    instructions: str
    prompt_version: str
    prompt_sha256: str
    prompt_template_sha256: str
    tools: list[ToolInfo]
    workspace: str
    permission_policy: dict[str, Any]
    sandbox: dict[str, Any]
    versions: dict[str, str] = Field(default_factory=dict)
    resumed_from: str | None = None


class SessionInit(_Base):
    """The CLI's own report of the session it started (model resolved, tools actually loaded)."""

    type: Literal["session_init"] = "session_init"
    session_id: str
    resolved_model: str | None = None
    tools: list[str]
    mcp_servers: list[dict[str, Any]] = Field(default_factory=list)
    permission_mode: str | None = None
    cli_version: str | None = None


class UserPrompt(_Base):
    """A message from the user starting a turn."""

    type: Literal["user_prompt"] = "user_prompt"
    text: str


class TextDelta(_Base):
    """Streamed fragment of assistant text. Live-only."""

    type: Literal["text_delta"] = "text_delta"
    message_id: str | None = None
    index: int = 0
    text: str


class Text(_Base):
    """A complete assistant text block."""

    type: Literal["text"] = "text"
    message_id: str | None = None
    index: int = 0
    text: str


class ReasoningDelta(_Base):
    """Streamed fragment of the model's reasoning summary. Live-only."""

    type: Literal["reasoning_delta"] = "reasoning_delta"
    message_id: str | None = None
    index: int = 0
    text: str


class Reasoning(_Base):
    """A complete reasoning block (the summary the API returns, not the raw chain of thought)."""

    type: Literal["reasoning"] = "reasoning"
    message_id: str | None = None
    index: int = 0
    text: str


class ToolCall(_Base):
    """The model requested a tool."""

    type: Literal["tool_call"] = "tool_call"
    tool_use_id: str
    name: str
    input: dict[str, Any]
    kind: Literal["builtin", "engine"]


class ToolResult(_Base):
    """A tool's result, as returned to the model. ``content`` is truncated for the event only."""

    type: Literal["tool_result"] = "tool_result"
    tool_use_id: str
    name: str | None = None
    is_error: bool = False
    content: str
    truncated: bool = False
    content_sha256: str
    ledger_id: str | None = None


class PermissionDenied(_Base):
    """The permission policy refused a tool call."""

    type: Literal["permission_denied"] = "permission_denied"
    name: str
    input: dict[str, Any]
    reason: str
    rule: str
    tool_use_id: str | None = None


class AssumptionRecorded(_Base):
    """An assumption was added to the assumptions ledger."""

    type: Literal["assumption_recorded"] = "assumption_recorded"
    assumption_id: str
    statement: str
    basis: str
    impact: str
    needs_signoff: bool


class ArtifactProduced(_Base):
    """A file was declared as a deliverable."""

    type: Literal["artifact_produced"] = "artifact_produced"
    artifact_id: str
    version: int
    path: str
    kind: str
    description: str
    size_bytes: int
    sha256: str


class AssumptionSignoff(_Base):
    """A planner accepted or rejected a recorded assumption."""

    type: Literal["assumption_signoff"] = "assumption_signoff"
    assumption_id: str
    decision: Literal["accepted", "rejected"]
    who: str
    note: str


class GuardCheck(_Base):
    """Result of the final-answer check, once per answer; `flagged` means issues remain (the answer is released and
    annotated, never sent back to the model), `error` means the check itself could not run (the turn ends as an error)."""

    type: Literal["guard_check"] = "guard_check"
    status: Literal["passed", "flagged", "error"]
    attempt: int
    issues: list[dict[str, Any]] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    """Things the check could not use (skipped lines of the script call log, a missing answer text)."""
    detail: str | None = None
    """For ``error``: why the check could not run. The turn then ends as an error: an answer is never released unchecked."""


class InboxFile(_Base):
    """A user file was placed in the run's inbox (``state/inbox``, outside the model's workspace)."""

    type: Literal["inbox_file"] = "inbox_file"
    name: str
    path: str
    size_bytes: int
    sha256: str


class ErrorEvent(_Base):
    """A failure in the harness or the model connection (tool errors are `ToolResult`)."""

    type: Literal["error"] = "error"
    message: str
    kind: str = "runtime"
    fatal: bool = False


class TurnEnd(_Base):
    """A turn finished; ``usage`` covers that turn."""

    type: Literal["turn_end"] = "turn_end"
    status: Literal["completed", "interrupted", "error"]
    """A ``completed`` turn may carry ``outstanding_issues``: the answer is released as written and is not verified."""
    stop_reason: str | None = None
    final_text: str | None = None
    num_model_turns: int | None = None
    usage: Usage = Field(default_factory=Usage)
    permission_denials: int = 0
    citations: list[dict[str, Any]] = Field(default_factory=list)
    """What the final answer cites, added by the harness: ``id``, ``row`` (or None), ``kinds`` (every kind of
    source behind the numbers cited to it, from the most to the least independent: ``engine_result``, ``input``,
    ``script_value``, ``assumption``, ``document`` or ``user_request``), ``tool`` and ``derived_from`` (ledger ids).
    There is no single ``kind``: one citation can carry numbers of several kinds and an interface shows all of them."""
    limits: list[dict[str, Any]] = Field(default_factory=list)
    """Model limits carried by the engine results of the turn and the cited records, added by the harness (not the
    model's wording): ``id``, ``text`` (verbatim from the limit registry) and ``cited_by`` (ledger ids of the digest
    entries and cited records that carry it)."""
    assumptions: list[dict[str, Any]] = Field(default_factory=list)
    """Assumptions the engine results of the turn and the cited records depend on (or that are cited): ``id``,
    ``statement``, ``status`` (``pending``, ``accepted``, ``rejected``) and ``cited_by``."""
    digest: list[dict[str, Any]] = Field(default_factory=list)
    """Every engine result the turn computed, plus any earlier one the answer cites, whether or not the answer cites it:
    ``id``, ``tool``, ``scenarios`` (``id``, ``name``, ``site``, ...), the engine's ``verdict`` (``state``, ``limiting``),
    ``verdicts`` (per row, up to 12) or ``states`` (counts), ``limits`` (ids), ``assumptions`` (``id``, ``status``) and
    ``cited`` (true or false)."""
    outstanding_issues: list[dict[str, Any]] = Field(default_factory=list)
    """The issues the answer check found in the released text; empty when it passed. Not empty: answer not verified."""


class RunEnd(_Base):
    """The session was closed; ``usage`` is the sum over all turns of this process."""

    type: Literal["run_end"] = "run_end"
    status: Literal["completed", "interrupted", "error"]
    turns: int
    usage: Usage = Field(default_factory=Usage)


Event = Annotated[
    RunStart
    | SessionInit
    | UserPrompt
    | TextDelta
    | Text
    | ReasoningDelta
    | Reasoning
    | ToolCall
    | ToolResult
    | PermissionDenied
    | AssumptionRecorded
    | ArtifactProduced
    | AssumptionSignoff
    | GuardCheck
    | InboxFile
    | ErrorEvent
    | TurnEnd
    | RunEnd,
    Field(discriminator="type"),
]
"""Discriminated union of every event type."""

LIVE_ONLY_TYPES = frozenset({"text_delta", "reasoning_delta"})
"""Event types streamed to clients but not persisted."""

_ADAPTER: TypeAdapter[Event] = TypeAdapter(Event)


def parse_event(data: str | bytes | dict[str, Any]) -> Event:
    """Validate a JSON string or dict into the matching event class."""
    return _ADAPTER.validate_python(data if isinstance(data, dict) else json.loads(data))


def event_json(event: BaseModel) -> str:
    """Compact JSON encoding of an event."""
    return event.model_dump_json()


def event_schema() -> dict[str, Any]:
    """JSON Schema of the event union, for the web client's generated types."""
    return _ADAPTER.json_schema()


def to_sse(event: BaseModel) -> str:
    """Encode one event as a server-sent-events frame (``id`` is the sequence number)."""
    seq = getattr(event, "seq", -1)
    kind = getattr(event, "type", "message")
    return f"id: {seq}\nevent: {kind}\ndata: {event.model_dump_json()}\n\n"
