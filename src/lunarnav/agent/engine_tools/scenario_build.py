"""Tools: ``catalog_search`` and ``build_scenario`` (the entry point of every analysis)."""

from __future__ import annotations

import json
import math
from typing import Any, ClassVar, Literal

from pydantic import BaseModel, Field

from lunarnav.catalog import load_landers, load_sites, load_stations
from lunarnav.report.limits import horizon_limits
from lunarnav.scenario import (
    SCHEMA_VERSION,
    Constraints,
    Ellipse,
    Limit,
    Scenario,
    SiteSpec,
    Transfer,
    constraints_preset,
    generic_layouts,
    generic_profile,
    merge_constraints,
    network_from_catalog,
    profile_from_catalog,
)
from lunarnav.scenario.models import CONSTRAINT_KEYS, Origin

from .. import fsafe
from ..ids import CONSTRAINTS_ID_RE, constraints_id_of
from ..registry import AgentTool, ToolContext, ToolError, agent_tool
from ..signoff import append_assumption, find_by_key
from ..trace import build_registry
from ..typed_inputs import SetValue, UserRequest, commit_typed, record_set_values, unit_for_path, user_request
from .common import Call, EngineOutput
from .jsonable import jsonable

PRESETS = ("apollo-lighting", "peregrine-lighting", "viper-polar", "power-reserve")
_LIMIT_DEFAULTS: dict[str, tuple[str, str, float]] = {
    "landing_sun_elevation_deg": ("deg", "Sun elevation at landing", 5.0),
    "landing_hours_after_sunrise": ("h", "Hours after sunrise at landing", 12.0),
    "dte_at_landing_deg": ("deg", "Earth clearance above the antenna horizon at landing", 5.0),
    "min_sunlit_hours_after_landing": ("h", "Continuous sunlight after landing", 12.0),
    "max_dark_span_h": ("h", "Longest dark span", 10.0),
    "min_state_of_charge": ("fraction", "Minimum state of charge", 0.1),
    "min_contact_fraction": ("fraction", "Contact fraction", 0.1),
    "max_contact_gap_h": ("h", "Longest contact outage", 6.0),
    "min_link_margin_db": ("dB", "Lowest link margin", 3.0),
    "max_slope_deg": ("deg", "Terrain slope", 3.0),
}


class CatalogSearchInput(BaseModel):
    """Arguments of `catalog_search`."""

    kind: Literal["site", "lander", "station"] = Field(description="Which catalogue to search.")
    query: str = Field(default="", description="Words matched against id, name, mission and operator "
                       "(all words must match). Empty lists everything (up to limit).")
    near_lat_deg: float | None = Field(default=None, ge=-90, le=90, description="Sites only: centre of a radius filter.")
    near_lon_deg: float | None = Field(default=None, ge=-180, le=360)
    radius_km: float | None = Field(default=None, gt=0, le=3500, description="Sites only: radius around the point.")
    site_kind: str | None = Field(default=None, description="Sites only: landed, impact, not_landed, region, planned or poi.")
    limit: int = Field(default=25, ge=1, le=100)
    detail: bool = Field(default=False, description="Landers: include every parameter with its origin "
                         "(published / derived / estimate). Sites: include sources and notes.")


class CatalogSearchOutput(EngineOutput):
    """Catalogue rows."""

    ROW_LISTS: ClassVar[dict[str, str]] = {"rows": "id", "rows.sources": "", "rows.profile.panels": ""}

    n_matches: int
    rows: list[dict[str, Any]]


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlon = math.radians(lon2 - lon1)
    c = math.sin(p1) * math.sin(p2) + math.cos(p1) * math.cos(p2) * math.cos(dlon)
    return 1737.4 * math.acos(max(-1.0, min(1.0, c)))


