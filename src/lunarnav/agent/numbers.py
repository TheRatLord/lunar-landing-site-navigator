"""Extraction of quantities (numbers, UTC instants, calendar dates) from text, and the matching rules.

The final-answer guard (`guard.py`) uses this to decide whether each number a report shows can be
traced to a tool result. Matching is deliberately about *display rounding*: a shown value ``a`` with
``d`` decimals matches a registry value ``c`` when ``|a - c| <= 0.5 * 10**-d`` after unit conversion.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")

_TIME_FACTOR = {"s": 1.0, "min": 60.0, "h": 3600.0, "d": 86400.0}
_LENGTH_FACTOR = {"mm": 0.001, "cm": 0.01, "m": 1.0, "km": 1000.0}
_UNIT_ALIASES: dict[str, str] = {
    "%": "%", "percent": "%", "°": "deg", "deg": "deg", "degree": "deg", "degrees": "deg",
    "h": "h", "hr": "h", "hrs": "h", "hour": "h", "hours": "h",
    "min": "min", "mins": "min", "minute": "min", "minutes": "min",
    "s": "s", "sec": "s", "secs": "s", "second": "s", "seconds": "s",
    "d": "d", "day": "d", "days": "d",
    "m": "m", "meter": "m", "meters": "m", "metre": "m", "metres": "m",
    "km": "km", "kilometer": "km", "kilometers": "km", "kilometre": "km", "kilometres": "km",
    "w": "W", "watt": "W", "watts": "W", "wh": "Wh", "kwh": "kWh", "db": "dB", "dbw": "dBW",
    "dbk": "dBK", "dbi": "dBi", "kw": "kW", "cm": "cm", "mm": "mm", "fraction": "fraction", "x": "x", "ppd": "ppd", "kg": "kg", "hz": "Hz", "ghz": "GHz", "mhz": "MHz",
}
_UNIT_RE = re.compile(
    r"^\s{0,1}(%|°|[A-Za-z]{1,12})(?![A-Za-z])", re.ASCII)

DEFINITIONAL = frozenset({24.0, 60.0, 90.0, 180.0, 360.0, 1000.0})
"""Unitless (or degree) integers that are definitions, not results (hours in a day, a full circle ...). 0, 1 and 100
are results when they carry a unit or count something (0 % shadow, 100 % sunlit), so they are not listed."""

_COUNTED = re.compile(
    r"\s*(?:of\s+(?:the\s+)?(?:\d|(?:one|two|three|four|five|six|seven|eight|nine|ten)\b)|(?:slip|site|window|lunation|candidate|pass|constraint|scenario|station|event|sample|cell|orbit|eclipse|"
    r"sunset|sunrise|landing|opportunit|failure|violation|heading|day|week|margin)\w*)", re.IGNORECASE)
"""A small integer followed by one of these (or by ``of N``) counts something and is a result, not a list marker."""

_ORDINAL = re.compile(r"^(?:st|nd|rd|th)$", re.IGNORECASE)
_COMPASS = frozenset("NESnes")
_ZONE = (r"(?:(?i:UTC|GMT|Z|[ap]\.?m\.?|(?:UTC|GMT)[+-]\d{1,2}(?::?\d{2})?|[+-](?:0\d|1[0-4]):?[0-5]\d|"
         r"EST|EDT|CST|CDT|MST|MDT|PST|PDT|AKST|AKDT|HST|CET|CEST|EET|EEST|WET|WEST|BST|IST|JST|KST|MSK|AEST|AEDT|"
         r"NZST|NZDT|SGT|HKT|PKT|PHT)|"
         r"(?-i:[Ll]ocal(?:\s+time)?|[A-Z][a-z]+\s+time|[A-Z]{2,5}\s+time|[ECMP]T))")
"""A zone written after a clock time: the listed abbreviations and offsets, and any other zone word (``local time``,
``Houston time``, ``CT``). Only UTC, GMT, Z and +00:00 mean UTC (`is_utc_zone`); every other one is a `time_zone` issue."""
_CLOCK = re.compile(r"(?<![\w:.])(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:\s?(" + _ZONE + r"))?(?![\w:])")
_GAP_AFTER = re.compile(
    r"[\s,;]*(?:(?:at|around|about|near|approximately|approx\.?|circa|roughly|from|by|until|till|before|after|to|on)\s+|~\s*)?",
    re.IGNORECASE)
_GAP_BEFORE = re.compile(r"[\s,;]*(?:(?:on|of)\s+)?", re.IGNORECASE)
_ISO = re.compile(
    r"(?<![\w-])(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(?:\s?(" + _ZONE + r"))?)?(?![\w:])")
_MONTH = (r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|"
          r"oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)")
_DMY = re.compile(r"(?<![\w-])(\d{1,2})(?:st|nd|rd|th)?\s+" + _MONTH + r"\.?(?:,?\s+(\d{4}))?(?!\w)", re.IGNORECASE)
_MDY = re.compile(r"(?<![\w-])" + _MONTH + r"\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?!\d)(?:,?\s+(\d{4}))?", re.IGNORECASE)
_NUM = re.compile(
    r"(?<![\w.])(?<![A-Za-z]-)(?:(?<=[\s(=:\[/,;~\u2248<>\u2264\u2265])[-+\u2212\u2013]|(?<=^)[-+\u2212\u2013])?"
    r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][-+]?\d+)?")
_RANGE_TAIL = re.compile(r"\s*(?:to|and|-|\u2013|\u2014)\s*[-+]?\d[\d,]*(?:\.\d+)?(.*)", re.IGNORECASE | re.DOTALL)
"""The second end of a range (``20 to 30 degrees``, ``5-10 h``): the first end carries the unit written after it."""
_HYPHEN_UNIT = re.compile(r"-([A-Za-z]{1,12})(?![A-Za-z])")
_GAP_WORDS = re.compile(r"((?: [A-Za-z]{2,12}){1,3})(?![A-Za-z])")
_LONG_UNITS = frozenset({"hours", "hour", "days", "day", "minutes", "minute", "seconds", "second", "degrees", "degree",
                         "percent", "kilometres", "kilometers", "metres", "meters"})
_FILLER_STOP = frozenset({"and", "or", "of", "the", "to", "in", "at", "on", "for", "by", "with", "from", "than", "an",
                          "is", "are", "was", "were", "after", "before", "about", "per", "as", "but", "if", "then",
                          "over", "under", "into", "out", "off", "not", "that", "this", "which", "when"})
"""Words that end the search for a unit after a number: "3 sites over 5 days" is not 3 days."""


@dataclass(frozen=True, slots=True)
class Quantity:
    """A number, instant or date found in text."""

    kind: str
    """``number``, ``time`` (UTC instant) or ``date`` (calendar date; ``month_day`` when no year)."""
    text: str
    line: int
    value: float
    decimals: int = 0
    unit: str = ""
    year: int | None = None
    month: int | None = None
    day: int | None = None
    precision_s: float = 0.0
    """Display resolution of a time in seconds (60 when shown to the minute)."""
    explicit_sign: bool = False
    """The number was written with a leading ``+`` or ``-``: its sign must then match the source's."""
    tod_s: float | None = None
    """Time of day in seconds of a clock time given without a year (``12 Feb 03:17 UTC``, or a bare ``03:17 UTC``)."""
    zone: str = ""
    """A time zone other than UTC written with a clock time (``EST``, ``+05:30``); the answer must give UTC."""
    definitional: bool = False
    """A unitless or degree integer that is a constant of the geometry (24, 60, 90, 180, 360, 1000)."""

    @property
    def half_step(self) -> float:
        """Rounding tolerance of a displayed number, in its own unit."""
        return 0.5 * 10.0 ** (-self.decimals) * 1.0001


