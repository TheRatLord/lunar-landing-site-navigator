"""Terrain: store catalogue, map tile pyramid, elevation patches and point lookups."""

from __future__ import annotations

import hashlib
import math
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response

from lunarnav.api import terrain_service as ts_mod
from lunarnav.api.context import ServiceContext, get_ctx
from lunarnav.api.errors import PROBLEM_RESPONSES, ApiProblem
from lunarnav.api.json import ORJSONResponse
from lunarnav.api.schemas_terrain import (
    PatchHeader,
    PointResult,
    PointsRequest,
    PointsResponse,
    StoreList,
    TilesetList,
)
from lunarnav.api.terrain_service import LAYERS, TILESETS

router = APIRouter(prefix="/terrain", tags=["terrain"], responses={404: PROBLEM_RESPONSES[404], 422: PROBLEM_RESPONSES[422]})

TILE_CACHE_CONTROL = "public, max-age=3600"
"""Tiles are immutable per stack hash + render version; the ETag changes when either does."""
PATCH_MAX_N = 1025
PNG_RESPONSE = {200: {"content": {"image/png": {}}, "description": "256x256 RGBA PNG tile."}}
PATCH_RESPONSE = {200: {"content": {"application/octet-stream": {}}, "description": "LNP1 binary patch."}}

Ctx = Annotated[ServiceContext, Depends(get_ctx)]


@router.get("/stores", response_model=StoreList, summary="Terrain stores")
async def list_stores(
    ctx: Ctx,
    source_label: Annotated[bool, Query(description=(
        "Include the raw PDS label of each store's source product (about 1.2 kB per store, the bulk of the payload "
        "besides footprints); the default keeps url, sha256 and notes."))] = False,
    footprint: Annotated[Literal["simple", "full", "none"], Query(description=(
        "`simple` (default): footprint polygon simplified to 0.05 deg, a few tens of vertices; `full`: the densified "
        "ring (about 250 vertices per store, ~9 kB each); `none`: no polygon (extent is in `bbox_map` and "
        "`lat_extent_deg`)."))] = "simple",
) -> ORJSONResponse:
    """Every store under `<data_dir>/dem/store` (rescanned on each call; new stores appear without restart)."""
    svc = ctx.terrain
    snap = svc.catalog.snapshot(0.0)
    stores = []
    for e in snap.entries:
        d = {k: v for k, v in e.summary.items() if k not in ("footprint", "footprint_simple")}
        if not source_label:
            d["source"] = {k: v for k, v in d["source"].items() if k != "label"}
        if footprint != "none":
            d["footprint"] = e.summary["footprint" if footprint == "full" else "footprint_simple"]
        stores.append(d)
    return ORJSONResponse({"stack_hash": snap.stack_hash, "stores": stores})


@router.get("/tilesets", response_model=TilesetList, summary="Tiling definitions")
async def list_tilesets() -> ORJSONResponse:
    """Authoritative tiling schemes, layer encodings and fixed colour scales."""
    return ORJSONResponse(ts_mod.tileset_definitions())


def _etag(*parts: object) -> str:
    return '"' + hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()[:32] + '"'


@router.get("/tiles/{tileset}/{layer}/{z}/{x}/{y}.png", summary="Map tile", response_class=Response,
            responses=PROBLEM_RESPONSES | PNG_RESPONSE)
async def get_tile(tileset: str, layer: str, z: int, x: int, y: int, request: Request, ctx: Ctx) -> Response:
    """256x256 PNG tile (XYZ, origin top-left). Fully empty tiles are a small transparent PNG, not an error."""
    ts = TILESETS.get(tileset)
    if ts is None:
        raise ApiProblem(404, "Unknown tileset", f"{tileset!r}; known: {', '.join(TILESETS)}")
    if layer not in LAYERS:
        raise ApiProblem(404, "Unknown layer", f"{layer!r}; known: {', '.join(LAYERS)}")
    if not 0 <= z <= ts.zoom_max:
        raise ApiProblem(404, "Zoom out of range", f"z must be 0..{ts.zoom_max} for {tileset}")
    w, h = ts.matrix(z)
    if not (0 <= x < w and 0 <= y < h):
        raise ApiProblem(404, "Tile out of range", f"at z={z}: x in 0..{w - 1}, y in 0..{h - 1}")
    svc = ctx.terrain
    snap = svc.catalog.snapshot(ts_mod.CATALOG_TTL_S)
    etag = _etag(snap.stack_hash, ts_mod.RENDER_VERSION, tileset, layer, z, x, y)
    headers = {"ETag": etag, "Cache-Control": TILE_CACHE_CONTROL}
    if etag in [t.strip() for t in request.headers.get("if-none-match", "").split(",")]:
        return Response(status_code=304, headers=headers)
    data, hit = await svc.tile(snap, ts, layer, z, x, y)
    headers["X-Tile-Cache"] = "hit" if hit else "miss"
    return Response(data, media_type="image/png", headers=headers)


