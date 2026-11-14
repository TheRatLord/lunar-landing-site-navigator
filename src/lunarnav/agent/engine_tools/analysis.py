"""Engine analysis tools: evaluate, scan, slip, rank, sensitivity, attribution, comparison, illumination."""

from __future__ import annotations

from typing import Annotated, Any, ClassVar, Literal

import numpy as np
from pydantic import BaseModel, Field

from lunarnav.catalog import load_sites
from lunarnav.ephem import et_to_utc
from lunarnav.report.limits import (
    applicable_limits,
    attribution_limits,
    compare_limits,
    illumination_limits,
    rank_limits,
    result_context,
    sensitivity_limits,
)
from lunarnav.report.limits import scan_limits as report_scan_limits
from lunarnav.report.limits import slip_limits as report_slip_limits
from lunarnav.scenario import (
    SiteSpec,
    attribute_event,
    compare_scenarios,
    evaluate_scenario,
    height_sensitivity,
    position_sensitivity,
    rank_sites,
    scan_opportunities,
    slip_analysis,
)
from lunarnav.scenario.evaluate import EVENT_KINDS, SiteEvaluation
from lunarnav.scenario.illumination import SpanFilter, evaluation_illumination
from lunarnav.scenario.models import Scenario
from lunarnav.scenario.opportunities import MARGINAL, lunation_index
from lunarnav.scenario.provenance import scenario_hash

from ..registry import LEDGER_ID_PLACEHOLDER, AgentTool, ToolContext, ToolError, agent_tool
from ..trace import row_id
from . import invariants as inv
from .common import Call, EngineOutput
from .jsonable import head, jsonable
from .scenario_build import SiteIn, terrain_coverage

TERRAIN_DOC = "'stock' (LOLA terrain stack, default), 'sphere' (no terrain) or 'user:<dem_id>'"
HOUR_S = 3600.0
class _Base(BaseModel):
    scenario_id: str = Field(description="Id returned by build_scenario.")
    terrain: str = Field(default="stock", description=f"Terrain model: {TERRAIN_DOC}.")


def utc_s(et: float) -> str:
    """UTC to whole seconds (the engine's edge resolution is far coarser)."""
    return et_to_utc(et, 0)


def _interval(r: Any) -> dict[str, Any]:
    return {
        "start_utc": utc_s(r.start_et), "end_utc": utc_s(r.end_et), "duration_h": r.duration_s / HOUR_S,
        "start_range_utc": [utc_s(x) for x in r.start_range], "end_range_utc": [utc_s(x) for x in r.end_range],
        "start_censored": bool(r.start_censored), "end_censored": bool(r.end_censored),
        "nominal": bool(r.nominal), "certain": bool(r.certain),
        "start_range_censored": bool(r.start_range_censored), "end_range_censored": bool(r.end_range_censored),
        "start_worlds": None if r.start_worlds is None else list(r.start_worlds),
        "end_worlds": None if r.end_worlds is None else list(r.end_worlds)}


def prepare(call: Call, sid: str, terrain: str) -> tuple[Scenario, Any]:
    """Load the scenario and provider (the scenario's harness limits join the call; engine-result limits are attached from
    the result by the report's helper, never from an input)."""
    sc = call.scenario(sid)
    return sc, call.provider(terrain)


def _heading_unknown(sc: Scenario) -> bool:
    """The state of charge is a constraint and the lander heading is unknown."""
    return "min_state_of_charge" in sc.constraints.active() and not sc.profile.attitude.heading_known


def _row_heading(row: Any) -> dict[str, Any]:
    """Heading fields of a slip or rank row, read from the engine's verdict (the engine applies its heading rule to these
    rows): ``heading_dependent`` and the engine's ``heading_note``. Nothing is derived here."""
    v = getattr(row, "verdict", None)
    notes = [c.heading_note for c in (v.constraints if v is not None else ()) if c.heading_dependent]
    return {"heading_dependent": True, "heading_note": " ".join(notes)} if notes else {"heading_dependent": False}


