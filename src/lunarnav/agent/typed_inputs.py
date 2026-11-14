"""Values the model sets, and where each one came from.

Every argument the model passes to an engine tool is one of two things: it *selects* what to compute (which scenario,
which site, which span, how many samples) or it *overrides* a value the engine would otherwise take from a catalogue,
a preset or its own default (a hazard limit, a mast height, a battery capacity, a mission length, a k-sigma). An
override changes what the engine computes, so it needs an origin: the planner's request, or the model.

* No value the model sets is ever the user's. Every one is **model typed**: the harness records ONE pending assumption per
  tool call listing each value (path, new value, replaced value) and attaches the limit ``scenario.typed`` with the same
  lines. When the user's request text contains the value with its unit (an exact conversion such as hours and days counts)
  the line quotes the request around it, as evidence for the person signing off. A lexical match cannot show that the
  user meant this parameter, so it never clears a mark and no origin of basis ``user`` is written for a value the model
  passed through a tool call.

`ROLES` classifies every field of every engine tool, so a new argument cannot reach the engine without a decision about
its origin.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel

from .numbers import extract_quantities, unit_of
from .store import RunPaths

SELECT, OVERRIDE, LEAVES, ECHO, IDENT, OWN = "select", "override", "leaves", "echo", "id", "own"
"""Roles of a tool argument: it selects what to compute; it overrides a value (needs an origin); an object whose leaves
are classified one by one (`build_scenario`); text the model wrote that selects nothing; an identifier of a record; a
value with its own, stricter handling (a stated heading, recorded as an assumption with the planner's words)."""

ROLES: dict[str, dict[str, str]] = {
    "catalog_search": dict.fromkeys(("kind", "query", "near_lat_deg", "near_lon_deg", "radius_km", "site_kind", "limit",
                                     "detail"), SELECT),
    "build_scenario": {
        "site": OWN, "lander": SELECT, "polar": SELECT, "layout": SELECT, "presets": SELECT,
        "constraints_id": IDENT, "network": SELECT, "network_direction": SELECT, "name": ECHO, "assumptions": IDENT,
        "heading_statement": ECHO, "heading_deg": OWN, "mission_duration_h": LEAVES, "landing_utc": LEAVES,
        "limits": LEAVES, "transfer": LEAVES, "ellipse": LEAVES, "patch": LEAVES},
    "evaluate_site": dict.fromkeys(("scenario_id", "terrain", "interval_kinds", "max_intervals"), SELECT),
    "scan_opportunities": {
        "scenario_id": IDENT, "terrain": SELECT, "start_utc": SELECT, "end_utc": SELECT, "spacing_h": SELECT,
        "signal_step_min": OVERRIDE, "lookback_h": OVERRIDE, "calendar_bin_h": OVERRIDE, "max_windows": SELECT},
    "slip_analysis": dict.fromkeys(("scenario_id", "terrain", "slips_h", "mode", "search_days"), SELECT),
    "rank_alternative_sites": dict.fromkeys(("scenario_id", "terrain", "sites", "slips_h", "mode", "search_days"), SELECT),
    "sensitivity": dict.fromkeys(("scenario_id", "terrain", "kind", "values_m"), SELECT),
    "attribute_event": dict.fromkeys(("scenario_id", "terrain", "kind", "from_utc", "window_h"), SELECT),
    "compare_scenarios": dict.fromkeys(("scenario_ids", "terrain"), SELECT),
    "illumination_stats": {
        "scenario_id": IDENT, "terrain": SELECT, "window": SELECT, "max_dark_gap_h": OVERRIDE,
        "min_light_span_h": OVERRIDE, "earth_masks_deg": OVERRIDE},
    "horizon_profile": {"lat_deg": SELECT, "lon_deg": SELECT, "mast_height_m": OVERRIDE, "terrain": SELECT,
                        "azimuths_deg": SELECT},
    "terrain_info": {"query": SELECT, "points": SELECT, "slope_baselines_m": OVERRIDE, "terrain": SELECT},
    "ephemeris_track": {"lat_deg": SELECT, "lon_deg": SELECT, "mast_height_m": OVERRIDE, "start_utc": SELECT,
                        "end_utc": SELECT, "step_min": SELECT, "bodies": SELECT, "terrain": SELECT},
    "ellipse_statistics": {"scenario_id": IDENT, "terrain": SELECT, "n_samples": SELECT, "seed": SELECT,
                           "hazard_slope_deg": OVERRIDE, "hazard_roughness_m": OVERRIDE},
    "search_sites": {"scenario_id": IDENT, "lat_deg": SELECT, "lon_deg": SELECT, "radius_m": SELECT,
                     "final_spacing_m": SELECT, "first_utc": SELECT, "last_utc": SELECT, "epoch_spacing_h": SELECT,
                     "top_k": SELECT, "min_separation_m": OVERRIDE, "terrain": SELECT},
    "export_results": {"scenario_id": IDENT, "prefix": ECHO, "terrain": SELECT, "slips_h": SELECT, "slip_mode": SELECT,
                       "scan_start_utc": SELECT, "scan_end_utc": SELECT, "scan_spacing_h": SELECT},
    "derive": {"expression": ECHO, "inputs": SELECT, "instants": SELECT, "result": SELECT, "unit": ECHO},
    "check_report": {"text": ECHO},
    "list_inbox": {},
    "ingest_terrain_dem": {"file": SELECT, "band": SELECT, "assume_metres": OVERRIDE, "allow_no_overlap": OVERRIDE},
    "relay_contacts": {"file": SELECT, "scenario_id": IDENT, "lat_deg": SELECT, "lon_deg": SELECT,
                       "mast_height_m": OVERRIDE, "start_utc": SELECT, "end_utc": SELECT, "step_s": SELECT,
                       "margin_deg": OVERRIDE, "spk_target": SELECT, "spk_step_s": SELECT, "terrain": SELECT},
    "read_document": {"file": SELECT, "sentence_ids": SELECT, "mentions": SELECT},
    "propose_constraints": {"file": SELECT, "proposals": SELECT, "presets": SELECT, "apply_ambiguous": OVERRIDE},
}
"""Role of every argument of every engine tool. An override is compared with the field's default; one that differs and
is not in the user's request is model typed."""

OVERRIDE_UNITS: dict[str, str] = {
    "signal_step_min": "min", "lookback_h": "h", "calendar_bin_h": "h", "max_dark_gap_h": "h", "min_light_span_h": "h",
    "earth_masks_deg": "deg", "mast_height_m": "m", "slope_baselines_m": "m", "hazard_slope_deg": "deg",
    "hazard_roughness_m": "m", "min_separation_m": "m", "margin_deg": "deg", "assume_metres": "",
    "allow_no_overlap": "", "apply_ambiguous": ""}
"""Unit of each override argument, as the user would write it."""

_ALTERNATIVES: dict[str, tuple[tuple[str, float], ...]] = {
    "h": (("d", 1 / 24),), "d": (("h", 24.0),), "m": (("km", 1e-3),), "km": (("m", 1e3),),
    "fraction": (("%", 100.0), ("", 1.0)), "min": (("h", 1 / 60),), "s": (("min", 1 / 60), ("h", 1 / 3600))}
"""Exact unit conversions: the same quantity written another way."""

_SUFFIX_UNITS = (("_wh", "Wh"), ("_w", "W"), ("_db", "dB"), ("_km", "km"), ("_deg", "deg"), ("_h", "h"), ("_m", "m"),
                 ("_days", "d"), ("_min", "min"), ("_s", "s"), ("_m2", "m2"))
_FRACTIONS = ("efficiency", "fraction", "soc", "dod", "ratio", "albedo", "depth_of_discharge", "reserve")


def unit_for_path(path: str) -> str:
    """The unit a scenario path is written in, from its last component ('' when it has none)."""
    leaf = path.rsplit(".", 1)[-1].lower()
    if any(w in leaf for w in _FRACTIONS):
        return "fraction"
    for suffix, unit in _SUFFIX_UNITS:
        if leaf.endswith(suffix):
            return unit
    return ""


@dataclass(frozen=True, slots=True)
class SetValue:
    """One value the model set: where, to what, replacing what."""

    path: str
    value: Any
    replaced: Any
    unit: str = ""


@dataclass(frozen=True, slots=True)
class UserRequest:
    """The user's words of this run: their messages and the planner's sign-off notes."""

    text: str


def user_request(paths: RunPaths) -> UserRequest:
    """The user's request text of the run so far (read from the transcript and the assumption log)."""
    from .trace import request_text

    return UserRequest(request_text(paths))


def _request_part(req: UserRequest) -> Any:
    from .trace import Part

    part = Part("user_request", exact_units=True)
    part.add_text(req.text)
    return part


_CONTEXT_CHARS = 36


def _loose(token: str) -> str:
    """A pattern for ``token`` that allows blanks or a hyphen between its number and its unit and between its words."""
    m = re.match(r"([-+\u2212]?[\d.,]+)(.*)$", token)
    if m is None:
        return r"\s*".join(re.escape(c) for c in token if not c.isspace())
    return r"(?<![\w.])" + re.escape(m.group(1)) + r"[\s-]*" + r"\s*".join(re.escape(c) for c in m.group(2) if not c.isspace())


def _snippet(text: str, token: str) -> str:
    """A short verbatim piece of ``text`` around the first occurrence of ``token`` (whitespace collapsed, cut at words)."""
    flat = " ".join(text.split())
    needle = " ".join(token.split())
    i, n = flat.find(needle), len(needle)
    if i < 0:
        m = re.search(_loose(needle), flat, re.IGNORECASE)
        if m is None:
            return needle
        i, n = m.start(), m.end() - m.start()
    needle = flat[i:i + n]
    a, b = max(0, i - _CONTEXT_CHARS), min(len(flat), i + len(needle) + _CONTEXT_CHARS)
    if a > 0:
        cut = flat.find(" ", a, i)
        a = cut + 1 if cut >= 0 else a
    if b < len(flat):
        cut = flat.rfind(" ", i + len(needle), b)
        b = cut if cut >= 0 else b
    return ("…" if a > 0 else "") + flat[a:b] + ("…" if b < len(flat) else "")


def _number_quote(req: UserRequest, value: float, unit: str) -> str | None:
    forms = [(value, unit)] + [(value * f, u) for u, f in _ALTERNATIVES.get(unit, ())]
    for q in extract_quantities(req.text, keep_small=True):
        if q.kind != "number":
            continue
        for v, u in forms:
            shown = "" if u in ("", "fraction") else unit_of(u) or u
            if q.unit == shown and abs(q.value - v) <= 1e-9 * max(1.0, abs(v)):
                return _snippet(req.text, q.text)
    return None


def request_quote(req: UserRequest, value: Any, unit: str = "") -> str | None:
    """A short verbatim snippet of the user's request around ``value`` (with ``unit`` for a number), or None when the request
    does not contain it. It is evidence for the person signing off and nothing more: a lexical match does not establish that
    the user meant this parameter, so it never clears a mark. Booleans and empty values are never found; a container is found
    when every leaf is (the snippets are joined)."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return _number_quote(req, float(value), unit)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        when = [q for q in extract_quantities(text, keep_small=True) if q.kind in ("time", "date")]
        if when:
            part = _request_part(req)
            return _snippet(req.text, when[0].text) if all(part.finds(q) for q in when) else None
        return _snippet(req.text, text) if text.lower() in " ".join(req.text.lower().split()) else None
    leaves = list(value.values()) if isinstance(value, Mapping) else list(value) if isinstance(value, Sequence) else []
    quotes = [request_quote(req, v, unit) for v in leaves if v is not None]
    if not quotes or any(q is None for q in quotes):
        return None
    return " / ".join(dict.fromkeys(q for q in quotes if q))


def _show(value: Any) -> str:
    return json.dumps(value, sort_keys=True, default=str)[:160]


def typed_line(req: UserRequest, sv: SetValue) -> str:
    """The line that states one value the assistant set: path, value, replaced value, and the request text around it."""
    quote = request_quote(req, sv.value, sv.unit)
    found = f"your request contains '{quote}'" if quote else "not found in your request"
    return f"{sv.path} = {_show(sv.value)} (replaced {_show(sv.replaced)}; set by the assistant; {found})"


def record_set_values(call: Any, req: UserRequest, values: Sequence[SetValue]) -> None:
    """Queue every value the model set, none exempt, for `commit_typed`. A value found in the request is still the model's:
    the match is quoted for the person signing off, not trusted."""
    for sv in values:
        call.typed_lines.append(typed_line(req, sv))


def commit_typed(call: Any, via: str) -> str | None:
    """Record the queued values of this call as ONE pending assumption (one line per value) and attach ``scenario.typed``
    with the same lines. Returns the assumption id, or None when the model set nothing."""
    lines = sorted(dict.fromkeys(call.typed_lines))
    call.typed_lines.clear()
    if not lines:
        return None
    call.add_limits("scenario.typed")
    for line in lines:
        call.note("scenario.typed", line)
    digest = hashlib.sha256("\n".join(lines).encode()).hexdigest()[:12]
    return call.assume(
        f"set:{via}:{digest}",
        f"Inputs as the assistant set them in {via} (set by the assistant, not by the user; each line gives the path, the value, "
        "the value it replaced, and the text of your request around the value when one is found, or says it is not found):\n"
        + "\n".join(f"- {line}" for line in lines),
        f"Entered through {via}; a number found in your request is quoted as evidence only and does not make it your value.",
        "Every result computed with these values depends on them being the planner's; confirm or correct each one.")


def override_values(tool: str, args: BaseModel) -> list[SetValue]:
    """The override arguments of ``args`` that differ from the field's default."""
    roles = ROLES.get(tool, {})
    out: list[SetValue] = []
    for name, field in type(args).model_fields.items():
        if roles.get(name) != OVERRIDE:
            continue
        value = getattr(args, name)
        default = None if field.is_required() else field.get_default(call_default_factory=True)
        if value is None or value == default:
            continue
        replaced = "the engine's own value" if default is None else default
        out.append(SetValue(f"{tool}.{name}", value, replaced, OVERRIDE_UNITS[name]))
    return out


def mark_overrides(call: Any, tool: str, args: BaseModel) -> None:
    """Mark the override arguments of an analysis call (see `override_values`): one assumption for the call."""
    values = override_values(tool, args)
    if values:
        record_set_values(call, user_request(call.ctx.paths), values)
        commit_typed(call, tool)
