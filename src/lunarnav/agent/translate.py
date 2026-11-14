"""Translate Claude Agent SDK messages into normalised events. The only module that knows SDK types."""

from __future__ import annotations

import json
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    Message,
    RateLimitEvent,
    ResultMessage,
    StreamEvent,
    SystemMessage,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)

from .bus import EventBus
from .events import (
    ErrorEvent,
    Reasoning,
    ReasoningDelta,
    SessionInit,
    Text,
    TextDelta,
    ToolCall,
    ToolResult,
    TurnEnd,
    Usage,
)
from .registry import SERVER_NAME
from .store import sha256_bytes

ENGINE_PREFIX = f"mcp__{SERVER_NAME}__"


def usage_from_result(msg: ResultMessage, cost_before: float = 0.0) -> Usage:
    """Map the CLI's usage report to `Usage`.

    The CLI reports `total_cost_usd` cumulatively for the process, so the per-turn cost is the
    difference to ``cost_before``. Token counts are already per turn.
    """
    cost = None if msg.total_cost_usd is None else round(max(msg.total_cost_usd - cost_before, 0.0), 6)
    raw = msg.usage or {}
    return Usage(
        input_tokens=int(raw.get("input_tokens") or 0),
        output_tokens=int(raw.get("output_tokens") or 0),
        cache_read_tokens=int(raw.get("cache_read_input_tokens") or 0),
        cache_creation_tokens=int(raw.get("cache_creation_input_tokens") or 0),
        cost_usd=cost,
        duration_ms=msg.duration_ms,
        api_duration_ms=msg.duration_api_ms,
        model_usage=dict(msg.model_usage or {}),
    )


