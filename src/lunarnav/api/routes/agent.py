"""Agent endpoints: runs, messages, live event stream, ledgers, artefacts, instructions.

Single-trusted-operator surface: a run executes model-written Python on this machine.
"""

from __future__ import annotations

import asyncio
import hmac
from typing import Annotated, Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import Response, StreamingResponse
from sse_starlette import EventSourceResponse

from lunarnav.agent.events import event_schema
from lunarnav.api.agent_service import INLINE_TYPES, artifact_media_type, frame, owner_id
from lunarnav.api.context import ServiceContext, get_ctx
from lunarnav.api.errors import PROBLEM_RESPONSES, ApiProblem
from lunarnav.api.routes.jobs import last_event_id
from lunarnav.api.schemas import (
    AccessCode,
    AccessState,
    AssumptionItem,
    AssumptionList,
    InboxEntry,
    InboxList,
    Instructions,
    LedgerList,
    LedgerResult,
    MessageCreate,
    RunCreate,
    RunMeta,
    SignoffRequest,
)


def _require_enabled(ctx: Annotated[ServiceContext, Depends(get_ctx)]) -> None:
    if not ctx.settings.agent_enabled:
        raise ApiProblem(404, "Agent disabled", "The analysis agent is turned off on this server (LUNARNAV_API_AGENT_ENABLED).")


CODE_COOKIE = "lunarnav_agent_code"
CODE_COOKIE_MAX_AGE_S = 30 * 24 * 3600
CODE_COOKIE_PATH = "/api/v1/agent"


def _known_code(given: str | None, codes: tuple[str, ...]) -> bool:
    if not given:
        return False
    given_bytes = given.encode()
    return any(hmac.compare_digest(given_bytes, code.encode()) for code in codes)


def _owner(request: Request, ctx: Annotated[ServiceContext, Depends(get_ctx)]) -> str | None:
    codes = ctx.settings.agent_codes
    if not codes:
        return None
    given = request.cookies.get(CODE_COOKIE)
    if not _known_code(given, codes):
        raise ApiProblem(401, "Access code needed", "Enter your access code to use the assistant.", kind="code-required")
    assert given is not None
    owner = owner_id(given)
    run_id = request.path_params.get("run_id")
    if run_id is not None:
        ctx.agents.check_owner(run_id, owner)
    return owner


router = APIRouter(
    prefix="/agent", tags=["agent"], responses={404: PROBLEM_RESPONSES[404], 409: PROBLEM_RESPONSES[409]},
    dependencies=[Depends(_require_enabled)],
)
gated = APIRouter(responses={401: {"description": "Access code missing or not recognised."}}, dependencies=[Depends(_owner)])
Ctx = Annotated[ServiceContext, Depends(get_ctx)]
Owner = Annotated[str | None, Depends(_owner)]


def _access_state(request: Request, ctx: ServiceContext, granted: bool | None = None) -> AccessState:
    codes = ctx.settings.agent_codes
    if granted is None:
        granted = not codes or _known_code(request.cookies.get(CODE_COOKIE), codes)
    return AccessState(required=bool(codes), granted=granted)


@router.get("/access", response_model=AccessState, summary="Whether this browser may use the agent")
async def access(request: Request, ctx: Ctx) -> AccessState:
    return _access_state(request, ctx)


@router.post("/access", response_model=AccessState, summary="Unlock the agent with an access code",
             responses={403: {"description": "The code is not recognised."}, 429: {"description": "Too many wrong codes in the last minute."}})
async def unlock(body: AccessCode, request: Request, response: Response, ctx: Ctx) -> AccessState:
    code = body.code.strip()
    if ctx.settings.agent_codes:
        ctx.agents.check_code_rate()
        if not _known_code(code, ctx.settings.agent_codes):
            ctx.agents.note_code_failure()
            raise ApiProblem(403, "Code not recognised", "Check the access code and try again.", kind="code-wrong")
    https = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    response.set_cookie(CODE_COOKIE, code, max_age=CODE_COOKIE_MAX_AGE_S, path=CODE_COOKIE_PATH,
                        httponly=True, secure=https, samesite="strict")
    return _access_state(request, ctx, granted=True)


@router.delete("/access", response_model=AccessState, summary="Forget this browser's access code")
async def lock(request: Request, response: Response, ctx: Ctx) -> AccessState:
    response.delete_cookie(CODE_COOKIE, path=CODE_COOKIE_PATH)
    return _access_state(request, ctx, granted=not ctx.settings.agent_codes)


@gated.get("/instructions", response_model=Instructions, summary="What the agent is told and allowed")
async def instructions(ctx: Ctx) -> Instructions:
    """Full system prompt with its SHA-256, the tool list with input schemas, the permission policy summary,
    sandbox status and the default model."""
    return Instructions(**await asyncio.to_thread(ctx.agents.instructions))


