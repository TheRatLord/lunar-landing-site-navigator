"""Final-answer guard: a mechanical check of the numbers an answer shows, and what the harness attaches to it.

`analyze_answer` is deterministic and model-free. It finds each number, instant and date in the answer text and
requires that

* it appears in a record of this run (tool result, a typed number the model passed to a tool, a script-reported
  value, a recorded assumption, a document the user supplied, or something the user typed) within display
  rounding, with the sign and the unit family it is shown with (``untraceable`` otherwise);
* the line cites the record with a tag such as ``[L0012]`` (``uncited``), and the cited record really states it
  (``mismatch``) unless the number is the user's own;
* when the cited record holds several rows of a table a tool declared (sites, slips, windows ...), the tag names the
  row, ``[L0006#key]``, and the number is in that row (``row_citation_required``);
* a clock time is written in UTC (``time_zone``);
* a clause or section label of a document of the run ("Dark span (2.3)") is a name, not a number, when every occurrence in
  the line is written as a label (`labels`);
* cited records are not invalid and do not depend on a rejected assumption.

This is a check against slips (a number that is not in the record, the wrong row, a lost sign, a wrong unit or
instant). It does not show that a sentence is *true*.

The same call also returns what the harness attaches to the final answer, independent of the model's wording: the
kind of source behind each citation (so the interface can say "from your document" or "assumption, not signed
off"), the text of every model limit carried by the cited results, and the assumptions they depend on.

A number that is deliberately not engine output (an illustration, a rule of thumb) is labelled ``[unverified]``
and is reported, not hidden.
"""

from __future__ import annotations

import re
from collections.abc import Collection
from dataclasses import asdict, dataclass, field
from typing import Any

from .labels import is_label_use
from .limits import LIMITS, limit_text, limit_title
from .numbers import Quantity, extract_quantities, with_header_units
from .trace import KINDS, Registry

_TAG_GROUP = re.compile(r"\[([^\[\]\n]{1,100})\]")
_ID = re.compile(r"^[LSAFD]\d{3,6}(?:#[A-Za-z0-9_.:/-]{1,80})?$")
_ATTRIBUTION = re.compile(
    r"\b(?:your|yours|you(?:\s+\w+){0,2}\s+(?:said|gave|asked|specified|stated|set|wrote|typed|entered|requested|recalled|remembered|quoted|mentioned|provided|supplied)|"
    r"request(?:ed|s)?|specified|user|limits?|requirements?|thresholds?|as\s+given|as\s+stated)\b", re.IGNORECASE)
_FLAGS = {"u": "user", "user": "user", "unverified": "unverified", "illustrative": "unverified"}
_FENCE = re.compile(r"^\s*(```|~~~)")
_URL = re.compile(r"https?://\S+")
MAX_ISSUES = 14


@dataclass(frozen=True, slots=True)
class Issue:
    """One problem found in an answer."""

    kind: str
    text: str
    line: int
    detail: str = ""

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(slots=True)
class Analysis:
    """The check of an answer and what the harness attaches to it."""

    issues: list[Issue] = field(default_factory=list)
    citations: list[dict[str, Any]] = field(default_factory=list)
    """One entry per cited record and row: ``id``, ``row``, ``kind`` (the least independent kind of source that
    states a number cited to it), ``kinds``, ``tool``, ``derived_from``."""
    limits: list[dict[str, Any]] = field(default_factory=list)
    """``id``, ``text`` (the registry text, verbatim) and ``cited_by`` (ledger ids) of every limit carried by a result
    of the digest or a cited record."""
    assumptions: list[dict[str, Any]] = field(default_factory=list)
    """``id``, ``statement``, ``status`` and ``cited_by`` of every assumption a digest result or a cited record
    depends on, or that is cited itself."""
    digest: list[dict[str, Any]] = field(default_factory=list)
    """Every engine result of the turn (and every earlier one the answer cites), cited or not: see `trace.digest_facts`."""


def parse_tags(line: str) -> tuple[list[str], set[str], str]:
    """Citation ids and flags (``user``, ``unverified``) in a line, and the line with the tags removed.

    An id may name a row of a multi-row record: ``[L0006#poi-derosa-lp3]``, ``[L0003#168]``,
    ``[L0009#2027-03-01T00:00:00.000Z]``, ``[L0010#site-a/168]`` (a row of a row)."""
    ids: list[str] = []
    flags: set[str] = set()

    def take(m: re.Match[str]) -> str:
        tokens = [t for t in re.split(r"[,;\s]+", m.group(1).strip()) if t]
        if tokens and all(_ID.match(t) or t.lower() in _FLAGS for t in tokens):
            for t in tokens:
                if _ID.match(t):
                    ids.append(t)
                else:
                    flags.add(_FLAGS[t.lower()])
            return " "
        return m.group(0)

    return ids, flags, _TAG_GROUP.sub(take, line)


