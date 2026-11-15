import { cividis, viridis, type Colormap } from "../../../lib/colormaps";
import { clamp } from "../../../lib/scale";
import type { Patch } from "./patch";

export const R_MOON_M = 1_737_400;
const SHADOW_MAX_N = 513;
const AMBIENT = 0.3;
export const SLOPE_FULL_SCALE_DEG = 30;

type Vec3 = [number, number, number];

export function dirFromAzEl(az_deg: number, el_deg: number): Vec3 {
  const az = (az_deg * Math.PI) / 180;
  const el = (el_deg * Math.PI) / 180;
  const c = Math.cos(el);
  return [Math.sin(az) * c, Math.sin(el), -Math.cos(az) * c];
}

export function offsetAt(az_deg: number, dist_m: number): { east: number; north: number } {
  const a = (az_deg * Math.PI) / 180;
  return { east: dist_m * Math.sin(a), north: dist_m * Math.cos(a) };
}

export interface Grid {
  n: number;
  spacing: number;
  east0: number;
  north0: number;
  y: Float32Array;
  h: Float32Array;
  min: number;
  max: number;
}

export function surfaceGrid(p: Patch): Grid {
  const { n } = p;
  const sp = p.header.spacing_m;
  const east0 = p.header.east_m[0];
  const north0 = p.header.north_m[0];
  const r2 = 2 * (p.header.radius_m || R_MOON_M);
  const y = new Float32Array(n * n);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const north = north0 - i * sp;
    for (let j = 0; j < n; j++) {
      const east = east0 + j * sp;
      const v = p.heights[i * n + j]! - (east * east + north * north) / r2;
      y[i * n + j] = v;
      if (v === v) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  return { n, spacing: sp, east0, north0, y, h: p.heights, min, max };
}

function sampleY(g: Grid, fi: number, fj: number): number {
  const { n, y } = g;
  if (fi < 0 || fj < 0 || fi > n - 1 || fj > n - 1) return NaN;
  const i0 = Math.min(n - 2, Math.floor(fi));
  const j0 = Math.min(n - 2, Math.floor(fj));
  const u = fi - i0;
  const v = fj - j0;
  const a = y[i0 * n + j0]!;
  const b = y[i0 * n + j0 + 1]!;
  const c = y[(i0 + 1) * n + j0]!;
  const d = y[(i0 + 1) * n + j0 + 1]!;
  return (a * (1 - v) + b * v) * (1 - u) + (c * (1 - v) + d * v) * u;
}

export function heightAtOffset(g: Grid, east: number, north: number): number {
  return sampleY(g, (g.north0 - north) / g.spacing, (east - g.east0) / g.spacing);
}

export interface Shading {
  normals: Float32Array;
  slope_deg: Float32Array;
}

export function shadingOf(g: Grid): Shading {
  const { n, y, spacing: sp } = g;
  const normals = new Float32Array(n * n * 3);
  const slope = new Float32Array(n * n);
  const at = (i: number, j: number) => y[i * n + j]!;
  const diff = (a: number, b: number, c: number, h: number): number => {
    if (a === a && c === c) return (c - a) / (2 * h);
    if (c === c) return (c - b) / h;
    if (a === a) return (b - a) / h;
    return 0;
  };
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const k = i * n + j;
      const c = at(i, j);
      if (c !== c) {
        normals[3 * k + 1] = 1;
        slope[k] = NaN;
        continue;
      }
      const dE = diff(j > 0 ? at(i, j - 1) : NaN, c, j < n - 1 ? at(i, j + 1) : NaN, sp);
      const dN = -diff(i > 0 ? at(i - 1, j) : NaN, c, i < n - 1 ? at(i + 1, j) : NaN, sp);
      const len = Math.hypot(dE, dN, 1);
      normals[3 * k] = -dE / len;
      normals[3 * k + 1] = 1 / len;
      normals[3 * k + 2] = dN / len;
      slope[k] = (Math.atan(Math.hypot(dE, dN)) * 180) / Math.PI;
    }
  }
  return { normals, slope_deg: slope };
}

export interface ShadowMask {
  lit: Uint8Array;
  nc: number;
  stride: number;
  sunUp: boolean;
  shadowedFraction: number;
}

