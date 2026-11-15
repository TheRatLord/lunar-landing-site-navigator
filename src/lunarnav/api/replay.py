from __future__ import annotations

import hashlib
import os
import time
import uuid
from pathlib import Path
from typing import Any

from lunarnav.api.json import dumps, loads

SKIP_KINDS = frozenset({"analysis.export", "analysis.regional"})
MAX_ENTRIES = 512
DEMO_SLOTS = 32
MAX_REQUEST_BYTES = 256 * 1024
FLUSH_INTERVAL_S = 5.0


class ReplayStore:
    def __init__(self, directory: Path) -> None:
        self.dir = directory
        self.index_path = directory / "index.json"
        self.entries: dict[str, dict[str, Any]] = {}
        self._dirty = False
        self._flushed = 0.0
        directory.mkdir(parents=True, exist_ok=True)
        try:
            raw = loads(self.index_path.read_bytes())
        except (OSError, ValueError):
            raw = {}
        if isinstance(raw, dict):
            for key, entry in raw.items():
                if isinstance(entry, dict) and isinstance(entry.get("kind"), str) and isinstance(entry.get("hits"), int):
                    self.entries[key] = {"kind": entry["kind"], "hits": entry["hits"], "last_ms": int(entry.get("last_ms") or 0),
                                         "demo_ms": int(entry.get("demo_ms") or 0)}

    def _request_path(self, key: str) -> Path:
        return self.dir / f"{key}.json"

    def _write(self, path: Path, data: bytes) -> None:
        tmp = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
        tmp.write_bytes(data)
        os.replace(tmp, path)

    def _recent_demo(self, n: int) -> list[str]:
        demo = [k for k, e in self.entries.items() if e["demo_ms"] > 0]
        return sorted(demo, key=lambda k: -self.entries[k]["demo_ms"])[:n]

    def record(self, kind: str, request: dict[str, Any], *, demo: bool = False) -> None:
        if kind in SKIP_KINDS:
            return
        blob = dumps({"kind": kind, "request": request}, canonical=True)
        if len(blob) > MAX_REQUEST_BYTES:
            return
        key = hashlib.sha256(blob).hexdigest()
        entry = self.entries.get(key)
        fresh = entry is None
        if entry is None:
            self._write(self._request_path(key), blob)
            entry = self.entries[key] = {"kind": kind, "hits": 0, "last_ms": 0, "demo_ms": 0}
        entry["hits"] += 1
        entry["last_ms"] = int(time.time() * 1000)
        if demo:
            entry["demo_ms"] = entry["last_ms"]
        while len(self.entries) > MAX_ENTRIES:
            kept = set(self._recent_demo(DEMO_SLOTS))
            drop = min((k for k in self.entries if k not in kept), key=lambda k: (self.entries[k]["hits"], self.entries[k]["last_ms"]))
            del self.entries[drop]
            self._request_path(drop).unlink(missing_ok=True)
        self._dirty = True
        if fresh or time.monotonic() - self._flushed >= FLUSH_INTERVAL_S:
            self.flush()

    def flush(self) -> None:
        if not self._dirty:
            return
        self._write(self.index_path, dumps(self.entries))
        self._dirty = False
        self._flushed = time.monotonic()

    def top(self, n: int) -> list[tuple[str, dict[str, Any], bool]]:
        demo = self._recent_demo(min(DEMO_SLOTS, n))
        chosen = set(demo)
        ranked = [k for k in sorted(self.entries, key=lambda k: (-self.entries[k]["hits"], -self.entries[k]["last_ms"])) if k not in chosen]
        out: list[tuple[str, dict[str, Any], bool]] = []
        for key in demo + ranked[:max(n - len(demo), 0)]:
            try:
                stored = loads(self._request_path(key).read_bytes())
            except (OSError, ValueError):
                continue
            if isinstance(stored, dict) and isinstance(stored.get("kind"), str) and isinstance(stored.get("request"), dict):
                out.append((stored["kind"], stored["request"], key in chosen))
        return out
