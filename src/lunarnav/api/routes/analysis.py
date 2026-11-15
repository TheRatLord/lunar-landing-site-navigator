"""Scenario analyses (evaluate, scan, slip, sensitivity, attribution, compare), horizon profiles and exports.

Every analysis runs as a cached job in the compute pool; the response is uniform:

* the result is ready within ``wait_s`` (including a cache hit): **200** with the result JSON;
* otherwise **202** with a `JobStatus`; follow ``/jobs/{id}/events`` and fetch ``/jobs/{id}/result``.

The ``X-Cache`` header says ``hit`` when the result came from the content-addressed cache and ``miss`` when it
was computed for this request; ``X-Job-Id`` names the job.
"""

from __future__ import annotations

import asyncio
import copy
import re
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse, Response
from starlette.background import BackgroundTask

from lunarnav.api.compute.exports import MEDIA_TYPES
from lunarnav.api.context import ServiceContext, get_ctx
from lunarnav.api.docstore import NotFound
from lunarnav.api.errors import PROBLEM_RESPONSES, ApiProblem
from lunarnav.api.jobs import Job
from lunarnav.api.json import loads
from lunarnav.api.routes.scenarios import validate_document
from lunarnav.api.schemas import JobStatus
from lunarnav.api.schemas_results import (
    AttributionResult,
    CompareResult,
    EllipseResult,
    EvaluateResult,
    HorizonResult,
    RegionalResult,
    ScanResult,
    SearchResult,
    SensitivityResult,
    SlipResult,
)
from lunarnav.api.schemas_scenario import (
    AttributionRequest,
    CompareRequest,
    EllipseRequest,
    EvaluateRequest,
    ExportManifest,
    ExportRequest,
    HeightSensitivityRequest,
    HorizonRequest,
    PositionSensitivityRequest,
    RegionalRequest,
    ReportRequest,
    ScanRequest,
    ScenarioRef,
    SearchRequest,
    SlipRequest,
)
from lunarnav.api.stack_choice import check_terrain_stores, require_common_stores, terrain_mode
from lunarnav.api.versions import terrain_signature

router = APIRouter(
    tags=["analyses"],
    responses={
        202: {"model": JobStatus, "description": "Not finished within `wait_s`: follow the job (`/jobs/{id}/events`, `/jobs/{id}/result`)."},
        422: PROBLEM_RESPONSES[422], 404: PROBLEM_RESPONSES[404], 409: PROBLEM_RESPONSES[409],
        429: {"description": "Job queue is full."},
    },
)
Ctx = Annotated[ServiceContext, Depends(get_ctx)]


def ok(model: type) -> dict[int | str, dict[str, Any]]:
    return {200: {"model": model, "description": f"The result: `{model.__name__}` (also the `result` of the job)."}}


def merge_patch(target: Any, patch: Any) -> Any:
    """RFC 7386 JSON merge patch (objects merge, `null` removes, everything else replaces)."""
    if not isinstance(patch, dict):
        return copy.deepcopy(patch)
    out = dict(target) if isinstance(target, dict) else {}
    for key, value in patch.items():
        if value is None:
            out.pop(key, None)
        else:
            out[key] = merge_patch(out.get(key), value)
    return out


def scenario_document(ref: ScenarioRef, ctx: ServiceContext) -> dict[str, Any]:
    """The normalised scenario document a reference denotes (stored or inline, with overrides applied)."""
    if ref.scenario_id is not None:
        try:
            base = ctx.docs.get(ref.scenario_id).body
        except NotFound as exc:
            raise ApiProblem(404, "Plan not found", f"No saved plan {ref.scenario_id!r}.") from exc
    else:
        assert ref.scenario is not None
        base = ref.scenario.model_dump(mode="json")
    document = merge_patch(base, ref.overrides) if ref.overrides else base
    return validate_document(document)[1]


