"""Windows, statistics and event times from a sampled visibility signal.

A signal `s(t)` (flux fraction, elevation clearance in degrees, margin in dB, ...) is *visible* where
`s > threshold`. Window edges are the threshold crossings between samples, refined to sub-sample
accuracy by one of:

- `"linear"`: linear interpolation (exact for a signal linear between samples; error O(dt^2 s''/s'));
- `"hermite"`: cubic Hermite interpolation with central-difference slopes, root found by bisection
  (error O(dt^3): the central-difference slopes are O(dt^2));
- a user callback `refine(t) -> signal` evaluated exactly (e.g. re-running the geometry), solved with
  Brent's method inside the bracketing sample interval.

Windows touching the first or last sample are *censored*: that end is the edge of the data and not an
event. `start_censored` / `end_censored` mark them, and such ends are never reported as rise/set times.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

import numpy as np
from scipy.optimize import brentq

Method = Literal["linear", "hermite"]


@dataclass(frozen=True, slots=True)
class Window:
    """Interval of visibility [start, end] (seconds, same unit as the input times)."""

    start: float
    end: float
    start_censored: bool = False
    end_censored: bool = False

    @property
    def duration(self) -> float:
        return self.end - self.start


def _check(t: np.ndarray, s: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    t = np.asarray(t, dtype=np.float64)
    s = np.asarray(s, dtype=np.float64)
    if t.ndim != 1 or s.shape != t.shape or t.size < 2:
        raise ValueError("t and signal must be 1-D arrays of equal length >= 2")
    if np.any(np.diff(t) <= 0.0):
        raise ValueError("times must be strictly increasing")
    if np.any(np.isnan(s)):
        raise ValueError("signal contains NaN")
    return t, s


def _hermite_root(t0: float, t1: float, f0: float, f1: float, d0: float, d1: float) -> float:
    """Root of the cubic Hermite interpolant on [t0, t1] (f0 and f1 have opposite sign), by bisection."""
    h = t1 - t0

    def f(u: float) -> float:
        u2, u3 = u * u, u * u * u
        return ((2 * u3 - 3 * u2 + 1) * f0 + (u3 - 2 * u2 + u) * h * d0
                + (-2 * u3 + 3 * u2) * f1 + (u3 - u2) * h * d1)

    lo, hi, flo = 0.0, 1.0, f0
    for _ in range(60):
        mid = 0.5 * (lo + hi)
        fm = f(mid)
        if (fm > 0.0) == (flo > 0.0):
            lo, flo = mid, fm
        else:
            hi = mid
    return t0 + h * 0.5 * (lo + hi)


def crossing_times(
    t: np.ndarray, signal: np.ndarray, threshold: float = 0.0, *, method: Method = "linear",
    refine: Callable[[float], float] | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Threshold crossings of a sampled signal.

    Returns `(times, rising)`: crossing times (sorted) and a boolean array, True where the signal
    goes from `<= threshold` to `> threshold`.
    """
    t, s = _check(t, signal)
    f = s - threshold
    vis = f > 0.0
    idx = np.nonzero(vis[1:] != vis[:-1])[0]
    if method not in ("linear", "hermite"):
        raise ValueError("method must be 'linear' or 'hermite'")
    slope = np.gradient(f, t) if method == "hermite" and t.size > 2 else None
    times = np.empty(idx.size)
    for k, i in enumerate(idx):
        t0, t1, f0, f1 = t[i], t[i + 1], f[i], f[i + 1]
        if refine is not None:
            times[k] = brentq(lambda x: refine(x) - threshold, t0, t1, xtol=1e-9 * max(1.0, t1 - t0))
        elif slope is not None:
            times[k] = _hermite_root(t0, t1, f0, f1, slope[i], slope[i + 1])
        else:
            times[k] = t0 + (t1 - t0) * (f0 / (f0 - f1))
    return times, vis[idx + 1]


def find_windows(
    t: np.ndarray, signal: np.ndarray, threshold: float = 0.0, *, method: Method = "linear",
    refine: Callable[[float], float] | None = None,
) -> list[Window]:
    """Intervals where `signal > threshold`, with sub-sample edges (see module doc)."""
    t, s = _check(t, signal)
    times, rising = crossing_times(t, s, threshold, method=method, refine=refine)
    starts: list[float] = []
    ends: list[float] = []
    start_cens: list[bool] = []
    end_cens: list[bool] = []
    if s[0] > threshold:
        starts.append(float(t[0]))
        start_cens.append(True)
    for tc, r in zip(times, rising):
        if r:
            starts.append(float(tc))
            start_cens.append(False)
        else:
            ends.append(float(tc))
            end_cens.append(False)
    if s[-1] > threshold:
        ends.append(float(t[-1]))
        end_cens.append(True)
    return [Window(a, b, sc, ec) for a, b, sc, ec in zip(starts, ends, start_cens, end_cens)]


