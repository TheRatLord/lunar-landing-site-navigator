"""Problem-details error model (RFC 9457) and the exception handlers that produce it."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from lunarnav.api.json import dumps

log = logging.getLogger("lunarnav.api")

PROBLEM_MEDIA_TYPE = "application/problem+json"
TYPE_BASE = "https://lunarnav.local/problems/"


class Problem(BaseModel):
    """Error body of every non-2xx response (``application/problem+json``)."""

    model_config = ConfigDict(extra="allow")

    type: str = Field(description="URI identifying the problem class.")
    title: str = Field(description="Short human-readable summary.")
    status: int = Field(description="HTTP status code.")
    detail: str | None = Field(default=None, description="Explanation specific to this occurrence.")
    request_id: str | None = Field(default=None, description="Value of the X-Request-ID header of the response.")
    errors: list[dict[str, Any]] | None = Field(
        default=None, description="Per-field validation failures (loc, msg, type)."
    )


class ApiProblem(Exception):
    """Raise from an endpoint to return a problem response with `status`."""

    def __init__(self, status: int, title: str, detail: str | None = None, *, kind: str = "about:blank", **extra: Any):
        super().__init__(f"{status} {title}: {detail}")
        self.status = status
        self.title = title
        self.detail = detail
        self.kind = kind if kind == "about:blank" else TYPE_BASE + kind
        self.extra = extra


PROBLEM_RESPONSES: dict[int | str, dict[str, Any]] = {
    400: {"model": Problem, "description": "Malformed request.", "content": {PROBLEM_MEDIA_TYPE: {}}},
    404: {"model": Problem, "description": "Not found.", "content": {PROBLEM_MEDIA_TYPE: {}}},
    409: {"model": Problem, "description": "Conflict.", "content": {PROBLEM_MEDIA_TYPE: {}}},
    422: {"model": Problem, "description": "Validation failed.", "content": {PROBLEM_MEDIA_TYPE: {}}},
}
"""Declare on routes via ``responses=`` so OpenAPI documents the error model."""


def _request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def problem_response(request: Request, status: int, title: str, detail: str | None = None, *,
                     kind: str = "about:blank", headers: dict[str, str] | None = None, **extra: Any) -> Response:
    """Build a problem+json response carrying the request id."""
    body = {"type": kind, "title": title, "status": status, "detail": detail, "request_id": _request_id(request)}
    body.update({k: v for k, v in extra.items() if v is not None})
    return Response(dumps(body), status_code=status, media_type=PROBLEM_MEDIA_TYPE, headers=headers)


def install_handlers(app: FastAPI) -> None:
    """Route every error path of `app` through the problem model."""

    @app.exception_handler(ApiProblem)
    async def _api_problem(request: Request, exc: ApiProblem) -> Response:
        return problem_response(request, exc.status, exc.title, exc.detail, kind=exc.kind, **exc.extra)

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException) -> Response:
        from http import HTTPStatus

        try:
            title = HTTPStatus(exc.status_code).phrase
        except ValueError:
            title = "Error"
        detail = exc.detail if isinstance(exc.detail, str) and exc.detail != title else None
        return problem_response(request, exc.status_code, title, detail, headers=getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> Response:
        errors = [
            {"loc": [str(p) for p in e["loc"]], "msg": e["msg"], "type": e["type"]} for e in exc.errors()
        ]
        return problem_response(
            request, 422, "Request validation failed", f"{len(errors)} invalid field(s)", errors=errors
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> Response:
        log.exception("unhandled error", extra={"request_id": _request_id(request)})
        return problem_response(request, 500, "Internal Server Error", type(exc).__name__)
