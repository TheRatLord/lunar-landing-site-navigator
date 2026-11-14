"""Engine tools that write deliverables (``export_results``) and support honest reporting
(``derive``, ``check_report``)."""

from __future__ import annotations

import ast
import math
import re
from typing import Any, ClassVar, Literal

from pydantic import BaseModel, Field

from lunarnav.report.limits import report_limits
from lunarnav.scenario import evaluate_scenario, scan_opportunities, slip_analysis
from lunarnav.scenario.export import (
    export_evaluation,
    write_calendar_csv,
    write_opportunities_csv,
    write_slip_csv,
)

from .. import fsafe
from ..guard import check_answer
from ..limits import LIMITS
from ..numbers import Quantity
from ..registry import AgentTool, ToolContext, ToolError, agent_tool
from ..trace import Source, build_registry, weakest
from . import instants
from .analysis import HOUR_S, TERRAIN_DOC, prepare
from .common import Call, EngineOutput
from .jsonable import jsonable

_PREFIX = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,60}$")


class ExportInput(BaseModel):
    """Arguments of `export_results`."""

    scenario_id: str
    prefix: str = Field(description="File-name prefix (letters, digits, _ . -).")
    terrain: str = Field(default="stock", description=f"Terrain model: {TERRAIN_DOC}.")
    slips_h: list[float] | None = Field(default=None, max_length=200, description="Also export a slip table for these slips.")
    slip_mode: Literal["landing", "launch"] = "landing"
    scan_start_utc: str | None = Field(default=None, description="With scan_end_utc: also export an opportunity scan and calendar.")
    scan_end_utc: str | None = None
    scan_spacing_h: float = Field(default=1.0, gt=0, le=48)


class ExportOutput(EngineOutput):
    """Files written and registered as artifacts."""

    files: list[dict[str, Any]]
    ROW_LISTS: ClassVar[dict[str, str]] = {"files": "path", "scenario.network.stations": "", "scenario.profile.panels": "",
                                           "terrain_error.stores": "", "terrain_error.products": "", "bounds.events": "", "bounds.events.worlds": "",
                                           "profile.panels": "", "network.stations": "",
                                           "provenance.scenario.network.stations": "", "provenance.scenario.profile.panels": "",
                                           "provenance.terrain_error.stores": ""}


@agent_tool(
    "export_results",
    "Write the deliverable files for a scenario into the run's read-only exports area (state/exports) and register each as an artifact: scenario "
    "JSON, time-series CSV/JSON, intervals CSV, metrics CSV, STK .aem pointing files (antenna and array), "
    "and optionally a slip table and an opportunity scan + calendar CSV. Every CSV carries provenance lines "
    "and a .provenance.json sidecar.",
    ExportInput, read_only=False)
async def export_tool(ctx: ToolContext, args: ExportInput) -> ExportOutput:
    if not _PREFIX.match(args.prefix):
        raise ToolError("prefix may only contain letters, digits, '_', '.', '-' and must start with a letter or digit")
    call = Call(ctx, "export_results")
    sc, provider = prepare(call, args.scenario_id, args.terrain)
    directory = ctx.paths.exports / args.prefix
    fsafe.mkdirs(directory)

    def work() -> tuple[Any, Any, Any]:
        ev = evaluate_scenario(sc, provider)
        res = scan = None
        written = export_evaluation(ev, directory, args.prefix)
        if args.slips_h:
            res = slip_analysis(sc, provider, slips_h=args.slips_h, mode=args.slip_mode)
            written["slip"] = write_slip_csv(res, directory / f"{args.prefix}.slip.csv")
        if args.scan_start_utc and args.scan_end_utc:
            scan = scan_opportunities(sc, provider, start_utc=args.scan_start_utc, end_utc=args.scan_end_utc,
                                      spacing_s=args.scan_spacing_h * HOUR_S)
            written["opportunities"] = write_opportunities_csv(scan, directory / f"{args.prefix}.opportunities.csv")
            written["calendar"] = write_calendar_csv(scan, directory / f"{args.prefix}.calendar.csv")
        return ev, res, scan

    ev, slip, scan = await call.run(work)
    call.add_notes(report_limits(ev, slip=slip, scan=scan))
    files = []
    for name in fsafe.list_dir(directory):
        path = directory / name
        if fsafe.exists(path):
            rel = ctx.paths.rel(path)
            stored = call.register(rel, "export", f"{args.prefix}: {path.name}")
            files.append({"path": rel, "artifact_id": stored["artifact_id"], "size_bytes": stored["size_bytes"]})
            call.files.append({"path": rel, "sha256": stored["sha256"]})
    out = ExportOutput(files=files, summary=f"{len(files)} files in state/exports/{args.prefix}/ registered as artifacts")
    return call.finish(out, provenance=ev.provenance)


