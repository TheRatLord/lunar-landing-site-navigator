"""Pure-ASGI middleware: request ids, structured access log, loopback Host check.

Pure ASGI (not ``BaseHTTPMiddleware``) so server-sent-event streams are never buffered.
"""

from __future__ import annotations

import json
import logging
import re
import time
import uuid

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

log = logging.getLogger("lunarnav.api.access")
_RID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


class JsonFormatter(logging.Formatter):
    """One JSON object per log line; extra fields passed via ``extra=`` are included."""

    _SKIP = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {"message", "asctime"}

    def format(self, record: logging.LogRecord) -> str:
        out = {"ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"), "level": record.levelname,
               "logger": record.name, "msg": record.getMessage()}
        out.update({k: v for k, v in record.__dict__.items() if k not in self._SKIP})
        if record.exc_info:
            out["exc"] = self.formatException(record.exc_info)
        return json.dumps(out, default=str)


def configure_logging(level: int = logging.INFO) -> None:
    """Install the JSON formatter on the ``lunarnav`` logger tree (idempotent)."""
    root = logging.getLogger("lunarnav")
    if any(getattr(h, "_lunarnav_json", False) for h in root.handlers):
        return
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    handler._lunarnav_json = True  # type: ignore[attr-defined]
    root.addHandler(handler)
    root.setLevel(level)
    root.propagate = False