def _site_row(s: Any, detail: bool, dist: float | None) -> dict[str, Any]:
    row = {"id": s.id, "name": s.name, "kind": s.kind, "lat_deg": s.lat_deg, "lon_deg": s.lon_deg,
           "mission": s.mission, "status": s.status, "landing_utc": s.landing_utc, "landing_date": s.landing_date,
           "planned_date": s.planned_date, "extent_km": s.extent_km, "extent_kind": s.extent_kind,
           "confidence": s.confidence.value if hasattr(s.confidence, "value") else str(s.confidence)}
    if dist is not None:
        row["distance_km"] = dist
    if detail:
        row["notes"] = s.notes
        row["sources"] = [src.model_dump(mode="json") for src in s.sources]
        row["frame_note"] = s.frame_note
    return {k: v for k, v in row.items() if v not in (None, "")}


@agent_tool(
    "catalog_search",
    "Search the sourced catalogues: landing sites (id, name, lat/lon, landing date, confidence), lander "
    "profiles (with detail=true: every parameter and whether it is published, derived or an estimate) and "
    "Earth ground stations. Use ids from here in build_scenario; never type coordinates from memory.",
    CatalogSearchInput, read_only=True)
async def catalog_search(ctx: ToolContext, args: CatalogSearchInput) -> CatalogSearchOutput:
    call = Call(ctx, "catalog_search")
    words = args.query.lower().split()
    rows: list[dict[str, Any]] = []
    if args.kind == "site":
        for s in load_sites():
            hay = " ".join(str(x) for x in (s.id, s.name, s.mission, s.operator, s.country, s.kind)).lower()
            if not all(w in hay for w in words) or (args.site_kind and s.kind != args.site_kind):
                continue
            dist = None
            if args.near_lat_deg is not None and args.near_lon_deg is not None:
                dist = _distance_km(args.near_lat_deg, args.near_lon_deg, s.lat_deg, s.lon_deg)
                if args.radius_km is not None and dist > args.radius_km:
                    continue
            rows.append(_site_row(s, args.detail, dist))
        if args.near_lat_deg is not None:
            rows.sort(key=lambda r: r.get("distance_km", 1e9))
    elif args.kind == "lander":
        for e in load_landers():
            if not all(w in f"{e.id} {e.name} {e.operator}".lower() for w in words):
                continue
            row: dict[str, Any] = {"id": e.id, "name": e.name, "operator": e.operator,
                                   "confidence": e.confidence.value}
            if args.detail:
                prof = profile_from_catalog(e)
                row["profile"] = jsonable(prof)
                row["estimated_fields"] = sorted(prof.estimates())
                row["generic_layouts"] = list(generic_layouts())
            rows.append(row)
    else:
        for st in load_stations():
            if all(w in f"{st.id} {st.name} {st.network}".lower() for w in words):
                rows.append({"id": st.id, "name": st.name, "network": st.network, "lat_deg": st.lat_deg,
                             "lon_deg": st.lon_deg, "min_elevation_deg": st.min_elevation_deg})
    out = CatalogSearchOutput(n_matches=len(rows), rows=jsonable(rows[: args.limit]),
                              summary=f"{len(rows)} {args.kind} match(es)")
    return call.finish(out)


class SiteIn(BaseModel):
    """A custom site (planetocentric ME degrees, east-positive)."""

    lat_deg: float = Field(ge=-90, le=90)
    lon_deg: float = Field(ge=-180, le=360)
    name: str = ""


class LimitIn(BaseModel):
    """A pass/fail limit the user stated."""

    min: float | None = None
    max: float | None = None
    source: str = Field(default="", description="Where it comes from: the user's message, a document "
                        "sentence (quote it) or a requirement id.")


class TransferIn(BaseModel):
    """How launch maps to landing."""

    duration_days: float | None = Field(default=None, gt=0, le=400, description="Fixed transfer duration.")
    table: list[dict[str, str]] | None = Field(
        default=None, description="Launch opportunities: [{launch_utc, landing_utc}, ...] strictly increasing.")


class EllipseIn(BaseModel):
    """Landing dispersion ellipse."""

    semi_major_m: float = Field(gt=0)
    semi_minor_m: float = Field(gt=0)
    azimuth_deg: float = 0.0
    dispersion: Literal["gaussian", "uniform"] = "gaussian"
    sigma_level: float = Field(default=3.0, gt=0)


