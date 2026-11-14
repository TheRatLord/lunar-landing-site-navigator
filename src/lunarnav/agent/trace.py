"""Registry of every number the agent is entitled to show, built from the run's own records.

Sources: ledger entries (tool outputs, what was asked of a tool, script-reported values), recorded assumptions,
and what the user typed (prompts, sign-off notes). Each source is made of *parts*, and every part has a
*kind*: ``engine_result`` (what a tool computed), ``input`` (a typed number or instant the model passed to a
tool), ``document`` (text the user supplied), ``assumption`` (a recorded assumption), ``script_value`` (a number
a script reported about itself) or ``user_request`` (what the user typed). A number is traced to the kind of
the part that states it, and the interface shows that kind next to the citation.

A tool declares the row lists of its output (`ToolOutput.ROW_LISTS`: list path to key field). A record with a
declared list of at least two rows is a *multi-row record*: a number inside a row is reached only through that
row (``[L0006#slip-120]``) or, for numbers outside every row, through the record. See `guard.py` for how the
registry is used.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from fnmatch import fnmatchcase
from pathlib import Path
from typing import Any

import numpy as np

from . import fsafe
from .labels import document_labels, labels_in_text
from .numbers import Quantity, extract_quantities, factors, parse_utc, time_matches, walk_leaves
from .scripts import ingest_script_log, read_script_log
from .signoff import status_by_id
from .store import RunPaths, iter_events, read_jsonl, sha256_bytes
from .textfields import CITABLE, classify, prune_echo, string_paths

KINDS = ("engine_result", "input", "script_value", "assumption", "document", "user_request")
"""Kinds of source, from the most to the least independent of what a person or the model wrote."""

NO_INPUT_SOURCES = frozenset({"check_report", "derive", "record_assumption", "register_artifact", "bash", "write", "edit",
                              "multiedit", "notebookedit"})
"""Tools whose arguments are free text or code the model wrote, or (derive) numbers that are cited at their own
records: numbers in them are not evidence here."""

NO_OUTPUT_SOURCES = frozenset({"check_report", "record_assumption", "register_artifact"})
"""Tools whose result echoes text the model wrote (the draft's sentences, an assumption statement, an artifact
description). Their output is never a source: otherwise one call would make any number in a draft citable (and
acceptable to `derive`). An assumption is a source only through the sign-off registry, as an assumption."""

_TIME_KEY = re.compile(r"(utc|date|launch|landing|start|end|epoch|time)", re.IGNORECASE)
"""Input keys whose ISO strings are instants the model passed to the engine (the rest of a tool's string inputs are
free text and never a source)."""

_Entry = tuple[float, str, str]


def weakest(kinds: list[str]) -> str:
    """The least independent of ``kinds`` (what a value computed from all of them inherits)."""
    return max(kinds, key=KINDS.index) if kinds else "engine_result"


def row_id(v: Any) -> str | None:
    """Row id of a key value, as a citation tag writes it: letters, digits and ``_ . : -`` (anything else becomes
    ``-``); a number is written without a trailing ``.0``."""
    if isinstance(v, bool):
        return None
    if isinstance(v, str):
        return re.sub(r"[^A-Za-z0-9_.:-]+", "-", v).strip("-") or None
    if isinstance(v, (int, float)):
        return str(int(v)) if float(v).is_integer() else repr(float(v))
    return None


def _declaration(declared: dict[str, str], path: str) -> str | None:
    """The declaration of the list at ``path`` (a ``*`` in a declared path stands for any one key); None if undeclared."""
    if path in declared:
        return declared[path]
    return next((v for k, v in declared.items() if "*" in k and fnmatchcase(path, k)), None)


def _declared_key(declared: dict[str, str], path: str) -> str | None:
    """Key field of the rows of the list at ``path``; None when it is undeclared or declared not to be rows."""
    return _declaration(declared, path) or None


def result_rows(paths: RunPaths, entry: dict[str, Any], body: Any, problems: list[str]) -> dict[str, list[Any]]:
    """Every row a ledger entry serves, by id: the declared rows of its stored result ``body``, those of each JSON result
    file the entry registers (read from ``state/``, checked against the hash the ledger recorded), and the rows of a
    ``derive`` record that its value is pinned to. The guard's row ids and the ledger-result route both come from here.
    A file that is missing, altered or not JSON adds a line to ``problems`` and no rows."""
    declared = entry.get("rows") or {}
    rows = {rid: list(items) for rid, items in split_declared(body, declared)[1].items()}
    for spec in entry.get("files") or []:
        rel = spec.get("path", "")
        if not rel.endswith(".json"):
            continue
        try:
            raw = _read_state_file(paths, rel)
        except OSError:
            problems.append(f"result file {rel} is missing")
            continue
        if sha256_bytes(raw) != spec.get("sha256"):
            problems.append(f"result file {rel} no longer matches its ledger hash")
            continue
        try:
            data = json.loads(raw)
        except ValueError:
            problems.append(f"result file {rel} is not JSON")
            continue
        for rid, items in split_declared(data, declared)[1].items():
            rows.setdefault(rid, []).extend(items)
    if str(entry.get("tool", "")).lower() == "derive" and isinstance(body, dict):
        for rid in entry.get("derived_rows") or []:
            inputs = {k: v for k, v in (body.get("inputs") or {}).items()
                      if isinstance(v, dict) and str(v.get("source", "")).partition("#")[2] == rid}
            rows.setdefault(rid, []).append({"row": rid, "value": body.get("value"), "unit": body.get("unit"), "inputs": inputs})
    return rows


def split_declared(obj: Any, declared: dict[str, str], path: str = "", row: str | None = None,
                   rows: dict[str, list[Any]] | None = None,
                   row_paths: dict[str, str] | None = None) -> tuple[Any, dict[str, list[Any]]]:
    """``obj`` with every declared row list of two or more keyed rows replaced by None, and those rows by id.

    ``declared`` maps a list's dotted path (keys only: ``sites``, ``sites.slips``) to the key field of its rows.
    A row nested in a row has the id ``<parent>/<child>``; rows with the same id are merged. ``row_paths``, when
    given, receives the dotted path of the list each row came from.
    """
    rows = {} if rows is None else rows
    if isinstance(obj, dict):
        out: dict[str, Any] = {}
        for k, v in obj.items():
            p = f"{path}.{k}" if path else str(k)
            key = _declared_key(declared, p)
            ids = [row_id(x.get(key)) if isinstance(x, dict) else None for x in v] \
                if key and isinstance(v, list) and len(v) >= 2 else []
            if ids and all(i is not None for i in ids):
                for rid, item in zip(ids, v):
                    full = rid if row is None else f"{row}/{rid}"
                    if row_paths is not None:
                        row_paths.setdefault(full, p)
                    rows.setdefault(full, []).append(split_declared(item, declared, p, full, rows, row_paths)[0])
                out[k] = None
            else:
                out[k] = split_declared(v, declared, p, row, rows, row_paths)[0]
        return out, rows
    if isinstance(obj, list):
        return [split_declared(x, declared, path, row, rows, row_paths)[0] for x in obj], rows
    return obj, rows


def undeclared_row_lists(obj: Any, declared: dict[str, str], path: str = "") -> list[str]:
    """Paths of lists of two or more objects that no declaration covers (a tool's output must declare its rows)."""
    out: list[str] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{path}.{k}" if path else str(k)
            if isinstance(v, list) and len(v) >= 2 and all(isinstance(x, dict) for x in v):
                if _declaration(declared, p) is None:
                    out.append(p)
                else:
                    out.extend(q for x in v for q in undeclared_row_lists(x, declared, p))
            else:
                out.extend(undeclared_row_lists(v, declared, p))
    elif isinstance(obj, list):
        out.extend(q for x in obj for q in undeclared_row_lists(x, declared, path))
    return out


def _leaf_hint(leaf: float, hint: str) -> str:
    """Unit hint of a JSON number: an integer with no unit (or one the key names a fraction for) is a count."""
    if isinstance(leaf, int) and hint in ("", "fraction") and leaf not in (0, 1):
        return "count"
    return hint or ("count" if isinstance(leaf, int) else "")


def _group(values: list[_Entry]) -> dict[str, np.ndarray]:
    groups: dict[str, list[float]] = {}
    for v, hint, _ in values:
        groups.setdefault(hint, []).append(v)
    return {h: np.asarray(vs) for h, vs in groups.items()}


def _same_date_text(q: Quantity, text: str) -> bool:
    other = extract_quantities(text, keep_small=True)
    return any(o.kind == "date" and o.month == q.month and o.day == q.day
               and (q.year is None or o.year is None or q.year == o.year) for o in other)


@dataclass(slots=True)
class Bucket:
    """Numbers, instants and date texts of one scope (a row, the part outside the rows, or everything)."""

    values: list[_Entry] = field(default_factory=list)
    times: list[float] = field(default_factory=list)
    clocks: list[tuple[float, float]] = field(default_factory=list)
    """Clock times the source writes without a date (a request saying "05:00 UTC"): time of day and precision, seconds."""
    texts: list[str] = field(default_factory=list)
    _grouped: tuple[int, dict[str, np.ndarray]] | None = None

    def finds(self, q: Quantity, exact_units: bool = False) -> bool:
        """Whether the bucket states ``q`` within display rounding (``exact_units``: the unit must be the same)."""
        if q.kind == "number":
            if self._grouped is None or self._grouped[0] != len(self.values):
                self._grouped = (len(self.values), _group(self.values))
            for hint, arr in self._grouped[1].items():
                for f in ([1.0] if hint == q.unit else []) if exact_units else factors(hint, q.unit):
                    scaled = arr * f
                    if q.unit == "%" and hint == "" and f == 1.0:
                        scaled = np.where(np.abs(arr) <= 1.0, np.nan, scaled)
                    target, other = (q.value, scaled) if q.explicit_sign else (abs(q.value), np.abs(scaled))
                    if np.any(np.abs(target - other) <= q.half_step + 1e-9 * np.maximum(1.0, np.abs(scaled))):
                        return True
            return False
        if any(time_matches(q, t) for t in self.times):
            return True
        if q.kind == "time" and q.tod_s is not None and q.month is None and not math.isfinite(q.value):
            return any(q.precision_s >= p and abs(c - q.tod_s) <= q.precision_s / 2 + 1e-6 for c, p in self.clocks)
        return q.kind == "date" and any(_same_date_text(q, t) for t in self.texts)


def position_pairs(obj: Any) -> list[tuple[float, float]]:
    """The (latitude, longitude) of every object of ``obj`` that has both ``lat_deg`` and ``lon_deg`` as numbers: a row
    of a search, a ring point, a site. Two numbers that merely occur in the same record are not a position."""
    out: list[tuple[float, float]] = []
    if isinstance(obj, dict):
        lat, lon = obj.get("lat_deg"), obj.get("lon_deg")
        if all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in (lat, lon)):
            out.append((float(lat), float(lon)))
        for v in obj.values():
            out.extend(position_pairs(v))
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            out.extend(position_pairs(v))
    return out


