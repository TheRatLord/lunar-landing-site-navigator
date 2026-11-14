"""Evidence: the validation reports and research documents under ``docs/`` and their images."""

from __future__ import annotations

import asyncio
import io
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, BinaryIO

from fastapi import APIRouter, Depends
from fastapi.responses import Response

from lunarnav.agent import fsafe
from lunarnav.agent.fsafe import resolve_under
from lunarnav.api.context import ServiceContext, get_ctx
from lunarnav.api.errors import PROBLEM_RESPONSES, ApiProblem
from lunarnav.api.schemas import EvidenceDoc

router = APIRouter(tags=["evidence"], responses={404: PROBLEM_RESPONSES[404]})
Ctx = Annotated[ServiceContext, Depends(get_ctx)]

SECTIONS = ("validation", "research")
ASSET_TYPES = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".webp": "image/webp", ".svg": "image/svg+xml",
}
"""Only these extensions are served as assets."""
MAX_ASSET_BYTES = 32 * 1024 * 1024
MAX_DOC_BYTES = 8 * 1024 * 1024


def _read(file: Path, limit: int) -> bytes | None:
    """The bytes of a regular file under `docs/` opened without following links (the path was resolved by `resolve_under`
    from a request, so a link swapped in after the check is refused here); None if it is not one or is too large."""
    try:
        return fsafe.read_bytes(file, limit)
    except OSError:
        return None


def _title(handle: BinaryIO, stem: str) -> str:
    for raw in io.TextIOWrapper(handle, encoding="utf-8", errors="replace"):
        if raw.startswith("# "):
            return raw[2:].strip()
    return stem


def _documents(docs: Path) -> list[EvidenceDoc]:
    """The markdown documents of `SECTIONS`. A link, pipe or other special file named `*.md` is skipped: each file is
    opened with `fsafe.open_read` (a pipe would block a plain `open`) and sized from that handle."""
    docs = docs.resolve()
    out: list[EvidenceDoc] = []
    for section in SECTIONS:
        for p in sorted((docs / section).rglob("*.md")):
            try:
                handle = fsafe.open_read(p)
            except OSError:
                continue
            with handle:
                st = os.fstat(handle.fileno())
                title = _title(handle, p.stem)
            rel = p.relative_to(docs)
            out.append(
                EvidenceDoc(
                    id=str(rel.with_suffix("")),
                    title=title,
                    path=f"docs/{rel}",
                    kind=section,  # type: ignore[arg-type]
                    modified_utc=datetime.fromtimestamp(st.st_mtime, UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                    size_bytes=st.st_size,
                )
            )
    return out


@router.get("/evidence", response_model=list[EvidenceDoc], summary="Validation and research documents")
async def list_evidence(ctx: Ctx) -> list[EvidenceDoc]:
    """Markdown documents under docs/validation and docs/research with title (first heading), size and mtime."""
    return await asyncio.to_thread(_documents, ctx.settings.docs_dir)


@router.get(
    "/evidence/assets/{path:path}",
    summary="Image referenced by an evidence document",
    response_class=Response,
    responses={200: {"content": {"image/*": {}}}},
)
async def evidence_asset(path: str, ctx: Ctx) -> Response:
    """Images under docs/validation/img and docs/research only. `path` is relative to docs/ (a leading
    `docs/` is accepted)."""
    docs = ctx.settings.docs_dir
    rel = path.removeprefix("docs/")
    roots = [docs / "validation" / "img", docs / "research"]
    file = next((f for r in roots if (f := resolve_under(r, docs / rel)) is not None), None)
    media = ASSET_TYPES.get(Path(rel).suffix.lower())
    data = None if file is None or media is None else await asyncio.to_thread(_read, file, MAX_ASSET_BYTES)
    if data is None:
        raise ApiProblem(404, "Asset not found", f"No evidence asset {path!r}.")
    return Response(data, media_type=media, headers={"X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox"})


@router.get(
    "/evidence/{doc_id:path}",
    summary="Raw markdown of one document",
    response_class=Response,
    responses={200: {"content": {"text/markdown": {}}}},
)
async def evidence_doc(doc_id: str, ctx: Ctx) -> Response:
    """`doc_id` is the id from the list, e.g. ``validation/visibility``."""
    section = doc_id.split("/", 1)[0]
    root = ctx.settings.docs_dir / section if section in SECTIONS else None
    file = resolve_under(root, ctx.settings.docs_dir / f"{doc_id}.md") if root is not None else None
    data = None if file is None else await asyncio.to_thread(_read, file, MAX_DOC_BYTES)
    if data is None:
        raise ApiProblem(404, "Document not found", f"No evidence document {doc_id!r}.")
    return Response(data.decode("utf-8", errors="replace"), media_type="text/markdown; charset=utf-8")
