"""Versioned system prompt stored as a file in the package."""

from __future__ import annotations

import re
from dataclasses import dataclass
from importlib import resources
from pathlib import Path

from .config import AgentConfig
from .store import sha256_bytes

_NAME_RE = re.compile(r"^[a-z0-9_]+$")


@dataclass(frozen=True, slots=True)
class RenderedPrompt:
    """The exact system prompt text sent to the model.

    ``sha256`` is the hash of the rendered ``text`` (workspace paths filled in, so it differs per run);
    ``template_sha256`` is the hash of the packaged file for ``version`` and is the same for every run.
    """

    version: str
    text: str
    template_sha256: str

    @property
    def sha256(self) -> str:
        return sha256_bytes(self.text.encode())


def _template_bytes(version: str) -> bytes:
    """Bytes of the packaged prompt file; `ValueError` if ``version`` is malformed or not packaged."""
    if not _NAME_RE.match(version):
        raise ValueError(f"invalid prompt version {version!r}")
    try:
        return (resources.files("lunarnav.agent") / "prompts" / f"{version}.md").read_bytes()
    except FileNotFoundError:
        raise ValueError(f"prompt version {version!r} is not available in this release") from None


def render_prompt(config: AgentConfig, workspace: str, state: str | None = None) -> RenderedPrompt:
    """Fill the template placeholders. The result is stored verbatim in the run-start event.

    ``state`` defaults to the ``state`` directory next to ``workspace`` (the run layout of `RunPaths`).
    """
    state = state or str(Path(workspace).parent / "state")
    template = _template_bytes(config.prompt_version)
    text = template.decode("utf-8")
    for key, value in {
        "{{repo_root}}": str(config.repo_root),
        "{{workspace}}": workspace,
        "{{state}}": state,
        "{{python}}": str(config.python_path),
    }.items():
        text = text.replace(key, value)
    return RenderedPrompt(config.prompt_version, text, sha256_bytes(template))
