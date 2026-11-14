"""Job manager: a bounded process pool with progress, cooperative cancellation and a disk result cache.

Process model
-------------
* Workers are ``spawn``-ed processes (`jobworker.init_worker` loads the SPICE kernels once per worker),
  so CSPICE is never shared across threads or forked state.
* Progress and "started" notices travel worker -> parent over one ``multiprocessing.Queue``; a pump thread
  re-posts them on the asyncio loop. Cancellation is a shared byte per job slot that the job polls in
  ``ctx.progress`` (cooperative: a job that never reports progress cannot be interrupted).
* Scheduling: jobs wait in the manager, not in the executor. A free worker takes the first queued job that is
  allowed to start; long kinds (`KindSpec.long`) may hold at most ``workers - reserved`` workers (never fewer than one), so a short
  analysis always finds a worker. Within a class the order is first come, first served; a long job held back by the limit does not
  hold up short jobs behind it.
* Admission is bounded: at most ``workers + queue_max`` unfinished jobs; beyond that submissions get HTTP 429.
  Identical unfinished requests share one job.
* Results are JSON files in the cache directory keyed by the SHA-256 of ``(kind, kind version, canonical
  request, data versions)``. Jobs hold no result in memory. Finished job records are bounded (`history_max`)
  and the cache is pruned oldest-first above `cache_max_bytes`.
"""

from __future__ import annotations

import asyncio
import gc
import hashlib
import logging
import multiprocessing
import os
import re
import threading
import time
import uuid
from collections import OrderedDict
from collections.abc import Callable
from concurrent.futures import BrokenExecutor, Future, ProcessPoolExecutor
from concurrent.futures import CancelledError as FutureCancelled
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from lunarnav.api.errors import ApiProblem
from lunarnav.api.eventlog import EventLog
from lunarnav.api.jobworker import JobCancelled, KindSpec, init_worker, new_cancel_flags, run_job, warm_worker
from lunarnav.api.json import dumps
from lunarnav.api.settings import Settings
from lunarnav.api.versions import data_versions, results_source_sha256, terrain_signature

log = logging.getLogger("lunarnav.api.jobs")

TERMINAL = frozenset({"done", "failed", "cancelled"})

JOB_KINDS: dict[str, KindSpec] = {
    "ephemeris.tracks": KindSpec("lunarnav.api.compute.ephem:tracks_job", "1", "Sun/Earth/station tracks"),
    "ephemeris.subpoints": KindSpec("lunarnav.api.compute.ephem:subpoints_job", "1", "Sub-solar/sub-Earth points"),
    "analysis.evaluate": KindSpec("lunarnav.api.compute.analyses:evaluate_job", "1", "Evaluate a scenario"),
    "analysis.scan": KindSpec("lunarnav.api.compute.analyses:scan_job", "1", "Landing opportunity scan"),
    "analysis.slip": KindSpec("lunarnav.api.compute.analyses:slip_job", "1", "Slip analysis"),
    "analysis.sensitivity-height": KindSpec("lunarnav.api.compute.analyses:height_sensitivity_job", "1", "Height sensitivity"),
    "analysis.sensitivity-position": KindSpec("lunarnav.api.compute.analyses:position_sensitivity_job", "1", "Position sensitivity"),
    "analysis.attribution": KindSpec("lunarnav.api.compute.analyses:attribution_job", "1", "Event attribution"),
    "analysis.compare": KindSpec("lunarnav.api.compute.analyses:compare_job", "1", "Scenario comparison"),
    "analysis.horizon": KindSpec("lunarnav.api.compute.analyses:horizon_job", "1", "Horizon profile"),
    "analysis.ellipse": KindSpec("lunarnav.api.compute.surveys:ellipse_job", "2", "Landing-ellipse statistics", long=True),
    "analysis.search": KindSpec("lunarnav.api.compute.surveys:search_job", "2", "Site search", long=True),
    "analysis.regional": KindSpec("lunarnav.api.compute.surveys:regional_job", "2", "Regional layers", long=True),
    "analysis.export": KindSpec("lunarnav.api.compute.exports:export_job", "1", "Export"),
}
"""Long-computation kinds known to the pool. To add an analysis, register it here."""
_PROGRESS_MIN_INTERVAL_S = 0.05


