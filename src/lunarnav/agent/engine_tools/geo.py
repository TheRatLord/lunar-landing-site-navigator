"""Engine tools: horizon, terrain queries, ephemeris tracks, ellipse statistics and site search."""

from __future__ import annotations

from typing import Any, ClassVar, Literal

import numpy as np
from pydantic import BaseModel, Field, model_validator

from lunarnav.ephem import earth_track, et_to_utc, sun_track, utc_to_et
from lunarnav.report.limits import ellipse_limits, evaluate_search_sites, horizon_limits, search_limits
from lunarnav.scenario import evaluate_scenario
from lunarnav.scenario.ellipse import ellipse_statistics
from lunarnav.scenario.search import SearchRegion, search_sites
from lunarnav.types import Site

from ..registry import AgentTool, ToolContext, ToolError, agent_tool
from . import invariants as inv
from .analysis import TERRAIN_DOC, prepare
from .common import Call, EngineOutput
from .jsonable import jsonable

MAX_TRACK_ROWS = 50_000


def _lon180(lon: float) -> float:
    return lon - 360.0 if lon > 180.0 else lon


def _store_at(provider: Any, lat: float, lon: float) -> tuple[str, float | None]:
    """The terrain store that serves a point (id and pixel size), or ("", None) with no terrain or no coverage."""
    if not provider.models_terrain:
        return "", None
    _, idx = provider.stack.height_and_store(lat, lon)
    i = int(idx[0])
    return ("", None) if i < 0 else (provider.stack.stores[i].dem_id, provider.stack.stores[i].pixel_size_m)


class HorizonInput(BaseModel):
    """Arguments of `horizon_profile`."""

    lat_deg: float = Field(ge=-90, le=90)
    lon_deg: float = Field(ge=-180, le=360, description="East-positive, ME frame.")
    mast_height_m: float = Field(default=2.0, ge=0, le=100, description="Observer height above the local terrain.")
    terrain: str = Field(default="stock", description=f"Terrain model: {TERRAIN_DOC}.")
    azimuths_deg: list[float] = Field(default_factory=list, max_length=36, description="Report these azimuths exactly "
                                      "(0 = north, 90 = east): horizon elevation with bounds, blocker distance and blocker point.")


class HorizonOutput(EngineOutput):
    """Terrain horizon seen from a point."""

    ground_height_m: float
    n_azimuths: int
    max_elevation_deg: float
    max_elevation_az_deg: float
    mean_elevation_deg: float
    sectors: list[dict[str, Any]]
    azimuths: list[dict[str, Any]]
    ROW_LISTS: ClassVar[dict[str, str]] = {"sectors": "az_from_deg", "azimuths": "az_deg"}


@agent_tool(
    "horizon_profile",
    "Terrain horizon (elevation vs azimuth, from north clockwise) at any lat/lon and mast height: maximum "
    "elevation and where, 30-degree sector maxima with the blocking distance, requested azimuths with "
    "optimistic/pessimistic bounds and the blocking terrain point. The full profile goes to a CSV.",
    HorizonInput, read_only=True)