export function shadowMask(g: Grid, sunAz_deg: number, sunEl_deg: number): ShadowMask {
  const { n, spacing: sp } = g;
  let stride = 1;
  while ((n - 1) / stride + 1 > SHADOW_MAX_N && (n - 1) % (stride * 2) === 0) stride *= 2;
  const nc = (n - 1) / stride + 1;
  const lit = new Uint8Array(nc * nc);
  if (!(sunEl_deg > 0)) return { lit, nc, stride, sunUp: false, shadowedFraction: 1 };
  const az = (sunAz_deg * Math.PI) / 180;
  const tanEl = Math.tan((sunEl_deg * Math.PI) / 180);
  const dj = Math.sin(az);
  const di = -Math.cos(az);
  const bias = 0.02;
  let valid = 0;
  let dark = 0;
  for (let ci = 0; ci < nc; ci++) {
    for (let cj = 0; cj < nc; cj++) {
      const fi0 = ci * stride;
      const fj0 = cj * stride;
      const y0 = g.y[fi0 * n + fj0]!;
      if (y0 !== y0) {
        lit[ci * nc + cj] = 1;
        continue;
      }
      valid++;
      let shadowed = false;
      for (let k = 1; ; k++) {
        const s = k * sp;
        const rayY = y0 + s * tanEl + bias;
        if (rayY > g.max) break;
        const fi = fi0 + di * k;
        const fj = fj0 + dj * k;
        if (fi < 0 || fj < 0 || fi > n - 1 || fj > n - 1) break;
        const t = sampleY(g, fi, fj);
        if (t > rayY) {
          shadowed = true;
          break;
        }
      }
      if (shadowed) dark++;
      else lit[ci * nc + cj] = 1;
    }
  }
  return { lit, nc, stride, sunUp: true, shadowedFraction: valid ? dark / valid : 0 };
}

function litAt(m: ShadowMask, i: number, j: number): number {
  if (m.stride === 1) return m.lit[i * m.nc + j]!;
  const fi = i / m.stride;
  const fj = j / m.stride;
  const i0 = Math.min(m.nc - 2, Math.floor(fi));
  const j0 = Math.min(m.nc - 2, Math.floor(fj));
  const u = fi - i0;
  const v = fj - j0;
  const L = m.lit;
  const nc = m.nc;
  return (L[i0 * nc + j0]! * (1 - v) + L[i0 * nc + j0 + 1]! * v) * (1 - u) + (L[(i0 + 1) * nc + j0]! * (1 - v) + L[(i0 + 1) * nc + j0 + 1]! * v) * u;
}

export type ColorMode = "height" | "slope";

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function lut(cm: Colormap): Float32Array {
  const out = new Float32Array(256 * 3);
  for (let k = 0; k < 256; k++) {
    const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(cm(k / 255));
    for (let c = 0; c < 3; c++) out[3 * k + c] = m ? srgbToLinear(Number(m[c + 1]) / 255) : 0;
  }
  return out;
}

const LUTS: Record<ColorMode, Float32Array> = { height: lut(cividis), slope: lut(viridis) };

const NODATA_RGB: Vec3 = [0.1, 0.1, 0.1];

export interface LightState {
  sunAz_deg: number;
  sunEl_deg: number;
}

export function colorize(g: Grid, sh: Shading, mode: ColorMode, light: LightState | null, mask: ShadowMask | null): Float32Array {
  const { n } = g;
  const out = new Float32Array(n * n * 3);
  const table = LUTS[mode];
  const sun = light ? dirFromAzEl(light.sunAz_deg, light.sunEl_deg) : null;
  const up = !!(sun && mask?.sunUp);
  const span = Math.max(1e-6, g.max - g.min);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const k = i * n + j;
      const yv = g.y[k]!;
      if (yv !== yv) {
        out.set(NODATA_RGB, 3 * k);
        continue;
      }
      const t = mode === "height" ? (yv - g.min) / span : Math.min(1, sh.slope_deg[k]! / SLOPE_FULL_SCALE_DEG);
      const idx = clamp(Math.round(t * 255), 0, 255) * 3;
      let f = AMBIENT;
      if (up && sun && mask) {
        const d = sh.normals[3 * k]! * sun[0] + sh.normals[3 * k + 1]! * sun[1] + sh.normals[3 * k + 2]! * sun[2];
        f += (1 - AMBIENT) * Math.max(0, d) * litAt(mask, i, j);
      }
      out[3 * k] = table[idx]! * f;
      out[3 * k + 1] = table[idx + 1]! * f;
      out[3 * k + 2] = table[idx + 2]! * f;
    }
  }
  return out;
}

export function positions(g: Grid): Float32Array {
  const { n, spacing: sp } = g;
  const out = new Float32Array(n * n * 3);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const k = i * n + j;
      out[3 * k] = g.east0 + j * sp;
      const v = g.y[k]!;
      out[3 * k + 1] = v === v ? v : g.min;
      out[3 * k + 2] = -(g.north0 - i * sp);
    }
  }
  return out;
}

export function indices(g: Grid): { index: Uint32Array; triangles: number } {
  const { n, y } = g;
  const out = new Uint32Array((n - 1) * (n - 1) * 6);
  let w = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < n - 1; j++) {
      const a = i * n + j;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      if (y[a] !== y[a] || y[b] !== y[b] || y[c] !== y[c] || y[d] !== y[d]) continue;
      out[w++] = a;
      out[w++] = c;
      out[w++] = b;
      out[w++] = b;
      out[w++] = c;
      out[w++] = d;
    }
  }
  return { index: out.subarray(0, w), triangles: w / 3 };
}

export function edgeDistance(g: Grid, az_deg: number): number {
  const half = ((g.n - 1) * g.spacing) / 2;
  const { east, north } = offsetAt(az_deg, 1);
  const m = Math.max(Math.abs(east), Math.abs(north));
  return m === 0 ? half : half / m;
}
