"""Which string fields of a tool result are a source of numbers: default deny.

A number is citable from (i) the numeric leaves of the structured output and (ii) strings that are declared here.
Every string field of every tool result is declared as one of:

* ``time``   an instant the engine wrote (``..._utc``, ``utc``): citable as an instant;
* ``engine`` text the engine, a catalogue or a dataset authored (a note, a warning, a dataset label): citable;
* ``echo``   text a person or the model supplied (a scenario name, a note typed into a request, quotes of a user's
  file, an expression): never citable, wherever it reappears;
* ``id``     an identifier, hash, path, enumeration or fixed label: never citable;
* ``display`` text made for reading (the one-line summary, the text of a limit): never citable. Limits and
  summaries repeat numbers that are in the structured fields, and a name or a unit the model chose reappears in a
  summary.

A path no rule covers is not citable, and ``unclassified`` reports it: any
string path of a tool result that no rule covers is unclassified. Paths are dotted keys, lists transparent, ``*`` matches any run of
characters (a dict key, a nested path). The first matching rule wins; a tool's own rules come before the ``*`` rules.
"""

from __future__ import annotations

import re
from fnmatch import fnmatchcase
from typing import Any

CITABLE = frozenset({"time", "engine"})
"""Classes whose strings are a source of numbers."""

CLASSES = frozenset({"time", "engine", "echo", "id", "display"})

_ISO_INSTANT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}")

_ENGINE_TOOLS = ("*",)

