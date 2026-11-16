import type { EllipseSamples } from "../../api/ellipse";
import type { EvaluateResult } from "../../api/site";
import type { HorizonProfile, Interval, TargetTrack } from "../../contract/types";
import { destination } from "../../lib/projection";
import { lowerBound } from "../../lib/scale";
import { adaptHorizon, adaptTrack } from "../site/adapt";
import { adaptSurvey } from "../home/survey";
import { cellOf, cellShade, latticeAt, type CellStatus, type Lattice } from "../search/lattice";
import type { SiteState } from "../../api/search";
import type { GridLayer, SampleDot, SkyLayer, SkyRay } from "./engine";

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const compassWord = (az: number): string => COMPASS[Math.round((((az % 360) + 360) % 360) / 45) % 8]!;

export function kmText(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

function rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function gridLayer(l: Lattice, faded: boolean): GridLayer {
  const nx = l.east.length;
  const ny = l.north.length;
  const rgba = new Uint8ClampedArray(nx * ny * 4);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = cellOf(l, i, j);
      if (!c) continue;
      const { hex, alpha } = cellShade(c);
      const [r, g, b] = rgb(hex);
      const k = (j * nx + i) * 4;
      rgba[k] = r;
      rgba[k + 1] = g;
      rgba[k + 2] = b;
      rgba[k + 3] = Math.round(alpha * 255);
    }
  }
  const de = nx > 1 ? l.east[1]! - l.east[0]! : l.spacing_m;
  const dn = ny > 1 ? l.north[1]! - l.north[0]! : l.spacing_m;
  return { nx, ny, rgba, faded, node: (i, j) => latticeAt(l, l.east[0]! + i * de, l.north[0]! + j * dn) };
}

export type CellCounts = Record<SiteState | "steep" | "screened", number>;

export function cellCounts(l: Lattice): CellCounts {
  const out: CellCounts = { pass: 0, marginal: 0, fail: 0, unknown: 0, steep: 0, screened: 0 };
  const word: Record<CellStatus, keyof CellCounts | null> = { outside: null, unchecked: "screened", screened: "screened", steep: "steep", full: null };
  for (let j = 0; j < l.north.length; j++) {
    for (let i = 0; i < l.east.length; i++) {
      const c = cellOf(l, i, j);
      if (!c) continue;
      const k = word[c.status] ?? c.state;
      out[k]++;
    }
  }
  return out;
}

const inside = (ivs: readonly Interval[], t: number): boolean => ivs.some((iv) => t >= iv.start_ms && t < iv.end_ms);

function trackAt(tr: TargetTrack, t: number): { az: number; el: number } | null {
  const n = tr.utc_ms.length;
  if (n === 0) return null;
  const k = Math.min(Math.max(lowerBound(tr.utc_ms, t), 1), n - 1);
  const a = k - 1;
  const span = tr.utc_ms[k]! - tr.utc_ms[a]!;
  const f = span > 0 ? Math.min(1, Math.max(0, (t - tr.utc_ms[a]!) / span)) : 0;
  let d = tr.az_deg[k]! - tr.az_deg[a]!;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  const az = (((tr.az_deg[a]! + d * f) % 360) + 360) % 360;
  const el = tr.el_deg[a]! + (tr.el_deg[k]! - tr.el_deg[a]!) * f;
  return Number.isFinite(az) && Number.isFinite(el) ? { az, el } : null;
}