class BuildScenarioInput(BaseModel):
    """Arguments of `build_scenario`."""

    site: str | SiteIn = Field(description="Catalogue site id (see catalog_search) or a custom point.")
    lander: str = Field(description="Catalogue lander id, or 'generic:<layout>' with layout one of "
                        "top_deck, three_panel, side_panels, tracker (all-estimate template).")
    mission_duration_h: float = Field(gt=0, le=8760, description="Surface mission length after landing, hours.")
    landing_utc: str | None = Field(default=None, description="ISO-8601 UTC; default: the catalogue site's landing time.")
    polar: bool = Field(default=False, description="Use the lander's polar variant (e.g. tracking array) if it has one.")
    layout: str | None = Field(default=None, description="Override the panel layout of a catalogue lander.")
    presets: list[str] = Field(default_factory=list, description=f"Constraint presets: {', '.join(PRESETS)}.")
    limits: dict[str, LimitIn] = Field(
        default_factory=dict, description=f"User-stated limits by key ({', '.join(CONSTRAINT_KEYS)}). "
        "These override presets. The harness marks each as entered by the model in this run, attaches the limit "
        "'scenario.typed' to every answer that cites the scenario and records a pending assumption for it: a "
        "constraint from a document goes through propose_constraints (constraints_id), a named one through presets.")
    constraints_id: str | None = Field(default=None, description="Constraints built from a document (propose_constraints).")
    network: Literal["none", "dsn"] | list[str] = Field(
        default="none", description="'dsn' = Goldstone, Canberra, Madrid 70 m; or a list of station ids; "
        "'none' = geometric direct-to-Earth (Earth centre above the antenna horizon).")
    network_direction: Literal["downlink", "uplink", "two_way"] = "downlink"
    transfer: TransferIn | None = None
    ellipse: EllipseIn | None = None
    patch: dict[str, Any] = Field(
        default_factory=dict, description="RFC 7396 JSON merge patch applied last to the scenario JSON, e.g. "
        "{'profile': {'antenna_height_m': 3.5, 'battery': {'capacity_wh': 800}}, 'eclipse': {'shadow': 'geometric'}}. "
        "Changed lander parameters become user-supplied.")
    heading_deg: float | None = Field(
        default=None, ge=0, lt=360, description="Lander heading (body x, degrees clockwise from north) the PLANNER "
        "stated. Leave unset when none was stated: the lander heading is then unknown, the engine reports the result "
        "over all headings, and you report it as heading-dependent. Setting it records an assumption needing "
        "sign-off; never choose a heading yourself to get a single answer.")
    heading_statement: str = Field(
        default="", max_length=400, description="Required with heading_deg: the planner's words stating the heading "
        "(quote them) or the source document sentence.")
    assumptions: list[str] = Field(default_factory=list, description="Ids of recorded assumptions this scenario relies on.")
    name: str | None = None


class BuildScenarioOutput(EngineOutput):
    ROW_LISTS: ClassVar[dict[str, str]] = {"scenario.network.stations": "", "scenario.profile.panels": ""}

    """The scenario that was built."""

    scenario_id: str
    scenario: dict[str, Any]
    estimated_parameters: dict[str, str]
    estimate_assumption_id: str | None = None
    heading: dict[str, Any] = Field(default_factory=dict)
    heading_assumption_id: str | None = None
    terrain_coverage: dict[str, Any] = Field(default_factory=dict)


def _merge_patch(target: Any, patch: Any) -> Any:
    if not isinstance(patch, dict):
        return patch
    base = dict(target) if isinstance(target, dict) else {}
    for key, value in patch.items():
        if value is None:
            base.pop(key, None)
        else:
            base[key] = _merge_patch(base.get(key), value)
    return base


def _leaf_paths(obj: Any, prefix: str = "") -> dict[str, Any]:
    if isinstance(obj, dict):
        out: dict[str, Any] = {}
        for k, v in obj.items():
            out.update(_leaf_paths(v, f"{prefix}.{k}" if prefix else k))
        return out
    return {prefix: obj}


_ECHO_KEYS = frozenset({"name", "description", "notes", "note", "label", "id", "schema_version", "source_url"})
"""Scenario fields that are text about a value, not a value: they change nothing the engine computes."""


