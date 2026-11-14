import { sendJson } from "../api/client";
import { fetchTerrainPatch } from "../api/site";
import { decodePatch } from "../workspaces/site/terrain3d/patch";
import { wrap360 } from "../lib/scale";
import { SITES, type Site, type SiteId } from "./sites";
import { useLearn } from "./store";

/** Eye height of the ground view, metres; the horizon is computed for this observer. */
export const OBSERVER_M = 1.7;
/** Side of the ground patch around the observer, metres, and samples per side (5 m spacing). */
const PATCH_SIZE_M = 1000;
const PATCH_N = 201;
const N_AZ = 360;

/** Sites with LOLA/PGDA coverage; the others keep their stylized ground and horizon. */
const POLAR: readonly SiteId[] = ["rim", "floor"];

export interface GroundPatch {
  /** Samples per side; row 0 = north, column 0 = west. */
  n: number;
  spacing: number;
  /** Half side, metres: the grid spans -half..half in east and north. */
  half: number;
  /** Heights relative to the ground under the observer, metres. */
  heights: Float32Array;
}

export interface SiteTerrain {
  /** Terrain horizon elevation per degree of azimuth (clockwise from north), for an observer at OBSERVER_M. */
  horizon: Float32Array;
  patch: GroundPatch;
  /** Store under the observer (e.g. `pgda78_site04_5m`) and every store the patch drew from. */
  groundStore: string;
  patchStores: string[];
  pixelM: number;
}

export type RealSite = Site & { terrain?: SiteTerrain };

interface HorizonResponse {
  provider: string;
  elev_deg: number[];
  provenance?: { horizon?: { ground_store?: string } };
}

const real: Partial<Record<SiteId, RealSite>> = {};
const pending = new Map<SiteId, Promise<void>>();
const failed = new Set<SiteId>();

/** The site with its real terrain when it has loaded, otherwise the stylized one. */
export function siteById(id: SiteId): RealSite {
  return real[id] ?? SITES[id];
}

export function hasTerrainCoverage(id: SiteId): boolean {
  return POLAR.includes(id);
}

/** Bilinear height at (east, north) metres, relative to the observer's ground; clamps at the patch edge. */
export function heightAt(p: GroundPatch, east: number, north: number): number {
  const fx = Math.min(p.n - 1, Math.max(0, (east + p.half) / p.spacing));
  const fy = Math.min(p.n - 1, Math.max(0, (p.half - north) / p.spacing));
  const x0 = Math.min(p.n - 2, Math.floor(fx));
  const y0 = Math.min(p.n - 2, Math.floor(fy));
  const tx = fx - x0;
  const ty = fy - y0;
  const h = p.heights;
  const i = y0 * p.n + x0;
  const top = h[i]! * (1 - tx) + h[i + 1]! * tx;
  const bot = h[i + p.n]! * (1 - tx) + h[i + p.n + 1]! * tx;
  return top * (1 - ty) + bot * ty;
}

function horizonFn(prof: Float32Array): (az: number) => number {
  return (az) => {
    const a = wrap360(az);
    const i = Math.floor(a) % N_AZ;
    const t = a - Math.floor(a);
    return prof[i]! * (1 - t) + prof[(i + 1) % N_AZ]! * t;
  };
}

async function load(id: SiteId): Promise<void> {
  const base = SITES[id];
  const [hz, buf] = await Promise.all([
    sendJson<HorizonResponse>("/horizon", {
      lat_deg: base.lat,
      lon_deg: base.lon,
      height_m: OBSERVER_M,
      n_az: N_AZ,
      terrain: "on",
      wait_s: 30,
    }),
    fetchTerrainPatch({ lat: base.lat, lon: base.lon, size_m: PATCH_SIZE_M, n: PATCH_N }),
  ]);
  if (hz.provider !== "terrain" || hz.elev_deg?.length !== N_AZ) throw new Error("no terrain horizon");
  const patch = decodePatch(buf);
  if (patch.nodata > 0) throw new Error("patch has gaps");
  const c = (patch.n - 1) / 2;
  const h0 = patch.heights[c * patch.n + c]!;
  const heights = new Float32Array(patch.heights.length);
  for (let i = 0; i < heights.length; i++) heights[i] = patch.heights[i]! - h0;
  const horizon = Float32Array.from(hz.elev_deg);
  const sources = patch.header.sources ?? [];
  const terrain: SiteTerrain = {
    horizon,
    patch: { n: patch.n, spacing: patch.header.spacing_m, half: patch.header.size_m / 2, heights },
    groundStore: hz.provenance?.horizon?.ground_store ?? sources[0]?.id ?? "terrain",
    patchStores: sources.map((s) => s.id),
    pixelM: Math.min(...sources.map((s) => s.pixel_size_m), Infinity),
  };
  real[id] = { ...base, horizon: horizonFn(horizon), terrain };
  useLearn.setState((s) => ({ terrainRev: s.terrainRev + 1 }));
}

/** Fetch the real horizon and ground for a polar site once; on any failure the stylized site stays. */
export function ensureTerrain(id: SiteId): void {
  if (!hasTerrainCoverage(id) || real[id] || failed.has(id) || pending.has(id)) return;
  const p = load(id)
    .catch((e: unknown) => {
      failed.add(id);
      console.info(`learn: real terrain for ${id} unavailable, using the stylized ground`, e);
    })
    .finally(() => pending.delete(id));
  pending.set(id, p);
}
