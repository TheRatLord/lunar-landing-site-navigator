import { clamp } from "../../lib/scale";

interface LabelRequest {
  ax: number;
  ay: number;
  gap: number;
  w: number;
  h: number;
  side?: "left" | "right";
}

interface PlacedLabel {
  x: number;
  y: number;
  leader: [number, number] | null;
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Rect, b: Rect, pad: number) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

const LABEL_PAD = 3;

const nearest = (box: Rect, x: number, y: number): [number, number] => [clamp(x, box.x, box.x + box.w), clamp(y, box.y, box.y + box.h)];

function segmentHits(x0: number, y0: number, x1: number, y1: number, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  for (const [p, q] of [
    [-dx, x0 - r.x],
    [dx, r.x + r.w - x0],
    [-dy, y0 - r.y],
    [dy, r.y + r.h - y0],
  ] as const) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

function leaderCrosses(r: LabelRequest, box: Rect, others: readonly Rect[]): boolean {
  const [nx, ny] = nearest(box, r.ax, r.ay);
  if (Math.hypot(nx - r.ax, ny - r.ay) <= r.gap + 9) return false;
  return others.some((o) => segmentHits(r.ax, r.ay, nx, ny, o));
}

export function placeLabels(requests: readonly LabelRequest[], bounds: Bounds): PlacedLabel[] {
  const taken: Rect[] = requests.map((r) => ({ x: r.ax - r.gap, y: r.ay - r.gap, w: 2 * r.gap, h: 2 * r.gap }));
  const placed: Rect[] = [];
  const out: PlacedLabel[] = [];

  for (const [i, r] of requests.entries()) {
    const own = taken[i]!;
    const others = [...taken.filter((_, j) => j !== i), ...placed];
    const step = r.h + 2;
    const candidates: Array<[number, number]> = [];
    for (let ring = 0; ring < 8; ring++) {
      const dx = r.gap + 5 + ring * 6;
      const dy = ring * step;
      const right: Array<[number, number]> = [[r.ax + dx, r.ay - r.h / 2 - dy], [r.ax + dx, r.ay - r.h / 2 + dy]];
      const left: Array<[number, number]> = [[r.ax - dx - r.w, r.ay - r.h / 2 - dy], [r.ax - dx - r.w, r.ay - r.h / 2 + dy]];
      candidates.push(...(r.side === "left" ? [...left, ...right] : [...right, ...left]));
      candidates.push([r.ax - r.w / 2, r.ay - r.gap - 4 - r.h - ring * step], [r.ax - r.w / 2, r.ay + r.gap + 4 + ring * step]);
    }
    let best: Rect | null = null;
    for (const strict of [true, false]) {
      for (const [x, y] of candidates) {
        const box = { x, y, w: r.w, h: r.h };
        if (box.x < bounds.x0 || box.y < bounds.y0 || box.x + box.w > bounds.x1 || box.y + box.h > bounds.y1) continue;
        if (overlaps(box, own, 0) || others.some((o) => overlaps(box, o, LABEL_PAD)) || (strict && leaderCrosses(r, box, placed))) continue;
        best = box;
        break;
      }
      if (best) break;
    }
    best ??= {
      x: clamp(r.ax + r.gap + 5, bounds.x0, bounds.x1 - r.w),
      y: clamp(r.ay - r.h / 2, bounds.y0, bounds.y1 - r.h),
      w: r.w,
      h: r.h,
    };
    placed.push(best);
    const [nx, ny] = nearest(best, r.ax, r.ay);
    out.push({ x: best.x, y: best.y, leader: Math.hypot(nx - r.ax, ny - r.ay) > r.gap + 9 ? [nx, ny] : null });
  }
  return out;
}