def _changed_leaves(before: dict[str, Any], after: dict[str, Any]) -> list[SetValue]:
    """Every leaf the patch changed (full scenario paths), with the value it replaced. Constraints are handled by
    `_typed_patched_constraints`; origin records and text fields are not values."""
    a, b = _leaf_paths(before), _leaf_paths(after)
    out: list[SetValue] = []
    for path, value in b.items():
        parts = path.split(".")
        if "origin" in parts or "origins" in parts or parts[0] == "constraints" or parts[-1] in _ECHO_KEYS:
            continue
        if a.get(path) != value:
            out.append(SetValue(path, value, a.get(path, "unset"), unit_for_path(path)))
    return out


def _user_origins(values: list[SetValue]) -> dict[str, Origin]:
    """Origins for the lander parameters the patch changed (keys such as ``battery.capacity_wh``): all typed by the model."""
    out: dict[str, Origin] = {}
    for sv in values:
        key = sv.path.split(".")
        if key[0] != "profile":
            continue
        rest = key[1:]
        out[".".join(rest[:2]) if rest[0] in ("battery", "loads", "attitude", "link") else rest[0]] = typed_origin()
    return out


TYPED_ORIGIN = "set by the assistant in this run (not a preset, not a reviewed proposal)"
"""Origin label of every value the model entered (``limits``, ``patch``, ``transfer``, ``ellipse``, a mission length, a
landing time, any terrain-error setting); the other origins are a preset (its source), a proposal (``constraints_id``, limit
``constraints.interpreted``) and a saved scenario (it keeps what it stored). Its basis is ``model-typed``: the harness
never writes basis ``user`` for a value passed through a tool call, even when the request contains the number. The label
is neutral about the request: whether it quotes the value is stated only in the run's assumption line, never here (the engine
copies this label into a verdict's ``origin_label``). ``mission_duration_h`` and ``landing_utc`` have no origin slot in the
scenario; their mark lives in the run's assumption and the limit notes stored beside the scenario."""


def typed_origin(**kw: Any) -> Origin:
    """Origin of a value the model set (always ``model-typed``)."""
    return Origin(basis="model-typed", label=TYPED_ORIGIN, **kw)


def _constraint_value(key: str, lim: Any) -> SetValue:
    """The set-value record of a constraint the model typed (both bounds are one value)."""
    unit = _LIMIT_DEFAULTS[key][0] if key in _LIMIT_DEFAULTS else (lim.get("unit", "") if isinstance(lim, dict) else "")
    bounds = {n: (lim.get(n) if isinstance(lim, dict) else getattr(lim, n, None)) for n in ("min", "max")}
    src = lim.get("source") if isinstance(lim, dict) else getattr(lim, "source", None)
    return SetValue(f"constraints.{key}", {n: v for n, v in bounds.items() if v is not None},
                    "no value" + (f"; the model's source: {src}" if src else ""), unit)


def _typed_patched_constraints(call: Call, patch: dict[str, Any], patched: dict[str, Any], req: UserRequest) -> None:
    """Constraint values typed through ``patch`` are model values too: the same origin, limit and assumption."""
    typed = patch.get("constraints")
    if not isinstance(typed, dict):
        return
    for key, value in typed.items():
        if value is None:
            continue
        slot = patched.get("constraints", {}).get(key)
        record_set_values(call, req, [_constraint_value(key, value)])
        if isinstance(slot, dict):
            slot["origin"] = typed_origin().model_dump(mode="json")


