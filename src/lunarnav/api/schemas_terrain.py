"""Response models of the terrain endpoints."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class GeoJsonPolygon(BaseModel):
    type: Literal["Polygon"] = "Polygon"
    coordinates: list[list[list[float]]] = Field(description="One exterior ring of [lon_deg, lat_deg], lon in -180..180.")


class MapBBox(BaseModel):
    xmin: float
    xmax: float
    ymin: float
    ymax: float
    units: Literal["m", "deg"] = Field(description="Map units of the store grid (m polar, deg equirectangular).")


class StoreInfo(BaseModel):
    id: str
    description: str
    kind: Literal["polar_stereographic", "equirectangular"]
    pole: int = Field(description="+1 north, -1 south, 0 equirectangular.")
    pixel_size_m: float
    ncols: int
    nrows: int
    n_levels: int
    height_range_m: list[float | None] = Field(description="[min, max] metres above the 1737.4 km sphere.")
    bbox_map: MapBBox = Field(description="Extent of the pixel centres in the store's map units.")
    footprint: GeoJsonPolygon | None = Field(
        default=None,
        description="Boundary polygon (lon -180..180; polar stores enclosing a pole add the pole edge). Absent with "
                    "`footprint=none`; Douglas-Peucker simplified (0.05 deg) by default, the full densified ring "
                    "with `footprint=full`.")
    lat_extent_deg: list[float] = Field(description="[min, max] planetocentric latitude covered.")
    source: dict[str, Any] = Field(description="Provenance copied from meta.json (url, sha256, notes; the raw PDS `label` only with `source_label=true`).")
    meta_hash: str = Field(description="SHA-256 of the store's meta.json.")


class StoreList(BaseModel):
    stack_hash: str = Field(description="SHA-256 over the ordered meta hashes of all stores (part of every tile cache key).")
    stores: list[StoreInfo]


class LegendStop(BaseModel):
    value: float
    color: str = Field(description="#rrggbb")


class Legend(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: Literal["greyscale", "ramp", "terrarium"]
    min: float | None = None
    max: float | None = None
    units: str
    stops: list[LegendStop] | None = Field(default=None, description="Colour stops (linear interpolation in RGB) for `ramp` layers.")


class LayerDef(BaseModel):
    id: Literal["relief", "elevation", "slope", "heights"]
    title: str
    description: str
    encoding: str
    legend: Legend


class MatrixSize(BaseModel):
    z: int
    width: int = Field(description="Tiles across (x = 0..width-1).")
    height: int = Field(description="Tiles down (y = 0..height-1, top first).")


class TilesetDef(BaseModel):
    id: Literal["south-polar", "north-polar", "global"]
    title: str
    proj4: str
    crs_extent: list[float] = Field(description="[minx, miny, maxx, maxy] in CRS units.")
    units: Literal["m", "degree"]
    tile_size: int
    zoom_min: int
    zoom_max: int
    resolution_m_or_deg: list[float] = Field(description="CRS units per pixel for z = zoom_min..zoom_max.")
    origin: Literal["top-left"]
    matrix: list[MatrixSize]
    url_template: str
    layers: list[LayerDef]
    lat_limits: list[float] = Field(description="[min, max] planetocentric latitude shown.")
    elevation_range_m: list[float] = Field(description="Fixed [min, max] of the `elevation` ramp.")
    radius_m: float
    pixel_registration: str


class TilesetList(BaseModel):
    render_version: str = Field(description="Render-parameter version; part of the tile cache key.")
    tilesets: list[TilesetDef]


class PointResult(BaseModel):
    lat_deg: float
    lon_deg: float
    height_m: float | None = Field(description="Metres above the 1737.4 km sphere; null where no store has data.")
    slope_deg: float | None
    aspect_deg: float | None = Field(description="Downhill azimuth, degrees clockwise from north.")
    baseline_m: float
    store_id: str | None
    pixel_size_m: float | None


class PointIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lat_deg: Annotated[float, Field(ge=-90.0, le=90.0)]
    lon_deg: Annotated[float, Field(ge=-180.0, le=360.0)]


class PointsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    points: Annotated[list[PointIn], Field(min_length=1, max_length=1000)]
    baseline_m: Annotated[float, Field(gt=0.0, le=5000.0, description="Central-difference baseline for slope, metres.")] = 20.0


class PointsResponse(BaseModel):
    points: list[PointResult]


class PatchSource(BaseModel):
    id: str
    pixel_size_m: float
    projection: str
    level: int | None = None
    level_pixel_size_m: float | None = None


class PatchCorner(BaseModel):
    lat_deg: float
    lon_deg: float


class PatchCorners(BaseModel):
    nw: PatchCorner
    ne: PatchCorner
    sw: PatchCorner
    se: PatchCorner


class PatchHeader(BaseModel):
    """JSON header of an LNP1 patch (also returned by `GET /terrain/patch/header`)."""

    model_config = ConfigDict(extra="allow")

    format: Literal["LNP1"]
    lat_deg: float
    lon_deg: float
    size_m: float
    n: int
    spacing_m: float
    radius_m: float
    east_m: list[float]
    north_m: list[float]
    corners: PatchCorners
    nodata: Literal["NaN"]
    data_offset: int = Field(description="Byte offset of the float32 heights (multiple of 4).")
    dtype: Literal["float32le"]
    sources: list[PatchSource]
    height_range_m: list[float] | None = Field(description="[min, max] of finite samples; null if all NaN.")
    n_nodata: int
    effective_resolution_m: float | None = Field(description="Finest store ground spacing actually sampled.")
    notes: str
    curvature: str
