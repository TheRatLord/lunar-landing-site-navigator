"""Scenario analyses for the API: job entry points and the JSON shaping of the engine's results.

Every entry point has the job signature ``fn(request: dict, ctx: JobContext) -> dict`` and runs in a pool
worker (own SPICE state). The request is self-contained: the normalised scenario document(s), the resolved
terrain mode (``"on"`` / ``"off"``) and the analysis parameters, so that its hash is a sound cache key.

Time conventions in the results: ISO-8601 UTC strings (`*_utc`), ET seconds (`et`, TDB past J2000) and
UTC epoch milliseconds (`t_ms`) for series.
"""

from __future__ import annotations

import dataclasses
import math
import os
from collections import OrderedDict
from collections.abc import Callable, Sequence
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np
from pydantic import ValidationError

from lunarnav.api.compute.ephem import RequestError
from lunarnav.api.jobworker import JobContext, worker_data_dir
from lunarnav.api.limits import MAX_SHIFT_M
from lunarnav.api.versions import terrain_signature
from lunarnav.catalog import load_sites
from lunarnav.ephem import EARTH_MEAN_RADIUS_KM, et_to_utc
from lunarnav.report.limits import (
    applicable_limits,
    attribution_limits,
    compare_limits,
    horizon_limits,
    rank_limits,
    scan_limits,
    sensitivity_limits,
    slip_limits,
)
from lunarnav.scenario import (
    EVENT_KINDS,
    SearchRegion,
    SiteEvaluation,
    SmoothSphereProvider,
    TerrainProvider,
    attribute_event,
    compare_scenarios,
    describe_constraint,
    ellipse_statistics,
    evaluate_scenario,
    height_sensitivity,
    minmax_indices,
    position_sensitivity,
    rank_sites,
    scan_opportunities,
    search_sites,
    slip_analysis,
)
from lunarnav.scenario.engine import FAIL, MARGINAL, PASS, STATE_NAMES, margin_note
from lunarnav.scenario.export import DECIMATION_SERIES
from lunarnav.scenario.horizons import fold_observers
from lunarnav.scenario.models import Scenario, SiteSpec, TerrainErrorSettings
from lunarnav.scenario.provenance import scenario_hash, site_terrain, terrain_stack_record
from lunarnav.scenario.signals import prepare_horizon
from lunarnav.types import Site

STATES = {STATE_NAMES[s]: int(s) for s in (FAIL, MARGINAL, PASS)}
"""Integer codes of the verdict states used in scan arrays (calendar cells also use -1 for no candidate)."""


def data_dir() -> Path:
    """Service data directory (given to the pool worker; the environment or project default otherwise)."""
    given = worker_data_dir() or os.environ.get("LUNARNAV_DATA")
    if given:
        return Path(given)
    from lunarnav.terrain.paths import data_root

    return data_root()


MAX_STACKS_PER_WORKER = 4
"""Distinct terrain stacks (and so horizon caches) a worker keeps. The stores are memory-mapped, so what a stack costs is
the provider's in-memory horizon cache; the least recently used provider is dropped beyond this."""

_providers: OrderedDict[tuple, Any] = OrderedDict()


def get_provider(mode: str, n_az: int = 720, stores: Sequence[str] | None = None) -> Any:
    """Horizon provider of a resolved terrain mode; terrain providers (and their horizon caches) are kept by terrain
    stack (`stores`: the scenario's `terrain_stores`, null for the default stack), at most `MAX_STACKS_PER_WORKER`, and
    dropped when the set of stores on disk changes. The order of `stores` is irrelevant: `TerrainStack` applies the
    engine's precedence rule."""
    if mode == "off":
        if stores is not None:
            raise RequestError("`terrain_stores` chooses a terrain stack but terrain is off for this request")
        return SmoothSphereProvider(n_az)
    root = data_dir()
    sig = terrain_signature(root)
    if not sig:
        raise RequestError(f"no terrain stores under {root / 'dem' / 'store'}; use terrain=off")
    ids = None if stores is None else tuple(sorted(stores))
    key = (str(root), sig, n_az, ids)
    if key in _providers:
        _providers.move_to_end(key)
        return _providers[key]
    from lunarnav.terrain import TerrainStack

    for old in [k for k in _providers if k[:2] != key[:2]]:
        del _providers[old]
    try:
        stack = TerrainStack.open(dem_ids=ids, root=root / "dem" / "store")
    except (OSError, KeyError, ValueError) as exc:
        raise RequestError(f"terrain stores {list(ids or ())} cannot be opened: {exc}") from exc
    _providers[key] = TerrainProvider(stack, n_az=n_az)
    while len(_providers) > MAX_STACKS_PER_WORKER:
        _providers.popitem(last=False)
    return _providers[key]