def parse_utc(text: str) -> float | None:
    """Seconds since the Unix epoch of an ISO-8601 UTC string, or None when it is not one."""
    m = _ISO.fullmatch(text.strip())
    if m is None or not is_utc_zone(m.group(8) or ""):
        return None
    return _iso_epoch(m)[0]


def _iso_epoch(m: re.Match[str]) -> tuple[float | None, float]:
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    hh = int(m.group(4)) if m.group(4) else 0
    mi = int(m.group(5)) if m.group(5) else 0
    ss = int(m.group(6)) if m.group(6) else 0
    frac = float(m.group(7)) if m.group(7) else 0.0
    if m.group(4) is None:
        precision = 86400.0
    elif m.group(6) is None:
        precision = 60.0
    elif m.group(7):
        precision = 10.0 ** (-(len(m.group(7)) - 1))
    else:
        precision = 1.0
    try:
        t = datetime(y, mo, d, min(hh, 23), mi, min(ss, 59), tzinfo=UTC).timestamp() + frac
    except ValueError:
        return None, precision
    return t, precision


def is_utc_zone(zone: str) -> bool:
    """Whether a zone suffix means UTC (none, ``Z``, ``UTC``, ``GMT``, ``+00:00``)."""
    z = zone.strip().upper()
    return z in ("", "Z", "UTC", "GMT") or re.fullmatch(r"[+-]00:?00", z) is not None