def scenario_documents(refs: list[ScenarioRef], mode: str, field: str, ctx: ServiceContext) -> list[dict[str, Any]]:
    docs = [scenario_document(ref, ctx) for ref in refs]
    for i, doc in enumerate(docs):
        check_terrain_stores(doc, mode, ctx.settings.data_dir, ["body", field, str(i), "scenario"])
    return docs


_REF_FIELDS = {"scenario", "scenario_id", "overrides", "terrain", "wait_s", "compare_with"}


def scenario_request(body: ScenarioRef, ctx: ServiceContext) -> dict[str, Any]:
    mode, warnings = terrain_mode(body.terrain, ctx.settings.data_dir)
    document = scenario_document(body, ctx)
    check_terrain_stores(document, mode, ctx.settings.data_dir)
    req = {**body.model_dump(mode="json", exclude=_REF_FIELDS), "scenario": document, "terrain": mode, "warnings": warnings}
    if isinstance(body, ExportRequest | ReportRequest):
        req["compare_with"] = scenario_documents(body.compare_with, mode, "compare_with", ctx)
        if req["compare_with"]:
            require_common_stores([document, *req["compare_with"]], "the report (`scenario` and `compare_with`)")
    return req


def job_headers(job: Job) -> dict[str, str]:
    return {"X-Cache": "hit" if job.cached else "miss", "X-Job-Id": job.id}


def status_response(job: Job) -> Response:
    body = JobStatus(**job.status())
    return Response(body.model_dump_json(), status_code=202, media_type="application/json",
                    headers={"Location": f"/api/v1/jobs/{job.id}", "X-Job-Id": job.id})


async def run_analysis(ctx: ServiceContext, kind: str, request: dict[str, Any], wait_s: float) -> Response:
    job = await ctx.jobs.run(kind, request, wait_s)
    if job.state != "done":
        return status_response(job)
    return Response(ctx.jobs.result(job.id), media_type="application/json", headers=job_headers(job))


async def run_with_files(
    ctx: ServiceContext, kind: str, request: dict[str, Any], wait_s: float, missing: ApiProblem, label: str = "",
) -> tuple[Job, bytes, list[Path]] | Response:
    for _ in range(3):
        job = await ctx.jobs.run(kind, request, wait_s, label)
        if job.state != "done":
            return status_response(job)
        data = ctx.jobs.result(job.id)
        paths = [export_path(ctx, f["url"]) for f in loads(data)["files"]]
        await asyncio.to_thread(ctx.exports.prune, [paths[0].parent])
        if all(p.is_file() for p in paths):
            return job, data, paths
        ctx.jobs.discard_result(job)
    raise missing


@router.post("/analyses/evaluate", responses=ok(EvaluateResult), summary="Evaluate one scenario")
async def evaluate(body: EvaluateRequest, ctx: Ctx) -> Response:
    """Verdict with per-constraint margins, headline metrics, sunlit/dark/eclipse/contact intervals with edge
    ranges, next-event countdowns from `from_utc`, the horizons and the time series (decimated, extremes kept)."""
    return await run_analysis(ctx, "analysis.evaluate", scenario_request(body, ctx), body.wait_s)


@router.post("/analyses/scan", responses=ok(ScanResult), summary="Landing opportunity scan and calendar")
async def scan(body: ScanRequest, ctx: Ctx) -> Response:
    """Every landing candidate between `start_utc` and `end_utc`: open windows (with PASS-only sub-runs), the
    lunation calendar, closing-constraint counts and the decimated candidate series."""
    return await run_analysis(ctx, "analysis.scan", scenario_request(body, ctx), body.wait_s)


@router.post("/analyses/slip", responses=ok(SlipResult), summary="Slip analysis (landing or launch), alternative sites ranked")
async def slip(body: SlipRequest, ctx: Ctx) -> Response:
    """Verdict, closing constraint and next open window for each slip; with `alternative_sites` every site is
    analysed under the same slips and ranked."""
    return await run_analysis(ctx, "analysis.slip", scenario_request(body, ctx), body.wait_s)


