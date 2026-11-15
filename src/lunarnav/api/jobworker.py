"""Worker-process side of the job system.

Runs in processes started with the ``spawn`` method: no inherited SPICE state, no FastAPI import.
Each worker loads the kernels once (initializer), then runs jobs. A job function has the signature
``fn(request: dict, ctx: JobContext) -> JSON-serialisable`` and reports progress with
``ctx.progress(fraction, stage)``; that call is also the cooperative cancellation point.
"""

from __future__ import annotations

import hashlib
import importlib
import multiprocessing
import multiprocessing.sharedctypes as sharedctypes
import os
import shutil
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from lunarnav.api.json import dumps
from lunarnav.constants import HORIZON_READ_THREADS

try:
    import fcntl
except ImportError:
    fcntl = None


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
REGIONAL_THREADS = 2
COMPILED_DIR_PREFIX = "lunarnav-"
COMPILED_DIR_KEEP_S = 30 * 86400.0


def init_worker(
    progress_queue: Any, cancel_flags: Any, kinds: dict[str, KindSpec], preload: bool, data_dir: str | None = None
) -> None:
    """Pool initializer: remember the shared channels and the data directory (also exported as
    ``LUNARNAV_DATA`` so terrain and horizon caches resolve to it) and (optionally) load the SPICE kernels."""
    from lunarnav.api.versions import source_sha256

    source = source_sha256()
    _state.update(queue=progress_queue, flags=cancel_flags, kinds=kinds, data_dir=data_dir, preload=preload,
                  source_sha256=source)
    if data_dir:
        os.environ["LUNARNAV_DATA"] = data_dir
    compiled_base = os.environ.get("NUMBA_CACHE_DIR")
    compiled_dir = COMPILED_DIR_PREFIX + source[:16]
    if compiled_base and Path(compiled_base).name != compiled_dir:
        os.environ["NUMBA_CACHE_DIR"] = str(Path(compiled_base) / compiled_dir)
    configured_threads = os.environ.get("NUMBA_NUM_THREADS")
    cores = len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else os.cpu_count() or 1
    _state["threads"] = max(1, int(configured_threads)) if configured_threads else REGIONAL_THREADS
    if configured_threads is None:
        os.environ["NUMBA_NUM_THREADS"] = str(max(cores, HORIZON_READ_THREADS))
    from numba.core import config as numba_config

    numba_config.reload_config()
    if configured_threads is None:
        import numba

        try:
            numba.set_num_threads(cores)
        except ValueError:
            pass
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


def _run_warm_hooks() -> None:
    from lunarnav.ephem import load_kernels

    load_kernels()
    modules = {spec.entry.partition(":")[0] for spec in _state["kinds"].values()}
    for name in sorted(modules):
        module = importlib.import_module(name)
        hook = getattr(module, "warm_up", None)
        if hook is not None:
            hook()


def _compile_process(kinds: dict[str, KindSpec], preload: bool, data_dir: str) -> None:
    init_worker(None, None, kinds, preload, data_dir)
    _run_warm_hooks()


def _compile_once() -> None:
    data_dir = _state.get("data_dir")
    if not data_dir or fcntl is None:
        return
    import numba

    package = Path(__file__).resolve().parents[1]
    newest = max(f.stat().st_mtime_ns for f in package.rglob("*.py"))
    version = (_state["source_sha256"], newest, numba.__version__, sys.version_info[:3], numba.config.CACHE_DIR)
    stamps = Path(data_dir) / "service" / "compiled"
    stamp = stamps / hashlib.sha256(repr(version).encode()).hexdigest()[:32]
    if stamp.exists():
        return
    stamps.mkdir(parents=True, exist_ok=True)
    with open(stamps / "lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if stamp.exists():
            return
        process = multiprocessing.get_context("spawn").Process(
            target=_compile_process, args=(_state["kinds"], _state["preload"], data_dir))
        process.start()
        process.join()
        if process.exitcode != 0:
            return
        for other in stamps.iterdir():
            if other.name != "lock":
                other.unlink(missing_ok=True)
        stamp.touch()
        compiled = Path(numba.config.CACHE_DIR) if numba.config.CACHE_DIR else None
        if compiled is not None and compiled.name.startswith(COMPILED_DIR_PREFIX):
            for other in compiled.parent.glob(COMPILED_DIR_PREFIX + "*"):
                if other != compiled and other.is_dir() and time.time() - other.stat().st_mtime > COMPILED_DIR_KEEP_S:
                    shutil.rmtree(other, ignore_errors=True)


def warm_worker() -> dict[str, Any]:
    """Make this worker fast before the first real job: load the kernels, import every module that hosts a
    job kind and call its optional ``warm_up()`` (which exercises the numerical code so it is compiled)."""
    t0 = time.perf_counter()
    _compile_once()
    _run_warm_hooks()
    return {"pid": os.getpid(), "seconds": round(time.perf_counter() - t0, 3), "source_sha256": _state["source_sha256"]}


def regional_threads() -> int:
    if "threads" in _state:
        return _state["threads"]
    return max(1, int(os.environ.get("NUMBA_NUM_THREADS", REGIONAL_THREADS)))


def worker_data_dir() -> str | None:
    """Service data directory as given to this worker process (None outside a pool worker)."""
    return _state.get("data_dir")


def new_cancel_flags(n: int) -> Any:
    """Shared array of `n` cancellation flags (one per job slot)."""
    return sharedctypes.RawArray("b", n)
