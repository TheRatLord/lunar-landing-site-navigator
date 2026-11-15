import { fetchTileBitmap, tileUrl, type TilesetDef } from "../../../api/terrain";
import { tileBounds, tileSpan, type Projection, type TileGridDef } from "../../../lib/projection";
import { basisFor } from "../../map/basis";
import { viewKindFor, type ViewKind } from "../../map/urlState";
import { visibleTiles } from "../../map/view";
import { surfacePoint, type Patch } from "./MoonScene";

const SEGMENTS = 96;
const MAX_TILES = 220;

function levelFor(g: TileGridDef, widthUnits: number, px: number): number {
  for (let z = g.minZ; z <= g.maxZ; z++) {
    if (widthUnits / (tileSpan(g, z)[0] / g.tileSize) >= px) return z;
  }
  return g.maxZ;
}

function mesh(proj: Projection, b: [number, number, number, number], round: boolean, canvas: HTMLCanvasElement, lift: number): Patch {
  const n = SEGMENTS;
  const positions = new Float32Array((n + 1) * (n + 1) * 3);
  const uvs = new Float32Array((n + 1) * (n + 1) * 2);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = b[0] + ((b[2] - b[0]) * i) / n;
      const y = b[1] + ((b[3] - b[1]) * j) / n;
      const [lat, lon] = proj.inverse(x, y);
      const k = j * (n + 1) + i;
      positions.set(surfacePoint(lat, lon, 1 + lift), k * 3);
      uvs.set([i / n, j / n], k * 2);
    }
  }
  const index = new Uint32Array(n * n * 6);
  let o = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      const c = a + n + 1;
      index.set([a, a + 1, c, a + 1, c + 1, c], o);
      o += 6;
    }
  }
  return { positions, uvs, index, canvas, round };
}

const CACHE_MAX = 600;
const cache = new Map<string, Promise<ImageBitmap | null>>();

function tile(url: string, signal: AbortSignal): Promise<ImageBitmap | null> {
  const hit = cache.get(url);
  if (hit) {
    cache.delete(url);
    cache.set(url, hit);
    return hit;
  }
  const p = fetchTileBitmap(url, new AbortController().signal).catch(() => null);
  cache.set(url, p);
  p.then((b) => {
    if (!b) cache.delete(url);
  });
  while (cache.size > CACHE_MAX) {
    const [k, v] = cache.entries().next().value as [string, Promise<ImageBitmap | null>];
    cache.delete(k);
    v.then((b) => b?.close());
  }
  return signal.aborted ? Promise.resolve(null) : p;
}

async function draw(ts: TilesetDef, renderVersion: string, g: TileGridDef, b: [number, number, number, number], z: number, cx: number, cy: number, signal: AbortSignal): Promise<HTMLCanvasElement> {
  const upp = tileSpan(g, z)[0] / g.tileSize;
  const vpp = tileSpan(g, z)[1] / g.tileSize;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.min(4096, Math.ceil((b[2] - b[0]) / upp)));
  canvas.height = Math.max(1, Math.min(4096, Math.ceil((b[3] - b[1]) / vpp)));
  const sx = canvas.width / ((b[2] - b[0]) / upp);
  const sy = canvas.height / ((b[3] - b[1]) / vpp);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const tiles = visibleTiles(g, z, b, cx, cy, MAX_TILES);
  await Promise.all(
    tiles.map(async (t) => {
      const bmp = await tile(tileUrl(ts, renderVersion, "relief", t.z, t.x, t.y), signal);
      if (!bmp || signal.aborted) return;
      const tb = tileBounds(g, t.z, t.x, t.y);
      const x = ((tb[0] - b[0]) / upp) * sx;
      const y = ((b[3] - tb[3]) / vpp) * sy;
      try {
        ctx.drawImage(bmp, x, y, g.tileSize * sx + 0.5, g.tileSize * sy + 0.5);
      } catch {
        return;
      }
    }),
  );
  return canvas;
}

export async function polarCap(kind: "south" | "north", tilesets: readonly TilesetDef[], renderVersion: string, signal: AbortSignal): Promise<Patch | null> {
  const basis = basisFor(kind, tilesets);
  if (!basis.tileset) return null;
  const edge = Math.abs(basis.proj.forward(kind === "south" ? -68 : 68, 0)[1]);
  const b: [number, number, number, number] = [-edge, -edge, edge, edge];
  const z = levelFor(basis.grid, 2 * edge, 2048);
  const canvas = await draw(basis.tileset, renderVersion, basis.grid, b, z, 0, 0, signal);
  return mesh(basis.proj, b, true, canvas, 4e-5);
}

export async function viewPatch(tilesets: readonly TilesetDef[], renderVersion: string, lat_deg: number, lon_deg: number, half_m: number, px: number, signal: AbortSignal): Promise<Patch | null> {
  const kind: ViewKind = viewKindFor(lat_deg);
  const basis = basisFor(kind, tilesets);
  if (!basis.tileset) return null;
  const [cx, cy] = basis.proj.forward(lat_deg, lon_deg);
  const gpu = basis.proj.groundPerUnit(lat_deg);
  const hx = half_m / gpu.x;
  const hy = half_m / gpu.y;
  const b: [number, number, number, number] = [cx - hx, cy - hy, cx + hx, cy + hy];
  const z = levelFor(basis.grid, 2 * hx, px);
  const canvas = await draw(basis.tileset, renderVersion, basis.grid, b, z, cx, cy, signal);
  return mesh(basis.proj, b, false, canvas, 5e-5);
}
