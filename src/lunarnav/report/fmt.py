"""Formatting only. Every function here turns a number or an engine epoch into text; none computes a result.

Every number cell in the HTML also carries the exact value in `data-raw` (`raw`), so a reader or a test can
compare the displayed text with the engine's value.
"""

from __future__ import annotations

import html
import math
from datetime import datetime

from lunarnav.ephem import et_to_utc

MINUS = "\u2212"
DASH = "\u2013"
NA = "n/a"


def esc(text: object) -> str:
    return html.escape(str(text), quote=True)


def num(v: float | None, digits: int = 4) -> str:
    """`digits` significant figures, true minus sign; `n/a` for None or NaN."""
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return NA
    if isinstance(v, float) and math.isinf(v):
        return "\u221e" if v > 0 else MINUS + "\u221e"
    if isinstance(v, float) and v == 0.0:
        return "0"
    s = f"{v:.{digits}g}"
    if "e+" in s and abs(v) >= 1.0:
        s = f"{v:.0f}"
    if float(s) == 0.0:
        return "0"
    return s.replace("-", MINUS)


def signed(v: float | None, digits: int = 4) -> str:
    """Like `num` with an explicit plus sign for positive values (margins)."""
    if v is None:
        return NA
    s = num(v, digits)
    return s if s.startswith(MINUS) or s == NA else "+" + s


def raw(v: object) -> str:
    """Exact value for a `data-raw` attribute: a plain Python number (numpy scalars are converted), or the string itself."""
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    item = getattr(v, "item", None)
    if callable(item):
        v = item()
    return repr(v)


FRACTION = "fraction"


def scale(v: float | None, unit: str) -> float | None:
    """Display value: a fraction (of capacity or of time) is shown as a percentage; nothing else changes."""
    return None if v is None else v * 100.0 if unit == FRACTION else v


def unit_label(unit: str) -> str:
    return "%" if unit == FRACTION else "\u00b0" if unit == "deg" else unit


def span(lo, hi, fmt) -> str:
    a, b = fmt(lo), fmt(hi)
    return a if a == b else f"{a} {DASH} {b}"


def qty(v: float | None, unit: str, *, plus: bool = False, digits: int = 4) -> str:
    """Number in display units, without the unit."""
    return (signed if plus else num)(scale(v, unit), digits)


MARGIN_KIND_NOTE = ("Margins are worst-case. A failing point shows its nominal margin, marked (nominal), or, where the lander heading is unknown, "
                    "the margin at the upper bound over headings, marked (upper bound over headings). Margins of different kinds do not compare.")


def signed_kind(value, kind: str | None) -> str:
    """A signed margin followed by the engine's `margin_kind` where it is not the worst case."""
    text = signed(value)
    label = {"nominal": " (nominal)", "best_case": " (upper bound over headings)"}.get(kind or "", "")
    return text + label if value is not None else text


def kind_notes(items) -> list[str]:
    """The distinct engine notes (`margin_note`) of the `(kind, note)` pairs that are not a worst-case margin, in first-seen order."""
    seen: dict[str, None] = {}
    for kind, note in items:
        if kind not in (None, "worst_case") and note:
            seen.setdefault(note)
    return list(seen)


BASIS_LABEL = {"model-typed": "typed by the assistant, not confirmed"}


def basis_label(basis: str) -> str:
    """An origin basis as the report prints it: the engine's name, except a value an assistant typed and nobody confirmed."""
    return BASIS_LABEL.get(basis, basis)


def _trim(v: float, digits: int) -> str:
    s = f"{v:.{digits}f}"
    return s.rstrip("0").rstrip(".") if "." in s else s


def hours_or_days(h: float, plus: bool = False) -> str:
    a = abs(h)
    body = f"{_trim(a, 1)} h" if a < 48 else f"{_trim(a / 24.0, 1)} days"
    sign = MINUS if h < 0 and body != "0 h" else "+" if plus and h > 0 and body != "0 h" else ""
    return sign + body


def amount(v: float | None, unit: str, plus: bool = False) -> str:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return DASH
    if unit == "h":
        return hours_or_days(v, plus)
    if unit == "deg":
        return ("+" if plus and v > 0 else "") + f"{v:.1f}".replace("-", MINUS) + "°"
    if unit == FRACTION:
        return ("+" if plus and v > 0 else "") + f"{v * 100.0:.1f}".replace("-", MINUS) + " %"
    return f"{(signed if plus else num)(v)} {unit}".strip()


def limit_amount(lo: float | None, hi: float | None, unit: str) -> str:
    if lo is not None and hi is not None:
        return f"{amount(lo, unit)} {DASH} {amount(hi, unit)}"
    if lo is not None:
        return f"≥ {amount(lo, unit)}"
    if hi is not None:
        return f"≤ {amount(hi, unit)}"
    return DASH


def _when(d: datetime) -> str:
    return f"{d.day} {d:%b %Y %H:%M} UTC"


def when(et: float | None) -> str:
    if et is None or math.isnan(et):
        return DASH
    return when_utc(et_to_utc(float(et), 0))


def when_utc(text: str | None) -> str:
    if not text:
        return DASH
    return _when(datetime.fromisoformat(text.replace("Z", "+00:00")))
