import type { EvaluateResult, IntervalJson } from "../../api/site";
import type { HorizonProfile, Interval, TargetTrack } from "../../contract/types";
import { lowerBound } from "../../lib/scale";
import { arrMax, arrMin } from "../../lib/track";
import { MS_DAY, MS_HOUR, MS_MIN, toIsoUtc } from "../../lib/time";
import { CONSTRAINT_KEYS, type Scenario } from "../../scenario/types";
import { adaptHorizon, adaptTrack, parseSec } from "../site/adapt";

export const SPAN_DAYS = 365;
export const SPAN_MS = SPAN_DAYS * MS_DAY;
const LEAD_MS = 30 * MS_DAY;
const TRACK_BEFORE_MS = 2 * MS_DAY;
const TRACK_AFTER_MS = 14 * MS_DAY;

export interface SurveySite {
  lat_deg: number;
  lon_deg: number;
  name: string;
  catalog_id: string | null;
}

export function spanStartFor(landingMs: number): number {
  const d = new Date(landingMs - LEAD_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export function inSpan(ms: number, startMs: number): boolean {
  return ms >= startMs && ms <= startMs + SPAN_MS;
}

export function surveyBody(doc: Scenario, site: SurveySite, startMs: number) {
  const constraints: Record<string, unknown> = { ...doc.constraints };
  for (const k of CONSTRAINT_KEYS) constraints[k] = null;
  const scenario = {
    ...doc,
    name: "Year survey",
    site: { lat_deg: site.lat_deg, lon_deg: site.lon_deg, name: site.name, catalog_id: site.catalog_id ?? undefined },
    landing_utc: toIsoUtc(startMs),
    mission_duration_h: SPAN_DAYS * 24,
    sampling: { ...doc.sampling, step_s: 3600 },
    constraints,
    network: { ...doc.network, stations: [] },
    ellipse: undefined,
    transfer: undefined,
  };
  return { scenario, terrain: "auto" as const, max_points: 6000, with_bounds: false };
}

export interface Survey {
  start_ms: number;
  end_ms: number;
  sun: Interval[];
  earth: Interval[];
  both: Interval[];
  sunTrack: TargetTrack | null;
  earthTrack: TargetTrack | null;
  horizon: HorizonProfile | null;
  fit: [number, number] | null;
  smooth: boolean;
}

function nominal(rows: readonly IntervalJson[] | undefined, start: number, end: number): Interval[] {
  const out: Interval[] = [];
  for (const r of rows ?? []) {
    if (!r.nominal) continue;
    const s = Math.max(start, parseSec(r.start_utc) ?? start);
    const e = Math.min(end, parseSec(r.end_utc) ?? end);
    if (e > s) out.push({ start_ms: s, end_ms: e });
  }
  out.sort((a, b) => a.start_ms - b.start_ms);
  const merged: Interval[] = [];
  for (const iv of out) {
    const last = merged[merged.length - 1];
    if (last && iv.start_ms <= last.end_ms + MS_MIN) last.end_ms = Math.max(last.end_ms, iv.end_ms);
    else merged.push({ ...iv });
  }
  return merged;
}

function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i]!.start_ms, b[j]!.start_ms);
    const e = Math.min(a[i]!.end_ms, b[j]!.end_ms);
    if (e > s) out.push({ start_ms: s, end_ms: e });
    if (a[i]!.end_ms < b[j]!.end_ms) i++;
    else j++;
  }
  return out;
}

function skyFit(h: HorizonProfile, tracks: readonly TargetTrack[]): [number, number] {
  let lo = arrMin(h.elev_lo_deg);
  let hi = arrMax(h.elev_hi_deg);
  for (const t of tracks) {
    lo = Math.min(lo, arrMin(t.el_deg));
    hi = Math.max(hi, arrMax(t.el_deg));
  }
  lo = Math.max(lo, -12);
  hi = Math.max(hi, lo + 3);
  const pad = Math.max(0.35, (hi - lo) * 0.12);
  return [lo - pad, Math.min(90, hi + pad)];
}

