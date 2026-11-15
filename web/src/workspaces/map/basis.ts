import type { TilesetDef, TilesetId } from "../../api/terrain";
import { polarForward, projectionFromProj, type Projection, type TileGridDef } from "../../lib/projection";
import type { ViewGrid } from "./view";
import type { ViewKind } from "./urlState";

export interface MapBasis {
  kind: ViewKind;
  tileset: TilesetDef | null;
  proj: Projection;
  grid: ViewGrid;
  latLimits: [number, number];
}

export const TILESET_OF_VIEW: Record<ViewKind, TilesetId> = {
  south: "south-polar",
  north: "north-polar",
  global: "global",
};

const FALLBACK_PROJ: Record<ViewKind, string> = {
  south: "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +k=1 +R=1737400 +units=m",
  north: "+proj=stere +lat_0=90 +lat_ts=90 +lon_0=0 +k=1 +R=1737400 +units=m",
  global: "+proj=longlat +R=1737400",
};

function gridOfTileset(ts: TilesetDef): TileGridDef {
  const m0 = ts.matrix.find((m) => m.z === 0) ?? ts.matrix[0];
  return {
    extent: ts.crs_extent,
    tilesX0: m0?.width ?? 1,
    tilesY0: m0?.height ?? 1,
    minZ: ts.zoom_min,
    maxZ: ts.zoom_max,
    tileSize: ts.tile_size,
  };
}

export function basisFor(kind: ViewKind, tilesets: readonly TilesetDef[] | null): MapBasis {
  const ts = tilesets?.find((t) => t.id === TILESET_OF_VIEW[kind]) ?? null;
  if (ts) {
    return { kind, tileset: ts, proj: projectionFromProj(ts.proj4), grid: { ...gridOfTileset(ts), contain: kind === "global" }, latLimits: ts.lat_limits };
  }
  const proj = projectionFromProj(FALLBACK_PROJ[kind]);
  if (kind === "global") {
    return { kind, tileset: null, proj, grid: { extent: [-180, -90, 180, 90], tilesX0: 2, tilesY0: 1, minZ: 0, maxZ: 6, tileSize: 256, contain: true }, latLimits: [-90, 90] };
  }
  const e = Math.abs(polarForward(kind, kind === "south" ? -60 : 60, 0).y_m);
  return { kind, tileset: null, proj, grid: { extent: [-e, -e, e, e], tilesX0: 1, tilesY0: 1, minZ: 0, maxZ: 11, tileSize: 256 }, latLimits: kind === "south" ? [-90, -60] : [60, 90] };
}