def withhold_soc(row: dict[str, Any], keys: tuple[str, ...]) -> dict[str, Any]:
    """Drop the margin and text of a row whose margin the engine marks `best_case` (`engine.margin_kind`: a failing
    point limited by the state of charge with an unknown heading, whose margin is the one at the upper bound over
    headings, which no single heading achieves, and so no outcome). The rule is the engine's; the row keeps its `margin_kind` and `margin_note`."""
    if row.get("margin_kind") == "best_case":
        row = {k: v for k, v in row.items() if k not in keys}
        row["margin_withheld"] = "heading unknown"
    return row


def heading_matters(ev: SiteEvaluation) -> bool:
    """The engine's finding that the lander heading changes this result: the heading analysis says the outcome depends on
    it, or a constraint verdict is heading-dependent, or a series has no nominal case for want of a heading."""
    h = ev.heading
    return bool((h is not None and h.depends) or any(c.heading_dependent for c in ev.verdict.constraints)
                or ev.no_nominal_series)


def heading_view(ev: SiteEvaluation, full: bool) -> dict[str, Any] | None:
    """The engine's `HeadingAnalysis` as JSON; inline (``full`` False) without the per-heading series."""
    h = ev.heading
    if h is None:
        return None
    d = jsonable(h.to_dict())
    if not full:
        d.pop("yaws_deg", None)
        for c in d.get("constraints", []):
            c.pop("values_by_heading", None)
    return d


PRODUCT_KEYS = ("dem_id", "sigma_z_m", "sigma_xy_m", "basis_z", "basis_xy", "sigma_z_origin", "per_pixel_layer")
SOURCE_CHARS = 200


def terrain_basis_view(ev: SiteEvaluation, full: bool = False) -> dict[str, Any]:
    """Which terrain product's error widened each horizon and on what basis (published / measured / assumed).

    Taken from the engine provenance: the settings (`mode`, `k_sigma`), the budget applied to each horizon
    (`horizons[observer].budget`; observers with the same budget are listed together) and the `error_table` rows of
    the stores those budgets name, with the basis of the vertical (`basis_z`) and horizontal (`basis_xy`) figure.
    Inline the product rows keep their identifying fields and a short source; ``full`` keeps every field."""
    prov = ev.provenance
    te = prov.get("terrain_error") or {}
    budgets = {obs: rep["budget"] for obs, rep in (prov.get("horizons") or {}).items()
               if isinstance(rep, dict) and rep.get("budget")}
    applied: list[dict[str, Any]] = []
    for obs, b in budgets.items():
        same = next((a for a in applied if {k: v for k, v in a.items() if k != "observers"} == b), None)
        if same is None:
            applied.append({"observers": [obs], **b})
        else:
            same["observers"].append(obs)
    stores = te.get("stores") or []
    used = sorted({i for b in budgets.values() for i in (b.get("store_index") or []) if isinstance(i, int) and i >= 0})
    rows = [stores[i] for i in used if i < len(stores)] if used else list(stores)[:8]
    if not full:
        rows = [{**{k: r[k] for k in PRODUCT_KEYS if k in r}, "source": str(r.get("source", ""))[:SOURCE_CHARS]} for r in rows]
    return jsonable({"enabled": te.get("enabled"), "mode": te.get("mode"), "k_sigma": te.get("k_sigma"),
                     "applied": applied, "products": rows, "seam_warnings": list(ev.warnings), "seams": seams_of(prov)})


def seams_of(prov: dict[str, Any]) -> dict[str, Any]:
    """The ``near_field_seam`` record of each horizon whose ground store changes within the near field."""
    out = {}
    for obs, rep in (prov.get("horizons") or {}).items():
        seam = ((rep or {}).get("provenance") or {}).get("near_field_seam")
        if isinstance(seam, dict) and seam.get("present"):
            out[obs] = seam
    return out


def bounds_view(ev: SiteEvaluation, provider: Any, full: bool) -> list[dict[str, Any]]:
    """Per-constraint account of which bound (heading, terrain, both, none) moves the result (`bound_attribution`)."""
    rows = []
    for c in ev.bound_attribution(provider).constraints:
        d = jsonable(c.to_dict())
        if not full:
            d = {k: d[k] for k in ("key", "label", "unit", "cause", "spread_h", "interval_kind", "contributions", "note")}
        rows.append(d)
    return rows