@gated.get("/event-schema", summary="JSON Schema of the event union")
async def schema() -> dict:
    """Schema of every event the stream can carry (discriminated by `type`)."""
    return event_schema()


@gated.post("/runs", status_code=201, response_model=RunMeta, summary="Start a run")
async def start_run(body: RunCreate, ctx: Ctx, owner: Owner) -> RunMeta:
    """Create a run, connect its session and start the first turn in the background. Follow it with
    `GET /agent/runs/{run_id}/events`. 503 if the harness cannot start (e.g. the required sandbox is
    unavailable); 429 if too many runs are busy."""
    return RunMeta(**await ctx.agents.start_run(body.prompt, body.model, body.budget_usd, owner))


@gated.get("/runs", response_model=list[RunMeta], summary="Runs, newest first")
async def list_runs(ctx: Ctx, owner: Owner) -> list[RunMeta]:
    return [RunMeta(**m) for m in await asyncio.to_thread(ctx.agents.list_runs, owner)]


@gated.get("/runs/{run_id}", response_model=RunMeta, summary="Run metadata")
async def get_run(run_id: str, ctx: Ctx) -> RunMeta:
    """State, model, turns, cost and the sandbox status recorded at the latest run start."""
    return RunMeta(**await asyncio.to_thread(ctx.agents.metadata, run_id, with_sandbox=True))


@gated.post("/runs/{run_id}/messages", status_code=202, response_model=RunMeta, summary="Follow-up turn")
async def send_message(run_id: str, body: MessageCreate, ctx: Ctx) -> RunMeta:
    """Start a follow-up turn; a past run is resumed from disk if its session is not live. 409 while a turn runs."""
    return RunMeta(**await ctx.agents.send_message(run_id, body.prompt))


@gated.post("/runs/{run_id}/interrupt", response_model=RunMeta, summary="Interrupt the running turn")
async def interrupt(run_id: str, ctx: Ctx) -> RunMeta:
    return RunMeta(**await ctx.agents.interrupt(run_id))


@gated.post("/runs/{run_id}/close", response_model=RunMeta, summary="Close the live session")
async def close_run(run_id: str, ctx: Ctx) -> RunMeta:
    """Disconnect the run's session (the run stays on disk and a later message resumes it)."""
    return RunMeta(**await ctx.agents.close_run(run_id))


@gated.get(
    "/runs/{run_id}/events",
    summary="Typed event stream (server-sent events)",
    response_class=Response,
    responses={200: {"content": {"text/event-stream": {}}, "description": "Frames `id: <seq>`, `event: <type>`, `data: <event JSON>`; schema at /agent/event-schema."}},
)
async def events(
    run_id: str,
    ctx: Ctx,
    last_event_id_header: Annotated[str | None, Header(alias="Last-Event-ID")] = None,
    after_seq: Annotated[int | None, Query(ge=-1, description="Replay only events with a larger seq.")] = None,
    follow: Annotated[bool, Query(description="Keep the stream open for later events (default). False: replay and end.")] = True,
    stop_on: Annotated[Literal["none", "turn_end", "run_end"], Query(description="End the stream after the first event of this type.")] = "none",
) -> EventSourceResponse:
    """Replays the persisted transcript (`seq > Last-Event-ID` or `after_seq`) and then joins the live stream,
    which also carries `text_delta` / `reasoning_delta` (live only, never replayed). The stream stays open across
    turns; keep-alive comments are sent periodically."""
    ctx.agents.paths(run_id)
    ctx.agents.check_stream_capacity(run_id)
    cursor = last_event_id(last_event_id_header, after_seq)

    async def frames():
        async for event in ctx.agents.events(run_id, cursor, follow=follow, stop_on=stop_on):
            yield frame(event)

    return EventSourceResponse(frames(), ping=ctx.settings.sse_ping_s, sep="\n")


@gated.get("/runs/{run_id}/ledger", response_model=LedgerList, summary="Provenance ledger")
async def ledger(run_id: str, ctx: Ctx) -> LedgerList:
    """One entry per engine-tool call, with the hash-chain verification result."""
    return LedgerList(**await asyncio.to_thread(ctx.agents.ledger, run_id, "ledger"))


@gated.get(
    "/runs/{run_id}/ledger/{ledger_id}/result", response_model=LedgerResult,
    summary="The full stored result of a ledger entry (for showing a cited row)",
)
async def ledger_entry_result(
    run_id: str, ledger_id: str, ctx: Ctx,
    row_id: Annotated[str | None, Query(max_length=300, description="Return only this declared row (an id of `row_ids`); needed when the output is larger than `limit_bytes`.")] = None,
) -> LedgerResult:
    """What the tool returned, read from the run's own state and checked against the hash the ledger recorded (404 when it is missing or altered).
    Results of at most `limit_bytes` come whole in `output`; larger ones as `skeleton` (declared row lists replaced by null) plus any row by `row_id`."""
    return LedgerResult(**await asyncio.to_thread(ctx.agents.ledger_result, run_id, ledger_id, row_id))