async def horizon_tool(ctx: ToolContext, args: HorizonInput) -> HorizonOutput:
    call = Call(ctx, "horizon_profile")
    provider = call.provider(args.terrain)
    site = Site(args.lat_deg, _lon180(args.lon_deg), args.mast_height_m)
    prof = await call.run(lambda: provider.horizon(site))
    dem_id, pixel_m = _store_at(provider, site.lat_deg, site.lon_deg)
    call.add_notes(horizon_limits(site.lat_deg, models_terrain=provider.models_terrain, pixel_m=pixel_m, dem_id=dem_id,
                                  seam=(prof.provenance or {}).get("near_field_seam")))
    az, el = prof.az_deg, prof.elev_deg
    imax = int(np.argmax(el))
    step = 360.0 / len(az)
    sectors = []
    for s0 in range(0, 360, 30):
        m = (az >= s0) & (az < s0 + 30)
        j = int(np.flatnonzero(m)[np.argmax(el[m])])
        sectors.append({"az_from_deg": s0, "az_to_deg": s0 + 30, "max_elevation_deg": el[j],
                        "at_az_deg": az[j], "blocker_dist_m": prof.blocker_dist_m[j]})
    chosen = []
    for a in args.azimuths_deg:
        j = round((a % 360.0) / step) % len(az)
        bp = await call.run(lambda j=j: provider.blocker_point(prof, float(az[j])))
        chosen.append({"requested_az_deg": a, "az_deg": az[j], "elevation_deg": el[j], "elevation_lo_deg": prof.elev_lo_deg[j],
                       "elevation_hi_deg": prof.elev_hi_deg[j], "blocker_dist_m": prof.blocker_dist_m[j], "blocker": bp})
    call.write_csv("profile", ["az_deg", "elev_deg", "elev_lo_deg", "elev_hi_deg", "blocker_dist_m"],
                   zip(az.tolist(), el.tolist(), prof.elev_lo_deg.tolist(), prof.elev_hi_deg.tolist(),
                       prof.blocker_dist_m.tolist(), strict=True))
    call.violations.extend(["horizon: elev_lo > elev > elev_hi at some azimuth"] if (
        np.any(prof.elev_lo_deg > prof.elev_deg + 1e-9) or np.any(prof.elev_hi_deg < prof.elev_deg - 1e-9)) else [])
    out = HorizonOutput(
        ground_height_m=jsonable(prof.ground_height_m), n_azimuths=len(az), max_elevation_deg=jsonable(el[imax]),
        max_elevation_az_deg=jsonable(az[imax]), mean_elevation_deg=jsonable(float(np.mean(el))),
        sectors=jsonable(sectors), azimuths=jsonable(chosen),
        summary=f"max horizon elevation {el[imax]:.3f} deg at azimuth {az[imax]:.1f} deg, mast {args.mast_height_m:g} m")
    return call.finish(out, provenance={"horizon_provider": provider.provenance(), "horizon": jsonable(prof.provenance)})


class TerrainInfoInput(BaseModel):
    """Arguments of `terrain_info`."""

    query: Literal["points", "stores"] = Field(description="'points': height, slope and covering store at points; "
                                               "'stores': list the terrain stores of the chosen stack.")
    points: list[tuple[float, float]] = Field(default_factory=list, max_length=50, description="[(lat_deg, lon_deg), ...]")
    slope_baselines_m: list[float] = Field(default=[20.0], max_length=5, description="Slope baselines in metres.")
    terrain: str = Field(default="stock", description=f"Terrain model: {TERRAIN_DOC}.")


class TerrainInfoOutput(EngineOutput):
    """Terrain facts."""

    rows: list[dict[str, Any]]
    ROW_LISTS: ClassVar[dict[str, str]] = {"rows": "n", "rows.source.tiles": ""}


@agent_tool(
    "terrain_info",
    "Terrain store queries: for points, height above the 1737.4 km reference sphere, the finest store that "
    "covers it (id, pixel size) and slope at chosen baselines; or list the stores of the stack (id, pixel "
    "size, height range).",
    TerrainInfoInput, read_only=True)
