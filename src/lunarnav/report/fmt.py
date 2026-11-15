"""Formatting only. Every function here turns a number or an engine epoch into text; none computes a result.

Every number cell in the HTML also carries the exact value in `data-raw` (`raw`), so a reader or a test can
compare the displayed text with the engine's value.
"""

from __future__ import annotations

import html
import math

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


def parse_num(text: str) -> float:
    """Inverse of `num`/`signed` for tests and readers."""
    return float(text.replace(MINUS, "-").replace("+", "").strip())


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


def utc(et: float | None) -> str:
    """UTC with Z suffix to the second, from the engine's own conversion."""
    if et is None or math.isnan(et):
        return NA
    return et_to_utc(float(et), 0)


def utc_range(rng: tuple[float, float]) -> str:
    """Earliest and latest UTC of an edge range."""
    a, b = rng
    return f"{utc(a)} {DASH} {utc(b)}"


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


def limit_text(lo: float | None, hi: float | None, unit: str, with_unit: bool = True) -> str:
    u = f" {unit_label(unit)}" if with_unit and unit else ""
    if lo is not None and hi is not None:
        return f"{span(lo, hi, lambda v: qty(v, unit, digits=10))}{u}"
    if lo is not None:
        return f"\u2265 {qty(lo, unit, digits=10)}{u}"
    if hi is not None:
        return f"\u2264 {qty(hi, unit, digits=10)}{u}"
    return NA


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


CASE_DETAIL = {"horizon": {"nominal": "nominal terrain", "optimistic": "optimistic case (lower horizon bracket)",
                           "pessimistic": "pessimistic case (upper horizon bracket)"},
               "heading": {"optimistic": "upper bound over headings", "pessimistic": "lower bound over headings"}}
LIMIT_SIDE = {"min": "minimum limit", "max": "maximum limit"}
CASES = ("nominal", "optimistic", "pessimistic")


def case_label(c, world: str, short: bool = False) -> str:
    """A case of a constraint verdict as the planner reads it: with an unknown lander heading (`case_basis` "heading") the optimistic
    and pessimistic cases are the upper and the lower bound over headings, otherwise brackets of the horizon (`nominal` is always the nominal case)."""
    if world == "nominal":
        return "nominal"
    if short:
        return CASE_DETAIL["heading"][world] if c.case_basis == "heading" else world
    return CASE_DETAIL.get(c.case_basis, {}).get(world, f"{world} case")


def worst_case_text(c, short: bool = False) -> str:
    """Which case gives a constraint's worst margin and which limit binds there, as the engine states them (`worst_world`,
    `worst_limit`, `case_basis`); empty where the engine names no case."""
    if c.worst_world is None:
        return ""
    side = LIMIT_SIDE.get(c.worst_limit or "")
    if short:
        return case_label(c, c.worst_world, True) + (f", {c.worst_limit} limit" if side else "")
    return case_label(c, c.worst_world) + (f", against the {side}" if side else "")


def values_by_case(c, unit_text, short: bool = False) -> str:
    """The value in each case that has one (`value_worlds`), labelled by `case_label`, or empty where they read the same; `unit_text`
    formats one value."""
    texts = {w: unit_text(c.value_worlds[w]) for w in CASES if c.value_worlds.get(w) is not None}
    if len(set(texts.values())) <= 1:
        return ""
    return "; ".join(f"{case_label(c, w, short)}: {t}" for w, t in texts.items())


def heading_facts_text(c) -> str:
    """The engine's single-heading facts of a heading-dependent constraint (`heading_best`, `heading_worst`) as one line, with the
    engine's own basis sentence; empty where the engine states none."""
    b, w = getattr(c, "heading_best", None), getattr(c, "heading_worst", None)
    if not b or not w:
        return ""
    u = unit_label(c.unit)
    arcs = ", ".join(f"{num(a)}\u00b0 to {num(z)}\u00b0" for a, z in w["arcs_deg"])
    return (f"Best single heading {num(b['yaw_deg'])}\u00b0: {qty(b['value'], c.unit)} {u}; worst {num(w['yaw_deg'])}\u00b0 "
            f"(arc {arcs}): {qty(w['value'], c.unit)} {u} ({b['horizon']} horizon). {getattr(c, 'heading_basis', '')}").strip()
