import type { EvaluateResult, IntervalJson } from "../../api/site";
import type { HorizonProfile, Interval, TargetTrack } from "../../contract/types";
import { arrMax, arrMin } from "../../lib/track";
import { MS_HOUR, MS_MIN, parseUtc, toIsoUtc } from "../../lib/time";
import { CONSTRAINT_KEYS, type Scenario } from "../../scenario/types";
import { adaptHorizon, adaptTrack, parseSec } from "../site/adapt";

export interface SurveySite {
  lat_deg: number;
  lon_deg: number;
  name: string;
  catalog_id: string | null;
}

export function surveyBody(doc: Scenario, site: SurveySite, startMs: number, endMs: number) {
  const constraints: Record<string, unknown> = { ...doc.constraints };
  for (const k of CONSTRAINT_KEYS) constraints[k] = null;
  const scenario = {
    ...doc,
    name: "Year survey",
    site: { lat_deg: site.lat_deg, lon_deg: site.lon_deg, name: site.name, catalog_id: site.catalog_id ?? undefined },
    landing_utc: toIsoUtc(startMs),
    mission_duration_h: Math.round((endMs - startMs) / MS_HOUR),
    sampling: { ...doc.sampling, step_s: 3600 },
    constraints,
    ellipse: undefined,
    transfer: undefined,
  };
  return { scenario, terrain: "auto" as const, max_points: 6000, with_bounds: false };
}

export const STAY_FALLBACK_MS = Date.UTC(2027, 0, 1);

export function stayOf(doc: Scenario): { start_ms: number; end_ms: number } {
  const start_ms = parseUtc(doc.landing_utc) ?? STAY_FALLBACK_MS;
  return { start_ms, end_ms: start_ms + doc.mission_duration_h * MS_HOUR };
}

export function stayBody(doc: Scenario) {
  const { start_ms, end_ms } = stayOf(doc);
  const s = doc.site;
  return surveyBody(doc, { lat_deg: s.lat_deg, lon_deg: s.lon_deg, name: s.name ?? "", catalog_id: s.catalog_id ?? null }, start_ms, end_ms);
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
  const lo = arrMin(h.elev_deg);
  let hi = arrMax(h.elev_deg);
  for (const t of tracks) hi = Math.max(hi, arrMax(t.el_deg));
  hi = Math.min(90, Math.max(hi, lo + 3));
  const pad = Math.max(0.3, (hi - lo) * 0.08);
  return [lo - pad, hi + pad];
}

export function adaptSurvey(r: EvaluateResult, startMs: number, end: number): Survey {
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dayText(ms: number, year = false): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ""}`;
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