def result_text(content: str | list[dict[str, Any]] | None) -> str:
    """Flatten a tool-result payload to text."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    parts: list[str] = []
    for item in content:
        if item.get("type") == "text":
            parts.append(str(item.get("text", "")))
        else:
            parts.append(f"[{item.get('type', 'content')} block]")
    return "\n".join(parts)


class Translator:
    """Stateful converter for one session; publishes events on a bus."""

    def __init__(self, bus: EventBus, text_limit: int) -> None:
        self._bus = bus
        self._text_limit = text_limit
        self._tool_names: dict[str, str] = {}
        self._stream_message: str | None = None
        self._block_counts: dict[str, int] = {}
        self.session_id: str | None = None
        self.last_turn_end: TurnEnd | None = None
        self.cost_total = 0.0
        self.hold_result = False
        """When True a result message is kept in ``held`` instead of ending the turn; `release` emits it."""
        self.held: dict[str, Any] | None = None

    def handle(self, msg: Message) -> ResultMessage | None:
        """Publish the events for one SDK message. Returns the message if it ends the turn."""
        if isinstance(msg, StreamEvent):
            self._stream(msg)
        elif isinstance(msg, AssistantMessage):
            self._assistant(msg)
        elif isinstance(msg, UserMessage):
            self._user(msg)
        elif isinstance(msg, SystemMessage):
            self._system(msg)
        elif isinstance(msg, RateLimitEvent):
            info = msg.rate_limit_info
            if info.status == "rejected":
                self._bus.emit(
                    ErrorEvent, message=f"rate limit rejected ({info.rate_limit_type})", kind="rate_limit"
                )
        elif isinstance(msg, ResultMessage):
            self._result(msg)
            return msg
        return None

    def _stream(self, msg: StreamEvent) -> None:
        if msg.parent_tool_use_id:
            return
        event = msg.event
        kind = event.get("type")
        if kind == "message_start":
            self._stream_message = (event.get("message") or {}).get("id")
        elif kind == "content_block_delta":
            delta = event.get("delta") or {}
            index = int(event.get("index", 0))
            if delta.get("type") == "text_delta":
                self._bus.emit(
                    TextDelta, message_id=self._stream_message, index=index, text=delta.get("text", "")
                )
            elif delta.get("type") == "thinking_delta":
                self._bus.emit(
                    ReasoningDelta,
                    message_id=self._stream_message,
                    index=index,
                    text=delta.get("thinking", ""),
                )

    def _assistant(self, msg: AssistantMessage) -> None:
        if msg.parent_tool_use_id:
            return
        message_id = msg.message_id or msg.uuid
        if msg.error:
            self._bus.emit(ErrorEvent, message=f"assistant message error: {msg.error}", kind="assistant")
        for block in msg.content:
            index = self._block_counts.get(message_id or "", 0)
            if isinstance(block, TextBlock):
                self._bus.emit(Text, message_id=message_id, index=index, text=block.text)
            elif isinstance(block, ThinkingBlock):
                if block.thinking:
                    self._bus.emit(Reasoning, message_id=message_id, index=index, text=block.thinking)
            elif isinstance(block, ToolUseBlock):
                self._tool_names[block.id] = block.name
                kind = "engine" if block.name.startswith(ENGINE_PREFIX) else "builtin"
                self._bus.emit(ToolCall, tool_use_id=block.id, name=block.name, input=block.input, kind=kind)
            self._block_counts[message_id or ""] = index + 1

    def _user(self, msg: UserMessage) -> None:
        if msg.parent_tool_use_id or not isinstance(msg.content, list):
            return
        for block in msg.content:
            if not isinstance(block, ToolResultBlock):
                continue
            text = result_text(block.content)
            name = self._tool_names.get(block.tool_use_id)
            self._bus.emit(
                ToolResult,
                tool_use_id=block.tool_use_id,
                name=name,
                is_error=bool(block.is_error),
                content=text[: self._text_limit],
                truncated=len(text) > self._text_limit,
                content_sha256=sha256_bytes(text.encode()),
                ledger_id=_ledger_id(name, text),
            )

    def _system(self, msg: SystemMessage) -> None:
        if msg.subtype != "init":
            return
        data = msg.data
        self.session_id = data.get("session_id")
        self._bus.emit(
            SessionInit,
            session_id=str(data.get("session_id", "")),
            resolved_model=data.get("model"),
            tools=list(data.get("tools") or []),
            mcp_servers=list(data.get("mcp_servers") or []),
            permission_mode=data.get("permissionMode"),
            cli_version=data.get("claude_code_version"),
        )

    def _result(self, msg: ResultMessage) -> None:
        self.session_id = msg.session_id or self.session_id
        interrupted = bool(msg.terminal_reason and msg.terminal_reason.startswith("aborted"))
        status = "interrupted" if interrupted else ("error" if msg.is_error else "completed")
        if msg.is_error and not interrupted:
            detail = "; ".join(msg.errors or []) or (msg.result or msg.subtype)
            self._bus.emit(ErrorEvent, message=f"turn failed ({msg.subtype}): {detail}", kind=msg.subtype)
        fields: dict[str, Any] = {
            "status": status,
            "stop_reason": msg.terminal_reason or msg.stop_reason,
            "final_text": msg.result,
            "num_model_turns": msg.num_turns,
            "usage": usage_from_result(msg, self.cost_total),
            "permission_denials": len(msg.permission_denials or []),
        }
        self.cost_total = msg.total_cost_usd if msg.total_cost_usd is not None else self.cost_total
        if self.hold_result:
            self.held = fields
        else:
            self.last_turn_end = self._bus.emit(TurnEnd, **fields)

    def release(self, **changes: Any) -> TurnEnd:
        """Emit the held result as the turn's `TurnEnd`, with ``changes`` applied to its fields."""
        assert self.held is not None
        fields, self.held = {**self.held, **changes}, None
        self.last_turn_end = self._bus.emit(TurnEnd, **fields)
        return self.last_turn_end


def _ledger_id(name: str | None, text: str) -> str | None:
    """Extract ``provenance.ledger_id`` from an engine tool's JSON result, if present."""
    if not name or not name.startswith(ENGINE_PREFIX):
        return None
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return None
    provenance = payload.get("provenance") if isinstance(payload, dict) else None
    return provenance.get("ledger_id") if isinstance(provenance, dict) else None
