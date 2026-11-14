"""Readable terminal rendering of the event stream (live and replay)."""

from __future__ import annotations

import json
import re
from typing import TextIO

from pydantic import BaseModel

from .events import (
    ArtifactProduced,
    AssumptionRecorded,
    AssumptionSignoff,
    ErrorEvent,
    GuardCheck,
    InboxFile,
    PermissionDenied,
    Reasoning,
    ReasoningDelta,
    RunEnd,
    RunStart,
    SessionInit,
    Text,
    TextDelta,
    ToolCall,
    ToolResult,
    TurnEnd,
    Usage,
    UserPrompt,
)
from .guard import attachment_lines

RESET, DIM, BOLD, RED, GREEN, YELLOW, CYAN, MAGENTA = (
    "\x1b[0m", "\x1b[2m", "\x1b[1m", "\x1b[31m", "\x1b[32m", "\x1b[33m", "\x1b[36m", "\x1b[35m",
)  # fmt: skip


def format_usage(usage: Usage) -> str:
    """One-line usage summary."""
    cost = f"${usage.cost_usd:.4f}" if usage.cost_usd is not None else "cost n/a"
    secs = f"{usage.duration_ms / 1000:.1f}s" if usage.duration_ms else "?s"
    return (
        f"{usage.input_tokens} in / {usage.output_tokens} out / "
        f"{usage.cache_read_tokens} cache-read / {usage.cache_creation_tokens} cache-write tokens, {cost}, {secs}"
    )


_UNSAFE = re.compile("[\x00-\x08\x0b-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]")
"""C0 and C1 control characters except newline and tab (ESC, BEL, CR, CSI and the like)."""
_OWN_CODES = re.compile("(" + "|".join(re.escape(c) for c in (RESET, DIM, BOLD, RED, GREEN, YELLOW, CYAN, MAGENTA)) + ")")


def scrub(text: str) -> str:
    """Replace control characters in ``text`` (model, tool and user content) by U+FFFD; newline and tab stay."""
    return _UNSAFE.sub("\ufffd", text)


def _scrub_output(text: str) -> str:
    """`scrub` everything except this module's own colour codes."""
    return "".join(part if _OWN_CODES.fullmatch(part) else scrub(part) for part in _OWN_CODES.split(text))


def _scrub_event(event: BaseModel) -> BaseModel:
    """The event with every top-level string field scrubbed (the transcript on disk is not touched)."""
    update = {name: scrub(value) for name in type(event).model_fields if isinstance(value := getattr(event, name), str)}
    return event.model_copy(update=update)


def _clip(text: str, limit: int) -> str:
    text = text.replace("\n", "\\n")
    return text if len(text) <= limit else text[: limit - 1] + "…"


