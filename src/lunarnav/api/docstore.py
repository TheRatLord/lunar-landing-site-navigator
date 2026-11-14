"""SQLite document store: validated JSON documents with optimistic versioning and full revision history.

Every create and update appends a row to ``revisions``; ``documents`` holds the latest version. An update
must name the version it was based on (``expected_version``); a stale write raises `VersionConflict` and
changes nothing. Deleting a document removes it together with its revisions. The store does not know the
document schema: callers validate before writing.
"""

from __future__ import annotations

import sqlite3
import threading
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import orjson

_SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_utc TEXT NOT NULL,
    updated_utc TEXT NOT NULL,
    body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS documents_kind ON documents(kind, updated_utc DESC);
CREATE TABLE IF NOT EXISTS revisions (
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    name TEXT NOT NULL,
    saved_utc TEXT NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY (id, version)
);
"""


class NotFound(LookupError):
    """No such document or revision."""


class VersionConflict(Exception):
    """The stored version differs from the one the writer started from."""

    def __init__(self, doc_id: str, expected: int, current: int) -> None:
        super().__init__(f"document {doc_id} is at version {current}, not {expected}")
        self.doc_id, self.expected, self.current = doc_id, expected, current


@dataclass(frozen=True, slots=True)
class Summary:
    """A document without its body."""

    id: str
    kind: str
    name: str
    version: int
    created_utc: str
    updated_utc: str


@dataclass(frozen=True, slots=True)
class Record(Summary):
    """A document with its JSON body."""

    body: dict[str, Any]


@dataclass(frozen=True, slots=True)
class RevisionSummary:
    """One saved version of a document."""

    id: str
    version: int
    name: str
    saved_utc: str


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class DocumentStore:
    """Thread-safe store backed by one SQLite file (WAL mode)."""

    def __init__(self, path: Path | str) -> None:
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self._lock:
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.execute("PRAGMA synchronous=NORMAL")
            self._db.executescript(_SCHEMA)

    def close(self) -> None:
        """Close the connection."""
        with self._lock:
            self._db.close()

    @staticmethod
    def _record(row: sqlite3.Row) -> Record:
        return Record(
            row["id"], row["kind"], row["name"], row["version"], row["created_utc"], row["updated_utc"],
            orjson.loads(row["body"]),
        )

    def create(self, kind: str, name: str, body: dict[str, Any]) -> Record:
        """Store a new document at version 1."""
        doc_id = f"{kind[:4].lower()}-{uuid.uuid4().hex[:12]}"
        now = _now()
        text = orjson.dumps(body).decode()
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                self._db.execute("INSERT INTO documents VALUES (?,?,?,?,?,?,?)", (doc_id, kind, name, 1, now, now, text))
                self._db.execute("INSERT INTO revisions VALUES (?,?,?,?,?)", (doc_id, 1, name, now, text))
                self._db.execute("COMMIT")
            except BaseException:
                self._db.execute("ROLLBACK")
                raise
        return Record(doc_id, kind, name, 1, now, now, body)

    def get(self, doc_id: str) -> Record:
        """Latest version of a document."""
        with self._lock:
            row = self._db.execute("SELECT * FROM documents WHERE id=?", (doc_id,)).fetchone()
        if row is None:
            raise NotFound(doc_id)
        return self._record(row)

    def update(self, doc_id: str, expected_version: int, name: str, body: dict[str, Any]) -> Record:
        """Replace the document if it is still at `expected_version`; the new version is that plus one."""
        now = _now()
        text = orjson.dumps(body).decode()
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                row = self._db.execute("SELECT * FROM documents WHERE id=?", (doc_id,)).fetchone()
                if row is None:
                    raise NotFound(doc_id)
                if row["version"] != expected_version:
                    raise VersionConflict(doc_id, expected_version, row["version"])
                version = expected_version + 1
                self._db.execute(
                    "UPDATE documents SET name=?, version=?, updated_utc=?, body=? WHERE id=?",
                    (name, version, now, text, doc_id),
                )
                self._db.execute("INSERT INTO revisions VALUES (?,?,?,?,?)", (doc_id, version, name, now, text))
                self._db.execute("COMMIT")
            except BaseException:
                self._db.execute("ROLLBACK")
                raise
        return Record(doc_id, row["kind"], name, version, row["created_utc"], now, body)

    def search(self, kind: str | None = None, q: str | None = None, limit: int = 100, offset: int = 0) -> tuple[list[Summary], int]:
        """Summaries newest-updated first, optionally filtered by kind and a name substring; plus the total."""
        where, args = [], []
        if kind is not None:
            where.append("kind=?")
            args.append(kind)
        if q:
            where.append("name LIKE ? ESCAPE '\\'")
            args.append("%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
        clause = (" WHERE " + " AND ".join(where)) if where else ""
        with self._lock:
            total = self._db.execute(f"SELECT COUNT(*) FROM documents{clause}", args).fetchone()[0]
            rows = self._db.execute(
                "SELECT id,kind,name,version,created_utc,updated_utc FROM documents"
                f"{clause} ORDER BY updated_utc DESC, id LIMIT ? OFFSET ?",
                [*args, limit, offset],
            ).fetchall()
        return [Summary(*tuple(r)) for r in rows], total

    def delete(self, doc_id: str, expected_version: int | None = None) -> None:
        """Remove a document and its revisions; with `expected_version`, only if still at that version."""
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                row = self._db.execute("SELECT version FROM documents WHERE id=?", (doc_id,)).fetchone()
                if row is None:
                    raise NotFound(doc_id)
                if expected_version is not None and row["version"] != expected_version:
                    raise VersionConflict(doc_id, expected_version, row["version"])
                self._db.execute("DELETE FROM documents WHERE id=?", (doc_id,))
                self._db.execute("DELETE FROM revisions WHERE id=?", (doc_id,))
                self._db.execute("COMMIT")
            except BaseException:
                self._db.execute("ROLLBACK")
                raise

    def revisions(self, doc_id: str) -> list[RevisionSummary]:
        """All saved versions of a document, oldest first."""
        with self._lock:
            rows = self._db.execute(
                "SELECT id,version,name,saved_utc FROM revisions WHERE id=? ORDER BY version", (doc_id,)
            ).fetchall()
        if not rows:
            raise NotFound(doc_id)
        return [RevisionSummary(*tuple(r)) for r in rows]

    def revision(self, doc_id: str, version: int) -> Record:
        """The document body as of `version`."""
        with self._lock:
            row = self._db.execute(
                "SELECT r.version, r.name, r.saved_utc, r.body, d.kind, d.created_utc FROM revisions r "
                "JOIN documents d ON d.id=r.id WHERE r.id=? AND r.version=?",
                (doc_id, version),
            ).fetchone()
        if row is None:
            raise NotFound(f"{doc_id}@{version}")
        return Record(doc_id, row["kind"], row["name"], row["version"], row["created_utc"], row["saved_utc"], orjson.loads(row["body"]))