@router.post("/analyses/sensitivity/height", responses=ok(SensitivityResult), summary="Observer-height sensitivity")
async def height_sensitivity(body: HeightSensitivityRequest, ctx: Ctx) -> Response:
    return await run_analysis(ctx, "analysis.sensitivity-height", scenario_request(body, ctx), body.wait_s)


@router.post("/analyses/sensitivity/position", responses=ok(SensitivityResult), summary="Landing-position sensitivity")
async def position_sensitivity(body: PositionSensitivityRequest, ctx: Ctx) -> Response:
    """Shifts the landing point in eight directions at each distance (a terrain run is slow the first time)."""
    return await run_analysis(ctx, "analysis.sensitivity-position", scenario_request(body, ctx), body.wait_s)


@router.post("/analyses/attribution", responses=ok(AttributionResult), summary="Which terrain blocks an event or an azimuth")
async def attribution(body: AttributionRequest, ctx: Ctx) -> Response:
    return await run_analysis(ctx, "analysis.attribution", scenario_request(body, ctx), body.wait_s)


@router.post("/analyses/ellipse", responses=ok(EllipseResult), summary="Verdict statistics over the landing ellipse")
async def ellipse(body: EllipseRequest, ctx: Ctx) -> Response:
    req = scenario_request(body, ctx)
    if req["scenario"].get("ellipse") is None:
        raise ApiProblem(422, "No landing ellipse", "The plan has no landing ellipse (`ellipse`). Set its semi-axes and azimuth first.")
    return await run_analysis(ctx, "analysis.ellipse", req, body.wait_s)


@router.post("/analyses/search", responses=ok(SearchResult), summary="Search a region for sites that satisfy the constraints")
async def search(body: SearchRequest, ctx: Ctx) -> Response:
    return await run_analysis(ctx, "analysis.search", scenario_request(body, ctx), body.wait_s)


@router.post("/analyses/regional", responses=ok(RegionalResult), summary="Gridded illumination and Earth-visibility layers")
async def regional(body: RegionalRequest, ctx: Ctx) -> Response:
    if not terrain_signature(ctx.settings.data_dir):
        raise ApiProblem(422, "No terrain stores", "Regional layers need terrain data, and none is installed.")
    ran = await run_with_files(ctx, "analysis.regional", body.model_dump(mode="json", exclude={"wait_s"}), body.wait_s,
                               ApiProblem(500, "Regional files missing", "The GeoTIFFs could not be produced."))
    if isinstance(ran, Response):
        return ran
    job, data, _ = ran
    return Response(data, media_type="application/json", headers=job_headers(job))


@router.post("/analyses/compare", responses=ok(CompareResult), summary="Comparison matrix of several scenarios")
async def compare(body: CompareRequest, ctx: Ctx) -> Response:
    mode, warnings = terrain_mode(body.terrain, ctx.settings.data_dir)
    docs = scenario_documents(body.items, mode, "items", ctx)
    require_common_stores(docs, "`items`")
    if body.names is not None:
        if len(body.names) != len(docs):
            raise ApiProblem(422, "Invalid names", "`names` must have one entry per item.")
        for doc, name in zip(docs, body.names):
            doc["name"] = name
    names = [d["name"] for d in docs]
    if len(set(names)) != len(names):
        raise ApiProblem(422, "Duplicate plan names", "Plan names must be unique. Pass `names` to rename them.", names=names)
    return await run_analysis(ctx, "analysis.compare", {"scenarios": docs, "terrain": mode, "warnings": warnings}, body.wait_s)