_FUNCS = {"abs": abs, "min": min, "max": max, "round": round, "sqrt": math.sqrt, "log10": math.log10,
          "ln": math.log, "exp": math.exp, "floor": math.floor, "ceil": math.ceil}
_BINOPS = {ast.Add: lambda a, b: a + b, ast.Sub: lambda a, b: a - b, ast.Mult: lambda a, b: a * b,
           ast.Div: lambda a, b: a / b, ast.Pow: lambda a, b: a**b, ast.Mod: lambda a, b: a % b,
           ast.FloorDiv: lambda a, b: a // b}


def safe_eval(expression: str, names: dict[str, float]) -> float:
    """Evaluate arithmetic over ``names`` (numbers, + - * / ** % //, parentheses, a few math functions)."""

    def ev(node: ast.AST) -> float:
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
            return float(node.value)
        if isinstance(node, ast.Name) and node.id in names:
            return names[node.id]
        if isinstance(node, ast.BinOp) and type(node.op) in _BINOPS:
            right = ev(node.right)
            if isinstance(node.op, ast.Pow) and abs(right) > 64:
                raise ToolError("exponent too large")
            return _BINOPS[type(node.op)](ev(node.left), right)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            v = ev(node.operand)
            return -v if isinstance(node.op, ast.USub) else v
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _FUNCS
                and not node.keywords):
            return float(_FUNCS[node.func.id](*[ev(a) for a in node.args]))
        raise ToolError(f"unsupported expression element: {type(node).__name__}")

    try:
        tree = ast.parse(expression, mode="eval")
        return ev(tree)
    except (SyntaxError, ZeroDivisionError, ValueError, OverflowError, TypeError) as exc:
        raise ToolError(f"cannot evaluate {expression!r}: {exc}") from exc


DeriveUnit = Literal["", "%", "GHz", "Hz", "MHz", "W", "Wh", "cm", "d", "dB", "dBK", "dBW", "dBi", "deg", "fraction",
                     "h", "kW", "kWh", "kg", "km", "m", "min", "mm", "ppd", "s", "x", "count"]
"""Units a derived value may carry: a closed list, so the field cannot carry a sentence."""


class DeriveInput(BaseModel):
    """Arguments of `derive`."""

    expression: str = Field(max_length=300, description="Arithmetic over the input and instant names, e.g. '(a - b) * 24'. "
                            "An instant is its Unix-epoch seconds in the expression: 't + 3600 * d' (d in hours), "
                            "'(t1 - t0) / 3600'.")
    inputs: dict[str, DeriveValue] = Field(default_factory=dict, max_length=20)
    instants: dict[str, DeriveInstant] = Field(default_factory=dict, max_length=10, description=(
        "ISO-8601 UTC instants that already exist in a ledger record (or the request, source U), by name."))
    result: Literal["number", "instant"] = Field(default="number", description=(
        "'instant': the result is an ISO UTC instant, which must be one instant plus or minus durations. 'number': a "
        "number, which with instants must be a difference of instants (a duration)."))
    unit: DeriveUnit = Field(default="", description="Unit of the result, one of the listed units.")


