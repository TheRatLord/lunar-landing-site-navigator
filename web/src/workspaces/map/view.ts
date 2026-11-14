import { tileSpan, type TileGridDef } from "../../lib/projection";
import { clamp } from "../../lib/scale";

export interface MapView {
  cx: number;
  cy: number;
  zoom: number;
}

export interface Viewport {
  w: number;
  h: number;
}

export interface Frame {
  vw: number;
  vh: number;
  upp: number;
  x0: number;
  y0: number;
  zoom: number;
}

function unitsPerPx(g: TileGridDef, zoom: number): number {
  return tileSpan(g, 0)[0] / g.tileSize / 2 ** zoom;
}

export function makeFrame(g: TileGridDef, v: MapView, vp: Viewport): Frame {
  const upp = unitsPerPx(g, v.zoom);
  return { vw: vp.w, vh: vp.h, upp, x0: v.cx - (vp.w / 2) * upp, y0: v.cy + (vp.h / 2) * upp, zoom: v.zoom };
}

export const toScreenX = (f: Frame, mx: number): number => (mx - f.x0) / f.upp;
export const toScreenY = (f: Frame, my: number): number => (f.y0 - my) / f.upp;
export const toMapX = (f: Frame, sx: number): number => f.x0 + sx * f.upp;
export const toMapY = (f: Frame, sy: number): number => f.y0 - sy * f.upp;

export function viewBounds(f: Frame): [number, number, number, number] {
  return [f.x0, f.y0 - f.vh * f.upp, f.x0 + f.vw * f.upp, f.y0];
}

/** The closest zoom the map allows: three levels past the finest tiles. */
export function maxZoomOf(g: TileGridDef): number {
  return g.maxZ + 3;
}

function clampZoom(g: TileGridDef, vp: Viewport, zoom: number): number {
  const [w0, h0] = tileSpan(g, 0);
  const extW = (g.extent[2] - g.extent[0]) / (w0 / g.tileSize);
  const extH = (g.extent[3] - g.extent[1]) / (h0 / g.tileSize);
  const fit = Math.log2(Math.max(1, Math.min(vp.w / extW, vp.h / extH)));
  return clamp(zoom, fit - 0.35, maxZoomOf(g));
}

export function clampView(g: TileGridDef, vp: Viewport, v: MapView): MapView {
  return { zoom: clampZoom(g, vp, v.zoom), cx: clamp(v.cx, g.extent[0], g.extent[2]), cy: clamp(v.cy, g.extent[1], g.extent[3]) };
}

export function zoomAbout(g: TileGridDef, vp: Viewport, v: MapView, sx: number, sy: number, zoom: number): MapView {
  const z = clampZoom(g, vp, zoom);
  const f = makeFrame(g, v, vp);
  const mx = toMapX(f, sx);
  const my = toMapY(f, sy);
  const upp = unitsPerPx(g, z);
  return clampView(g, vp, { zoom: z, cx: mx - (sx - vp.w / 2) * upp, cy: my + (sy - vp.h / 2) * upp });
}

export function panBy(g: TileGridDef, vp: Viewport, v: MapView, dx: number, dy: number): MapView {
  const upp = unitsPerPx(g, v.zoom);
  return clampView(g, vp, { zoom: v.zoom, cx: v.cx - dx * upp, cy: v.cy + dy * upp });
}

export function fitBounds(g: TileGridDef, vp: Viewport, bounds: [number, number, number, number], padPx = 48, maxZoom?: number): MapView {
  const bw = Math.max(bounds[2] - bounds[0], 1e-9);
  const bh = Math.max(bounds[3] - bounds[1], 1e-9);
  const availW = Math.max(32, vp.w - 2 * padPx);
  const availH = Math.max(32, vp.h - 2 * padPx);
  const upp = Math.max(bw / availW, bh / availH);
  const zoom = Math.log2(tileSpan(g, 0)[0] / g.tileSize / upp);
  const z = Math.min(clampZoom(g, vp, zoom), maxZoom ?? Infinity);
  return clampView(g, vp, { zoom: z, cx: (bounds[0] + bounds[2]) / 2, cy: (bounds[1] + bounds[3]) / 2 });
}

export const fitExtent = (g: TileGridDef, vp: Viewport): MapView => fitBounds(g, vp, g.extent, 8);

export function tileLevel(g: TileGridDef, zoom: number, dpr = 1): number {
  return clamp(Math.ceil(zoom + Math.log2(clamp(dpr, 1, 2)) - 0.4), g.minZ, g.maxZ);
}

export interface TileRef {
  z: number;
  x: number;
  y: number;
}

export function visibleTiles(g: TileGridDef, z: number, bounds: [number, number, number, number], cx: number, cy: number, limit = 400): TileRef[] {
  const [w, h] = tileSpan(g, z);
  const nx = Math.round((g.extent[2] - g.extent[0]) / w);
  const ny = Math.round((g.extent[3] - g.extent[1]) / h);
  const x0 = Math.max(0, Math.floor((bounds[0] - g.extent[0]) / w));
  const x1 = Math.min(nx - 1, Math.floor((bounds[2] - g.extent[0]) / w));
  const y0 = Math.max(0, Math.floor((g.extent[3] - bounds[3]) / h));
  const y1 = Math.min(ny - 1, Math.floor((g.extent[3] - bounds[1]) / h));
  const out: Array<TileRef & { d: number }> = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const mx = g.extent[0] + (x + 0.5) * w;
      const my = g.extent[3] - (y + 0.5) * h;
      out.push({ z, x, y, d: (mx - cx) ** 2 + (my - cy) ** 2 });
    }
  }
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, limit).map(({ z: tz, x, y }) => ({ z: tz, x, y }));
}