def _guard(fn: Callable[[], Any]) -> Any:
    """Engine `ValueError` / `ValidationError` mean the request cannot be served: report them as such."""
    try:
        return fn()
    except RequestError:
        raise
    except ValidationError as exc:
        raise RequestError(f"invalid scenario: {exc.errors()[0]['msg']}") from exc
    except ValueError as exc:
        raise RequestError(str(exc)) from exc


def run_ellipse(params: dict[str, Any], scenario: Any, provider: Any, progress: Callable[[float, str], None] | None = None) -> Any:
    """`ellipse_statistics` for the scenario's landing ellipse with the request's parameters."""
    if scenario.ellipse is None:
        raise RequestError("the scenario has no landing ellipse; set `ellipse` on it")
    return _guard(lambda: ellipse_statistics(
        scenario, provider, n_samples=params["n_samples"], seed=params["seed"], truncate=params["truncate"],
        hazard_slope_deg=params.get("hazard_slope_deg"), hazard_roughness_m=params.get("hazard_roughness_m"),
        map_cells=params.get("map_cells"), convergence_tolerance=params["convergence_tolerance"], progress=progress))


def run_search(params: dict[str, Any], scenario: Any, provider: Any, progress: Callable[[float, str], None] | None = None) -> Any:
    """`search_sites` over the request's region with its parameters."""
    r = params["region"]
    poly = None if r.get("polygon") is None else tuple((float(a), float(b)) for a, b in r["polygon"])
    region = SearchRegion(r["lat_deg"], r["lon_deg"], r.get("radius_m") or 0.0, poly)
    return _guard(lambda: search_sites(
        scenario, provider, region, final_spacing_m=params["final_spacing_m"], first_utc=params.get("first_utc"),
        last_utc=params.get("last_utc"), epoch_spacing_h=params.get("epoch_spacing_h"), coarse_factor=params["coarse_factor"],
        slack=params["slack"], min_promote=params["min_promote"], max_promoted=params["max_promoted"], top_k=params["top_k"],
        min_separation_m=params.get("min_separation_m"), exhaustive=params["exhaustive"], prune_world=params["prune_world"],
        hazard_roughness_m=params.get("hazard_roughness_m"), progress=progress, rank_by=params.get("rank_by", "margin")))


def coverage_utc() -> tuple[str, str]:
    """UTC range the pinned kernels cover (the `valid_utc` of `GET /meta`)."""
    from lunarnav.ephem.kernels import load_kernels

    lo, hi = load_kernels().valid_et
    return et_to_utc(lo, 0), et_to_utc(hi, 0)


def check_in_coverage(**instants: str | None) -> None:
    """Refuse a request instant outside the kernels' coverage, naming the field and the covered UTC range."""
    lo_utc, hi_utc = coverage_utc()
    for name, utc in instants.items():
        if utc is not None and not (lo_utc <= utc[:19] + "Z" <= hi_utc):
            raise RequestError(f"`{name}` {utc} is outside the ephemeris coverage {lo_utc} to {hi_utc}; choose an instant inside it")


def _scenario(req: dict[str, Any], key: str = "scenario") -> Scenario:
    return _guard(lambda: Scenario.model_validate(req[key]))


def _utc(et: float | None) -> str | None:
    if et is None or not math.isfinite(et):
        return None
    return et_to_utc(float(et), 3)


def _utc_array(et: np.ndarray) -> list[str | None]:
    """ISO strings of an ET array; NaN/inf (the engine's "no such instant") become None."""
    arr = np.asarray(et, dtype=np.float64)
    out: list[str | None] = [None] * arr.size
    finite = np.flatnonzero(np.isfinite(arr))
    if finite.size:
        for i, s in zip(finite, et_to_utc(arr[finite], 3), strict=True):
            out[int(i)] = str(s)
    return out


def utc_ms(utc: list[str | None]) -> list[int | None]:
    """UTC epoch milliseconds of ISO strings (a leap second 23:59:60 counts as 23:59:59.999); None stays None."""
    out: list[int | None] = []
    for s in utc:
        if s is None:
            out.append(None)
            continue
        text = s.rstrip("Z")
        try:
            out.append(int(np.datetime64(text, "ms").astype(np.int64)))
        except ValueError:
            out.append(int(np.datetime64(text.replace(":60", ":59"), "ms").astype(np.int64)) + 999)
    return out


def _fin(x: Any) -> float | None:
    return float(x) if x is not None and math.isfinite(x) else None


def _warnings(req: dict[str, Any], *provenances: dict[str, Any]) -> list[str]:
    out = list(req.get("warnings", []))
    for prov in provenances:
        for name, rep in (prov.get("horizons") or {}).items():
            n = rep.get("n_nodata_azimuths", 0)
            if n:
                out.append(
                    f"{name} horizon: {n} azimuth(s) have no terrain data; the smooth-sphere horizon dip is used there")
    return out


def _nodata_warning(n: int) -> list[str]:
    """Warning for a raw horizon whose azimuths have no terrain data (null in `elev_deg`)."""
    if not n:
        return []
    return [f"{n} azimuth(s) have no terrain data and are null in `elev_deg`; a scenario analysis (and `apply_error_model`) "
            "uses the smooth-sphere horizon dip at those azimuths"]