def evaluation_view(ev: SiteEvaluation, kinds: list[str] | None, n_rows: int, *, full: bool = False,
                    provider: Any = None) -> dict[str, Any]:
    """Compact JSON of an evaluation: verdict, heading, metrics, next events, intervals (first ``n_rows`` each)."""
    out: dict[str, Any] = {
        "landing_utc": utc_s(ev.t_land_et), "mission_end_utc": utc_s(ev.t_land_et + ev.mission_s),
        "verdict": jsonable(ev.verdict.to_dict()), "heading": heading_view(ev, full),
        "bounds": bounds_view(ev, provider, full), "terrain_error": terrain_basis_view(ev, full),
        "warnings": list(ev.warnings), "metrics": jsonable(list(ev.metrics)),
        "next_events": {}, "intervals": {}}
    for kind in EVENT_KINDS:
        ne = ev.next_event(kind)
        out["next_events"][kind] = None if ne is None else {
            "utc": ne.utc, "hours_from_landing": ne.hours, "range_utc": [utc_s(x) for x in ne.range_et],
            "one_sided": bool(ne.one_sided), "missing_worlds": list(ne.missing_worlds),
            "cause": ne.cause, "name": ne.name}
    for kind, rows in ev.intervals.items():
        if kinds is not None and kind not in kinds:
            continue
        dicts = [_interval(r) for r in rows]
        out["intervals"][kind] = {**head(dicts, n_rows), "longest_h": max((d["duration_h"] for d in dicts), default=None)}
    return out


class EvaluateInput(_Base):
    """Arguments of `evaluate_site`."""

    interval_kinds: list[str] | None = Field(default=None, description="Interval kinds to list (default all).")
    max_intervals: int = Field(default=4, ge=0, le=50, description="Intervals listed inline per kind; all go to the result file.")


class EvaluateOutput(EngineOutput):
    """Verdict, headline metrics, next events and intervals of one scenario."""

    scenario_id: str
    terrain: str
    ROW_LISTS: ClassVar[dict[str, str]] = {"metrics": "", "bounds": "", "verdict.constraints": "", "bounds.events": "", "bounds.events.worlds": "",
                                           "terrain_error.products": "", "terrain_error.stores": "",
                                           "intervals.*.rows": "start_utc"}

    terrain_coverage: dict[str, Any]
    landing_utc: str
    mission_end_utc: str
    verdict: dict[str, Any]
    heading: dict[str, Any] | None = None
    bounds: list[dict[str, Any]] = Field(default_factory=list)
    terrain_error: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    metrics: list[dict[str, Any]]
    next_events: dict[str, Any]
    intervals: dict[str, Any]


@agent_tool(
    "evaluate_site",
    "Evaluate one scenario over its mission: verdict (pass/marginal/fail), the limiting constraint, margins "
    "for every active constraint with optimistic/pessimistic-horizon ranges, headline metrics, next "
    "sunset/sunrise/earthset/earthrise and the sunlit/dark/eclipse/contact intervals. When the lander heading "
    "is unknown (catalogue profiles) the state-of-charge row has no value: read `heading` and the row's "
    "heading_note, `heading_best` / `heading_worst` (the best and worst single heading on the nominal horizon, with yaw and "
    "value; `heading_basis` says what they are) and the headings that pass. The optimistic and pessimistic cases are "
    "bounds over headings that no single heading achieves; `bounds[].cause` says whether heading, terrain "
    "error, both or neither moves a range; `terrain_error` gives the basis of the terrain error.",
    EvaluateInput, read_only=True)
async def evaluate_site(ctx: ToolContext, args: EvaluateInput) -> EvaluateOutput:
    call = Call(ctx, "evaluate_site")
    sc, provider = prepare(call, args.scenario_id, args.terrain)

    def work() -> tuple[SiteEvaluation, dict[str, Any], dict[str, Any]]:
        ev = evaluate_scenario(sc, provider)
        return (ev, evaluation_view(ev, args.interval_kinds, args.max_intervals, provider=provider),
                evaluation_view(ev, None, 100_000, full=True, provider=provider))

    ev, view, full = await call.run(work)
    call.add_notes(applicable_limits(ev))
    call.violations.extend(inv.check_evaluation(full))
    call.write_json("full", full)
    cov = terrain_coverage(provider, sc)
    v = view["verdict"]
    out = EvaluateOutput(
        scenario_id=args.scenario_id, terrain=args.terrain, terrain_coverage=cov, **view,
        summary=f"{v['state']} (limiting: {v.get('limiting')}) for {sc.name}, landing {view['landing_utc']}"
        + (" - depends on the lander heading, which is unknown" if any(
            c.get("heading_dependent") for c in v.get("constraints", [])) else ""))
    return call.finish(out, provenance=ev.provenance)