@dataclass(slots=True)
class Part:
    """What one kind of origin states inside a source: the part outside the rows and each declared row."""

    kind: str
    exact_units: bool = False
    """User numbers match only in the unit the user wrote (no conversion, no unitless wildcard)."""
    common: Bucket = field(default_factory=Bucket)
    rows: dict[str, Bucket] = field(default_factory=dict)
    every: Bucket = field(default_factory=Bucket)
    denied: set[str] = field(default_factory=set)
    """String paths no rule of `textfields` covers: not sources."""
    positions: list[tuple[float, float]] = field(default_factory=list)
    """Latitude and longitude of each object of the part that states both (`position_pairs`)."""

    @property
    def multi_row(self) -> bool:
        """The part holds a declared list of several rows: a number inside a row must be cited to its row."""
        return bool(self.rows)

    def add_tree(self, obj: Any, declared: dict[str, str] | None = None, tool: str | None = None) -> None:
        """Everything a result states: its numbers, and the strings that `textfields` declares citable for ``tool``
        (every other string is not a source). ``tool=None`` is a model-written structure (a script's values): only
        its numbers and instants count."""
        row_paths: dict[str, str] = {}
        common, rows = split_declared(obj, declared or {}, row_paths=row_paths)
        self._add_leaves(common, None, tool, "")
        for rid, items in rows.items():
            for item in items:
                self._add_leaves(item, rid, tool, row_paths.get(rid, ""))

    def add_rows(self, obj: Any, row_ids: list[str], tool: str | None) -> None:
        """A result whose every value belongs to the rows ``row_ids`` and to nothing outside them."""
        for rid in row_ids:
            self._add_leaves(obj, rid, tool, "")

    def add_inputs(self, obj: Any) -> None:
        """What was asked of a tool: numbers, and ISO instants under a time-like key. Other strings are free text."""
        self.positions.extend(position_pairs(obj))
        for key, leaf, hint in walk_leaves(obj):
            if isinstance(leaf, (int, float)):
                self._add_number(float(leaf), _leaf_hint(leaf, hint), key, None)
            elif isinstance(leaf, str) and _TIME_KEY.search(key):
                t = parse_utc(leaf)
                if t is not None:
                    self._add_time(t, None)

    def add_text(self, text: str, row: str | None = None) -> None:
        """Numbers, instants and dates written in a sentence."""
        for q in extract_quantities(text, keep_small=True):
            if q.kind == "number":
                self._add_number(q.value, q.unit, "", row)
            elif q.kind == "time" and q.value == q.value:
                self._add_time(q.value, row)
            elif q.kind == "time" and q.tod_s is not None and q.month is None:
                for b in self._targets(row):
                    b.clocks.append((q.tod_s, q.precision_s))
            elif q.kind == "date":
                for b in self._targets(row):
                    b.texts.append(q.text)

    def _targets(self, row: str | None) -> list[Bucket]:
        if row is None:
            return [self.every, self.common]
        return [self.every, self.rows.setdefault(row, Bucket())]

    def _add_number(self, value: float, hint: str, key: str, row: str | None) -> None:
        for b in self._targets(row):
            b.values.append((value, hint, key))

    def _add_time(self, t: float, row: str | None) -> None:
        for b in self._targets(row):
            b.times.append(t)

    def _add_leaves(self, obj: Any, row: str | None, tool: str | None, prefix: str) -> None:
        self.positions.extend(position_pairs(obj))
        for key, leaf, hint in walk_leaves(obj):
            if isinstance(leaf, (int, float)):
                self._add_number(float(leaf), _leaf_hint(leaf, hint), key, row)
        for path, text in string_paths(obj, prefix):
            cls = classify(tool, path) if tool is not None else classify("", path)
            if cls is None and tool is not None:
                self.denied.add(path)
            if cls not in CITABLE or (tool is None and cls != "time"):
                continue
            t = parse_utc(text)
            if t is not None:
                self._add_time(t, row)
            if cls == "engine":
                self.add_text(text, row)

    def scope(self, row: str | None, anywhere: bool) -> list[Bucket]:
        """The buckets a citation reaches: everything (``anywhere``), or the cited row (with its parent rows' own
        values) plus the part outside the rows; only the latter without a row. A row nested in the cited row is not
        reached: its own id is needed."""
        if anywhere or not self.rows:
            return [self.every]
        out = [self.common]
        if row is not None:
            out += [b for r, b in self.rows.items() if r == row or row.startswith(r + "/")]
        return out

    def finds(self, q: Quantity, row: str | None = None, *, anywhere: bool = True) -> bool:
        return any(b.finds(q, self.exact_units) for b in self.scope(row, anywhere))


