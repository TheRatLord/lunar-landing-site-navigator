"""Worker-process side of the job system.

Runs in processes started with the ``spawn`` method: no inherited SPICE state, no FastAPI import.
Each worker loads the kernels once (initializer), then runs jobs. A job function has the signature
``fn(request: dict, ctx: JobContext) -> JSON-serialisable`` and reports progress with
``ctx.progress(fraction, stage)``; that call is also the cooperative cancellation point.
"""

from __future__ import annotations

import importlib
import multiprocessing.sharedctypes as sharedctypes
import os
import time
from dataclasses import dataclass
from typing import Any

from lunarnav.api.json import dumps


class JobCancelled(Exception):
    """Raised inside a job when cancellation was requested."""


@dataclass(frozen=True, slots=True)
class KindSpec:
    """A registered job kind: dotted ``module:function``, a version string for the cache key and the label its jobs
    carry unless the submitter names them.

    Bump `version` whenever the function's numerical behaviour changes.
    """

    entry: str
    version: str
    label: str
    long: bool = False
    """A kind that can occupy a worker for minutes. Long jobs may hold at most `workers - reserved` of the pool, so the
    short analyses always find a free worker (`JobManager`)."""


_state: dict[str, Any] = {}


def init_worker(
    progress_queue: Any, cancel_flags: Any, kinds: dict[str, KindSpec], preload: bool, data_dir: str | None = None
) -> None:
    """Pool initializer: remember the shared channels and the data directory (also exported as
    ``LUNARNAV_DATA`` so terrain and horizon caches resolve to it) and (optionally) load the SPICE kernels."""
    from lunarnav.api.versions import source_sha256

    _state.update(queue=progress_queue, flags=cancel_flags, kinds=kinds, data_dir=data_dir,
                  source_sha256=source_sha256())
    if data_dir:
        os.environ["LUNARNAV_DATA"] = data_dir
    os.environ.setdefault("NUMBA_NUM_THREADS", "2")
    from numba.core import config as numba_config

    numba_config.reload_config()
    if preload:
        from lunarnav.ephem import load_kernels

        load_kernels()


class JobContext:
    """Handle given to a job function."""

    def __init__(self, job_id: str, slot: int) -> None:
        self.job_id = job_id
        self._slot = slot

    def check_cancelled(self) -> None:
        """Raise `JobCancelled` if the service asked this job to stop."""
        if _state["flags"][self._slot]:
            raise JobCancelled(self.job_id)

    def progress(self, fraction: float, stage: str = "") -> None:
        """Report progress in [0, 1] and honour a pending cancellation."""
        self.check_cancelled()
        _state["queue"].put(("progress", self.job_id, min(max(float(fraction), 0.0), 1.0), stage))


def run_job(job_id: str, slot: int, kind: str, request: dict[str, Any]) -> tuple[bytes, str]:
    """Entry point executed in the pool: the result encoded as JSON bytes and the source hash of this worker."""
    ctx = JobContext(job_id, slot)
    ctx.check_cancelled()
    _state["queue"].put(("started", job_id))
    module_name, _, func_name = _state["kinds"][kind].entry.partition(":")
    fn = getattr(importlib.import_module(module_name), func_name)
    result = fn(request, ctx)
    ctx.check_cancelled()
    return dumps(result), _state["source_sha256"]


def warm_worker() -> dict[str, Any]:
    """Make this worker fast before the first real job: load the kernels, import every module that hosts a
    job kind and call its optional ``warm_up()`` (which exercises the numerical code so it is compiled)."""
    t0 = time.perf_counter()
    from lunarnav.ephem import load_kernels

    load_kernels()
    modules = {spec.entry.partition(":")[0] for spec in _state["kinds"].values()}
    for name in sorted(modules):
        module = importlib.import_module(name)
        hook = getattr(module, "warm_up", None)
        if hook is not None:
            hook()
    return {"pid": os.getpid(), "seconds": round(time.perf_counter() - t0, 3), "source_sha256": _state["source_sha256"]}


def worker_data_dir() -> str | None:
    """Service data directory as given to this worker process (None outside a pool worker)."""
    return _state.get("data_dir")


def new_cancel_flags(n: int) -> Any:
    """Shared array of `n` cancellation flags (one per job slot)."""
    return sharedctypes.RawArray("b", n)