def unit_of(text: str) -> str:
    """Canonical unit for the unit word that follows a number ('' when it is not a known unit)."""
    return _UNIT_ALIASES.get(text.strip().lower(), _UNIT_ALIASES.get(text.strip(), ""))


def extract_quantities(text: str, *, line_offset: int = 0, keep_small: bool = False,
                       lists: bool = False) -> list[Quantity]:
    """All quantities in ``text`` (line numbers start at ``line_offset``).

    Dates and instants are consumed first so their digits do not reappear as numbers. With
    ``keep_small`` the exemptions (list markers, small unitless integers, definitional constants,
    years) are not applied; registries use it to collect everything a source states. With ``lists`` (a code block or
    JSON) a comma between digits separates two numbers (``[150,208]``) and is not a thousands separator.
    """
    out: list[Quantity] = []
    for i, line in enumerate(with_header_units(text.split("\n"))):
        out.extend(_line_quantities(line, i + line_offset, keep_small, lists))
    return out


_HEADER_UNIT = re.compile(r"\(([^)]*)\)|\[([^\]]*)\]|,\s*([A-Za-z\u00b0%]+)\s*$")
_TABLE_SEPARATOR = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$")
_BARE_NUMBER = re.compile(r"^\s*[-+\u2212]?\d[\d,]*(?:\.\d+)?\s*$")


def _cells(line: str) -> list[str]:
    return line.strip().strip("|").split("|")


def with_header_units(lines: list[str]) -> list[str]:
    """The lines with the unit of a Markdown table header written after each bare number of its column
    (``| Wait (days) |`` over ``| 562 |`` reads as ``562 days``). The line count is unchanged."""
    out = list(lines)
    i = 0
    while i + 1 < len(lines):
        if not lines[i].lstrip().startswith("|") or not _TABLE_SEPARATOR.match(lines[i + 1]):
            i += 1
            continue
        units: list[str] = []
        for cell in _cells(lines[i]):
            word = ""
            for m in _HEADER_UNIT.finditer(cell):
                cand = next(g for g in m.groups() if g is not None).strip()
                if unit_of(cand):
                    word = cand
                    break
            units.append(word)
        j = i + 2
        while j < len(lines) and lines[j].lstrip().startswith("|"):
            cells = _cells(lines[j])
            out[j] = "|" + "|".join(
                f"{c} {units[k]} " if k < len(units) and units[k] and _BARE_NUMBER.match(re.sub(r"[*`]", "", c)) else c
                for k, c in enumerate(cells)) + "|"
            j += 1
        i = j
    return out


_LEADING_UNIT = (re.compile(r"\bin\s+([A-Za-z]+)\s*(?:is|are|was|were|=|:)?\s*$", re.IGNORECASE),
                 re.compile(r"(?<![\w])([A-Za-z]+)\s*[:=]\s*$"))


def _leading_unit(before: str) -> str:
    """Unit written before a number: ``in days is 562``, ``hours: 562``, ``days = 562`` ('' if none)."""
    for rx in _LEADING_UNIT:
        m = rx.search(before)
        if m is not None and unit_of(m.group(1)):
            return unit_of(m.group(1))
    return ""


def _normalise(line: str) -> str:
    """Plain text of one Markdown line: no emphasis, table pipes or backticks, one kind of space and minus."""
    line = re.sub(r"[\u2010\u2011\u2012\u2212\ufe63\uff0d]", "-", line)
    line = re.sub(r"\bminus\s+(?=\d)", "-", line, flags=re.IGNORECASE)
    line = re.sub(r"[\s\u00a0\u2009\u202f]+", " ", line)
    line = re.sub(r"[*`]", "", line).replace("|", " ")
    return re.sub(r"(?<!\w)_+|_+(?!\w)", "", line)


