import type { EvaluateResult, IntervalJson } from "../../api/site";
import type { HorizonProfile, Interval, TargetTrack } from "../../contract/types";
import { lowerBound } from "../../lib/scale";
import { arrMax, arrMin } from "../../lib/track";
import { MS_DAY, MS_HOUR, MS_MIN, toIsoUtc } from "../../lib/time";
import { CONSTRAINT_KEYS, type Scenario } from "../../scenario/types";
import { adaptHorizon, adaptTrack, parseSec, seriesExtent } from "../site/adapt";

export const SPAN_DAYS = 365;
export const SPAN_MS = SPAN_DAYS * MS_DAY;
const TRACK_BEFORE_MS = 2 * MS_DAY;
const TRACK_AFTER_MS = 14 * MS_DAY;

export interface SurveySite {
  lat_deg: number;
  lon_deg: number;
  name: string;
  catalog_id: string | null;
}

export function spanStartFor(landingMs: number): number {
  const d = new Date(landingMs);
  const y = d.getUTCFullYear();
  return d.getUTCMonth() === 11 ? Date.UTC(y, 11, 1) : Date.UTC(y - 1, 11, 1);
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

function merge(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.start_ms - b.start_ms);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start_ms <= last.end_ms + MS_MIN) last.end_ms = Math.max(last.end_ms, iv.end_ms);
    else out.push({ ...iv });
  }
  return out;
}

function splice(year: readonly Interval[], exact: Interval[], from: number, to: number): Interval[] {
  const outside: Interval[] = [];
  for (const iv of year) {
    if (iv.start_ms < from) outside.push({ start_ms: iv.start_ms, end_ms: Math.min(iv.end_ms, from) });
    if (iv.end_ms > to) outside.push({ start_ms: Math.max(iv.start_ms, to), end_ms: iv.end_ms });
  }
  return merge([...outside, ...exact].filter((iv) => iv.end_ms > iv.start_ms));
}

export function withExact(s: Survey, r: EvaluateResult): Survey {
  const span = seriesExtent(r.series);
  if (!span) return s;
  const from = Math.max(span[0], s.start_ms);
  const to = Math.min(span[1], s.end_ms);
  if (to <= from) return s;
  const sun = splice(s.sun, nominal(r.intervals["sunlit"], from, to), from, to);
  const earth = splice(s.earth, nominal(r.intervals["contact"], from, to), from, to);
  return { ...s, sun, earth, both: intersect(sun, earth) };
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
  const lo = arrMin(h.elev_deg);
  let hi = arrMax(h.elev_deg);
  for (const t of tracks) hi = Math.max(hi, arrMax(t.el_deg));
  hi = Math.min(90, Math.max(hi, lo + 3));
  const pad = Math.max(0.3, (hi - lo) * 0.08);
  return [lo - pad, hi + pad];
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dayText(ms: number, year = false): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ""}`;
}

function eventText(raw: number): string {
  const ms = Math.round(raw / MS_MIN) * MS_MIN;
  const d = new Date(ms);
  return `${dayText(ms)} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export interface SkyFacts {
  text: string;
  tone: "pass" | "marginal" | "fail";
  warn: boolean;
  events: string[];
}

export function skyFacts(s: Survey, t: number): SkyFacts {
  const sun = stateAt(s.sun, t, s);
  const earth = stateAt(s.earth, t, s);
  const sunNever = s.sun.length === 0;
  const earthNever = s.earth.length === 0;
  const after = dayText(s.end_ms, true);
  const both = sun.up && earth.up ? windowAt(s.both, t) : null;
  const until = both && both.end_ms < s.end_ms ? both.end_ms : null;
  const events: Array<[number, string]> = [];
  const add = (st: BodyState, never: boolean, rise: string, set: string, always: string) => {
    if (st.change_ms !== null) {
      if (st.change_ms !== until) events.push([st.change_ms, `${st.up ? set : rise} ${eventText(st.change_ms)}`]);
    } else if (st.up) events.push([Infinity, st.since_ms === null ? always : `No ${set.toLowerCase()} before ${after}`]);
    else if (!never) events.push([Infinity, `No ${rise.toLowerCase()} before ${after}`]);
  };
  add(sun, sunNever, "Sunrise", "Sunset", "Sun never sets");
  add(earth, earthNever, "Earthrise", "Earthset", "Earth never sets");
  events.sort((a, b) => a[0] - b[0]);
  const lines = events.map(([ms, text]) => (Number.isFinite(ms) ? `${text} UTC` : text));
  const facts = (text: string, tone: SkyFacts["tone"], warn = false): SkyFacts => ({ text, tone, warn, events: lines });
  if (sun.up && earth.up) {
    const span = !both ? "" : until === null ? ` past ${after}` : ` until ${eventText(until)} UTC`;
    return facts(`Sunlit with Earth link${span}`, "pass");
  }
  if (sun.up) return earthNever ? facts("Sunlit, no Earth link all year", "fail", true) : facts("Sunlit, no Earth link", "marginal");
  if (earth.up) return sunNever ? facts("Earth link, no sunlight all year", "fail", true) : facts("Earth link, no sunlight", "marginal");
  if (sunNever && earthNever) return facts("No sunlight or Earth link all year", "fail", true);
  if (sunNever) return facts("No sunlight all year, no Earth link now", "fail", true);
  if (earthNever) return facts("No sunlight now, no Earth link all year", "fail", true);
  return facts("No sunlight, no Earth link", "fail");
}

export interface NextChange {
  ms: number;
  label: string;
}

export function nextChange(s: Survey, t: number): NextChange | null {
  const sun = stateAt(s.sun, t, s);
  const earth = stateAt(s.earth, t, s);
  const out: NextChange[] = [];
  if (sun.change_ms !== null) out.push({ ms: sun.change_ms, label: sun.up ? "until sunset" : "until sunrise" });
  if (earth.change_ms !== null) out.push({ ms: earth.change_ms, label: earth.up ? "until Earthset" : "until Earthrise" });
  return out.reduce<NextChange | null>((a, b) => (!a || b.ms < a.ms ? b : a), null);
}

export function elevationAt(track: TargetTrack | null, t: number): number | null {
  if (!track || track.utc_ms.length === 0) return null;
  const n = track.utc_ms.length;
  const i = lowerBound(track.utc_ms, t);
  if (i <= 0) return t === track.utc_ms[0] ? track.el_deg[0]! : null;
  if (i >= n) return null;
  const t0 = track.utc_ms[i - 1]!;
  const t1 = track.utc_ms[i]!;
  const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  return track.el_deg[i - 1]! + f * (track.el_deg[i]! - track.el_deg[i - 1]!);
}

export function dayTimeText(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dayText(ms, true)} ${hh}:${mm} UTC`;
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
