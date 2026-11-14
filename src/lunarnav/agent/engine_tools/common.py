"""Shared plumbing of the engine tools: per-run state, result files, limits, invariants, ledger extras."""

from __future__ import annotations

import asyncio
import csv
import io
import json
from collections import OrderedDict
from collections.abc import Callable, Iterable, Sequence
from pathlib import Path
from typing import Any, TypeVar

from pydantic import Field

from lunarnav.report.limits import LimitNote
from lunarnav.scenario import Scenario
from lunarnav.scenario.provenance import source_sha256

from .. import fsafe
from ..builtin_tools import register_file
from ..limits import LIMITS, limit_title
from ..registry import CURRENT_CALL, EngineRefusal, ToolContext, ToolError, ToolOutput
from ..store import canonical_json, sha256_bytes
from ..typed_inputs import mark_overrides
from .state import EngineState

T = TypeVar("T")
_STATES: OrderedDict[Path, EngineState] = OrderedDict()
MAX_CACHED_STATES = 8
"""Runs whose terrain providers stay in memory; the least recently used is dropped (it reloads from disk)."""


def _engine_state(ctx: ToolContext) -> EngineState:
    """The `EngineState` of the run behind ``ctx`` (created on first use; at most `MAX_CACHED_STATES` kept)."""
    key = ctx.paths.root
    if key not in _STATES:
        _STATES[key] = EngineState(ctx.paths, ctx.config)
        while len(_STATES) > MAX_CACHED_STATES:
            _STATES.popitem(last=False)
    _STATES.move_to_end(key)
    return _STATES[key]


def note_record(n: LimitNote) -> dict[str, Any]:
    """A report limit note as the ledger stores it: everything the final answer attaches (the model's tool result shows
    only the id and the title)."""
    return {"id": n.id, "title": n.title, "category": n.category, "kind": n.kind, "text": n.text, "source": n.source,
            "parameters": json.loads(canonical_json(dict(n.parameters)))}


class EngineOutput(ToolOutput):
    """Base of engine tool results (compact; bulk goes to ``result_files``)."""

    summary: str = ""
    warnings: list[str] = Field(default_factory=list)
    limits: list[dict[str, str]] = Field(default_factory=list)
    """Model limits that apply to this result (ids and texts). The harness attaches them to every answer that cites
    the result; you do not need to restate them."""
    result_files: list[str] = Field(default_factory=list)
    """Run-root-relative files (``state/results/...``) holding the complete series or tables; read them at ``../state/results/...``."""
    depends_on: list[str] = Field(default_factory=list)
    """Assumption ids this result depends on."""
    invariant_violations: list[str] = Field(default_factory=list)
    """Internal consistency checks the result failed; a result with violations must not be reported."""


def trim_provenance(prov: dict[str, Any]) -> dict[str, Any]:
    """The engine provenance block without the (large, duplicated) scenario copy."""
    return {k: v for k, v in prov.items() if k != "scenario"}


def data_versions(prov: dict[str, Any]) -> dict[str, str]:
    """Compact ``data_versions`` for the ledger from an engine provenance block."""
    out: dict[str, str] = {}
    code = prov.get("code") or {}
    if code.get("source_sha256"):
        out["lunarnav_source"] = f"sha256:{code['source_sha256']}"
        out["lunarnav_package"] = f"sha256:{source_sha256('package')}"
    hp = prov.get("horizon_provider") or {}
    terrain = hp.get("terrain") if isinstance(hp.get("terrain"), dict) else None
    if terrain and terrain.get("stack_hash"):
        out["terrain_stack"] = f"sha256:{terrain['stack_hash']}"
    elif hp.get("provider"):
        out["horizon_provider"] = str(hp["provider"])
    kernels = prov.get("kernels") or {}
    if kernels:
        listing = json.dumps({k: (v.get("sha256") if isinstance(v, dict) else v) for k, v in sorted(kernels.items())})
        out["kernels"] = f"{len(kernels)} files, sha256:{sha256_bytes(listing.encode())}"
    if prov.get("scenario_sha256"):
        out["scenario"] = f"sha256:{prov['scenario_sha256']}"
    return out