_TAG_RUN = re.compile(r"(?:\s*\[[^\]]*\])+")
_USER_ONLY = re.compile(r"\s*\[(?:u|user)\]", re.IGNORECASE)


def split_user_segments(line: str) -> tuple[list[str], str]:
    """The text right before a lone ``[U]`` tag (back to the previous tag or the line start), and the rest of the line.

    ``the 14-day mission [U], landing 2025-03-02T08:34Z [L0001]``: the first segment is the user's, the rest is cited
    to L0001. A ``[U]`` next to another tag (``[U] [L0001]``) or leading the line keeps the whole line together."""
    runs = list(_TAG_RUN.finditer(line))
    if not runs or runs[0].start() == 0 or not any(_USER_ONLY.fullmatch(m.group(0)) for m in runs):
        return [], line
    segments: list[str] = []
    rest: list[str] = []
    pos = 0
    for m in runs:
        text = line[pos:m.start()]
        if _USER_ONLY.fullmatch(m.group(0)):
            segments.append(text)
        else:
            rest.append(text + m.group(0))
        pos = m.end()
    rest.append(line[pos:])
    return segments, "".join(rest)


def _lines(text: str) -> list[tuple[int, str, bool]]:
    """(line number, text with URLs removed, inside a code fence) of every line; the fence markers are skipped."""
    out: list[tuple[int, str, bool]] = []
    fenced = False
    for i, line in enumerate(with_header_units(text.split("\n"))):
        if _FENCE.match(line):
            fenced = not fenced
            continue
        out.append((i + 1, _URL.sub(" ", line), fenced))
    return out


def check_answer(text: str, reg: Registry) -> list[Issue]:
    """All issues in ``text`` against the registry of its run (empty list: the answer passes)."""
    return analyze_answer(text, reg).issues


def analyze_answer(text: str, reg: Registry, turn_ids: Collection[str] = ()) -> Analysis:
    """Issues of ``text`` plus what the harness attaches to it.

    ``turn_ids`` are the ledger ids of the records written since the user's message. Every engine result among them is in
    the digest and its limits and assumptions are attached whether or not the text cites it; an answer that cites no record
    although the turn computed one is a ``no_citation`` issue. Without ``turn_ids`` (a re-check of a stored answer) the
    digest holds the cited results only."""
    issues: list[Issue] = []
    used: dict[tuple[str, str | None], set[str]] = {}
    for lineno, line, fenced in _lines(text):
        user_segments, line = split_user_segments(line)
        deferred: list[Quantity] = []
        for segment in user_segments:
            for q in extract_quantities(segment, line_offset=lineno - 1, lists=fenced):
                if "U" in reg.find(q):
                    used.setdefault(("U", None), set()).add("user_request")
                    if q.zone:
                        issues.append(Issue("time_zone", q.text, lineno,
                                            "give clock times in UTC (the engine and the interface use UTC only)"))
                else:
                    deferred.append(q)
        ids, flags, bare = parse_tags(line)
        cites: list[tuple[str, str | None]] = []
        bad_tag = False
        for tag in ids:
            sid, _, row = tag.partition("#")
            if sid[0] == "F":
                continue
            src = reg.sources.get(sid)
            if src is None:
                issues.append(Issue("bad_citation", f"[{tag}]", lineno, "no such ledger, script or assumption id"))
                bad_tag = True
                continue
            if row and row not in src.row_ids:
                issues.append(Issue("bad_citation", f"[{tag}]", lineno,
                                    "no such row; the rows are " + ", ".join(sorted(set(src.row_ids))[:8]) if src.row_ids
                                    else f"[{sid}] has no rows to name (a record with one row, or none, is cited as [{sid}])"))
            cites.append((sid, row or None))
            used.setdefault((sid, row or None), set())
        for q in [*deferred, *extract_quantities(bare, line_offset=lineno - 1, lists=fenced)]:
            if q.zone:
                issues.append(Issue("time_zone", q.text, lineno,
                                    "give clock times in UTC (the engine and the interface use UTC only)"))
            if q.kind == "number" and not q.unit and not q.explicit_sign and is_label_use(q.text, bare, reg.labels):
                continue
            issue = _check_quantity(q, cites, flags, reg, bare, bad_tag, fenced, used, bool(ids))
            if issue is not None:
                issues.append(Issue(issue[0], q.text, lineno, issue[1]))
    cited = sorted({sid for sid, _ in used})
    issues.extend(_source_issues(cited, reg))
    in_turn = set(turn_ids)
    digest_ids = [sid for sid, s in reg.sources.items() if s.digest is not None and (sid in in_turn or sid in cited)]
    if any(sid in in_turn for sid in digest_ids) and not [sid for sid in cited if sid != "U"]:
        issues.append(Issue("no_citation", "", 0, "the answer cites no record, but this turn computed engine results: "
                            "state each number with the tag of the record that holds it ([L0012])"))
    result = Analysis(issues=issues[:MAX_ISSUES * 3])
    result.citations = _citations(used, reg)
    result.digest = _digest(reg, digest_ids, set(cited))
    result.limits, result.assumptions = _attachments(sorted(set(cited) | set(digest_ids)), reg, set(cited))
    return result


