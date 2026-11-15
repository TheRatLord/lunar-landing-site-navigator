import type { BandSeries, SunlightSeries, TargetTrack } from "../../contract/types";
import { NBSP, formatNum, withUnit } from "../../lib/format";
import { clamp } from "../../lib/scale";
import { nearestSample } from "./timelineText";

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
}

export type InsetPair = readonly [label: string, value: string];

export function sunInsetPairs(served: { sunlight: ServedValue; eclipse: number | null } | null, geometric: number): InsetPair[] {
  if (!served) return [["Above horizon", formatVisiblePct(geometric)]];
  const { sunlight: s, eclipse: e } = served;
  const lo = s.lo !== null ? formatVisiblePct(s.lo, { unit: false }) : null;
  const hi = s.hi !== null ? formatVisiblePct(s.hi, { unit: false }) : null;
  const range: InsetPair[] = lo !== null && hi !== null && lo !== hi ? [["Range", `${lo}–${formatVisiblePct(s.hi!)}`]] : [];
  return e !== null && e >= 1
    ? [["Eclipse", "Earth"], ["Sunlight", formatVisiblePct(s.value)]]
    : e !== null && e > 0
      ? [["Sunlight", formatVisiblePct(s.value)], ["Earth covers", formatVisiblePct(e)]]
      : [["Visible", formatVisiblePct(s.value)], ...range];
}

export function sunDiscLit(served: { sunlight: ServedValue; eclipse: number | null } | null): number {
  if (!served) return 1;
  if (served.sunlight.value <= 0) return 0;
  return served.eclipse !== null ? clamp(1 - served.eclipse, 0, 1) : 1;
}

export function earthInsetPairs(centre: { el_deg: number }, aboveTerrain: number): InsetPair[] {
  return [
    ["Elevation", withUnit(formatNum(centre.el_deg, 1), "°")],
    ["Above horizon", Number.isFinite(aboveTerrain) ? withUnit(formatNum(aboveTerrain, 1), "°") : "—"],
  ];
}

export function earthCentre(track: TargetTrack, t: number): { el_deg: number } | null {
  const i = nearestSample(track.utc_ms, t);
  const el = i < 0 ? NaN : track.el_deg[i]!;
  return Number.isFinite(el) ? { el_deg: el } : null;
}

export function servedBand(b: BandSeries, t: number): ServedValue | null {
  const i = nearestSample(b.utc_ms, t);
  if (i < 0) return null;
  const v = b.value[i]!;
  if (!Number.isFinite(v)) return null;
  const lo = b.lo ? b.lo[i]! : null;
  const hi = b.hi ? b.hi[i]! : null;
  return { value: v, lo: lo !== null && Number.isFinite(lo) ? lo : null, hi: hi !== null && Number.isFinite(hi) ? hi : null };
}

export function servedSunlight(s: SunlightSeries, t: number): { sunlight: ServedValue; eclipse: number | null } | null {
  const sunlight = servedBand({ utc_ms: s.utc_ms, value: s.fraction, lo: s.lo, hi: s.hi }, t);
  if (!sunlight) return null;
  const i = nearestSample(s.utc_ms, t);
  const e = s.eclipse ? s.eclipse[i]! : null;
  return { sunlight, eclipse: e !== null && Number.isFinite(e) ? e : null };
}
