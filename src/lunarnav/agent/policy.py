"""Permission policy: what the agent may read, write and run.

`PermissionPolicy.decide` is a pure function of ``(tool name, tool input)`` and the policy's ``sandboxed`` flag; the
session wires it into the SDK twice (a ``PreToolUse`` hook and the ``can_use_tool`` callback), so a refusal never
depends on one layer alone. Default is deny.

Where the boundaries are: Bash runs inside the OS sandbox (`lunarnav.agent.sandbox`), which confines writes to the
run workspace and hides the home directory, other runs and the harness ledgers, whatever the command line says. Read,
Glob, Grep, Write and Edit run in the CLI process *outside* that sandbox, so their paths are checked here.

Allowed:
    * Read / Glob / Grep inside the workspace, the run's read-only ``state/`` and the repository's ``src/`` and
      ``docs/``.
    * Write / Edit inside the workspace (never ``state/``).
    * Bash, any command line, when the OS sandbox is active. Without it Bash is denied entirely.
    * WebSearch, WebFetch (any host unless the operator set a domain list, then only those; WebSearch is denied
      then, since a search cannot be confined to a list), Agent / Task (subagents), TodoWrite, BashOutput, KillShell.
    * The registered MCP engine tools.
Everything else (Skill, NotebookEdit, any MCP tool not registered) is denied.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .allowlist import HostAllowlist, UrlNotAllowed, internal_host
from .config import AgentConfig
from .fsafe import resolve_under

FILE_TOOLS = ("Read", "Write", "Edit", "Glob", "Grep")
SHELL_TOOLS = ("Bash", "BashOutput", "KillShell")
WEB_TOOLS = ("WebSearch", "WebFetch")
HELPER_TOOLS = ("Agent", "Task", "TodoWrite")

BUILTIN_TOOLS = (*FILE_TOOLS, *SHELL_TOOLS, *WEB_TOOLS, *HELPER_TOOLS)
"""Built-in CLI tools made available to the model; all others do not exist for it."""
DENIED_BUILTINS = ("Skill", "NotebookEdit")


@dataclass(frozen=True, slots=True)
class Decision:
    """Outcome of a policy check."""

    allowed: bool
    reason: str = ""
    rule: str = ""


ALLOW = Decision(True)


def _resolve_under_any(roots: tuple[Path, ...], candidate: str, base: Path) -> Path | None:
    for root in roots:
        found = resolve_under(root, candidate, base)
        if found is not None:
            return found
    return None


def deny(rule: str, reason: str) -> Decision:
    """Build a denying `Decision`."""
    return Decision(False, reason, rule)


class PermissionPolicy:
    """Decides tool calls for one run."""

    def __init__(
        self, workspace: Path, config: AgentConfig, engine_tools: frozenset[str] = frozenset()
    ) -> None:
        self.workspace = workspace.resolve()
        self.config = config
        self.engine_tools = engine_tools
        self.state = self.workspace.parent / "state"
        self.read_roots = (self.workspace, self.state, *config.readable_roots)
        self.python = config.python_path
        self.sandboxed = False
        """Whether the OS sandbox is confirmed active for Bash. The session sets it once the sandbox status is known;
        until then (and whenever the sandbox is off or unavailable) Bash is denied."""


    def decide(self, name: str, tool_input: dict[str, Any]) -> Decision:
        """Allow or deny one tool call."""
        if name in self.engine_tools:
            return ALLOW
        if name in ("Read", "NotebookRead"):
            return self._file_in(tool_input.get("file_path"), self.read_roots, "read-outside-allowed", "read")
        if name in ("Write", "Edit", "MultiEdit"):
            return self._file_in(tool_input.get("file_path"), (self.workspace,), "write-outside-workspace", "write")
        if name == "Glob":
            return self._glob(tool_input)
        if name == "Grep":
            return self._file_in(
                tool_input.get("path") or str(self.workspace),
                self.read_roots,
                "read-outside-allowed",
                "search",
            )
        if name == "Bash":
            return self._bash(tool_input)
        if name in ("BashOutput", "KillShell", *HELPER_TOOLS):
            return ALLOW
        if name == "SandboxNetworkAccess":
            return self._sandbox_network(tool_input)
        if name in WEB_TOOLS:
            return self._web(name, tool_input)
        return deny("tool-not-allowed", f"tool {name!r} is not available in this environment")

    def describe(self) -> dict[str, Any]:
        """Summary of the policy for the run-start event and the instructions view."""
        domains = self.config.allowed_domains
        return {
            "default": "deny",
            "read": [str(p) for p in self.read_roots],
            "write": [str(self.workspace)],
            "state_read_only": str(self.state),
            "bash": {
                "python": str(self.python),
                "commands": "any command line (pipes, redirection, substitution, background jobs, any installed program)",
                "boundary": "the OS sandbox: writes only inside the workspace, state/ read-only, home directory, "
                "other runs and the ledgers hidden",
                "requires_sandbox": "Bash is denied when the OS sandbox is off or unavailable",
                "sandbox_active": self.sandboxed,
            },
            "network": "any https host except private, loopback and link-local addresses (fetch_data, WebFetch, WebSearch, and sandboxed commands)"
            if domains is None
            else "only these domains and their subdomains (fetch_data, WebFetch, sandboxed commands; no WebSearch): "
            + ", ".join(domains),
            "builtin_tools": list(BUILTIN_TOOLS),
            "subagents": "Agent / Task allowed; their tool calls pass through this same policy",
            "denied": list(DENIED_BUILTINS),
            "engine_tools": sorted(self.engine_tools),
        }


    def _file_in(self, value: Any, roots: tuple[Path, ...], rule: str, verb: str) -> Decision:
        if not isinstance(value, str) or not value:
            return deny("bad-input", f"{verb}: a path is required")
        found = None if value.startswith("~") else _resolve_under_any(roots, value, self.workspace)
        if found is None:
            where = "the workspace" if len(roots) == 1 else "the workspace, its state/ directory, src/ and docs/"
            return deny(rule, f"cannot {verb} {value!r}: only paths inside {where} are permitted")
        return ALLOW

    def _glob(self, tool_input: dict[str, Any]) -> Decision:
        base = tool_input.get("path") or str(self.workspace)
        decision = self._file_in(base, self.read_roots, "read-outside-allowed", "search")
        if not decision.allowed:
            return decision
        pattern = tool_input.get("pattern")
        if not isinstance(pattern, str) or not pattern:
            return deny("bad-input", "glob: a pattern is required")
        if not self._pattern_in(pattern):
            return deny(
                "read-outside-allowed", f"glob pattern {pattern!r} reaches outside the permitted directories"
            )
        return ALLOW

    def _pattern_in(self, pattern: str) -> bool:
        """Whether a glob pattern's fixed prefix lies inside the readable roots (and has no ``..`` or ``~``)."""
        if pattern.startswith("~") or ".." in Path(pattern).parts:
            return False
        static = pattern
        for ch in "*?[":
            static = static.split(ch)[0]
        if static != pattern:
            static = static.rsplit("/", 1)[0] if "/" in static else ""
        if static == "" and not pattern.startswith("/"):
            return True
        return _resolve_under_any(self.read_roots, static or "/", self.workspace) is not None


    def _bash(self, tool_input: dict[str, Any]) -> Decision:
        command = tool_input.get("command")
        if not isinstance(command, str) or not command.strip():
            return deny("bad-input", "bash: a command is required")
        if tool_input.get("dangerouslyDisableSandbox"):
            return deny("bash-unsandboxed", "running outside the sandbox is not allowed")
        if not self.sandboxed:
            return deny("bash-needs-sandbox", "Bash is not available: the OS sandbox is not active in this run")
        return ALLOW

    def _web(self, name: str, tool_input: dict[str, Any]) -> Decision:
        domains = self.config.allowed_domains
        if domains is None:
            return ALLOW
        if name == "WebSearch":
            return deny("web-search-restricted", "WebSearch is unavailable: network access is limited to a domain list")
        url = tool_input.get("url")
        if not isinstance(url, str) or not url:
            return deny("bad-input", "WebFetch: a url is required")
        try:
            HostAllowlist(domains, self.config.allow_http).check(url)
        except UrlNotAllowed as exc:
            return deny("web-host-not-allowed", f"WebFetch refused: {exc}")
        return ALLOW

    def _sandbox_network(self, tool_input: dict[str, Any]) -> Decision:
        """The sandbox proxy asks (as a tool call named ``SandboxNetworkAccess``) before it connects to a host that is
        not on its ``allowedDomains`` list. A host that resolves to a private, loopback or link-local address (this
        machine's services, the cloud metadata server) is always refused. Otherwise, with no list configured every
        host is asked about and allowed; with a list, a host outside it is refused."""
        domains = self.config.allowed_domains
        host = str(tool_input.get("host") or "").rstrip(".").lower()
        if internal_host(host):
            return deny("network-host-internal", f"{host or 'that host'} is a private, loopback or link-local address")
        if domains is None:
            return ALLOW
        if host and HostAllowlist(domains).admits(host):
            return ALLOW
        return deny("network-host-not-allowed", f"{host or 'that host'} is not on the operator's domain list")
