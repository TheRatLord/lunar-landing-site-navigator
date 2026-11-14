"""Copy the call log of sandboxed scripts (`lunarnav.agent.runtime`) into the hash-chained ledger.

One ledger entry per script run, with id ``S0001``..., ``source: "script"``. The log is written by code
that runs inside the workspace, so it is self-reported: the guard accepts a script's reported values as
citable but the entry says where they came from.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from lunarnav.scenario.provenance import source_sha256

from . import fsafe
from .ids import SCENARIO_ID_RE
from .runtime import LOG_NAME
from .signoff import status_by_id
from .store import JsonlLedger, RunPaths, sha256_bytes, utc_now

MAX_VALUES_BYTES = 200_000
MAX_LOG_BYTES = 64 * 1024 * 1024


def script_log_path(paths: RunPaths) -> Path:
    """Location of the script call log inside the workspace (untrusted: the model can write it)."""
    return paths.workspace / "provenance" / LOG_NAME


def read_script_log(paths: RunPaths) -> tuple[list[dict[str, Any]], list[str]]:
    """Parse the call log line by line: ``(records, problems)``.

    A line that is not a JSON object with a string ``run`` (and a string ``name`` for a ``value`` record) is
    skipped and described in ``problems``; an unreadable log (a link, a directory) is a single problem.
    """
    path = script_log_path(paths)
    records: list[dict[str, Any]] = []
    problems: list[str] = []
    try:
        if not fsafe.lexists(path):
            return records, problems
        text = fsafe.read_bytes(path, MAX_LOG_BYTES).decode("utf-8", errors="replace")
    except OSError as exc:
        return records, [f"script call log unreadable: {exc}"]
    for number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
            json.dumps(rec)
        except (ValueError, RecursionError):
            problems.append(f"script log line {number}: not valid JSON (or nested too deeply), skipped")
            continue
        if not isinstance(rec, dict) or not isinstance(rec.get("run"), str):
            problems.append(f"script log line {number}: not a record with a string 'run', skipped")
        elif rec.get("kind") == "value" and not isinstance(rec.get("name"), str):
            problems.append(f"script log line {number}: value record without a name, skipped")
        else:
            records.append(rec)
    return records, problems


def _versions(provenance: list[dict[str, Any]]) -> dict[str, str]:
    out: dict[str, str] = {}
    for prov in provenance:
        code = prov.get("code") or {}
        if code.get("source_sha256"):
            out["lunarnav_source"] = f"sha256:{code['source_sha256']}"
            out["lunarnav_package"] = f"sha256:{source_sha256('package')}"
        terrain = (prov.get("horizon_provider") or {}).get("terrain") or {}
        if terrain.get("stack_hash"):
            out["terrain_stack"] = f"sha256:{terrain['stack_hash']}"
        kernels = prov.get("kernels") or {}
        if kernels:
            digest = sha256_bytes(json.dumps(
                {k: (v.get("sha256") if isinstance(v, dict) else v) for k, v in sorted(kernels.items())}).encode())
            out["kernels"] = f"{len(kernels)} files, sha256:{digest}"
    return out


def _scenario_lineage(paths: RunPaths, scenario_id: str, field: str) -> list[str]:
    """``depends_on`` or ``limits`` of a stored scenario, read from the harness-owned ``state/scenarios`` only."""
    if not SCENARIO_ID_RE.match(scenario_id):
        return []
    try:
        return [str(a) for a in json.loads(fsafe.read_text(paths.scenarios / f"{scenario_id}.json")).get(field, [])]
    except (OSError, ValueError, AttributeError):
        return []


def ingest_script_log(paths: RunPaths) -> list[str]:
    """Append ledger entries for script runs not yet recorded; returns the new ids."""
    records, _problems = read_script_log(paths)
    if not records:
        return []
    status = status_by_id(paths)
    ledger = JsonlLedger(paths.ledger)
    existing = {e.get("ledger_id"): e for e in ledger.entries()}
    runs: dict[str, list[dict[str, Any]]] = {}
    for rec in records:
        runs.setdefault(str(rec.get("run")), []).append(rec)
    added: list[str] = []
    for run_id in sorted(runs):
        if run_id in existing or not (run_id[:1] == "S" and run_id[1:].isdigit()):
            continue
        recs = runs[run_id]
        if any(r.get("kind") == "value" and not isinstance(r.get("name"), str) for r in recs):
            continue
        values: dict[str, Any] = {}
        calls: list[dict[str, Any]] = []
        provs: list[dict[str, Any]] = []
        deps: set[str] = set()
        limits: set[str] = set()
        records: dict[tuple[str, str], dict[str, Any]] = {}
        for r in recs:
            kind = r.get("kind")
            if kind == "value":
                values[str(r["name"])] = {"value": r.get("value"), "unit": r.get("unit", ""),
                                          "inputs": r.get("inputs", [])}
                for ref in r.get("inputs") or []:
                    if ref in existing:
                        deps |= set(existing[ref].get("depends_on") or ())
                        limits |= set(existing[ref].get("limits") or ())
                        for rec in existing[ref].get("limit_records") or ():
                            records.setdefault((rec["id"], rec["text"]), rec)
                    elif str(ref)[:1] == "A":
                        deps.add(str(ref))
            elif kind == "call":
                calls.append({"fn": r.get("fn"), "args_digest": r.get("args_digest"), "seconds": r.get("seconds")})
                provs.extend(r.get("provenance") or [])
            elif kind == "scenario":
                deps |= set(_scenario_lineage(paths, str(r.get("scenario_id")), "depends_on"))
                limits |= set(_scenario_lineage(paths, str(r.get("scenario_id")), "limits"))
        if len(json.dumps(values)) > MAX_VALUES_BYTES:
            values = {"error": "reported values exceed the size limit and were dropped"}
        rejected = sorted(a for a in deps if status.get(a) == "rejected")
        ledger.append({
            "ledger_id": run_id, "ts": utc_now(), "tool": "script", "source": "script",
            "status": "error" if rejected else "ok",
            "input": {"argv": next((r.get("argv", "") for r in recs if r.get("kind") == "start"), "")},
            "values": values, "calls": calls, "depends_on": sorted(deps),
            "limits": sorted(limits | {k[0] for k in records}), "limit_records": list(records.values()),
            "provenance": provs[:3], "data_versions": _versions(provs),
            "output": None, "output_sha256": None,
            "error": f"depends on rejected assumption(s) {rejected}; its values cannot be cited" if rejected else None,
        })
        added.append(run_id)
    return added
