"""On-disk layout of a run: transcript, hash-chained ledgers, run metadata.

```
data/runs/<run_id>/
  run.json            run metadata (session id, model, totals), rewritten atomically
  transcript.jsonl    append-only event log
  ledger.jsonl        provenance: one entry per engine-tool call (hash-chained)
  assumptions.jsonl   assumptions recorded by the agent (hash-chained)
  artifacts.jsonl     declared deliverables with SHA-256 (hash-chained)
  heads.json          count and head hash of each chained ledger, rewritten after every append
  workspace/          the only directory the model (and its sandboxed scripts) can write; nothing here is trusted
  state/              written only by the harness, read-only inside the sandbox: tool results, scenarios,
                      constraint sets, ingested DEMs, the user-DEM horizon cache, the inbox, exports
```
Run-root files (ledgers, ``run.json``, transcript, ``heads.json``) are outside the sandbox altogether. Every
harness-side access goes through `fsafe`, which refuses links.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import threading
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from . import fsafe
from .events import Event, parse_event, utc_now

GENESIS = "0" * 64
RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$")


def sha256_bytes(data: bytes) -> str:
    """Hex SHA-256 of a byte string."""
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    """Hex SHA-256 of a file, streamed (no link in any component)."""
    digest = hashlib.sha256()
    with fsafe.open_read(path) as handle:
        while block := handle.read(chunk):
            digest.update(block)
    return digest.hexdigest()


def canonical_json(value: Any) -> str:
    """Deterministic JSON text (sorted keys, no whitespace) used for digests."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def new_run_id(now: str | None = None) -> str:
    """A sortable run id: UTC timestamp plus 128 random bits (32 hex digits).

    Run ids are the only capability a client needs to read a run, so they are not guessable.
    """
    stamp = (now or utc_now()).replace("-", "").replace(":", "").replace(".", "")[:15]
    return f"{stamp.lower()}-{os.urandom(16).hex()}"


@dataclass(frozen=True, slots=True)
class RunPaths:
    """Locations inside one run directory (see the module docstring for the two trees)."""

    root: Path

    @property
    def run_id(self) -> str:
        return self.root.name

    @property
    def workspace(self) -> Path:
        """The model's tree: scripts, their outputs, notes, the script call log. Untrusted."""
        return self.root / "workspace"

    @property
    def cache(self) -> Path:
        """Per-run writable cache for library caches and script horizon caches (``LUNARNAV_CACHE_DIR``)."""
        return self.workspace / "cache"

    @property
    def state(self) -> Path:
        """The harness's tree; the sandbox may read but never write it."""
        return self.root / "state"

    @property
    def results(self) -> Path:
        """Full tool results (``L0001-<random>.json``) and result files of engine tools."""
        return self.state / "results"

    @property
    def scenarios(self) -> Path:
        return self.state / "scenarios"

    @property
    def constraints(self) -> Path:
        return self.state / "constraints"

    @property
    def ingest(self) -> Path:
        """Ingested DEM registry (``dems.json``) and DEM stores."""
        return self.state / "ingest"

    @property
    def state_cache(self) -> Path:
        """Horizon caches of user DEMs."""
        return self.state / "cache"

    @property
    def inbox(self) -> Path:
        """Files the user supplied; written only by the upload route and the CLI."""
        return self.state / "inbox"

    @property
    def spool(self) -> Path:
        """Staging area for uploads before they are moved into the inbox."""
        return self.state / "spool"

    @property
    def exports(self) -> Path:
        return self.state / "exports"

    @property
    def status_snapshot(self) -> Path:
        """Assumption sign-off status for scripts (written by the harness after every decision)."""
        return self.state / "assumption_status.json"

    @property
    def transcript(self) -> Path:
        return self.root / "transcript.jsonl"

    @property
    def ledger(self) -> Path:
        return self.root / "ledger.jsonl"

    @property
    def assumptions(self) -> Path:
        return self.root / "assumptions.jsonl"

    @property
    def artifacts(self) -> Path:
        return self.root / "artifacts.jsonl"

    @property
    def meta(self) -> Path:
        return self.root / "run.json"

    @property
    def heads(self) -> Path:
        return self.root / "heads.json"

    def rel(self, path: Path) -> str:
        """Run-root-relative POSIX path (how files are named in the ledger and in events)."""
        return path.relative_to(self.root).as_posix()

    def artifact_file(self, rel: str) -> Path | None:
        """The deliverable named by a run-root-relative path, or ``None``.

        Only regular files under ``workspace/`` or ``state/exports`` / ``state/results`` qualify, and no
        component may be a link; anything else is ``None``.
        """
        parts = Path(rel).parts
        if not parts or Path(rel).is_absolute() or any(p in ("", ".", "..") for p in parts):
            return None
        allowed = parts[0] == "workspace" or (len(parts) > 2 and parts[0] == "state" and parts[1] in ("exports", "results"))
        path = self.root.joinpath(*parts)
        return path if allowed and fsafe.exists(path) else None

    @classmethod
    def create(cls, runs_dir: Path, run_id: str) -> RunPaths:
        """Create a new run directory with its two trees. Fails if the id is taken or malformed."""
        if not RUN_ID_RE.match(run_id):
            raise ValueError(f"invalid run id {run_id!r}")
        paths = cls((runs_dir / run_id).resolve())
        paths.root.mkdir(parents=True, exist_ok=False)
        for d in (paths.workspace, paths.cache, paths.state, paths.inbox, paths.spool, paths.results):
            fsafe.mkdirs(d)
        return paths

    @classmethod
    def open(cls, runs_dir: Path, run_id: str) -> RunPaths:
        """Open an existing run directory."""
        if not RUN_ID_RE.match(run_id):
            raise ValueError(f"invalid run id {run_id!r}")
        paths = cls((runs_dir / run_id).resolve())
        if not fsafe.exists(paths.meta):
            raise FileNotFoundError(f"no run {run_id!r} under {runs_dir}")
        return paths


