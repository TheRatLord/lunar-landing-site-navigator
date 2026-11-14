"""Assumptions and their sign-off decisions.

`assumptions.jsonl` is a hash-chained ledger holding two entry kinds: assumptions (no ``kind`` key,
written by ``record_assumption`` and by engine tools) and sign-offs (``kind == "signoff"``: who,
when, decision and a note). The latest decision of an assumption wins. A *rejected* assumption blocks
reuse: engine tools refuse inputs that depend on it and the answer guard flags citations of results
that did.
"""

from __future__ import annotations

import json
import re
from typing import Any

from . import fsafe
from .events import AssumptionSignoff, utc_now
from .store import EventLog, JsonlLedger, RunPaths, read_jsonl, run_integrity_problems

DECISIONS = ("accepted", "rejected")
MAX_FIELD_CHARS = 2_000
ASSUMPTION_ID_RE = re.compile(r"^A\d{3,6}$")
_CONTROL = re.compile("[\x00-\x08\x0b-\x1f\x7f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]")


class SignoffError(ValueError):
    """The sign-off request is malformed or refers to an unknown assumption."""


class LedgerTampered(SignoffError):
    """A ledger no longer matches its chain or its recorded head; no sign-off decision is taken from it."""


def require_intact(paths: RunPaths) -> None:
    """Raise `LedgerTampered` unless every ledger of the run matches its hash chain and recorded head."""
    problems = run_integrity_problems(paths)
    if problems:
        raise LedgerTampered("run ledgers failed verification: " + "; ".join(problems))


def write_status_snapshot(paths: RunPaths) -> None:
    """Publish ``state/assumption_status.json`` (assumption id -> status).

    Sandboxed scripts may read it (they cannot write ``state/``); `lunarnav.agent.runtime` uses it to refuse a
    scenario that depends on a rejected assumption. The harness rewrites it after every new assumption and decision.
    """
    status = {a["assumption_id"]: a["status"] for a in assumption_status(paths)}
    fsafe.replace(paths.status_snapshot, json.dumps(status, sort_keys=True).encode(), mkdir=True)


def next_assumption_id(ledger: JsonlLedger) -> str:
    """Next free assumption id (sign-off entries do not consume ids)."""
    n = sum(1 for e in ledger.entries() if e.get("kind") != "signoff")
    return f"A{n + 1:03d}"


def append_assumption(
    paths: RunPaths, *, statement: str, basis: str, impact: str, needs_signoff: bool = True,
    key: str | None = None, extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Append an assumption entry and return it as stored (``assumption_id`` assigned here).

    ``key`` is a stable identity for machine-generated assumptions so they are not recorded twice.
    """
    ledger = JsonlLedger(paths.assumptions)
    entry: dict[str, Any] = {
        "assumption_id": next_assumption_id(ledger), "ts": utc_now(), "statement": statement,
        "basis": basis, "impact": impact, "needs_signoff": needs_signoff,
    }
    if key is not None:
        entry["key"] = key
    if extra:
        entry.update(extra)
    stored = ledger.append(entry)
    write_status_snapshot(paths)
    return stored


def find_by_key(paths: RunPaths, key: str) -> dict[str, Any] | None:
    """The assumption recorded with identity ``key``, if any."""
    for e in read_jsonl(paths.assumptions):
        if e.get("kind") != "signoff" and e.get("key") == key:
            return e
    return None


def _clean(value: str, name: str) -> str:
    text = value.strip() if isinstance(value, str) else ""
    if not text:
        raise SignoffError(f"{name} is required")
    if len(text) > MAX_FIELD_CHARS:
        raise SignoffError(f"{name} is longer than {MAX_FIELD_CHARS} characters")
    return _CONTROL.sub(" ", text)


def record_signoff(
    paths: RunPaths, assumption_id: str, decision: str, who: str, note: str, *, write_event: bool = True,
) -> dict[str, Any]:
    """Record that ``who`` accepted or rejected an assumption, with a ``note`` (both required).

    Works on closed runs. Appends a hash-chained entry to ``assumptions.jsonl``; with ``write_event``
    also appends an ``assumption_signoff`` event to the transcript (a live session passes False and
    emits through its own bus so sequence numbers stay consistent).
    """
    if decision not in DECISIONS:
        raise SignoffError(f"decision must be one of {DECISIONS}")
    if not ASSUMPTION_ID_RE.match(assumption_id or ""):
        raise SignoffError(f"malformed assumption id {assumption_id!r}")
    who_c, note_c = _clean(who, "who"), _clean(note, "note")
    require_intact(paths)
    entries = read_jsonl(paths.assumptions)
    if not any(e.get("assumption_id") == assumption_id and e.get("kind") != "signoff" for e in entries):
        raise SignoffError(f"no assumption {assumption_id!r} in run {paths.run_id}")
    stored = JsonlLedger(paths.assumptions).append({
        "kind": "signoff", "assumption_id": assumption_id, "decision": decision, "who": who_c,
        "note": note_c, "ts": utc_now()})
    write_status_snapshot(paths)
    if write_event:
        log = EventLog(paths.transcript)
        log.write(AssumptionSignoff(run_id=paths.run_id, seq=log.next_seq(), assumption_id=assumption_id,
                                    decision=decision, who=who_c, note=note_c))  # type: ignore[arg-type]
    return stored


def assumption_status(paths: RunPaths) -> list[dict[str, Any]]:
    """Every assumption with its sign-off state and the ledger entries that depend on it.

    ``status`` is ``accepted`` / ``rejected`` (latest decision), ``pending`` (needs sign-off, none yet)
    or ``not_required``.
    """
    entries = read_jsonl(paths.assumptions)
    decisions: dict[str, list[dict[str, Any]]] = {}
    for e in entries:
        if e.get("kind") == "signoff":
            decisions.setdefault(e["assumption_id"], []).append(
                {k: e[k] for k in ("decision", "who", "ts", "note")})
    used: dict[str, list[str]] = {}
    for e in read_jsonl(paths.ledger):
        for aid in e.get("depends_on") or []:
            used.setdefault(aid, []).append(e["ledger_id"])
    out = []
    for e in entries:
        if e.get("kind") == "signoff":
            continue
        aid = e["assumption_id"]
        sign = decisions.get(aid, [])
        status = sign[-1]["decision"] if sign else ("pending" if e.get("needs_signoff", True) else "not_required")
        out.append({
            "assumption_id": aid, "ts": e["ts"], "statement": e["statement"], "basis": e["basis"],
            "impact": e["impact"], "needs_signoff": e.get("needs_signoff", True), "status": status,
            "signoffs": sign, "used_by": used.get(aid, [])} | ({"key": e["key"]} if e.get("key") else {}))
    return out


def status_by_id(paths: RunPaths) -> dict[str, str]:
    """Map assumption id to its status."""
    return {a["assumption_id"]: a["status"] for a in assumption_status(paths)}