class ScanInput(_Base):
    """Arguments of `scan_opportunities`."""

    start_utc: str
    end_utc: str
    spacing_h: float = Field(default=1.0, gt=0, le=48, description="Candidate landing spacing, hours.")
    signal_step_min: float = Field(default=30.0, gt=0, le=60, description="Signal time step, minutes (the engine accepts at most 3600 s).")
    lookback_h: float = Field(default=720.0, ge=0, le=2000)
    calendar_bin_h: float = Field(default=6.0, gt=0, le=72)
    max_windows: int = Field(default=12, ge=1, le=100)


class ScanOutput(EngineOutput):
    """Which landing times work."""

    n_candidates: int
    heading_unknown: bool = False
    """The lander heading is unknown: a marginal candidate may pass at some headings (evaluate it to see which)."""
    counts: dict[str, int]
    closing_constraints: dict[str, int]
    n_windows: int
    windows: list[dict[str, Any]]
    lunations: list[dict[str, Any]]
    ROW_LISTS: ClassVar[dict[str, str]] = {"windows": "start_utc", "lunations": "number"}


@agent_tool(
    "scan_opportunities",
    "Scan candidate landing epochs between two UTC times for one scenario (site and lander fixed): counts of "
    "pass/marginal/fail candidates, which constraint closes the rest, the open windows (start, end, best "
    "epoch, robust sub-runs) and a per-lunation open fraction. The calendar grid goes to a result file.",
    ScanInput, read_only=True)
async def scan_tool(ctx: ToolContext, args: ScanInput) -> ScanOutput:
    call = Call(ctx, "scan_opportunities")
    sc, provider = prepare(call, args.scenario_id, args.terrain)
    call.add_limits("scan.candidate_spacing")
    call.note("scan.candidate_spacing", (
        f"this result ({LEDGER_ID_PLACEHOLDER}) sampled candidate landings every {args.spacing_h:g} h and the signals every "
        f"{args.signal_step_min:g} min: a window edge is an engine result quantised to the {args.spacing_h:g} h spacing "
        f"this call chose (the true edge lies within one spacing beyond it)"))
    scan = await call.run(lambda: scan_opportunities(
        sc, provider, start_utc=args.start_utc, end_utc=args.end_utc, spacing_s=args.spacing_h * HOUR_S,
        signal_step_s=args.signal_step_min * 60.0, lookback_h=args.lookback_h, calendar_bin_h=args.calendar_bin_h))
    call.add_notes(report_scan_limits(result_context(sc, scan), scan))
    windows = [{
        "start_utc": utc_s(w.start_et), "end_utc": utc_s(w.end_et), "duration_h": w.duration_h,
        "n_candidates": w.n_candidates, "n_pass": w.n_pass, "spacing_h": w.spacing_h,
        "best_utc": utc_s(w.best_et),
        "best_margin": w.best_margin, "best_margin_kind": w.best_margin_kind, "best_margin_note": w.best_margin_note,
        "best_state": w.best_state, "best_limiting": w.best_limiting,
        "robust_runs_utc": [[utc_s(a), utc_s(b)] for a, b in w.robust]} for w in scan.windows]
    windows = jsonable(windows)
    cal = scan.calendar
    lu_idx, _ = lunation_index(scan.et, cal.lunations)
    n_in = np.array([(lu_idx == i).sum() for i in range(len(cal.lunations))], dtype=float)
    n_open = np.array([((lu_idx == i) & (scan.state >= MARGINAL)).sum() for i in range(len(cal.lunations))], dtype=float)
    open_share = np.divide(n_open, n_in, out=np.full(n_in.shape, np.nan), where=n_in > 0)
    lunations = [{"number": int(lu.number), "start_utc": utc_s(lu.start_et), "end_utc": utc_s(lu.end_et),
                  "open_fraction_mean": float(open_share[i]) if np.isfinite(open_share[i]) else None}
                 for i, lu in enumerate(cal.lunations)]
    counts, closing = jsonable(scan.counts()), jsonable(scan.closing_constraints())
    call.violations.extend(inv.check_scan(counts, int(scan.et.size), windows))
    call.write_json("windows", {"windows": windows, "counts": counts, "closing_constraints": closing})
    call.write_json("calendar", jsonable({
        "bin_h": cal.bin_h, "keys": list(cal.keys), "lunations": lunations,
        "state": cal.state.tolist(), "open_fraction": cal.open_fraction.tolist(),
        "sun_el_deg": cal.sun_el_deg.tolist(), "local_solar_time_h": cal.local_solar_time_h.tolist()}))
    out = ScanOutput(
        n_candidates=int(scan.et.size), heading_unknown=_heading_unknown(sc), counts=counts, closing_constraints=closing, n_windows=len(windows),
        windows=windows[: args.max_windows], lunations=lunations[:24],
        summary=f"{counts.get('pass', 0)} pass, {counts.get('marginal', 0)} marginal, {counts.get('fail', 0)} fail "
                f"of {scan.et.size} candidates; {len(windows)} open window(s)")
    return call.finish(out, provenance=scan.provenance)