@dataclass(slots=True)
class Source:
    """One citable record: parts of one or more kinds."""

    id: str
    origin: str
    """``tool``, ``script``, ``assumption`` or ``user``."""
    label: str = ""
    base_kind: str = "engine_result"
    """Kind of the record's own output (the first part, and the kind of a record that has no part)."""
    parts: list[Part] = field(default_factory=list)
    depends_on: tuple[str, ...] = ()
    limits: tuple[str, ...] = ()
    limit_records: tuple[dict[str, Any], ...] = ()
    """The engine-result limit notes the record carries (`lunarnav.report.limits`): id, title, kind, text, source, parameters."""
    limit_notes: dict[str, tuple[str, ...]] = field(default_factory=dict)
    """Lines a result adds under a limit it carries (the model-typed values, a k-sigma that is not the default)."""
    derived_from: tuple[str, ...] = ()
    problems: list[str] = field(default_factory=list)
    """Reasons the source must not be reported (failed invariants, modified result file)."""
    text: str = ""
    """An assumption's statement."""
    digest: dict[str, Any] | None = None
    """For an engine analysis: its tool, scenarios and the engine's verdict states (`digest_facts`)."""
    served_rows: tuple[str, ...] = ()
    """Ids of the rows the stored result serves (`served_row_ids`): the only rows a ``[id#row]`` tag may name."""

    def part(self, kind: str, *, exact_units: bool = False) -> Part:
        for p in self.parts:
            if p.kind == kind:
                return p
        p = Part(kind, exact_units)
        self.parts.append(p)
        return p

    @property
    def kind(self) -> str:
        return self.base_kind

    @property
    def row_ids(self) -> list[str]:
        """Ids a ``[id#row]`` tag may name: exactly the rows `result_rows` returns, which the ledger-result route serves
        (the stored result's declared rows, those of its registered JSON files, and a derive record's derived rows)."""
        return list(self.served_rows)

    @property
    def multi_row(self) -> bool:
        return any(p.multi_row for p in self.parts)

    def match(self, q: Quantity, row: str | None = None, *, anywhere: bool = True) -> Part | None:
        """The part that states ``q`` (within the cited row unless ``anywhere``), or None. When several do, the least
        independent one (a value the model passed in, which the output echoes, is an input, not an engine result)."""
        hits = [p for p in self.parts if p.finds(q, row, anywhere=anywhere)]
        if not hits:
            return None
        return max(hits, key=lambda p: KINDS.index(p.kind))

    def finds(self, q: Quantity, row: str | None = None, *, anywhere: bool = True) -> bool:
        return self.match(q, row, anywhere=anywhere) is not None

    def kind_of_value(self, value: float) -> str | None:
        """Kind of the first part that states the plain number ``value`` (None when none does)."""
        part = self.match(Quantity("number", "", 0, value, 6))
        return part.kind if part is not None else None