def _line_quantities(line: str, lineno: int, keep_small: bool, lists: bool = False) -> list[Quantity]:
    found: list[Quantity] = []
    work = _normalise(line)
    if lists:
        work = re.sub(r"(?<=\d),(?=\d)", ", ", work)
    if not keep_small:
        work = re.sub(r"^\s*(?:#+\s*)?(?:[-+]\s+)?(?:\d+[.)]\s+)?", lambda m: " " * len(m.group(0)), work)

    def blank(start: int, end: int) -> None:
        nonlocal work
        work = work[:start] + " " * (end - start) + work[end:]

    dates: list[tuple[int, int, str, int | None, int, int]] = []
    for m in list(_ISO.finditer(work)):
        t, precision = _iso_epoch(m)
        if m.group(4) is None:
            dates.append((m.start(), m.end(), m.group(0).strip(), int(m.group(1)), int(m.group(2)), int(m.group(3))))
            continue
        zone = m.group(8) or ""
        found.append(Quantity(
            "time", m.group(0).strip(), lineno, t if t is not None else math.nan, year=int(m.group(1)),
            month=int(m.group(2)), day=int(m.group(3)), precision_s=precision, zone="" if is_utc_zone(zone) else zone))
        blank(m.start(), m.end())
    for rx, order in ((_DMY, "dm"), (_MDY, "md")):
        for m in list(rx.finditer(work)):
            if order == "dm":
                day, mon, year = int(m.group(1)), m.group(2), m.group(3)
            else:
                mon, day, year = m.group(1), int(m.group(2)), m.group(3)
            if 1 <= day <= 31:
                dates.append((m.start(), m.end(), m.group(0).strip(), int(year) if year else None,
                              MONTHS.index(mon[:3].lower()) + 1, day))
    clocks = list(_CLOCK.finditer(work))
    used: set[int] = set()
    for start, end, text, year, month, day in sorted(dates):
        clock = None
        gap = _GAP_AFTER.match(work, end)
        after = _CLOCK.match(work, gap.end()) if gap else None
        if after is not None and after.start() not in used:
            clock = after
        else:
            for c in reversed([c for c in clocks if c.end() <= start and c.start() not in used]):
                g = _GAP_BEFORE.fullmatch(work, c.end(), start)
                if g is not None:
                    clock = c
                break
        if clock is None:
            found.append(Quantity("date", text, lineno, math.nan, year=year, month=month, day=day, precision_s=86400.0))
        else:
            used.add(clock.start())
            found.append(_dated_clock(text, clock, lineno, year, month, day))
        blank(start, end)
    for c in clocks:
        if c.start() in used:
            blank(c.start(), c.end())
        else:
            found.append(_dated_clock("", c, lineno, None, None, None))
            blank(c.start(), c.end())
    for m in _NUM.finditer(work):
        raw = m.group(0).replace("\u2013", "-")
        tail = work[m.end():]
        unit, span = _read_unit(m.group(0), tail)
        if unit is None:
            continue
        if unit == "":
            unit = _leading_unit(work[:m.start()])
        if tail[:1] == "." and tail[1:2].isdigit():
            continue
        cleaned = raw.replace(",", "").replace(" ", "")
        try:
            value = float(cleaned)
        except ValueError:
            continue
        mant = cleaned.split("e")[0].split("E")[0]
        decimals = len(mant.split(".")[1]) if "." in mant else 0
        q = Quantity("number", raw.strip() + tail[:span].strip(), lineno, value, decimals, unit,
                     explicit_sign=cleaned[0] in "+-",
                     definitional=unit in ("", "deg") and abs(value) in DEFINITIONAL and decimals == 0)
        if not keep_small and _exempt(q, raw, tail):
            continue
        found.append(q)
    return found


