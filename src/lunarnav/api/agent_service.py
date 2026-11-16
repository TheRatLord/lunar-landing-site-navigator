"""Agent runs held by the service: one `AgentSession` per live run, event fan-out, ledgers, artefacts.

A `RunHub` per run id fans live events out to SSE subscribers;
subscribers first replay the persisted transcript (``seq > after_seq``) and then follow the hub, skipping
anything already replayed. Sessions are started or resumed on demand and closed when idle runs exceed
`agent_max_live` or the service stops. Artefacts are served only if registered in ``artifacts.jsonl`` and
unchanged since registration.
"""

from __future__ import annotations

import asyncio
import bisect
import hashlib
import json
import logging
import mimetypes
import os
import threading
import time
from collections import OrderedDict
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, BinaryIO, Protocol

from pydantic import BaseModel

from lunarnav.agent import AgentConfig, AgentSession, ScenarioSource, fsafe
from lunarnav.agent.events import Event, InboxFile, parse_event, to_sse
from lunarnav.agent.inbox import (
    MAX_INBOX_BYTES,
    InboxError,
    inbox_bytes,
    list_inbox,
    save_inbox_path,
    spool_path,
)
from lunarnav.agent.signoff import SignoffError, assumption_status, record_signoff
from lunarnav.agent.store import (
    RUN_ID_RE,
    EventLog,
    RunPaths,
    list_runs,
    read_jsonl,
    read_run_meta,
    verify_chain,
    verify_head,
)
from lunarnav.agent.trace import ResultUnavailable, ledger_result, split_declared
from lunarnav.api.errors import ApiProblem
from lunarnav.api.settings import Settings

log = logging.getLogger("lunarnav.api.agent")