@dataclass(slots=True)
class Registry:
    """All sources of a run plus the sign-off status of its assumptions."""

    sources: dict[str, Source] = field(default_factory=dict)
    user: Source = field(default_factory=lambda: Source("U", "user", "user input", base_kind="user_request"))
    assumption_status: dict[str, str] = field(default_factory=dict)
    log_problems: list[str] = field(default_factory=list)
    """Lines of the (untrusted) script call log that were skipped, and why."""
    labels: set[str] = field(default_factory=set)
    """Clause and section labels of the run's documents and of the user's words (``2.3``): see `labels`."""

    def find(self, q: Quantity) -> list[str]:
        """Ids of the sources that state ``q`` (``U`` for something the user typed)."""
        hits = [sid for sid, s in self.sources.items() if s.finds(q)]
        if self.user.finds(q):
            hits.append("U")
        return hits

    def blocked_by(self, source_id: str) -> list[str]:
        """Rejected assumptions a source depends on (directly or through its ``depends_on``)."""
        src = self.sources.get(source_id)
        if src is None:
            return []
        return [a for a in src.depends_on if self.assumption_status.get(a) == "rejected"]

    def pending_for(self, source_id: str) -> list[str]:
        """Assumptions awaiting sign-off that a source depends on."""
        src = self.sources.get(source_id)
        if src is None:
            return []
        return [a for a in src.depends_on if self.assumption_status.get(a) == "pending"]


