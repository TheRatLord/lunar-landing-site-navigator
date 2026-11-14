import { polarInverse, type Projection } from "../../lib/projection";
import { wrap180 } from "../../lib/scale";
import { overlaps, type Rect } from "./footprints";
import { toScreenX, toScreenY, type Frame } from "./view";

interface GraticuleLine {
  kind: "lat" | "lon";
  value: number;
  major: boolean;
  pts: number[];
}

export interface GraticuleLabel {
  text: string;
  x: number;
  y: number;
  align: "left" | "center" | "right";
  baseline: "top" | "middle" | "bottom";
}

export interface Graticule {
  lines: GraticuleLine[];
  labels: GraticuleLabel[];
  latStep: number;
  lonStep: number;
}

const STEPS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 45, 90];
const MIN_PX = 70;
const D2R = Math.PI / 180;

function chooseStep(pxPerDeg: number, minPx = MIN_PX): number {
  for (const s of STEPS) if (s * pxPerDeg >= minPx) return s;
  return STEPS[STEPS.length - 1]!;
}

function decimalsFor(step: number): number {
  return step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step) - 1e-9));
}

function formatLatLabel(lat: number, step: number): string {
  const v = Math.abs(lat).toFixed(decimalsFor(step));
  return lat === 0 ? "0°" : `${v}°${lat < 0 ? "S" : "N"}`;
}

function formatLonLabel(lon: number, step: number): string {
  const v = Math.abs(lon).toFixed(decimalsFor(step));
  return lon === 0 || Math.abs(lon) === 180 ? `${v}°` : `${v}°${lon < 0 ? "W" : "E"}`;
}

function multiples(step: number, lo: number, hi: number, max = 80): number[] {
  const out: number[] = [];
  const k0 = Math.ceil(lo / step - 1e-9);
  const k1 = Math.floor(hi / step + 1e-9);
  for (let k = k0; k <= k1 && out.length < max; k++) out.push(Math.round(k * step * 1e9) / 1e9);
  return out;
}

type Edge = "left" | "right" | "top" | "bottom";

function crossing(pts: number[], edge: Edge, w: number, h: number): { x: number; y: number } | null {
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const x0 = pts[i]!;
    const y0 = pts[i + 1]!;
    const x1 = pts[i + 2]!;
    const y1 = pts[i + 3]!;
    let t = -1;
    if (edge === "left" && (x0 - 0) * (x1 - 0) <= 0 && x0 !== x1) t = (0 - x0) / (x1 - x0);
    else if (edge === "right" && (x0 - w) * (x1 - w) <= 0 && x0 !== x1) t = (w - x0) / (x1 - x0);
    else if (edge === "top" && (y0 - 0) * (y1 - 0) <= 0 && y0 !== y1) t = (0 - y0) / (y1 - y0);
    else if (edge === "bottom" && (y0 - h) * (y1 - h) <= 0 && y0 !== y1) t = (h - y0) / (y1 - y0);
    if (t < 0 || t > 1) continue;
    const x = x0 + t * (x1 - x0);
    const y = y0 + t * (y1 - y0);
    if (x >= -0.5 && x <= w + 0.5 && y >= -0.5 && y <= h + 0.5) return { x, y };
  }
  return null;
}

const EDGE_PREF: Record<GraticuleLine["kind"], Edge[]> = {
  lat: ["left", "right", "bottom", "top"],
  lon: ["top", "bottom", "left", "right"],
};

