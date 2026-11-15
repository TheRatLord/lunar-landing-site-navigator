"""Agent harness configuration: paths, model, limits and the optional data-host allowlist."""

from __future__ import annotations

import json
import os
import shlex
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

import yaml

PROMPT_VERSION = "system_v9"
"""Name of the packaged system prompt (``prompts/<name>.md``) used by default."""

DEFAULT_MODEL = "claude-sonnet-5-5"
"""Explicit model id. Never left to the CLI default, which follows the user's personal settings."""


def normalize_domains(value: Any) -> tuple[str, ...] | None:
    """Domain restriction from a config value: none, empty, ``*``, ``any`` or ``unrestricted`` mean any host.

    Accepts a list or a comma-separated string; entries are lowercased and stripped of dots and spaces.
    """
    if value is None:
        return None
    items = value.split(",") if isinstance(value, str) else list(value)
    domains = tuple(d for d in (str(i).strip().lower().strip(".") for i in items) if d)
    if not domains or domains in {("*",), ("any",), ("unrestricted",)}:
        return None
    if "*" in domains:
        raise ValueError("allowed_domains: '*' cannot be mixed with domain names; leave the list out for any host")
    return domains


ENV_CONFIG_FILE = "LUNARNAV_AGENT_CONFIG"
ENV_ALLOWED_DOMAINS = "LUNARNAV_AGENT_ALLOWED_DOMAINS"
ENV_API_KEY_FILE = "LUNARNAV_AGENT_API_KEY_FILE"


def find_repo_root(start: Path | None = None) -> Path:
    """Locate the repository root (the directory holding ``pyproject.toml`` and ``src/lunarnav``)."""
    here = (start or Path(__file__)).resolve()
    for parent in [here, *here.parents]:
        if (parent / "pyproject.toml").is_file() and (parent / "src" / "lunarnav").is_dir():
            return parent
    raise RuntimeError(f"cannot find the repository root above {here}")