def build_registry(paths: RunPaths, extra_user_text: str = "") -> Registry:
    """Build the registry from a run directory (ledger, results, assumptions, transcript)."""
    ingest_script_log(paths)
    reg = Registry()
    reg.log_problems = read_script_log(paths)[1]
    reg.assumption_status = status_by_id(paths)
    reg.user.part("user_request", exact_units=True)
    for e in read_jsonl(paths.ledger):
        if e.get("status") != "ok":
            continue
        is_script = e.get("source") == "script"
        tool = str(e.get("tool", "")).lower()
        kind = "script_value" if is_script else str(e.get("output_kind") or "engine_result")
        src = Source(e["ledger_id"], "script" if is_script else "tool", e.get("tool", ""), base_kind=kind,
                     depends_on=tuple(e.get("depends_on") or ()), limits=tuple(e.get("limits") or ()),
                     limit_records=tuple(e.get("limit_records") or ()),
                     limit_notes={k: tuple(v) for k, v in (e.get("limit_notes") or {}).items()},
                     derived_from=tuple(e.get("derived_from") or ()))
        out = src.part(kind)
        declared = e.get("rows") or {}
        body = None
        if tool not in NO_OUTPUT_SOURCES:
            body = _load_output(paths, e, src)
            if body is not None:
                src.served_rows = tuple(result_rows(paths, e, body, []))
                src.digest = digest_facts(tool, e.get("input"), body, paths.scenarios)
                body = citable_body(tool, body)
                if tool == "derive" and e.get("derived_rows"):
                    out.add_rows(body, list(e["derived_rows"]), tool)
                else:
                    out.add_tree(body, declared, tool)
        if is_script:
            out.add_tree(e.get("values"))
        file_bodies = [data for f in e.get("files") or [] if (data := _load_file(paths, f, src, out, declared, tool)) is not None]
        if kind == "document":
            reg.labels |= document_labels(body, file_bodies)
        if tool not in NO_INPUT_SOURCES:
            echo = src.part("input")
            echo.add_inputs(e.get("input"))
            if body is not None and not is_script:
                echo.add_tree(prune_echo(tool, body, row_keys=frozenset(declared.values())), declared)
                lineage_values(echo, e.get("input"), body, paths)
            for data in file_bodies:
                echo.add_tree(prune_echo(tool, data, row_keys=frozenset(declared.values())), declared)
                lineage_values(echo, e.get("input"), data, paths)
        if e.get("invalid"):
            src.problems.append("failed engine invariant checks: " + "; ".join(e["invalid"]))
        reg.sources[src.id] = src
    user = reg.user.part("user_request", exact_units=True)
    for a in read_jsonl(paths.assumptions):
        if a.get("kind") == "signoff":
            user.add_text(a.get("note", ""))
            reg.labels |= labels_in_text(a.get("note", ""))
            continue
        src = Source(a["assumption_id"], "assumption", a.get("statement", "")[:80], base_kind="assumption",
                     text=a.get("statement", ""))
        part = src.part("assumption")
        for field_name in ("statement", "basis", "impact"):
            part.add_text(a.get(field_name, ""))
        if isinstance(a.get("values"), dict):
            part.add_tree(a["values"])
        reg.sources[src.id] = src
    for ev in iter_events(paths.transcript):
        if ev.type == "user_prompt":
            user.add_text(_unwrap(ev.text))
            reg.labels |= labels_in_text(_unwrap(ev.text))
    if extra_user_text:
        user.add_text(_unwrap(extra_user_text))
        reg.labels |= labels_in_text(_unwrap(extra_user_text))
    return reg