function labelFor(line: GraticuleLine, text: string, w: number, h: number): GraticuleLabel | null {
  for (const edge of EDGE_PREF[line.kind]) {
    const c = crossing(line.pts, edge, w, h);
    if (!c) continue;
    switch (edge) {
      case "left":
        return { text, x: 5, y: c.y - 2, align: "left", baseline: "bottom" };
      case "right":
        return { text, x: w - 5, y: c.y - 2, align: "right", baseline: "bottom" };
      case "top":
        return { text, x: c.x + 3, y: 4, align: "left", baseline: "top" };
      case "bottom":
        return { text, x: c.x + 3, y: h - 4, align: "left", baseline: "bottom" };
    }
  }
  let best = -1;
  let bi = -1;
  for (let i = 0; i + 1 < line.pts.length; i += 2) {
    const x = line.pts[i]!;
    const y = line.pts[i + 1]!;
    if (x < 4 || x > w - 4 || y < 4 || y > h - 4) continue;
    const score = line.kind === "lat" ? -x : (x - w / 2) ** 2 + (y - h / 2) ** 2;
    if (score > best || bi < 0) {
      best = score;
      bi = i;
    }
  }
  if (bi < 0) return null;
  const x = line.pts[bi]!;
  const y = line.pts[bi + 1]!;
  return line.kind === "lat"
    ? { text, x: x + 4, y: y - 2, align: "left", baseline: "bottom" }
    : { text, x: x, y: y - 4, align: "center", baseline: "bottom" };
}

export function dropOverlaps(labels: GraticuleLabel[], obstacles: readonly Rect[] = [], charW = 6.2, lineH = 15): GraticuleLabel[] {
  const rects: Rect[] = [];
  const out: GraticuleLabel[] = [];
  for (const l of labels) {
    const w = l.text.length * charW + 4;
    const x0 = l.align === "left" ? l.x : l.align === "right" ? l.x - w : l.x - w / 2;
    const y0 = l.baseline === "top" ? l.y : l.baseline === "bottom" ? l.y - lineH : l.y - lineH / 2;
    const r: Rect = [x0, y0, x0 + w, y0 + lineH];
    if (rects.some((q) => overlaps(r, q)) || obstacles.some((q) => overlaps(r, q))) continue;
    rects.push(r);
    out.push(l);
  }
  return out;
}

function polarLonRange(proj: Projection, f: Frame): [number, number] | null {
  const hem = proj.hemisphere!;
  const x0 = f.x0;
  const x1 = f.x0 + f.vw * f.upp;
  const y1 = f.y0;
  const y0 = f.y0 - f.vh * f.upp;
  if (x0 <= 0 && x1 >= 0 && y0 <= 0 && y1 >= 0) return null;
  const lonOf = (x: number, y: number) => polarInverse(hem, x, y, proj.R).lon_deg;
  const c = lonOf((x0 + x1) / 2, (y0 + y1) / 2);
  let dmin = 0;
  let dmax = 0;
  const ring: Array<[number, number]> = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    ring.push([x0 + t * (x1 - x0), y0], [x0 + t * (x1 - x0), y1], [x0, y0 + t * (y1 - y0)], [x1, y0 + t * (y1 - y0)]);
  }
  for (const [x, y] of ring) {
    const d = wrap180(lonOf(x, y) - c);
    dmin = Math.min(dmin, d);
    dmax = Math.max(dmax, d);
  }
  return [c + dmin, c + dmax];
}

function poleDistanceRange(f: Frame): [number, number] {
  const x0 = f.x0;
  const x1 = f.x0 + f.vw * f.upp;
  const y1 = f.y0;
  const y0 = f.y0 - f.vh * f.upp;
  const lo = Math.hypot(Math.min(Math.max(0, x0), x1), Math.min(Math.max(0, y0), y1));
  const hi = Math.max(Math.hypot(x0, y0), Math.hypot(x0, y1), Math.hypot(x1, y0), Math.hypot(x1, y1));
  return [lo, hi];
}