@router.post("/horizon", responses=ok(HorizonResult), summary="Horizon profile of a site and observer height")
async def horizon(body: HorizonRequest, ctx: Ctx) -> Response:
    """Nominal horizon with lower/upper bounds, blocker distances and the strongest peaks with their terrain
    coordinates; from the terrain stores or the smooth sphere (`terrain`). `terrain_stores` and `terrain_error` take the
    scenario's own settings, so with `apply_error_model` the horizon equals the one inside the evaluation of that scenario."""
    mode, warnings = terrain_mode(body.terrain, ctx.settings.data_dir)
    check_terrain_stores({"terrain_stores": body.terrain_stores, "site": {"lat_deg": body.lat_deg, "lon_deg": body.lon_deg}},
                         mode, ctx.settings.data_dir, ["body"])
    req = {**body.model_dump(mode="json", exclude={"terrain", "wait_s"}), "terrain": mode, "warnings": warnings}
    return await run_analysis(ctx, "analysis.horizon", req, body.wait_s)


EXPORT_WAIT_DEFAULT = 20.0
SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]+$")


@router.post(
    "/exports/{kind}",
    summary="Download an export (aem, CSV/JSON tables, zip bundle)",
    response_class=Response,
    responses={200: {"content": {"text/plain": {}, "text/csv": {}, "application/json": {}, "application/zip": {}},
                     "description": "The file (`Content-Disposition: attachment`)."}},
)
async def export(
    kind: str, body: ExportRequest, ctx: Ctx,
) -> Response:
    """`kind`: `aem`, `timeseries-csv`, `timeseries-json`, `intervals-csv`, `metrics-csv`, `scenario-json`,
    `opportunities-csv`, `calendar-csv`, `slip-csv`, `comparison-csv` or `bundle` (every export whose inputs are
    given, plus provenance and a manifest). The file is returned when ready within `wait_s` (default 20 s);
    otherwise 202 with a job whose result is an `ExportManifest` listing download URLs
    (`GET /exports/files/{digest}/{name}`). The files are exactly the engine's own exports, provenance included."""
    if kind not in EXPORT_KINDS:
        raise ApiProblem(404, "Unknown export", f"No export {kind!r}; available: {sorted(EXPORT_KINDS)}.")
    req = {**scenario_request(body, ctx), "kind": kind}
    needs = {"opportunities-csv": ("scan", body.scan), "calendar-csv": ("scan", body.scan),
             "slip-csv": ("slip", body.slip), "comparison-csv": ("compare_with", body.compare_with or None)}
    if kind in needs and needs[kind][1] is None:
        raise ApiProblem(422, "Missing export input", f"Export {kind!r} needs `{needs[kind][0]}`.")
    return await serve_export(ctx, req, body, f"Export {kind}")


async def serve_export(ctx: ServiceContext, req: dict[str, Any], body: ScenarioRef, label: str) -> Response:
    """Run an export job and answer with its file (one file), its manifest (several) or the job status (202)."""
    wait = body.wait_s if "wait_s" in body.model_fields_set else EXPORT_WAIT_DEFAULT
    ran = await run_with_files(ctx, "analysis.export", req, wait,
                               ApiProblem(500, "Export files missing", "The export files could not be produced."), label)
    if isinstance(ran, Response):
        return ran
    job, data, paths = ran
    manifest = loads(data)
    if len(paths) == 1:
        return file_response(ctx, paths[0], manifest["files"][0], job)
    return Response(ExportManifest(**manifest).model_dump_json(), media_type="application/json", headers=job_headers(job))


@router.post(
    "/report", summary="Mission analysis report (HTML or PDF)", response_class=Response,
    responses={200: {"content": {"text/html": {}, "application/pdf": {}}, "description": "The report (`Content-Disposition: attachment`)."}},
)
async def report(body: ReportRequest, ctx: Ctx) -> Response:
    """Self-contained report of the scenario's evaluation with optional opportunity-scan, slip and comparison sections,
    rendered by `lunarnav.report` from the engine results (it computes nothing itself). Served within `wait_s` (default
    20 s), otherwise 202 with a job whose result is an `ExportManifest`. A report whose results cannot be shown
    (inconsistent or missing inputs) is `422`. The file counts against the export disk budget."""
    if body.slip is not None and (body.slip.alternative_sites or body.slip.alternative_coordinates):
        raise ApiProblem(422, "Alternative sites not allowed", "The report's delay section covers only the plan's own site. "
                         "Remove `alternative_sites` and `alternative_coordinates`.")
    req = {**scenario_request(body, ctx), "kind": "report"}
    if body.ellipse is not None and req["scenario"].get("ellipse") is None:
        raise ApiProblem(422, "No landing ellipse", "The plan has no landing ellipse (`ellipse`). Set one, or remove the report's `ellipse` section.")
    return await serve_export(ctx, req, body, f"Report ({body.format})")