def _check_latlon(lat: float, lon: float) -> None:
    if not (math.isfinite(lat) and math.isfinite(lon)):
        raise ApiProblem(422, "Invalid coordinates", "lat and lon must be finite")


@router.get("/point", response_model=PointResult, summary="Height and slope at a point")
async def get_point(
    ctx: Ctx,
    lat: Annotated[float, Query(ge=-90, le=90, description="Planetocentric latitude, degrees.")],
    lon: Annotated[float, Query(ge=-180, le=360, description="East-positive longitude, degrees (-180..360).")],
    baseline_m: Annotated[float, Query(gt=0, le=5000, description="Central-difference baseline, metres.")] = 20.0,
) -> ORJSONResponse:
    """Composite height, slope and downhill aspect from the finest store with data (nulls where none)."""
    _check_latlon(lat, lon)
    (res,) = await ctx.terrain.points([(lat, lon)], baseline_m)
    return ORJSONResponse(res)


@router.post("/points", response_model=PointsResponse, summary="Heights and slopes at up to 1000 points")
async def post_points(body: PointsRequest, ctx: Ctx) -> ORJSONResponse:
    pts = [(p.lat_deg, p.lon_deg) for p in body.points]
    return ORJSONResponse({"points": await ctx.terrain.points(pts, body.baseline_m)})


class _PatchQuery:
    def __init__(
        self,
        lat: Annotated[float, Query(ge=-90, le=90, description="Centre latitude, planetocentric degrees.")],
        lon: Annotated[float, Query(ge=-180, le=360, description="Centre longitude, east-positive degrees.")],
        size_m: Annotated[float, Query(ge=10, le=100_000, description="Full side width of the square, metres.")],
        n: Annotated[int, Query(ge=2, le=PATCH_MAX_N, description="Samples per side.")],
        include_source: Annotated[bool, Query(description="Append n*n uint8 source-store indices.")] = False,
    ) -> None:
        self.lat, self.lon, self.size_m, self.n, self.include_source = lat, lon, size_m, n, include_source
        _check_latlon(lat, lon)


@router.get("/patch", summary="Elevation patch (LNP1 binary)", response_class=Response,
            responses=PROBLEM_RESPONSES | PATCH_RESPONSE)
async def get_patch(q: Annotated[_PatchQuery, Depends()], ctx: Ctx) -> Response:
    """Square patch centred on the point on a local east/north tangent grid.

    Layout: `LNP1`, uint32le header length H, H bytes JSON header, zero padding to a multiple of 4
    (`data_offset`), n*n float32le heights (row 0 = north, column 0 = west, NaN = no data), then, if
    `include_source`, n*n uint8 indices into `header.sources` (255 = none).
    """
    blob, key, hit = await ctx.terrain.patch(q.lat, q.lon, q.size_m, q.n, q.include_source)
    assert isinstance(blob, bytes)
    head = ts_mod.parse_patch_header(blob[:65536] if len(blob) > 65536 else blob)
    headers = {
        "X-Patch-Sources": ",".join(s["id"] for s in head["sources"]),
        "X-Patch-Cache": "hit" if hit else "miss",
        "ETag": '"' + key[:32] + '"',
        "Cache-Control": "private, max-age=3600",
    }
    return Response(blob, media_type="application/octet-stream", headers=headers)


@router.get("/patch/header", response_model=PatchHeader, summary="Header of an elevation patch")
async def get_patch_header(q: Annotated[_PatchQuery, Depends()], ctx: Ctx) -> ORJSONResponse:
    """Same query as `/patch`; returns only the JSON header."""
    head, _key, _ = await ctx.terrain.patch(q.lat, q.lon, q.size_m, q.n, q.include_source, header_only=True)
    return ORJSONResponse(head, headers={"X-Patch-Sources": ",".join(s["id"] for s in head["sources"])})
