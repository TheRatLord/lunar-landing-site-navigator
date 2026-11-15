"""Service settings, read once from the environment with safe defaults.

The service is a single-trusted-operator tool: the agent endpoints start a model that writes and runs
Python. It therefore binds to the loopback interface only, and refuses any other address unless
``LUNARNAV_API_ALLOW_REMOTE=1`` is set explicitly.
"""

from __future__ import annotations

import ipaddress
import os
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

from lunarnav.agent.config import find_repo_root

LOOPBACK_NAMES = frozenset({"localhost", "127.0.0.1", "::1"})


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default).strip() or default


def _env_bool(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, lo: int, hi: int) -> int:
    raw = os.environ.get(name)
    value = default if raw is None or not raw.strip() else int(raw)
    if not lo <= value <= hi:
        raise ValueError(f"{name}={value} outside [{lo}, {hi}]")
    return value


def is_loopback(host: str) -> bool:
    """True for ``localhost`` and loopback IP literals (127.0.0.0/8, ::1)."""
    if host in LOOPBACK_NAMES:
        return True
    try:
        return ipaddress.ip_address(host.strip("[]")).is_loopback
    except ValueError:
        return False


def _positive(raw: str | None, default: float) -> float:
    """A positive number from the environment; unset keeps `default`."""
    if not raw:
        return default
    value = float(raw)
    if value <= 0:
        raise ValueError("LUNARNAV_API_AGENT_BUDGET_CEILING_USD must be > 0")
    return value


def _budget(raw: str | None, default: float | None) -> float | None:
    """Per-run spend limit from the environment: unset keeps `default`; 0 means no limit."""
    if not raw:
        return default
    value = float(raw)
    if value < 0:
        raise ValueError("LUNARNAV_API_AGENT_MAX_BUDGET_USD must be >= 0 (0 = no limit)")
    return value or None


def _total_budget(raw: str | None) -> float | None:
    if not raw or not raw.strip():
        return None
    value = float(raw)
    if value < 0:
        raise ValueError("LUNARNAV_API_AGENT_TOTAL_BUDGET_USD must be >= 0 (0 = no limit)")
    return value or None