class DeriveValue(BaseModel):
    """One input of `derive`: a number that already exists in a ledger record or in the request."""

    value: float
    source: str = Field(description="Ledger id (L0003 / S0002) whose output or reported values contain this number; "
                                    "L0003#row when the number is in one row of a record that holds several rows; U for a "
                                    "number the user's request states (then give its unit).")
    unit: DeriveUnit = Field(default="", description="Unit the source states the number in (needed for source U).")


class DeriveInstant(BaseModel):
    """One instant input of `derive`."""

    value: str = Field(description="ISO-8601 UTC instant with a time of day, exactly as the record states it "
                                   "(to the millisecond), e.g. 2025-03-14T03:00:00.000Z.")
    source: str = Field(description="Ledger id, L0003#row, or U when the user's request states the instant.")


DeriveInput.model_rebuild()


class DeriveOutput(EngineOutput):
    """Result of a derived quantity."""

    expression: str
    value: float | None = None
    instant_utc: str | None = None
    unit: DeriveUnit
    inputs: dict[str, dict[str, Any]]


@agent_tool(
    "derive",
    "Compute a number or a UTC instant from values that already exist in the ledger (differences, sums, ratios, unit "
    "conversions) so it is citable. Each input names the ledger id it came from (U for the user's request); inputs "
    "that do not appear in that record are refused, and so is an expression that does not depend on its inputs. "
    "Instants: pass ISO UTC instants in `instants` and use result='instant' for an instant plus or minus a duration "
    "(durations from `inputs`, each with its unit s, min, h or d and the exact conversion factor to seconds: 't + 3600 * d' "
    "for hours; a number the request gives without a unit is not a duration; the arithmetic is on UTC with no leap second, "
    "exact for 2017 onward), or result='number' for the difference of two instants in a unit s, min, h or d. The result carries the limits and the least independent kind of source of "
    "its inputs. Constants in the expression (a unit factor) are yours: use only true unit conversions. Prefer a "
    "tool or script for anything the engine can compute.",
    DeriveInput, read_only=True)
async def derive_tool(ctx: ToolContext, args: DeriveInput) -> DeriveOutput:
    call = Call(ctx, "derive")
    reg = build_registry(ctx.paths)
    if set(args.inputs) & set(args.instants):
        raise ToolError(f"a name is both an input and an instant: {sorted(set(args.inputs) & set(args.instants))}")
    names: dict[str, float] = {}
    kinds: dict[str, str] = {}
    rows: dict[str, str | None] = {}
    shown: dict[str, dict[str, Any]] = {}
    sources: dict[str, str] = {}

    def resolve(name: str, source: str) -> tuple[Source, str | None]:
        sid, _, row = source.partition("#")
        src = reg.user if sid == "U" else reg.sources.get(sid)
        if src is None:
            raise ToolError(f"input {name}: unknown ledger id {sid!r}")
        if src.problems:
            raise ToolError(f"input {name}: {sid} is invalid ({'; '.join(src.problems)})")
        blocked = reg.blocked_by(sid)
        if blocked:
            raise ToolError(f"input {name}: {sid} depends on rejected assumption(s) {blocked}")
        call.deps |= set(src.depends_on)
        call.limit_ids |= {i for i in src.limits if i in LIMITS}
        call.inherit(src.limit_records)
        sources[name] = sid
        return src, row or None

    for name, iv in args.inputs.items():
        src, row = resolve(name, iv.source)
        sid = iv.source.partition("#")[0]
        q = Quantity("number", "", 0, iv.value, 6, unit=iv.unit)
        part = src.match(q, row, anywhere=False)
        if part is None:
            if src.finds(q):
                where = f"row {row!r} of {sid}" if row else f"{sid} outside its rows"
                raise ToolError(f"input {name}: {iv.value} is not in {where}; it is in a row of {sid}: "
                                f"name it as {sid}#<row> (rows: {', '.join(src.row_ids[:12])})")
            unit_note = " (a number of the request needs the unit the user wrote)" if sid == "U" else ""
            raise ToolError(f"input {name}: {iv.value} does not appear in {iv.source}{unit_note}")
        kinds[name] = part.kind
        rows[name] = row
        names[name] = iv.value
        shown[name] = {"value": iv.value, "source": iv.source, "kind": part.kind}
    for name, ii in args.instants.items():
        src, row = resolve(name, ii.source)
        epoch = instants.parse_operand(name, ii.value)
        part = instants.traced_instant(src, epoch, row)
        if part is None:
            raise ToolError(f"instant {name}: {ii.value} is not an instant stated by {ii.source} (to the millisecond); "
                            "write it exactly as the record does, or cite the row that holds it")
        kinds[name] = part.kind
        rows[name] = row
        names[name] = epoch
        shown[name] = {"value": ii.value, "source": ii.source, "kind": part.kind}
    value = safe_eval(args.expression, names)
    want_instant = args.result == "instant"
    if args.instants:
        instants.check_linear(args.expression, names, set(args.instants), want_instant, safe_eval)
        instants.check_units(args.expression, names, set(args.instants), {k: v.unit for k, v in args.inputs.items()},
                             args.unit, want_instant, safe_eval)
    elif want_instant:
        raise ToolError("result 'instant' needs at least one instant input")
    _require_dependence(args.expression, names, value)
    if want_instant:
        if args.unit:
            raise ToolError("an instant result has no unit")
        stamp = instants.format_instant(value)
        out = DeriveOutput(expression=args.expression, instant_utc=stamp, unit="", inputs=shown,
                           summary=f"derived instant {stamp}")
    else:
        out = DeriveOutput(expression=args.expression, value=jsonable(value), unit=args.unit, inputs=shown,
                           summary=f"derived value {value:g} {args.unit}".strip())
    out = call.finish(out)
    out.ledger_extra["output_kind"] = weakest(list(kinds.values()))
    out.ledger_extra["derived_from"] = sorted(set(sources.values()))
    out.ledger_extra["derived_rows"] = sorted({r for r in rows.values() if r})
    return out