class Renderer:
    """Prints events one by one. Streamed deltas are shown live and not repeated by the final block."""

    def __init__(
        self, out: TextIO, color: bool = True, show_instructions: bool = False, width: int = 100
    ) -> None:
        self._out = out
        self._color = color
        self._show_instructions = show_instructions
        self._width = width
        self._streamed: set[tuple[str, str | None, int]] = set()
        self._open_stream: tuple[str, str | None, int] | None = None

    def _c(self, code: str, text: str) -> str:
        return f"{code}{text}{RESET}" if self._color else text

    def _line(self, text: str = "") -> None:
        self._close_stream()
        self._out.write(_scrub_output(text) + "\n")
        self._out.flush()

    def _close_stream(self) -> None:
        if self._open_stream is not None:
            self._out.write("\n")
            self._open_stream = None

    def _delta(self, kind: str, message_id: str | None, index: int, text: str, style: str) -> None:
        key = (kind, message_id, index)
        if self._open_stream != key:
            self._close_stream()
            self._out.write(self._c(style, "  ~ " if kind == "reasoning" else ""))
            self._open_stream = key
        self._streamed.add(key)
        self._out.write(_scrub_output(self._c(style, text) if style else text))
        self._out.flush()

    def feed(self, event: BaseModel) -> None:
        """Render one event (control characters in its text fields are replaced first)."""
        event = _scrub_event(event)
        if isinstance(event, TextDelta):
            self._delta("text", event.message_id, event.index, event.text, "")
        elif isinstance(event, ReasoningDelta):
            self._delta("reasoning", event.message_id, event.index, event.text, DIM)
        elif isinstance(event, Text):
            if ("text", event.message_id, event.index) not in self._streamed:
                self._line(event.text)
            else:
                self._close_stream()
        elif isinstance(event, Reasoning):
            if ("reasoning", event.message_id, event.index) not in self._streamed:
                self._line(self._c(DIM, "  ~ " + event.text.strip()))
            else:
                self._close_stream()
        elif isinstance(event, RunStart):
            self._run_start(event)
        elif isinstance(event, SessionInit):
            self._line(
                self._c(
                    DIM, f"session {event.session_id}  model {event.resolved_model}  tools {len(event.tools)}"
                )
            )
        elif isinstance(event, UserPrompt):
            self._line()
            self._line(self._c(BOLD + CYAN, f"▶ turn {event.turn}: ") + event.text)
        elif isinstance(event, ToolCall):
            args = _clip(json.dumps(event.input, ensure_ascii=False), 300)
            self._line(self._c(YELLOW, f"⚙ {event.name}") + " " + args)
        elif isinstance(event, ToolResult):
            tag = self._c(RED, "✗ error") if event.is_error else self._c(GREEN, "✓ ok")
            ledger = f" [{event.ledger_id}]" if event.ledger_id else ""
            self._line(f"  {tag}{ledger} {_clip(event.content, 400)}")
        elif isinstance(event, PermissionDenied):
            self._line(self._c(RED + BOLD, f"⛔ DENIED {event.name} ({event.rule}): ") + event.reason)
        elif isinstance(event, AssumptionRecorded):
            flag = " [needs sign-off]" if event.needs_signoff else ""
            self._line(self._c(MAGENTA, f"◆ assumption {event.assumption_id}{flag}: ") + event.statement)
            self._line(self._c(DIM, f"    basis: {event.basis}  |  impact: {event.impact}"))
        elif isinstance(event, AssumptionSignoff):
            self._line(
                self._c(MAGENTA, f"◆ {event.assumption_id} {event.decision} by {event.who}: ") + event.note
            )
        elif isinstance(event, InboxFile):
            self._line(self._c(GREEN, f"▤ inbox {event.path} ({event.size_bytes} B, sha256 {event.sha256[:16]}…)"))
        elif isinstance(event, GuardCheck):
            colour = GREEN if event.status == "passed" else RED
            self._line(self._c(colour, f"⚑ answer check {event.status} (attempt {event.attempt})"))
            for issue in event.issues[:6]:
                self._line(self._c(DIM, f"    {issue.get('kind')}: {issue.get('text')} - {issue.get('detail')}"))
        elif isinstance(event, ArtifactProduced):
            self._line(
                self._c(GREEN, f"■ artifact {event.artifact_id} v{event.version} ")
                + f"{event.path} ({event.kind}, {event.size_bytes} B, sha256 {event.sha256[:16]}…)  {event.description}"
            )
        elif isinstance(event, ErrorEvent):
            self._line(self._c(RED + BOLD, f"! error ({event.kind}): ") + event.message)
        elif isinstance(event, TurnEnd):
            if event.status == "completed" and event.outstanding_issues:
                self._line(self._c(RED + BOLD, "! ANSWER NOT VERIFIED: the check found "
                                   f"{len(event.outstanding_issues)} issue(s) in it:"))
                for issue in event.outstanding_issues:
                    self._line(self._c(RED, f"  {issue.get('kind')}: {issue.get('text')} - {issue.get('detail')}"))
                self._line(self._c(RED + BOLD, "  The answer as written, unverified:"))
                for line in (event.final_text or "").splitlines():
                    self._line("  " + line)
            for text in attachment_lines(event.citations, event.limits, event.assumptions, event.digest):
                self._line(self._c(DIM, text) if text.startswith("-") else self._c(BOLD, text))
            self._line(self._c(DIM, f"— turn {event.turn} {event.status}: {format_usage(event.usage)}"))
        elif isinstance(event, RunEnd):
            self._line(
                self._c(
                    BOLD,
                    f"■ run {event.run_id} {event.status}: {event.turns} turn(s); {format_usage(event.usage)}",
                )
            )

    def _run_start(self, event: RunStart) -> None:
        self._line(
            self._c(BOLD, f"run {event.run_id}")
            + f"  model {event.model}  prompt {event.prompt_version} ({event.prompt_sha256[:12]})"
        )
        self._line(f"workspace  {event.workspace}")
        sandbox = event.sandbox
        state = "ON" if sandbox.get("enabled") else "OFF"
        self._line(f"sandbox    {state}: {sandbox.get('detail')}")
        self._line("tools      " + ", ".join(t.name for t in event.tools))
        if event.resumed_from:
            self._line(f"resumed    model session {event.resumed_from}")
        if self._show_instructions:
            self._line(self._c(DIM, "─── system prompt " + "─" * 40))
            for raw in event.instructions.splitlines():
                self._line(self._c(DIM, raw))
            self._line(self._c(DIM, "─" * 58))
