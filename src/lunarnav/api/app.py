"""Application factory: `create_app()` builds the FastAPI service."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

from lunarnav.api.agent_service import Resumer, Starter
from lunarnav.api.context import ServiceContext
from lunarnav.api.errors import install_handlers
from lunarnav.api.jobs import JOB_KINDS
from lunarnav.api.jobworker import KindSpec
from lunarnav.api.json import ORJSONResponse
from lunarnav.api.middleware import (
    BodyLimitMiddleware,
    CrossSiteGuardMiddleware,
    LoopbackHostMiddleware,
    RequestContextMiddleware,
    SelectiveGZip,
    configure_logging,
)
from lunarnav.api.openapi import install as install_openapi
from lunarnav.api.routes import agent, catalog, ephemeris, evidence, jobs, meta, scenarios, terrain
from lunarnav.api.settings import Settings

log = logging.getLogger("lunarnav.api")

API_PREFIX = "/api/v1"

DESCRIPTION = """\
Deterministic Sun, Earth and terrain-horizon geometry for lunar landing replanning.

**Single trusted operator.** The agent endpoints start a model that writes and runs Python on this machine;
the service binds to loopback only and refuses other addresses unless explicitly allowed.

**Conventions.** Times are ISO-8601 UTC with `Z` suffix (internal: TDB seconds past J2000, field suffix
`_tdb_s`). Latitude/longitude are planetocentric, east-positive degrees in the mean-Earth/polar-axis frame.
The reference surface is a sphere of radius 1 737 400 m; heights are relative to it. Azimuth is degrees
clockwise from local north; elevation is degrees above the plane perpendicular to the Moon-centre radial
through the observer. Directions are apparent (light time and stellar aberration). Units are in field names
(`_deg`, `_m`, `_km`, `_s`, `_utc`). Errors are `application/problem+json`.
"""

TAGS = [
    {"name": "meta", "description": "Versions, kernels, terrain stores, conventions."},
    {"name": "catalogue", "description": "Sourced sites, ground stations and lander profiles."},
    {"name": "ephemeris", "description": "Sun, Earth and station geometry; time conversion."},
    {"name": "jobs", "description": "Long computations with progress, cancellation and cached results."},
    {"name": "scenarios", "description": "Versioned scenario documents, profiles and presets."},
    {"name": "analyses", "description": "Evaluate, scan, slip, sensitivity, attribution, compare, horizon and exports (cached jobs)."},
    {"name": "agent", "description": "Claude analysis agent runs (single trusted operator)."},
    {"name": "evidence", "description": "Validation reports and research documents."},
]


class SpaStaticFiles(StaticFiles):
    """Static files with index.html fallback for client-side routes; never shadows the API."""

    async def get_response(self, path: str, scope: Scope):  # type: ignore[override]
        if scope["path"].startswith("/api/"):
            raise HTTPException(404)
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code == 404 and "." not in Path(path).name:
                return await super().get_response("index.html", scope)
            raise


def create_app(
    settings: Settings | None = None,
    *,
    agent_start: Starter | None = None,
    agent_resume: Resumer | None = None,
    job_kinds: dict[str, KindSpec] | None = None,
) -> FastAPI:
    """Build the service. `settings` default to the environment; the other arguments exist for tests and
    for embedding (custom agent session factories, extra job kinds)."""
    settings = settings or Settings.from_env()
    configure_logging()
    kinds = {**JOB_KINDS, **(job_kinds or {})}

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        async with ServiceContext.running(settings, kinds, agent_start, agent_resume) as ctx:
            app.state.ctx = ctx
            log.info("service ready", extra={"host": settings.host, "port": settings.port})
            yield

    app = FastAPI(
        title="Moonwalkr service",
        version=meta.SERVICE_VERSION,
        description=DESCRIPTION,
        openapi_tags=TAGS,
        default_response_class=ORJSONResponse,
        lifespan=lifespan,
        openapi_url=f"{API_PREFIX}/openapi.json",
        docs_url=f"{API_PREFIX}/docs",
        redoc_url=None,
    )
    install_handlers(app)
    install_openapi(app)
    routers = [meta, catalog, ephemeris, jobs, scenarios, agent, evidence, terrain]
    try:
        from lunarnav.api.routes import analysis, profiles

        routers += [profiles, analysis]
    except ImportError:
        log.exception("scenario routers disabled: lunarnav.scenario cannot be imported")
    for module in routers:
        app.include_router(module.router, prefix=API_PREFIX)

    app.add_middleware(SelectiveGZip, minimum_size=1024)
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.cors_origins),
            allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
            allow_headers=["*"],
            expose_headers=["X-Request-ID", "X-Artifact-SHA256", "X-Artifact-Version"],
        )
    app.add_middleware(
        CrossSiteGuardMiddleware, allowed_origins=settings.cors_origins, trust_host=not settings.allow_remote
    )
    app.add_middleware(BodyLimitMiddleware, limit=settings.max_body_bytes)
    if not settings.allow_remote:
        app.add_middleware(LoopbackHostMiddleware)
    app.add_middleware(RequestContextMiddleware)

    dist = settings.web_dist
    if dist is not None and (dist / "index.html").is_file():
        app.mount("/", SpaStaticFiles(directory=dist, html=True), name="web")
    return app