_HEAD_LOCKS: dict[Path, threading.Lock] = {}
_HEAD_LOCKS_GUARD = threading.Lock()


def _head_lock(path: Path) -> threading.Lock:
    with _HEAD_LOCKS_GUARD:
        return _HEAD_LOCKS.setdefault(path, threading.Lock())


def read_heads(root: Path) -> dict[str, Any]:
    path = root / "heads.json"
    if not fsafe.exists(path):
        return {}
    return json.loads(fsafe.read_text(path))  # type: ignore[no-any-return]


class JsonlLedger:
    """Append-only JSONL file in which every entry carries the SHA-256 of the previous line.

    Editing or deleting an earlier line breaks every later ``prev`` link. After each append the entry count
    and head hash are also recorded in ``heads.json`` (a run-root file the sandbox cannot touch), so removing
    the *last* lines is detected as well. `verify` checks both. This is tamper evidence against the model and
    casual edits; it is not a signature (anyone who can rewrite both files can forge a chain).
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self._last = GENESIS
        self._count = 0
        self._size = -1
        self._unterminated = False
        self._sync()

    def _sync(self) -> None:
        """Re-read the chain head if another instance (or process) appended since our last write."""
        size = fsafe.size(self.path) if fsafe.exists(self.path) else 0
        if size == self._size:
            return
        self._last, self._count = GENESIS, 0
        self._unterminated = False
        if size:
            text = fsafe.read_text(self.path)
            self._unterminated = not text.endswith("\n")
            for line in text.splitlines():
                if line.strip():
                    self._last = sha256_bytes(line.encode())
                    self._count += 1
        self._size = size

    def __len__(self) -> int:
        self._sync()
        return self._count

    def append(self, entry: dict[str, Any]) -> dict[str, Any]:
        """Append an entry (adds ``prev``), record the new head, and return the entry as stored."""
        root = self.path.parent
        with _head_lock(self.path):
            self._sync()
            if self._unterminated:
                raise ValueError(f"{self.path.name} ends in an unterminated line (a torn write); nothing was appended, "
                                 "because the entry would be glued onto the fragment. An operator can remove the "
                                 "fragment with repair-ledger, which shows what it removes")
            heads = read_heads(root)
            stored = {**entry, "prev": self._last}
            line = canonical_json(stored)
            fsafe.append(self.path, (line + "\n").encode())
            self._last = sha256_bytes(line.encode())
            self._count += 1
            self._size = fsafe.size(self.path)
            _write_head(self.path, heads, self._count, self._last)
        return stored

    def entries(self) -> list[dict[str, Any]]:
        """All entries in order."""
        return read_jsonl(self.path)

    def verify(self) -> list[str]:
        """Problems with the hash chain or with the recorded head (empty when intact)."""
        return verify_chain(self.path) + verify_head(self.path)


def set_head(path: Path, count: int, head: str) -> None:
    """Record ``count`` and ``head`` for the ledger at ``path`` in ``heads.json`` (used by the repair command only)."""
    with _head_lock(path):
        _write_head(path, read_heads(path.parent), count, head)


def _write_head(path: Path, heads: dict[str, Any], count: int, head: str) -> None:
    heads[path.name] = {"count": count, "head": head}
    fsafe.replace(path.parent / "heads.json", json.dumps(heads, sort_keys=True, indent=2).encode())


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    """Read a JSONL file; a missing file is an empty list."""
    if not fsafe.exists(path):
        return []
    return [json.loads(line) for line in fsafe.read_text(path).splitlines() if line.strip()]


def verify_chain(path: Path) -> list[str]:
    """Check the ``prev`` links of a ledger file. Returns human-readable problems."""
    problems: list[str] = []
    prev = GENESIS
    if not fsafe.exists(path):
        return problems
    for number, line in enumerate(fsafe.read_text(path).splitlines(), start=1):
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            problems.append(f"line {number}: not valid JSON")
            break
        if entry.get("prev") != prev:
            problems.append(f"line {number}: prev hash does not match the previous line")
        prev = sha256_bytes(line.encode())
    return problems


def verify_head(path: Path) -> list[str]:
    """Compare a ledger's count and last-line hash with the head recorded in ``heads.json``."""
    count, last = 0, GENESIS
    if fsafe.exists(path):
        for line in fsafe.read_text(path).splitlines():
            if line.strip():
                count += 1
                last = sha256_bytes(line.encode())
    try:
        heads = read_heads(path.parent)
    except (OSError, ValueError) as exc:
        return [f"heads.json is unreadable: {exc}"]
    recorded = heads.get(path.name)
    if recorded is None:
        if count == 0:
            return []
        return [f"{path.name} has {count} entries but no recorded head: its head was removed, the file was added "
                "outside the harness, or its first append was interrupted"]
    problems = []
    if recorded.get("count") != count:
        problems.append(f"{path.name} has {count} entries but the recorded head says {recorded.get('count')} "
                        "(entries were removed or added outside the harness)")
    elif recorded.get("head") != last:
        problems.append(f"{path.name} ends with a different entry than the recorded head")
    return problems




