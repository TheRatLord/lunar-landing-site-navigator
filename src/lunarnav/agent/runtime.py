"""Helper imported by analysis scripts that run in the sandbox (``from lunarnav.agent import runtime``).

Scripts are for bespoke work the typed tools do not cover. This module makes them first-class citizens of
the provenance ledger:

* ``rt.run(fn, *args, **kwargs)`` calls an engine function and records it (name, arguments digest, the
  engine's provenance block) in ``provenance/script_calls.jsonl`` in the workspace;
* ``rt.report(name, value, unit=..., inputs=[...])`` records a number or small structure the script wants
  to be cited. The script is assigned an id (``S0003``) printed at first use; cite ``[S0003]``;
* ``rt.provider()`` is the stock terrain provider (720 azimuths) with its horizon cache in the workspace,
  ``rt.scenario(scenario_id)`` loads a scenario that ``build_scenario`` stored (in ``../state/``).

The harness copies the log into the hash-chained ledger after the script finishes. The log lives in the
writable workspace, so a script can forge it: ledger entries from scripts are marked ``source: script``
and the guard treats them as self-reported, never as engine-verified.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import time
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any, TypeVar

T = TypeVar("T")
LOG_NAME = "script_calls.jsonl"
_state: dict[str, Any] = {}


def workspace() -> Path:
    """The run workspace (parent of ``$LUNARNAV_CACHE_DIR``; the current directory if unset)."""
    cache = os.environ.get("LUNARNAV_CACHE_DIR")
    return Path(cache).resolve().parent if cache else Path.cwd()


def _log_path() -> Path:
    path = workspace() / "provenance"
    path.mkdir(exist_ok=True)
    return path / LOG_NAME


def _append(record: dict[str, Any]) -> None:
    with _log_path().open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, sort_keys=True, default=str) + "\n")


def script_id() -> str:
    """This process's script id (``S0001``...), allocated on first use and printed once."""
    if "id" not in _state:
        log = _log_path()
        used = [json.loads(line).get("run", "S0000") for line in log.read_text().splitlines() if line.strip()] \
            if log.is_file() else []
        n = max((int(u[1:]) for u in used if u[:1] == "S" and u[1:].isdigit()), default=0) + 1
        _state["id"] = f"S{n:04d}"
        _append({"run": _state["id"], "kind": "start", "ts": time.time(), "argv": os.environ.get("LUNARNAV_SCRIPT", "")})
        print(f"[lunarnav runtime] script id {_state['id']}: cite its reported values as [{_state['id']}]")
    return str(_state["id"])


def provider(n_az: int = 720):
    """The stock terrain provider (LOLA stack) with the horizon cache inside the workspace."""
    if "provider" not in _state:
        from lunarnav.scenario import TerrainProvider
        from lunarnav.terrain import TerrainStack

        cache = os.environ.get("LUNARNAV_CACHE_DIR")
        extra = {"cache_dir": str(Path(cache) / "horizons")} if cache else {}
        _state["provider"] = TerrainProvider(TerrainStack.open(), n_az=n_az, **extra)
    return _state["provider"]


def scenario(scenario_id: str):
    """Load a scenario stored by ``build_scenario`` (read from the harness's read-only ``state/`` tree).

    The stored scenario must reproduce its content-hash id, and a scenario that depends on an assumption a
    planner has rejected is refused (the harness publishes the decisions in ``state/assumption_status.json``).
    """
    from lunarnav.scenario import Scenario

    from .ids import SCENARIO_ID_RE, scenario_id_from_dump

    state = workspace().parent / "state"
    if not SCENARIO_ID_RE.match(scenario_id):
        raise ValueError(f"{scenario_id!r} is not a scenario id")
    path = state / "scenarios" / f"{scenario_id}.json"
    if not path.is_file():
        raise FileNotFoundError(f"unknown scenario {scenario_id!r}")
    doc = json.loads(path.read_text())
    sc = Scenario.model_validate(doc["scenario"])
    if scenario_id_from_dump(sc.model_dump(mode="json")) != scenario_id:
        raise ValueError(f"stored scenario {scenario_id} does not match its content hash")
    status_path = state / "assumption_status.json"
    status = json.loads(status_path.read_text()) if status_path.is_file() else {}
    rejected = [a for a in doc.get("depends_on", []) if status.get(a) == "rejected"]
    if rejected:
        raise PermissionError(f"scenario {scenario_id} depends on rejected assumption(s) {rejected}; rebuild it "
                              "with the planner's values")
    _append({"run": script_id(), "kind": "scenario", "scenario_id": scenario_id})
    return sc


def _digest(obj: Any) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()[:16]


def _provenance_of(result: Any) -> list[dict[str, Any]]:
    items = result if isinstance(result, (list, tuple)) else [result]
    out = []
    for item in items:
        prov = getattr(item, "provenance", None)
        if callable(prov):
            continue
        if isinstance(prov, dict):
            out.append({k: v for k, v in prov.items() if k != "scenario"})
        if len(out) >= 3:
            break
    return out


def run[T](fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    """Call an engine function and record the call and its provenance block."""
    sid = script_id()
    t0 = time.time()
    result = fn(*args, **kwargs)
    _append({
        "run": sid, "kind": "call", "fn": f"{getattr(fn, '__module__', '')}.{getattr(fn, '__qualname__', repr(fn))}",
        "args_digest": _digest([repr(a)[:200] for a in args] + sorted(f"{k}={v!r}"[:200] for k, v in kwargs.items())),
        "seconds": round(time.time() - t0, 3), "provenance": _provenance_of(result)})
    return result


def _clean(value: Any) -> Any:
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    if hasattr(value, "tolist"):
        value = value.tolist()
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, int):
        return value
    if isinstance(value, dict):
        return {str(k): _clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    return str(value)


def report(name: str, value: Any, unit: str = "", inputs: Sequence[str] = ()) -> str:
    """Record a result for citation and return its tag (``[S0003]``). ``inputs`` are ledger ids it used."""
    sid = script_id()
    _append({"run": sid, "kind": "value", "name": name, "value": _clean(value), "unit": unit, "inputs": list(inputs)})
    print(f"[{sid}] {name} = {value} {unit}".rstrip())
    return f"[{sid}]"