def limit_notes(notes: Any) -> list[dict[str, Any]]:
    """`lunarnav.report.limits` notes as response objects. The texts live only there (they are selected from the
    evaluation's own facts and checked against `docs/validation`); the service copies none of them."""
    return [{"id": n.id, "title": n.title, "kind": n.kind, "category": n.category, "text": n.text, "parameters": dict(n.parameters),
             "source": n.source, "quote": n.quote, "more": list(n.more)} for n in notes]


def _envelope(kind: str, req: dict[str, Any], provider_name: str, provenance: dict[str, Any], **body: Any) -> dict[str, Any]:
    return {
        "kind": kind,
        "scenario_sha256": provenance.get("scenario_sha256"),
        "provider": provider_name,
        "warnings": _warnings(req, provenance),
        "terrain_stack": provenance.get("terrain_stack"),
        "scenario": req.get("scenario"),
        **body,
        "provenance": provenance,
    }


def _interval(r: Any) -> dict[str, Any]:
    return {
        "start_utc": _utc(r.start_et), "end_utc": _utc(r.end_et), "duration_h": _fin(r.duration_s / 3600.0),
        "start_range_utc": [_utc(r.start_range[0]), _utc(r.start_range[1])],
        "end_range_utc": [_utc(r.end_range[0]), _utc(r.end_range[1])],
        "start_censored": bool(r.start_censored), "end_censored": bool(r.end_censored),
        "start_range_censored": bool(r.start_range_censored), "end_range_censored": bool(r.end_range_censored),
        "nominal": bool(r.nominal), "certain": bool(r.certain),
        "start_worlds": None if r.start_worlds is None else list(r.start_worlds),
        "end_worlds": None if r.end_worlds is None else list(r.end_worlds),
    }


def _next_event(ev: SiteEvaluation, kind: str, from_utc: str | None) -> dict[str, Any] | None:
    n = _guard(lambda: ev.next_event(kind, from_utc))
    if n is None or not math.isfinite(n.et):
        return None
    return {"kind": n.kind, "utc": _utc(n.et), "et": n.et, "hours": _fin(n.hours),
            "range_utc": [_utc(n.range_et[0]), _utc(n.range_et[1])],
            "missing_worlds": list(n.missing_worlds), "one_sided": n.one_sided, "cause": n.cause, "name": n.name}


def _horizon_dict(h: Any) -> dict[str, Any]:
    return {
        "height_m": h.site.mast_height_m, "ground_height_m": h.ground_height_m, "az_deg": h.az_deg,
        "elev_deg": h.elev_deg, "elev_lo_deg": h.elev_lo_deg, "elev_hi_deg": h.elev_hi_deg,
        "blocker_dist_m": h.blocker_dist_m,
    }


def _series(ev: SiteEvaluation, max_points: int, window: str) -> tuple[dict[str, Any], dict[str, Any]]:
    ts = ev.time_series()
    sig = ev.signals
    ts["sun_ang_radius_deg"] = sig.sun_ang_radius_deg
    ts["earth_ang_radius_deg"] = np.degrees(np.arcsin(EARTH_MEAN_RADIUS_KM / sig.earth_range_km))
    for name in sig.station_az_deg:
        ts[f"station_az_deg:{name}"] = sig.station_az_deg[name]
        ts[f"station_dir_el_deg:{name}"] = sig.station_dir_el_deg[name]
    t = ts["et"]
    if window == "mission":
        idx = np.flatnonzero((t >= ev.t_land_et) & (t <= ev.t_land_et + ev.mission_s))
    else:
        idx = np.arange(t.size)
    n_window = int(idx.size)
    if idx.size > max_points:
        idx = idx[minmax_indices({k: ts[k][idx] for k in DECIMATION_SERIES if k in ts}, max_points)]
    utc = _utc_array(t[idx])
    series: dict[str, Any] = {"et": t[idx], "utc": utc, "t_ms": utc_ms(utc)}
    series.update({k: v[idx] for k, v in ts.items() if k != "et"})
    meta = {"window": window, "n_window": n_window, "n_returned": int(idx.size), "max_points": max_points,
            "decimated": bool(idx.size < n_window),
            "decimation": "min and max of each plotted quantity in every bucket are kept, plus first and last samples"}
    return series, meta