class RequestContextMiddleware:
    """Assign ``request.state.request_id`` (honouring a sane inbound ``X-Request-ID``), echo it in the
    response, and log one access line per request."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        inbound = Headers(scope=scope).get("x-request-id", "")
        rid = inbound if _RID.match(inbound) else uuid.uuid4().hex[:16]
        scope.setdefault("state", {})["request_id"] = rid
        started = time.perf_counter()
        status = 500

        async def send_wrapper(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                MutableHeaders(scope=message)["X-Request-ID"] = rid
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            log.info(
                "request",
                extra={
                    "request_id": rid,
                    "method": scope["method"],
                    "path": scope["path"],
                    "status": status,
                    "ms": round((time.perf_counter() - started) * 1000, 2),
                },
            )


class LoopbackHostMiddleware:
    """Reject requests whose ``Host`` header is not a loopback name (DNS-rebinding defence)."""

    ALLOWED = {"localhost", "127.0.0.1", "[::1]", "::1"}

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in {"http", "websocket"}:
            host = Headers(scope=scope).get("host", "")
            name = host.rsplit(":", 1)[0] if not host.startswith("[") else host.split("]")[0] + "]"
            if name not in self.ALLOWED:
                headers, body = _problem(400, "Bad Request", f"Host {host!r} is not allowed; this service accepts loopback hosts only.", scope)
                await send({"type": "http.response.start", "status": 400, "headers": headers})
                await send({"type": "http.response.body", "body": body})
                return
        await self.app(scope, receive, send)


class BodyLimitMiddleware:
    """Refuse request bodies larger than `limit` bytes with 413 (declared by Content-Length or counted while streaming).

    Only the inbox upload (``POST /api/v1/agent/runs/{run_id}/inbox``, which has its own, larger limits) is exempt;
    no other path is, whatever it ends with."""

    UPLOAD_ROUTE = re.compile(r"^/api/v1/agent/runs/[^/]+/inbox$")

    def __init__(self, app: ASGIApp, limit: int) -> None:
        self.app = app
        self.limit = limit

    def exempt(self, scope: Scope) -> bool:
        """True for the upload route and nothing else."""
        return scope["method"] == "POST" and self.UPLOAD_ROUTE.match(scope["path"]) is not None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] not in UNSAFE_METHODS or self.exempt(scope):
            await self.app(scope, receive, send)
            return
        declared = Headers(scope=scope).get("content-length", "")
        if declared.isdigit() and int(declared) > self.limit:
            await self._refuse(scope, send)
            return
        total = 0
        exceeded = False
        started = False

        async def counting_receive() -> Message:
            nonlocal total, exceeded
            message = await receive()
            if message["type"] == "http.request":
                total += len(message.get("body", b""))
                if total > self.limit:
                    exceeded = True
                    return {"type": "http.disconnect"}
            return message

        async def guarded_send(message: Message) -> None:
            nonlocal started
            if exceeded:
                return
            started = started or message["type"] == "http.response.start"
            await send(message)

        try:
            await self.app(scope, counting_receive, guarded_send)
        except Exception:
            if not exceeded:
                raise
        if exceeded and not started:
            await self._refuse(scope, send)

    async def _refuse(self, scope: Scope, send: Send) -> None:
        headers, body = _problem(413, "Request body too large", f"JSON request bodies are limited to {self.limit} bytes.", scope)
        await send({"type": "http.response.start", "status": 413, "headers": headers})
        await send({"type": "http.response.body", "body": body})


UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def _problem(status: int, title: str, detail: str, scope: Scope) -> tuple[list[tuple[bytes, bytes]], bytes]:
    """A problem document (as `errors.Problem`, with the request id) for a refusal made before routing."""
    request_id = scope.get("state", {}).get("request_id")
    body = json.dumps({"type": "about:blank", "title": title, "status": status, "detail": detail, "request_id": request_id}).encode()
    return [(b"content-type", b"application/problem+json"), (b"content-length", str(len(body)).encode())], body


class CrossSiteGuardMiddleware:
    """Refuse state-changing requests that a foreign web page could be making (the service has no authentication).

    A POST, PUT, PATCH or DELETE is refused with 403 when it carries an ``Origin`` that is neither in the allowed list
    nor the service's own origin (the ``Host`` it was addressed to: the built interface, or the Vite dev proxy, which
    forwards ``Host`` and ``Origin`` unchanged; with ``allow_remote`` the ``Host`` is chosen by the caller and proves
    nothing, so only the listed origins pass), or when the browser says ``Sec-Fetch-Site: cross-site``. Requests
    without these headers (curl, scripts, the agent CLI) are not browser requests and pass. Reads are never refused here;
    cross-origin reads are stopped by CORS (no origins are allowed by default).
    """

    def __init__(self, app: ASGIApp, allowed_origins: tuple[str, ...] = (), trust_host: bool = True) -> None:
        self.app = app
        self.allowed = frozenset(o.strip().rstrip("/").lower() for o in allowed_origins)
        self.trust_host = trust_host

    def refusal(self, headers: Headers) -> str | None:
        """The reason this request is refused, or None."""
        origin = headers.get("origin")
        if origin is not None:
            norm = origin.strip().rstrip("/").lower()
            own = headers.get("host", "").lower()
            same = self.trust_host and bool(own) and norm in (f"http://{own}", f"https://{own}")
            if norm not in self.allowed and not same:
                return f"Origin {origin!r} is not allowed to change state on this service."
        if headers.get("sec-fetch-site", "").lower() == "cross-site":
            return "Cross-site requests may not change state on this service."
        return None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] in UNSAFE_METHODS:
            reason = self.refusal(Headers(scope=scope))
            if reason is not None:
                headers, body = _problem(403, "Forbidden", reason, scope)
                await send({"type": "http.response.start", "status": 403, "headers": headers})
                await send({"type": "http.response.body", "body": body})
                return
        await self.app(scope, receive, send)


class SelectiveGZip:
    """gzip for JSON and text responses; binary downloads (terrain tiles and patches, export files) are
    already compact or incompressible, so they pass through untouched."""

    SKIP_PREFIXES = ("/api/v1/terrain/", "/api/v1/exports/")

    def __init__(self, app, minimum_size: int = 1024, compresslevel: int = 5) -> None:
        from starlette.middleware.gzip import GZipMiddleware

        self.app = app
        self.gzip = GZipMiddleware(app, minimum_size=minimum_size, compresslevel=compresslevel)

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] == "http" and scope["path"].startswith(self.SKIP_PREFIXES):
            await self.app(scope, receive, send)
        else:
            await self.gzip(scope, receive, send)