@dataclass(frozen=True, slots=True)
class AgentConfig:
    """Everything that shapes a run except the prompt text.

    Attributes:
        repo_root: Repository root; ``src/`` and ``docs/`` below it are readable by the agent.
        runs_root: Parent of the per-run directories (``data/runs`` by default).
        model: Explicit model id passed to the CLI.
        prompt_version: Packaged system prompt name.
        python: Interpreter agent code runs under; must be the project interpreter so ``import lunarnav`` works.
        allowed_domains: ``None`` (default): `fetch_data` and sandboxed commands may reach any host. A tuple
            restricts both to those domains and their subdomains (an operator sets it in YAML or the environment).
        allow_http: Permit plain ``http`` URLs. Default is HTTPS only.
        max_download_bytes: Hard per-download size limit.
        max_redirects: Redirect hops `fetch_data` follows, each re-checked against the allowlist.
        fetch_timeout_s: Network timeout per request.
        max_turns: Model turns allowed per user message (the budget cap is the spend limit).
        max_budget_usd: Optional spend limit per run (API-equivalent cost reported by the CLI).
        effort: Reasoning effort level passed to the CLI, or ``None`` for the model default.
        sandbox: ``"require"`` (default) enables the CLI Bash sandbox and refuses to start when it is
            unavailable; ``"auto"`` enables it when possible and otherwise runs without; ``"off"`` never does.
        sandbox_data_dirs: Subdirectories of ``data/`` that code run by the agent may read (never write).
        event_text_limit: Characters of a tool result stored in one event (the full digest is kept).
        max_workspace_bytes: Workspace quota. `fetch_data` refuses to add more above it, a Bash call is refused while
            the workspace is over it, and a Bash call after which it is over ends the turn with a `quota` error.
        script_file_limit_bytes: Largest single file any process started by the CLI (Bash, scripts) may write
            (`RLIMIT_FSIZE`, set by the launcher and inherited through the sandbox).
        engine_call_timeout_s: Wall-clock limit after which an engine tool call returns an error to the model.
            The computation cannot be interrupted (numeric code in a worker thread), so the run's engine
            stays busy until it ends.
        thread_cap: Threads each numeric library may use in the CLI, its shell and scripts.
        cli_env_keep: Extra environment variable names forwarded to the CLI (for example a proxy variable).
    """

    repo_root: Path = field(default_factory=find_repo_root)
    runs_root: Path | None = None
    model: str = DEFAULT_MODEL
    prompt_version: str = PROMPT_VERSION
    python: Path | None = None
    allowed_domains: tuple[str, ...] | None = None
    allow_http: bool = False
    max_download_bytes: int = 200 * 1024 * 1024
    max_redirects: int = 5
    fetch_timeout_s: float = 60.0
    max_turns: int = 500
    max_budget_usd: float | None = None
    effort: str | None = None
    sandbox: str = "require"
    sandbox_data_dirs: tuple[str, ...] = ("kernels", "dem")
    event_text_limit: int = 20_000
    max_workspace_bytes: int = 4 * 1024 * 1024 * 1024
    script_file_limit_bytes: int = 512 * 1024 * 1024
    engine_call_timeout_s: float = 900.0
    thread_cap: int = 4
    cli_env_keep: tuple[str, ...] = ()
    api_key_file: Path | None = None

    @property
    def runs_dir(self) -> Path:
        """Directory holding all run directories."""
        return (self.runs_root or self.repo_root / "data" / "runs").resolve()

    @property
    def python_path(self) -> Path:
        """Project interpreter used for agent code."""
        return (self.python or self.repo_root / ".venv" / "bin" / "python").absolute()

    @property
    def readable_roots(self) -> tuple[Path, ...]:
        """Repository directories the agent may read besides its workspace."""
        return ((self.repo_root / "src").resolve(), (self.repo_root / "docs").resolve())

    @property
    def data_read_dirs(self) -> tuple[Path, ...]:
        """Existing ``data/`` subdirectories that sandboxed code may read."""
        data = self.repo_root / "data"
        return tuple(p for p in ((data / name).resolve() for name in self.sandbox_data_dirs) if p.is_dir())

    def cli_settings(self) -> str | None:
        if self.api_key_file is None:
            return None
        return json.dumps({"apiKeyHelper": f"cat {shlex.quote(str(self.api_key_file.absolute()))}"})

    def with_overrides(self, **changes: Any) -> AgentConfig:
        """Return a copy with some fields replaced."""
        return replace(self, **changes)

    @classmethod
    def load(cls, path: Path | None = None, **overrides: Any) -> AgentConfig:
        """Build a config from defaults, an optional YAML file, and environment overrides.

        The file is ``path``, else ``$LUNARNAV_AGENT_CONFIG``. Its keys are `AgentConfig` field names.
        ``$LUNARNAV_AGENT_ALLOWED_DOMAINS`` (comma separated) replaces the domain list. Keyword
        ``overrides`` win over both.
        """
        values: dict[str, Any] = {}
        file = path or (Path(os.environ[ENV_CONFIG_FILE]) if os.environ.get(ENV_CONFIG_FILE) else None)
        if file is not None:
            loaded = yaml.safe_load(Path(file).read_text()) or {}
            if not isinstance(loaded, dict):
                raise ValueError(f"{file}: expected a mapping at top level")
            values.update(loaded)
        env_domains = os.environ.get(ENV_ALLOWED_DOMAINS)
        if env_domains:
            values["allowed_domains"] = env_domains
        env_key_file = os.environ.get(ENV_API_KEY_FILE)
        if env_key_file:
            values["api_key_file"] = env_key_file
        values.update(overrides)
        known = {f for f in cls.__dataclass_fields__}
        unknown = set(values) - known
        if unknown:
            raise ValueError(f"unknown agent config keys: {sorted(unknown)}")
        for key in ("repo_root", "runs_root", "python", "api_key_file"):
            if values.get(key) is not None:
                values[key] = Path(values[key])
        if "sandbox_data_dirs" in values:
            values["sandbox_data_dirs"] = tuple(str(d) for d in values["sandbox_data_dirs"])
        if "cli_env_keep" in values:
            values["cli_env_keep"] = tuple(str(k) for k in values["cli_env_keep"])
        if "allowed_domains" in values:
            values["allowed_domains"] = normalize_domains(values["allowed_domains"])
        return cls(**values)
