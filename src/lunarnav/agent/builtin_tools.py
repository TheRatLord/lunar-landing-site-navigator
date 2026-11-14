"""Tools that exist today: `fetch_data`, `record_assumption`, `register_artifact`."""

from __future__ import annotations

import hashlib
import mimetypes
import re
from pathlib import Path
from typing import Any, BinaryIO, Literal
from urllib.parse import urljoin

import httpx
from pydantic import BaseModel, Field

from . import fsafe
from .allowlist import HostAllowlist, UrlNotAllowed
from .events import ArtifactProduced, AssumptionRecorded, utc_now
from .registry import AgentTool, ToolContext, ToolError, ToolOutput, agent_tool
from .signoff import append_assumption
from .store import JsonlLedger, sha256_file

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class FetchInput(BaseModel):
    """Arguments of `fetch_data`."""

    url: str = Field(description="HTTPS URL of the file to download.")
    dest: str = Field(
        description="Destination path relative to the workspace, for example 'data/naif0012.tls'. "
        "Parent directories are created."
    )
    expected_sha256: str | None = Field(
        default=None,
        description="If you already know the file's SHA-256 (lowercase hex), it is verified and a "
        "mismatch deletes the download.",
    )
    max_bytes: int | None = Field(
        default=None, description="Lower the size limit for this download (cannot raise the global limit)."
    )
    overwrite: bool = Field(default=False, description="Replace an existing file at dest.")
    purpose: str = Field(default="", description="One line on why this dataset is needed.")


class FetchOutput(ToolOutput):
    """Result of `fetch_data`."""

    path: str
    url: str
    final_url: str
    http_status: int
    size_bytes: int
    sha256: str
    content_type: str | None = None
    last_modified: str | None = None
    etag: str | None = None
    fetched_at: str
    sha256_verified: bool = False


@agent_tool(
    "fetch_data",
    "Download a file over HTTPS into the workspace (no host restriction unless the operator set a domain list). "
    "Enforces a size limit, re-checks every redirect hop, and returns the SHA-256 of the saved file, "
    "which is recorded in the provenance ledger. Pin the returned SHA-256 and cite the ledger id in your "
    "report. Bash scripts can also reach the network; use fetch_data when you want the download hashed and "
    "ledgered.",
    FetchInput,
    read_only=False,
)
async def fetch_data(ctx: ToolContext, args: FetchInput) -> FetchOutput:
    allow = HostAllowlist(ctx.config.allowed_domains, ctx.config.allow_http)
    workspace = ctx.paths.workspace
    parts = Path(args.dest).parts
    if not parts or Path(args.dest).is_absolute() or any(p in ("", ".", "..") for p in parts):
        raise ToolError(f"dest {args.dest!r} must be a file path inside the workspace")
    target = workspace.joinpath(*parts)
    if fsafe.lexists(target) and not args.overwrite:
        raise ToolError(f"{args.dest!r} already exists; pass overwrite=true to replace it")
    if args.expected_sha256 is not None and not SHA256_RE.match(args.expected_sha256):
        raise ToolError("expected_sha256 must be 64 lowercase hex characters")
    limit = ctx.config.max_download_bytes
    if args.max_bytes is not None:
        limit = min(limit, args.max_bytes)
    try:
        allow.check(args.url)
    except UrlNotAllowed as exc:
        raise ToolError(f"URL refused: {exc}") from exc
    limit = _quota_limit(ctx, limit)

    part = target.with_name(f".{target.name}.part")
    fsafe.remove(part)
    try:
        with fsafe.open_new(part, mkdir=True) as handle:
            response, final_url, size, digest = await _download(args.url, handle, allow, ctx, limit)
    except BaseException:
        fsafe.remove(part)
        raise
    verified = False
    if args.expected_sha256 is not None:
        if digest != args.expected_sha256:
            fsafe.remove(part)
            raise ToolError(f"SHA-256 mismatch: expected {args.expected_sha256}, downloaded {digest}")
        verified = True
    fsafe.rename_over(part, target)
    rel = "/".join(parts)
    return FetchOutput(
        path=rel,
        url=args.url,
        final_url=final_url,
        http_status=response.status_code,
        size_bytes=size,
        sha256=digest,
        content_type=response.headers.get("content-type"),
        last_modified=response.headers.get("last-modified"),
        etag=response.headers.get("etag"),
        fetched_at=utc_now(),
        sha256_verified=verified,
        data_versions={rel: f"sha256:{digest}"},
    )


def _quota_limit(ctx: ToolContext, limit: int) -> int:
    """Per-download byte limit after the workspace quota: a download may not push the workspace over its size cap."""
    try:
        held = fsafe.tree_bytes(ctx.paths.workspace)
    except fsafe.TreeTooLarge as exc:
        raise ToolError(f"download quota reached: the workspace holds too many files ({exc})") from exc
    room = ctx.config.max_workspace_bytes - held
    if room <= 0:
        raise ToolError("download quota reached: the workspace is at its maximum size")
    return min(limit, room)


