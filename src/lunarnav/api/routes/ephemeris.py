"""Ephemeris endpoints: Sun, Earth and station tracks, sub-points, time conversion.

Short requests run inline on the single engine thread; a request that would return more than
``inline_max_points`` samples must be submitted as a job (``.../jobs``), which runs in the process pool
with progress, cancellation and the disk result cache.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from lunarnav.api.compute import ephem
from lunarnav.api.context import ServiceContext, demo_request, get_ctx
from lunarnav.api.errors import PROBLEM_RESPONSES, ApiProblem
from lunarnav.api.json import ORJSONResponse
from lunarnav.api.schemas import JobStatus
from lunarnav.api.schemas_ephem import (
    SubpointsRequest,
    SubpointsResponse,
    TimeConvertRequest,
    TimeConvertResponse,
    TracksRequest,
    TracksResponse,
)

router = APIRouter(tags=["ephemeris"], responses={422: PROBLEM_RESPONSES[422], 413: {"description": "Too many samples for an inline request."}})

async def _engine(ctx: ServiceContext, fn: Callable[..., Any], *args: Any) -> Any:
    try:
        return await ctx.engine.run(fn, *args)
    except ephem.RequestError as exc:
        raise ApiProblem(422, "Request cannot be served", str(exc), kind="unserviceable") from exc


def _plan(req: dict[str, Any], limit: int, title: str, advice: str) -> None:
    try:
        n = ephem.plan_epochs(req["start_utc"], req["end_utc"], req["step_s"], req["max_points"])[2]
    except ValueError as exc:
        raise ephem.RequestError(str(exc)) from exc
    if n > limit:
        raise ApiProblem(413, title, f"{n} samples exceed the limit of {limit}{advice}", kind="too-large")


def _inline(compute: Callable[[dict[str, Any]], dict[str, Any]], req: dict[str, Any], limit: int, jobs_path: str) -> dict[str, Any]:
    _plan(req, limit, "Too many samples for an inline request",
          f". Set max_points lower or POST the same body to {jobs_path} to run it as a job.")
    return compute(req)


async def _run_inline(ctx: ServiceContext, compute: Callable[[dict[str, Any]], dict[str, Any]], body: BaseModel, jobs_path: str) -> ORJSONResponse:
    return ORJSONResponse(await _engine(ctx, _inline, compute, body.model_dump(mode="json"), ctx.settings.inline_max_points, jobs_path))


async def _submit(ctx: ServiceContext, kind: str, body: BaseModel, demo: bool) -> JobStatus:
    req = body.model_dump(mode="json")
    await _engine(ctx, _plan, req, ctx.settings.job_max_points, "Too many samples", ". Shorten the time range or increase step_s.")
    return JobStatus(**ctx.jobs.submit(kind, req, demo=demo).status())


@router.post(
    "/ephemeris/tracks",
    summary="Sun, Earth and station tracks for a site",
    response_class=ORJSONResponse,
    responses={200: {"model": TracksResponse}},
)
async def tracks(body: TracksRequest, ctx: Annotated[ServiceContext, Depends(get_ctx)]) -> ORJSONResponse:
    """Apparent azimuth, elevation, range and angular radius of the Sun and Earth, and of selected ground
    stations, from a site on the smooth reference sphere (no terrain horizon), sampled over a UTC range.

    Azimuth is clockwise from local north; elevation is above the plane perpendicular to the Moon-centre
    radial through the observer. `max_points` thins the series by an integer step multiple; null returns
    every sample (subject to the inline limit)."""
    return await _run_inline(ctx, ephem.tracks, body, "/api/v1/ephemeris/tracks/jobs")


@router.post("/ephemeris/tracks/jobs", status_code=202, response_model=JobStatus, summary="Submit a tracks computation as a job")
async def tracks_job(body: TracksRequest, ctx: Annotated[ServiceContext, Depends(get_ctx)], demo: Annotated[bool, Depends(demo_request)]) -> JobStatus:
    """Same body and result as `/ephemeris/tracks`, for large series. Identical requests return the cached
    result at once (``cached: true``) or join the job already running."""
    return await _submit(ctx, "ephemeris.tracks", body, demo)


@router.post(
    "/ephemeris/subpoints",
    summary="Sub-solar and sub-Earth points",
    response_class=ORJSONResponse,
    responses={200: {"model": SubpointsResponse}},
)
async def subpoints(body: SubpointsRequest, ctx: Annotated[ServiceContext, Depends(get_ctx)]) -> ORJSONResponse:
    """Planetocentric latitude and east longitude of the sub-solar and sub-Earth points (ME frame)."""
    return await _run_inline(ctx, ephem.subpoints, body, "/api/v1/ephemeris/subpoints/jobs")


@router.post("/ephemeris/subpoints/jobs", status_code=202, response_model=JobStatus, summary="Submit a sub-point computation as a job")
async def subpoints_job(body: SubpointsRequest, ctx: Annotated[ServiceContext, Depends(get_ctx)], demo: Annotated[bool, Depends(demo_request)]) -> JobStatus:
    return await _submit(ctx, "ephemeris.subpoints", body, demo)


@router.post("/time/convert", response_model=TimeConvertResponse, summary="UTC <-> ET (TDB seconds past J2000)")
async def convert_time(body: TimeConvertRequest, ctx: Annotated[ServiceContext, Depends(get_ctx)]) -> ORJSONResponse:
    """Convert UTC instants to ET or ET to UTC using the pinned leap-second kernel."""
    return ORJSONResponse(await _engine(ctx, ephem.convert_time, body.model_dump(mode="json")))