async def terrain_info_tool(ctx: ToolContext, args: TerrainInfoInput) -> TerrainInfoOutput:
    call = Call(ctx, "terrain_info")
    provider = call.provider(args.terrain)
    if not provider.models_terrain:
        raise ToolError("the smooth sphere has no terrain stores")
    stack = provider.stack
    rows: list[dict[str, Any]] = []
    if args.query == "stores":
        for s in stack.stores:
            rows.append({"n": len(rows) + 1, "dem_id": s.dem_id, "pixel_size_m": s.pixel_size_m, "height_range_m": s.meta.get("height_range_m"),
                         "source": (s.meta.get("source") or {}).get("label")})
    else:
        if not args.points:
            raise ToolError("points is required for query='points'")

        def work() -> list[dict[str, Any]]:
            out = []
            for lat, lon in args.points:
                lon = _lon180(lon)
                h, idx = stack.height_and_store(lat, lon)
                i = int(idx[0])
                row: dict[str, Any] = {"n": len(out) + 1, "lat_deg": lat, "lon_deg": lon, "height_m": None if not np.isfinite(h[0]) else float(h[0]),
                                       "store": None if i < 0 else stack.stores[i].dem_id,
                                       "pixel_size_m": None if i < 0 else stack.stores[i].pixel_size_m}
                row["slope_deg"] = {f"{b:g} m": provider.slope_deg(lat, lon, b) for b in args.slope_baselines_m}
                out.append(row)
            return out

        rows = await call.run(work)
        for r in rows:
            call.add_notes(horizon_limits(r["lat_deg"], models_terrain=True, pixel_m=r["pixel_size_m"], dem_id=r["store"] or ""))
    out = TerrainInfoOutput(rows=jsonable(rows), summary=f"{len(rows)} row(s)")
    return call.finish(out, provenance={"horizon_provider": provider.provenance()})


class TrackInput(BaseModel):
    """Arguments of `ephemeris_track`."""

    lat_deg: float = Field(ge=-90, le=90)
    lon_deg: float = Field(ge=-180, le=360)
    mast_height_m: float = Field(default=2.0, ge=0, le=100)
    start_utc: str
    end_utc: str
    step_min: float = Field(default=60.0, ge=1, le=1440)
    bodies: list[Literal["sun", "earth"]] = Field(default=["sun", "earth"])
    terrain: str = Field(default="stock", description=f"Terrain model used only for the ground height: {TERRAIN_DOC}.")


class TrackOutput(EngineOutput):
    """Sun and Earth direction over time."""

    n_epochs: int
    bodies: dict[str, dict[str, Any]]
    ROW_LISTS: ClassVar[dict[str, str]] = {"bodies.*.centre_crossings.events": "utc"}


@agent_tool(
    "ephemeris_track",
    "Sun and/or Earth apparent azimuth, elevation and range from a lunar site over a time span (SPICE "
    "ephemeris, DE440 + frames, light-time and aberration). Inline: extremes and the times the body centre "
    "crosses the local horizontal plane (not terrain, not half-flux). Full series to a CSV.",
    TrackInput, read_only=True)