def _constraints_from(args: BuildScenarioInput, state_dir: Any, call: Call, req: UserRequest) -> Constraints:
    sets: list[Constraints] = []
    for name in args.presets:
        if name not in PRESETS:
            raise ToolError(f"unknown preset {name!r}; choose from {PRESETS}")
        sets.append(constraints_preset(name))
    if args.constraints_id:
        if not CONSTRAINTS_ID_RE.match(args.constraints_id):
            raise ToolError(f"{args.constraints_id!r} is not a constraints id (use the constraints_id from propose_constraints)")
        path = state_dir / f"{args.constraints_id}.json"
        if not fsafe.exists(path):
            raise ToolError(f"unknown constraints id {args.constraints_id!r}")
        doc = json.loads(fsafe.read_text(path))
        if constraints_id_of(doc["constraints"]) != args.constraints_id:
            raise ToolError(f"stored constraints {args.constraints_id} do not match their content hash and are refused")
        call.depend(doc.get("depends_on", []))
        call.add_limits("constraints.interpreted")
        sets.append(Constraints.model_validate(doc["constraints"]))
    if args.limits:
        user: dict[str, Limit] = {}
        for key, lim in args.limits.items():
            if key not in _LIMIT_DEFAULTS:
                raise ToolError(f"unknown constraint key {key!r}; choose from {list(CONSTRAINT_KEYS)}")
            unit, label, scale = _LIMIT_DEFAULTS[key]
            try:
                user[key] = Limit(min=lim.min, max=lim.max, unit=unit, label=label, margin_scale=scale,
                                  origin=typed_origin(note=lim.source))
                record_set_values(call, req, [_constraint_value(key, lim)])
            except ValueError as exc:
                raise ToolError(f"limit {key}: {exc}") from exc
        sets.append(Constraints(**user))
    return merge_constraints(*sets) if sets else Constraints()


def _estimate_assumption(call: Call, scenario: Scenario) -> str | None:
    """Record (once per parameter set) that the lander profile contains estimates, and return its id."""
    est = scenario.profile.estimates()
    if not est:
        return None
    prof = scenario.profile.model_dump(mode="json")
    values = {k: _value_at(prof, k) for k in sorted(est)}
    key = "profile-estimates:" + json.dumps({"id": scenario.profile.id, "values": values}, sort_keys=True, default=str)
    existing = find_by_key(call.ctx.paths, key)
    if existing is not None:
        return existing["assumption_id"]
    listing = "; ".join(f"{k} = {json.dumps(values[k], default=str)[:90]} ({est[k].basis}: {est[k].label})"
                        for k in sorted(est))
    stored = append_assumption(
        call.ctx.paths, key=key,
        statement=f"Lander profile '{scenario.profile.name}' uses non-published parameter values: {listing}.",
        basis="Catalogue/generic template flags: these values are estimates or derived, not mission-confirmed "
              "(docs/validation/scenario.md section 6).",
        impact="Power, state of charge and dark-survival results scale with these values; replace them with "
               "mission values (build_scenario patch) and recompute.", needs_signoff=True)
    from ..events import AssumptionRecorded

    call.ctx.emit(AssumptionRecorded, assumption_id=stored["assumption_id"], statement=stored["statement"],
                  basis=stored["basis"], impact=stored["impact"], needs_signoff=True)
    return stored["assumption_id"]


def _heading_assumption(call: Call, yaw_deg: float, statement: str) -> str:
    """Record (once per heading and statement) that a stated lander heading replaces the unknown-heading analysis."""
    key = "heading:" + json.dumps({"yaw_deg": yaw_deg, "statement": statement}, sort_keys=True)
    existing = find_by_key(call.ctx.paths, key)
    if existing is not None:
        return existing["assumption_id"]
    stored = append_assumption(
        call.ctx.paths, key=key,
        statement=f"The lander heading is {yaw_deg:g} deg clockwise from north, as stated: {statement}",
        basis="A lander has no heading before it lands; the engine otherwise evaluates every heading "
              "(docs/validation/scenario.md sections 6 and 6.1). This heading comes from the request, not from the engine.",
        impact="State of charge and the verdict are evaluated at this heading only; other headings may fail. Re-run "
               "without a stated heading to see the headings that pass.", needs_signoff=True)
    from ..events import AssumptionRecorded

    call.ctx.emit(AssumptionRecorded, assumption_id=stored["assumption_id"], statement=stored["statement"],
                  basis=stored["basis"], impact=stored["impact"], needs_signoff=True)
    return stored["assumption_id"]