async def _download(
    url: str,
    handle: BinaryIO,
    allow: HostAllowlist,
    ctx: ToolContext,
    limit: int,
) -> tuple[httpx.Response, str, int, str]:
    """Stream ``url`` into ``handle`` following allowlisted redirects. Returns response, final URL, size, digest."""
    timeout = httpx.Timeout(ctx.config.fetch_timeout_s)
    async with httpx.AsyncClient(follow_redirects=False, timeout=timeout) as client:
        current = url
        for _hop in range(ctx.config.max_redirects + 1):
            async with client.stream("GET", current, headers={"Accept-Encoding": "identity"}) as response:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise ToolError(f"redirect without Location from {current}")
                    current = urljoin(current, location)
                    try:
                        allow.check(current)
                    except UrlNotAllowed as exc:
                        raise ToolError(f"redirect target refused: {exc}") from exc
                    continue
                if response.status_code != 200:
                    raise ToolError(f"HTTP {response.status_code} from {current}")
                declared = response.headers.get("content-length")
                if declared is not None and declared.isdigit() and int(declared) > limit:
                    raise ToolError(f"Content-Length {declared} exceeds the {limit} byte limit")
                digest = hashlib.sha256()
                size = 0
                async for block in response.aiter_bytes(1 << 16):
                    size += len(block)
                    if size > limit:
                        raise ToolError(f"download exceeds the {limit} byte limit (per-download or per-run quota)")
                    digest.update(block)
                    handle.write(block)
                return response, current, size, digest.hexdigest()
        raise ToolError(f"more than {ctx.config.max_redirects} redirects")


class AssumptionInput(BaseModel):
    """Arguments of `record_assumption`."""

    statement: str = Field(description="The assumption, as a falsifiable sentence.")
    basis: str = Field(
        description="Why it is reasonable: a source, a ledger id, a document section, or 'engineering "
        "judgement' stated as such."
    )
    impact: str = Field(description="What changes in the result if the assumption is wrong.")


class AssumptionOutput(ToolOutput):
    """Result of `record_assumption`."""

    assumption_id: str
    recorded_at: str


@agent_tool(
    "record_assumption",
    "Record an assumption you made (a parameter value, a model choice, a data limitation, an input you "
    "could not verify). Every assumption behind a delivered number must be recorded here; the list is "
    "what the mission planner signs off.",
    AssumptionInput,
    read_only=False,
)
async def record_assumption(ctx: ToolContext, args: AssumptionInput) -> AssumptionOutput:
    stored = append_assumption(
        ctx.paths, statement=args.statement, basis=args.basis, impact=args.impact, needs_signoff=True)
    assumption_id, stamp = stored["assumption_id"], stored["ts"]
    ctx.emit(
        AssumptionRecorded,
        assumption_id=assumption_id,
        statement=args.statement,
        basis=args.basis,
        impact=args.impact,
        needs_signoff=True,
    )
    return AssumptionOutput(assumption_id=assumption_id, recorded_at=stamp)


class ArtifactInput(BaseModel):
    """Arguments of `register_artifact`."""

    path: str = Field(description="File path relative to the workspace (the current directory of Bash and scripts).")
    kind: Literal["script", "figure", "table", "report", "data", "other"] = Field(
        description="What the file is."
    )
    description: str = Field(description="What the file contains and how it was produced.")


class ArtifactOutput(ToolOutput):
    """Result of `register_artifact`."""

    artifact_id: str
    version: int
    path: str
    size_bytes: int
    sha256: str


@agent_tool(
    "register_artifact",
    "Declare a file you produced as a deliverable (the rerunnable script, a figure, a table, the "
    "report). The file is hashed now; the interface lists and serves registered artifacts. Register a "
    "file again after changing it to record the new version.",
    ArtifactInput,
    read_only=False,
)
async def register_artifact(ctx: ToolContext, args: ArtifactInput) -> ArtifactOutput:
    stored = register_file(ctx, args.path, args.kind, args.description)
    return ArtifactOutput(
        artifact_id=stored["artifact_id"], version=stored["version"], path=stored["path"],
        size_bytes=stored["size_bytes"], sha256=stored["sha256"])


def register_file(ctx: ToolContext, path: str, kind: str, description: str) -> dict[str, Any]:
    """Hash a file, record it in the artifact ledger (new version if known) and emit the event.

    ``path`` is workspace-relative, or starts with ``state/exports/`` or ``state/results/`` (harness-written
    files; the model never names those). The stored path is relative to the run root. Links are refused.
    Used by ``register_artifact`` and by engine tools that write exports. Returns the stored entry.
    """
    parts = Path(path).parts
    relative = path if parts[:1] == ("state",) else "/".join(("workspace", *parts))
    resolved = ctx.paths.artifact_file(relative)
    if resolved is None:
        raise ToolError(f"{path!r} is not an existing regular file inside the workspace (links are not followed)")
    digest = sha256_file(resolved)
    size = fsafe.size(resolved)
    ledger = JsonlLedger(ctx.paths.artifacts)
    previous = [e for e in ledger.entries() if e["path"] == relative]
    if previous:
        artifact_id, version = previous[0]["artifact_id"], previous[-1]["version"] + 1
    else:
        artifact_id = _artifact_id(ledger)
        version = 1
    stored = ledger.append(
        {
            "artifact_id": artifact_id,
            "version": version,
            "ts": utc_now(),
            "path": relative,
            "kind": kind,
            "description": description,
            "size_bytes": size,
            "sha256": digest,
            "mime": mimetypes.guess_type(relative)[0] or "application/octet-stream",
        }
    )
    ctx.emit(
        ArtifactProduced,
        artifact_id=artifact_id,
        version=version,
        path=relative,
        kind=kind,
        description=description,
        size_bytes=size,
        sha256=digest,
    )
    return stored


def _artifact_id(ledger: JsonlLedger) -> str:
    return f"F{len({e['artifact_id'] for e in ledger.entries()}) + 1:03d}"


def builtin_tools() -> list[AgentTool]:
    """The tools that exist today, in the order the model sees them."""
    return [fetch_data, record_assumption, register_artifact]
