"""History tools: past lunar landings, their lessons, similarity to a candidate, and launch vehicle records."""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Any, ClassVar, Literal

from pydantic import BaseModel, Field

from lunarnav import history
from lunarnav.catalog import CauseCategory, load_criterion_map, load_sites
from lunarnav.history_features import load_features, nearest, site_features

from ..registry import AgentTool, ToolContext, ToolError, agent_tool
from .analysis import prepare
from .common import Call, EngineOutput
from .jsonable import jsonable

Region = Literal["south_polar", "north_polar", "nonpolar", "any"]


def _region(lat: float | None) -> str | None:
    if lat is None:
        return None
    return "south_polar" if lat <= -75 else "north_polar" if lat >= 75 else "nonpolar"


def _where(m: Any) -> tuple[float | None, float | None]:
    sites = {s.id: s for s in load_sites()}
    s = sites.get(m.site_id or "") or sites.get(m.target_site_id or "")
    return (s.lat_deg, s.lon_deg) if s else (None, None)


def _mapped(m: Any) -> list[str]:
    cm = load_criterion_map()
    return sorted({c for c in (cm[x.category] for x in m.causes if x.site_related) if c})


class HistoryInput(BaseModel):
    """Arguments of `historical_landings`."""

    region: Region = "any"
    outcome: Literal["success", "partial", "failed_landing", "failed_before_landing"] | None = None
    category: CauseCategory | None = Field(default=None, description="Keep missions with a cause of this category.")
    site_related: bool | None = Field(default=None, description="Keep missions with (true) or without (false) a site-related cause.")
    limit: int = Field(default=30, ge=1, le=100)


class HistoryOutput(EngineOutput):
    """Past landing attempts."""

    n_matches: int
    rows: list[dict[str, Any]]
    ROW_LISTS: ClassVar[dict[str, str]] = {"rows": "id", "rows.causes": ""}


@agent_tool(
    "historical_landings",
    "Past lunar landing attempts (successes and failures) from the sourced history catalogue: outcome, landing "
    "time, location, causes (category, summary, site_related) and the review criteria the site-related causes "
    "count against. Only site-related causes are evidence about a landing site; engine, software and sensor "
    "faults are not.",
    HistoryInput, read_only=True)
async def historical_landings(ctx: ToolContext, args: HistoryInput) -> HistoryOutput:
    call = Call(ctx, "historical_landings")
    rows: list[dict[str, Any]] = []
    for m in history.visible_missions():
        lat, lon = _where(m)
        if args.region != "any" and _region(lat) != args.region:
            continue
        if args.outcome and m.outcome != args.outcome:
            continue
        if args.category and not any(c.category == args.category for c in m.causes):
            continue
        has_site = any(c.site_related for c in m.causes)
        if args.site_related is not None and has_site != args.site_related:
            continue
        rows.append({"id": m.id, "name": m.name, "outcome": m.outcome, "landing_utc": m.landing_utc,
                     "launch_utc": m.launch_utc, "lat_deg": lat, "lon_deg": lon, "region": _region(lat),
                     "causes": [c.model_dump(mode="json") for c in m.causes], "mapped_criteria": _mapped(m)})
    out = HistoryOutput(n_matches=len(rows), rows=jsonable(rows[: args.limit]),
                        summary=f"{len(rows)} landing attempt(s)")
    return call.finish(out)


class LessonsInput(BaseModel):
    """Arguments of `mission_lessons`."""

    mission_id: str


class LessonsOutput(EngineOutput):
    """One landing attempt in full."""

    mission: dict[str, Any]
    mapped_criteria: list[str]
    ROW_LISTS: ClassVar[dict[str, str]] = {"mission.causes": "", "mission.lessons": "", "mission.sources": ""}


@agent_tool(
    "mission_lessons",
    "Full record of one past landing attempt: causes, engineering lessons stated as checks for a new site, "
    "observed facts (tipped, power lost, impacted, landed upright) and sources.",
    LessonsInput, read_only=True)