RULES: tuple[tuple[str, str, str], ...] = (
    ("*", "*utc", "time"),
    ("*", "*_at", "time"),
    ("*", "*margin_kind", "id"),
    ("*", "*margin_note", "engine"),
    ("*", "*when_basis", "display"),
    ("*", "*_worlds", "id"),
    ("*", "scenario.name", "echo"),
    ("*", "scenario.*.basis", "echo"),
    ("*", "scenario.constraints.*", "echo"),
    ("*", "scenario.profile.*", "id"),
    ("*", "scenario.site.*", "id"),
    ("*", "scenario.network.*", "id"),
    ("*", "scenario.eclipse.*", "id"),
    ("*", "scenario.ellipse.*", "id"),
    ("*", "scenario.terrain_error.*", "id"),
    ("*", "scenario.transfer.*", "id"),
    ("*", "scenario.landing_utc", "time"),
    ("derive", "expression", "echo"),
    ("derive", "unit", "id"),
    ("derive", "inputs.*", "id"),
    ("derive", "summary", "display"),
    ("check_report", "*", "echo"),
    ("record_assumption", "assumption_id", "id"),
    ("record_assumption", "recorded_at", "time"),
    ("register_artifact", "*", "id"),
    ("export_results", "*", "id"),
    ("fetch_data", "fetched_at", "time"),
    ("fetch_data", "*", "id"),
    ("list_inbox", "*", "id"),
    ("list_saved_scenarios", "scenarios.updated_utc", "time"),
    ("list_saved_scenarios", "scenarios.landing_utc", "time"),
    ("list_saved_scenarios", "*", "id"),
    ("load_saved_scenario", "scenario.*", "id"),
    ("load_saved_scenario", "*", "id"),
    ("ellipse_statistics", "result.scenario_name", "echo"),
    ("ellipse_statistics", "result.scheme", "engine"),
    ("ellipse_statistics", "result.*", "id"),
    ("rank_alternative_sites", "sites.name", "id"),
    ("rank_alternative_sites", "sites.slips.heading_note", "engine"),
    ("rank_alternative_sites", "ranking_rule", "engine"),
    ("rank_alternative_sites", "sites.*", "id"),
    ("read_document", "*", "engine"),
    ("propose_constraints", "*.quote", "echo"),
    ("propose_constraints", "*.message", "echo"),
    ("propose_constraints", "*.detail*", "echo"),
    ("propose_constraints", "*.conversions", "engine"),
    ("propose_constraints", "*", "id"),
    ("ingest_terrain_dem", "*.message", "echo"),
    ("ingest_terrain_dem", "*.detail*", "echo"),
    ("ingest_terrain_dem", "report.warnings.message", "engine"),
    ("ingest_terrain_dem", "report.datum_statement", "engine"),
    ("ingest_terrain_dem", "report.name", "echo"),
    ("ingest_terrain_dem", "report.crs_name", "echo"),
    ("ingest_terrain_dem", "report.crs_summary.*", "echo"),
    ("ingest_terrain_dem", "*", "id"),
    ("terrain_info", "rows.source.*", "engine"),
    ("terrain_info", "*", "id"),
    ("catalog_search", "rows.notes", "engine"),
    ("catalog_search", "rows.frame_note", "engine"),
    ("catalog_search", "rows.status", "engine"),
    ("catalog_search", "rows.planned_date", "engine"),
    ("catalog_search", "rows.sources.locator", "engine"),
    ("catalog_search", "rows.sources.title", "engine"),
    ("catalog_search", "rows.profile.description", "engine"),
    ("catalog_search", "rows.profile.origins.*", "engine"),
    ("catalog_search", "rows.landing_utc", "time"),
    ("catalog_search", "rows.*", "id"),
    ("relay_contacts", "trajectory.meta.*", "engine"),
    ("relay_contacts", "contacts.caveats", "engine"),
    ("relay_contacts", "*", "id"),
    ("*", "heading.note", "engine"),
    ("*", "heading.*", "id"),
    ("*", "bounds.note", "engine"),
    ("*", "bounds.interval_kind", "id"),
    ("*", "metrics.note", "engine"),
    ("*", "verdict.constraints.heading_note", "engine"),
    ("*", "verdict.constraints.origin_label", "id"),
    ("*", "verdict.constraints.*", "id"),
    ("*", "verdict.*", "id"),
    ("*", "terrain_error.products.source", "engine"),
    ("*", "terrain_error.*", "id"),
    ("*", "terrain_coverage.*", "id"),
    ("*", "next_events.*.name", "id"),
    ("*", "next_events.*.missing_worlds", "id"),
    ("*", "next_events.*", "id"),
    ("attribute_event", "attribution.detail", "engine"),
    ("attribute_event", "attribution.*", "id"),
    ("illumination_stats", "*.definition", "engine"),
    ("illumination_stats", "*.meaning", "engine"),
    ("illumination_stats", "*.horizon_note", "engine"),
    ("illumination_stats", "*.our_definitions.*", "engine"),
    ("illumination_stats", "*", "id"),
    ("slip_analysis", "rows.explanation", "engine"),
    ("slip_analysis", "rows.heading_note", "engine"),
    ("slip_analysis", "rows.*", "id"),
    ("scan_opportunities", "windows.*", "id"),
    ("search_sites", "sites.*", "id"),
    ("sensitivity", "*", "id"),
    ("compare_scenarios", "*", "id"),
    ("ephemeris_track", "*", "id"),
    ("horizon_profile", "*", "id"),
    ("build_scenario", "estimated_parameters.*", "id"),
    ("build_scenario", "heading.basis", "engine"),
    ("build_scenario", "*", "id"),
    ("evaluate_site", "intervals.*", "id"),
    ("*", "warnings", "engine"),
    ("*", "invariant_violations", "engine"),
    ("*", "summary", "display"),
    ("*", "limits.text", "display"),
    ("*", "limits.title", "display"),
    ("*", "limits.id", "id"),
    ("*", "data_versions.*", "id"),
    ("*", "depends_on", "id"),
    ("*", "result_files", "id"),
    ("*", "provenance.*", "id"),
    ("*", "*scenario_id", "id"),
    ("*", "terrain", "id"),
    ("*", "unit", "id"),
    ("*", "*.unit", "id"),
    ("*", "*.key", "id"),
    ("*", "*.label", "id"),
    ("*", "*.metric", "id"),
    ("*", "*.state", "id"),
    ("*", "*.limiting", "id"),
    ("*", "*.cause", "id"),
    ("*", "*.kind", "id"),
    ("*", "*.mode", "id"),
    ("*", "kind", "id"),
    ("*", "mode", "id"),
    ("*", "*.name", "id"),
    ("*", "*.id", "id"),
    ("*", "*_id", "id"),
)


