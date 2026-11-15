import {
  BufferAttribute,
  CanvasTexture,
  IcosahedronGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  ShaderChunk,
  type BufferGeometry,
  type MeshLambertMaterial,
} from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Procedural surface detail for the ground view: what the 5 m elevation maps cannot resolve. Small craters
 * and regolith roughness on the mesh, a tiling bump texture below the mesh spacing, and boulder shapes.
 * All of it is decoration on top of the real terrain and is labelled so in the "Is this real?" note.
 */

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hash3(x: number, y: number, z: number, seed: number): number {
  return hash2(x + Math.imul(z | 0, 1442695041), y, seed);
}

const fade = (t: number) => t * t * (3 - 2 * t);

/** Value noise in [-1, 1]; `period` (cells) makes it tile. */
function noise2(x: number, y: number, seed: number, period = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = fade(x - xi);
  const ty = fade(y - yi);
  const w = (v: number) => (period ? ((v % period) + period) % period : v);
  const a = hash2(w(xi), w(yi), seed);
  const b = hash2(w(xi + 1), w(yi), seed);
  const c = hash2(w(xi), w(yi + 1), seed);
  const d = hash2(w(xi + 1), w(yi + 1), seed);
  return 2 * ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty) - 1;
}

function noise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const tx = fade(x - xi);
  const ty = fade(y - yi);
  const tz = fade(z - zi);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  return (
    2 *
      l(
        l(l(c(0, 0, 0), c(1, 0, 0), tx), l(c(0, 1, 0), c(1, 1, 0), tx), ty),
        l(l(c(0, 0, 1), c(1, 0, 1), tx), l(c(0, 1, 1), c(1, 1, 1), tx), ty),
        tz,
      ) -
    1
  );
}

/** Crater profile (height in units of diameter D) at t = distance / radius: bowl, raised rim, ejecta falloff. */
function craterProfile(t: number, depth: number, rim: number): number {
  if (t < 1) return depth * (t * t - 1) + rim * t ** 4;
  if (t > 2.2) return 0;
  return rim * Math.exp(-(((t - 1) / 0.32) ** 2));
}

interface Scale {
  /** Typical crater diameter, m. */
  d: number;
  /** Chance that a grid cell (2.6 D on a side) holds a crater. */
  p: number;
}

/** Diameters roughly follow the lunar size-frequency distribution: many more small craters than large ones. */
const CRATERS: Scale[] = [
  { d: 28, p: 0.35 },
  { d: 12, p: 0.45 },
  { d: 5, p: 0.55 },
  { d: 2.2, p: 0.6 },
  { d: 0.9, p: 0.6 },
];
/** Regolith roughness: wavelength (m) and amplitude (m); a few decimetres at metre scales. */
const ROUGH: [number, number][] = [
  [16, 0.35],
  [7, 0.16],
  [3, 0.07],
  [1.3, 0.035],
  [0.6, 0.015],
];

/**
 * Detail height (m) at (east, north). Each component fades out where the mesh is too coarse to show it, so
 * distant ground does not shimmer: a feature of size s is kept to about 30 s from the observer.
 */
export function detailHeight(e: number, n: number): number {
  const r = Math.hypot(e, n);
  let h = 0;
  for (let s = 0; s < CRATERS.length; s++) {
    const { d, p } = CRATERS[s]!;
    const keep = 1 - fade(Math.min(1, Math.max(0, (r - 30 * d) / (30 * d))));
    if (keep <= 0) continue;
    const cell = 2.6 * d;
    const ci = Math.floor(e / cell);
    const cj = Math.floor(n / cell);
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const i = ci + di;
        const j = cj + dj;
        const seed = 101 + s * 17;
        if (hash2(i, j, seed) > p) continue;
        const cx = (i + 0.15 + 0.7 * hash2(i, j, seed + 1)) * cell;
        const cy = (j + 0.15 + 0.7 * hash2(i, j, seed + 2)) * cell;
        const dia = d * (0.55 + 0.9 * hash2(i, j, seed + 3));
        const rad = dia / 2;
        const t = Math.hypot(e - cx, n - cy) / rad;
        if (t > 2.2) continue;
        // Fresh craters are deep (depth/D about 0.2), old ones are shallow and soft.
        const age = hash2(i, j, seed + 4);
        h += keep * dia * craterProfile(t, 0.06 + 0.14 * (1 - age) ** 2, 0.012 + 0.03 * (1 - age));
      }
  }
  for (let o = 0; o < ROUGH.length; o++) {
    const [wl, amp] = ROUGH[o]!;
    const keep = 1 - fade(Math.min(1, Math.max(0, (r - 30 * wl) / (30 * wl))));
    if (keep > 0) h += keep * amp * noise2(e / wl, n / wl, 7 + o);
  }
  return h;
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D, ImageData] {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  return [c, ctx, ctx.createImageData(size, size)];
}