def heading_brief(scenario: Scenario) -> dict[str, Any]:
    """The scenario's heading state: unknown (the analysis covers all headings) or stated, with its origin."""
    att, origin = scenario.profile.attitude, scenario.profile.origins.get("attitude.yaw_deg")
    basis = None if origin is None else origin.basis
    if not att.heading_known:
        return {"known": False, "basis": basis or "unknown",
                "note": "no nominal heading: results are ranges over headings and the headings that pass"}
    return {"known": True, "yaw_deg": att.yaw_deg, "yaw_uncertainty_deg": att.yaw_uncertainty_deg, "basis": basis}


def _value_at(doc: dict[str, Any], path: str) -> Any:
    cur: Any = doc
    for part in path.split("."):
        cur = cur.get(part) if isinstance(cur, dict) else None
    return cur


def terrain_coverage(provider: Any, scenario: Scenario) -> dict[str, Any]:
    """Which terrain product covers the site (finest store with valid data) and at what pixel size."""
    if not getattr(provider, "models_terrain", False):
        return {"terrain": "none (smooth sphere)"}
    stack = provider.stack
    lon = scenario.site.lon_deg if scenario.site.lon_deg <= 180 else scenario.site.lon_deg - 360
    store = stack.select(scenario.site.lat_deg, lon, 0.0)
    if store is None:
        return {"terrain": "no store covers this point", "dem_id": None}
    return {"dem_id": store.dem_id, "pixel_size_m": store.pixel_size_m, "stack_hash": stack.stack_hash}


def _decimals(value: float) -> int:
    """Decimal places of the shortest text that reads back as ``value`` (at most 10)."""
    text = repr(float(value))
    return min(len(text.split(".")[1]), 10) if "." in text and "e" not in text else 0


def _site_is_traced(ctx: ToolContext, site: SiteIn) -> bool:
    """Whether both coordinates of a custom site are stated, to their own precision, by an engine or catalogue result of this
    run (a search row, a sensitivity point) as the latitude and longitude of ONE row or site object: the latitude of one row
    with the longitude of another is a position no record states. Only a result's own values count: a pair the model passed
    to a tool and the tool echoed back (the record has the pair among its inputs too), a script's report and the request do
    not, so a position the model typed stays model-typed. One coordinate alone may equal an input (a point due north of the
    centre keeps its longitude)."""
    reg = build_registry(ctx.paths)
    tol = tuple(0.5 * 10.0 ** -_decimals(v) * 1.0001 for v in (site.lat_deg, site.lon_deg))

    def states(positions: list[tuple[float, float]]) -> bool:
        return any(abs(la - site.lat_deg) <= tol[0] and abs(lo - site.lon_deg) <= tol[1] for la, lo in positions)

    for s in reg.sources.values():
        if s.origin != "tool":
            continue
        in_result = any(p.kind == "engine_result" and states(p.positions) for p in s.parts)
        echoed = any(p.kind == "input" and states(p.positions) for p in s.parts)
        if in_result and not echoed:
            return True
    return False


@agent_tool(
    "build_scenario",
    "Build and validate a planning scenario (site + lander + mission + constraints + network + optional "
    "transfer/ellipse) and store it; returns scenario_id for every analysis tool. Catalogue values keep their "
    "origin flags; anything you change via patch/limits becomes user-supplied. If the lander profile contains "
    "estimates, an assumption needing sign-off is recorded automatically and returned. The lander heading is "
    "unknown unless the planner stated one (heading_deg + heading_statement, which records an assumption).",
    BuildScenarioInput, read_only=False)
