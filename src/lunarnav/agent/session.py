"""`AgentSession`: one agent run, driven turn by turn, with isolation, policy, events and ledgers.

A session owns a background task that holds the SDK client (the SDK requires connect and disconnect to
happen in one task), so callers such as a web server may call `turn` and `interrupt` from any task.
Exactly one turn runs at a time.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import platform
import sys
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Self

from claude_agent_sdk import (
    ClaudeAgentOptions,
    ClaudeSDKClient,
    HookMatcher,
    PermissionResultAllow,
    PermissionResultDeny,
    ToolPermissionContext,
)
from claude_agent_sdk import __version__ as SDK_VERSION
from claude_agent_sdk._cli_version import __cli_version__ as CLI_VERSION
from pydantic import BaseModel

from . import fsafe
from .bus import EventBus
from .cli_env import cli_launch
from .config import AgentConfig
from .events import (
    AssumptionSignoff,
    ErrorEvent,
    GuardCheck,
    InboxFile,
    PermissionDenied,
    RunEnd,
    RunStart,
    ToolInfo,
    TurnEnd,
    Usage,
    UserPrompt,
    utc_now,
)
from .guard import Analysis, analyze_answer
from .inbox import list_inbox, save_inbox_file, save_inbox_path
from .policy import BUILTIN_TOOLS, DENIED_BUILTINS, Decision, PermissionPolicy
from .prompt import RenderedPrompt, render_prompt
from .registry import ToolContext, ToolRegistry
from .sandbox import sandbox_settings
from .saved_scenarios import ScenarioSource
from .signoff import assumption_status, record_signoff, write_status_snapshot
from .store import (
    EventLog,
    JsonlLedger,
    RunPaths,
    iter_events,
    new_run_id,
    read_jsonl,
    read_run_meta,
    run_integrity_problems,
    write_json_atomic,
)
from .tools import default_registry, describe_tools
from .trace import build_registry
from .translate import Translator

POLICY_TIMEOUT_S = 30.0
"""A policy decision that takes longer is a refusal (the event loop never waits on it: it runs in a thread)."""
GUARD_TIMEOUT_S = 120.0
"""The final-answer check that takes longer fails the turn closed (the abandoned thread cannot be stopped)."""

@dataclass(slots=True)
class _Command:
    prompt: str


class AgentSession:
    """One agent run. Create with `start` or `resume`; close with `close` (or use ``async with``)."""

    def __init__(
        self,
        config: AgentConfig,
        paths: RunPaths,
        registry: ToolRegistry,
        prompt: RenderedPrompt,
        model: str,
        resume_session_id: str | None,
        created_at: str,
        scenarios: ScenarioSource | None = None,
    ) -> None:
        self.config = config
        self.scenarios = scenarios
        self.paths = paths
        self.registry = registry
        self.prompt = prompt
        self.model = model
        self.bus = EventBus(paths.run_id, EventLog(paths.transcript))
        self.policy = PermissionPolicy(paths.workspace, config, frozenset(registry.mcp_names()))
        self.session_id: str | None = resume_session_id
        self._resume_id = resume_session_id
        self._created_at = created_at
        self._translator = Translator(self.bus, config.event_text_limit)
        self._translator.hold_result = True
        self._commands: asyncio.Queue[_Command | None] = asyncio.Queue()
        self._worker_task: asyncio.Task[None] | None = None
        self._ready = asyncio.Event()
        self._connect_error: BaseException | None = None
        self._quota_message: str | None = None
        self._policy_pool = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="agent-policy")
        self._policy_lock = asyncio.Lock()
        self._policy_stuck: concurrent.futures.Future[Decision] | None = None
        self._client: ClaudeSDKClient | None = None
        self._prefix: list[BaseModel] = []
        self._turns = 0
        self._busy = False
        self._last_status: str = "completed"
        self._turn_ledger_start = 0
        self._totals = Usage()
        self._cost_known = False
        self._guard_seq = 0
        """Number of the last `GuardCheck` of this run (restored on resume): check numbers never restart."""
        self._first_prompt: str | None = None
        self._sandbox_status: dict[str, Any] = {}
        self._engine_ctx: ToolContext | None = None


    @classmethod
    async def start(
        cls,
        config: AgentConfig | None = None,
        registry: ToolRegistry | None = None,
        run_id: str | None = None,
        scenarios: ScenarioSource | None = None,
    ) -> AgentSession:
        """Create a run directory and connect a new session. With `scenarios` the agent can list and load the planner's
        saved scenarios (read-only)."""
        config = config or AgentConfig.load()
        paths = RunPaths.create(config.runs_dir, run_id or new_run_id())
        prompt = render_prompt(config, str(paths.workspace))
        registry = registry if registry is not None else default_registry(scenarios)
        session = cls(config, paths, registry, prompt, config.model, None, utc_now(), scenarios)
        await session._open(resumed=False)
        return session

    @classmethod
    async def resume(
        cls,
        run_id: str,
        config: AgentConfig | None = None,
        registry: ToolRegistry | None = None,
        scenarios: ScenarioSource | None = None,
    ) -> AgentSession:
        """Reopen a past run: same workspace, ledgers, prompt version, model and spend cap (`max_budget_usd` of
        ``run.json`` wins over the config's); the model's context is restored from the CLI's stored session."""
        config = config or AgentConfig.load()
        paths = RunPaths.open(config.runs_dir, run_id)
        problems = run_integrity_problems(paths)
        if problems:
            raise RuntimeError(f"run {run_id} failed ledger verification and is not resumed: " + "; ".join(problems))
        meta = read_run_meta(paths)
        if not meta.get("session_id"):
            raise RuntimeError(f"run {run_id} never started a model session; nothing to resume")
        config = config.with_overrides(prompt_version=meta["prompt_version"], model=meta["model"], max_budget_usd=meta["max_budget_usd"])
        try:
            prompt = render_prompt(config, str(paths.workspace))
        except ValueError as exc:
            raise RuntimeError(f"run {run_id} cannot be resumed: {exc}") from exc
        registry = registry if registry is not None else default_registry(scenarios)
        session = cls(config, paths, registry, prompt, meta["model"], meta["session_id"], meta["created_at"], scenarios)
        session._turns = int(meta["turns"])
        session._first_prompt = meta["first_prompt"]
        for event in iter_events(paths.transcript):
            if isinstance(event, TurnEnd):
                session._totals = _add_usage(session._totals, event.usage)
                session._cost_known = session._cost_known or event.usage.cost_usd is not None
            elif isinstance(event, GuardCheck):
                session._guard_seq = max(session._guard_seq, event.attempt)
        session._translator.cost_total = session._totals.cost_usd or 0.0
        await session._open(resumed=True)
        return session

    async def _open(self, resumed: bool) -> None:
        fsafe.mkdirs(self.paths.cache)
        fsafe.mkdirs(self.paths.state)
        write_status_snapshot(self.paths)
        settings, self._sandbox_status = sandbox_settings(self.config.sandbox, self.config, self.paths)
        self.policy.sandboxed = bool(self._sandbox_status.get("enabled"))
        self._engine_ctx = ToolContext(
            self.paths,
            self.config,
            JsonlLedger(self.paths.ledger),
            self.bus.emit,  # type: ignore[arg-type]
            self.scenarios,
        )
        options = self._options(settings)
        start = self.bus.emit(
            RunStart,
            model=self.model,
            instructions=self.prompt.text,
            prompt_version=self.prompt.version,
            prompt_sha256=self.prompt.sha256,
            prompt_template_sha256=self.prompt.template_sha256,
            tools=self.tool_infos(),
            workspace=str(self.paths.workspace),
            permission_policy=self.policy.describe(),
            sandbox=self._sandbox_status,
            versions={
                "claude_agent_sdk": SDK_VERSION,
                "claude_code_cli": CLI_VERSION,
                "python": platform.python_version(),
            },
            resumed_from=self._resume_id,
        )
        self._prefix.append(start)
        self._write_meta("created")
        self._worker_task = asyncio.create_task(self._worker(options), name=f"agent-{self.paths.run_id}")
        await self._ready.wait()
        if self._connect_error is not None:
            raise self._connect_error

    def tool_infos(self) -> list[ToolInfo]:
        """Tools as shown to the model."""
        return describe_tools(self.registry)

    def _options(self, sandbox: Any) -> ClaudeAgentOptions:
        assert self._engine_ctx is not None
        env, cli_path = cli_launch(self.paths, self.config)
        return ClaudeAgentOptions(
            cli_path=cli_path,
            system_prompt=self.prompt.text,
            model=self.model,
            tools=list(BUILTIN_TOOLS),
            disallowed_tools=list(DENIED_BUILTINS),
            mcp_servers={"lunarnav": self.registry.mcp_server(self._engine_ctx)},
            strict_mcp_config=True,
            setting_sources=[],
            skills=[],
            extra_args={"safe-mode": None},
            permission_mode="default",
            can_use_tool=self._can_use_tool,
            hooks={"PreToolUse": [HookMatcher(matcher=None, hooks=[self._pre_tool_use])],
                   "PostToolUse": [HookMatcher(matcher="Bash", hooks=[self._post_tool_use])]},
            cwd=str(self.paths.workspace),
            env=env,
            include_partial_messages=True,
            thinking={"type": "adaptive", "display": "summarized"},
            effort=self.config.effort,  # type: ignore[arg-type]
            max_turns=self.config.max_turns,
            max_budget_usd=self._budget_left(),
            resume=self._resume_id,
            sandbox=sandbox,
            settings=self.config.cli_settings(),
        )


    async def _decide(self, name: str, tool_input: dict[str, Any]) -> Decision:
        """The policy's decision, computed on this session's own thread within `POLICY_TIMEOUT_S`.

        Every failure to decide is a refusal: a timeout (`policy-timeout`), a check still running from an earlier
        timeout (`policy-busy`, answered at once) and any exception the check raises (`policy-error`).
        """
        busy = Decision(False, "an earlier policy check timed out and is still running (it cannot be "
                               "interrupted); this call is refused until it ends", "policy-busy")
        stuck = self._policy_stuck
        if stuck is not None and not stuck.done():
            return busy
        async with self._policy_lock:
            stuck = self._policy_stuck
            if stuck is not None and not stuck.done():
                return busy
            try:
                future = self._policy_pool.submit(self.policy.decide, name, tool_input)
                try:
                    return await asyncio.wait_for(asyncio.wrap_future(future), POLICY_TIMEOUT_S)
                except TimeoutError:
                    self._policy_stuck = future
                    return Decision(False, f"the policy check did not finish within {POLICY_TIMEOUT_S:.0f} s",
                                    "policy-timeout")
            except Exception as exc:  # noqa: BLE001
                return Decision(False, f"the policy check failed ({type(exc).__name__}: {str(exc)[:200]}); the call "
                                       "is refused", "policy-error")

    async def _refuse(self, name: str, tool_input: dict[str, Any], tool_use_id: str | None) -> str | None:
        """Apply the policy (see `_decide`); on refusal publish the event and return the message for the model."""
        decision = await self._decide(name, tool_input)
        if decision.allowed:
            return None
        self.bus.emit(
            PermissionDenied,
            name=name,
            input=tool_input,
            reason=decision.reason,
            rule=decision.rule,
            tool_use_id=tool_use_id,
        )
        return f"Permission denied by policy ({decision.rule}): {decision.reason}"

    async def _workspace_over_quota(self) -> str | None:
        """A message when the workspace tree exceeds `AgentConfig.max_workspace_bytes`, else None."""
        try:
            used = await asyncio.to_thread(fsafe.tree_bytes, self.paths.workspace)
        except fsafe.TreeTooLarge:
            return (f"workspace quota exceeded: more than {fsafe.MAX_TREE_ENTRIES} files and directories are stored; "
                    "delete files in the workspace to continue")
        limit = self.config.max_workspace_bytes
        if used <= limit:
            return None
        return (f"workspace quota exceeded: {used} bytes stored, the limit is {limit} bytes "
                f"(a single file may be at most {self.config.script_file_limit_bytes} bytes); delete files in the "
                "workspace to continue")

    async def _quota_refusal(self, name: str, tool_input: dict[str, Any], tool_use_id: str | None) -> str | None:
        """Refuse a Bash call while the workspace is over its quota (the check before a script run)."""
        if name != "Bash":
            return None
        message = await self._workspace_over_quota()
        if message is None:
            return None
        self.bus.emit(PermissionDenied, name=name, input=tool_input, reason=message, rule="workspace-quota",
                      tool_use_id=tool_use_id)
        return f"Permission denied by policy (workspace-quota): {message}"

    async def _post_tool_use(self, data: Any, tool_use_id: str | None, _context: Any) -> dict[str, Any]:
        """After a Bash call (the check after a script run): over the quota ends the turn with a `quota` error."""
        message = await self._workspace_over_quota()
        if message is None:
            return {}
        self._quota_message = message
        self.bus.emit(ErrorEvent, message=message, kind="quota", fatal=True)
        return {"continue_": False, "stopReason": message}

    async def _denial(self, name: str, tool_input: dict[str, Any], tool_use_id: str | None) -> str | None:
        """The message refusing a tool call (policy, then workspace quota), None when it may run. An exception in
        either check refuses the call and is recorded as a ``policy-error`` event."""
        message = await self._refuse(name, tool_input, tool_use_id)
        if message is not None:
            return message
        try:
            return await self._quota_refusal(name, tool_input, tool_use_id)
        except Exception as exc:  # noqa: BLE001
            reason = f"the workspace quota check failed ({type(exc).__name__}: {str(exc)[:200]}); the call is refused"
            self.bus.emit(PermissionDenied, name=name, input=tool_input, reason=reason, rule="policy-error",
                          tool_use_id=tool_use_id)
            return f"Permission denied by policy (policy-error): {reason}"

    async def _can_use_tool(
        self, name: str, tool_input: dict[str, Any], context: ToolPermissionContext
    ) -> PermissionResultAllow | PermissionResultDeny:
        message = await self._denial(name, tool_input, context.tool_use_id)
        return PermissionResultAllow() if message is None else PermissionResultDeny(message=message)

    async def _pre_tool_use(self, data: Any, tool_use_id: str | None, _context: Any) -> dict[str, Any]:
        name, tool_input = str(data.get("tool_name", "")), dict(data.get("tool_input") or {})
        message = await self._denial(name, tool_input, tool_use_id)
        if message is None:
            return {}
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": message,
            }
        }


    async def _worker(self, options: ClaudeAgentOptions) -> None:
        try:
            client = ClaudeSDKClient(options)
            await client.connect()
        except BaseException as exc:  # noqa: BLE001
            self._connect_error = exc
            self._ready.set()
            return
        self._client = client
        self._ready.set()
        try:
            while (command := await self._commands.get()) is not None:
                await self._run_turn(client, command.prompt)
        finally:
            await client.disconnect()
            self._client = None

    async def _run_turn(self, client: ClaudeSDKClient, prompt: str) -> None:
        self._turns += 1
        self.bus.turn = self._turns
        self._first_prompt = self._first_prompt or prompt[:200]
        self.bus.emit(UserPrompt, text=prompt)
        self._quota_message = None
        self._turn_ledger_start = len(read_jsonl(self.paths.ledger))
        try:
            await self._exchange(client, prompt)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            self.bus.emit(ErrorEvent, message=f"{type(exc).__name__}: {exc}", kind="sdk", fatal=True)
        else:
            if self._quota_message is not None:
                self._quota_stop(self._quota_message)
            else:
                try:
                    await self._check_answer()
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    self._guard_failed(exc)
        if self._translator.held is not None:
            self._translator.release()
        else:
            self.bus.emit(TurnEnd, status="error", stop_reason=self._quota_message or "no result message")
            self._last_status = "error"
        self._after_turn()

    async def _exchange(self, client: ClaudeSDKClient, prompt: str) -> None:
        """Send one message and consume its response; the result stays in ``translator.held``."""
        self._translator.held = None
        await client.query(prompt)
        async for message in client.receive_response():
            self._translator.handle(message)

    def _quota_stop(self, message: str) -> None:
        """The workspace quota ended the turn: it is an error turn and its text is not released."""
        held = self._translator.held
        if held is not None:
            held["status"] = "error"
            held["stop_reason"] = message
            held["final_text"] = None

    def _guard_failed(self, exc: BaseException) -> None:
        """The final-answer check could not run: say why and end the turn as an error (fail closed)."""
        detail = f"{type(exc).__name__}: {exc}"
        self._emit_guard(status="error", issues=[], detail=detail)
        self.bus.emit(ErrorEvent, message=f"the final-answer check could not run: {detail}", kind="guard", fatal=True)
        held = self._translator.held
        if held is not None:
            held["status"] = "error"
            held["stop_reason"] = "the final-answer check could not run; the answer was not released"
            held["final_text"] = None

    def _emit_guard(self, **fields: Any) -> None:
        """Emit a `GuardCheck` numbered by the run's own counter: every check has its own number, in order, across
        turns and resumes."""
        self._guard_seq += 1
        self.bus.emit(GuardCheck, attempt=self._guard_seq, **fields)

    def _budget_left(self) -> float | None:
        """The SDK's cap for this connection: the run's cap less what earlier connections of the run spent (the CLI counts
        from zero on every resume). A spent cap leaves one cent, which ends the next turn after its first model call."""
        cap = self.config.max_budget_usd
        if cap is None:
            return None
        return max(cap - (self._totals.cost_usd or 0.0), 0.01)

    async def _check_answer(self) -> None:
        """Check the final answer once and annotate it: citations, limits, assumptions and digest are attached; issues
        the check finds are attached as ``outstanding_issues`` (the turn still ends ``completed``). Nothing is sent back
        to the model."""
        held = self._translator.held
        if held is None or held["status"] != "completed":
            return
        if not held.get("final_text"):
            self._emit_guard(status="passed", issues=[], notes=["no final answer text"])
            return
        analysis, notes = await asyncio.wait_for(
            asyncio.to_thread(self._answer_issues, held["final_text"]), GUARD_TIMEOUT_S)
        issues = [i.to_dict() for i in analysis.issues]
        held["citations"], held["limits"], held["assumptions"], held["digest"] = (
            analysis.citations, analysis.limits, analysis.assumptions, analysis.digest)
        held["outstanding_issues"] = issues
        self._emit_guard(status="flagged" if issues else "passed", issues=issues, notes=notes)

    def _answer_issues(self, text: str) -> tuple[Analysis, list[str]]:
        """The check of the answer (issues, citations, limits, assumptions) and notes about inputs it skipped;
        raises when the check cannot run (an unverifiable ledger included), which fails the turn closed."""
        problems = run_integrity_problems(self.paths)
        if problems:
            raise RuntimeError("run ledgers failed verification: " + "; ".join(problems))
        registry = build_registry(self.paths)
        turn_ids = [e["ledger_id"] for e in read_jsonl(self.paths.ledger)[self._turn_ledger_start:]
                    if e.get("status") == "ok" and e.get("ledger_id")]
        return analyze_answer(text, registry, turn_ids), list(registry.log_problems)

    def _after_turn(self) -> None:
        self.session_id = self._translator.session_id or self.session_id
        last = self._translator.last_turn_end
        if last is not None:
            self._last_status = last.status
            self._totals = _add_usage(self._totals, last.usage)
            self._cost_known = self._cost_known or last.usage.cost_usd is not None
            self._translator.last_turn_end = None
        self._write_meta("idle")


    async def turn(self, prompt: str) -> AsyncIterator[BaseModel]:
        """Send a user message and yield the events of the turn, ending with its `TurnEnd`.

        The first turn of a session also yields the `RunStart` event. Stopping iteration early interrupts
        the turn.
        """
        if self._worker_task is None or self._worker_task.done():
            raise RuntimeError("session is closed")
        if self._busy:
            raise RuntimeError("a turn is already running")
        self._busy = True
        queue = self.bus.subscribe()
        for event in self._prefix:
            yield event
        self._prefix.clear()
        await self._commands.put(_Command(prompt))
        finished = False
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield event
                if isinstance(event, TurnEnd):
                    finished = True
                    break
        finally:
            if not finished:
                await self.interrupt()
                while (event := await queue.get()) is not None and not isinstance(event, TurnEnd):
                    pass
            self.bus.unsubscribe(queue)
            self._busy = False

    def signoff(self, assumption_id: str, decision: str, who: str, note: str) -> dict[str, Any]:
        """Record a planner's acceptance or rejection of an assumption and publish the event.

        Raises `SignoffError` for unknown assumptions, empty ``who``/``note`` or a bad decision.
        """
        entry = record_signoff(self.paths, assumption_id, decision, who, note, write_event=False)
        self.bus.emit(AssumptionSignoff, assumption_id=assumption_id, decision=decision, who=who, note=note)
        return entry

    def assumptions(self) -> list[dict[str, Any]]:
        """Assumptions with status (pending / accepted / rejected / not_required) and what used them."""
        return assumption_status(self.paths)

    def add_inbox_file(self, filename: str, data: bytes) -> dict[str, Any]:
        """Place an uploaded file in the run inbox (see `lunarnav.agent.inbox`) and publish the event."""
        entry = save_inbox_file(self.paths, filename, data)
        self.bus.emit(InboxFile, **entry)
        return entry

    def add_inbox_path(self, source: Path, filename: str | None = None) -> dict[str, Any]:
        """Copy a local file into the run inbox."""
        entry = save_inbox_path(self.paths, source, filename)
        self.bus.emit(InboxFile, **entry)
        return entry

    def inbox(self) -> list[dict[str, Any]]:
        """Files currently in the inbox."""
        return list_inbox(self.paths)

    async def interrupt(self) -> None:
        """Ask the model to stop the running turn; the turn then ends with status ``interrupted``."""
        if self._client is not None and self._busy:
            await self._client.interrupt()

    async def close(self) -> None:
        """End the session, write the `RunEnd` event and run metadata."""
        if self._worker_task is not None and not self._worker_task.done():
            await self._commands.put(None)
            await self._worker_task
        self._policy_pool.shutdown(wait=False, cancel_futures=True)
        self.bus.emit(RunEnd, status=self._last_status, turns=self._turns, usage=self._totals)  # type: ignore[arg-type]
        self._write_meta("closed")
        self.bus.close_subscribers()

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *_exc: object) -> None:
        await self.close()

    @property
    def run_id(self) -> str:
        return self.paths.run_id


    def _write_meta(self, state: str) -> None:
        write_json_atomic(
            self.paths.meta,
            {
                "run_id": self.paths.run_id,
                "created_at": self._created_at,
                "updated_at": utc_now(),
                "state": state,
                "status": self._last_status,
                "session_id": self.session_id,
                "model": self.model,
                "prompt_version": self.prompt.version,
                "prompt_sha256": self.prompt.sha256,
                "prompt_template_sha256": self.prompt.template_sha256,
                "workspace": str(self.paths.workspace),
                "turns": self._turns,
                "first_prompt": self._first_prompt,
                "cost_usd": self._totals.cost_usd if self._cost_known else None,
                "max_budget_usd": self.config.max_budget_usd,
                "python": sys.version.split()[0],
            },
        )


def _add_usage(a: Usage, b: Usage) -> Usage:
    def add(x: float | None, y: float | None) -> float | None:
        return None if x is None and y is None else (x or 0) + (y or 0)

    return Usage(
        input_tokens=a.input_tokens + b.input_tokens,
        output_tokens=a.output_tokens + b.output_tokens,
        cache_read_tokens=a.cache_read_tokens + b.cache_read_tokens,
        cache_creation_tokens=a.cache_creation_tokens + b.cache_creation_tokens,
        cost_usd=add(a.cost_usd, b.cost_usd),  # type: ignore[arg-type]
        duration_ms=int(add(a.duration_ms, b.duration_ms) or 0) or None,
        api_duration_ms=int(add(a.api_duration_ms, b.api_duration_ms) or 0) or None,
    )