function polarGraticule(proj: Projection, f: Frame, rhoMax: number): Graticule {
  const hem = proj.hemisphere!;
  const R = proj.R;
  const [rLo, rHiRaw] = poleDistanceRange(f);
  const rHi = Math.min(rHiRaw, rhoMax);
  const colat = (rho: number) => 2 * Math.atan(rho / (2 * R)) / D2R;
  const rhoOf = (c: number) => 2 * R * Math.tan((c * D2R) / 2);
  const cLo = colat(rLo);
  const cHi = colat(rHi);
  const rMidMap = rLo === 0 ? rHi * 0.6 : (rLo + rHi) / 2;
  const cMid = colat(rMidMap);
  const pxPerDegLat = (R / Math.cos((cMid * D2R) / 2) ** 2) * D2R / f.upp;
  const latStep = chooseStep(pxPerDegLat);
  const pxPerDegLon = (rMidMap * D2R) / f.upp;
  const lonStep = chooseStep(Math.max(pxPerDegLon, 1e-9));

  const px = toScreenX(f, 0);
  const py = toScreenY(f, 0);
  const lonRange = polarLonRange(proj, f);
  const lines: GraticuleLine[] = [];

  for (const c of multiples(latStep, Math.max(cLo, 1e-9), cHi)) {
    if (c <= 0 || c >= 180) continue;
    const r = rhoOf(c) / f.upp;
    const [a, b] = lonRange ?? [-180, 180];
    const n = Math.max(2, Math.min(720, Math.ceil(((b - a) * D2R * r) / 8)));
    const pts: number[] = [];
    for (let i = 0; i <= n; i++) {
      const lam = (a + ((b - a) * i) / n) * D2R;
      pts.push(px + r * Math.sin(lam), py + (hem === "south" ? -r * Math.cos(lam) : r * Math.cos(lam)));
    }
    lines.push({ kind: "lat", value: hem === "south" ? -90 + c : 90 - c, major: Math.round(c / latStep) % 5 === 0, pts });
  }

  const lonLo = lonRange ? lonRange[0] : -180;
  const lonHi = lonRange ? lonRange[1] : 180;
  const innerR = Math.max(rLo, 0) / f.upp;
  const outerR = rHi / f.upp;
  const lonValues = lonRange ? multiples(lonStep, lonLo, lonHi) : multiples(lonStep, -180, 180 - lonStep * 0.5);
  for (const lon of lonValues) {
    const lam = lon * D2R;
    const dx = Math.sin(lam);
    const dy = hem === "south" ? -Math.cos(lam) : Math.cos(lam);
    const pts = [px + dx * innerR, py + dy * innerR, px + dx * outerR, py + dy * outerR];
    lines.push({ kind: "lon", value: wrap180(lon), major: Math.round(lon / lonStep) % 5 === 0, pts });
  }
  return { lines, labels: [], latStep, lonStep };
}

function globalGraticule(f: Frame, extent: [number, number, number, number]): Graticule {
  const latStep = chooseStep(1 / f.upp);
  const lonStep = latStep;
  const lines: GraticuleLine[] = [];
  const mx0 = Math.max(f.x0, extent[0]);
  const mx1 = Math.min(f.x0 + f.vw * f.upp, extent[2]);
  const my1 = Math.min(f.y0, extent[3]);
  const my0 = Math.max(f.y0 - f.vh * f.upp, extent[1]);
  if (mx0 >= mx1 || my0 >= my1) return { lines, labels: [], latStep, lonStep };
  for (const lat of multiples(latStep, my0, my1)) {
    const y = toScreenY(f, lat);
    lines.push({ kind: "lat", value: lat, major: Math.round(lat / latStep) % 5 === 0, pts: [toScreenX(f, mx0), y, toScreenX(f, mx1), y] });
  }
  for (const lon of multiples(lonStep, mx0, mx1)) {
    const x = toScreenX(f, lon);
    lines.push({ kind: "lon", value: lon, major: Math.round(lon / lonStep) % 5 === 0, pts: [x, toScreenY(f, my1), x, toScreenY(f, my0)] });
  }
  return { lines, labels: [], latStep, lonStep };
}

export function buildGraticule(proj: Projection, f: Frame, extent: [number, number, number, number]): Graticule {
  const g =
    proj.kind === "polar-stereographic"
      ? polarGraticule(proj, f, Math.hypot(Math.max(Math.abs(extent[0]), Math.abs(extent[2])), Math.max(Math.abs(extent[1]), Math.abs(extent[3]))))
      : globalGraticule(f, extent);
  const raw: GraticuleLabel[] = [];
  for (const line of g.lines) {
    const text = line.kind === "lat" ? formatLatLabel(line.value, g.latStep) : formatLonLabel(line.value, g.lonStep);
    const l = labelFor(line, text, f.vw, f.vh);
    if (l) raw.push(l);
  }
  g.labels = dropOverlaps(raw);
  return g;
}