def run_integrity_problems(paths: RunPaths) -> list[str]:
    """Chain and head problems of the three ledgers of a run."""
    out: list[str] = []
    for p in (paths.ledger, paths.assumptions, paths.artifacts):
        out += [f"{p.name}: {x}" for x in verify_chain(p)] + verify_head(p)
    return out


class EventLog:
    """Assigns sequence numbers and appends events to ``transcript.jsonl``."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._seq = -1
        if fsafe.exists(path):
            for event in iter_events(path):
                self._seq = max(self._seq, event.seq)

    @property
    def last_seq(self) -> int:
        return self._seq

    def next_seq(self) -> int:
        """Reserve and return the next sequence number."""
        self._seq += 1
        return self._seq

    def write(self, event: BaseModel) -> None:
        """Append one already-numbered event."""
        fsafe.append(self.path, (event.model_dump_json() + "\n").encode())


def iter_events(path: Path) -> Iterator[Event]:
    """Yield the events of a transcript file in order. A missing file yields nothing."""
    if not fsafe.exists(path):
        return
    with fsafe.open_read(path) as handle:
        for raw in handle:
            if raw.strip():
                yield parse_event(raw.decode("utf-8"))


async def follow_events(
    path: Path, after_seq: int = -1, poll_s: float = 0.2, stop: asyncio.Event | None = None
) -> AsyncIterator[Event]:
    """Tail a transcript: replay events with ``seq > after_seq``, then wait for new ones.

    Ends when ``stop`` is set and the file is drained; otherwise runs until the caller cancels it.
    Suitable for late-joining SSE subscribers (``Last-Event-ID`` is ``after_seq``).
    """
    offset = 0
    buffer = b""
    while True:
        if fsafe.exists(path):
            with fsafe.open_read(path) as handle:
                handle.seek(offset)
                chunk = handle.read()
                offset += len(chunk)
            buffer += chunk
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                if line.strip():
                    event = parse_event(line)
                    if event.seq > after_seq:
                        yield event
        if stop is not None and stop.is_set():
            return
        await asyncio.sleep(poll_s)


def write_json_atomic(path: Path, value: Any, *, mkdir: bool = False) -> None:
    """Write JSON to ``path`` through a temporary file and rename (link-safe, see `fsafe.replace`)."""
    fsafe.replace(path, (json.dumps(value, indent=2, sort_keys=True) + "\n").encode(), mkdir=mkdir)


def read_run_meta(paths: RunPaths) -> dict[str, Any]:
    """Load ``run.json``."""
    return json.loads(fsafe.read_text(paths.meta))  # type: ignore[no-any-return]


def list_runs(runs_dir: Path) -> list[dict[str, Any]]:
    """Summaries of all runs under ``runs_dir``, newest first."""
    out: list[dict[str, Any]] = []
    if not runs_dir.is_dir():
        return out
    for child in sorted(runs_dir.iterdir(), reverse=True):
        meta = child.resolve() / "run.json"
        if fsafe.exists(meta):
            try:
                out.append(json.loads(fsafe.read_text(meta)))
            except (json.JSONDecodeError, OSError):
                continue
    return out