function ridgeAt(h: HorizonProfile, az: number): { el: number; dist: number | null } | null {
  const n = h.az_deg.length;
  if (n === 0) return null;
  let best = 0;
  let bestD = Infinity;
  for (let k = 0; k < n; k++) {
    const d = Math.abs(((h.az_deg[k]! - az + 540) % 360) - 180);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  const dist = h.blocker_dist_m[best]!;
  return { el: h.elev_deg[best]!, dist: Number.isFinite(dist) && dist > 0 ? dist : null };
}

export interface BodyNow {
  body: "sun" | "earth";
  open: boolean;
  behind: boolean;
  el_deg: number;
  az_deg: number;
  ridge_el_deg: number | null;
  ridge_m: number | null;
}

export interface Sky {
  smooth: boolean;
  start_ms: number;
  end_ms: number;
  sun: Interval[];
  earth: Interval[];
  sunTrack: TargetTrack | null;
  earthTrack: TargetTrack | null;
  array: HorizonProfile | null;
  antenna: HorizonProfile | null;
}

export function adaptSky(r: EvaluateResult, start_ms: number, end_ms: number): Sky {
  const sv = adaptSurvey(r, start_ms, end_ms);
  const arr = r.horizons?.["array"];
  const ant = r.horizons?.["antenna"];
  return {
    smooth: sv.smooth,
    start_ms,
    end_ms,
    sun: sv.sun,
    earth: sv.earth,
    sunTrack: adaptTrack(r.series, "sun"),
    earthTrack: adaptTrack(r.series, "earth"),
    array: arr ? adaptHorizon(arr) : null,
    antenna: ant ? adaptHorizon(ant) : arr ? adaptHorizon(arr) : null,
  };
}

export function bodiesAt(sky: Sky, t: number): BodyNow[] {
  const out: BodyNow[] = [];
  const add = (body: "sun" | "earth", tr: TargetTrack | null, h: HorizonProfile | null, ivs: readonly Interval[]) => {
    const pos = tr ? trackAt(tr, t) : null;
    if (!pos) return;
    const ridge = h ? ridgeAt(h, pos.az) : null;
    const behind = !sky.smooth && ridge !== null && pos.el < ridge.el;
    out.push({ body, open: inside(ivs, t), behind, el_deg: pos.el, az_deg: pos.az, ridge_el_deg: ridge?.el ?? null, ridge_m: sky.smooth ? null : (ridge?.dist ?? null) });
  };
  add("sun", sky.sunTrack, sky.array, sky.sun);
  add("earth", sky.earthTrack, sky.antenna, sky.earth);
  return out;
}

export function bodyWords(b: BodyNow): { name: string; state: string; detail: string } {
  const name = b.body === "sun" ? "Sun" : "Earth";
  const state = b.body === "sun" ? (b.open ? "Lit" : "Dark") : b.open ? "Link" : "No link";
  if (b.ridge_el_deg === null) return { name, state, detail: `${b.el_deg.toFixed(1)}° up` };
  const gap = b.el_deg - b.ridge_el_deg;
  return { name, state, detail: `${Math.abs(gap).toFixed(1)}° ${gap >= 0 ? "above" : "below"} the ridge` };
}

export function skyLayer(lat_deg: number, lon_deg: number, sky: Sky, bodies: readonly BodyNow[]): SkyLayer {
  let outline: Array<Array<[number, number]>> | null = null;
  const h = sky.array;
  if (h && !sky.smooth) {
    outline = [];
    let run: Array<[number, number]> = [];
    let prev: number | null = null;
    const n = h.az_deg.length;
    for (let k = 0; k <= n; k++) {
      const d = h.blocker_dist_m[k % n]!;
      const ok = Number.isFinite(d) && d > 0;
      const near = ok && prev !== null && Math.abs(d - prev) <= Math.max(150, 0.12 * Math.min(d, prev));
      if (!near) {
        if (run.length > 1) outline.push(run);
        run = [];
      }
      if (ok) run.push(destination(lat_deg, lon_deg, h.az_deg[k % n]!, d));
      prev = ok ? d : null;
    }
    if (run.length > 1) outline.push(run);
  }
  const rays: SkyRay[] = bodies.map((b) => {
    const w = bodyWords(b);
    return { body: b.body, az_deg: b.az_deg, ridge_m: b.ridge_m, open: b.open, behind: b.behind, label: [`${w.name} · ${w.state}`, w.detail] };
  });
  return { lat_deg, lon_deg, outline, rays };
}

export function sampleDots(s: EllipseSamples | null | undefined): SampleDot[] {
  if (!s) return [];
  const out: SampleDot[] = [];
  for (let i = 0; i < s.lat_deg.length; i++) out.push({ lat_deg: s.lat_deg[i]!, lon_deg: s.lon_deg[i]!, state: s.state[i] ?? "unknown" });
  return out;
}
