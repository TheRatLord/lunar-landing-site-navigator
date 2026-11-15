"""Service metadata and health."""

from __future__ import annotations

import asyncio
import importlib
import importlib.util
import platform
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.responses import Response

from lunarnav.api.context import ServiceContext, get_ctx
from lunarnav.api.errors import ApiProblem
from lunarnav.api.limits import request_limits
from lunarnav.api.schemas import HealthResponse, MetaResponse, PoolState, RegionalValidationRecord
from lunarnav.api.stack_choice import listed_stores
from lunarnav.api.versions import code_version

SERVICE_VERSION = "1.0.0"

CONVENTIONS = {
    "time_boundary": "ISO-8601 UTC with Z suffix",
    "time_internal": "TDB seconds past J2000 (SPICE ET), float64",
    "body_fixed_frame": "Mean Earth/polar axis (ME), from the DE440 lunar orientation kernels",
    "lat_lon": "Planetocentric, east-positive, degrees, ME frame",
    "reference_surface": "Sphere, radius 1 737 400 m; heights relative to it",
    "local_frame": "East, North, Up; Up is the Moon-centre radial through the observer",
    "azimuth": "Degrees clockwise from local north (0 = N, 90 = E)",
    "elevation": "Degrees above the plane perpendicular to Up at the observer",
    "observer": "Terrain height at the site plus mast_height_m",
    "apparent_directions": "Light-time and stellar-aberration corrected, as received at the site",
    "angles": "Degrees, float64",
}
"""The normative conventions."""

router = APIRouter(tags=["meta"])


def _module_has(name: str, attr: str | None = None) -> bool:
    try:
        module = importlib.import_module(name)
    except ImportError:
        return False
    return attr is None or hasattr(module, attr)


def kernel_description() -> dict[str, Any]:
    """Load the kernels (engine thread only) and describe them; failures are reported, not raised."""
    from lunarnav.ephem import et_to_utc, load_kernels

    try:
        ks = load_kernels()
    except Exception as exc:  # noqa: BLE001
        return {"available": False, "error": f"{type(exc).__name__}: {exc}", "valid_utc": None, "files": []}
    return {
        "available": True,
        "error": None,
        "valid_utc": (et_to_utc(ks.valid_et[0], 0), et_to_utc(ks.valid_et[1], 0)),
        "files": [
            {"name": f.name, "sha256": f.sha256, "size_bytes": f.size_bytes, "role": f.role, "url": f.url,
             "coverage_utc": f.coverage_utc}
            for f in ks.files
        ],
    }


@router.get("/meta", response_model=MetaResponse, summary="Service, kernel and data versions")
async def meta(ctx: Annotated[ServiceContext, Depends(get_ctx)]) -> MetaResponse:
    """Versions, the pinned SPICE kernel set (names, SHA-256, coverage), available terrain stores, the job
    kinds and request limits, and the normative conventions every endpoint follows."""
    if "kernels" not in ctx.cache:
        ctx.cache["kernels"] = await ctx.engine.run(kernel_description)
    horizon = _module_has("lunarnav.horizon", "compute_horizon")
    scenario = importlib.util.find_spec("lunarnav.scenario") is not None and _module_has("lunarnav.scenario.models", "Scenario")
    return MetaResponse(
        service_version=SERVICE_VERSION,
        code_version=code_version(),
        python_version=platform.python_version(),
        kernels=ctx.cache["kernels"],
        terrain_stores=await asyncio.to_thread(listed_stores, ctx.settings.data_dir),
        horizon_module_available=horizon,
        scenario_module_available=scenario,
        agent_enabled=ctx.settings.agent_enabled,
        job_kinds={k: v.version for k, v in ctx.jobs.kinds.items()},
        limits=request_limits(ctx.settings.inline_max_points, ctx.settings.job_max_points),
        conventions=CONVENTIONS,
    )


REGIONAL_VALIDATION_DOCUMENT = "docs/validation/illumination.md section 7"


def regional_validation_record() -> dict[str, Any] | None:
    """The regional layers' validation record as the package ships it, with each layer's class from `lunarnav.regional.support`."""
    from lunarnav.regional.support import LAYER_SUPPORT, reference

    ref = reference()
    if ref is None:
        return None
    layers = [
        {"layer": name, "point_value": LAYER_SUPPORT[name]["point_value"], "unit": LAYER_SUPPORT[name]["unit"],
         "error_unit": LAYER_SUPPORT[name]["error_unit"], "bracket_coverage": rec["bracket_coverage"], "measured_error": rec["measured_error"]}
        for name, rec in ref["layers"].items()]
    return {"document": REGIONAL_VALIDATION_DOCUMENT, "measured_by": ref["measured_by"], "configuration": ref["configuration"], "layers": layers}


@router.get("/meta/regional-validation", response_model=RegionalValidationRecord, summary="Measured accuracy of the regional layers",
            responses={404: {"description": "The package ships no validation record."}})
async def regional_validation(ctx: Annotated[ServiceContext, Depends(get_ctx)]) -> RegionalValidationRecord:
    """The error of each regional layer against the exact engine (mean, p95, p99, maximum, bracket coverage, cell counts) and its
    class (`supported`, `approximate`, `bracket_only`), straight from the record the package ships. Interfaces quote this record
    instead of holding figures of their own."""
    if "regional_validation" not in ctx.cache:
        ctx.cache["regional_validation"] = await asyncio.to_thread(regional_validation_record)
    record = ctx.cache["regional_validation"]
    if record is None:
        raise ApiProblem(404, "No validation record", "This installation has no regional validation record.")
    return RegionalValidationRecord(**record)


@router.get("/health", response_model=HealthResponse, summary="Liveness and warm-up state")
async def health(ctx: Annotated[ServiceContext, Depends(get_ctx)]) -> HealthResponse:
    """Answers at once whenever the process is up (`status: ok`). `warm` says whether the compute pool has
    finished its background warm-up (imports, kernels, compiled numerical code): jobs submitted before that
    work but the first ones are slow. Never touches the engine."""
    return HealthResponse(status="ok", **_pool_state(ctx))


@router.get("/ready", response_model=HealthResponse, summary="Readiness probe (503 until the pool is warm)",
            responses={503: {"model": HealthResponse, "description": "Up but still warming."}})
async def ready(ctx: Annotated[ServiceContext, Depends(get_ctx)]) -> Response:
    body = HealthResponse(status="ok", **_pool_state(ctx))
    return Response(body.model_dump_json(), status_code=200 if body.warm else 503, media_type="application/json")


def _pool_state(ctx: ServiceContext) -> dict[str, Any]:
    w = ctx.jobs.warm_status
    return {"warm": w["state"] in ("ready", "disabled"), "pool": PoolState(**w)}