def _read_unit(raw: str, tail: str) -> tuple[str | None, int]:
    """Unit that goes with the number ``raw`` followed by ``tail``: ``(unit, characters used)``.

    ``('', 0)`` is a plain number; ``(None, 0)`` means the letters after the number are not a unit (an
    identifier or an ordinal), so there is no quantity. A unit may be glued (``3.7kW``), follow a space,
    follow a hyphen (``562-day``) or follow a short gap (``562 Earth days``, ``97 full days``).
    """
    um = _UNIT_RE.match(tail) if tail[:1] in ("%", "°", " ") or tail[:1].isalpha() else None
    if um is not None:
        word = um.group(1)
        unit = unit_of(word)
        if unit:
            return unit, len(um.group(0))
        if tail[:1].isalpha():
            glued = None if "e" in raw.lower() else _glued_unit(word, tail[len(word):len(word) + 1])
            return (glued, len(um.group(0))) if glued is not None else (None, 0)
    elif tail[:1].isalpha():
        return None, 0
    hy = _HYPHEN_UNIT.match(tail)
    if hy is not None and unit_of(hy.group(1)):
        return unit_of(hy.group(1)), hy.end()
    gap = _GAP_WORDS.match(tail)
    if gap is not None:
        used = 0
        for i, word in enumerate(gap.group(1).split()):
            used = tail.index(word, used) + len(word)
            if word.lower() in _FILLER_STOP:
                break
            if i >= 1 and word.lower() in _LONG_UNITS:
                return unit_of(word), used
    rng = _RANGE_TAIL.match(tail)
    if rng is not None:
        unit, _ = _read_unit("", rng.group(1))
        if unit:
            return unit, 0
    return "", 0


def _glued_unit(word: str, following: str) -> str | None:
    """Unit of letters glued to a number (``3.7kW``, ``95K``, ``84.3N``); None for ordinals and identifiers."""
    if following.isalnum() or following == "_" or len(word) > 4 or _ORDINAL.match(word):
        return None
    if word in ("z", "Z", "T"):
        return None
    if word in _COMPASS:
        return "deg"
    return word.lower()


def _dated_clock(date: str, clock: re.Match[str], lineno: int, year: int | None, month: int | None,
                 day: int | None) -> Quantity:
    """A clock time (``03:17 UTC``), with the calendar date written beside it when there is one, as a time of day."""
    hh, mi = int(clock.group(1)), int(clock.group(2))
    ss = int(clock.group(3)) if clock.group(3) else 0
    precision = 1.0 if clock.group(3) else 60.0
    tod = hh * 3600.0 + mi * 60.0 + ss
    zone = clock.group(4) or ""
    text = (date + " " + clock.group(0)).strip()
    epoch = math.nan
    if year is not None and month is not None and day is not None:
        try:
            epoch = datetime(year, month, day, min(hh, 23), mi, min(ss, 59), tzinfo=UTC).timestamp()
        except ValueError:
            epoch = math.nan
    return Quantity("time", text, lineno, epoch, year=year, month=month, day=day, precision_s=precision, tod_s=tod,
                    zone="" if is_utc_zone(zone) else zone)


def _exempt(q: Quantity, raw: str, tail: str = "") -> bool:
    """Numbers nobody needs a source for: list markers, small unitless integers, years."""
    v = abs(q.value)
    if q.unit == "" and "." not in raw and "e" not in raw.lower():
        if v <= 10 and not _COUNTED.match(tail):
            return True
        if 1900 <= v <= 2100:
            return True
    return False


def _factors(unit: str) -> dict[str, float] | None:
    if unit in _TIME_FACTOR:
        return _TIME_FACTOR
    if unit in _LENGTH_FACTOR:
        return _LENGTH_FACTOR
    return None