def lineage_values(part: Part, inp: Any, body: Any, paths: RunPaths) -> None:
    """The values of the scenarios a result is about (every number and instant of the scenarios named in its input or its own
    ``scenario_id``, and the mission end, landing plus the duration) as inputs: a result that repeats one of them is
    echoing what was set, whoever set it. A result number that equals one by coincidence takes the weaker kind too."""
    ids: list[str] = []
    for obj in (inp, body):
        if isinstance(obj, dict):
            ids += [obj["scenario_id"]] if isinstance(obj.get("scenario_id"), str) else []
            ids += [s for s in obj.get("scenario_ids") or [] if isinstance(s, str)]
    for sid in dict.fromkeys(ids):
        try:
            sc = json.loads(fsafe.read_text(paths.scenarios / f"{sid}.json"))["scenario"]
        except (OSError, ValueError, KeyError, TypeError):
            continue
        part.add_tree(sc)
        landing = parse_utc(sc.get("landing_utc", "")) if isinstance(sc.get("landing_utc"), str) else None
        duration = sc.get("mission_duration_h")
        if landing is not None and isinstance(duration, (int, float)):
            part._add_time(landing + 3600.0 * float(duration), None)


def request_text(paths: RunPaths) -> str:
    """The user's words of the run so far: their messages and the planner's sign-off notes."""
    parts = [a.get("note", "") for a in read_jsonl(paths.assumptions) if a.get("kind") == "signoff"]
    parts += [_unwrap(ev.text) for ev in iter_events(paths.transcript) if ev.type == "user_prompt"]
    return "\n".join(parts)


