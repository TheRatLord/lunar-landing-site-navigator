/**
 * Geometry of the ground view: LNP1 elevation patches from `/terrain/patch` turned into nested terrain
 * levels around the site, in metres east, north and up from the site's ground. Plain functions, no
 * Three.js, so the numbers can be checked without a graphics card.
 *
 * The approach (nested squares, finer near the site; a coarser level leaves out what a finer one
 * covers and sits a little lower so the two don't flicker) follows the 3D terrain of the team's
 * Sightline app (`sightline/web/src/lib/terrainMesh.ts`).
 */

import type { Patch } from "../../site/terrain3d/patch";

/** The Moon's reference sphere, metres; LNP1 heights are above it (`header.radius_m`). */
export const MOON_RADIUS_M = 1_737_400;

const RAD = Math.PI / 180;

export type Vec3 = [number, number, number];

/** One square of terrain to request: full side width (m) and samples per side (odd, so the centre is a sample). */
export interface LevelSpec {
  sizeM: number;
  n: number;
  /** How far this level is lowered (m) so a finer level drawn over it wins where the two overlap. */
  dropM: number;
}

/** Fine near the eye, coarse out to 50 km. The patch endpoint allows at most 100 km and 1025 samples. */
export const GROUND_LEVELS: LevelSpec[] = [
  { sizeM: 4_000, n: 801, dropM: 0 }, // 5 m spacing
  { sizeM: 24_000, n: 601, dropM: 2 }, // 40 m
  { sizeM: 100_000, n: 501, dropM: 8 }, // 200 m
];

/** Lighter levels for phones and small windows. */
export const GROUND_LEVELS_SMALL: LevelSpec[] = [
  { sizeM: 4_000, n: 401, dropM: 0 }, // 10 m
  { sizeM: 24_000, n: 301, dropM: 3 }, // 80 m
  { sizeM: 100_000, n: 251, dropM: 12 }, // 400 m
];

export interface GroundLevel {
  /** East, north, up (m) from the site's ground, per sample; row 0 is the north edge, column 0 the west. */
  positions: Float32Array;
  indices: Uint32Array;
  halfM: number;
  spacingM: number;
}

/**
 * The 3D position of every sample of a patch, exact on the sphere. A patch sample at grid offset
 * (e, n) is the point reached from the centre along the great circle with azimuth atan2(e, n) for a
 * distance hypot(e, n) (LNP1 notes). At angular distance θ and radius r = R + h it lies r·sin θ
 * across the tangent plane and r·cos θ − (R + h0) above the site's ground, so curvature needs no
 * approximation.
 */
export function patchPositions(patch: Patch, siteHeightM: number, dropM: number): Float32Array {
  const { n, heights } = patch;
  const spacing = patch.header.spacing_m;
  const half = patch.header.size_m / 2;
  const base = MOON_RADIUS_M + siteHeightM;
  const out = new Float32Array(n * n * 3);
  for (let row = 0; row < n; row++) {
    const north = half - row * spacing;
    for (let col = 0; col < n; col++) {
      const east = col * spacing - half;
      const i = row * n + col;
      const h = heights[i]!;
      if (h !== h) continue; // no data: the triangles using it are left out
      const d = Math.hypot(east, north);
      const theta = d / MOON_RADIUS_M;
      const r = MOON_RADIUS_M + h - dropM;
      const across = d === 0 ? 0 : (r * Math.sin(theta)) / d;
      out[i * 3] = east * across;
      out[i * 3 + 1] = north * across;
      out[i * 3 + 2] = r * Math.cos(theta) - base;
    }
  }
  return out;
}

/**
 * Two triangles per grid cell, leaving out cells wholly inside `holeHalfM` of the centre (a finer
 * level covers them) and cells touching a sample with no data.
 */
export function patchIndices(patch: Patch, holeHalfM: number): Uint32Array {
  const { n, heights } = patch;
  const spacing = patch.header.spacing_m;
  const half = patch.header.size_m / 2;
  const inside = (k: number) => Math.abs(k * spacing - half) <= holeHalfM;
  const out = new Uint32Array((n - 1) * (n - 1) * 6);
  let used = 0;
  for (let row = 0; row < n - 1; row++) {
    for (let col = 0; col < n - 1; col++) {
      if (holeHalfM > 0 && inside(row) && inside(row + 1) && inside(col) && inside(col + 1)) continue;
      const a = row * n + col;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      if (heights[a] !== heights[a] || heights[b] !== heights[b] || heights[c] !== heights[c] || heights[d] !== heights[d]) continue;
      out.set([a, c, b, b, c, d], used);
      used += 6;
    }
  }
  return out.slice(0, used);
}

/** The height at the centre of a patch (m above the sphere), or null without data there. */
export function centreHeight(patch: Patch): number | null {
  const mid = (patch.n - 1) / 2;
  const h = patch.heights[mid * patch.n + mid]!;
  return h === h ? h : null;
}

/** Build every level from its patch, finest first. The site's ground is the finest patch's centre. */
export function buildGroundLevels(patches: Patch[], specs: LevelSpec[]): { levels: GroundLevel[]; siteHeightM: number } {
  const siteHeightM = (patches[0] && centreHeight(patches[0])) ?? 0;
  const levels = patches.map((patch, i) => {
    const spacingM = patch.header.spacing_m;
    const prev = i > 0 ? patches[i - 1]! : null;
    const holeHalfM = prev ? prev.header.size_m / 2 - spacingM : 0;
    return {
      positions: patchPositions(patch, siteHeightM, specs[i]?.dropM ?? 0),
      indices: patchIndices(patch, holeHalfM),
      halfM: patch.header.size_m / 2,
      spacingM,
    };
  });
  return { levels, siteHeightM };
}

/** Whether a patch has no terrain data at all (the engine then uses a smooth sphere). */
export function isEmptyPatch(patch: Patch): boolean {
  return patch.nodata >= patch.n * patch.n;
}

/**
 * A patch of the smooth sphere, for a site without terrain stores: every height 0, so the view
 * shows the same smooth horizon the engine falls back to.
 */
export function smoothPatch(like: Patch): Patch {
  return { ...like, heights: new Float32Array(like.n * like.n), nodata: 0, min: 0, max: 0 };
}

/** The unit vector toward azimuth `azDeg` (clockwise from north) and elevation `elDeg`, east/north/up. */
export function skyVector(azDeg: number, elDeg: number): Vec3 {
  const az = azDeg * RAD;
  const el = elDeg * RAD;
  return [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
}