def _digest(reg: Registry, ids: list[str], cited: set[str]) -> list[dict[str, Any]]:
    """One entry per engine result: what the engine concluded, the limits and assumptions it carries, and whether the
    answer cites it."""
    out: list[dict[str, Any]] = []
    for sid in ids:
        src = reg.sources[sid]
        assert src.digest is not None
        out.append({"id": sid, **src.digest, "limits": list(src.limits),
                    "assumptions": [{"id": a, "status": reg.assumption_status.get(a, "pending")} for a in src.depends_on
                                    if a in reg.assumption_status],
                    "cited": sid in cited})
    return out


def _check_quantity(q: Quantity, cites: list[tuple[str, str | None]], flags: set[str], reg: Registry,
                    line: str, bad_tag: bool, fenced: bool, used: dict[tuple[str, str | None], set[str]],
                    has_tag: bool) -> tuple[str, str] | None:
    if "unverified" in flags:
        return None
    if q.definitional and not has_tag:
        return None
    hits = reg.find(q)
    if not hits:
        return ("untraceable", ("not found in any tool result, script-reported value, assumption or user "
                               "input of this run; compute it with a tool or runtime.report, or label it [unverified]"))
    engine_hits = [h for h in hits if h != "U"]
    from_user = "U" in hits
    if from_user and (not cites or not engine_hits) and ("user" in flags or _ATTRIBUTION.search(line)):
        used.setdefault(("U", None), set()).add("user_request")
        return None
    if not cites and bad_tag:
        return ("mismatch", "the cited record does not exist; it appears in: " + ", ".join(
            f"[{h}]" for h in engine_hits[:4]))
    if not cites:
        if fenced:
            return None
        if from_user and not engine_hits:
            return ("user_number_unattributed", "this number appears only in your request; say it is the request's "
                    "(\"your 96 h limit\") or tag it [user], or compute it with a tool and cite the record")
        return ("uncited", "add the citation tag of the record that states it: " + ", ".join(
            f"[{h}]" for h in engine_hits[:4]))
    for sid, row in cites:
        part = reg.sources[sid].match(q, row, anywhere=False)
        if part is not None:
            used[(sid, row)].add(part.kind)
            return None
    if from_user and not engine_hits:
        return ("user_number_unattributed", "this number appears only in your request, not in the cited record; say it "
                "is the request's (\"your 2 m mast\"), tag it [user], or cite the record that holds it")
    for sid, row in cites:
        part = reg.sources[sid].match(q)
        if part is not None and part.multi_row:
            rows = sorted(r for r, b in part.rows.items() if b.finds(q, part.exact_units))
            where = ", ".join(rows[:4]) or "another row"
            if row is None:
                return ("row_citation_required",
                        f"[{sid}] holds several rows and this number is in the row of {where}: cite [{sid}#<row>] "
                        "of the row the sentence names")
            return ("mismatch", f"[{sid}#{row}] does not state it; it is in the row of {where}")
    return ("mismatch", "the cited record does not state this number; it appears in: " + ", ".join(
        f"[{h}]" for h in engine_hits[:4]))


def _source_issues(cited: list[str], reg: Registry) -> list[Issue]:
    issues: list[Issue] = []
    for sid in cited:
        if sid == "U":
            continue
        src = reg.sources[sid]
        for problem in src.problems:
            issues.append(Issue("invalid_source", f"[{sid}]", 0, problem))
        for aid in reg.blocked_by(sid):
            issues.append(Issue("rejected_dependency", f"[{sid}]", 0,
                                f"depends on assumption {aid}, which a planner rejected; recompute without it"))
    return issues


def _citations(used: dict[tuple[str, str | None], set[str]], reg: Registry) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for (sid, row), kinds in used.items():
        if sid == "U":
            out.append({"id": "U", "row": None, "kinds": ["user_request"], "tool": "", "derived_from": []})
            continue
        src = reg.sources[sid]
        shown = sorted(kinds or {src.kind}, key=KINDS.index)
        out.append({"id": sid, "row": row, "kinds": shown, "tool": src.label, "derived_from": list(src.derived_from)})
    return out


def _attributed_notes(by_line: dict[str, list[str]], cited: Collection[str]) -> list[str]:
    """The lines a result adds under a limit, each naming the ledger ids it applies to; lines of cited results come first."""
    def first(item: tuple[str, list[str]]) -> tuple[bool, str]:
        return (not any(i in cited for i in item[1]), item[0])

    return [f"{line} [{', '.join(ids)}]" for line, ids in sorted(by_line.items(), key=first)]