def _now_ms() -> int:
    return int(time.time() * 1000)


@dataclass(slots=True)
class Job:
    """One submitted computation. ``state`` is queued | running | done | failed | cancelled."""

    id: str
    kind: str
    key: str
    label: str
    state: str = "queued"
    progress: float | None = None
    stage: str = ""
    created_ms: int = field(default_factory=_now_ms)
    started_ms: int | None = None
    finished_ms: int | None = None
    cached: bool = False
    cancel_requested: bool = False
    holders: int = 1
    """Clients that submitted this same request and have not cancelled: the job stops only when the last one cancels."""
    source: str = ""
    """Source hash the cache key was built with; the worker's must equal it."""
    error: dict[str, str] | None = None
    result_bytes: int | None = None
    slot: int = -1
    log: EventLog = field(default_factory=EventLog)
    last_progress_sent: float = 0.0
    future: Future[tuple[bytes, str]] | None = None
    long: bool = False
    request: dict[str, Any] | None = None
    """Held until the job is handed to a worker."""
    dispatched: bool = False
    """Handed to the pool and not yet returned: it occupies a worker."""
    queue: dict[str, Any] | None = None

    def status(self) -> dict[str, Any]:
        """Wire form of the job (the payload of every ``status`` event)."""
        return {
            "id": self.id,
            "kind": self.kind,
            "label": self.label,
            "state": self.state,
            "progress": self.progress,
            "stage": self.stage,
            "created_ms": self.created_ms,
            "started_ms": self.started_ms,
            "finished_ms": self.finished_ms,
            "cached": self.cached,
            "cancel_requested": self.cancel_requested,
            "holders": self.holders,
            "error": self.error,
            "result_bytes": self.result_bytes,
            "cache_key": self.key,
            "job_class": "long" if self.long else "short",
            "queue": self.queue,
        }

    async def settle(self, timeout: float) -> None:
        async def watch() -> None:
            async for _ in self.log.stream(-1):
                if self.state in TERMINAL:
                    return

        if self.state in TERMINAL:
            return
        try:
            await asyncio.wait_for(watch(), timeout)
        except TimeoutError:
            pass

    def raise_for_failure(self) -> None:
        if self.state == "failed":
            err = self.error or {}
            if err.get("type") == "RequestError":
                raise ApiProblem(422, "Analysis cannot be served", err.get("message", ""), kind="analysis-rejected", job_id=self.id)
            raise ApiProblem(500, "Analysis failed", f"{err.get('type', 'Error')}: {err.get('message', '')}", kind="analysis-failed",
                             job_id=self.id)
        if self.state == "cancelled" and (self.error or {}).get("type") == "Shutdown":
            raise ApiProblem(503, "Service stopping", "The service is shutting down; retry when it is back.", kind="shutdown", job_id=self.id)
        if self.state == "cancelled":
            raise ApiProblem(409, "Analysis cancelled", "The job was cancelled.", kind="job-cancelled", job_id=self.id)


SOURCE_FIELD = re.compile(rb'"source_sha256"\s*:\s*"([0-9a-f]{64})"')
"""A provenance `source_sha256` inside serialised result bytes."""


class ResultCache:
    """Content-addressed JSON files with oldest-first size pruning."""

    def __init__(self, directory: Path, max_bytes: int) -> None:
        self.dir = directory
        self.max_bytes = max_bytes
        self.source = results_source_sha256()
        directory.mkdir(parents=True, exist_ok=True)

    def path(self, key: str) -> Path:
        return self.dir / f"{key}.json"

    def has(self, key: str) -> int | None:
        """Size of the cached result, refreshing its recency; ``None`` when absent or stale (a stale file is deleted)."""
        p = self.path(key)
        try:
            data = p.read_bytes()
        except FileNotFoundError:
            return None
        if self.is_stale(data):
            p.unlink(missing_ok=True)
            return None
        os.utime(p)
        return len(data)

    def is_stale(self, data: bytes) -> bool:
        """True when `data` carries a provenance `source_sha256` other than this process's: a result of other code is never served,
        whatever key it was stored under. Results without a provenance block (ephemeris, catalogue) carry no hash and pass."""
        return any(h != self.source.encode() for h in SOURCE_FIELD.findall(data))

    def read(self, key: str) -> bytes | None:
        try:
            return self.path(key).read_bytes()
        except FileNotFoundError:
            return None

    def write(self, key: str, data: bytes) -> None:
        tmp = self.dir / f"{key}.{uuid.uuid4().hex}.tmp"
        tmp.write_bytes(data)
        os.replace(tmp, self.path(key))
        self.prune()

    def prune(self) -> None:
        horizon = time.time() - 3600.0
        for tmp in self.dir.glob("*.tmp"):
            try:
                if tmp.stat().st_mtime < horizon:
                    tmp.unlink(missing_ok=True)
            except FileNotFoundError:
                pass
        files = [(p.stat().st_mtime, p.stat().st_size, p) for p in self.dir.glob("*.json")]
        total = sum(s for _, s, _ in files)
        for _, size, p in sorted(files):
            if total <= self.max_bytes:
                break
            p.unlink(missing_ok=True)
            total -= size


