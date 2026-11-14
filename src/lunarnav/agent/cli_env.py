"""The environment the Claude CLI (and so sandboxed Bash and scripts) starts with.

The SDK always merges its whole parent environment into the CLI's (``{**os.environ, **options.env}``), so
variables can only be *removed* by interposing a launcher. `cli_launch` writes a small Python script
into the run's ``state/launch/`` that the SDK starts as the CLI; it rebuilds the environment from an
allowlist, sets the per-file size limit (``RLIMIT_FSIZE`` = `AgentConfig.script_file_limit_bytes`; a hard
limit, so no child can raise it, and the sandbox inherits it) and ``exec``s the real CLI. Everything else in the parent environment (API keys, cloud
credentials, tokens, ``LUNARNAV_*`` secrets) never reaches the CLI, and therefore never reaches Bash.

Forwarded from the parent, with the reason:

========================  ==========================================================================
``HOME``                  the CLI reads its subscription login from ``~/.claude`` (the sandbox hides it from Bash)
``PATH``                  finds ``bwrap``, ``socat``, ``rg`` and the shell tools (the project venv is prepended)
``LANG LC_ALL LC_CTYPE``  text encoding
``TERM TZ USER LOGNAME``  terminal capabilities, time zone, identity strings tools print
``TMPDIR``                the CLI's temp directory (``SHELL`` is not forwarded: it is pinned to ``/bin/bash``, the shell the policy parses)
``XDG_CONFIG_HOME``       the CLI's own configuration lookup
``XDG_DATA_HOME``         (same)
``XDG_STATE_HOME``        (same)
``SSL_CERT_FILE``         certificate bundle for the CLI's HTTPS
``SSL_CERT_DIR``          (same)
========================  ==========================================================================

Added from `AgentConfig.cli_env_keep` (default none) for site needs such as a proxy. ``ANTHROPIC_API_KEY``
is deliberately not forwarded: the harness uses subscription authentication only.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import claude_agent_sdk

from . import fsafe
from .config import AgentConfig
from .store import RunPaths

BASE_KEEP: tuple[str, ...] = (
    "HOME", "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TZ", "USER", "LOGNAME", "TMPDIR",
    "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "SSL_CERT_FILE", "SSL_CERT_DIR",
)
"""Parent variables forwarded to the CLI (reasons in the module docstring)."""

SDK_PREFIXES: tuple[str, ...] = ("CLAUDE_AGENT_SDK_", "CLAUDE_CODE_ENTRYPOINT")
"""Variables the SDK itself sets for the CLI."""

THREAD_VARS = (
    "OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMBA_NUM_THREADS", "NUMEXPR_NUM_THREADS",
    "VECLIB_MAXIMUM_THREADS",
)
BASH_TIMEOUT_DEFAULT_MS = 600_000
BASH_TIMEOUT_MAX_MS = 1_800_000
"""Shell-command time limits (CLI settings ``BASH_DEFAULT_TIMEOUT_MS`` and ``BASH_MAX_TIMEOUT_MS``)."""

_LAUNCHER = '''#!{python} -I
import os, resource, sys
KEEP = {keep!r}
PREFIXES = {prefixes!r}
env = {{k: v for k, v in os.environ.items() if k in KEEP or k.startswith(PREFIXES)}}
resource.setrlimit(resource.RLIMIT_FSIZE, ({fsize}, {fsize}))
os.execve({cli!r}, [{cli!r}, *sys.argv[1:]], env)
'''


def bundled_cli() -> Path:
    """The CLI binary shipped with the SDK (the one the SDK would use)."""
    path = Path(claude_agent_sdk.__file__).parent / "_bundled" / "claude"
    if not path.is_file():
        raise RuntimeError(f"the SDK's bundled CLI is missing: {path}")
    return path


ISOLATION_ENV = {
    "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1",
    "CLAUDE_CODE_DISABLE_CLAUDE_MDS": "1",
    "CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS": "1",
    "CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY": "1",
}
"""Environment that keeps the user's memory files, CLAUDE.md files and prompts out of the run."""


def _cache_env(cache: Path) -> dict[str, str]:
    """Environment that sends every cache a script might write into the run's cache directory.

    ``LUNARNAV_CACHE_DIR`` is the engine's contract; the others redirect library caches that would
    otherwise try to write into the (read-only inside the sandbox) home or source directories.
    """
    return {
        "LUNARNAV_CACHE_DIR": str(cache),
        "XDG_CACHE_HOME": str(cache / "xdg"),
        "NUMBA_CACHE_DIR": str(cache / "numba"),
        "MPLCONFIGDIR": str(cache / "matplotlib"),
        "PYTHONPYCACHEPREFIX": str(cache / "pycache"),
    }


def _explicit_env(paths: RunPaths, config: AgentConfig) -> dict[str, str]:
    """The variables the harness sets itself (they override the parent's)."""
    venv_bin = str(config.python_path.parent)
    return {
        **ISOLATION_ENV,
        "PATH": f"{venv_bin}{os.pathsep}{os.environ.get('PATH', '')}",
        **_cache_env(paths.cache),
        **{name: str(config.thread_cap) for name in THREAD_VARS},
        "SHELL": "/bin/bash",
        "BASH_DEFAULT_TIMEOUT_MS": str(BASH_TIMEOUT_DEFAULT_MS),
        "BASH_MAX_TIMEOUT_MS": str(BASH_TIMEOUT_MAX_MS),
    }


def cli_launch(paths: RunPaths, config: AgentConfig) -> tuple[dict[str, str], Path]:
    env = _explicit_env(paths, config)
    path = paths.state / "launch" / "claude"
    keep = tuple(sorted({*BASE_KEEP, *config.cli_env_keep, *env}))
    fsafe.replace(path, _LAUNCHER.format(
        python=sys.executable, keep=keep, prefixes=SDK_PREFIXES,
        fsize=config.script_file_limit_bytes, cli=str(bundled_cli())).encode(), mkdir=True, mode=0o755)
    return env, path
