"""Sorted-interval and range-extremum helpers behind the per-epoch constraint values.

All functions are vectorised over query epochs, so a scan over 10^5 candidate landing epochs costs
a few array operations instead of one evaluation per epoch ("running-window" evaluation):

- `WindowSet` holds disjoint, sorted visibility intervals with refined edges and answers, for arrays
  of query times: containment, start/end of the containing window, covered time inside a span and
  the longest overlap with a span.
- `SparseTable` answers range-maximum queries over sample arrays in O(1) after O(n log n) set-up.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from lunarnav.visibility import Window, dark_windows, find_windows


class SparseTable:
    """Range maximum over a fixed array; `query(lo, hi)` takes inclusive index arrays."""

    def __init__(self, values: np.ndarray) -> None:
        v = np.asarray(values, dtype=np.float64)
        self._levels = [v]
        j = 1
        while 2 * j <= v.size:
            prev = self._levels[-1]
            self._levels.append(np.maximum(prev[:-j], prev[j:]))
            j *= 2
        self.size = v.size

    def query(self, lo: np.ndarray, hi: np.ndarray) -> np.ndarray:
        """Maximum of `values[lo..hi]` per query; `-inf` where `hi < lo` (empty range)."""
        lo = np.asarray(lo, dtype=np.int64)
        hi = np.asarray(hi, dtype=np.int64)
        out = np.full(lo.shape, -np.inf)
        ok = (hi >= lo) & (lo >= 0) & (hi < self.size)
        if not ok.any():
            return out
        length = hi[ok] - lo[ok] + 1
        k = np.floor(np.log2(length)).astype(np.int64)
        res = np.empty(length.shape)
        for level in np.unique(k):
            sel = k == level
            tab = self._levels[int(level)]
            a = lo[ok][sel]
            b = hi[ok][sel] - (1 << int(level)) + 1
            res[sel] = np.maximum(tab[a], tab[b])
        out[ok] = res
        return out


@dataclass(frozen=True, slots=True)
class WindowSet:
    """Disjoint sorted windows [start, end] inside the data span [t0, t1]."""

    starts: np.ndarray
    ends: np.ndarray
    start_cens: np.ndarray
    end_cens: np.ndarray
    t0: float
    t1: float

    @classmethod
    def from_windows(cls, windows: list[Window], t0: float, t1: float) -> WindowSet:
        return cls(
            np.array([w.start for w in windows], dtype=np.float64),
            np.array([w.end for w in windows], dtype=np.float64),
            np.array([w.start_censored for w in windows], dtype=bool),
            np.array([w.end_censored for w in windows], dtype=bool),
            float(t0), float(t1))

    @classmethod
    def from_signal(cls, t: np.ndarray, signal: np.ndarray, threshold: float = 0.0) -> WindowSet:
        """Windows where `signal > threshold` with linearly refined edges."""
        return cls.from_windows(find_windows(t, signal, threshold), float(t[0]), float(t[-1]))

    def __len__(self) -> int:
        return int(self.starts.size)

    def complement(self) -> WindowSet:
        """Gaps between windows inside [t0, t1]; ends at the span limits are censored."""
        wins = [Window(float(a), float(b), bool(sc), bool(ec))
                for a, b, sc, ec in zip(self.starts, self.ends, self.start_cens, self.end_cens)]
        return WindowSet.from_windows(dark_windows(wins, self.t0, self.t1), self.t0, self.t1)

    def index_containing(self, q: np.ndarray) -> np.ndarray:
        """Index of the window containing each query (`start <= q < end`), -1 when none."""
        q = np.asarray(q, dtype=np.float64)
        if not len(self):
            return np.full(q.shape, -1, dtype=np.int64)
        i = np.searchsorted(self.starts, q, side="right") - 1
        ok = (i >= 0) & (q < self.ends[np.clip(i, 0, None)])
        return np.where(ok, i, -1)

    def contains(self, q: np.ndarray) -> np.ndarray:
        return self.index_containing(q) >= 0

    def next_start_index(self, q: np.ndarray) -> np.ndarray:
        """Index of the first uncensored window start strictly after each query (-1 when none)."""
        q = np.asarray(q, dtype=np.float64)
        i = np.searchsorted(self.starts, q, side="right")
        ok = i < len(self)
        return np.where(ok, i, -1)

    def covered(self, q0: np.ndarray, q1: np.ndarray) -> np.ndarray:
        """Total window time inside [q0, q1] per query pair."""
        return self._cumulative(q1) - self._cumulative(q0)

    def _cumulative(self, q: np.ndarray) -> np.ndarray:
        q = np.asarray(q, dtype=np.float64)
        if not len(self):
            return np.zeros(q.shape)
        dur = self.ends - self.starts
        cum = np.concatenate([[0.0], np.cumsum(dur)])
        k = np.searchsorted(self.starts, q, side="right")
        kk = np.clip(k - 1, 0, None)
        partial = np.clip(q - self.starts[kk], 0.0, dur[kk])
        return np.where(k > 0, cum[kk] + partial, 0.0)

    def longest_overlap(self, q0: np.ndarray, q1: np.ndarray) -> np.ndarray:
        """Longest overlap of any single window with [q0, q1] (seconds), per query pair."""
        q0 = np.asarray(q0, dtype=np.float64)
        q1 = np.asarray(q1, dtype=np.float64)
        if not len(self):
            return np.zeros(q0.shape)
        lo = np.searchsorted(self.ends, q0, side="right")
        hi = np.searchsorted(self.starts, q1, side="left") - 1
        has = hi >= lo
        lo_c = np.clip(lo, 0, len(self) - 1)
        hi_c = np.clip(hi, 0, len(self) - 1)
        first = np.minimum(self.ends[lo_c], q1) - np.maximum(self.starts[lo_c], q0)
        last = np.minimum(self.ends[hi_c], q1) - np.maximum(self.starts[hi_c], q0)
        table = SparseTable(self.ends - self.starts)
        interior = table.query(lo + 1, hi - 1)
        best = np.maximum(np.maximum(first, last), interior)
        return np.where(has, np.maximum(best, 0.0), 0.0)
