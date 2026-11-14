import type { components } from "./generated/schema";
import { ApiError, apiUrl, errorFromResponse, getJson, isAbort } from "./client";

type Schemas = components["schemas"];

export type Legend = Schemas["Legend"];
export type TileLayerId = Schemas["LayerDef"]["id"];
export type TilesetId = Schemas["TilesetDef"]["id"];

export type TilesetDef = Omit<Schemas["TilesetDef"], "crs_extent" | "lat_limits" | "elevation_range_m"> & {
  crs_extent: [number, number, number, number];
  lat_limits: [number, number];
  elevation_range_m: [number, number];
};

export type StoreInfo = Schemas["StoreInfo"];

type Opts = { signal?: AbortSignal };

export const terrainApi = {
  tilesets: (o: Opts = {}) => getJson<{ render_version: string; tilesets: TilesetDef[] }>("/terrain/tilesets", o),
  stores: (o: Opts = {}) => getJson<Schemas["StoreList"]>("/terrain/stores", o),
};

export function tileUrl(ts: TilesetDef, renderVersion: string, layer: TileLayerId, z: number, x: number, y: number): string {
  const path = ts.url_template
    .replace("{tileset}", ts.id)
    .replace("{layer}", layer)
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
  return apiUrl(path, { v: renderVersion });
}

export async function fetchTileBitmap(url: string, signal: AbortSignal): Promise<ImageBitmap | null> {
  let res: Response;
  try {
    res = await fetch(url, { signal, headers: { Accept: "image/png" } });
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ApiError({ status: 0, title: "Engine unreachable", detail: `Could not fetch ${url}`, cause: e });
  }
  if (res.status === 404) return null;
  if (!res.ok) throw await errorFromResponse(res, "");
  const blob = await res.blob();
  return createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
}

export function decodeTerrarium(r: number, g: number, b: number, a: number): number | null {
  if (a === 0) return null;
  return r * 256 + g + b / 256 - 32768;
}