class SlipInput(_Base):
    """Arguments of `slip_analysis`."""

    slips_h: list[float] = Field(min_length=1, max_length=200, description="Slips in hours (negative = earlier).")
    mode: Literal["landing", "launch"] = Field(
        default="landing", description="'landing': shift the landing time. 'launch': shift the ready-to-launch "
        "time and map it through the scenario's transfer (needs build_scenario transfer).")
    search_days: float = Field(default=60.0, gt=0, le=400, description="How far ahead to look for the next open landing.")


class SlipOutput(EngineOutput):
    """Verdict at each slip and the next open landing after it."""

    mode: str
    n_pass: int
    n_open: int
    mean_margin: float | None
    rows: list[dict[str, Any]]
    ROW_LISTS: ClassVar[dict[str, str]] = {"rows": "slip_h", "rows.verdict.constraints": ""}


@agent_tool(
    "slip_analysis",
    "What still works if the date slips? Verdict, limiting constraint and margin at each slip (hours), "
    "plus the next landing that is open and how long the wait is. mode='launch' maps launch slips through "
    "the scenario's transfer (fixed duration or opportunity table), so a launch miss can jump to the next "
    "opportunity.",
    SlipInput, read_only=True)
async def slip_tool(ctx: ToolContext, args: SlipInput) -> SlipOutput:
    call = Call(ctx, "slip_analysis")
    sc, provider = prepare(call, args.scenario_id, args.terrain)
    res = await call.run(lambda: slip_analysis(
        sc, provider, slips_h=args.slips_h, mode=args.mode, search_days=args.search_days))
    call.add_notes(report_slip_limits(result_context(sc, res), res))
    keep = ("slip_h", "launch_utc", "landing_utc", "state", "limiting", "margin", "margin_kind", "margin_note", "explanation",
            "next_open_utc", "next_open_wait_h", "next_open_state", "next_open_candidates", "next_open_span_h",
            "candidate_spacing_h")
    rows = [withhold_soc({**{k: jsonable(getattr(r, k)) for k in keep}, **_row_heading(r)}, ("margin", "explanation"))
            for r in res.rows]
    call.violations.extend(inv.check_slip(rows, res.n_pass, res.n_open))
    call.write_json("rows", {"rows": [jsonable(r) for r in res.rows]})
    out = SlipOutput(mode=res.mode, n_pass=res.n_pass, n_open=res.n_open, mean_margin=None if any("margin_withheld" in r for r in rows) else jsonable(res.mean_margin),
                     rows=rows, summary=f"{res.n_pass} of {len(rows)} slips pass, {res.n_open} are open")
    return call.finish(out, provenance=res.provenance)