@gated.get("/runs/{run_id}/assumptions", response_model=AssumptionList, summary="Assumptions with sign-off status")
async def assumptions(run_id: str, ctx: Ctx) -> AssumptionList:
    """Every assumption the run recorded with its status (`pending`, `accepted`, `rejected`, `not_required`), the
    decisions made and the engine calls that used it, plus the hash-chain check of the ledger."""
    return AssumptionList(**await asyncio.to_thread(ctx.agents.assumptions, run_id))


@gated.post(
    "/runs/{run_id}/assumptions/{assumption_id}/signoff", response_model=AssumptionItem,
    summary="Accept or reject an assumption",
    responses={422: PROBLEM_RESPONSES[422]},
)
async def signoff(run_id: str, assumption_id: str, body: SignoffRequest, ctx: Ctx) -> AssumptionItem:
    """Records who decided, when and why (`who` and `note` are required). Works on live and closed runs and
    emits an `assumption_signoff` event. A rejected assumption blocks reuse by engine tools and is flagged by the
    answer guard; the latest decision wins."""
    return AssumptionItem(**ctx.agents.signoff(run_id, assumption_id, body.decision, body.who, body.note))


@gated.get("/runs/{run_id}/inbox", response_model=InboxList, summary="Files the user placed in the run inbox")
async def inbox(run_id: str, ctx: Ctx) -> InboxList:
    return InboxList(**await asyncio.to_thread(ctx.agents.inbox, run_id))


@gated.post(
    "/runs/{run_id}/inbox", status_code=201, response_model=InboxEntry, summary="Upload a file to the run inbox",
    openapi_extra={"requestBody": {"required": True, "content": {"application/octet-stream": {
        "schema": {"type": "string", "format": "binary"}}}}},
    responses={413: {"description": "File larger than the inbox limit (1 GiB) or the run's inbox total."}, 415: {"description": "Not `application/octet-stream`."},
               422: PROBLEM_RESPONSES[422]},
)
async def upload_inbox(
    run_id: str, request: Request, ctx: Ctx,
    filename: Annotated[str, Query(min_length=1, max_length=200, description="Name to store (sanitised; the extension must be on the allowlist).")],
) -> InboxEntry:
    """Raw request body (`Content-Type: application/octet-stream`, `fetch(url, {method: "POST", body: file})`),
    streamed to disk in chunks. Allowed extensions: `.txt .md .csv .json .oem .xml .tif .tiff .pdf .bsp`; the
    content must look like its extension. An identical file is stored once; a different file with the same name
    gets `-2`, `-3`. Emits an `inbox_file` event. Any other `Content-Type` is `415`: a form or `text/plain` post is what a
    foreign web page can send without a preflight."""
    if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/octet-stream":
        raise ApiProblem(415, "Unsupported media type", "Send the file as the raw body with `Content-Type: application/octet-stream`.")
    size = request.headers.get("content-length")
    entry = await ctx.agents.upload(run_id, filename, int(size) if size and size.isdigit() else None, request.stream())
    return InboxEntry(**entry, source_name=filename)


@gated.get("/runs/{run_id}/artifacts", response_model=LedgerList, summary="Registered artefacts (all versions)")
async def artifacts(run_id: str, ctx: Ctx) -> LedgerList:
    return LedgerList(**await asyncio.to_thread(ctx.agents.ledger, run_id, "artifacts"))


@gated.get(
    "/runs/{run_id}/artifacts/{artifact_id}/content",
    summary="Download a registered artefact",
    response_class=Response,
    responses={200: {"content": {"*/*": {}}}},
)
async def artifact_content(
    run_id: str,
    artifact_id: str,
    ctx: Ctx,
    version: Annotated[int | None, Query(ge=1, description="Version; default the latest.")] = None,
) -> StreamingResponse:
    """Serves the file only if it is in the run's artefact ledger and still matches its recorded SHA-256 (else 409).
    Active content (HTML, SVG, scripts) is sent as an attachment with a sandboxing CSP."""
    handle, entry, name, size = await asyncio.to_thread(ctx.agents.open_artifact, run_id, artifact_id, version)
    media = artifact_media_type(entry, name)
    disposition = "inline" if media in INLINE_TYPES else "attachment"
    headers = {
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Artifact-SHA256": entry["sha256"],
        "X-Artifact-Version": str(entry["version"]),
        "Content-Length": str(size),
        "Content-Disposition": f"{disposition}; filename*=utf-8''{quote(name)}",
    }

    def body():
        with handle:
            while block := handle.read(1 << 20):
                yield block

    return StreamingResponse(body(), media_type=media, headers=headers)


router.include_router(gated)