async def track_tool(ctx: ToolContext, args: TrackInput) -> TrackOutput:
    call = Call(ctx, "ephemeris_track")
    provider = call.provider(args.terrain)
    t0, t1 = utc_to_et(args.start_utc), utc_to_et(args.end_utc)
    if not t1 > t0:
        raise ToolError("end_utc must be after start_utc")
    n = int((t1 - t0) // (args.step_min * 60.0)) + 1
    if n > MAX_TRACK_ROWS:
        raise ToolError(f"{n} epochs requested; the limit is {MAX_TRACK_ROWS} (raise step_min)")
    et = t0 + np.arange(n) * args.step_min * 60.0
    site = Site(args.lat_deg, _lon180(args.lon_deg), args.mast_height_m)

    def work() -> tuple[float, dict[str, Any]]:
        ground = 0.0
        if provider.models_terrain:
            h = provider.stack.height(site.lat_deg, site.lon_deg)[0]
            ground = float(h) if np.isfinite(h) else 0.0
        fn = {"sun": sun_track, "earth": earth_track}
        return ground, {b: fn[b](site, ground, et) for b in args.bodies}

    ground, tracks = await call.run(work)
    utc = et_to_utc(et)
    header = ["utc"]
    cols: list[np.ndarray] = []
    summary: dict[str, dict[str, Any]] = {}
    for body, tr in tracks.items():
        header += [f"{body}_az_deg", f"{body}_el_deg", f"{body}_range_km"]
        cols += [tr.az_deg, tr.el_deg, tr.range_km]
        el = tr.el_deg
        cross = np.flatnonzero(np.sign(el[1:]) != np.sign(el[:-1]))
        events = []
        for i in cross[:20]:
            f = el[i] / (el[i] - el[i + 1])
            events.append({"kind": "rise" if el[i + 1] > el[i] else "set",
                           "utc": et_to_utc(float(et[i] + f * (et[i + 1] - et[i])))})
        imax, imin = int(np.argmax(el)), int(np.argmin(el))
        summary[body] = {"max_elevation_deg": el[imax], "max_elevation_utc": utc[imax], "min_elevation_deg": el[imin],
                         "min_elevation_utc": utc[imin], "fraction_above_horizon_plane": float(np.mean(el > 0)),
                         "centre_crossings": {"n_total": len(cross), "events": events}}
    call.write_csv("series", header, ([utc[i], *[float(c[i]) for c in cols]] for i in range(n)))
    out = TrackOutput(n_epochs=n, bodies=jsonable(summary), data_versions={},
                      summary=f"{n} epochs at {args.step_min:g} min; ground height {ground:.1f} m")
    return call.finish(out, provenance={"horizon_provider": provider.provenance()})


class EllipseInput(BaseModel):
    """Arguments of `ellipse_statistics`."""

    scenario_id: str = Field(description="A scenario built with an ellipse.")
    terrain: str = Field(default="stock", description=f"Terrain model: {TERRAIN_DOC}.")
    n_samples: int = Field(default=512, ge=16, le=4096)
    seed: int = Field(default=0, ge=0)
    hazard_slope_deg: float | None = Field(default=None, gt=0, description="Default: the active slope limit.")
    hazard_roughness_m: float | None = Field(default=None, gt=0)


class EllipseOutput(EngineOutput):
    """Verdict statistics over the landing ellipse."""

    result: dict[str, Any]
    ROW_LISTS: ClassVar[dict[str, str]] = {"result.convergence.rows": "n"}


@agent_tool(
    "ellipse_statistics",
    "Monte Carlo over the scenario's landing ellipse: probability of pass/marginal/fail, per-constraint "
    "failure probability, hazard fraction, percentiles of metrics, best/worst/centre samples and a "
    "convergence check. Deterministic for a given seed. The map goes to a result file.",
    EllipseInput, read_only=True)
async def ellipse_tool(ctx: ToolContext, args: EllipseInput) -> EllipseOutput:
    call = Call(ctx, "ellipse_statistics")
    sc, provider = prepare(call, args.scenario_id, args.terrain)
    if sc.ellipse is None:
        raise ToolError("the scenario has no landing ellipse; rebuild it with build_scenario ellipse=...")
    res = await call.run(lambda: ellipse_statistics(
        sc, provider, n_samples=args.n_samples, seed=args.seed, hazard_slope_deg=args.hazard_slope_deg,
        hazard_roughness_m=args.hazard_roughness_m))
    ev = await call.run(lambda: evaluate_scenario(sc, provider))
    call.add_notes(ellipse_limits(ev, res))
    doc = jsonable(res.to_dict(with_samples=False))
    call.violations.extend(inv.check_ellipse(doc))
    call.write_json("full", doc)
    compact = {k: v for k, v in doc.items() if k not in ("map", "provenance")}
    sp = doc.get("state_probability", {})
    out = EllipseOutput(result=compact, summary="state probability " + ", ".join(
        f"{k} {v:.3f}" for k, v in sp.items() if isinstance(v, (int, float))))
    return call.finish(out, provenance=res.provenance)


class SearchInput(BaseModel):
    """Arguments of `search_sites`."""

    scenario_id: str = Field(description="Supplies lander, constraints, network and time; its own site is ignored.")
    lat_deg: float = Field(ge=-90, le=90, description="Search region centre.")
    lon_deg: float = Field(ge=-180, le=360)
    radius_m: float = Field(gt=0, le=500_000)
    final_spacing_m: float = Field(ge=5, description="Final candidate lattice spacing (at least 5 m, the finest "
                                   "terrain model; at most 2000 lattice cells from the centre to the edge).")
    first_utc: str | None = Field(default=None, description="With last_utc and epoch_spacing_h: landing epochs to try.")
    last_utc: str | None = None
    epoch_spacing_h: float | None = Field(default=None, gt=0)
    top_k: int = Field(default=10, ge=1, le=50)
    min_separation_m: float | None = Field(default=None, gt=0)
    rank_by: Literal["margin", "sunlit_h", "contact_h", "sunlit_contact_h"] = Field(
        default="margin", description="What ranks the result: `margin` (state, then the normalised margin of the limiting constraint) or "
        "the nominal hours during the surface mission that are sunlit (`sunlit_h`), in contact (`contact_h`) or both at once (`sunlit_contact_h`).")
    terrain: str = Field(default="stock", description=f"Terrain model: {TERRAIN_DOC}.")

    @model_validator(mode="after")
    def _lattice_is_bounded(self) -> SearchInput:
        if self.radius_m / self.final_spacing_m > 2000:
            raise ValueError("radius_m / final_spacing_m must not exceed 2000 (use a coarser spacing or a smaller region)")
        return self


class SearchOutput(EngineOutput):
    """Ranked sites in the region."""

    n_sites: int
    counts: dict[str, Any]
    settings: dict[str, Any]
    n_full_evaluations: int
    n_exhaustive_equivalent: int
    sites: list[dict[str, Any]]
    ROW_LISTS: ClassVar[dict[str, str]] = {"sites": "rank"}


@agent_tool(
    "search_sites",
    "Hierarchical search of a circular region for sites that satisfy the scenario's constraints (coarse "
    "screening, then full evaluation of promising cells), optionally over a range of landing epochs. Returns "
    "the ranked sites with state, worst margin, limiting constraint, best epoch and the evaluation counts. "
    "Pruning is a heuristic (see settings); the grid goes to a result file.",
    SearchInput, read_only=True)
async def search_tool(ctx: ToolContext, args: SearchInput) -> SearchOutput:
    call = Call(ctx, "search_sites")
    sc, provider = prepare(call, args.scenario_id, args.terrain)
    region = SearchRegion(args.lat_deg, _lon180(args.lon_deg), radius_m=args.radius_m)
    res = await call.run(lambda: search_sites(
        sc, provider, region, final_spacing_m=args.final_spacing_m, first_utc=args.first_utc, last_utc=args.last_utc,
        epoch_spacing_h=args.epoch_spacing_h, top_k=args.top_k, min_separation_m=args.min_separation_m, rank_by=args.rank_by))
    full = jsonable(res.to_dict(with_grid=True))
    call.write_json("full", full)
    d = jsonable(res.to_dict(with_grid=False))
    sites = d["sites"]
    site_evals = await call.run(lambda: evaluate_search_sites(sc, res, provider))
    call.add_notes(search_limits(site_evals, res))
    call.violations.extend(inv.check_fractions(d.get("counts")))
    out = SearchOutput(
        n_sites=len(sites), counts=d.get("counts", {}), settings=d.get("settings", {}),
        n_full_evaluations=int(res.n_full_evaluations), n_exhaustive_equivalent=int(res.n_exhaustive_equivalent),
        sites=sites[: args.top_k], summary=f"{len(sites)} ranked site(s)" + (
            f"; best {sites[0]['state']} margin {sites[0]['worst_margin']}" if sites else ""))
    return call.finish(out, provenance=res.provenance)


def geo_tools() -> list[AgentTool[Any]]:
    """Horizon, terrain, ephemeris, ellipse and search tools."""
    return [horizon_tool, terrain_info_tool, track_tool, ellipse_tool, search_tool]