class RankInput(_Base):
    """Arguments of `rank_alternative_sites`."""

    sites: list[str | SiteIn] = Field(min_length=1, max_length=40, description="Catalogue site ids or custom points.")
    slips_h: list[float] = Field(default_factory=lambda: [0.0], max_length=100)
    mode: Literal["landing", "launch"] = "landing"
    search_days: float = Field(default=60.0, gt=0, le=400)


class RankOutput(EngineOutput):
    """Candidate sites under the same lander, constraints and slips."""

    ranking_rule: str = ("the engine's order: slips that pass (most first), then slips that are open (pass or marginal), "
                         "then mean margin; rank is the position in that order")
    sites: list[dict[str, Any]]
    ROW_LISTS: ClassVar[dict[str, str]] = {"sites": "site", "sites.slips": "slip_h"}


@agent_tool(
    "rank_alternative_sites",
    "Run the same lander/constraints/slips at several candidate sites and rank them as the engine does: most "
    "passing slips, then most open slips, then mean margin. Use for 'if site A is lost, where else?'.",
    RankInput, read_only=True)
async def rank_tool(ctx: ToolContext, args: RankInput) -> RankOutput:
    call = Call(ctx, "rank_alternative_sites")
    sc, provider = prepare(call, args.scenario_id, args.terrain)
    catalog = {s.id: s for s in load_sites()}
    specs: list[SiteSpec] = []
    for s in args.sites:
        if isinstance(s, str):
            if s not in catalog:
                raise ToolError(f"unknown site id {s!r}; use catalog_search")
            e = catalog[s]
            specs.append(SiteSpec(lat_deg=e.lat_deg, lon_deg=e.lon_deg, name=e.name, catalog_id=e.id))
        else:
            specs.append(SiteSpec(lat_deg=s.lat_deg, lon_deg=s.lon_deg, name=s.name or f"{s.lat_deg:g},{s.lon_deg:g}"))
    results = await call.run(lambda: rank_sites(
        sc, specs, provider, slips_h=args.slips_h, mode=args.mode, search_days=args.search_days))
    rows = []
    assert len(results) == len(specs)
    call.add_notes(rank_limits(sc, results))
    rows = []
    for rank, r in enumerate(results, 1):
        spec = r.site
        slips = [{"slip_h": x.slip_h, "state": x.state, "limiting": x.limiting, "margin": jsonable(x.margin),
                  "margin_kind": x.margin_kind, "margin_note": x.margin_note,
                  "next_open_wait_h": jsonable(x.next_open_wait_h),
                  "next_open_candidates": x.next_open_candidates, "next_open_span_h": jsonable(x.next_open_span_h),
                  **_row_heading(x)} for x in r.rows]
        slips = [withhold_soc(s, ("margin",)) for s in slips]
        call.violations.extend(inv.check_slip(slips, r.n_pass, r.n_open))
        rows.append({"rank": rank, "site": spec.catalog_id or row_id(f"{spec.name}-{spec.lat_deg:.3f}_{spec.lon_deg:.3f}"), "name": spec.name, "lat_deg": spec.lat_deg,
                     "lon_deg": spec.lon_deg, "n_pass": r.n_pass, "n_open": r.n_open,
                     "mean_margin": None if any("margin_withheld" in s for s in slips) else jsonable(r.mean_margin),
                     "scenario_sha256": r.provenance.get("scenario_sha256"), "slips": slips})
    call.write_json("sites", {"sites": rows})
    out = RankOutput(sites=rows, summary=f"best: {rows[0]['site']} ({rows[0]['n_pass']} pass)")
    prov = {**results[0].provenance, "scenario_sha256": scenario_hash(sc)} if results else None
    return call.finish(out, provenance=prov)


class SensitivityInput(_Base):
    """Arguments of `sensitivity`."""

    kind: Literal["array_height", "antenna_height", "position"]
    values_m: list[Annotated[float, Field(ge=0, le=100_000)]] | None = Field(
        default=None, max_length=30, description="Heights (m) for the height kinds, shift distances (m) for "
        "position; position default is the engine's ring of distances. Positions are shifted along 8 azimuths.")


