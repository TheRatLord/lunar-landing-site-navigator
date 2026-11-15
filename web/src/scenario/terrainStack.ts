import { useEffect, useState } from "react";
import { metaApi } from "../api/endpoints";
import type { components } from "../api/generated/schema";
import { formatLat, formatLon } from "../lib/coords";
import { formatNum } from "../lib/format";
import { clamp } from "../lib/scale";

export type TerrainStoreInfo = components["schemas"]["TerrainStoreInfo"];

function parseStores(meta: unknown): TerrainStoreInfo[] {
  const list = meta && typeof meta === "object" && "terrain_stores" in meta ? meta.terrain_stores : null;
  if (!Array.isArray(list)) return [];
  const stores = list.filter((s): s is TerrainStoreInfo => !!s && typeof s === "object" && "dem_id" in s && typeof s.dem_id === "string");
  return stores.map((s, i) => ({ s, i })).sort((a, b) => (a.s.precedence ?? Infinity) - (b.s.precedence ?? Infinity) || a.i - b.i).map((x) => x.s);
}

let storesRequest: Promise<TerrainStoreInfo[]> | null = null;

export function useTerrainStores(): { stores: TerrainStoreInfo[] | null; error: string | null } {
  const [state, setState] = useState<{ stores: TerrainStoreInfo[] | null; error: string | null }>({ stores: null, error: null });
  useEffect(() => {
    let live = true;
    storesRequest ??= metaApi.get().then(parseStores);
    storesRequest.then(
      (stores) => live && setState({ stores, error: null }),
      (e: unknown) => {
        storesRequest = null;
        if (live) setState({ stores: null, error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}

export function storeCovers(s: TerrainStoreInfo, latDeg: number, lonDeg: number): boolean | null {
  const c = s.coverage;
  if (!c) return null;
  if (c.whole_moon) return true;
  if (c.centre_lat_deg === null || c.centre_lon_deg === null || c.radius_deg === null) return null;
  const rad = Math.PI / 180;
  const cos =
    Math.sin(latDeg * rad) * Math.sin(c.centre_lat_deg * rad) +
    Math.cos(latDeg * rad) * Math.cos(c.centre_lat_deg * rad) * Math.cos((lonDeg - c.centre_lon_deg) * rad);
  return Math.acos(clamp(cos, -1, 1)) / rad <= c.radius_deg;
}

export function storePlace(s: TerrainStoreInfo): string {
  const c = s.coverage;
  if (c?.whole_moon) return "Whole Moon";
  if (!c || c.centre_lat_deg === null || c.centre_lon_deg === null || c.radius_deg === null) return "Unknown area";
  if (Math.abs(c.centre_lat_deg) > 89.99) {
    const edge = formatNum(90 - c.radius_deg, 1);
    return c.centre_lat_deg < 0 ? `South pole to ${edge}°S` : `North pole to ${edge}°N`;
  }
  const lon = ((((c.centre_lon_deg + 180) % 360) + 360) % 360) - 180;
  return `Around ${formatLat(c.centre_lat_deg, 2)} ${formatLon(lon, 2)}`;
}

export const sortedStores = (ids: readonly string[]): string[] => [...ids].sort();

const NAMED_STORES = 3;

export function stackName(stores: readonly string[] | null | undefined): string {
  if (stores == null) return "default stack";
  const ids = sortedStores(stores);
  if (ids.length === 0) return "restricted stack: none";
  if (ids.length <= NAMED_STORES) return `restricted stack: ${ids.join(", ")}`;
  return `restricted stack: ${ids.length} stores (${ids.slice(0, NAMED_STORES).join(", ")}, …)`;
}

export const stackIds = (stores: readonly string[] | null | undefined): string => (stores == null ? "every installed store" : sortedStores(stores).join(", ") || "none");

interface StackGroup {
  stack: string;
  ids: string;
  names: string[];
}

export function stackMismatch(entries: ReadonlyArray<{ name: string; stores: readonly string[] | null | undefined }>): StackGroup[] | null {
  const groups = new Map<string, StackGroup>();
  for (const e of entries) {
    const ids = stackIds(e.stores);
    const g = groups.get(ids) ?? { stack: stackName(e.stores), ids, names: [] };
    g.names.push(e.name);
    groups.set(ids, g);
  }
  return groups.size > 1 ? [...groups.values()] : null;
}