def _check_within(windows: list[Window], t0: float, t1: float) -> None:
    """Raise unless `t0 < t1` and every window lies inside [t0, t1] and the windows are ordered."""
    if t1 <= t0:
        raise ValueError("t1 must exceed t0")
    eps = 1e-9 * (t1 - t0)
    prev_end = -np.inf
    for w in windows:
        if w.start < t0 - eps or w.end > t1 + eps:
            raise ValueError(f"window [{w.start}, {w.end}] lies outside the span [{t0}, {t1}]")
        if w.start < prev_end - eps:
            raise ValueError("windows must be time-ordered and non-overlapping")
        prev_end = w.end


def dark_windows(windows: list[Window], t0: float, t1: float) -> list[Window]:
    """Complement of `windows` within [t0, t1]; raises if a window lies outside the span.

    A dark span is censored at an end that is `t0` / `t1` or that abuts a censored window edge (a window cut
    off by the data: what lies beyond is unknown, so the dark span is only a lower bound there).
    """
    _check_within(windows, t0, t1)
    out: list[Window] = []
    cursor, cursor_cens = t0, True
    for w in windows:
        if w.start > cursor:
            out.append(Window(cursor, w.start, cursor_cens, w.start_censored))
        cursor, cursor_cens = w.end, w.end_censored
    if cursor < t1:
        out.append(Window(cursor, t1, cursor_cens, True))
    return [d for d in out if d.end > d.start]


@dataclass(frozen=True, slots=True)
class WindowStats:
    """Summary statistics over [t0, t1]. Spans are in the input time unit (seconds)."""

    span: float
    total_visible: float
    fraction_visible: float
    n_windows: int
    longest_visible: float
    longest_visible_window: Window | None
    longest_dark: float
    longest_dark_window: Window | None
    longest_dark_censored: bool
    """True if the longest dark span touches the start or end of the data, so it is a lower bound."""


def window_stats(windows: list[Window], t0: float, t1: float) -> WindowStats:
    """Total / fractional duration and longest visible and dark spans within [t0, t1]."""
    _check_within(windows, t0, t1)
    darks = dark_windows(windows, t0, t1)
    total = float(sum(w.duration for w in windows))
    lv = max(windows, key=lambda w: w.duration, default=None)
    ld = max(darks, key=lambda w: w.duration, default=None)
    return WindowStats(
        span=t1 - t0, total_visible=total, fraction_visible=total / (t1 - t0), n_windows=len(windows),
        longest_visible=lv.duration if lv else 0.0, longest_visible_window=lv,
        longest_dark=ld.duration if ld else 0.0, longest_dark_window=ld,
        longest_dark_censored=bool(ld and (ld.start_censored or ld.end_censored)),
    )


def time_to_next_transition(
    windows: list[Window], t_query: np.ndarray | float, t0: float, t1: float
) -> tuple[np.ndarray, np.ndarray]:
    """For each query epoch: whether visible, and the time until the next set (if visible) or rise.

    Returns `(visible, dt)`. `dt` is NaN when no transition occurs before the end of the data
    (right-censored); censored window ends are not transitions. Queries outside [t0, t1] raise.
    """
    q = np.atleast_1d(np.asarray(t_query, dtype=np.float64))
    if np.any(q < t0) or np.any(q > t1):
        raise ValueError("query epochs must lie within [t0, t1]")
    edges = []
    for w in windows:
        if not w.start_censored:
            edges.append(w.start)
        if not w.end_censored:
            edges.append(w.end)
    edges_a = np.asarray(sorted(edges))
    starts = np.asarray([w.start for w in windows])
    ends = np.asarray([w.end for w in windows])
    i = np.searchsorted(starts, q, side="right") - 1
    visible = (i >= 0) & (q < ends[np.clip(i, 0, None)]) if windows else np.zeros(q.shape, bool)
    j = np.searchsorted(edges_a, q, side="right")
    dt = np.full(q.shape, np.nan)
    ok = j < edges_a.size
    dt[ok] = edges_a[j[ok]] - q[ok]
    return visible, dt