class SensitivityOutput(EngineOutput):
    """Baseline and variants."""

    kind: str
    baseline: dict[str, Any]
    rows: list[dict[str, Any]]
    ROW_LISTS: ClassVar[dict[str, str]] = {"rows": "case"}


def _sens_row(r: Any) -> dict[str, Any]:
    return jsonable({"case": row_id(r.label), "label": r.label, "value": r.value, "az_deg": r.az_deg, "lat_deg": r.lat_deg, "lon_deg": r.lon_deg,
                     "state": r.state, "limiting": r.limiting, "metrics": r.metrics, "margins": r.margins})


@agent_tool(
    "sensitivity",
    "How much do mast height or landing position matter? kind=array_height or antenna_height re-evaluates at "
    "each height (m); kind=position shifts the site along 8 azimuths by each distance (m). Verdict, limiting "
    "constraint, metrics and margins per variant.",
    SensitivityInput, read_only=True)
async def sensitivity_tool(ctx: ToolContext, args: SensitivityInput) -> SensitivityOutput:
    call = Call(ctx, "sensitivity")
    sc, provider = prepare(call, args.scenario_id, args.terrain)
    if args.kind == "position":
        res = await call.run(lambda: position_sensitivity(sc, provider, distances_m=args.values_m))
    else:
        if not args.values_m:
            raise ToolError("values_m (heights in metres) is required for the height kinds")
        kind = "array" if args.kind == "array_height" else "antenna"
        res = await call.run(lambda: height_sensitivity(sc, provider, kind=kind, heights_m=args.values_m))
    call.add_notes(sensitivity_limits(res.baseline.evaluation, res))
    base, rows = _sens_row(res.baseline), [_sens_row(r) for r in res.rows]
    call.violations.extend(inv.check_sensitivity(args.kind, base, rows))
    call.write_json("rows", {"baseline": base, "rows": rows})
    out = SensitivityOutput(kind=args.kind, baseline=base, rows=rows[:60],
                            summary=f"baseline {base['state']}; {len(rows)} variants")
    return call.finish(out, provenance=res.baseline.evaluation.provenance)


class AttributeInput(_Base):
    """Arguments of `attribute_event`."""

    kind: Literal["sunset", "sunrise", "earthset", "earthrise"]
    from_utc: str | None = Field(default=None, description="Attribute the first such event at or after this UTC "
                                 "(default: first after landing).")
    window_h: float = Field(default=12.0, gt=0, le=72)


class AttributeOutput(EngineOutput):
    """Why an event happens when it does."""

    attribution: dict[str, Any] | None


@agent_tool(
    "attribute_event",
    "Explain an event: for the first sunset/sunrise/earthset/earthrise at or after a time, whether terrain or "
    "the smooth sphere sets it, the azimuth, the blocking terrain point (lat/lon/height/distance) and the "
    "horizon and object elevations.",
    AttributeInput, read_only=True)
async def attribute_tool(ctx: ToolContext, args: AttributeInput) -> AttributeOutput:
    call = Call(ctx, "attribute_event")
    sc, provider = prepare(call, args.scenario_id, args.terrain)

    def work() -> tuple[SiteEvaluation, Any]:
        ev = evaluate_scenario(sc, provider)
        return ev, attribute_event(ev, args.kind, args.from_utc, provider, window_h=args.window_h)

    ev, att = await call.run(work)
    call.add_notes(attribution_limits(ev))
    view = None if att is None else jsonable(att)
    out = AttributeOutput(attribution=view, summary="no such event in the analysed span" if att is None else
                          f"{args.kind} at {att.utc}: {att.cause}")
    return call.finish(out, provenance=ev.provenance)


class CompareInput(BaseModel):
    """Arguments of `compare_scenarios`."""

    scenario_ids: list[str] = Field(min_length=2, max_length=8)
    terrain: str = Field(default="stock", description=f"Terrain model: {TERRAIN_DOC}.")


class CompareOutput(EngineOutput):
    """Side-by-side metrics and verdicts."""

    scenarios: list[dict[str, Any]]
    """One row per scenario: ``scenario_id``, ``state``, ``limiting`` and its ``metrics`` (metric, label, unit, value)."""
    ROW_LISTS: ClassVar[dict[str, str]] = {"scenarios": "scenario_id", "scenarios.metrics": ""}


