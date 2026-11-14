"""Operator repair of a ledger left behind by a crash (``python -m lunarnav.agent repair-ledger``).

**This is an operator trust action, not a check.** The command makes the run's integrity result clean again; it
cannot tell a crash from someone who edited the files with the same effect, because ``heads.json`` is not a
signature. It therefore repairs only two patterns, shows the operator exactly what it would adopt or remove,
and writes the repair into the ledger with the operator's name:

- **interrupted append**: the ledger has exactly one entry more than the head records and that entry's ``prev``
  is the recorded head (the append that never got its head; a ledger with no recorded head counts as an empty
  one). The entry is shown. An entry that is a sign-off decision is never adopted: a decision must be made through
  ``signoff``, not found in a file.
- **torn last line**: the last line is an unterminated fragment that is not valid JSON, and the complete lines
  before it match the recorded head. The fragment is removed (and quoted in the repair record).

Anything else (a broken chain, fewer entries than recorded, a different head, an unreadable ``heads.json``) is what
tampering looks like and is refused; nothing is changed.
"""

from __future__ import annotations

import json
from typing import Any

from . import fsafe
from .store import (
    GENESIS,
    JsonlLedger,
    RunPaths,
    canonical_json,
    read_heads,
    set_head,
    sha256_bytes,
    utc_now,
)

OPERATOR_TOOL = "operator:repair-heads"
"""Ledger `tool` of the entry `repair-ledger` writes."""
FRAGMENT_QUOTE_CHARS = 300
ENTRY_VALUE_CHARS = 300


def describe_entry(line: str) -> dict[str, str]:
    """Every key of a ledger entry with its value as compact JSON; a value longer than `ENTRY_VALUE_CHARS` is cut and
    the cut is marked with the shown and the full length."""
    shown: dict[str, str] = {}
    for key, value in json.loads(line).items():
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        if len(text) > ENTRY_VALUE_CHARS:
            text = f"{text[:ENTRY_VALUE_CHARS]} [CUT: {ENTRY_VALUE_CHARS} of {len(text)} characters shown]"
        shown[key] = text
    return shown


class RepairRefused(RuntimeError):
    """The ledgers do not show a crash pattern this command repairs."""


def _lines(path: Any) -> tuple[list[str], str | None]:
    """``(complete non-blank lines, unterminated last fragment or None)`` of a ledger file."""
    if not fsafe.exists(path):
        return [], None
    text = fsafe.read_text(path)
    parts = text.split("\n")
    fragment = parts.pop() if parts and parts[-1] != "" else None
    if parts and parts[-1] == "":
        parts.pop()
    return [p for p in parts if p.strip()], fragment


def _chain_problem(lines: list[str]) -> str | None:
    """The first broken ``prev`` link or invalid line among complete lines, else None."""
    prev = GENESIS
    for number, line in enumerate(lines, start=1):
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            return f"line {number}: not valid JSON"
        if entry.get("prev") != prev:
            return f"line {number}: prev hash does not match the previous line"
        prev = sha256_bytes(line.encode())
    return None


def plan_repairs(paths: RunPaths) -> list[dict[str, Any]]:
    """What `repair_heads` would change: one dict per ledger needing it; ``RepairRefused`` if anything else is wrong.

    A plan carries ``ledger``, ``kind`` (``interrupted-append`` or ``torn-line``), ``reason``, ``from`` (recorded
    count), ``count`` and ``head`` after the repair, and what is adopted (``entry``) or removed (``fragment``).
    """
    try:
        heads = read_heads(paths.root)
    except (OSError, ValueError) as exc:
        raise RepairRefused(f"heads.json is unreadable ({exc}); this command does not repair that: it is the file "
                            "the integrity check relies on, so treat the run as untrusted") from exc
    plans = []
    for ledger in (paths.ledger, paths.assumptions, paths.artifacts):
        lines, fragment = _lines(ledger)
        chain = _chain_problem(lines)
        if chain:
            raise RepairRefused(f"{ledger.name}: the hash chain is broken ({chain}); this is not a crash")
        count = len(lines)
        last = sha256_bytes(lines[-1].encode()) if lines else GENESIS
        last_prev = json.loads(lines[-1]).get("prev") if lines else None
        recorded = heads.get(ledger.name, {"count": 0, "head": GENESIS})
        if fragment is not None:
            if recorded.get("count") != count or recorded.get("head") != last:
                raise RepairRefused(f"{ledger.name}: the last line is unterminated and the complete lines before it do "
                                    "not match the recorded head; that is not a torn write")
            try:
                json.loads(fragment)
            except json.JSONDecodeError:
                plans.append({"ledger": ledger.name, "kind": "torn-line", "from": count, "count": count, "head": last,
                              "fragment": fragment[:FRAGMENT_QUOTE_CHARS], "fragment_chars": len(fragment),
                              "reason": "torn last line: an entry that was only partly written is removed"})
                continue
            raise RepairRefused(f"{ledger.name}: the last line is complete JSON but has no line end; that is not a torn "
                                "write")
        if recorded.get("count") == count and recorded.get("head") == last:
            continue
        if recorded.get("count") == count - 1 and last_prev == recorded.get("head"):
            entry = json.loads(lines[-1])
            if entry.get("kind") == "signoff" or "decision" in entry:
                raise RepairRefused(
                    f"{ledger.name}: the entry with no recorded head is a sign-off decision; a decision is not adopted "
                    "from a file. Remove the entry by hand if it is not wanted, then record the decision again with "
                    "the signoff command")
            plans.append({"ledger": ledger.name, "kind": "interrupted-append", "from": recorded.get("count"),
                          "count": count, "head": last, "entry": describe_entry(lines[-1]),
                          "entry_chars": len(lines[-1]), "entry_sha256": sha256_bytes(lines[-1].encode()),
                          "reason": "interrupted append: one entry has no recorded head and is adopted"})
            continue
        raise RepairRefused(
            f"{ledger.name}: {count} entries, the recorded head says {recorded.get('count')} and does not follow from "
            "the file; that is not an interrupted append (entries were removed or edited)"
        )
    return plans


def repair_heads(paths: RunPaths, who: str) -> list[dict[str, Any]]:
    """Apply `plan_repairs`, then record the repair as an operator entry in ``ledger.jsonl``; return the plans."""
    who = " ".join(who.split())[:80]
    if not who:
        raise RepairRefused("say who is running the repair (--who)")
    plans = plan_repairs(paths)
    if not plans:
        return []
    for plan in plans:
        target = paths.root / plan["ledger"]
        if plan["kind"] == "torn-line":
            lines, _ = _lines(target)
            fsafe.replace(target, ("\n".join(lines) + "\n").encode() if lines else b"")
        else:
            set_head(target, plan["count"], plan["head"])
    ledger = JsonlLedger(paths.ledger)
    raw = {"who": who, "repaired": plans}
    ledger.append({
        "ledger_id": f"L{len(ledger) + 1:04d}",
        "ts": utc_now(),
        "tool": OPERATOR_TOOL,
        "source": "operator",
        "status": "ok",
        "input": raw,
        "input_sha256": sha256_bytes(canonical_json(raw).encode()),
        "output_sha256": None,
        "output": None,
        "result_file": None,
        "data_versions": {},
        "duration_ms": 0,
        "error": None,
    })
    return plans