RESULT_LIMIT_BYTES = 262_144
"""Largest stored tool result the ledger-result route returns whole (compact JSON); a larger one is served as skeleton plus rows."""
HUB_QUEUE_MAX = 10_000
MAX_STREAMS_PER_RUN = 8
MIN_BUDGET_ROOM_USD = 0.05
_UNSET: Any = object()
"""Concurrent event-stream connections one run accepts (the next is `429`); each holds a queue of up to HUB_QUEUE_MAX events."""
INLINE_TYPES = frozenset(
    {"image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "application/json", "text/plain", "text/csv"}
)
"""Content types shown inline; everything else (HTML, SVG, scripts, unknown) is sent as an attachment."""


class SessionLike(Protocol):
    """The part of `AgentSession` the service uses (lets tests drive the harness bus without a model)."""

    paths: RunPaths
    bus: Any
    model: str

    def turn(self, prompt: str) -> AsyncIterator[BaseModel]: ...
    def signoff(self, assumption_id: str, decision: str, who: str, note: str) -> dict[str, Any]: ...
    def add_inbox_path(self, source: Path, filename: str | None = None) -> dict[str, Any]: ...
    async def interrupt(self) -> None: ...
    async def close(self) -> None: ...


Starter = Callable[[AgentConfig, ScenarioSource | None], Awaitable[SessionLike]]
Resumer = Callable[[str, AgentConfig, ScenarioSource | None], Awaitable[SessionLike]]


async def _default_start(config: AgentConfig, scenarios: ScenarioSource | None) -> SessionLike:
    return await AgentSession.start(config, scenarios=scenarios)


async def _default_resume(run_id: str, config: AgentConfig, scenarios: ScenarioSource | None) -> SessionLike:
    return await AgentSession.resume(run_id, config, scenarios=scenarios)


class TranscriptCache:
    """Parsed events of one transcript, extended incrementally: the file is append-only, so a new connection parses only
    the bytes written since the last one instead of the whole file. Kept only while someone is following the run."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._offset = 0
        self._events: list[Event] = []

    def after(self, path: Path, seq: int) -> list[Event]:
        """Events with ``seq`` greater than `seq` (complete lines only; a line still being written is left for later)."""
        with self._lock:
            try:
                fh = fsafe.open_read(path)
            except OSError:
                return []
            with fh:
                size = os.fstat(fh.fileno()).st_size
                if size < self._offset:
                    self._offset, self._events = 0, []
                data = b""
                if size > self._offset:
                    fh.seek(self._offset)
                    data = fh.read(size - self._offset)
            if data:
                end = data.rfind(b"\n")
                if end >= 0:
                    self._events.extend(parse_event(line) for line in data[: end + 1].splitlines() if line.strip())
                    self._offset += end + 1
            start = bisect.bisect_right(self._events, seq, key=lambda e: e.seq)
            return [e for e in self._events[start:] if e.seq > seq]

    def clear(self) -> None:
        with self._lock:
            self._offset, self._events = 0, []


class RunHub:
    """Live-event fan-out for one run id. Subscribers that fall behind are dropped (they reconnect and replay)."""

    def __init__(self) -> None:
        self._subs: set[asyncio.Queue[BaseModel | None]] = set()
        self.transcript = TranscriptCache()
        self.streams = 0

    @property
    def idle(self) -> bool:
        return not self._subs and self.streams == 0

    def subscribe(self) -> asyncio.Queue[BaseModel | None]:
        queue: asyncio.Queue[BaseModel | None] = asyncio.Queue(HUB_QUEUE_MAX)
        self._subs.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[BaseModel | None]) -> None:
        self._subs.discard(queue)

    def publish(self, event: BaseModel) -> None:
        for queue in list(self._subs):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                self._subs.discard(queue)
                while not queue.empty():
                    queue.get_nowait()
                queue.put_nowait(None)


@dataclass(slots=True)
class LiveRun:
    session: SessionLike
    forwarder: asyncio.Task[None]
    turn_task: asyncio.Task[None] | None = None
    last_used: float = field(default_factory=time.monotonic)

    @property
    def busy(self) -> bool:
        return self.turn_task is not None and not self.turn_task.done()


class AgentService:
    """Owns the live sessions of this service process."""

    def __init__(self, settings: Settings, start: Starter | None = None, resume: Resumer | None = None,
                 scenarios: ScenarioSource | None = None) -> None:
        self.settings = settings
        self._start, self._resume = start or _default_start, resume or _default_resume
        self._scenarios = scenarios
        self._live: OrderedDict[str, LiveRun] = OrderedDict()
        self._hubs: dict[str, RunHub] = {}
        self._upload_locks: dict[str, asyncio.Lock] = {}
        self._lock = asyncio.Lock()
        self._sandbox_probe: dict[str, Any] | None = None


    def config(self, model: str | None = None, budget_usd: float | None = None) -> AgentConfig:
        """Harness config with the service's overrides (runs directory, sandbox mode, budget, model). `budget_usd`
        is this run's cap (already checked against the service's ceiling); without it the service default applies."""
        overrides: dict[str, Any] = {}
        if self.settings.agent_runs_dir is not None:
            overrides["runs_root"] = self.settings.agent_runs_dir
        if self.settings.agent_sandbox is not None:
            overrides["sandbox"] = self.settings.agent_sandbox
        if self.settings.agent_max_budget_usd is not None:
            overrides["max_budget_usd"] = self.settings.agent_max_budget_usd
        if budget_usd is not None:
            overrides["max_budget_usd"] = budget_usd
        if model:
            overrides["model"] = model
        return AgentConfig.load(**overrides)

    @property
    def runs_dir(self) -> Path:
        return self.config().runs_dir

    def hub(self, run_id: str) -> RunHub:
        return self._hubs.setdefault(run_id, RunHub())


    def paths(self, run_id: str) -> RunPaths:
        """Run directory of an existing run, or 404."""
        if not RUN_ID_RE.match(run_id):
            raise ApiProblem(404, "Run not found", f"{run_id!r} is not a valid run id.")
        try:
            return RunPaths.open(self.runs_dir, run_id)
        except FileNotFoundError:
            raise ApiProblem(404, "Run not found", f"No run {run_id!r}.") from None

    def metadata(self, run_id: str, *, with_sandbox: bool = False) -> dict[str, Any]:
        """``run.json`` plus liveness, optionally the sandbox status recorded in the latest ``run_start``."""
        paths = self.paths(run_id)
        return self._decorate(read_run_meta(paths), paths if with_sandbox else None)

    def _decorate(self, meta: dict[str, Any], paths: RunPaths | None = None, showcase: Any = _UNSET) -> dict[str, Any]:
        live = self._live.get(meta["run_id"])
        out = dict(meta)
        out["live"] = live is not None
        out["budget_usd"] = meta.get("max_budget_usd")
        out["busy"] = bool(live and live.busy)
        out["shared"] = meta["run_id"] == (self._showcase() if showcase is _UNSET else showcase)
        if out["busy"]:
            out["state"] = "running"
        if paths is not None:
            out["sandbox"] = _latest_sandbox(paths.transcript)
        return out

    def list_runs(self, owner: str | None = None) -> list[dict[str, Any]]:
        """Metadata of every run on disk, newest first; with `owner`, only the runs that visitor started and the shared example."""
        showcase = self._showcase()
        return [self._decorate(m, showcase=showcase) for m in list_runs(self.runs_dir)
                if "run_id" in m and (owner is None or self._owner_of(m["run_id"]) == owner or m["run_id"] == showcase)]

    def _owner_file(self, run_id: str) -> Path:
        return self.settings.service_dir / "agent-owners" / run_id

    def _owner_of(self, run_id: str) -> str | None:
        if not RUN_ID_RE.match(run_id):
            return None
        try:
            return fsafe.read_text(self._owner_file(run_id)).strip() or None
        except OSError:
            return None

    def total_spent(self) -> float:
        return sum(float(m.get("cost_usd") or 0.0) for m in list_runs(self.runs_dir))

    def budget_left(self) -> float | None:
        cap = self.settings.agent_total_budget_usd
        return None if cap is None else cap - self.total_spent()

    def _budget_room(self) -> float | None:
        left = self.budget_left()
        if left is not None and left < MIN_BUDGET_ROOM_USD:
            cap = self.settings.agent_total_budget_usd
            raise ApiProblem(409, "Assistant budget spent", f"The assistant has used the {cap:.2f} USD set aside for it on this server.",
                             kind="total-budget-spent", budget_usd=cap)
        return left

    def _showcase(self) -> str | None:
        owner = self.settings.agent_showcase_owner
        if owner is None:
            return None
        mine = [m for m in list_runs(self.runs_dir) if "run_id" in m and self._owner_of(m["run_id"]) == owner]
        return max(mine, key=lambda m: str(m.get("created_at") or ""))["run_id"] if mine else None

    def owns(self, run_id: str, owner: str) -> bool:
        return self._owner_of(run_id) == owner

    def check_owner(self, run_id: str, owner: str, write: bool) -> None:
        if self.owns(run_id, owner):
            return
        if run_id != self._showcase():
            raise ApiProblem(404, "Run not found", f"No run {run_id!r}.")
        if write:
            raise ApiProblem(403, "Shared example", "This thread is a shared example and can only be read. Start a new thread to ask your own question.",
                             kind="shared-read-only")

    def check_budget(self, budget_usd: float | None) -> None:
        """422 (field-level) for a requested cap above the service's ceiling."""
        ceiling = self.settings.agent_budget_ceiling_usd
        if budget_usd is not None and budget_usd > ceiling:
            msg = f"`budget_usd` {budget_usd:g} is above this service's ceiling of {ceiling:g} USD"
            raise ApiProblem(422, "Budget above the ceiling", msg,
                             errors=[{"loc": ["body", "budget_usd"], "msg": msg, "type": "budget_ceiling"}], ceiling_usd=ceiling)

    async def start_run(self, prompt: str, model: str | None, budget_usd: float | None = None, owner: str | None = None) -> dict[str, Any]:
        """Create a run, connect its session and start the first turn; `owner` records the visitor who started it."""
        self.check_budget(budget_usd)
        room = await asyncio.to_thread(self._budget_room)
        if room is not None:
            budget_usd = min(room, budget_usd or self.settings.agent_max_budget_usd or room)
        async with self._lock:
            await self._make_room()
            try:
                session = await self._start(self.config(model, budget_usd), self._scenarios)
            except RuntimeError as exc:
                raise ApiProblem(503, "Agent session could not start", str(exc), kind="agent-unavailable") from exc
            if owner is not None:
                fsafe.replace(self._owner_file(session.paths.run_id), owner.encode(), mkdir=True)
            live = self._attach(session)
        self._begin_turn(live, prompt)
        return self.metadata(session.paths.run_id, with_sandbox=True)

    async def send_message(self, run_id: str, prompt: str) -> dict[str, Any]:
        """Start a follow-up turn, resuming the run from disk if its session is not live."""
        meta = self.metadata(run_id)
        cap, spent = meta.get("budget_usd"), meta.get("cost_usd")
        if cap is not None and spent is not None and spent >= cap:
            raise ApiProblem(409, "Run budget spent", f"This run has spent {spent:.2f} of its {cap:.2f} USD cap (cost as of its last "
                             "completed turn); start a new run.", kind="budget-spent", budget_usd=cap, cost_usd=spent)
        room = await asyncio.to_thread(self._budget_room)
        async with self._lock:
            live = self._live.get(run_id)
            if live is None:
                await self._make_room()
                try:
                    config = self.config() if room is None else self.config(
                        budget_usd=min(cap or self.settings.agent_max_budget_usd or room, (spent or 0.0) + room))
                    session = await self._resume(run_id, config, self._scenarios)
                except (RuntimeError, FileNotFoundError) as exc:
                    raise ApiProblem(409, "Run cannot be resumed", str(exc), kind="agent-unavailable") from exc
                live = self._attach(session)
            if live.busy:
                raise ApiProblem(409, "A turn is already running", "Interrupt it or wait for turn_end.", kind="turn-running")
            self._begin_turn(live, prompt)
        return self.metadata(run_id)

    async def interrupt(self, run_id: str) -> dict[str, Any]:
        """Ask the running turn to stop; it ends with ``turn_end`` status ``interrupted``."""
        self.paths(run_id)
        live = self._live.get(run_id)
        if live is None or not live.busy:
            raise ApiProblem(409, "No turn is running", kind="no-turn")
        await live.session.interrupt()
        return self.metadata(run_id)

    async def close_run(self, run_id: str) -> dict[str, Any]:
        """Close the live session of a run (the run stays on disk and can be resumed)."""
        self.paths(run_id)
        live = self._live.get(run_id)
        if live is not None:
            await self._close(run_id, live)
        return self.metadata(run_id)

    def _attach(self, session: SessionLike) -> LiveRun:
        run_id = session.paths.run_id
        hub = self.hub(run_id)
        queue = session.bus.subscribe()

        async def forward() -> None:
            while (event := await queue.get()) is not None:
                hub.publish(event)

        live = LiveRun(session, asyncio.create_task(forward(), name=f"agent-hub-{run_id}"))
        self._live[run_id] = live
        return live

    def _begin_turn(self, live: LiveRun, prompt: str) -> None:
        async def drive() -> None:
            try:
                async for _ in live.session.turn(prompt):
                    pass
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("agent turn failed", extra={"run_id": live.session.paths.run_id})
            finally:
                live.last_used = time.monotonic()

        live.turn_task = asyncio.create_task(drive(), name=f"agent-turn-{live.session.paths.run_id}")

    async def _make_room(self) -> None:
        while len(self._live) >= self.settings.agent_max_live:
            idle = next(((rid, lr) for rid, lr in self._live.items() if not lr.busy), None)
            if idle is None:
                raise ApiProblem(
                    429, "Too many running agents", f"{len(self._live)} runs are busy; wait for one to finish.",
                    kind="agents-busy",
                )
            await self._close(*idle)

    async def _close(self, run_id: str, live: LiveRun) -> None:
        self._live.pop(run_id, None)
        try:
            await live.session.close()
        finally:
            live.forwarder.cancel()

    async def shutdown(self) -> None:
        """Interrupt running turns and close every live session cleanly."""
        for run_id, live in list(self._live.items()):
            if live.busy:
                try:
                    await live.session.interrupt()
                except Exception:  # noqa: BLE001
                    log.exception("interrupt during shutdown failed", extra={"run_id": run_id})
                assert live.turn_task is not None
                try:
                    await asyncio.wait_for(asyncio.shield(live.turn_task), 15.0)
                except (TimeoutError, asyncio.CancelledError, Exception):  # noqa: BLE001
                    live.turn_task.cancel()
            try:
                await self._close(run_id, live)
            except Exception:  # noqa: BLE001
                log.exception("closing agent session failed", extra={"run_id": run_id})


    async def events(
        self, run_id: str, after_seq: int, *, follow: bool = True, stop_on: str = "none"
    ) -> AsyncIterator[Event | BaseModel]:
        """Persisted events with ``seq > after_seq``, then live ones (unless `follow` is false).

        `stop_on` ``turn_end`` or ``run_end`` ends the stream after the first such event.
        """
        paths = self.paths(run_id)
        hub = self.hub(run_id)
        queue = hub.subscribe() if follow else None
        hub.streams += 1
        try:
            last = after_seq
            for event in await asyncio.to_thread(hub.transcript.after, paths.transcript, after_seq):
                if event.seq > last:
                    last = event.seq
                    yield event
                    if stop_on == getattr(event, "type", None):
                        return
            if queue is None:
                return
            while True:
                event = await queue.get()
                if event is None:
                    return
                if event.seq <= last:  # type: ignore[attr-defined]
                    continue
                last = event.seq  # type: ignore[attr-defined]
                yield event
                if stop_on == getattr(event, "type", None):
                    return
        finally:
            hub.streams -= 1
            if queue is not None:
                hub.unsubscribe(queue)
            if hub.idle:
                hub.transcript.clear()

    def check_stream_capacity(self, run_id: str) -> None:
        """`429` when the run already has `MAX_STREAMS_PER_RUN` event streams open."""
        hub = self._hubs.get(run_id)
        if hub is not None and hub.streams >= MAX_STREAMS_PER_RUN:
            raise ApiProblem(
                429, "Too many event streams", f"Run {run_id!r} already has {hub.streams} open event streams (limit "
                f"{MAX_STREAMS_PER_RUN}); close one, or use `follow=false` to replay.", kind="streams-busy")


    def ledger(self, run_id: str, which: str) -> dict[str, Any]:
        """Entries of ``ledger`` / ``assumptions`` / ``artifacts`` with the hash-chain verification result."""
        paths = self.paths(run_id)
        file = {"ledger": paths.ledger, "assumptions": paths.assumptions, "artifacts": paths.artifacts}[which]
        problems = verify_chain(file) + verify_head(file)
        return {"entries": read_jsonl(file), "chain": {"ok": not problems, "problems": problems}}

    def ledger_result(self, run_id: str, ledger_id: str, row_id: str | None) -> dict[str, Any]:
        """The hash-verified stored result of one ledger entry: whole when at most `RESULT_LIMIT_BYTES`, else its skeleton
        and, with `row_id`, that row. Same run lookup as the other ledger routes; 404 for an unknown run, entry, row or a result that is
        missing or no longer matches the ledger's hash."""
        paths = self.paths(run_id)
        try:
            found = ledger_result(paths, ledger_id)
        except ResultUnavailable as exc:
            raise ApiProblem(404, "Result not available", str(exc)) from None
        skeleton = split_declared(found["output"], found["rows"])[0]
        rows = found["rows_by_id"]
        size = len(json.dumps(found["output"], separators=(",", ":"), default=str))
        whole = row_id is None and size <= RESULT_LIMIT_BYTES
        if row_id is not None and row_id not in rows:
            raise ApiProblem(404, "Row not found", f"{ledger_id} has no row {row_id!r}; its row ids are {sorted(rows)[:50]}.")
        return {"ledger_id": ledger_id, "tool": found["tool"], "kind": found["kind"], "size_bytes": size, "rows": found["rows"],
                "row_ids": found["row_ids"], "output": found["output"] if whole else None,
                "skeleton": None if whole or row_id is not None else skeleton, "row_id": row_id,
                "row": None if row_id is None else rows[row_id], "limit_bytes": RESULT_LIMIT_BYTES}

    def assumptions(self, run_id: str) -> dict[str, Any]:
        """Assumptions with their sign-off status and dependants, plus the hash-chain check of the ledger."""
        paths = self.paths(run_id)
        problems = verify_chain(paths.assumptions) + verify_head(paths.assumptions)
        return {"assumptions": assumption_status(paths), "chain": {"ok": not problems, "problems": problems}}

    def signoff(self, run_id: str, assumption_id: str, decision: str, who: str, note: str) -> dict[str, Any]:
        """Record a decision. A live session publishes the event through its own bus (sequence numbers stay
        consistent); a closed run appends it to the transcript and the hub here. Returns the assumption's new state."""
        paths = self.paths(run_id)
        if not any(a["assumption_id"] == assumption_id for a in assumption_status(paths)):
            raise ApiProblem(404, "Assumption not found", f"Run {run_id!r} has no assumption {assumption_id!r}.")
        live = self._live.get(run_id)
        try:
            if live is not None:
                live.session.signoff(assumption_id, decision, who, note)
            else:
                record_signoff(paths, assumption_id, decision, who, note, write_event=True)
                self._publish_last(run_id, paths)
        except SignoffError as exc:
            raise ApiProblem(422, "Invalid sign-off", str(exc), kind="invalid-signoff") from exc
        return next(a for a in assumption_status(paths) if a["assumption_id"] == assumption_id)

    def inbox(self, run_id: str) -> dict[str, Any]:
        try:
            return {"files": list_inbox(self.paths(run_id))}
        except fsafe.UnsafePath as exc:
            raise self._inbox_unusable(run_id, exc) from exc

    @staticmethod
    def _inbox_unusable(run_id: str, exc: fsafe.UnsafePath) -> ApiProblem:
        """The run's inbox (or the file name asked for) is a link, pipe or other special file: a conflict with the run's
        state, not a server fault. The path is logged, never sent."""
        log.warning("run %s: inbox refused, unsafe path: %s", run_id, exc)
        return ApiProblem(
            409, "Inbox unusable",
            "This run's inbox, or the file name asked for, is a link or another special file, so nothing was stored or read. "
            "Remove it from the run directory or start a new run.", kind="inbox-unusable")

    async def upload(self, run_id: str, filename: str, declared_size: int | None, chunks: AsyncIterator[bytes]) -> dict[str, Any]:
        """See `_upload`; an unsafe inbox location answers 409 `inbox-unusable`."""
        try:
            return await self._upload(run_id, filename, declared_size, chunks)
        except fsafe.UnsafePath as exc:
            raise self._inbox_unusable(run_id, exc) from exc

    async def _upload(self, run_id: str, filename: str, declared_size: int | None, chunks: AsyncIterator[bytes]) -> dict[str, Any]:
        """Stream an upload into the run's inbox without holding it in memory: it is spooled to ``state/spool``, then
        checked and moved in by the harness (name, extension allowlist, content sniff, size, SHA-256).

        Uploads to one run are taken one at a time, so the inbox total holds under parallel requests (a second upload
        waits for the first to finish, then sees what it stored). All file work (write, hash, copy) runs in worker
        threads: the event loop keeps answering other requests."""
        paths = self.paths(run_id)
        if declared_size is not None and declared_size > MAX_INBOX_BYTES:
            raise ApiProblem(413, "File too large", f"{declared_size} bytes exceeds the {MAX_INBOX_BYTES}-byte inbox limit.")
        async with self._upload_locks.setdefault(run_id, asyncio.Lock()):
            held = await asyncio.to_thread(inbox_bytes, paths)
            room = self.settings.inbox_max_bytes - held

            def full(size: str) -> ApiProblem:
                return ApiProblem(
                    413, "Inbox full",
                    f"{size} would exceed this run's inbox total of {self.settings.inbox_max_bytes} bytes "
                    f"({held} already held, {max(room, 0)} free). Files are never removed for you; start a new run or raise "
                    "LUNARNAV_API_INBOX_MAX_MB.", kind="inbox-full")

            if declared_size is not None and declared_size > room:
                raise full(f"A {declared_size}-byte upload")
            spool = spool_path(paths)
            total = 0
            try:
                handle = await asyncio.to_thread(fsafe.open_new, spool, mkdir=True)
                try:
                    async for chunk in chunks:
                        total += len(chunk)
                        if total > MAX_INBOX_BYTES:
                            raise ApiProblem(413, "File too large", f"More than {MAX_INBOX_BYTES} bytes received.")
                        if total > room:
                            raise full(f"More than {total - len(chunk)} bytes received, which")
                        await asyncio.to_thread(handle.write, chunk)
                finally:
                    await asyncio.to_thread(handle.close)
                try:
                    entry = await asyncio.to_thread(save_inbox_path, paths, spool, filename)
                except InboxError as exc:
                    raise ApiProblem(422, "File refused", str(exc), kind="inbox-refused") from exc
                live = self._live.get(run_id)
                if live is not None:
                    live.session.bus.emit(InboxFile, **entry)
                else:
                    log = EventLog(paths.transcript)
                    log.write(InboxFile(run_id=run_id, seq=log.next_seq(), **entry))
                    self._publish_last(run_id, paths)
                return entry
            finally:
                await asyncio.shield(asyncio.to_thread(fsafe.remove, spool))

    def _publish_last(self, run_id: str, paths: RunPaths) -> None:
        """Fan the newest persisted event out to followers of a run that has no live session."""
        hub = self.hub(run_id)
        events = hub.transcript.after(paths.transcript, 0)
        if events:
            hub.publish(events[-1])
        if hub.idle:
            hub.transcript.clear()

    def open_artifact(self, run_id: str, artifact_id: str, version: int | None) -> tuple[BinaryIO, dict[str, Any], str, int]:
        """Open a registered artefact (latest version by default) without following links, check it against the hash
        recorded at registration, and return ``(handle, ledger entry, file name, size)`` positioned at the start. The
        caller serves from the handle, so the bytes sent are the file that was checked."""
        paths = self.paths(run_id)
        entries = [e for e in read_jsonl(paths.artifacts) if e.get("artifact_id") == artifact_id]
        if version is not None:
            entries = [e for e in entries if e.get("version") == version]
        if not entries:
            raise ApiProblem(404, "Artefact not registered", f"{artifact_id!r} (version {version}) is not in the run's artefact ledger.")
        entry = entries[-1]
        file = paths.artifact_file(entry["path"])
        try:
            handle = fsafe.open_read(file) if file is not None else None
        except OSError:
            handle = None
        if handle is None:
            raise ApiProblem(404, "Artefact file missing", f"{entry['path']!r} is no longer in the run.")
        try:
            digest = hashlib.sha256()
            while block := handle.read(1 << 20):
                digest.update(block)
            if digest.hexdigest() != entry["sha256"]:
                raise ApiProblem(
                    409,
                    "Artefact changed since registration",
                    "The file differs from the hash recorded when it was registered; ask the agent to register it again.",
                    kind="artifact-modified",
                )
            size = handle.tell()
            handle.seek(0)
        except BaseException:
            handle.close()
            raise
        return handle, entry, file.name, size


    def instructions(self) -> dict[str, Any]:
        """What a new run would be told and allowed: prompt, tools, policy, default model."""
        from claude_agent_sdk import __version__ as sdk_version
        from claude_agent_sdk._cli_version import __cli_version__ as cli_version

        from lunarnav.agent.builtin_tools import builtin_tools
        from lunarnav.agent.policy import PermissionPolicy
        from lunarnav.agent.prompt import render_prompt
        from lunarnav.agent.registry import ToolRegistry
        from lunarnav.agent.sandbox import probe_sandbox
        from lunarnav.agent.tools import describe_tools

        cfg = self.config()
        workspace = str(cfg.runs_dir / "<run_id>" / "workspace")
        prompt = render_prompt(cfg, workspace)
        registry = ToolRegistry(builtin_tools())
        policy = PermissionPolicy(Path(workspace), cfg, frozenset(registry.mcp_names()))
        if self._sandbox_probe is None:
            available, detail = probe_sandbox()
            self._sandbox_probe = {"mode": cfg.sandbox, "available": available, "enabled": cfg.sandbox != "off" and available, "detail": detail}
        policy.sandboxed = bool(self._sandbox_probe["enabled"])
        return {
            "model": cfg.model,
            "default_model": cfg.model,
            "prompt_version": prompt.version,
            "prompt_sha256": prompt.sha256,
            "prompt_template_sha256": prompt.template_sha256,
            "instructions": prompt.text,
            "tools": [t.model_dump() for t in describe_tools(registry)],
            "permission_policy": policy.describe(),
            "sandbox": self._sandbox_probe,
            "versions": {"claude_agent_sdk": sdk_version, "claude_code_cli": cli_version},
            "workspace": workspace,
            "max_budget_usd": cfg.max_budget_usd,
        }


def owner_id(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _latest_sandbox(transcript: Path) -> dict[str, Any] | None:
    try:
        text = fsafe.read_text(transcript)
    except OSError:
        return None
    found = None
    for line in text.splitlines():
        if '"type":"run_start"' in line:
            found = json.loads(line).get("sandbox")
    return found


def frame(event: BaseModel) -> bytes:
    """SSE frame for one harness event, exactly as the harness's ``to_sse`` renders it."""
    return to_sse(event).encode()


def artifact_media_type(entry: dict[str, Any], name: str) -> str:
    """Content type recorded at registration (guessed from the name when absent)."""
    return entry.get("mime") or mimetypes.guess_type(name)[0] or "application/octet-stream"
