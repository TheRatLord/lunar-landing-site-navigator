"""The run inbox: user-supplied files (DEMs, trajectories, documents) in ``state/inbox/``.

Only the upload route and the CLI put files here (`save_inbox_file`, `save_inbox_path`); the sandbox sees
``state/`` read-only and the policy refuses every write and shell destination there, so the model cannot add
or replace a file. Names are sanitised, extensions allowlisted and the content sniffed so a file claiming to
be a GeoTIFF really starts like one; the ingest tools validate further. A SHA-256 sidecar written at save
time makes `list_inbox` cheap on large files. Tools reach a file only through `resolve_inbox_file`, which
accepts a bare name that is a regular file inside ``state/inbox`` with no link in any component.
"""

from __future__ import annotations

import hashlib
import re
import threading
import uuid
from pathlib import Path
from typing import Any

from . import fsafe
from .store import RunPaths

TEXT_EXTENSIONS = frozenset({".txt", ".md", ".csv", ".json", ".oem", ".xml"})
BINARY_MAGIC: dict[str, tuple[bytes, ...]] = {
    ".tif": (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+"),
    ".tiff": (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+"),
    ".pdf": (b"%PDF-",),
    ".bsp": (b"DAF/SPK",),
}
ALLOWED_EXTENSIONS = TEXT_EXTENSIONS | frozenset(BINARY_MAGIC)
MAX_INBOX_BYTES = 1 << 30
"""Largest accepted inbox file (1 GiB)."""
_BAD_CHARS = re.compile(r"[^A-Za-z0-9._-]+")
_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
_LOCK = threading.Lock()


class InboxError(ValueError):
    """A file was refused entry to the inbox; the message says why."""


def safe_name(filename: str) -> str:
    """Base name restricted to ``[A-Za-z0-9._-]`` that always matches the listing pattern (`_NAME_RE`).

    The stem starts with a letter or digit (leading dots, underscores and hyphens are dropped; a stem with
    nothing usable left, such as ``é.txt``, becomes ``upload``), at most 100 characters; the extension is kept
    whole. Refuses empty names, names that are only an extension (``.txt``) and extension-less names.
    """
    base = filename.replace("\\", "/").rsplit("/", 1)[-1].strip()
    if "." not in base.lstrip("."):
        raise InboxError(f"{filename!r} is not an acceptable file name")
    stem, _, ext = _BAD_CHARS.sub("_", base.lstrip(".")).rpartition(".")
    stem = stem.lstrip("._-")[:100].rstrip(".") or "upload"
    return f"{stem}.{ext[:16]}"


def spool_path(paths: RunPaths) -> Path:
    """A fresh, unused path under ``state/spool`` for staging an upload (create it with `fsafe.open_new`)."""
    return paths.spool / f"upload-{uuid.uuid4().hex}"


def inbox_bytes(paths: RunPaths) -> int:
    """Total size of every inbox file the user sent (only dot-files, the checksum sidecars and partial uploads,
    are excluded), from directory metadata only; nothing is hashed."""
    total = 0
    for name in fsafe.list_dir(paths.inbox):
        if not name.startswith(".") and fsafe.exists(paths.inbox / name):
            total += fsafe.size(paths.inbox / name)
    return total


def _sniff(name: str, head: bytes) -> None:
    ext = Path(name).suffix.lower()
    if ext in BINARY_MAGIC:
        if not any(head.startswith(m) for m in BINARY_MAGIC[ext]):
            raise InboxError(f"{name!r}: content does not look like a {ext} file")
    elif b"\x00" in head:
        raise InboxError(f"{name!r}: binary content in a text file")


def _sidecar(directory: Path, name: str) -> Path:
    return directory / f".{name}.sha256"


def _digest(paths: RunPaths, name: str) -> str:
    """The stored SHA-256 of an inbox file (computed and stored once if the sidecar is missing)."""
    side = _sidecar(paths.inbox, name)
    if fsafe.exists(side):
        text = fsafe.read_text(side, 200).strip()
        if re.fullmatch(r"[0-9a-f]{64}", text):
            return text
    digest = hashlib.sha256()
    with fsafe.open_read(paths.inbox / name) as handle:
        while block := handle.read(1 << 20):
            digest.update(block)
    fsafe.replace(side, digest.hexdigest().encode())
    return digest.hexdigest()


def _entry(paths: RunPaths, name: str) -> dict[str, Any]:
    return {"name": name, "path": paths.rel(paths.inbox / name), "size_bytes": fsafe.size(paths.inbox / name),
            "sha256": _digest(paths, name)}


def _store(paths: RunPaths, name: str, reader: Any, size: int | None, max_bytes: int) -> dict[str, Any]:
    """Stream ``reader`` into the inbox under ``name`` (a numbered variant if a different file has it)."""
    if Path(name).suffix.lower() not in ALLOWED_EXTENSIONS:
        raise InboxError(f"{name!r}: extension not allowed; use one of {sorted(ALLOWED_EXTENSIONS)}")
    if size is not None and size > max_bytes:
        raise InboxError(f"{name!r}: {size} bytes exceeds the {max_bytes}-byte limit")
    fsafe.mkdirs(paths.inbox)
    part = paths.inbox / f".{name}.{uuid.uuid4().hex}.part"
    digest = hashlib.sha256()
    total = 0
    try:
        with fsafe.open_new(part) as out:
            first = True
            while block := reader.read(1 << 20):
                if first:
                    _sniff(name, block[:4096])
                    first = False
                total += len(block)
                if total > max_bytes:
                    raise InboxError(f"{name!r}: exceeds the {max_bytes}-byte limit")
                digest.update(block)
                out.write(block)
        if total == 0:
            raise InboxError(f"{name!r} is empty")
        hexd = digest.hexdigest()
        stem, ext = Path(name).stem, Path(name).suffix
        with _LOCK:
            candidate, n = name, 1
            while fsafe.lexists(paths.inbox / candidate):
                if _digest(paths, candidate) == hexd:
                    fsafe.remove(part)
                    return _entry(paths, candidate)
                n += 1
                candidate = f"{stem}-{n}{ext}"
            fsafe.replace(_sidecar(paths.inbox, candidate), hexd.encode())
            fsafe.rename_over(part, paths.inbox / candidate)
        return _entry(paths, candidate)
    except BaseException:
        fsafe.remove(part)
        raise


class _BytesReader:
    def __init__(self, data: bytes) -> None:
        self._data, self._pos = data, 0

    def read(self, n: int) -> bytes:
        chunk = self._data[self._pos:self._pos + n]
        self._pos += len(chunk)
        return chunk


def save_inbox_file(paths: RunPaths, filename: str, data: bytes, *, max_bytes: int = MAX_INBOX_BYTES) -> dict[str, Any]:
    """Store uploaded bytes in the inbox and return ``{name, path, size_bytes, sha256}``."""
    return _store(paths, safe_name(filename), _BytesReader(data), len(data), max_bytes)


def save_inbox_path(
    paths: RunPaths, source: Path, filename: str | None = None, *, max_bytes: int = MAX_INBOX_BYTES
) -> dict[str, Any]:
    """Copy a local file into the inbox (same checks, streamed; pure file work, emits nothing).

    ``source`` must be a regular file and not itself a link; its directories are resolved first.
    """
    given = Path(source)
    if given.is_symlink() or not given.is_file():
        raise InboxError(f"{source} is not a regular file")
    source = given.resolve()
    name = safe_name(filename or source.name)
    with fsafe.open_read(source) as handle:
        return _store(paths, name, handle, fsafe.size(source), max_bytes)


def list_inbox(paths: RunPaths) -> list[dict[str, Any]]:
    """Files in the inbox with size and SHA-256 (from the sidecar written at save time), sorted by name."""
    out = []
    for name in fsafe.list_dir(paths.inbox):
        if not name.startswith(".") and fsafe.exists(paths.inbox / name):
            out.append(_entry(paths, name))
    return out


def resolve_inbox_file(paths: RunPaths, name: str) -> Path:
    """Location of the inbox file called ``name`` (a bare name, never a path).

    Raises `InboxError` unless it is a regular file directly inside ``state/inbox`` with no link in any
    component of the path.
    """
    if not isinstance(name, str) or not _NAME_RE.fullmatch(name):
        raise InboxError("give the inbox file name only (see list_inbox), not a path")
    try:
        return fsafe.regular_file(paths.inbox / name)
    except OSError as exc:
        try:
            names = [f["name"] for f in list_inbox(paths)]
        except fsafe.UnsafePath as listing:
            raise InboxError(f"the inbox is not a plain directory: {listing}") from listing
        raise InboxError(f"no inbox file {name!r} ({exc.strerror or exc}); the inbox holds {names}") from exc