async def build_scenario(ctx: ToolContext, args: BuildScenarioInput) -> BuildScenarioOutput:
    call = Call(ctx, "build_scenario", assumptions=args.assumptions)
    cdir = ctx.paths.constraints
    sites = {s.id: s for s in load_sites()}
    if isinstance(args.site, str):
        if args.site not in sites:
            near = [i for i in sites if args.site.lower() in i][:8]
            raise ToolError(f"unknown site id {args.site!r}; use catalog_search. Similar: {near}")
        entry = sites[args.site]
        site = SiteSpec(lat_deg=entry.lat_deg, lon_deg=entry.lon_deg, name=entry.name, catalog_id=entry.id)
        landing = args.landing_utc or entry.landing_utc
    else:
        site = SiteSpec(lat_deg=args.site.lat_deg, lon_deg=args.site.lon_deg, name=args.site.name or "custom site")
        landing = args.landing_utc
    if landing is None:
        raise ToolError("no landing time: the catalogue site has none; pass landing_utc")
    if args.lander.startswith("generic:"):
        layout = args.lander.split(":", 1)[1]
        try:
            profile = generic_profile(layout)
        except ValueError as exc:
            raise ToolError(str(exc)) from exc
    else:
        try:
            profile = profile_from_catalog(args.lander, polar=args.polar, layout=args.layout)
        except KeyError as exc:
            raise ToolError(f"unknown lander {args.lander!r}; use catalog_search kind=lander") from exc
    if args.network == "none":
        from lunarnav.scenario import Network

        network = Network()
    else:
        ids = ("dss-14", "dss-43", "dss-63") if args.network == "dsn" else tuple(args.network)
        try:
            network = network_from_catalog(ids, direction=args.network_direction)
        except KeyError as exc:
            raise ToolError(f"unknown station {exc}; use catalog_search kind=station") from exc
    req = user_request(ctx.paths)
    own: list[SetValue] = [SetValue("mission_duration_h", args.mission_duration_h, "no default (required)", "h")]
    if isinstance(args.site, SiteIn) and not _site_is_traced(ctx, args.site):
        own.append(SetValue("site", {"lat_deg": args.site.lat_deg, "lon_deg": args.site.lon_deg},
                            "none (not a catalogue site, and not a position a record of this run states)", "deg"))
    if args.landing_utc and isinstance(args.site, str) and args.landing_utc != sites[args.site].landing_utc:
        own.append(SetValue("landing_utc", args.landing_utc, sites[args.site].landing_utc or "none"))
    elif args.landing_utc and not isinstance(args.site, str):
        own.append(SetValue("landing_utc", args.landing_utc, "none (custom site)"))
    transfer = None
    if args.transfer is not None:
        t = args.transfer
        if (t.duration_days is None) == (t.table is None):
            raise ToolError("transfer needs exactly one of duration_days or table")
        own.append(SetValue("transfer.duration_days", t.duration_days, "none", "d") if t.duration_days else
                   SetValue("transfer.table", t.table, "none"))
    if args.ellipse is not None:
        own += [SetValue(f"ellipse.{k}", v, "none", unit_for_path(k)) for k, v in args.ellipse.model_dump().items()
                if v != EllipseIn.model_fields[k].default or k in ("semi_major_m", "semi_minor_m")]
    record_set_values(call, req, own)
    if args.transfer is not None:
        t = args.transfer
        t_origin = typed_origin()
        transfer = Transfer(kind="fixed", duration_days=t.duration_days, origin=t_origin) if t.duration_days else Transfer(
            kind="table", table=tuple(t.table or ()), origin=t_origin)
    e_origin = typed_origin()
    base = Scenario(
        name=args.name or f"{site.name} / {args.lander}", site=site, landing_utc=landing,
        mission_duration_h=args.mission_duration_h, profile=profile,
        constraints=_constraints_from(args, cdir, call, req), network=network, transfer=transfer,
        ellipse=Ellipse(**args.ellipse.model_dump(), origin=e_origin) if args.ellipse else None)
    doc = base.model_dump(mode="json")
    attitude_patch = (args.patch.get("profile") or {}).get("attitude") if isinstance(args.patch.get("profile"), dict) else None
    if isinstance(attitude_patch, dict) and ("yaw_deg" in attitude_patch or "yaw_uncertainty_deg" in attitude_patch):
        raise ToolError("do not set the lander heading through patch: use heading_deg with heading_statement "
                        "(the planner's words); it is recorded as an assumption needing sign-off")
    if args.heading_deg is not None:
        if len(args.heading_statement.strip()) < 3:
            raise ToolError("heading_deg needs heading_statement: quote where the planner stated the heading")
        doc["profile"].setdefault("attitude", {})["yaw_deg"] = args.heading_deg
        doc["profile"].setdefault("origins", {})["attitude.yaw_deg"] = Origin(
            basis="model-typed", label="heading entered by the model; the words are the model's quotation of the request",
            note=args.heading_statement.strip()[:200]).model_dump(mode="json")
    elif args.heading_statement:
        raise ToolError("heading_statement without heading_deg: leave both unset when no heading was stated")
    if args.patch:
        patched = _merge_patch(doc, args.patch)
        _typed_patched_constraints(call, args.patch, patched, req)
        changed = _changed_leaves(doc, patched)
        record_set_values(call, req, changed)
        patched.setdefault("profile", {}).setdefault("origins", {})
        for k, origin in _user_origins(changed).items():
            patched["profile"]["origins"][k] = origin.model_dump(mode="json")
        if any(sv.path.startswith("terrain_error.") for sv in changed):
            patched["terrain_error"]["origin"] = typed_origin().model_dump(mode="json")
        doc = patched
    try:
        scenario = Scenario.model_validate(doc)
    except ValueError as exc:
        raise ToolError(f"invalid scenario: {str(exc)[:1500]}") from exc

    def work() -> tuple[str | None, str | None, dict[str, Any]]:
        aid = _estimate_assumption(call, scenario)
        hid = _heading_assumption(call, scenario.profile.attitude.yaw_deg, args.heading_statement.strip())             if args.heading_deg is not None else None
        return aid, hid, terrain_coverage(call.provider("stock"), scenario) if _stock_available() else {}

    aid, hid, coverage = await call.run(work)
    call.depend(r for r in (aid, hid) if r)
    commit_typed(call, "build_scenario")
    sid = call.save_scenario(scenario, "build_scenario")
    if coverage.get("pixel_size_m", 0):
        call.add_notes(horizon_limits(scenario.site.lat_deg, models_terrain=True, pixel_m=coverage["pixel_size_m"],
                                      dem_id=coverage.get("dem_id", ""), k_sigma=scenario.terrain_error.k_sigma))
    out = BuildScenarioOutput(
        scenario_id=sid, scenario=_brief(scenario), estimate_assumption_id=aid, terrain_coverage=coverage,
        heading=heading_brief(scenario), heading_assumption_id=hid,
        estimated_parameters={k: f"{o.basis}: {o.label}" for k, o in scenario.profile.estimates().items()},
        summary=f"scenario {sid}: landing {scenario.landing_utc}, {scenario.mission_duration_h:g} h, "
                f"constraints {list(scenario.constraints.active())}, schema {SCHEMA_VERSION}, "
                f"heading {'stated' if scenario.profile.attitude.heading_known else 'unknown'}")
    return call.finish(out)