class JobManager:
    """Submit, track, stream, cancel and fetch long computations. Create and use inside one event loop."""

    def __init__(self, settings: Settings, kinds: dict[str, KindSpec]) -> None:
        self.settings = settings
        self.kinds = dict(kinds)
        self.cache = ResultCache(settings.cache_dir, settings.cache_max_bytes)
        self._jobs: OrderedDict[str, Job] = OrderedDict()
        self._inflight: dict[str, Job] = {}
        self._slots: list[bool] = []
        self._executor: ProcessPoolExecutor | None = None
        self._ctx = multiprocessing.get_context("spawn")
        self._queue: Any = None
        self._flags: Any = None
        self._pump: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._capacity = settings.job_workers + settings.job_queue_max
        self._versions: dict[str, Any] | None = None
        self._versions_sig: tuple = ()
        self._tasks: set[asyncio.Task[None]] = set()
        self._warm: dict[str, Any] = {"state": "disabled", "workers": 0, "warm": 0, "seconds": None, "error": None}
        self._warm_t0 = 0.0
        self._closing = False
        self._pending: list[Job] = []
        self._busy = 0
        self._busy_long = 0
        workers = settings.job_workers
        self._long_max = workers - settings.job_reserved_workers if workers - settings.job_reserved_workers >= 1 else workers


    def start(self) -> None:
        """Bind to the running loop and create the (lazily spawning) process pool."""
        self._loop = asyncio.get_running_loop()
        self._data_versions()
        self._slots = [False] * self._capacity
        self._flags = new_cancel_flags(self._capacity)
        self._queue = self._ctx.Queue()
        self._make_executor()
        self._pump = threading.Thread(target=self._pump_loop, name="job-progress-pump", daemon=True)
        self._pump.start()

    def _make_executor(self) -> None:
        self._executor = ProcessPoolExecutor(
            max_workers=self.settings.job_workers,
            mp_context=self._ctx,
            initializer=init_worker,
            initargs=(self._queue, self._flags, self.kinds, self.settings.preload_kernels, str(self.settings.data_dir)),
        )
        if self.settings.warm_workers:
            self._start_warm()


    @property
    def warm_status(self) -> dict[str, Any]:
        """Readiness of the pool: ``state`` is disabled | warming | ready | failed."""
        return dict(self._warm)

    def _start_warm(self) -> None:
        """Run `warm_worker` once per worker in the background. Each takes seconds, so the pool spreads them
        over distinct processes; jobs submitted meanwhile queue behind them."""
        assert self._executor is not None
        n = self.settings.job_workers
        self._warm = {"state": "warming", "workers": n, "warm": 0, "seconds": None, "error": None}
        self._warm_t0 = time.monotonic()
        executor = self._executor
        for _ in range(n):
            fut = executor.submit(warm_worker)
            fut.add_done_callback(lambda f, ex=executor: self._call_in_loop(self._on_warm_done, ex, f))

    def _on_warm_done(self, executor: ProcessPoolExecutor, fut: Future[dict[str, Any]]) -> None:
        if executor is not self._executor:
            return
        exc = None if fut.cancelled() else fut.exception()
        if fut.cancelled() or exc is not None:
            if self._warm["state"] != "failed" and not (fut.cancelled() and self._warm["state"] == "stopping"):
                self._warm.update(state="failed", error=repr(exc) if exc else "cancelled")
                log.error("worker warm-up failed", extra={"error": self._warm["error"]})
            return
        self._warm["warm"] += 1
        if self._warm["warm"] >= self._warm["workers"] and self._warm["state"] == "warming":
            self._warm.update(state="ready", seconds=round(time.monotonic() - self._warm_t0, 2))
            log.info("workers warm", extra={"seconds": self._warm["seconds"], "workers": self._warm["workers"]})

    async def shutdown(self) -> None:
        """Cancel unfinished jobs, stop the workers, close the channels and release every semaphore."""
        self._closing = True
        self._warm["state"] = "stopping" if self._warm["state"] == "warming" else self._warm["state"]
        for job in list(self._inflight.values()):
            self._flags[job.slot] = 1
        for task in list(self._tasks):
            task.cancel()
        executor, self._executor = self._executor, None
        if executor is not None:
            procs = list(getattr(executor, "_processes", {}).values())
            manager = getattr(executor, "_executor_manager_thread", None)
            executor.shutdown(wait=False, cancel_futures=True)
            await asyncio.sleep(0.05)
            for p in procs:
                if p.is_alive():
                    p.terminate()
            for p in procs:
                await asyncio.to_thread(p.join, 2.0)
            if manager is not None:
                await asyncio.to_thread(manager.join, 5.0)
        self._queue.put(None)
        if self._pump is not None:
            await asyncio.to_thread(self._pump.join, 2.0)
        for job in self._jobs.values():
            if job.state not in TERMINAL:
                self._set_state(job, "cancelled", error={"type": "Shutdown", "message": "service stopping"})
            job.log.close()
        self._queue.close()
        await asyncio.to_thread(self._queue.join_thread)
        del executor
        self._queue = None
        gc.collect()


    def _data_versions(self) -> dict[str, Any]:
        sig = terrain_signature(self.settings.data_dir)
        if self._versions is None or sig != self._versions_sig:
            self._versions = data_versions(self.settings.data_dir)
            self._versions_sig = sig
        return self._versions

    def cache_key(self, kind: str, request: dict[str, Any]) -> str:
        """Content hash identifying a computation: endpoint kind and version, request, data versions."""
        spec = self.kinds[kind]
        blob = dumps(
            {"kind": kind, "kind_version": spec.version, "request": request, "data": self._data_versions()},
            canonical=True,
        )
        return hashlib.sha256(blob).hexdigest()

    def discard_result(self, job: Job) -> None:
        """Drop the cached result of `job` so the same request computes again (its files were deleted or pruned)."""
        self.cache.path(job.key).unlink(missing_ok=True)

    def unfinished(self, kinds: set[str]) -> bool:
        """True while a job of one of `kinds` is queued or running."""
        return any(j.kind in kinds for j in self._inflight.values())

    async def run(self, kind: str, request: dict[str, Any], wait_s: float, label: str = "") -> Job:
        job = self.submit(kind, request, label)
        await job.settle(wait_s)
        job.raise_for_failure()
        return job

    def submit(self, kind: str, request: dict[str, Any], label: str = "") -> Job:
        """Start `kind` on `request` (a JSON-ready dict) or return the cached/in-flight equivalent; `label` defaults to the
        kind's own.

        Raises `ApiProblem` 429 when the admission bound is reached.
        """
        if kind not in self.kinds:
            raise ApiProblem(404, "Unknown job kind", kind)
        if self._closing:
            raise ApiProblem(503, "Service stopping", "The service is shutting down; retry when it is back.", kind="shutdown")
        key = self.cache_key(kind, request)
        existing = self._inflight.get(key)
        if existing is not None and not existing.cancel_requested:
            existing.holders += 1
            return existing
        job = Job(id=uuid.uuid4().hex[:16], kind=kind, key=key, label=label or self.kinds[kind].label, source=self._data_versions()["source"],
                  long=self.kinds[kind].long)
        self._register(job)
        size = self.cache.has(key)
        if size is not None:
            job.cached = True
            job.progress = 1.0
            job.started_ms = job.finished_ms = _now_ms()
            job.result_bytes = size
            self._set_state(job, "done")
            job.log.close()
            return job
        if all(self._slots):
            self._jobs.pop(job.id)
            raise ApiProblem(
                429,
                "Job queue is full",
                f"{len(self._inflight)} unfinished jobs; retry when some finish.",
                kind="queue-full",
            )
        job.slot = self._slots.index(False)
        self._slots[job.slot] = True
        self._flags[job.slot] = 0
        self._inflight[key] = job
        job.request = request
        self._pending.append(job)
        job.log.append("status", job.status())
        self._dispatch()
        return job


    def _dispatch(self) -> None:
        """Hand queued jobs to free workers, first come first served, long kinds within their share of the pool."""
        if self._closing or self._executor is None:
            return
        while self._busy < self.settings.job_workers:
            job = next((j for j in self._pending if not j.long or self._busy_long < self._long_max), None)
            if job is None:
                break
            self._pending.remove(job)
            self._launch(job)
        self._refresh_queue()

    def _launch(self, job: Job) -> None:
        assert self._executor is not None and job.request is not None
        request, job.request = job.request, None
        job.dispatched = True
        job.queue = None
        self._busy += 1
        self._busy_long += job.long
        try:
            job.future = self._executor.submit(run_job, job.id, job.slot, job.kind, request)
        except BrokenExecutor:
            self._make_executor()
            job.future = self._executor.submit(run_job, job.id, job.slot, job.kind, request)
        job.future.add_done_callback(lambda fut, j=job: self._call_in_loop(self._on_future_done, j, fut))

    def _refresh_queue(self) -> None:
        """Recompute `Job.queue` of every waiting job; a changed record is re-sent as a status event."""
        running = [j for j in self._jobs.values() if j.dispatched]
        for is_long in (False, True):
            waiting = [j for j in self._pending if j.long == is_long]
            reason = "long-limit" if is_long and self._busy_long >= self._long_max else "worker"
            blockers = [r for r in running if r.long] if reason == "long-limit" else running
            for pos, job in enumerate(waiting, 1):
                ahead = [*blockers, *waiting[: pos - 1]]
                info = {
                    "position": pos, "waiting_for": reason, "ahead_count": len(ahead),
                    "ahead": [{"id": a.id, "kind": a.kind, "label": a.label, "state": "running" if a.dispatched else "queued"}
                              for a in ahead[:10]]}
                if job.queue != info:
                    job.queue = info
                    job.log.append("status", job.status())

    def _register(self, job: Job) -> None:
        self._jobs[job.id] = job
        while len(self._jobs) > self.settings.job_history_max:
            oldest = next((j for j in self._jobs.values() if j.state in TERMINAL), None)
            if oldest is None:
                break
            del self._jobs[oldest.id]

    def get(self, job_id: str) -> Job:
        """Job by id or `ApiProblem` 404."""
        job = self._jobs.get(job_id)
        if job is None:
            raise ApiProblem(404, "Job not found", f"No job {job_id!r} (finished jobs are forgotten after a restart or when history is full).")
        return job

    def list(self) -> list[Job]:
        """Known jobs, newest first."""
        return list(reversed(self._jobs.values()))


    def cancel(self, job_id: str, *, force: bool = False) -> tuple[Job, str]:
        """Request cancellation; returns the job and what the request did: `already_finished`, `detached` (other requests still want the
        job, so this one only let go; `force` cancels for all of them), `cancelled` (a queued job, stopped at once) or `requested` (a
        running job, stopped at its next progress call)."""
        job = self.get(job_id)
        if job.state in TERMINAL:
            return job, "already_finished"
        if job.holders > 1 and not job.cancel_requested and not force:
            job.holders -= 1
            job.log.append("status", job.status())
            return job, "detached"
        job.holders = 0
        job.cancel_requested = True
        self._flags[job.slot] = 1
        if job in self._pending:
            self._pending.remove(job)
        if (job.future is not None and job.future.cancel()) or job.state == "queued":
            self._finish(job, "cancelled")
            return job, "cancelled"
        job.log.append("status", job.status())
        return job, "requested"

    def result(self, job_id: str) -> bytes:
        """The JSON result bytes of a finished job."""
        job = self.get(job_id)
        if job.state != "done":
            raise ApiProblem(409, "Result not available", f"Job is {job.state}.", kind="job-not-done", state=job.state)
        data = self.cache.read(job.key)
        if data is None or self.cache.is_stale(data):
            raise ApiProblem(410, "Result expired", "The cached result was pruned; submit the request again.")
        return data


    def _call_in_loop(self, fn: Callable[..., None], *args: Any) -> None:
        loop = self._loop
        if loop is not None and not loop.is_closed():
            try:
                loop.call_soon_threadsafe(fn, *args)
            except RuntimeError:
                pass

    def _pump_loop(self) -> None:
        while True:
            try:
                msg = self._queue.get()
            except (EOFError, OSError):
                return
            if msg is None:
                return
            self._call_in_loop(self._on_message, msg)

    def _on_message(self, msg: tuple[Any, ...]) -> None:
        job = self._jobs.get(msg[1])
        if job is None or job.state in TERMINAL:
            return
        if msg[0] == "started":
            job.started_ms = _now_ms()
            self._set_state(job, "running")
        elif msg[0] == "progress":
            job.progress, job.stage = msg[2], msg[3]
            now = time.monotonic()
            if job.state == "queued":
                job.started_ms = _now_ms()
                job.state = "running"
            if now - job.last_progress_sent >= _PROGRESS_MIN_INTERVAL_S or msg[2] >= 1.0:
                job.last_progress_sent = now
                job.log.append("status", job.status())

    def _set_state(self, job: Job, state: str, error: dict[str, str] | None = None) -> None:
        job.state = state
        if error is not None:
            job.error = error
        job.log.append("status", job.status())

    def _on_future_done(self, job: Job, fut: Future[bytes]) -> None:
        if job.dispatched:
            job.dispatched = False
            self._busy -= 1
            self._busy_long -= job.long
        try:
            self._handle_future_done(job, fut)
        finally:
            self._dispatch()

    def _handle_future_done(self, job: Job, fut: Future[bytes]) -> None:
        if job.state in TERMINAL:
            self._release_slot(job)
            return
        if self._closing:
            self._finish(job, "cancelled", {"type": "Shutdown", "message": "the service is stopping"})
            return
        if fut.cancelled():
            self._finish(job, "cancelled")
            return
        exc = fut.exception()
        if exc is None:
            data, worker_source = fut.result()
            if worker_source != job.source:
                log.error("worker source differs from the service's", extra={"job_id": job.id, "kind": job.kind})
                self._finish(job, "failed", {
                    "type": "WorkerSourceMismatch",
                    "message": f"the worker ran lunarnav source {worker_source[:12]} but this result was keyed for source "
                               f"{job.source[:12]}: the code or packaged data changed while the service was running. "
                               "Nothing was cached; restart the service and submit again."})
                return
            task = asyncio.get_running_loop().create_task(self._store_result(job, data))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)
        elif isinstance(exc, JobCancelled | FutureCancelled):
            self._finish(job, "cancelled")
        elif isinstance(exc, BrokenExecutor):
            if getattr(self._executor, "_broken", False):
                self._make_executor()
            self._finish(job, "failed", {"type": "WorkerCrashed", "message": "a worker process died; pool restarted"})
        else:
            log.error("job failed", extra={"job_id": job.id, "kind": job.kind, "error": repr(exc)})
            self._finish(job, "failed", {"type": type(exc).__name__, "message": str(exc)})

    async def _store_result(self, job: Job, data: bytes) -> None:
        try:
            await asyncio.to_thread(self.cache.write, job.key, data)
        except OSError as exc:
            self._finish(job, "failed", {"type": "CacheWriteError", "message": str(exc)})
            return
        job.result_bytes = len(data)
        job.progress = 1.0
        self._finish(job, "done")

    def _release_slot(self, job: Job) -> None:
        if job.slot >= 0:
            self._slots[job.slot] = False
            job.slot = -1

    def _finish(self, job: Job, state: str, error: dict[str, str] | None = None) -> None:
        if job.state in TERMINAL:
            return
        job.finished_ms = _now_ms()
        if self._inflight.get(job.key) is job:
            del self._inflight[job.key]
        if job.future is None or job.future.done():
            self._release_slot(job)
        job.queue = None
        self._set_state(job, state, error)
        job.log.close()
        if job in self._pending:
            self._pending.remove(job)
        self._refresh_queue()