EXPORT_KINDS = frozenset({
    "aem", "timeseries-csv", "timeseries-json", "intervals-csv", "metrics-csv", "scenario-json",
    "opportunities-csv", "calendar-csv", "slip-csv", "comparison-csv", "bundle",
})


def export_path(ctx: ServiceContext, url: str) -> Path:
    digest, name = url.rsplit("/", 2)[-2:]
    return ctx.settings.service_dir / "exports" / digest / name


def file_response(ctx: ServiceContext, path: Path, entry: dict[str, Any], job: Job) -> FileResponse:
    """Stream an export file; its directory is exempt from pruning until the response has been sent."""
    ctx.exports.hold(path.parent)
    return FileResponse(
        path, media_type=entry["media_type"], filename=entry["name"],
        headers={**job_headers(job), "X-Artifact-SHA256": entry["sha256"]},
        background=BackgroundTask(ctx.exports.release, path.parent))


DELETE_GRACE_S, DELETE_GRACE_TRIES = 0.05, 20
"""How long a delete waits for a hold that has just been released (about a second in all)."""


@router.delete(
    "/exports/files/{digest}", status_code=204, summary="Delete the files of an export or regional run",
    responses={404: PROBLEM_RESPONSES[404], 409: PROBLEM_RESPONSES[409]},
)
async def delete_export_files(digest: str, ctx: Ctx) -> Response:
    """Remove the directory of an export or of a regional run: every file it produced (GeoTIFFs, header, bundles).
    The digest is the directory name in the file URLs (`/exports/files/{digest}/{name}`). Results already computed
    keep their manifest, but its links answer 404 afterwards; resubmitting the same request recomputes the files.
    409 while one of the files is being downloaded or a regional or export job is running."""
    directory = ctx.settings.service_dir / "exports" / digest
    if not re.fullmatch(r"[0-9a-f]{24}", digest) or not directory.is_dir() or directory.is_symlink():
        raise ApiProblem(404, "Export files not found", "No export files with that digest. They were deleted or pruned.")
    if ctx.jobs.unfinished({"analysis.regional", "analysis.export"}):
        raise ApiProblem(409, "Export files in use", "A regional or export job is running and may be writing these files. Try again when it has finished.",
                         kind="export-in-use")
    for _ in range(DELETE_GRACE_TRIES):
        if await asyncio.to_thread(ctx.exports.discard, directory):
            break
        await asyncio.sleep(DELETE_GRACE_S)
    else:
        raise ApiProblem(409, "Export files in use", "A file of this export is being downloaded. Try again when the download has finished.",
                         kind="export-in-use")
    return Response(status_code=204)


@router.get(
    "/exports/files/{digest}/{name}", summary="Download a file produced by an export job",
    response_class=FileResponse, responses={200: {"content": {"application/octet-stream": {}}}},
)
async def export_file(digest: str, name: str, ctx: Ctx) -> FileResponse:
    if not re.fullmatch(r"[0-9a-f]{24}", digest) or not SAFE_NAME.match(name):
        raise ApiProblem(404, "Export file not found", "Unknown export file.")
    path = ctx.settings.service_dir / "exports" / digest / name
    if not path.is_file():
        raise ApiProblem(404, "Export file not found", "The file no longer exists. Run the export again.")
    media = MEDIA_TYPES.get(path.suffix, "application/octet-stream")
    ctx.exports.hold(path.parent)
    return FileResponse(path, media_type=media, filename=name, background=BackgroundTask(ctx.exports.release, path.parent))


