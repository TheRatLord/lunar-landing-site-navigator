"""Scenario documents: SQLite-backed storage of validated `lunarnav.scenario.models.Scenario` JSON.

Reading, listing and deleting work without the scenario module; creating or updating validates the document
with it and returns 503 while the module cannot be imported.
"""

from __future__ import annotations

import asyncio
import importlib
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Path, Query
from pydantic import ValidationError

from lunarnav.api.context import ServiceContext, get_ctx
from lunarnav.api.docstore import NotFound, Record, Summary, VersionConflict
from lunarnav.api.errors import PROBLEM_RESPONSES, ApiProblem
from lunarnav.api.schemas import (
    SCENARIO_ID_PATTERN,
    RevisionInfo,
    ScenarioCreate,
    ScenarioPage,
    ScenarioRecord,
    ScenarioSummary,
    ScenarioUpdate,
    ScenarioValidation,
)
from lunarnav.api.stack_choice import check_terrain_stores

KIND = "scenario"

router = APIRouter(
    prefix="/scenarios",
    tags=["scenarios"],
    responses={404: PROBLEM_RESPONSES[404], 409: PROBLEM_RESPONSES[409], 422: PROBLEM_RESPONSES[422],
               503: {"description": "The scenario module is not importable, so documents cannot be validated."}},
)
Ctx = Annotated[ServiceContext, Depends(get_ctx)]
ScenarioId = Annotated[str, Path(pattern=SCENARIO_ID_PATTERN, description="Stored scenario id, `scen-` and 12 hex digits.")]