def evaluation_body(ev: SiteEvaluation, req: dict[str, Any], provider: Any = None) -> dict[str, Any]:
    """The `evaluate` result for an evaluation; `provider` is the one that produced it (blocker coordinates)."""
    series, meta = _series(ev, int(req.get("max_points", 2000)), req.get("window", "mission"))
    from_utc = req.get("from_utc")
    verdict = ev.verdict
    body = _envelope(
        "evaluate", req, ev.provider_name, ev.provenance,
        landing={"utc": _utc(ev.t_land_et), "et": ev.t_land_et, "mission_end_utc": _utc(ev.t_land_et + ev.mission_s),
                 "mission_h": ev.mission_s / 3600.0},
        verdict=verdict.to_dict(),
        explanations=[{"key": c.key, "text": describe_constraint(c)} for c in verdict.constraints
                      if describe_constraint(c)],
        metrics=[dataclasses.asdict(m) for m in ev.metrics],
        intervals={k: [_interval(r) for r in rows] for k, rows in ev.intervals.items()},
        next_events_from_utc=from_utc or _utc(ev.t_land_et),
        next_events={k: _next_event(ev, k, from_utc) for k in EVENT_KINDS},
        slope_deg=_fin(ev.slope_deg),
        horizons={"array": _horizon_dict(ev.signals.array_horizon), "antenna": _horizon_dict(ev.signals.antenna_horizon)},
        series_meta=meta,
        series=series,
        heading=None if ev.heading is None else ev.heading.to_dict(),
        bounds=[c.to_dict() for c in _guard(lambda: ev.bound_attribution(provider)).constraints] if req.get("with_bounds", True) else None,
        limits=limit_notes(applicable_limits(ev)),
    )
    body["provenance"] = {**body["provenance"], "no_nominal_series": list(ev.no_nominal_series),
                          "series_notes": ev.series_notes}
    body["warnings"] += [w for w in ev.warnings if w not in body["warnings"]]
    return body


def evaluate_job(req: dict[str, Any], ctx: JobContext) -> dict[str, Any]:
    scenario = _scenario(req)
    check_in_coverage(from_utc=req.get("from_utc"))
    ctx.progress(0.05, "loading terrain")
    provider = get_provider(req["terrain"], stores=scenario.terrain_stores)
    ctx.progress(0.15, "evaluating")
    ev = _guard(lambda: evaluate_scenario(scenario, provider))
    ctx.progress(0.9, "preparing result")
    return evaluation_body(ev, req, provider)


def _scaled(ctx: JobContext, lo: float, hi: float) -> Callable[[float, str], None]:
    """The engine's `progress(fraction, stage)` mapped onto [lo, hi] of the job; it raises `JobCancelled` on a cancel."""
    return lambda fraction, stage: ctx.progress(lo + (hi - lo) * min(max(fraction, 0.0), 1.0), stage)


def _margin_scales(scan: Any) -> dict[str, Any]:
    """Unit and `margin_scale` of every applied constraint: physical margin = normalised margin x scale."""
    return {k: lim for k, lim in scan.context.scenario.constraints.active().items()}