def classify(tool: str, path: str) -> str | None:
    """The declared class of the string field at ``path`` of the result of ``tool``; None if no rule covers it."""
    for rule_tool, pattern, cls in RULES:
        if (rule_tool == "*" or rule_tool == tool) and fnmatchcase(path, pattern):
            return cls
    return None


def is_instant(value: str) -> bool:
    """Whether ``value`` is written as an ISO date and time."""
    return bool(_ISO_INSTANT.match(value))


def string_paths(obj: Any, path: str = "") -> list[tuple[str, str]]:
    """``(path, value)`` of every string leaf of a JSON value (dotted keys, lists transparent)."""
    out: list[tuple[str, str]] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.extend(string_paths(v, f"{path}.{k}" if path else str(k)))
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            out.extend(string_paths(v, path))
    elif isinstance(obj, str):
        out.append((path, obj))
    return out


ECHO_LEAVES: tuple[tuple[str, str], ...] = (
    ("*", "scenario.*"),
    ("*", "landing_utc"),
    ("*", "mission_end_utc"),
    ("*", "*.limit_min"),
    ("*", "*.limit_max"),
    ("*", "*.margin_scale"),
    ("*", "*terrain_error.k_sigma"),
    ("*", "*terrain_error.applied.k_sigma"),
    ("*", "heading.nominal_yaw_deg"),
    ("*", "heading.uncertainty_deg"),
    ("slip_analysis", "rows.slip_h"),
    ("slip_analysis", "rows.launch_utc"),
    ("slip_analysis", "rows.landing_utc"),
    ("rank_alternative_sites", "sites.slips.slip_h"),
    ("scan_opportunities", "windows.spacing_h"),
    ("slip_analysis", "rows.candidate_spacing_h"),
    ("search_sites", "levels.spacing_m"),
    ("search_sites", "settings.final_spacing_m"),
    ("search_sites", "settings.min_separation_m"),
    ("search_sites", "settings.region.*"),
)
"""Declared input echoes (numeric and time leaves). The list is an observed inventory, not a lint: a numeric leaf of a new
tool is an `engine_result` until it is declared here, but `trace.lineage_values` (any number or time equal to a set value of
a scenario in the result's lineage, or to an argument of the call) still marks an echo by value."""


def is_echo(tool: str, path: str) -> bool:
    """Whether the numeric or time leaf at ``path`` of a result of ``tool`` is a declared input echo."""
    return any(t in ("*", tool) and fnmatchcase(path, p) for t, p in ECHO_LEAVES)


def prune_echo(tool: str, obj: Any, path: str = "", row_keys: frozenset[str] = frozenset()) -> Any:
    """``obj`` reduced to its declared echo leaves (dicts and lists keep their shape; a ``unit`` sibling and the key field of
    a declared row (``row_keys``) are kept with them, so a row keeps its id); None when nothing is left."""
    if isinstance(obj, dict):
        kept = {k: r for k, v in obj.items()
                if (r := prune_echo(tool, v, f"{path}.{k}" if path else str(k), row_keys)) is not None}
        if kept and isinstance(obj.get("unit"), str):
            kept["unit"] = obj["unit"]
        if kept:
            kept.update({k: obj[k] for k in row_keys if k in obj and not isinstance(obj[k], (dict, list))})
        return kept or None
    if isinstance(obj, (list, tuple)):
        kept_list = [r for v in obj if (r := prune_echo(tool, v, path, row_keys)) is not None]
        return kept_list or None
    if isinstance(obj, bool) or obj is None:
        return None
    if isinstance(obj, (int, float)) or (isinstance(obj, str) and _ISO_INSTANT.match(obj)):
        return obj if is_echo(tool, path) else None
    return None


def unclassified(tool: str, obj: Any) -> list[str]:
    """Paths of the string leaves of ``obj`` that no rule covers (sorted, without repeats)."""
    return sorted({p for p, _ in string_paths(obj) if classify(tool, p) is None})
