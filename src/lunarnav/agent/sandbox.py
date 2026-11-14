"""Configure the Claude CLI's OS sandbox for Bash, and detect whether it can actually run on this host."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Any

from .config import AgentConfig
from .store import RunPaths

PROBE = [
    "bwrap",
    "--ro-bind",
    "/",
    "/",
    "--unshare-user",
    "--unshare-pid",
    "--unshare-net",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "unshare",
    "--user",
    "--map-root-user",
    "--pid",
    "--fork",
    "--mount-proc",
    "true",
]
"""bwrap with a nested user and pid namespace inside, which is what the CLI's seccomp helper needs."""


def probe_sandbox() -> tuple[bool, str]:
    """Return ``(available, detail)``.

    The CLI sandbox needs bubblewrap, socat, and permission to create user namespaces, including a
    namespace nested inside bubblewrap's. On Ubuntu 24.04 the AppArmor sysctl
    ``kernel.apparmor_restrict_unprivileged_userns=1`` refuses the first; the stock
    ``bwrap-userns-restrict`` profile allows the first but still refuses the nested one (the CLI then
    fails every Bash call with ``apply-seccomp: ... setgroups``). A plain ``bwrap true`` would pass
    in that case, so the probe runs the nested form. Without a working sandbox the CLI silently runs
    commands unsandboxed, which is why the harness probes for itself instead of trusting settings.
    """
    for binary in ("bwrap", "socat", "unshare"):
        if shutil.which(binary) is None:
            return False, f"{binary} is not installed"
    try:
        done = subprocess.run(PROBE, capture_output=True, text=True, timeout=10, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, f"bwrap probe failed to run: {exc}"
    if done.returncode != 0:
        return False, f"bwrap cannot create nested namespaces here: {done.stderr.strip() or done.returncode}"
    return True, "bubblewrap and socat present; nested user and pid namespaces can be created"


def domain_patterns(domains: tuple[str, ...]) -> list[str]:
    """Sandbox proxy patterns for the allowlist: each domain and all of its subdomains."""
    patterns: list[str] = []
    for domain in domains:
        patterns += [domain, f"*.{domain}"]
    return patterns


def network_settings(domains: tuple[str, ...] | None) -> dict[str, Any]:
    """The CLI's ``network`` settings: the domain list, or no list at all for unrestricted egress.

    The CLI rejects a bare ``*`` (and ``*.com``) in ``allowedDomains`` as too broad, so no wildcard admits every
    host. With no list, the sandbox proxy asks the host application before each connection to an unlisted host
    (observed: a ``can_use_tool`` call named ``SandboxNetworkAccess`` with ``{"host": ...}``); the policy answers
    it (`PermissionPolicy._sandbox_network`), allowing every host. Anything that does not answer allows nothing.
    """
    if domains is None:
        return {}
    return {"allowedDomains": domain_patterns(domains)}


def interpreter_roots(python: Path) -> list[Path]:
    """Install directories on the symlink chain from ``python`` to the real interpreter.

    The sandbox hides the home directory, and a symlink is only followed when every hop is visible, so
    each hop's installation directory (for uv: ``cpython-3.14-...`` then ``cpython-3.14.6-...``) must be
    allowed, not only the final one.
    """
    roots: list[Path] = []
    current = python.absolute()
    for _ in range(16):
        if not current.is_symlink():
            break
        current = (current.parent / current.readlink()).absolute()
        roots.append(current.parent.parent)
    roots.append(current.resolve().parent.parent)
    return roots


def filesystem_rules(config: AgentConfig, paths: RunPaths) -> dict[str, list[str]]:
    """Sandbox filesystem rules for Bash.

    Reads: the home directory, the repository root and the runs directory are denied (they hold
    credentials, other projects, other runs and this CLI's own login); then the listed directories are
    re-allowed: the project interpreter's environment, ``src/``, ``docs/``, the configured ``data/``
    subdirectories, this run's ``workspace/`` and this run's ``state/`` (read-only). System directories
    such as ``/usr`` and ``/etc`` stay readable. Writes: the workspace only; everything else, including
    ``state/``, ``src/`` and ``data/``, is read-only (``/tmp`` included, except the CLI's own ``TMPDIR``,
    ``/tmp/claude-<uid>``, which is bound writable by the CLI). The host ``/tmp`` stays *readable*: the CLI's own
    proxy sockets live there and a read-deny made the allowlisted-host probe fail (observed), so it is a residual
    risk, pinned by the ``sandbox-check`` probe "host /tmp is readable (documented residual risk)".
    """
    readable = [
        config.python_path.parent.parent,
        *interpreter_roots(config.python_path),
        *config.readable_roots,
        *config.data_read_dirs,
        paths.workspace,
        paths.state,
    ]
    denied = {Path.home(), config.repo_root.resolve(), config.runs_dir}
    return {
        "denyRead": sorted(str(p) for p in denied),
        "allowRead": sorted({str(p) for p in readable}),
        "allowWrite": [str(paths.workspace)],
    }


def sandbox_settings(
    mode: str, config: AgentConfig, paths: RunPaths
) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    """Resolve the sandbox mode (``require``, ``auto``, ``off``) into CLI settings and a status record."""
    if mode not in {"auto", "off", "require"}:
        raise ValueError(f"sandbox must be auto, off or require, not {mode!r}")
    if mode == "off":
        return None, {
            "mode": mode,
            "available": None,
            "enabled": False,
            "detail": "disabled by configuration",
        }
    available, detail = probe_sandbox()
    if not available:
        if mode == "require":
            raise RuntimeError(f"sandbox required but unavailable: {detail}")
        return None, {"mode": mode, "available": False, "enabled": False, "detail": detail}
    rules = filesystem_rules(config, paths)
    settings: dict[str, Any] = {
        "enabled": True,
        "autoAllowBashIfSandboxed": False,
        "allowUnsandboxedCommands": False,
        "network": network_settings(config.allowed_domains),
        "filesystem": rules,
    }
    status = {
        "mode": mode,
        "available": True,
        "enabled": True,
        "detail": detail,
        "network_allowed_domains": settings["network"].get("allowedDomains"),
        "filesystem": rules,
    }
    return settings, status