def _attachments(ids: list[str], reg: Registry, cited: Collection[str] = ()) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Limits (registry text, verbatim, with each parameter line naming the records it applies to) and assumptions carried
    by the cited records and the results of the turn."""
    limit_by: dict[str, list[str]] = {}
    engine_by: dict[tuple[str, str], list[str]] = {}
    engine_rec: dict[tuple[str, str], dict[str, Any]] = {}
    notes: dict[str, dict[str, list[str]]] = {}
    assumption_by: dict[str, list[str]] = {}
    for sid in ids:
        if sid == "U":
            continue
        src = reg.sources[sid]
        for rec in src.limit_records:
            key = (rec["id"], rec["text"])
            engine_by.setdefault(key, []).append(sid)
            engine_rec.setdefault(key, rec)
        for lid in src.limits:
            if lid in LIMITS:
                limit_by.setdefault(lid, []).append(sid)
                for line in src.limit_notes.get(lid, ()):
                    notes.setdefault(lid, {}).setdefault(line, []).append(sid)
        for aid in (sid, *src.depends_on) if src.origin == "assumption" else src.depends_on:
            assumption_by.setdefault(aid, []).append(sid)
    order = {lid: i for i, lid in enumerate(LIMITS)}
    limits = [{"id": lid, "title": limit_title(lid), "text": limit_text(lid, _attributed_notes(notes.get(lid, {}), cited)),
               "source": LIMITS[lid].source, "cited_by": ids}
              for lid, ids in sorted(limit_by.items(), key=lambda kv: order.get(kv[0], len(order)))]
    limits += [{**{k: rec[k] for k in ("id", "title", "category", "kind", "text", "source", "parameters")}, "cited_by": ids}
               for key, ids in sorted(engine_by.items(), key=lambda kv: (not any(i in cited for i in kv[1]), kv[0]))
               for rec in (engine_rec[key],)]
    assumptions = []
    for aid, ids in sorted(assumption_by.items()):
        src = reg.sources.get(aid)
        assumptions.append({"id": aid, "statement": src.text if src is not None else "",
                            "status": reg.assumption_status.get(aid, "pending"), "cited_by": ids})
    return limits, assumptions


KIND_LABEL = {
    "engine_result": "engine result", "input": "a value you passed to a tool", "script_value": "script-reported value",
    "assumption": "assumption", "document": "from your document", "user_request": "your request"}
"""How an interface words a kind of source (the chip beside a citation)."""


def attachment_lines(citations: list[dict[str, Any]], limits: list[dict[str, Any]],
                     assumptions: list[dict[str, Any]], digest: list[dict[str, Any]] | None = None) -> list[str]:
    """What the harness attached to an answer, as plain text lines (the CLI prints them under the answer)."""
    lines: list[str] = []
    if digest:
        lines.append("Engine results of this turn (added by the harness; the answer may not cite all of them):")
        lines += [f"- [{d['id']}] {d['tool']} {_digest_scope(d)}: {_digest_verdict(d)}"
                  f"{'' if d['cited'] else ' (not cited by the answer)'}" for d in digest]
    other = [c for c in citations if set(c["kinds"]) != {"engine_result"}]
    if other:
        lines.append("Sources that are not engine results (added by the harness):")
        lines += [f"- [{c['id']}{'#' + c['row'] if c.get('row') else ''}] "
                  + ", ".join(KIND_LABEL[k] for k in c["kinds"]) for c in other]
    if limits:
        lines.append("Limits carried by the engine results of this turn and the cited records (added by the harness):")
        lines += [f"- {m['text']} [{', '.join(m['cited_by'])}]" for m in limits]
    open_ones = [a for a in assumptions if a["status"] != "accepted"]
    if open_ones:
        lines.append("Assumptions the cited results depend on that no planner has accepted (added by the harness):")
        lines += [f"- {a['id']} ({a['status']}): {a['statement']}" for a in open_ones]
    return lines


def _digest_scope(d: dict[str, Any]) -> str:
    return ", ".join(str(s.get("site") or s["id"]) for s in d.get("scenarios", [])[:4])


def _digest_verdict(d: dict[str, Any]) -> str:
    def one(v: dict[str, Any]) -> str:
        return f"{v['state']} (limiting: {v.get('limiting')})" if v.get("limiting") else str(v["state"])

    if d.get("verdict"):
        return one(d["verdict"])
    if d.get("verdicts"):
        return "; ".join(f"{v.get('row') or '-'} {one(v)}" for v in d["verdicts"])
    if d.get("states"):
        return ", ".join(f"{n} {s}" for s, n in d["states"].items())
    return "no verdict"
