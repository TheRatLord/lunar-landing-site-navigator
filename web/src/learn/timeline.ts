import { clamp } from "../lib/scale";
import { skyAt } from "./geometry";
import type { Site } from "./sites";

type EventKind = "sunrise" | "sunset" | "earthrise" | "earthset" | "eclipse";

export interface TimelineEvent {
  kind: EventKind;
  t: number;
}

export interface Timeline {
  d0: number;
  stepD: number;
  span: number;
  sun: Float32Array;
  earth: Float32Array;
  battery: Float32Array;
  events: TimelineEvent[];
}

const cache = new Map<string, Timeline>();

export function buildTimeline(site: Site, lat: number, d0: number, spanDays: number, landingT: number | null): Timeline {
  const key = `${site.id}|${lat.toFixed(2)}|${d0}|${spanDays}|${landingT ?? "-"}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const stepD = spanDays <= 31 ? 1 / 48 : 1 / 24;
  const n = Math.round(spanDays / stepD) + 1;
  const sun = new Float32Array(n);
  const earth = new Float32Array(n);
  const sep = new Float32Array(n);
  const up = new Float32Array(n);
  const battery = new Float32Array(n);
  const latArg = site.id === "custom" ? lat : undefined;
  for (let i = 0; i < n; i++) {
    const s = skyAt(site, d0 + i * stepD, latArg);
    sun[i] = s.sunlight;
    earth[i] = s.earth.visible ? 1 : 0;
    sep[i] = s.sepDeg;
    up[i] = s.sun.frac;
  }
  const events: TimelineEvent[] = [];
  for (let i = 1; i < n; i++) {
    const a = up[i - 1]!;
    const b = up[i]!;
    const t = i * stepD;
    if (a < 0.5 && b >= 0.5) events.push({ kind: "sunrise", t: (i - 1 + (0.5 - a) / (b - a)) * stepD });
    else if (a >= 0.5 && b < 0.5) events.push({ kind: "sunset", t: (i - 1 + (a - 0.5) / (a - b)) * stepD });
    if (earth[i - 1] !== earth[i]) events.push({ kind: earth[i] ? "earthrise" : "earthset", t });
    if (i < n - 1 && sep[i]! < 1.3 && sep[i]! <= sep[i - 1]! && sep[i]! < sep[i + 1]! && b > 0.5) {
      events.push({ kind: "eclipse", t });
    }
  }
  const start = landingT ?? 0;
  let b = 1;
  let asleep = false;
  let litRun = 0;
  for (let i = 0; i < n; i++) {
    const t = i * stepD;
    if (t < start - 1e-9) {
      battery[i] = NaN;
      continue;
    }
    const s = sun[i]!;
    litRun = s > 0.5 ? litRun + stepD : 0;
    if (asleep) {
      if (litRun >= 1) asleep = false;
      else {
        battery[i] = 0;
        continue;
      }
    }
    if (t > start) b = clamp(b + (s - 0.5) * stepD, 0, 1);
    if (b <= 0) {
      b = 0;
      asleep = true;
    }
    battery[i] = b;
  }
  const tl: Timeline = { d0, stepD, span: spanDays, sun, earth, battery, events };
  cache.set(key, tl);
  return tl;
}

const lerp = (arr: Float32Array, x: number): number => {
  const i = clamp(Math.floor(x), 0, arr.length - 1);
  const j = Math.min(arr.length - 1, i + 1);
  const a = arr[i]!;
  const b = arr[j]!;
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(b) ? a : b;
  const f = clamp(x - i, 0, 1);
  return a + (b - a) * f;
};

export function sampleAt(tl: Timeline, t: number): { sun: number; earth: number; battery: number } {
  const x = t / tl.stepD;
  const i = clamp(Math.floor(x), 0, tl.battery.length - 1);
  return {
    sun: lerp(tl.sun, x),
    earth: lerp(tl.earth, x),
    battery: Number.isNaN(tl.battery[i]!) ? NaN : lerp(tl.battery, x),
  };
}

export function nextEvent(tl: Timeline, kind: EventKind, after: number): TimelineEvent | null {
  return tl.events.find((e) => e.kind === kind && e.t > after) ?? null;
}

type PowerWord = "Full" | "Good" | "Low" | "Almost empty" | "Asleep, battery empty" | "On the way";

export function powerWord(b: number): PowerWord {
  if (Number.isNaN(b)) return "On the way";
  if (b >= 0.8) return "Full";
  if (b >= 0.5) return "Good";
  if (b >= 0.2) return "Low";
  if (b > 0) return "Almost empty";
  return "Asleep, battery empty";
}