@dataclass(frozen=True, slots=True)
class UncertainWindow:
    """A visibility window with edge-time ranges implied by the optimistic/pessimistic horizons.

    The start lies in `start_range = (earliest, latest)` and the end in `end_range`. If `certain` is
    False the pessimistic horizon never opens in this window, so its existence is itself uncertain
    (the ranges then reach to the nominal window edges on the pessimistic side).

    `start_range_censored` / `end_range_censored` are True when a bound of that range is the first or last
    data sample (an optimistic or pessimistic window cut off by the data), so the true bound lies beyond
    the data and the range is only a one-sided estimate there. Invariants:
    `start_range[0] <= nominal.start <= start_range[1]` and `end_range[0] <= nominal.end <= end_range[1]`
    always hold for a nominal window; when `certain` the full chain
    `start_range[1] <= end_range[0]` holds too (when not, the ranges extend to the nominal window edges).
    """

    nominal: Window | None
    start_range: tuple[float, float]
    end_range: tuple[float, float]
    certain: bool
    start_range_censored: bool = False
    end_range_censored: bool = False


def _overlaps(a: Window, b: Window) -> bool:
    return a.start < b.end and a.end > b.start


def bounded_windows(
    t: np.ndarray, nominal: np.ndarray, optimistic: np.ndarray, pessimistic: np.ndarray,
    threshold: float = 0.0, *, method: Method = "linear",
) -> list[UncertainWindow]:
    """Windows for the nominal signal with edge ranges from the optimistic and pessimistic signals.

    Requires `pessimistic <= nominal <= optimistic` sample-wise (as produced by evaluating against
    `elev_hi`, `elev`, `elev_lo`); raises otherwise, because the ranges would not bracket.

    Windows of the three signals are matched by overlap, not containment: with `method="hermite"` the
    interpolants of the three signals need not be ordered between samples, so a nominal window can stick
    out of its optimistic one by a fraction of a sample. Ranges are then clamped so that the ordering
    invariant of `UncertainWindow` holds. A nominal window that overlaps no optimistic window is
    reported with its own edges as the optimistic bound; an optimistic window overlapping no nominal one
    is reported with `nominal=None`.
    """
    t, nom = _check(t, nominal)
    _, opt = _check(t, optimistic)
    _, pes = _check(t, pessimistic)
    tol = 1e-9 * max(1.0, float(np.max(np.abs(opt))))
    if np.any(pes > nom + tol) or np.any(nom > opt + tol):
        raise ValueError("signals must satisfy pessimistic <= nominal <= optimistic")
    wn = find_windows(t, nom, threshold, method=method)
    wo = find_windows(t, opt, threshold, method=method)
    wp = find_windows(t, pes, threshold, method=method)

    groups: dict[int, list[Window]] = {}
    orphans: list[Window] = []
    for w in wn:
        best, best_len = -1, 0.0
        for i, o in enumerate(wo):
            ov = min(w.end, o.end) - max(w.start, o.start)
            if ov > best_len:
                best, best_len = i, ov
        if best < 0:
            orphans.append(w)
        else:
            groups.setdefault(best, []).append(w)

    def pess_inside(w: Window) -> tuple[tuple[float, bool], tuple[float, bool]] | None:
        ps = [p for p in wp if _overlaps(p, w)]
        if not ps:
            return None
        first, last = ps[0], ps[-1]
        return ((max(first.start, w.start), first.start_censored and first.start >= w.start),
                (min(last.end, w.end), last.end_censored and last.end <= w.end))

    def build(w: Window, earliest: tuple[float, bool], latest: tuple[float, bool]) -> UncertainWindow:
        earliest = (min(earliest[0], w.start), earliest[1] and earliest[0] <= w.start)
        latest = (max(latest[0], w.end), latest[1] and latest[0] >= w.end)
        inside = pess_inside(w)
        if inside is not None:
            (ps, ps_c), (pe, pe_c) = inside
            return UncertainWindow(w, (earliest[0], ps), (pe, latest[0]), True,
                                   earliest[1] or ps_c, pe_c or latest[1])
        return UncertainWindow(w, (earliest[0], w.end), (w.start, latest[0]), False,
                               earliest[1] or w.end_censored, w.start_censored or latest[1])

    keyed: list[tuple[float, UncertainWindow]] = []
    for i, o in enumerate(wo):
        noms = groups.get(i, [])
        if not noms:
            keyed.append((o.start, UncertainWindow(
                None, (o.start, o.end), (o.start, o.end), False, o.start_censored, o.end_censored)))
            continue
        for k, w in enumerate(noms):
            earliest = (o.start, o.start_censored) if k == 0 else (noms[k - 1].end, False)
            latest = (o.end, o.end_censored) if k == len(noms) - 1 else (noms[k + 1].start, False)
            keyed.append((w.start, build(w, earliest, latest)))
    for w in orphans:
        keyed.append((w.start, build(w, (w.start, w.start_censored), (w.end, w.end_censored))))
    keyed.sort(key=lambda kv: kv[0])
    return [u for _, u in keyed]
