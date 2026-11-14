import type { Projection } from "../../lib/projection";

export function projectRing(ring: ReadonlyArray<ReadonlyArray<number>>, proj: Projection, maxStepDeg = 0.25, maxSegs = 400): Float64Array {
  const out: number[] = [];
  let prev: [number, number] | null = null;
  let prevLon = 0;
  let prevLat = 0;
  const push = (lat: number, lon: number): void => {
    const [x, y] = proj.forward(lat, lon);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e8 || Math.abs(y) > 1e8) {
      if (prev) out.push(NaN, NaN);
      prev = null;
      return;
    }
    if (prev && proj.kind === "equirectangular" && Math.abs(x - prev[0]) > 180) out.push(NaN, NaN);
    out.push(x, y);
    prev = [x, y];
  };
  ring.forEach((v, i) => {
    const lon = v[0]!;
    const lat = v[1]!;
    if (i > 0) {
      const dLon = Math.abs(lon - prevLon);
      const n = Math.min(maxSegs, Math.ceil(Math.max(Math.min(dLon, 360 - dLon), Math.abs(lat - prevLat)) / maxStepDeg));
      for (let k = 1; k < n; k++) {
        const t = k / n;
        push(prevLat + (lat - prevLat) * t, prevLon + (lon - prevLon) * t);
      }
    }
    push(lat, lon);
    prevLon = lon;
    prevLat = lat;
  });
  return Float64Array.from(out);
}

export function pointsBounds(pts: Float64Array): [number, number, number, number] | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i]!;
    const y = pts[i + 1]!;
    if (Number.isNaN(x)) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x0 === Infinity ? null : [x0, y0, x1, y1];
}

export interface LabelCandidate {
  id: string;
  x: number;
  y: number;
  textW: number;
  footprintW: number;
  footprintH: number;
}

export type Rect = readonly [number, number, number, number];

export interface PlacedLabel {
  id: string;
  x: number;
  y: number;
}

const LABEL_PAD = 2;
const LABEL_FIT_MARGIN = 12;
const LABEL_H = 13;
const MOVE_STEP = 14;
const MAX_MOVES = 3;

export const overlaps = (a: Rect, b: Rect): boolean => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

export function selectFootprintLabels(cands: readonly LabelCandidate[], obstacles: readonly Rect[] = []): PlacedLabel[] {
  const placed: Rect[] = [];
  const out: PlacedLabel[] = [];
  for (const c of [...cands].sort((a, b) => b.footprintW - a.footprintW || a.id.localeCompare(b.id))) {
    if (c.footprintW < c.textW + LABEL_FIT_MARGIN) continue;
    for (let k = 0; k <= MAX_MOVES; k++) {
      const dy = k * MOVE_STEP;
      if (dy + LABEL_H + 2 > c.footprintH && k > 0) break;
      const y = c.y + dy;
      const r: Rect = [c.x - c.textW / 2 - LABEL_PAD, y - LABEL_H - 1, c.x + c.textW / 2 + LABEL_PAD, y - 1];
      if (k === 0 && placed.some((q) => overlaps(r, q))) break;
      if (placed.some((q) => overlaps(r, q)) || obstacles.some((q) => overlaps(r, q))) continue;
      placed.push(r);
      out.push({ id: c.id, x: c.x, y });
      break;
    }
  }
  return out;
}