def _with_engine_versions(prov: dict[str, Any]) -> dict[str, Any]:
    """Add code and kernel versions to a provenance block that lacks them (ellipse, search)."""
    from lunarnav.ephem.kernels import load_kernels
    from lunarnav.scenario.provenance import code_version

    return {**prov, "code": code_version(), "kernels": dict(load_kernels().provenance())}


class Call:
    """Bookkeeping of one engine tool call: dependencies, limits, files, provenance, invariants."""

    def __init__(self, ctx: ToolContext, tool: str, *, assumptions: Sequence[str] = ()) -> None:
        self.ctx = ctx
        self.tool = tool
        self.state = _engine_state(ctx)
        self.deps: set[str] = set(assumptions)
        self.limit_ids: set[str] = set()
        """Harness limits (`agent.limits.LIMITS`): conduct of the harness or of the model, not engine facts."""
        self.limit_notes: dict[str, set[str]] = {}
        self.engine_limits: dict[tuple[str, str], dict[str, Any]] = {}
        """Engine-result limits, by (id, text): the notes `lunarnav.report.limits` returns for what this call computed."""
        self.typed_lines: list[str] = []
        self.files: list[dict[str, str]] = []
        self.warnings: list[str] = []
        self.provenance: dict[str, Any] | None = None
        self.violations: list[str] = []
        self.scenario_id: str | None = None
        self.state.check_not_rejected(self.deps)

    def depend(self, assumption_ids: Iterable[str]) -> None:
        ids = set(assumption_ids)
        self.state.check_not_rejected(ids)
        self.deps |= ids

    async def run(self, fn: Callable[[], T]) -> T:
        """Run an engine computation in a worker thread, serialised per run.

        After ``config.engine_call_timeout_s`` the model gets an error. The thread itself cannot be interrupted
        (numeric code), so it runs to its end and the run's next engine call waits for it.
        """
        state = self.state

        def locked() -> T:
            with state.lock:
                try:
                    return fn()
                except (ValueError, KeyError, LookupError, ArithmeticError) as exc:
                    raise EngineRefusal(f"{type(exc).__name__}: {exc}") from exc

        limit = state.config.engine_call_timeout_s
        try:
            return await asyncio.wait_for(asyncio.to_thread(locked), timeout=limit)
        except TimeoutError as exc:
            raise ToolError(
                f"the computation exceeded {limit:.0f} s and was abandoned; it cannot be interrupted, so the engine "
                "stays busy until it finishes. Use a coarser request (fewer samples, a shorter span, a smaller grid)."
            ) from exc


    def scenario(self, sid: str) -> Scenario:
        """Load a scenario; its dependencies join this call's (rejected ones refuse the call)."""
        sc, stored = self.state.load_scenario(sid)
        self.depend(stored.get("depends_on", []))
        self.limit_ids |= {i for i in stored.get("limits", []) if i in LIMITS}
        for lid, lines in stored.get("limit_notes", {}).items():
            if lid in LIMITS:
                self.limit_notes.setdefault(lid, set()).update(lines)
        self.scenario_id = sid
        self.terrain_stores = sc.terrain_stores
        return sc

    def add_notes(self, notes: Iterable[LimitNote]) -> None:
        """Attach the engine-result limits of what this call computed: the notes a `lunarnav.report.limits` helper returns
        for the engine objects (the only rule; no applicability is decided here)."""
        for n in notes:
            self.engine_limits.setdefault((n.id, n.text), note_record(n))

    def inherit(self, records: Iterable[dict[str, Any]]) -> None:
        """Carry the engine-result limits of records this call reads (a derived value keeps those of its inputs)."""
        for r in records:
            self.engine_limits.setdefault((r["id"], r["text"]), dict(r))

    def note(self, limit_id: str, line: str) -> None:
        """Add a line under a limit this call carries."""
        self.limit_notes.setdefault(limit_id, set()).add(line)

    def provider(self, terrain: str):
        provider, deps = self.state.provider(terrain, getattr(self, "terrain_stores", None))
        self.depend(deps)
        if terrain.startswith("user:"):
            self.limit_ids.add("user_dem.unvalidated")
        return provider


    def _create(self, name: str, data: bytes) -> str:
        """Create ``state/results/<name>`` (a numbered variant if taken); returns the run-root-relative path."""
        stem, _, suffix = name.rpartition(".")
        directory = self.ctx.paths.results
        for n in range(1, 10_000):
            path = directory / (name if n == 1 else f"{stem}-{n}.{suffix}")
            try:
                fsafe.write_new(path, data, mkdir=True)
            except FileExistsError:
                continue
            rel = self.ctx.paths.rel(path)
            self.files.append({"path": rel, "sha256": sha256_bytes(data)})
            return rel
        raise ToolError(f"too many result files named {name!r}")

    def write_json(self, name: str, obj: Any) -> str:
        """Write a JSON result file; its numbers become citable through this call's ledger entry."""
        return self._create(f"{self.tool}-{name}.json", canonical_json(obj).encode("utf-8"))

    def write_csv(self, name: str, header: Sequence[str], rows: Iterable[Sequence[Any]]) -> str:
        """Write a CSV series file (not parsed into the number registry: re-derive cited values)."""
        buffer = io.StringIO(newline="")
        writer = csv.writer(buffer)
        writer.writerow(header)
        writer.writerows(rows)
        return self._create(f"{self.tool}-{name}.csv", buffer.getvalue().encode("utf-8"))

    def assume(self, key: str, statement: str, basis: str, impact: str) -> str:
        """Record an assumption needing sign-off once per ``key``; this call then depends on it. Returns its id."""
        from ..events import AssumptionRecorded
        from ..signoff import append_assumption, find_by_key

        stored = find_by_key(self.ctx.paths, key)
        if stored is None:
            stored = append_assumption(self.ctx.paths, key=key, statement=statement, basis=basis, impact=impact,
                                       needs_signoff=True)
            self.ctx.emit(AssumptionRecorded, assumption_id=stored["assumption_id"], statement=statement,
                          basis=basis, impact=impact, needs_signoff=True)
        self.deps.add(stored["assumption_id"])
        return stored["assumption_id"]

    def add_limits(self, *ids: str) -> None:
        for i in ids:
            if i not in LIMITS:
                raise KeyError(f"{i}: not a harness limit (engine-result limits come from lunarnav.report.limits via add_notes)")
            self.limit_ids.add(i)

    def save_scenario(self, scenario: Scenario, created_by: str) -> str:
        self.scenario_id = self.state.save_scenario(
            scenario, self.deps, created_by=created_by, limits=self.limit_ids,
            limit_notes={k: sorted(v) for k, v in self.limit_notes.items()})
        return self.scenario_id

    def register(self, relative: str, kind: str, description: str) -> dict[str, Any]:
        """Register a produced file as an artifact (the interface lists it)."""
        return register_file(self.ctx, relative, kind, description)

    def finish(self, out: T, *, provenance: dict[str, Any] | None = None) -> T:
        """Attach limits, dependencies and ledger extras to ``out`` (an `EngineOutput`)."""
        assert isinstance(out, EngineOutput)
        current = CURRENT_CALL.get()
        if current is not None and current[0] == self.tool:
            mark_overrides(self, *current)
        prov = provenance if provenance is not None else self.provenance
        if prov is not None and "kernels" not in prov:
            prov = _with_engine_versions(prov)
        notes = {k: sorted(v) for k, v in self.limit_notes.items() if k in self.limit_ids}
        records = sorted(self.engine_limits.values(), key=lambda r: r["id"])
        ids = sorted(self.limit_ids | {r["id"] for r in records})
        titles = {r["id"]: r["title"] for r in records}
        out.limits = [{"id": i, "title": titles.get(i) or limit_title(i)} for i in ids]
        out.depends_on = sorted(self.deps)
        out.warnings = [*out.warnings, *self.warnings]
        out.result_files = [f["path"] for f in self.files]
        out.invariant_violations = list(self.violations)
        if prov is not None:
            out.data_versions = {**out.data_versions, **data_versions(prov)}
        out.ledger_extra = {
            "depends_on": sorted(self.deps), "limits": ids, "limit_records": records, "limit_notes": notes, "files": self.files,
            "scenario_id": self.scenario_id,
            **({"provenance": trim_provenance(prov)} if prov is not None else {}),
            **({"invalid": list(self.violations)} if self.violations else {}),
        }
        return out