@dataclass(frozen=True, slots=True)
class Settings:
    """Everything that configures one service process.

    Attributes:
        repo_root: Repository root (docs, web/dist).
        data_dir: ``$LUNARNAV_DATA`` or ``<repo>/data``; the service keeps its own files under
            ``<data_dir>/service``.
        host, port: Bind address. Loopback only unless `allow_remote`.
        allow_remote: Permit a non-loopback bind and non-local ``Host`` headers.
        cors_origins: Browser origins other than the service's own that may read the API and change state through it. Empty by
            default: the built interface is served by the service (same origin) and the Vite dev server proxies `/api`.
        job_workers: Processes in the compute pool (each loads the kernels once).
        job_queue_max: Jobs that may wait for a worker before submissions get HTTP 429.
        job_reserved_workers: Workers that long jobs (`KindSpec.long`) may never occupy, so short analyses always find one.
            Long jobs may hold `job_workers - job_reserved_workers` workers, but at least one: with one worker there is no
            reservation.
        job_history_max: Finished job records kept in memory (results stay in the disk cache).
        cache_max_bytes: Size bound of the on-disk result cache; oldest files are pruned first.
        inline_max_points: Largest series computed inline; larger requests must be submitted as jobs.
        job_max_points: Largest series a job may return.
        sse_ping_s: Keep-alive comment interval on event streams.
        agent_enabled: Serve the agent endpoints (``LUNARNAV_API_AGENT_ENABLED=1``); off by default, and every agent
            endpoint answers 404 while off.
        agent_runs_dir: Override of the agent's runs directory (default from `AgentConfig`).
        agent_sandbox: Harness sandbox mode override (auto, off, require); None keeps the harness default.
        max_body_bytes: Largest JSON request body accepted (inbox uploads have their own limits).
        agent_max_budget_usd: Spend limit passed to every agent run (default 5.00 USD); None means no limit.
        agent_budget_ceiling_usd: Largest per-run cap a client may ask for (`budget_usd` of a run); the default cap
            is `agent_max_budget_usd`.
        agent_max_live: Agent sessions kept connected at once; idle ones are closed LRU and resumed on demand.
        web_dist: Built web interface served at ``/`` when it exists.
        preload_kernels: Load SPICE kernels in the engine thread and pool workers at start.
        warm_workers: Warm every pool worker in the background at start (imports, kernels, a tiny evaluation so the
            numerical kernels are compiled); `/health` reports readiness.
        export_cache_max_bytes: Byte budget of `<service>/exports` (oldest export first, never one being served).
        inbox_max_bytes: Total size of one agent run's inbox; an upload that would exceed it is refused (413), never pruned.
        tile_cache_max_bytes: Byte budget of `<service>/tiles` and `<service>/patches` each (oldest first).
    """

    repo_root: Path
    data_dir: Path
    host: str = "127.0.0.1"
    port: int = 8000
    allow_remote: bool = False
    cors_origins: tuple[str, ...] = ()
    job_workers: int = 2
    job_queue_max: int = 32
    job_reserved_workers: int = 1
    job_history_max: int = 256
    cache_max_bytes: int = 2 * 1024**3
    inline_max_points: int = 100_000
    job_max_points: int = 500_000
    sse_ping_s: float = 15.0
    agent_enabled: bool = False
    agent_codes: tuple[str, ...] = ()
    agent_total_budget_usd: float | None = None
    agent_runs_dir: Path | None = None
    agent_max_live: int = 4
    agent_budget_ceiling_usd: float = 25.0
    agent_sandbox: str | None = None
    agent_max_budget_usd: float | None = 5.0
    max_body_bytes: int = 16 * 1024**2
    web_dist: Path | None = None
    preload_kernels: bool = True
    warm_workers: bool = True
    export_cache_max_bytes: int = 1024**3
    tile_cache_max_bytes: int = 1024**3
    inbox_max_bytes: int = 4 * 1024**3
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def service_dir(self) -> Path:
        """Directory owned by the service: database and result cache."""
        return self.data_dir / "service"

    @property
    def cache_dir(self) -> Path:
        """Job result cache (content-addressed JSON files)."""
        return self.service_dir / "cache"

    @property
    def db_path(self) -> Path:
        """SQLite document store."""
        return self.service_dir / "documents.sqlite3"

    @property
    def docs_dir(self) -> Path:
        """Repository ``docs/`` (evidence documents)."""
        return self.repo_root / "docs"

    def with_overrides(self, **changes: Any) -> Settings:
        """Copy with some fields replaced."""
        return replace(self, **changes)

    def check_bind(self) -> None:
        """Raise `PermissionError` when binding `host` would expose the service beyond this machine, or when
        `allow_remote` is set without an explicit list of allowed origins."""
        if self.allow_remote and not self.cors_origins:
            raise PermissionError(
                "refusing to start with allow_remote and no allowed origins: off this machine the Host header is "
                "chosen by the caller, so the browser same-origin check has nothing to compare with. List the "
                "origin(s) of your interface in LUNARNAV_API_CORS_ORIGINS (comma separated)."
            )
        if not self.allow_remote and not is_loopback(self.host):
            raise PermissionError(
                f"refusing to bind {self.host!r}: the agent endpoints run code, so the service is for a "
                "single trusted operator on this machine. Set LUNARNAV_API_ALLOW_REMOTE=1 (or pass "
                "--allow-remote) only behind your own authentication and isolation."
            )

    @classmethod
    def from_env(cls) -> Settings:
        """Read ``LUNARNAV_*`` environment variables."""
        repo = find_repo_root()
        data_env = os.environ.get("LUNARNAV_DATA")
        data_dir = Path(data_env) if data_env else repo / "data"
        origins = os.environ.get("LUNARNAV_API_CORS_ORIGINS")
        dist_env = os.environ.get("LUNARNAV_WEB_DIST")
        runs_env = os.environ.get("LUNARNAV_AGENT_RUNS_DIR")
        defaults = cls(repo_root=repo, data_dir=data_dir)
        return cls(
            repo_root=repo,
            data_dir=data_dir,
            host=_env("LUNARNAV_API_HOST", defaults.host),
            port=_env_int("LUNARNAV_API_PORT", defaults.port, 1, 65535),
            allow_remote=_env_bool("LUNARNAV_API_ALLOW_REMOTE"),
            cors_origins=(
                tuple(o.strip() for o in origins.split(",") if o.strip())
                if origins is not None
                else defaults.cors_origins
            ),
            job_workers=_env_int("LUNARNAV_API_JOB_WORKERS", defaults.job_workers, 1, 8),
            job_queue_max=_env_int("LUNARNAV_API_JOB_QUEUE_MAX", defaults.job_queue_max, 1, 1000),
            job_reserved_workers=_env_int("LUNARNAV_API_JOB_RESERVED_WORKERS", defaults.job_reserved_workers, 0, 7),
            cache_max_bytes=_env_int("LUNARNAV_API_CACHE_MAX_MB", 2048, 16, 1_000_000) * 1024**2,
            agent_enabled=_env_bool("LUNARNAV_API_AGENT_ENABLED"),
            agent_total_budget_usd=_total_budget(os.environ.get("LUNARNAV_API_AGENT_TOTAL_BUDGET_USD")),
            agent_codes=tuple(c.strip() for c in os.environ.get("LUNARNAV_API_AGENT_CODES", "").split(",") if c.strip()),
            agent_runs_dir=Path(runs_env) if runs_env else None,
            agent_budget_ceiling_usd=_positive(os.environ.get("LUNARNAV_API_AGENT_BUDGET_CEILING_USD"), defaults.agent_budget_ceiling_usd),
            agent_max_live=_env_int("LUNARNAV_API_AGENT_MAX_LIVE", defaults.agent_max_live, 1, 32),
            agent_sandbox=os.environ.get("LUNARNAV_API_AGENT_SANDBOX") or None,
            max_body_bytes=_env_int("LUNARNAV_API_MAX_BODY_MB", 16, 1, 1024) * 1024**2,
            agent_max_budget_usd=_budget(os.environ.get("LUNARNAV_API_AGENT_MAX_BUDGET_USD"), defaults.agent_max_budget_usd),
            web_dist=Path(dist_env) if dist_env else repo / "web" / "dist",
            preload_kernels=not _env_bool("LUNARNAV_API_NO_PRELOAD"),
            warm_workers=not _env_bool("LUNARNAV_API_NO_WARM"),
            export_cache_max_bytes=_env_int("LUNARNAV_API_EXPORT_MAX_MB", 1024, 1, 1_000_000) * 1024**2,
            tile_cache_max_bytes=_env_int("LUNARNAV_API_TILE_CACHE_MAX_MB", 1024, 1, 1_000_000) * 1024**2,
            inbox_max_bytes=_env_int("LUNARNAV_API_INBOX_MAX_MB", 4096, 1, 10_000_000) * 1024**2,
        )