async def mission_lessons(ctx: ToolContext, args: LessonsInput) -> LessonsOutput:
    call = Call(ctx, "mission_lessons")
    m = history.mission(args.mission_id)
    if m is None:
        raise ToolError("unknown mission")
    out = LessonsOutput(mission=jsonable(m.model_dump(mode="json")), mapped_criteria=_mapped(m),
                        summary=f"{m.name}: {m.outcome}, {len(m.causes)} cause(s)")
    return call.finish(out)


class SimilarInput(BaseModel):
    """Arguments of `similar_past_landings`."""

    scenario_id: str = Field(description="Id returned by build_scenario.")
    terrain: str = Field(default="stock", description="'stock' (LOLA terrain stack) or 'sphere'.")
    top_k: int = Field(default=5, ge=1, le=20)


class SimilarOutput(EngineOutput):
    """Past landings closest to the candidate."""

    candidate_features: dict[str, Any]
    rows: list[dict[str, Any]]
    ROW_LISTS: ClassVar[dict[str, str]] = {"rows": "mission_id"}


@agent_tool(
    "similar_past_landings",
    "Compare the scenario's site and landing time with every past landing attempt on the same features "
    "(|latitude|, 20 m slope at the point, 95th-percentile slope within 300 m, height range within 1 km, Sun "
    "elevation at landing, Sun margin above the terrain horizon, terrain resolution) and return the closest "
    "attempts with which features match (within 0.5 standard deviations), their outcome and site-related "
    "causes. terrain_resolution_m above 20 means the slope features cannot resolve lander-scale hazards.",
    SimilarInput, read_only=True)
async def similar_past_landings(ctx: ToolContext, args: SimilarInput) -> SimilarOutput:
    call = Call(ctx, "similar_past_landings")
    sc, provider = prepare(call, args.scenario_id, args.terrain)
    if not getattr(provider, "models_terrain", False):
        raise ToolError("similar_past_landings needs terrain='stock'")
    past = load_features()
    if not past:
        raise ToolError("no precomputed history features; run `lunarnav history-features` first")
    visible = {m.id: m for m in history.visible_missions()}
    past = {k: v for k, v in past.items() if k in visible}
    cand = await call.run(lambda: site_features(provider, sc.site.lat_deg, sc.site.lon_deg, sc.landing_utc))
    rows = nearest(cand, past, args.top_k)
    for r in rows:
        m = visible[r["mission_id"]]
        r.update(name=m.name, outcome=m.outcome, features=past[m.id]["features"],
                 site_related_causes=[c.summary for c in m.causes if c.site_related], mapped_criteria=_mapped(m))
    res = cand.get("terrain_resolution_m")
    warn = [] if res is not None and res <= 20 else [
        f"terrain resolution {res} m cannot resolve lander-scale slopes or craters at this site"]
    out = SimilarOutput(candidate_features=jsonable(cand), rows=jsonable(rows), warnings=warn,
                        summary=f"closest: {', '.join(r['mission_id'] for r in rows[:3])}")
    return call.finish(out)


def _wilson(k: int, n: int, z: float = 1.96) -> list[float]:
    if n <= 0:
        return [0.0, 1.0]
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(max(0.0, c - h), 4), round(min(1.0, c + h), 4)]


class VehicleInput(BaseModel):
    """Arguments of `launch_vehicle_record`."""

    vehicle_id: str


class VehicleOutput(EngineOutput):
    """A launch vehicle's record."""

    vehicle_id: str
    name: str
    attempts: int | None
    failures: int
    partial: int
    counted_through: str
    failure_rate: float | None
    wilson_95: list[float] | None
    failures_detail: list[dict[str, Any]]
    ROW_LISTS: ClassVar[dict[str, str]] = {"failures_detail": "date", "wilson_95": ""}