def _scan_arrays(scan: Any, max_points: int) -> dict[str, Any]:
    keys = scan.verdicts.keys
    limits = _margin_scales(scan)
    margin = np.where(np.isfinite(scan.verdicts.worst_margin), scan.verdicts.worst_margin, np.nan)
    n = scan.et.size
    idx = np.arange(n)
    if n > max_points:
        ranked = {} if scan.rank_by == "margin" else {"rank": scan.totals[scan.rank_by]}
        keep = set(minmax_indices({"m": margin, "sun_el": scan.sun_el_deg, **ranked}, max_points // 2).tolist())
        change = np.flatnonzero(np.diff(scan.state) != 0)
        keep.update(change.tolist())
        keep.update((change + 1).tolist())
        idx = np.array(sorted(keep), dtype=np.int64)
    utc = _utc_array(scan.et[idx])
    limiting = scan.verdicts.limiting[idx]
    kinds = scan.margin_kinds()
    scale = np.array([limits[k].margin_scale for k in keys] + [np.nan])
    physical = margin[idx] * scale[limiting]
    return {
        "n_candidates": int(n), "n_returned": int(idx.size), "decimated": bool(idx.size < n),
        "et": scan.et[idx], "utc": utc, "t_ms": utc_ms(utc), "state": scan.state[idx],
        "worst_margin": margin[idx], "worst_margin_physical": physical,
        "margin_unit": [limits[keys[i]].unit if i >= 0 else None for i in limiting],
        "margin_kind": [kinds[i] for i in idx], "margin_note": [margin_note(kinds[i]) for i in idx],
        "margin_scales": {k: {"unit": limits[k].unit, "margin_scale": limits[k].margin_scale} for k in keys},
        "limiting": [keys[i] if i >= 0 else None for i in limiting],
        "local_solar_time_h": scan.local_solar_time_h[idx], "sun_el_deg": scan.sun_el_deg[idx],
        "values": {k: scan.values.values[k][0][idx] for k in keys},
        "values_optimistic": {k: scan.values.values[k][1][idx] for k in keys},
        "values_pessimistic": {k: scan.values.values[k][2][idx] for k in keys},
        "totals": {k: v[idx] for k, v in scan.totals.items()},
    }


def _calendar(cal: Any) -> dict[str, Any]:
    return {
        "bin_h": cal.bin_h, "keys": list(cal.keys),
        "lunations": [{"number": lu.number, "start_utc": _utc(lu.start_et), "end_utc": _utc(lu.end_et)}
                      for lu in cal.lunations],
        "state": cal.state, "open_fraction": cal.open_fraction, "limiting": cal.limiting,
        "local_solar_time_h": cal.local_solar_time_h, "sun_el_deg": cal.sun_el_deg,
        "legend": "rows = lunations, columns = bin_h-hour bins after new moon; state: -1 no candidate, else the best verdict state of the cell (see `states`); limiting: index "
                  "into `keys` of the most common closing constraint among failing candidates, -1 if none fail",
    }


def _window(w: Any, limits: dict[str, Any]) -> dict[str, Any]:
    lim = limits.get(w.best_limiting) if w.best_limiting else None
    margin = _fin(float(w.best_margin))
    return {
        "start_utc": _utc(w.start_et), "end_utc": _utc(w.end_et), "n_candidates": int(w.n_candidates),
        "n_pass": int(w.n_pass), "duration_h": float(w.duration_h), "best_utc": _utc(w.best_et),
        "best_margin": margin, "best_margin_kind": w.best_margin_kind, "best_margin_note": w.best_margin_note, "best_margin_physical": None if lim is None or margin is None else margin * lim.margin_scale,
        "best_margin_unit": None if lim is None else lim.unit, "best_state": w.best_state, "best_limiting": w.best_limiting,
        "robust": [[_utc(a), _utc(b)] for a, b in w.robust],
        "spacing_h": float(w.spacing_h), "best_totals": dict(w.best_totals),
    }


def scan_body(scan: Any, req: dict[str, Any], ev: Any) -> dict[str, Any]:
    """The `scan` result for an `OpportunityScan`; `ev` is the scenario's own evaluation, which with the scanned range selects the limits."""
    return _envelope(
        "scan", req, scan.context.provider_name, scan.provenance, limits=limit_notes(scan_limits(ev, scan)),
        start_utc=req["start_utc"], end_utc=req["end_utc"], spacing_s=scan.spacing_s, rank_by=scan.rank_by,
        states=STATES, counts=scan.counts(), closing_constraints=scan.closing_constraints(),
        state_fraction=scan.state_fraction(), closing_fraction=scan.closing_fraction(),
        windows=[_window(w, _margin_scales(scan)) for w in scan.windows], calendar=_calendar(scan.calendar),
        candidates=_scan_arrays(scan, int(req.get("max_candidates", 4000))),
    )


def scan_job(req: dict[str, Any], ctx: JobContext) -> dict[str, Any]:
    scenario = _scenario(req)
    check_in_coverage(start_utc=req["start_utc"], end_utc=req["end_utc"])
    ctx.progress(0.02, "loading terrain")
    provider = get_provider(req["terrain"], stores=scenario.terrain_stores)
    scan = _guard(lambda: scan_opportunities(
        scenario, provider, start_utc=req["start_utc"], end_utc=req["end_utc"], spacing_s=req["spacing_s"],
        signal_step_s=req["signal_step_s"], lookback_h=req["lookback_h"], calendar_bin_h=req["calendar_bin_h"],
        progress=_scaled(ctx, 0.05, 0.9), rank_by=req.get("rank_by", "margin")))
    ctx.progress(0.9, "evaluating the scenario for its limits")
    ev = _guard(lambda: evaluate_scenario(scenario, provider))
    ctx.progress(0.95, "preparing result")
    return scan_body(scan, req, ev)


def _alt_sites(req: dict[str, Any], base_name: str | None = None) -> list[SiteSpec]:
    by_id = {s.id: s for s in load_sites()}
    out = []
    for sid in req.get("alternative_sites", []):
        if sid not in by_id:
            raise RequestError(f"unknown catalogue site {sid!r}")
        e = by_id[sid]
        out.append(SiteSpec(lat_deg=e.lat_deg, lon_deg=e.lon_deg, name=e.name, catalog_id=e.id))
    out += [SiteSpec(lat_deg=a["lat_deg"], lon_deg=a["lon_deg"], name=a["name"]) for a in req.get("alternative_coordinates", [])]
    return _distinct_names(out, base_name)


def _distinct_names(sites: list[SiteSpec], base_name: str | None) -> list[SiteSpec]:
    """Alternatives that share a name (several catalogue entries are called alike, or the user repeats one, or one
    equals the scenario's own site) get the catalogue id or the coordinates appended, so rows can be told apart."""
    counts: dict[str | None, int] = {}
    for n in [base_name, *(s.name for s in sites)]:
        counts[n] = counts.get(n, 0) + 1
    out = []
    taken = {base_name}
    for s in sites:
        name = s.name
        if counts[name] > 1:
            tag = s.catalog_id if s.catalog_id else f"{s.lat_deg:.4f}, {s.lon_deg:.4f}"
            name = f"{s.name} [{tag}]"
            k = 2
            while name in taken:
                name, k = f"{s.name} [{tag}] #{k}", k + 1
        taken.add(name)
        out.append(s.model_copy(update={"name": name}) if name != s.name else s)
    return out


def _slip_result(r: Any) -> dict[str, Any]:
    return {
        "scenario_name": r.scenario_name, "site": r.site.model_dump(mode="json"), "mode": r.mode,
        "n_pass": int(r.n_pass), "n_open": int(r.n_open), "mean_margin": _fin(float(r.mean_margin)),
        "scenario_sha256": r.provenance.get("scenario_sha256"),
        "provenance": r.provenance,
        "site_id": r.site.catalog_id, "site_name": r.site.name,
        "rows": [dataclasses.asdict(row) for row in r.rows],
    }


def slip_body(results: list[Any], req: dict[str, Any], ev: Any) -> dict[str, Any]:
    """The `slip` result for the (ranked) slip tables. The limits are those of everything evaluated: `rank_limits` over every ranked site
    (with the scenario's own evaluation `ev`) when alternatives are ranked, else `slip_limits` over `ev` and its slip rows."""
    scenario = _scenario(req)
    submitted_hash = scenario_hash(scenario)
    own = next((r for r in results if r.provenance.get("scenario_sha256") == submitted_hash), None)
    if own is None:
        raise RuntimeError(f"no ranked row carries the submitted scenario's hash {submitted_hash[:12]}")
    return _envelope(
        "slip", req, own.provenance["horizon_provider"]["provider"], own.provenance,
        limits=limit_notes(rank_limits(scenario, results, evaluation=ev) if len(results) > 1 else slip_limits(ev, own)),
        mode=req["mode"], slips_h=req["slips_h"], ranked=len(results) > 1,
        ranking_key="passing slips, then open (pass or marginal) slips, then mean normalised margin; best first",
        results=[_slip_result(r) for r in results],
    )


def slip_results(
    req: dict[str, Any], scenario: Scenario, provider: Any, progress: Callable[[float, str], None] | None = None,
) -> list[Any]:
    kw = dict(slips_h=req["slips_h"], mode=req["mode"], search_days=req["search_days"], spacing_s=req["spacing_s"],
              progress=progress)
    alts = _alt_sites(req, scenario.site.name)
    if alts:
        return _guard(lambda: rank_sites(scenario, [scenario.site, *alts], provider, **kw))
    return [_guard(lambda: slip_analysis(scenario, provider, **kw))]


def slip_job(req: dict[str, Any], ctx: JobContext) -> dict[str, Any]:
    scenario = _scenario(req)
    ctx.progress(0.02, "loading terrain")
    provider = get_provider(req["terrain"], stores=scenario.terrain_stores)
    results = slip_results(req, scenario, provider, _scaled(ctx, 0.05, 0.9))
    ctx.progress(0.9, "evaluating the scenario for its limits")
    ev = _guard(lambda: evaluate_scenario(scenario, provider))
    ctx.progress(0.95, "preparing result")
    return slip_body(results, req, ev)


def _when(ev: Any) -> dict[str, Any]:
    """The `when` instants of the evaluation's metrics that have them (the minimum state of charge), by metric key."""
    return {m.key: {c: None if i is None else dataclasses.asdict(i) for c, i in m.when.items()} for m in ev.metrics if m.when}


def _sens_row(r: Any) -> dict[str, Any]:
    return {"label": r.label, "value": r.value, "az_deg": r.az_deg, "lat_deg": r.lat_deg, "lon_deg": r.lon_deg,
            "state": r.state, "limiting": r.limiting, "metrics": r.metrics, "margins": r.margins, "when": _when(r.evaluation)}


def _sens_body(kind: str, res: Any, req: dict[str, Any]) -> dict[str, Any]:
    prov = res.baseline.evaluation.provenance
    return _envelope(
        kind, req, res.baseline.evaluation.provider_name, prov,
        variant=res.kind, baseline=_sens_row(res.baseline), rows=[_sens_row(r) for r in res.rows],
        limits=limit_notes(sensitivity_limits(res.baseline.evaluation, res)))


def height_sensitivity_job(req: dict[str, Any], ctx: JobContext) -> dict[str, Any]:
    scenario = _scenario(req)
    provider = get_provider(req["terrain"], stores=scenario.terrain_stores)
    ctx.progress(0.1, "evaluating variants")
    res = _guard(lambda: height_sensitivity(scenario, provider, kind=req["kind"], heights_m=req["heights_m"]))
    return _sens_body("sensitivity-height", res, req)


def position_sensitivity_job(req: dict[str, Any], ctx: JobContext) -> dict[str, Any]:
    scenario = _scenario(req)
    provider = get_provider(req["terrain"], stores=scenario.terrain_stores)
    ctx.progress(0.1, "evaluating variants")
    distances = req.get("distances_m")
    if distances is None and scenario.ellipse is not None:
        axes = sorted({scenario.ellipse.semi_minor_m, scenario.ellipse.semi_major_m})
        if axes[-1] > MAX_SHIFT_M:
            raise RequestError(
                f"the scenario's landing ellipse has a semi-major axis of {axes[-1]:,.0f} m, beyond the {MAX_SHIFT_M:,.0f} m "
                "a position sensitivity covers; give `distances_m` explicitly (each at most that) or use `slip` alternatives")
    res = _guard(lambda: position_sensitivity(scenario, provider, distances_m=distances))
    return _sens_body("sensitivity-position", res, req)


def _azimuth_attribution(ev: SiteEvaluation, provider: Any, observer: str, az_deg: float) -> dict[str, Any]:
    """The terrain sample that sets the horizon of `observer` (array or antenna) at `az_deg`."""
    prof = ev.signals.array_horizon if observer == "array" else ev.signals.antenna_horizon
    k = int(round((az_deg % 360.0) / (360.0 / len(prof.az_deg)))) % len(prof.az_deg)
    blocker = provider.blocker_point(prof, az_deg) if provider.models_terrain else None
    return {"az_deg": float(prof.az_deg[k]), "requested_az_deg": az_deg, "observer": observer,
            "observer_height_m": prof.site.mast_height_m, "horizon_elev_deg": float(prof.elev_deg[k]),
            "blocker_dist_m": _fin(float(prof.blocker_dist_m[k])), "blocker": blocker}


def attribution_job(req: dict[str, Any], ctx: JobContext) -> dict[str, Any]:
    scenario = _scenario(req)
    check_in_coverage(from_utc=req.get("from_utc"))
    provider = get_provider(req["terrain"], stores=scenario.terrain_stores)
    ctx.progress(0.1, "evaluating")
    ev = _guard(lambda: evaluate_scenario(scenario, provider))
    ctx.progress(0.8, "attributing")
    body: dict[str, Any] = {"event_kind": req.get("kind"), "from_utc": req.get("from_utc") or _utc(ev.t_land_et),
                            "limits": limit_notes(attribution_limits(ev))}
    if req.get("kind"):
        att = _guard(lambda: attribute_event(ev, req["kind"], req.get("from_utc"), provider, window_h=req["window_h"]))
        body["event"] = None if att is None else dataclasses.asdict(att)
        body["message"] = None if att is not None else f"no {req['kind']} in the analysed span after the given epoch"
    if req.get("az_deg") is not None:
        body["azimuth"] = _azimuth_attribution(ev, provider, req["observer"], req["az_deg"])
    return _envelope("attribution", req, ev.provider_name, ev.provenance, **body)


def compare_body(cmp: Any, req: dict[str, Any]) -> dict[str, Any]:
    """The `compare` result for a `Comparison` (also used by the exports)."""
    metrics = [
        {"key": k, "label": cmp.metric_labels[i], "unit": cmp.metric_units[i], "values": cmp.values[i],
         "low": cmp.low[i], "high": cmp.high[i], "when": [_when(e).get(k, {}) for e in cmp.evaluations]}
        for i, k in enumerate(cmp.metric_keys)]
    scenarios = [
        {"name": n, "state": cmp.states[j], "limiting": cmp.limiting[j], "verdict": cmp.verdicts[j].to_dict(),
         "scenario_sha256": cmp.evaluations[j].provenance.get("scenario_sha256"),
         "landing_utc": _utc(cmp.evaluations[j].t_land_et), "site": cmp.evaluations[j].scenario.site.model_dump(mode="json")}
        for j, n in enumerate(cmp.names)]
    first = cmp.evaluations[0]
    return {
        "kind": "compare", "scenario_sha256": None, "provider": first.provider_name,
        "terrain_stack": first.provenance.get("terrain_stack"),
        "warnings": _warnings(req, *(e.provenance for e in cmp.evaluations)),
        "limits": limit_notes(compare_limits(first, cmp)),
        "names": list(cmp.names), "metrics": metrics, "scenarios": scenarios,
        "provenance": {"shared": {k: first.provenance[k] for k in ("schema_version", "code", "kernels", "horizon_provider")},
                       "scenarios": {n: e.provenance for n, e in zip(cmp.names, cmp.evaluations)}},
    }


def compare_job(req: dict[str, Any], ctx: JobContext) -> dict[str, Any]:
    scenarios = [_scenario({"s": d}, "s") for d in req["scenarios"]]
    provider = get_provider(req["terrain"], stores=scenarios[0].terrain_stores)
    ctx.progress(0.1, "evaluating scenarios")
    cmp = _guard(lambda: compare_scenarios(scenarios, provider))
    return compare_body(cmp, req)


def _peaks(az: np.ndarray, elev: np.ndarray, dist: np.ndarray, provider: Any, prof: Any, n: int = 8, sep_deg: float = 10.0) -> list[dict[str, Any]]:
    left, right = np.roll(elev, 1), np.roll(elev, -1)
    cand = np.flatnonzero((elev >= left) & (elev > right) & np.isfinite(elev))
    chosen: list[int] = []
    for i in cand[np.argsort(-elev[cand])]:
        if all(min(abs(az[i] - az[j]), 360.0 - abs(az[i] - az[j])) >= sep_deg for j in chosen):
            chosen.append(int(i))
        if len(chosen) == n:
            break
    out = []
    for i in chosen:
        bp = provider.blocker_point(prof, float(az[i])) if provider.models_terrain else None
        out.append({"az_deg": float(az[i]), "elev_deg": float(elev[i]), "blocker_dist_m": _fin(float(dist[i])), "blocker": bp})
    return out


def horizon_job(req: dict[str, Any], ctx: JobContext) -> dict[str, Any]:
    from lunarnav.scenario.horizons import sphere_horizon_dip_deg

    stores = req.get("terrain_stores")
    provider = get_provider(req["terrain"], req["n_az"], stores=stores)
    lon = req["lon_deg"] if req["lon_deg"] <= 180.0 else req["lon_deg"] - 360.0
    site = Site(req["lat_deg"], lon, req["height_m"], "horizon request")
    ctx.progress(0.1, "computing horizon")
    top = req.get("antenna_height_max_m")
    if top is not None and top > req["height_m"]:
        base, tall = _guard(lambda: provider.horizons([site, Site(req["lat_deg"], lon, top, "horizon request")]))
        prof = fold_observers([base, base, tall])[1]
    else:
        prof = _guard(lambda: provider.horizon(site))
    lo, hi, elev, dist = prof.elev_lo_deg, prof.elev_hi_deg, prof.elev_deg, prof.blocker_dist_m
    report: dict[str, Any] = {"widened": False}
    if req["apply_error_model"]:
        settings = TerrainErrorSettings.model_validate(req["terrain_error"]) if req.get("terrain_error") else TerrainErrorSettings()
        prepared, report = prepare_horizon(prof, settings, provider.models_terrain, provider)
        lo, hi, elev, dist = prepared.elev_lo_deg, prepared.elev_hi_deg, prepared.elev_deg, prepared.blocker_dist_m
        prof = prepared
    k = int(np.nanargmax(elev))
    store = site_terrain(SimpleNamespace(site=site), provider)
    notes = horizon_limits(
        req["lat_deg"], models_terrain=provider.models_terrain, pixel_m=None if store is None else store["pixel_m"],
        dem_id="" if store is None else store["dem_id"], seam=(prof.provenance or {}).get("near_field_seam"),
        k_sigma=settings.k_sigma if req["apply_error_model"] else TerrainErrorSettings().k_sigma)
    prov = {"horizon": prof.provenance, "provider": provider.provenance(), "error_model": report}
    return {
        "kind": "horizon", "provider": provider.name, "scenario_sha256": None, "limits": limit_notes(notes),
        "terrain_stack": terrain_stack_record(SimpleNamespace(terrain_stores=None if stores is None else tuple(stores)), provider),
        "warnings": _warnings(req) + _nodata_warning(int(np.sum(~np.isfinite(prof.elev_deg)))),
        "site": {"lat_deg": req["lat_deg"], "lon_deg": req["lon_deg"], "height_m": req["height_m"]},
        "ground_height_m": prof.ground_height_m, "n_az": req["n_az"],
        "az_deg": prof.az_deg, "elev_deg": elev, "elev_lo_deg": lo, "elev_hi_deg": hi, "blocker_dist_m": dist,
        "max_elev_deg": float(elev[k]), "max_elev_az_deg": float(prof.az_deg[k]),
        "sphere_dip_deg": -float(sphere_horizon_dip_deg(req["height_m"])),
        "peaks": _peaks(prof.az_deg, elev, dist, provider, prof),
        "provenance": prov,
    }


WARM_AZIMUTHS = 8
WARM_RANGE_KM = 2.0


def warm_up() -> None:
    """Called once per pool worker at start: exercise the evaluation and scan code and a short-range terrain horizon
    (compiles the numerical kernels, touches the catalogue, opens the stores) so the first real request is not the
    slow one."""
    from lunarnav.scenario import scenario_from_catalog

    scenario = scenario_from_catalog("apollo-17", "apollo-lm", mission_duration_h=24.0, network=_warm_network())
    provider = SmoothSphereProvider()
    evaluate_scenario(scenario, provider)
    scan_opportunities(scenario, provider, start_utc="2024-03-01T00:00:00Z", end_utc="2024-03-03T00:00:00Z")
    if terrain_signature(data_dir()):
        from lunarnav.horizon import compute_horizon

        stack = get_provider("on").stack
        site = Site(lat_deg=scenario.site.lat_deg, lon_deg=scenario.site.lon_deg)
        try:
            compute_horizon(site, stack, n_az=WARM_AZIMUTHS, max_range_km=WARM_RANGE_KM, use_cache=False)
        except ValueError:
            pass


def _warm_network() -> Any:
    from lunarnav.scenario import network_from_catalog

    return network_from_catalog()
