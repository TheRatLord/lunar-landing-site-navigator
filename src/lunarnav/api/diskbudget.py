"""Byte budgets for the service's disk caches: oldest first, never something that is being served.

A budget manages one directory. Its *units* are either the files below it (tiles, patches) or its immediate
subdirectories (one export = one directory). `prune` deletes whole units, oldest modification time first, until the
total is within `max_bytes`; units that are `hold`-ed (being streamed to a client) and units passed in `keep` (just
produced) are skipped, so a budget smaller than one unit is exceeded rather than breaking a download.
"""

from __future__ import annotations

import os
import shutil
import threading
import time
from collections import Counter
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Literal


class DiskBudget:
    def __init__(self, root: Path, max_bytes: int, unit: Literal["file", "dir"] = "file", min_interval_s: float = 0.0) -> None:
        self.root = root
        self.max_bytes = max_bytes
        self.unit = unit
        self.min_interval_s = min_interval_s
        self._held: Counter[Path] = Counter()
        self._lock = threading.Lock()
        self._last = 0.0


    def hold(self, unit: Path) -> None:
        """Protect `unit` (a file, or an export directory) from pruning until `release`."""
        with self._lock:
            self._held[unit] += 1

    def release(self, unit: Path) -> None:
        with self._lock:
            self._held[unit] -= 1
            if self._held[unit] <= 0:
                del self._held[unit]

    @contextmanager
    def holding(self, unit: Path) -> Iterator[None]:
        self.hold(unit)
        try:
            yield
        finally:
            self.release(unit)


    def _units(self) -> list[tuple[float, int, Path]]:
        out: list[tuple[float, int, Path]] = []
        if not self.root.is_dir():
            return out
        if self.unit == "file":
            for dirpath, _, names in os.walk(self.root):
                for name in names:
                    p = Path(dirpath) / name
                    try:
                        st = p.stat()
                    except FileNotFoundError:
                        continue
                    out.append((st.st_mtime, st.st_size, p))
        else:
            for d in self.root.iterdir():
                if not d.is_dir():
                    continue
                size, newest = 0, 0.0
                for dirpath, _, names in os.walk(d):
                    for name in names:
                        try:
                            st = (Path(dirpath) / name).stat()
                        except FileNotFoundError:
                            continue
                        size += st.st_size
                        newest = max(newest, st.st_mtime)
                out.append((newest or d.stat().st_mtime, size, d))
        return out

    def usage(self) -> int:
        return sum(size for _, size, _ in self._units())

    def prune(self, keep: Iterable[Path] = ()) -> int:
        """Delete oldest units until the budget holds; returns the bytes freed."""
        keep_set = set(keep)
        units = self._units()
        total = sum(size for _, size, _ in units)
        freed = 0
        for _, size, path in sorted(units):
            if total <= self.max_bytes:
                break
            with self._lock:
                if path in self._held or path in keep_set:
                    continue
                self._remove(path)
            total -= size
            freed += size
        if self.unit == "file":
            self._remove_empty_dirs()
        return freed

    def discard(self, unit: Path) -> bool:
        """Delete one unit now (an export directory), unless it is being served: ``False`` then, nothing removed."""
        with self._lock:
            if unit in self._held:
                return False
            self._remove(unit)
            return True

    def maybe_prune(self) -> int:
        """`prune`, at most once per `min_interval_s` (for hot paths that add one file at a time)."""
        now = time.monotonic()
        if now - self._last < self.min_interval_s:
            return 0
        self._last = now
        return self.prune()

    def _remove(self, path: Path) -> None:
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        else:
            path.unlink(missing_ok=True)

    def _remove_empty_dirs(self) -> None:
        for dirpath, _, _ in os.walk(self.root, topdown=False):
            if dirpath != str(self.root):
                try:
                    os.rmdir(dirpath)
                except OSError:
                    pass
