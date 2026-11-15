import type { SearchRow } from "../../api/search";
import type { Verdict } from "../../contract/types";
import { bearing_deg, distance_m } from "../../lib/projection";
import { parseUtc } from "../../lib/time";
import type { LandingWindow, RankBy, TotalKey } from "../../scenario/planSearch";
import { bestLandings, closestFail, limitingAt, scoreAt, totalsAt, type YearScan } from "./scan";

const SECTORS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export interface Place {
  lat_deg: number;
  lon_deg: number;
  name: string;
  catalog_id: string | null;
}

export type OptionKind = "pin" | "here" | "spot";

export interface LandingOption {
  key: string;
  kind: OptionKind;
  place: Place;
  label: string;
  t_ms: number | null;
  verdict: Verdict | null;
  limiting: string | null;
  totals: Record<TotalKey, number | null>;
  margin: number | null;
  marginUnit: string | null;
  score: number | null;
  tie: number | null;
  note: string | null;
  pending: boolean;
  failed: boolean;
}

export function distanceText(m: number): string {
  if (m < 950) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export const samePlace = (a: { lat_deg: number; lon_deg: number }, b: { lat_deg: number; lon_deg: number }): boolean =>
  Math.abs(a.lat_deg - b.lat_deg) < 1e-4 && Math.abs(a.lon_deg - b.lon_deg) < 1e-4;

const EMPTY_TOTALS: Record<TotalKey, number | null> = { sunlit_h: null, contact_h: null, sunlit_contact_h: null };

function fromScan(scan: YearScan, i: number, rank: RankBy, verdict: Verdict, base: Pick<LandingOption, "key" | "kind" | "place" | "label">): LandingOption {
  const c = scan.result.candidates;
  const { score, tie } = scoreAt(scan, i, rank);
  return {
    ...base,
    t_ms: c.t_ms[i] ?? null,
    verdict,
    limiting: verdict === "pass" ? null : limitingAt(scan, i),
    totals: totalsAt(scan, i),
    margin: c.worst_margin_physical?.[i] ?? null,
    marginUnit: c.margin_unit?.[i] ?? null,
    score,
    tie,
    note: null,
    pending: false,
    failed: false,
  };
}

export function hereOptions(scan: YearScan, rank: RankBy, window: LandingWindow, place: Place, label: string): LandingOption[] {
  return bestLandings(scan, rank, window).map((b) => fromScan(scan, b.index, rank, b.verdict, { key: `here:${b.t_ms}`, kind: "here", place, label }));
}

export function closestOption(scan: YearScan, rank: RankBy, window: LandingWindow, place: Place, label: string): LandingOption | null {
  const i = closestFail(scan, rank, window);
  return i === null ? null : fromScan(scan, i, rank, "fail", { key: `closest:${place.lat_deg},${place.lon_deg}`, kind: "here", place, label });
}

export function pinOption(id: string, place: Place, label: string, scan: YearScan | null, failed: boolean, rank: RankBy, window: LandingWindow): LandingOption {
  const base = { key: `pin:${id}`, kind: "pin" as const, place, label };
  if (!scan) {
    return { ...base, t_ms: null, verdict: null, limiting: null, totals: EMPTY_TOTALS, margin: null, marginUnit: null, score: null, tie: null, note: null, pending: !failed, failed };
  }
  const best = sortOptions(hereOptions(scan, rank, window, place, label))[0];
  if (best) return { ...best, ...base };
  const closest = closestOption(scan, rank, window, place, label);
  if (closest) return { ...closest, ...base, note: "Nothing meets the requirements in this window; this is the closest" };
  return { ...base, t_ms: null, verdict: null, limiting: null, totals: EMPTY_TOTALS, margin: null, marginUnit: null, score: null, tie: null, note: "No landing time in this window", pending: false, failed: false };
}

export function spotOptions(rows: readonly SearchRow[], from: { lat_deg: number; lon_deg: number }, spacing_m: number, rank: RankBy, name: (lat: number, lon: number) => string): LandingOption[] {
  const out: LandingOption[] = [];
  for (const row of rows) {
    const d = distance_m(from.lat_deg, from.lon_deg, row.lat_deg, row.lon_deg);
    if (d < spacing_m * 0.75) continue;
    const az = bearing_deg(from.lat_deg, from.lon_deg, row.lat_deg, row.lon_deg);
    const dir = SECTORS[Math.round((((az % 360) + 360) % 360) / 45) % 8]!;
    const verdict = row.state === "unknown" ? null : row.state;
    out.push({
      key: `spot:${row.lat_deg},${row.lon_deg}`,
      kind: "spot",
      place: { lat_deg: row.lat_deg, lon_deg: row.lon_deg, name: name(row.lat_deg, row.lon_deg), catalog_id: null },
      label: `${distanceText(d)} ${dir}`,
      t_ms: parseUtc(row.landing_utc),
      verdict,
      limiting: verdict === "pass" ? null : row.limitingLabel || null,
      totals: { sunlit_h: row.totals["sunlit_h"] ?? null, contact_h: row.totals["contact_h"] ?? null, sunlit_contact_h: row.totals["sunlit_contact_h"] ?? null },
      margin: row.margin,
      marginUnit: row.unit || null,
      score: rank === "margin" ? row.normalised : (row.totals[rank] ?? null),
      tie: row.totals["sunlit_contact_h"] ?? null,
      note: row.n_epochs > 1 ? `Passes at ${row.n_epochs_pass} of ${row.n_epochs} landing times searched` : null,
      pending: false,
      failed: false,
    });
  }
  return out;
}

const ORDER: Record<Verdict, number> = { pass: 3, marginal: 2, fail: 1 };

export function sortOptions(list: LandingOption[]): LandingOption[] {
  return [...list].sort((a, b) => {
    const v = (b.verdict ? ORDER[b.verdict] : 0) - (a.verdict ? ORDER[a.verdict] : 0);
    if (v !== 0) return v;
    const s = (b.score ?? -Infinity) - (a.score ?? -Infinity);
    if (s !== 0 && Number.isFinite(s)) return s;
    if (a.score === null && b.score !== null) return 1;
    if (b.score === null && a.score !== null) return -1;
    const t = (b.tie ?? -Infinity) - (a.tie ?? -Infinity);
    if (t !== 0 && Number.isFinite(t)) return t;
    return (a.t_ms ?? 0) - (b.t_ms ?? 0);
  });
}