export function adaptSurvey(r: EvaluateResult, startMs: number): Survey {
  const end = startMs + SPAN_MS;
  const sun = nominal(r.intervals["sunlit"], startMs, end);
  const earth = nominal(r.intervals["contact"], startMs, end);
  const sunTrack = adaptTrack(r.series, "sun");
  const earthTrack = adaptTrack(r.series, "earth");
  const src = r.horizons?.["array"] ?? null;
  const horizon = src ? adaptHorizon(src) : null;
  const tracks = [sunTrack, earthTrack].filter((t): t is TargetTrack => t !== null);
  return {
    start_ms: startMs,
    end_ms: end,
    sun,
    earth,
    both: intersect(sun, earth),
    sunTrack,
    earthTrack,
    horizon,
    fit: horizon ? skyFit(horizon, tracks) : null,
    smooth: r.provider !== "terrain",
  };
}

export function trackWindow(t: TargetTrack | null, timeMs: number): TargetTrack | undefined {
  if (!t) return undefined;
  const a = Math.max(0, lowerBound(t.utc_ms, timeMs - TRACK_BEFORE_MS) - 1);
  const b = Math.min(t.utc_ms.length, lowerBound(t.utc_ms, timeMs + TRACK_AFTER_MS) + 1);
  if (b - a < 2) return undefined;
  const cut = (x: ArrayLike<number>) => Array.prototype.slice.call(x, a, b) as number[];
  return { utc_ms: cut(t.utc_ms), az_deg: cut(t.az_deg), el_deg: cut(t.el_deg), ang_radius_deg: cut(t.ang_radius_deg) };
}

export interface BodyState {
  up: boolean;
  change_ms: number | null;
  since_ms: number | null;
}

export function stateAt(list: readonly Interval[], t: number, s: Survey): BodyState {
  let i = 0;
  while (i < list.length && list[i]!.end_ms <= t) i++;
  const cur = list[i];
  const prev = list[i - 1];
  if (cur && cur.start_ms <= t) {
    return { up: true, change_ms: cur.end_ms >= s.end_ms ? null : cur.end_ms, since_ms: cur.start_ms <= s.start_ms ? null : cur.start_ms };
  }
  return { up: false, change_ms: cur ? cur.start_ms : null, since_ms: prev ? prev.end_ms : null };
}

export function windowAt(list: readonly Interval[], t: number): Interval | null {
  return list.find((iv) => iv.start_ms <= t && t < iv.end_ms) ?? null;
}

export function nextWindow(list: readonly Interval[], t: number): Interval | null {
  return list.find((iv) => iv.start_ms > t) ?? null;
}

export function longestWindow(list: readonly Interval[]): Interval | null {
  let best: Interval | null = null;
  for (const iv of list) if (!best || iv.end_ms - iv.start_ms > best.end_ms - best.start_ms) best = iv;
  return best;
}

export function coverage(list: readonly Interval[], s: Survey): number {
  let sum = 0;
  for (const iv of list) sum += iv.end_ms - iv.start_ms;
  return sum / (s.end_ms - s.start_ms);
}

export function spanText(ms: number): string {
  const m = Math.max(0, Math.round(ms / MS_MIN));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d >= 10) return `${Math.round(ms / MS_DAY)} days`;
  if (d >= 1) return h > 0 ? `${d} d ${h} h` : `${d} d`;
  const min = m % 60;
  return h >= 1 ? (min > 0 ? `${h} h ${min} min` : `${h} h`) : `${min} min`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dayText(ms: number, year = false): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ""}`;
}

export function dayTimeText(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dayText(ms, true)}, ${hh}:${mm} UTC`;
}

export function monthTicks(startMs: number, endMs: number): Array<{ ms: number; label: string; year: number | null }> {
  const out: Array<{ ms: number; label: string; year: number | null }> = [];
  const d = new Date(startMs);
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth();
  for (;;) {
    const ms = Date.UTC(y, m, 1);
    if (ms >= endMs) break;
    if (ms >= startMs) out.push({ ms, label: MONTHS[m]!, year: m === 0 || out.length === 0 ? y : null });
    m++;
    if (m === 12) {
      m = 0;
      y++;
    }
  }
  return out;
}

export const roundToHour = (ms: number): number => Math.round(ms / MS_HOUR) * MS_HOUR;
