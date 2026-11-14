import type { BandSeries, SunlightSeries, TargetTrack } from "../../contract/types";
import { NBSP, formatNum, withUnit } from "../../lib/format";
import { clamp } from "../../lib/scale";
import { formatUtc } from "../../lib/time";
import { nearestSample, sampleNote } from "./timelineText";

export function formatBlockerDistance(dist_m: number): string {
  if (!Number.isFinite(dist_m) || dist_m <= 0) return "no blocker";
  const km = dist_m / 1000;
  return withUnit(formatNum(km, km >= 10 ? 1 : 2), "km");
}

function formatVisiblePct(fraction: number, opts: { unit?: boolean } = {}): string {
  const unit = opts.unit ?? true;
  if (!Number.isFinite(fraction)) return "—";
  const p = fraction * 100;
  const tail = unit ? `${NBSP}%` : "";
  if (p <= 0) return `0${tail}`;
  if (p >= 100) return `100${tail}`;
  if (p < 1) return `<1${tail}`;
  if (p > 99) return `>99${tail}`;
  return `${Math.round(p)}${tail}`;
}

interface ServedValue {
  value: number;
  lo: number | null;
  hi: number | null;
  note?: string | null;
}

export type InsetPair = readonly [label: string, value: string];

const NEAREST = /^nearest sample /;

function withSample(pairs: InsetPair[], note: string | null | undefined): InsetPair[] {
  return note ? [...pairs, ["Sample", note.replace(NEAREST, "")]] : pairs;
}

export function sunInsetPairs(served: { sunlight: ServedValue; eclipse: number | null } | null, geometric: number): InsetPair[] {
  if (!served) return [["Above horizon", formatVisiblePct(geometric)], ["Source", "geometry"]];
  const { sunlight: s, eclipse: e } = served;
  const bounds = s.lo !== null && s.hi !== null ? `${formatVisiblePct(s.lo, { unit: false })}–${formatVisiblePct(s.hi)}` : "—";
  const pairs: InsetPair[] =
    e !== null && e >= 1
      ? [["Eclipse", "Earth"], ["Sunlight", formatVisiblePct(s.value)]]
      : e !== null && e > 0
        ? [["Sunlight", formatVisiblePct(s.value)], ["Earth covers", formatVisiblePct(e)]]
        : [["Visible", formatVisiblePct(s.value)], ["Bounds", bounds]];
  return withSample(pairs, s.note);
}

export function sunDiscLit(served: { sunlight: ServedValue; eclipse: number | null } | null): number {
  if (!served) return 1;
  if (served.sunlight.value <= 0) return 0;
  return served.eclipse !== null ? clamp(1 - served.eclipse, 0, 1) : 1;
}

export function earthInsetPairs(centre: { el_deg: number; note: string | null }, clearance: ServedValue | null): InsetPair[] {
  const pairs: InsetPair[] = [
    ["Elevation", withUnit(formatNum(centre.el_deg, 1), "°")],
    ["Clearance", clearance ? withUnit(formatNum(clearance.value, 1), "°") : "—"],
  ];
  return withSample(pairs, centre.note ?? clearance?.note ?? null);
}

function nearestWithNote(utc_ms: ArrayLike<number>, t: number): { i: number; note: string | null } | null {
  const i = nearestSample(utc_ms, t);
  if (i < 0) return null;
  const at = utc_ms[i]!;
  if (sampleNote(utc_ms, i, t) === null) return { i, note: null };
  const full = formatUtc(at, { date: Math.floor(at / 86_400_000) !== Math.floor(t / 86_400_000) });
  return { i, note: `nearest sample ${full.replace(/:00Z$/, "Z")}` };
}

export function earthCentre(track: TargetTrack, t: number): { el_deg: number; note: string | null } | null {
  const s = nearestWithNote(track.utc_ms, t);
  const el = s === null ? NaN : track.el_deg[s.i]!;
  return s === null || !Number.isFinite(el) ? null : { el_deg: el, note: s.note };
}

export function servedBand(b: BandSeries, t: number): ServedValue | null {
  const s = nearestWithNote(b.utc_ms, t);
  if (s === null) return null;
  const v = b.value[s.i]!;
  if (!Number.isFinite(v)) return null;
  const lo = b.lo ? b.lo[s.i]! : null;
  const hi = b.hi ? b.hi[s.i]! : null;
  return { value: v, lo: lo !== null && Number.isFinite(lo) ? lo : null, hi: hi !== null && Number.isFinite(hi) ? hi : null, note: s.note };
}

export function servedSunlight(s: SunlightSeries, t: number): { sunlight: ServedValue; eclipse: number | null } | null {
  const sunlight = servedBand({ utc_ms: s.utc_ms, value: s.fraction, lo: s.lo, hi: s.hi }, t);
  if (!sunlight) return null;
  const i = nearestSample(s.utc_ms, t);
  const e = s.eclipse ? s.eclipse[i]! : null;
  return { sunlight, eclipse: e !== null && Number.isFinite(e) ? e : null };
}
