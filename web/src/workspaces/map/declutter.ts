import { overlaps, type Rect } from "./footprints";

export interface ClusterPoint {
  id: string;
  x: number;
  y: number;
  prio: number;
}

export interface Cluster<T extends ClusterPoint> {
  x: number;
  y: number;
  members: T[];
}

export function clusterPoints<T extends ClusterPoint>(pts: readonly T[], radius: number): Cluster<T>[] {
  const out: Cluster<T>[] = [];
  for (const p of [...pts].sort((a, b) => b.prio - a.prio || a.id.localeCompare(b.id))) {
    let best: Cluster<T> | null = null;
    let bestD = radius;
    for (const c of out) {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bestD) {
        best = c;
        bestD = d;
      }
    }
    if (best) best.members.push(p);
    else out.push({ x: p.x, y: p.y, members: [p] });
  }
  return out;
}

const CORNERS: ReadonlyArray<readonly [number, number]> = [
  [-1, 1],
  [1, 1],
  [-1, -1],
  [1, -1],
];

export function badgeSpot(x: number, y: number, bubble: number, badge: number, marks: readonly Rect[], blocked: readonly Rect[]): { x: number; y: number } | null {
  const host = marks.find((m) => Math.hypot(x - (m[0] + m[2]) / 2, y - (m[1] + m[3]) / 2) < (m[2] - m[0]) / 2 + bubble);
  if (!host) return null;
  const k = (host[2] - host[0]) * 0.35 + 5;
  const spots = CORNERS.map(([dx, dy]) => ({ x: (host[0] + host[2]) / 2 + dx * k, y: (host[1] + host[3]) / 2 + dy * k }));
  const free = spots.find((s) => {
    const r: Rect = [s.x - badge, s.y - badge, s.x + badge, s.y + badge];
    return !marks.some((m) => m !== host && overlaps(r, m)) && !blocked.some((q) => overlaps(r, q));
  });
  return free ?? spots[0]!;
}

export interface LabelBox {
  id: string;
  x: number;
  y: number;
  r: number;
  w: number;
  must: boolean;
}

export interface LabelSpot {
  id: string;
  x: number;
  y: number;
  align: "left" | "right" | "center";
}

const PAD_X = 3;
const ASCENT = 12;
const DESCENT = 4;

function spotRect(s: LabelSpot, w: number): Rect {
  const x0 = s.align === "left" ? s.x : s.align === "right" ? s.x - w : s.x - w / 2;
  return [x0 - PAD_X, s.y - ASCENT, x0 + w + PAD_X, s.y + DESCENT];
}

export function placeLabels(cands: readonly LabelBox[], obstacles: readonly Rect[], w: number, h: number, max: number): { spots: LabelSpot[]; rects: Rect[] } {
  const spots: LabelSpot[] = [];
  const rects: Rect[] = [];
  for (const c of cands) {
    if (spots.length >= max) break;
    const side = c.r + 4;
    const above = c.y - c.r - 5;
    const below = c.y + c.r + 13;
    const options: LabelSpot[] = [
      { id: c.id, x: c.x + side, y: c.y + 4, align: "left" },
      { id: c.id, x: c.x - side, y: c.y + 4, align: "right" },
      { id: c.id, x: c.x, y: above, align: "center" },
      { id: c.id, x: c.x, y: below, align: "center" },
      { id: c.id, x: c.x + 2, y: above, align: "left" },
      { id: c.id, x: c.x + 2, y: below, align: "left" },
      { id: c.id, x: c.x - 2, y: above, align: "right" },
      { id: c.id, x: c.x - 2, y: below, align: "right" },
    ];
    let spot: LabelSpot | null = null;
    let fewest = Infinity;
    for (const o of options) {
      const r = spotRect(o, c.w);
      if (r[0] < 0 || r[1] < 0 || r[2] > w || r[3] > h || rects.some((q) => overlaps(r, q))) continue;
      const n = obstacles.reduce((k, q) => k + (overlaps(r, q) ? 1 : 0), 0);
      if (n >= fewest || (n > 0 && !c.must)) continue;
      spot = o;
      fewest = n;
      if (n === 0) break;
    }
    spot ??= c.must ? options[0]! : null;
    if (!spot) continue;
    spots.push(spot);
    rects.push(spotRect(spot, c.w));
  }
  return { spots, rects };
}