def validate_document(document: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """Validate with `Scenario` (imported lazily); return ``(name, normalised JSON)``.

    Raises 503 if the module is unavailable and 422 with per-field errors if the document is invalid.
    """
    try:
        model = importlib.import_module("lunarnav.scenario.models").Scenario
    except (ImportError, AttributeError) as exc:
        raise ApiProblem(
            503,
            "Scenario module unavailable",
            f"lunarnav.scenario.models.Scenario cannot be imported ({type(exc).__name__}: {exc}); documents cannot be validated or stored yet.",
            kind="scenario-module-unavailable",
        ) from exc
    try:
        scenario = model.model_validate(document)
    except ValidationError as exc:
        errors = [{"loc": [str(p) for p in e["loc"]], "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
        raise ApiProblem(422, "Scenario document is invalid", f"{len(errors)} invalid field(s)", errors=errors) from exc
    body = scenario.model_dump(mode="json")
    name = body.get("name") if isinstance(body.get("name"), str) and body.get("name") else "Untitled scenario"
    return name, body


async def validate_stored(document: dict[str, Any], ctx: ServiceContext) -> tuple[str, dict[str, Any]]:
    """`validate_document` plus the terrain-stack check the analyses apply (`unknown_store`, `no_ground`), with the same
    field-level 422 (`loc` relative to the scenario). A stored scenario is never re-checked on read, so one whose store
    has since left the machine still loads; its analyses refuse it."""
    name, doc = validate_document(document)
    await asyncio.to_thread(check_terrain_stores, doc, "on", ctx.settings.data_dir, [])
    return name, doc


def _summary(s: Summary) -> ScenarioSummary:
    return ScenarioSummary(id=s.id, name=s.name, version=s.version, created_utc=s.created_utc, updated_utc=s.updated_utc)


def _record(r: Record) -> ScenarioRecord:
    return ScenarioRecord(**_summary(r).model_dump(), document=r.body)


def _not_found(exc: NotFound) -> ApiProblem:
    return ApiProblem(404, "Scenario not found", f"No scenario {exc.args[0]!r}.")


def _conflict(exc: VersionConflict) -> ApiProblem:
    return ApiProblem(
        409, "Version conflict",
        f"Scenario {exc.doc_id} is at version {exc.current}; your edit was based on version {exc.expected}. "
        "Fetch the current version, merge, and retry.",
        kind="version-conflict", current_version=exc.current, expected_version=exc.expected,
    )


@router.post("/validate", response_model=ScenarioValidation, summary="Validate a scenario document without storing it")
async def validate(body: ScenarioCreate, ctx: Ctx) -> ScenarioValidation:
    """200 with the normalised document, or 422 with the same `errors` list as create (`loc` relative to the
    `Scenario`). Nothing is stored. `terrain_stores` is checked against the installed stores as the analyses check it
    (`unknown_store`, `no_ground`)."""
    _, doc = await validate_stored(body.document, ctx)
    return ScenarioValidation(document=doc)


@router.post("", status_code=201, response_model=ScenarioRecord, summary="Create a scenario")
async def create(body: ScenarioCreate, ctx: Ctx) -> ScenarioRecord:
    """Validate (terrain stack included, as `/scenarios/validate`) and store a new scenario at version 1."""
    name, doc = await validate_stored(body.document, ctx)
    return _record(await asyncio.to_thread(ctx.docs.create, KIND, name, doc))


@router.get("", response_model=ScenarioPage, summary="List scenarios")
async def list_scenarios(
    ctx: Ctx,
    q: Annotated[str | None, Query(max_length=100, description="Substring of the scenario name.")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ScenarioPage:
    items, total = await asyncio.to_thread(ctx.docs.search, KIND, q, limit, offset)
    return ScenarioPage(total=total, items=[_summary(s) for s in items])


@router.get("/{scenario_id}", response_model=ScenarioRecord, summary="Read a scenario")
async def read(scenario_id: ScenarioId, ctx: Ctx) -> ScenarioRecord:
    try:
        return _record(await asyncio.to_thread(ctx.docs.get, scenario_id))
    except NotFound as exc:
        raise _not_found(exc) from exc


@router.put("/{scenario_id}", response_model=ScenarioRecord, summary="Update with an optimistic version check")
async def update(scenario_id: ScenarioId, body: ScenarioUpdate, ctx: Ctx) -> ScenarioRecord:
    """Replaces the document if the stored version equals `expected_version`; otherwise 409 with the current version."""
    name, doc = await validate_stored(body.document, ctx)
    try:
        return _record(await asyncio.to_thread(ctx.docs.update, scenario_id, body.expected_version, name, doc))
    except NotFound as exc:
        raise _not_found(exc) from exc
    except VersionConflict as exc:
        raise _conflict(exc) from exc


@router.delete("/{scenario_id}", status_code=204, summary="Delete a scenario and its history")
async def delete(
    scenario_id: ScenarioId,
    ctx: Ctx,
    expected_version: Annotated[int | None, Query(ge=1, description="Delete only if still at this version.")] = None,
) -> None:
    try:
        await asyncio.to_thread(ctx.docs.delete, scenario_id, expected_version)
    except NotFound as exc:
        raise _not_found(exc) from exc
    except VersionConflict as exc:
        raise _conflict(exc) from exc


@router.get("/{scenario_id}/revisions", response_model=list[RevisionInfo], summary="Revision history")
async def revisions(scenario_id: ScenarioId, ctx: Ctx) -> list[RevisionInfo]:
    """Every saved version, oldest first."""
    try:
        rows = await asyncio.to_thread(ctx.docs.revisions, scenario_id)
    except NotFound as exc:
        raise _not_found(exc) from exc
    return [RevisionInfo(version=r.version, name=r.name, saved_utc=r.saved_utc) for r in rows]


@router.get("/{scenario_id}/revisions/{version}", response_model=ScenarioRecord, summary="A past version")
async def revision(scenario_id: ScenarioId, version: int, ctx: Ctx) -> ScenarioRecord:
    try:
        return _record(await asyncio.to_thread(ctx.docs.revision, scenario_id, version))
    except NotFound as exc:
        raise _not_found(exc) from exc