_DROP = frozenset({"origin", "origins", "description", "schema_version", "source_url", "notes", "label"})


def _prune(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _prune(v) for k, v in obj.items() if k not in _DROP and v is not None and v != {} and v != []}
    if isinstance(obj, list):
        return [_prune(v) for v in obj]
    return obj


def _brief(scenario: Scenario) -> dict[str, Any]:
    """The scenario without provenance text and unset fields (the full JSON is in the workspace)."""
    doc = jsonable(scenario)
    cons = doc.get("constraints", {})
    doc["constraints"] = {k: _constraint_brief(k, v, scenario) for k, v in cons.items() if v is not None}
    return _prune(doc)


def _constraint_brief(key: str, value: Any, scenario: Scenario) -> Any:
    if isinstance(value, dict) and "min" in value or isinstance(value, dict) and "max" in value:
        origin = getattr(getattr(scenario.constraints, key, None), "origin", None)
        return {**{k: v for k, v in value.items() if k in ("min", "max", "unit", "margin_scale")},
                "basis": getattr(origin, "basis", None)}
    return value


def _stock_available() -> bool:
    from lunarnav.terrain.paths import store_dir

    return any(store_dir().glob("*/meta.json"))


def catalog_tools() -> list[AgentTool[Any]]:
    """The catalogue and scenario-building tools."""
    return [catalog_search, build_scenario]
