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

/** Shackleton overview: a 60 km square around the floor site, matching CraterView's grid (row 0 = north, column 0 = west). */
export const CRATER_N = 128;
export const CRATER_SIZE_KM = 60;

export interface CraterTerrain {
  /** Heights in km on CraterView's tangent plane: relative to the surrounding plain, sphere drop subtracted. */
  heightsKm: Float32Array;
  /** Scene positions (x = east km, z = -north km) of the rim and floor sites. */
  rim: { x: number; z: number };
  floor: { x: number; z: number };
  distKm: number;
  stores: string[];
}

let crater: CraterTerrain | null = null;
let craterState: "idle" | "loading" | "failed" = "idle";

export function craterTerrain(): CraterTerrain | null {
  return crater;
}

/** East/north offset (m) of `p` from `c` on the south polar stereographic map, rotated into c's local frame. */
function offsetEN(c: { lat: number; lon: number }, p: { lat: number; lon: number }): [number, number] {
  const R = 1737400;
  const xy = (lat: number, lon: number): [number, number] => {
    const rho = 2 * R * Math.tan(((90 + lat) * Math.PI) / 360);
    return [rho * Math.sin((lon * Math.PI) / 180), rho * Math.cos((lon * Math.PI) / 180)];
  };
  const [cx, cy] = xy(c.lat, c.lon);
  const [px, py] = xy(p.lat, p.lon);
  const dx = px - cx;
  const dy = py - cy;
  const l = (c.lon * Math.PI) / 180;
  return [dx * Math.cos(l) - dy * Math.sin(l), dx * Math.sin(l) + dy * Math.cos(l)];
}

async function loadCrater(): Promise<void> {
  const centre = SITES.floor;
  const buf = await fetchTerrainPatch({ lat: centre.lat, lon: centre.lon, size_m: CRATER_SIZE_KM * 1000, n: CRATER_N });
  const p = decodePatch(buf);
  if (p.n !== CRATER_N || p.nodata > 0) throw new Error("crater patch incomplete");
  const sorted = Float32Array.from(p.heights).sort();
  const plain = sorted[sorted.length >> 1]!;
  const cell = CRATER_SIZE_KM / (CRATER_N - 1);
  const R_KM = 1737.4;
  const heightsKm = new Float32Array(p.heights.length);
  for (let j = 0; j < CRATER_N; j++)
    for (let i = 0; i < CRATER_N; i++) {
      const x = -CRATER_SIZE_KM / 2 + i * cell;
      const z = -CRATER_SIZE_KM / 2 + j * cell;
      const k = j * CRATER_N + i;
      heightsKm[k] = (p.heights[k]! - plain) / 1000 - (x * x + z * z) / (2 * R_KM);
    }
  const [e, n] = offsetEN(centre, SITES.rim);
  crater = {
    heightsKm,
    rim: { x: e / 1000, z: -n / 1000 },
    floor: { x: 0, z: 0 },
    distKm: Math.hypot(e, n) / 1000,
    stores: (p.header.sources ?? []).map((s) => s.id),
  };
  useLearn.setState((s) => ({ terrainRev: s.terrainRev + 1 }));
}

export function ensureCrater(): void {
  if (crater || craterState !== "idle") return;
  craterState = "loading";
  loadCrater()
    .then(() => {
      craterState = "idle";
    })
    .catch((e: unknown) => {
      craterState = "failed";
      console.info("learn: real Shackleton terrain unavailable, using the stylized crater", e);
    });
}
