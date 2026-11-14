"""UTC instant arithmetic for `derive`: an instant plus or minus a duration, and the difference of two instants.

**Time scale.** Instants are ISO-8601 UTC strings and the arithmetic is on POSIX time (every UTC day is 86 400 s; a leap
second is not counted). That equals elapsed SI seconds between two instants whenever no leap second lies between them,
and the last one inserted is at the end of 2016-12-31 (IERS; the engine's own leap-seconds kernel `naif0012.tls` ends
there too, `lunarnav.ephem.timeconv`). So the addition is exact at the 1 s level, and at the millisecond level up to
the TDB-UTC periodic term of about 1.7 ms, for every instant from 2017-01-01 on. An operand or a result before that
date is refused, because a leap second may lie between it and the other operand; the engine's own time conversion does
those. A leap second announced after the kernel is not known here.

Only ISO-8601 UTC is read (`parse_utc`): no free-text dates, no time zone other than UTC, no date without a time of day.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime
from typing import Any

from ..numbers import parse_utc
from ..registry import ToolError
from ..trace import KINDS, Part, Source

FIRST_INSTANT = datetime(2017, 1, 1, tzinfo=UTC).timestamp()
"""Earliest instant `derive` accepts (see the module docstring)."""

LAST_INSTANT = datetime(9999, 12, 31, 23, 59, 59, tzinfo=UTC).timestamp()

_SHIFT_S = 1000.0
"""Probe shift of the linearity check."""

TIME_UNITS: dict[str, float] = {"s": 1.0, "min": 60.0, "h": 3600.0, "d": 86400.0}
"""The units a duration may be declared in, and the seconds in each."""

_MATCH_S = 0.0015
"""An operand is an instant of its record when it equals it to the millisecond the engine writes."""


def parse_operand(name: str, text: str) -> float:
    """Epoch seconds of an ISO-8601 UTC instant with a time of day, within the accepted range."""
    if "T" not in text:
        raise ToolError(f"instant {name}: {text!r} has no time of day; write it as ISO-8601 UTC, e.g. 2027-03-12T00:00:00Z")
    epoch = parse_utc(text)
    if epoch is None or not math.isfinite(epoch):
        raise ToolError(f"instant {name}: {text!r} is not an ISO-8601 UTC instant (a time zone other than Z or +00:00 is refused)")
    if epoch < FIRST_INSTANT:
        raise ToolError(f"instant {name}: {text} is before 2017-01-01T00:00:00Z; a leap second may lie between it and the "
                        "other operand, which this arithmetic does not count (use an engine tool)")
    return epoch


def traced_instant(src: Source, epoch: float, row: str | None) -> Part | None:
    """The least independent part of ``src`` that states exactly this instant (within the cited row), or None."""
    hits = [p for p in src.parts if any(abs(t - epoch) <= _MATCH_S for b in p.scope(row, False) for t in b.times)]
    return max(hits, key=lambda p: KINDS.index(p.kind)) if hits else None


def check_linear(expression: str, names: dict[str, float], instants: set[str], want_instant: bool,
                 evaluate: Any) -> None:
    """Refuse an expression that is not an instant plus durations (``want_instant``) or a difference of instants.

    Shifting every instant by one probe interval must shift an instant result by exactly that interval and leave a
    duration result unchanged: ``t + 3600 * d`` and ``(t1 - t0) / 3600`` pass; ``t0 + t1``, ``t0 * 2`` and ``t0 + 5``
    as a duration do not."""
    if want_instant and not instants:
        raise ToolError("result 'instant' needs at least one instant input")
    base = evaluate(expression, names)
    shifted = evaluate(expression, {k: v + _SHIFT_S if k in instants else v for k, v in names.items()})
    want = _SHIFT_S if want_instant else 0.0
    if abs((shifted - base) - want) > 1e-6:
        if want_instant:
            raise ToolError("an instant result must be one instant plus or minus durations: the expression moved by "
                            f"{(shifted - base) / _SHIFT_S:g} s per s of the instants, not by 1")
        raise ToolError("a result that is a number must not move with the instants: take the difference of two instants "
                        f"(the expression moved by {(shifted - base) / _SHIFT_S:g} s per s of the instants, not by 0)")


def check_units(expression: str, names: dict[str, float], instants: set[str], units: dict[str, str], result_unit: str,
                want_instant: bool, evaluate: Any) -> None:
    """Refuse an expression whose arithmetic does not honour the unit each operand was declared in.

    An instant is in seconds; every other operand is a duration and must be declared in a time unit (``s``, ``min``, ``h``,
    ``d``; a number the request gives with no unit is not a duration). Moving an operand by 1000 s (in its own unit) must
    move the result by exactly 1000 s for an instant, or by 1000 s in the declared unit of a number, and by 3000 s three
    times as far. ``t + 3600 * d`` with ``d`` in hours passes; ``t + d`` (36 h would move the instant 36 s), ``t + 7200 * d``
    and ``t + d * d`` do not, and neither does an operand the expression ignores. The factor is then a unit conversion and
    never a choice of the assistant's."""
    per_result = 1.0 if want_instant else TIME_UNITS.get(result_unit)
    if per_result is None:
        raise ToolError("a difference of instants needs a unit of s, min, h or d (the unit of the number)")
    base = evaluate(expression, names)
    for name, value in names.items():
        unit = "s" if name in instants else units.get(name, "")
        if unit not in TIME_UNITS:
            raise ToolError(f"{name}: with instants every input is a duration declared in s, min, h or d, not {unit!r}; "
                            "a number the request gives without a unit cannot be used as a duration")
        step = _SHIFT_S / TIME_UNITS[unit]
        want = _SHIFT_S / per_result
        tol = 1e-9 * want + 1e-6 / per_result
        moved = [evaluate(expression, {**names, name: value + k * step}) - base for k in (1, 3)]
        if abs(abs(moved[0]) - want) > tol or abs(moved[1] - 3 * moved[0]) > 3 * tol:
            raise ToolError(f"{name} is declared in {unit!r}, so 1 {unit} must move the result by {TIME_UNITS[unit] / per_result:g} "
                            f"{'s' if want_instant else result_unit}; the expression moves it by {moved[0] / _SHIFT_S * TIME_UNITS[unit]:g}. "
                            "Use the exact unit conversion (3600 for hours to seconds) and nothing else")


def format_instant(epoch: float) -> str:
    """``YYYY-MM-DDTHH:MM:SS.mmmZ`` of an epoch, rounded to the millisecond; refuses a result out of range."""
    if not math.isfinite(epoch) or not FIRST_INSTANT <= epoch <= LAST_INSTANT:
        raise ToolError("the result is outside 2017-01-01 to 9999-12-31 UTC")
    sec, ms = divmod(round(epoch * 1000.0), 1000)
    return datetime.fromtimestamp(sec, UTC).strftime("%Y-%m-%dT%H:%M:%S") + f".{ms:03d}Z"