/** Tangent-space normal map from a tiling height field (`h` of size S*S, wrap-around differences). */
function normalTexture(h: Float32Array, S: number, strength: number): CanvasTexture {
  const [c, ctx, img] = canvas(S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = h[y * S + ((x + 1) % S)]! - h[y * S + ((x - 1 + S) % S)]!;
      const dy = h[((y + 1) % S) * S + x]! - h[((y - 1 + S) % S) * S + x]!;
      const nx = -dx * strength;
      const ny = dy * strength;
      const l = Math.hypot(nx, ny, 1);
      const k = (y * S + x) * 4;
      img.data[k] = (nx / l) * 127.5 + 127.5;
      img.data[k + 1] = (ny / l) * 127.5 + 127.5;
      img.data[k + 2] = (1 / l) * 127.5 + 127.5;
      img.data[k + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Fine regolith bumps below the mesh spacing: pebbles, footprint-sized pits and grain, tiling every `tileM` metres. */
export function regolithNormalMap(tileM: number): CanvasTexture {
  const S = 512;
  const h = new Float32Array(S * S);
  const octaves: [number, number][] = [
    [8, 1],
    [16, 0.55],
    [32, 0.3],
    [64, 0.18],
    [128, 0.1],
  ];
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let v = 0;
      for (const [cells, a] of octaves) v += a * noise2((x / S) * cells, (y / S) * cells, cells, cells);
      h[y * S + x] = v * 0.6;
    }
  // Small pits with rims, wrapped so the tile repeats seamlessly.
  for (let i = 0; i < 90; i++) {
    const cx = hash2(i, 1, 55) * S;
    const cy = hash2(i, 2, 55) * S;
    const rad = 3 + hash2(i, 3, 55) ** 2 * 22;
    const depth = (0.8 + hash2(i, 4, 55)) * rad * 0.06;
    const span = Math.ceil(rad * 2.2);
    for (let dy = -span; dy <= span; dy++)
      for (let dx = -span; dx <= span; dx++) {
        const t = Math.hypot(dx, dy) / rad;
        if (t > 2.2) continue;
        const x = (((Math.round(cx) + dx) % S) + S) % S;
        const y = (((Math.round(cy) + dy) % S) + S) % S;
        h[y * S + x] = h[y * S + x]! + craterProfile(t, 1, 0.18) * depth;
      }
  }
  // Pebbles: small rounded bumps.
  for (let i = 0; i < 700; i++) {
    const cx = hash2(i, 5, 56) * S;
    const cy = hash2(i, 6, 56) * S;
    const rad = 0.8 + hash2(i, 7, 56) ** 3 * 4;
    const span = Math.ceil(rad);
    for (let dy = -span; dy <= span; dy++)
      for (let dx = -span; dx <= span; dx++) {
        const q = 1 - (dx * dx + dy * dy) / (rad * rad);
        if (q <= 0) continue;
        const x = (((Math.round(cx) + dx) % S) + S) % S;
        const y = (((Math.round(cy) + dy) % S) + S) % S;
        h[y * S + x] = h[y * S + x]! + Math.sqrt(q) * rad * 0.5;
      }
  }
  const t = normalTexture(h, S, 1.4);
  t.repeat.set(1 / tileM, 1 / tileM);
  return t;
}

/** Mottled grey rock albedo: crystals, darker patches and pale veins. */
export function rockColorMap(): CanvasTexture {
  const S = 256;
  const [c, ctx, img] = canvas(S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const big = noise2(x / 32, y / 32, 3, 8) * 0.5 + noise2(x / 12, y / 12, 4, 0) * 0.3;
      const grain = hash2(x, y, 9) - 0.5;
      const vein = Math.abs(noise2(x / 20, y / 20, 5, 0)) < 0.04 ? 0.25 : 0;
      const v = Math.max(0, Math.min(1, 0.5 + big * 0.22 + grain * 0.22 + vein));
      const k = (y * S + x) * 4;
      img.data[k] = v * 235;
      img.data[k + 1] = v * 232;
      img.data[k + 2] = v * 226;
      img.data[k + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Pitted, cracked rock surface. */
export function rockNormalMap(): CanvasTexture {
  const S = 256;
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let v = 0;
      for (const [cells, a] of [
        [8, 1],
        [16, 0.5],
        [32, 0.3],
        [64, 0.2],
      ] as const)
        v += a * noise2((x / S) * cells, (y / S) * cells, 30 + cells, cells);
      const crack = Math.abs(noise2((x / S) * 6, (y / S) * 6, 77, 6));
      h[y * S + x] = v * 1.5 - (crack < 0.05 ? (0.05 - crack) * 30 : 0);
    }
  const t = normalTexture(h, S, 2.2);
  t.repeat.set(2, 1);
  return t;
}

/** A boulder: a lumpy sphere cut by a few random planes for broken faces; unit size, flattened base. */
export function rockGeometry(seed: number): BufferGeometry {
  const g = mergeVertices(new IcosahedronGeometry(1, 4).deleteAttribute("normal"), 1e-4);
  const pos = g.getAttribute("position") as BufferAttribute;
  const planes = Array.from({ length: 5 + Math.floor(hash2(seed, 0, 1) * 4) }, (_, k) => {
    const u = hash2(seed, k, 2) * 2 - 1;
    const a = hash2(seed, k, 3) * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    return { n: [s * Math.cos(a), u, s * Math.sin(a)] as const, d: 0.62 + hash2(seed, k, 4) * 0.3 };
  });
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let r = 1 + 0.22 * noise3(x * 1.3, y * 1.3, z * 1.3, seed) + 0.07 * noise3(x * 4, y * 4, z * 4, seed + 1);
    for (const p of planes) {
      const c = x * p.n[0] + y * p.n[1] + z * p.n[2];
      if (c > 0) r = Math.min(r, p.d / c);
    }
    let ny = y * r;
    if (ny < -0.35) ny = -0.35 + (ny + 0.35) * 0.3;
    pos.setXYZ(i, x * r, ny, z * r);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Switch a Lambert material to the Lommel-Seeliger law, the standard first-order model of lunar regolith:
 * radiance goes as mu0 / (mu0 + mu) instead of mu0 (mu0, mu = cosines of the Sun and view angles to the normal).
 * Under a grazing Sun, flat ground stays visibly lit while anything in cast shadow drops to the fill light, which
 * is what polar photographs look like. Scaled by 2 so it matches Lambert at normal incidence and viewing.
 */
export function lunarSoil<T extends MeshLambertMaterial>(m: T): T {
  const chunk = ShaderChunk.lights_lambert_pars_fragment.replace(
    "vec3 irradiance = dotNL * directLight.color;",
    "float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );\n\tvec3 irradiance = ( 2.0 * dotNL / ( dotNL + dotNV + 1e-3 ) ) * directLight.color;",
  );
  if (chunk === ShaderChunk.lights_lambert_pars_fragment) return m;
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <lights_lambert_pars_fragment>", chunk);
  };
  m.customProgramCacheKey = () => "lunar-soil";
  return m;
}

/** Regolith albedo for the real ground: low-contrast mottling and grain, no painted features (relief does that). */
export function regolithAlbedo(): CanvasTexture {
  const S = 512;
  const [c, ctx, img] = canvas(S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const m = noise2((x / S) * 4, (y / S) * 4, 61, 4) * 0.5 + noise2((x / S) * 16, (y / S) * 16, 62, 16) * 0.3;
      const grain = hash2(x, y, 63) - 0.5;
      const v = Math.max(0, Math.min(1, 0.56 + m * 0.07 + grain * 0.09));
      const k = (y * S + x) * 4;
      img.data[k] = v * 255;
      img.data[k + 1] = v * 253;
      img.data[k + 2] = v * 249;
      img.data[k + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
