"""The published OpenAPI document: every error status an operation can return, described as the problem document.

Several errors do not come from an endpoint (validation, size and cross-site refusals, unexpected failures, a full
queue), so routes do not declare them one by one; this pass states them once, from the operations' shape:

- 422 is the problem document everywhere it is declared (FastAPI's default `HTTPValidationError` is never sent);
- every operation can end in 500; every state-changing one in 403 (cross-site) and 413 (body too large);
- an operation that can answer 202 with a job can also answer 429 (queue full) and 503 (service stopping).
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI

from lunarnav.api.errors import PROBLEM_MEDIA_TYPE

PROBLEM_REF = {"$ref": "#/components/schemas/Problem"}
UNSAFE = {"post", "put", "patch", "delete"}
DESCRIPTIONS = {
    403: "Refused: the request looks like a cross-site browser request.",
    413: "The request body is larger than the service accepts.",
    422: "Validation failed (the problem document lists each field).",
    429: "The job queue is full; retry later.",
    500: "Unexpected failure in the service.",
    503: "The service is stopping.",
}


def _problem(code: int, existing: dict[str, Any] | None = None) -> dict[str, Any]:
    response = dict(existing or {})
    response.setdefault("description", DESCRIPTIONS.get(code, "Error."))
    response["content"] = {PROBLEM_MEDIA_TYPE: {"schema": PROBLEM_REF}}
    return response


def normalise(schema: dict[str, Any]) -> dict[str, Any]:
    """Apply the rules above to an OpenAPI document, in place; idempotent."""
    for operations in schema.get("paths", {}).values():
        for method, op in operations.items():
            if method not in {"get", "put", "post", "delete", "patch"}:
                continue
            responses = op["responses"]
            wanted = {500}
            if method in UNSAFE:
                wanted |= {403, 413}
            if "202" in responses:
                wanted |= {429, 503}
            for code in wanted:
                responses.setdefault(str(code), {})
            for key in list(responses):
                code = int(key) if key.isdigit() else 0
                content = responses[key].get("content", {})
                described = any(v.get("schema") for v in content.values())
                if code == 422 or (code in DESCRIPTIONS and not described) or (code in (400, 410, 415) and not described):
                    responses[key] = _problem(code, responses[key])
    return schema


def install(app: FastAPI) -> None:
    """Make `app.openapi()` return the normalised document."""
    build = app.openapi

    def openapi() -> dict[str, Any]:
        return normalise(build())

    app.openapi = openapi  # type: ignore[method-assign]
