"""Service context shared by routes: settings, engine thread, job manager, agent service, document store, terrain."""

from __future__ import annotations

import asyncio
import functools
import logging
from collections.abc import AsyncIterator, Callable
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, TypeVar

from fastapi import Request

from lunarnav.api.agent_scenarios import StoredScenarios
from lunarnav.api.agent_service import AgentService, Resumer, Starter
from lunarnav.api.diskbudget import DiskBudget
from lunarnav.api.docstore import DocumentStore
from lunarnav.api.jobs import JobManager
from lunarnav.api.jobworker import KindSpec
from lunarnav.api.settings import Settings
from lunarnav.api.terrain_service import TerrainService

log = logging.getLogger("lunarnav.api")

T = TypeVar("T")


class EngineWorker:
    """The single engine thread: every inline SPICE call in the service process runs here, one at a time.

    CSPICE keeps global state and is not thread-safe, so inline engine work is submitted to a one-thread executor
    instead of guarding each call site with a lock. Heavy or long work goes to the job pool (other processes, each
    with its own SPICE state)."""

    def __init__(self) -> None:
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="engine")

    async def run(self, fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        """Run ``fn(*args, **kwargs)`` on the engine thread and await the result."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._pool, functools.partial(fn, *args, **kwargs))

    def close(self) -> None:
        """Stop the thread after the running call finishes."""
        self._pool.shutdown(wait=True, cancel_futures=True)


@dataclass(slots=True)
class ServiceContext:
    settings: Settings
    engine: EngineWorker
    jobs: JobManager
    agents: AgentService
    docs: DocumentStore
    terrain: TerrainService
    exports: DiskBudget
    """Byte budget of the export files (one unit per export directory)."""
    cache: dict[str, Any] = field(default_factory=dict)
    """Small memo of values that do not change while the process runs (kernel description, validation record)."""

    @classmethod
    @asynccontextmanager
    async def running(
        cls, settings: Settings, kinds: dict[str, KindSpec], agent_start: Starter | None, agent_resume: Resumer | None,
    ) -> AsyncIterator[ServiceContext]:
        settings.service_dir.mkdir(parents=True, exist_ok=True)
        engine = EngineWorker()
        docs = DocumentStore(settings.db_path)
        jobs = JobManager(settings, kinds)
        jobs.start()
        agents = AgentService(settings, agent_start, agent_resume, StoredScenarios(docs))
        terrain = TerrainService(settings.data_dir, settings.tile_cache_max_bytes, settings.tile_cache_max_bytes)
        exports = DiskBudget(settings.service_dir / "exports", settings.export_cache_max_bytes, "dir")
        ctx = cls(settings, engine, jobs, agents, docs, terrain, exports)
        if settings.preload_kernels:
            from lunarnav.ephem import load_kernels

            try:
                await engine.run(load_kernels)
            except Exception:  # noqa: BLE001
                log.exception("kernel preload failed")
        try:
            yield ctx
        finally:
            await agents.shutdown()
            await jobs.shutdown()
            engine.close()
            terrain.close()
            docs.close()


def get_ctx(request: Request) -> ServiceContext:
    """FastAPI dependency returning the context created by the app lifespan."""
    return request.app.state.ctx


def demo_request(request: Request) -> bool:
    return request.headers.get("x-lunarnav-demo") == "1"
