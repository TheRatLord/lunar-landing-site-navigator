"""Progress callbacks: `progress(fraction, stage)` with fraction in 0..1; a callback that raises cancels the analysis."""

from __future__ import annotations

from collections.abc import Callable

ProgressFn = Callable[[float, str], None]


def scaled_progress(progress: ProgressFn | None, lo: float, hi: float, prefix: str = "") -> ProgressFn | None:
    """A progress callback that maps the fraction 0..1 of a sub-task onto [lo, hi] of the parent's callback (None for None)."""
    if progress is None:
        return None

    def inner(fraction: float, stage: str) -> None:
        progress(lo + (hi - lo) * fraction, prefix + stage)
    return inner