def factors(hint: str, shown_unit: str) -> list[float]:
    """Multipliers turning a registry value with unit ``hint`` into ``shown_unit`` for matching (empty: it cannot).

    * A shown time or length unit matches a value whose field unit is in the same family, converted (562 h is not
      "562 days"), or a value with no field unit as it stands (never converted across units).
    * ``%`` matches a ``%`` field as it stands and a ``fraction`` field times 100. An unlabelled value above 1 in
      magnitude matches as it stands; an unlabelled value of 1 or less never matches a percentage (1 % is not the
      fraction 1.0, 62 % is not an unlabelled 0.62).
    * An integer with no field unit is a ``count``: it never acquires a unit (3 sunlit windows are not "72 h",
      2 outages are not "120 min", 3 is not "300 %").
    * An unspecified shown unit matches any value; any other shown unit matches a value of that unit or of
      no known unit (a margin field named without a unit suffix).
    """
    if shown_unit == "":
        return [1.0]
    if hint == "count":
        return []
    fam = _factors(shown_unit)
    if fam is not None:
        return [fam[hint] / fam[shown_unit]] if hint in fam else [1.0] if hint == "" else []
    if shown_unit == "%":
        return [1.0] if hint == "%" else [100.0] if hint == "fraction" else [1.0] if hint == "" else []
    return [1.0] if hint in ("", shown_unit) else []


def matches(q: Quantity, value: float, hint: str = "") -> bool:
    """Whether the shown number ``q`` can be a rounded display of registry ``value``."""
    if not math.isfinite(value):
        return False
    return any(_close(q, value * f) for f in factors(hint, q.unit)
               if not (q.unit == "%" and hint == "" and f == 1.0 and abs(value) <= 1.0))


def _close(q: Quantity, scaled: float) -> bool:
    """Shown number against a registry value in the shown unit: the sign counts when it was written."""
    target, other = (q.value, scaled) if q.explicit_sign else (abs(q.value), abs(scaled))
    return abs(target - other) <= q.half_step + 1e-9 * max(1.0, abs(scaled))


def _within(registry_minus_shown_s: float, precision_s: float) -> bool:
    """Whether a registry instant can be what a time shown to ``precision_s`` displays: rounded to the nearest unit, or,
    for a time shown to the minute or coarser, truncated (19:50 for 19:50:50). A different minute never matches."""
    diff = registry_minus_shown_s
    half = max(precision_s / 2, 1.0) + 1e-6
    if precision_s >= 60.0:
        return -half <= diff < precision_s - 1e-6
    return abs(diff) <= half


def time_matches(q: Quantity, epoch_s: float) -> bool:
    """Whether a shown instant or date can be a display of the registry instant ``epoch_s`` (Unix s)."""
    dt = datetime.fromtimestamp(epoch_s, UTC)
    if q.kind == "time" and q.tod_s is not None and not math.isfinite(q.value):
        tod = dt.hour * 3600.0 + dt.minute * 60.0 + dt.second
        if q.month is None:
            return _within(tod - q.tod_s, q.precision_s)
        return q.month == dt.month and q.day == dt.day and _within(tod - q.tod_s, q.precision_s)
    if q.kind == "time":
        if not math.isfinite(q.value):
            return False
        return _within(epoch_s - q.value, q.precision_s)
    if q.year is not None and q.year != dt.year:
        return False
    return q.month == dt.month and q.day == dt.day


def walk_leaves(obj: Any, hint: str = "", key: str = "") -> list[tuple[str, Any, str]]:
    """Flatten JSON into ``(key, leaf, unit_hint)``; the hint comes from a sibling ``unit`` field or the
    key suffix (``..._h``, ``..._deg``, ``..._m`` ...)."""
    out: list[tuple[str, Any, str]] = []
    if isinstance(obj, dict):
        local = unit_of(obj["unit"]) if isinstance(obj.get("unit"), str) else hint
        for k, v in obj.items():
            out.extend(walk_leaves(v, local or "", str(k)))
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            out.extend(walk_leaves(v, hint, key))
    elif isinstance(obj, bool) or obj is None:
        pass
    elif isinstance(obj, (int, float, str)):
        out.append((key, obj, _hint_from_key(key) or hint))
    return out


_KEY_HINTS = (("_hours", "h"), ("_h", "h"), ("_days", "d"), ("_d", "d"), ("_min", "min"), ("_s", "s"),
              ("_km", "km"), ("_m", "m"), ("_deg", "deg"), ("_pct", "%"))


def _hint_from_key(key: str) -> str:
    low = key.lower()
    if ("fraction" in low or "efficiency" in low or "dod" in low or low in ("pass", "marginal", "fail", "open")
            or low.endswith(("_frac", "_share", "state_of_charge", "_soc"))):
        return "fraction"
    for suffix, unit in _KEY_HINTS:
        if low.endswith(suffix):
            return unit
    return ""