def _vehicle(vehicle_id: str) -> Any:
    v = history.visible_vehicle(vehicle_id)
    if v is None:
        raise ToolError(f"unknown launch vehicle {vehicle_id!r}")
    return v


@agent_tool(
    "launch_vehicle_record",
    "A launch vehicle's flight record: attempts, failures and partial failures (with dates, causes and the days "
    "to the next launch), the failure rate counting partial failures, and its 95% Wilson interval, which stays "
    "wide for vehicles with few flights.",
    VehicleInput, read_only=True)
async def launch_vehicle_record(ctx: ToolContext, args: VehicleInput) -> VehicleOutput:
    call = Call(ctx, "launch_vehicle_record")
    v = _vehicle(args.vehicle_id)
    bad = v.failures + v.partial
    n = v.attempts if v.attempts >= 0 else None
    out = VehicleOutput(
        vehicle_id=v.id, name=v.name, attempts=n, failures=v.failures, partial=v.partial,
        counted_through=v.counted_through, failure_rate=None if not n else round(bad / n, 4),
        wilson_95=None if n is None else _wilson(bad, n),
        failures_detail=[f.model_dump(mode="json") for f in v.failures_detail],
        warnings=[] if n is not None else ["attempt count unknown before the blind cutoff; no rate given"],
        summary=f"{v.name}: {bad} failed or partial of {n if n is not None else '?'} attempts")
    return call.finish(out)


class SlipInput(BaseModel):
    """Arguments of `launch_slip_risk`."""

    vehicle_id: str
    landing_utc: str = Field(description="Planned landing time, ISO-8601 UTC.")


class SlipRiskOutput(EngineOutput):
    """Launch slip risk from the vehicle's history."""

    p_failure: float | None
    wilson_95: list[float] | None
    stand_down_days: list[int]
    typical_stand_down_days: list[int] | None
    slip_dates_utc: list[str]
    ROW_LISTS: ClassVar[dict[str, str]] = {"stand_down_days": "", "typical_stand_down_days": "", "wilson_95": "",
                                           "slip_dates_utc": ""}


@agent_tool(
    "launch_slip_risk",
    "Chance that the launch vehicle fails (failure rate counting partial failures, with its 95% Wilson "
    "interval) and how long the vehicle stood down after its past failures. slip_dates_utc are the planned "
    "landing time shifted by each recorded stand-down: pass them to slip_analysis to see whether the site still "
    "works after such a delay.",
    SlipInput, read_only=True)
async def launch_slip_risk(ctx: ToolContext, args: SlipInput) -> SlipRiskOutput:
    call = Call(ctx, "launch_slip_risk")
    v = _vehicle(args.vehicle_id)
    try:
        t0 = datetime.fromisoformat(args.landing_utc.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ToolError(f"landing_utc is not ISO-8601: {args.landing_utc!r}") from exc
    days = sorted(f.stand_down_days for f in v.failures_detail if f.stand_down_days is not None)
    n = v.attempts if v.attempts >= 0 else None
    bad = v.failures + v.partial
    dates = [(t0 + timedelta(days=d)).strftime("%Y-%m-%dT%H:%MZ") for d in sorted(set(days))[:6]]
    out = SlipRiskOutput(
        p_failure=None if not n else round(bad / n, 4), wilson_95=None if n is None else _wilson(bad, n),
        stand_down_days=days, typical_stand_down_days=[days[len(days) // 2], days[-1]] if days else None,
        slip_dates_utc=dates,
        warnings=[] if days else [f"no recorded stand-down durations for {v.name}"],
        summary=f"{v.name}: p_failure {None if not n else round(bad / n, 3)}, {len(days)} recorded stand-down(s)")
    return call.finish(out)


def history_tools() -> list[AgentTool[Any]]:
    """The history and launch record tools."""
    return [historical_landings, mission_lessons, similar_past_landings, launch_vehicle_record, launch_slip_risk]
