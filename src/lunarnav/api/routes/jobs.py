"""Job endpoints: status, event stream, cancel, result."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import Response
from sse_starlette import EventSourceResponse

from lunarnav.api.context import ServiceContext, get_ctx
from lunarnav.api.errors import PROBLEM_RESPONSES
from lunarnav.api.schemas import CancelReply, JobStatus
from lunarnav.api.schemas_results import JobResult

router = APIRouter(tags=["jobs"], responses={404: PROBLEM_RESPONSES[404]})


def last_event_id(header: str | None, query: int | None) -> int:
    """Resume point: the `Last-Event-ID` header wins over the `after_id` query; malformed means from the start."""
    if header is not None:
        try:
            return int(header)
        except ValueError:
            return -1
    return -1 if query is None else query


@router.get("/jobs", response_model=list[JobStatus], summary="Known jobs, newest first")
async def list_jobs(ctx: Annotated[ServiceContext, Depends(get_ctx)]) -> list[JobStatus]:
    """Jobs still in memory (bounded history); results of older jobs stay fetchable through resubmission."""
    return [JobStatus(**j.status()) for j in ctx.jobs.list()]


@router.get("/jobs/{job_id}", response_model=JobStatus, summary="Job status")
async def get_job(job_id: str, ctx: Annotated[ServiceContext, Depends(get_ctx)]) -> JobStatus:
    return JobStatus(**ctx.jobs.get(job_id).status())


@router.get(
    "/jobs/{job_id}/events",
    summary="Job progress as server-sent events",
    response_class=Response,
    responses={200: {"content": {"text/event-stream": {}}, "description": "Events `status` (payload: JobStatus); the stream ends after the terminal state."}},
)
async def job_events(
    job_id: str,
    ctx: Annotated[ServiceContext, Depends(get_ctx)],
    last_event_id_header: Annotated[str | None, Header(alias="Last-Event-ID")] = None,
    after_id: Annotated[int | None, Query(ge=-1, description="Replay events with a larger id (alternative to Last-Event-ID).")] = None,
) -> EventSourceResponse:
    """Every event is ``event: status`` with a `JobStatus` JSON payload and ``id`` = a per-job counter. A client
    that reconnects with ``Last-Event-ID`` receives the retained events after it, then follows live."""
    job = ctx.jobs.get(job_id)
    cursor = last_event_id(last_event_id_header, after_id)

    async def frames():
        async for item in job.log.stream(cursor):
            yield item.frame()

    return EventSourceResponse(frames(), ping=ctx.settings.sse_ping_s, sep="\n")


CANCEL_DETAIL = {
    "cancelled": "The queued job was cancelled.",
    "requested": "Cancellation requested: the job stops at its next progress report.",
    "already_finished": "The job had already ended; nothing to cancel.",
}


@router.post("/jobs/{job_id}/cancel", response_model=CancelReply, summary="Request cancellation")
async def cancel_job(
    job_id: str, ctx: Annotated[ServiceContext, Depends(get_ctx)],
    force: Annotated[bool, Query(description="Cancel for every request that wants this job, not only this one.")] = False,
) -> CancelReply:
    """Queued jobs stop at once; running jobs stop at their next progress report. Idempotent.

    An identical request that arrives while a job runs joins it (`holders`). A cancel from one of several holders only lets that
    one go: `effect` is `detached`, `still_wanted_by` says how many requests still want the job, and the job goes on. `force=true`
    cancels it for all of them."""
    job, effect = ctx.jobs.cancel(job_id, force=force)
    wanted = job.holders if effect == "detached" else 0
    detail = (f"Not cancelled: {wanted} other request{'s' if wanted != 1 else ''} still need{'' if wanted != 1 else 's'} this job. Cancel again to stop it, or use force=true."
              if effect == "detached" else CANCEL_DETAIL[effect])
    return CancelReply(**job.status(), effect=effect, still_wanted_by=wanted, detail=detail)


@router.get(
    "/jobs/{job_id}/result",
    summary="Result of a finished job",
    response_class=Response,
    responses={200: {"model": JobResult, "description": "Result body; its model depends on the job kind (see `JobResult`)."}, 409: PROBLEM_RESPONSES[409], 410: {"description": "Result pruned from the cache."}},
)
async def job_result(job_id: str, ctx: Annotated[ServiceContext, Depends(get_ctx)]) -> Response:
    """The JSON result exactly as the inline endpoint would have returned it."""
    return Response(ctx.jobs.result(job_id), media_type="application/json")