def citable_body(tool: str, body: Any) -> Any:
    """What of a result is a source: a derived value is citable by itself, its inputs at their own records."""
    if tool == "derive" and isinstance(body, dict):
        return {k: v for k, v in body.items() if k != "inputs"}
    return body


def _unwrap(text: str) -> str:
    """A request wrapped at 120 columns: a unit on the next line is still the number's unit."""
    return re.sub(r"(?<!\n)\n(?!\n)", " ", text)


def _read_state_file(paths: RunPaths, rel: str) -> bytes:
    """Bytes of a harness-written result file named by a run-root-relative path under ``state/`` (no links)."""
    parts = Path(rel).parts
    if parts[:1] != ("state",) or Path(rel).is_absolute() or ".." in parts:
        raise OSError(f"{rel!r} is not a file under state/")
    return fsafe.read_bytes(paths.root.joinpath(*parts))


def _load_output(paths: RunPaths, entry: dict[str, Any], src: Source) -> Any:
    body = entry.get("output")
    if body is not None:
        return body
    rel = entry.get("result_file")
    if not rel:
        return None
    try:
        raw = _read_state_file(paths, rel)
    except OSError:
        src.problems.append(f"result file {rel} is missing")
        return None
    if sha256_bytes(raw) != entry.get("output_sha256"):
        src.problems.append(f"result file {rel} no longer matches its ledger hash")
        return None
    try:
        return json.loads(raw)
    except ValueError:
        src.problems.append(f"result file {rel} is not JSON")
        return None


def _load_file(paths: RunPaths, spec: dict[str, Any], src: Source, part: Part, declared: dict[str, str],
               tool: str) -> Any:
    """Add the numbers of a JSON result file registered with the entry (hash-checked) and return its content (None when
    it is not read); other kinds are deliberately not parsed, so a number read from a CSV must be re-derived through a tool
    or script."""
    rel = spec.get("path", "")
    if not rel.endswith(".json"):
        return None
    try:
        raw = _read_state_file(paths, rel)
    except OSError:
        src.problems.append(f"result file {rel} is missing")
        return None
    if sha256_bytes(raw) != spec.get("sha256"):
        src.problems.append(f"result file {rel} no longer matches its ledger hash")
        return None
    try:
        data = json.loads(raw)
    except ValueError:
        src.problems.append(f"result file {rel} is not JSON")
        return None
    part.add_tree(data, declared, str(tool))
    return data


class ResultUnavailable(LookupError):
    """The ledger has no such entry, or its stored result is missing, altered or not JSON."""


def ledger_result(paths: RunPaths, ledger_id: str) -> dict[str, Any]:
    """The full, hash-verified stored result of one ledger entry, for an interface that shows a cited row.

    Results over the inline limit live in a file under ``state/results``; this reads either form the way the answer
    check does. Returns ``ledger_id``, ``tool``, ``kind`` (the source kind), ``output`` (the whole body),
    ``rows`` (the declared row lists, dotted path to key field), ``row_ids`` (the ids a ``[L0006#id]`` tag may
    name) and ``rows_by_id`` (each such row, from the result and from its registered JSON files; see `result_rows`).
    Raises `ResultUnavailable`, also when a registered JSON file is missing or no longer matches its ledger hash.
    """
    entry = next((e for e in read_jsonl(paths.ledger) if e.get("ledger_id") == ledger_id), None)
    if entry is None:
        raise ResultUnavailable(f"no ledger entry {ledger_id}")
    src = Source(ledger_id, "tool", str(entry.get("tool", "")), base_kind=str(entry.get("output_kind") or "engine_result"))
    body = _load_output(paths, entry, src)
    if body is None:
        raise ResultUnavailable("; ".join(src.problems) or f"{ledger_id} has no stored result")
    declared = entry.get("rows") or {}
    problems: list[str] = []
    rows = result_rows(paths, entry, body, problems)
    if problems:
        raise ResultUnavailable("; ".join(problems))
    return {"ledger_id": ledger_id, "tool": entry.get("tool"), "kind": src.base_kind, "output": body,
            "rows": declared, "row_ids": list(rows), "rows_by_id": rows}