def _require_dependence(expression: str, names: dict[str, float], value: float) -> None:
    """Refuse an expression whose value does not change when its inputs do (``0 * a + 41.7``): a number typed in as a
    literal would otherwise carry the kind and limits of an input it does not depend on."""
    if not names:
        raise ToolError("derive needs at least one input from the ledger; a number you know is not a ledger number")
    for scale, shift in ((1.37, 0.5), (0.61, -0.25)):
        try:
            if abs(safe_eval(expression, {k: v * scale + shift for k, v in names.items()}) - value) > 1e-12 * max(1.0, abs(value)):
                return
        except ToolError:
            return
    raise ToolError("the value of this expression does not depend on its inputs, so it is not derived from them")


class CheckInput(BaseModel):
    """Arguments of `check_report`."""

    text: str = Field(max_length=60_000, description="The draft answer, exactly as you would send it.")


class CheckOutput(EngineOutput):
    """Issues the final-answer guard would raise."""

    ok: bool
    issues: list[dict[str, Any]]
    ROW_LISTS: ClassVar[dict[str, str]] = {"issues": ""}


@agent_tool(
    "check_report",
    "Run the final-answer guard on a draft: every number must exist in a ledger record, carry its [L...] "
    "citation (with #row for a record that holds several rows), not come from an invalid result or a rejected "
    "assumption, and clock times must be UTC. Model limits are attached to your answer by the harness. Returns the "
    "issues; fix or label ([unverified]) before sending.",
    CheckInput, read_only=True)
async def check_tool(ctx: ToolContext, args: CheckInput) -> CheckOutput:
    reg = build_registry(ctx.paths)
    issues = check_answer(args.text, reg)
    return CheckOutput(ok=not issues, issues=[i.to_dict() for i in issues],
                       summary="clean" if not issues else f"{len(issues)} issue(s)")


def export_tools() -> list[AgentTool[Any]]:
    """Export, derive and self-check tools."""
    return [export_tool, derive_tool, check_tool]