@agent_tool(
    "compare_scenarios",
    "Compare 2-8 scenarios side by side on the same terrain: verdict, limiting constraint and every headline "
    "metric. Typical use: old plan versus new plan, or lander A versus lander B at one site.",
    CompareInput, read_only=True)
async def compare_tool(ctx: ToolContext, args: CompareInput) -> CompareOutput:
    call = Call(ctx, "compare_scenarios")
    scs: list[Scenario] = []
    provider = call.provider(args.terrain)
    for sid in args.scenario_ids:
        sc = call.scenario(sid)
        scs.append(sc.model_copy(update={"name": f"{sc.name} [{sid}]"}))
    cmp = await call.run(lambda: compare_scenarios(scs, provider))
    call.add_notes(compare_limits(cmp.evaluations[0], cmp))
    call.violations.extend(inv.check_comparison(cmp.states, cmp.limiting))
    for v in cmp.verdicts:
        call.violations.extend(inv.check_verdict(jsonable(v.to_dict())))
    table = jsonable(cmp.rows())
    scenarios = [{"scenario_id": sid, "state": state, "limiting": limiting,
                  "metrics": [{"metric": r["metric"], "label": r["label"], "unit": r["unit"], "value": r[name]}
                              for r in table]}
                 for sid, name, state, limiting in zip(args.scenario_ids, cmp.names, cmp.states, cmp.limiting, strict=True)]
    call.write_json("matrix", {"scenarios": scenarios})
    out = CompareOutput(scenarios=scenarios, summary="; ".join(
        f"{s['scenario_id']}: {s['state']}" for s in scenarios))
    return call.finish(out, provenance=cmp.evaluations[0].provenance)


class IlluminationInput(_Base):
    """Arguments of `illumination_stats`."""

    window: Literal["mission", "analysis"] = "mission"
    max_dark_gap_h: float | None = Field(default=None, ge=0, description="Merge dark gaps shorter than this (ESA quasi-continuous: 48).")
    min_light_span_h: float | None = Field(default=None, ge=0, description="Drop light spans shorter than this (ESA: 48).")
    earth_masks_deg: list[float] = Field(default=[0.0], max_length=6)


class IlluminationOutput(EngineOutput):
    """Average illumination, longest light/dark spans under four sunlight definitions, Earth visibility."""

    sun: dict[str, Any]
    earth: dict[str, Any]


@agent_tool(
    "illumination_stats",
    "Illumination statistics over the mission (or the whole analysed span): average illumination, fraction "
    "lit and longest light/shadow span under the definitions any_part, centre, half_flux and "
    "half_flux_with_earth_eclipse, optional ESA span filtering, and Earth-visibility fractions for given masks. "
    "State which definition you quote.",
    IlluminationInput, read_only=True)
async def illumination_tool(ctx: ToolContext, args: IlluminationInput) -> IlluminationOutput:
    call = Call(ctx, "illumination_stats")
    sc, provider = prepare(call, args.scenario_id, args.terrain)

    def work() -> tuple[SiteEvaluation, Any, Any]:
        ev = evaluate_scenario(sc, provider)
        sun, earth = evaluation_illumination(
            ev, window=args.window, span_filter=SpanFilter(args.max_dark_gap_h, args.min_light_span_h),
            earth_masks_deg=tuple(args.earth_masks_deg))
        return ev, sun, earth

    ev, sun, earth = await call.run(work)
    call.add_notes(illumination_limits(ev, whole_span=args.window == "analysis"))
    sun_d, earth_d = jsonable(sun.to_dict()), jsonable(earth.to_dict())
    call.violations.extend(inv.check_fractions({"sun": sun_d, "earth": earth_d}))
    call.write_json("stats", {"sun": sun_d, "earth": earth_d})
    out = IlluminationOutput(sun=sun_d, earth=earth_d, summary=f"illumination over the {args.window} window")
    return call.finish(out, provenance=ev.provenance)


def analysis_tools() -> list[AgentTool[Any]]:
    """The scenario analysis tools."""
    return [evaluate_site, scan_tool, slip_tool, rank_tool, sensitivity_tool, attribute_tool, compare_tool,
            illumination_tool]