DIGEST_TOOLS = frozenset({
    "evaluate_site", "scan_opportunities", "slip_analysis", "rank_alternative_sites", "sensitivity",
    "attribute_event", "compare_scenarios", "illumination_stats", "horizon_profile", "ephemeris_track",
    "ellipse_statistics", "search_sites", "relay_contacts"})
"""Tools whose result is an engine analysis of a scenario: one digest entry each; a subset of the
registered tool names."""

STATES = frozenset({"PASS", "MARGINAL", "FAIL", "UNKNOWN"})
MAX_VERDICT_ROWS = 12
_ROW_KEYS = ("scenario_id", "site", "slip_h", "start_utc", "landing_utc", "name", "key", "label", "rank")


def _state(d: dict[str, Any]) -> bool:
    return isinstance(d.get("state"), str) and d["state"].upper() in STATES


def _walk_states(obj: Any, out: list[dict[str, Any]]) -> None:
    if isinstance(obj, dict):
        if _state(obj):
            row = next((str(obj[k]) for k in _ROW_KEYS if obj.get(k) not in (None, "")), None)
            out.append({"row": row, "state": obj["state"], "limiting": obj.get("limiting")})
        for v in obj.values():
            _walk_states(v, out)
    elif isinstance(obj, list):
        for v in obj:
            _walk_states(v, out)


def verdict_facts(body: Any) -> dict[str, Any]:
    """The engine's verdict state(s) in a tool result: ``verdict`` (the result's own, if it has one), and ``verdicts``
    (each verdict-bearing row, up to `MAX_VERDICT_ROWS`) or ``states`` (counts, for longer tables)."""
    facts: dict[str, Any] = {}
    if not isinstance(body, dict):
        return facts
    v = body.get("verdict")
    if isinstance(v, dict) and _state(v):
        facts["verdict"] = {"state": v["state"], "limiting": v.get("limiting")}
    rows: list[dict[str, Any]] = []
    _walk_states({k: x for k, x in body.items() if k != "verdict"}, rows)
    if _state(body):
        facts["verdict"] = {"state": body["state"], "limiting": body.get("limiting")}
        rows = [r for r in rows if r["state"] != body["state"] or r["limiting"] != body.get("limiting")]
    if rows and len(rows) <= MAX_VERDICT_ROWS:
        facts["verdicts"] = rows
    elif rows:
        counts: dict[str, int] = {}
        for r in rows:
            counts[r["state"]] = counts.get(r["state"], 0) + 1
        facts["states"] = counts
    return facts


def scenario_refs(inp: Any, scenarios_dir: Path) -> list[dict[str, Any]]:
    """The scenarios a call was about (``scenario_id`` or ``scenario_ids`` of its input): id, name and site."""
    if not isinstance(inp, dict):
        return []
    ids = [inp["scenario_id"]] if isinstance(inp.get("scenario_id"), str) else list(inp.get("scenario_ids") or [])
    out: list[dict[str, Any]] = []
    for sid in ids:
        ref: dict[str, Any] = {"id": str(sid)}
        try:
            sc = json.loads(fsafe.read_text(scenarios_dir / f"{sid}.json"))["scenario"]
            site = sc.get("site") or {}
            ref.update(name=sc.get("name"), site=site.get("catalog_id") or site.get("name"),
                       lat_deg=site.get("lat_deg"), lon_deg=site.get("lon_deg"), landing_utc=sc.get("landing_utc"))
        except (OSError, ValueError, KeyError, TypeError):
            pass
        out.append(ref)
    return out


def digest_facts(tool: str, inp: Any, body: Any, scenarios_dir: Path) -> dict[str, Any] | None:
    """The part of a digest entry that does not depend on the answer; None for a tool that is not an analysis.

    An answer cannot choose what it carries by choosing what to cite: the digest lists every engine result the turn
    computed (and any earlier result the answer cites), with the scenario and site, the engine's own verdict state and
    limiting constraint where the result has one, and whether the answer cites it (`guard.analyze_answer`).
    """
    if tool not in DIGEST_TOOLS:
        return None
    return {"tool": tool, "scenarios": scenario_refs(inp, scenarios_dir), **verdict_facts(body)}
