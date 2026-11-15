import { useMemo } from "react";
import type { SearchRow } from "../../api/search";
import { bearing_deg, distance_m } from "../../lib/projection";
import { parseUtc } from "../../lib/time";
import { useFindPlan, type FindPlan } from "../search/findSites";
import { useSearchResults } from "../search/results";

const SECTORS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export interface Spot {
  row: SearchRow;
  dist_m: number;
  dir: string;
  here: boolean;
  landing_ms: number | null;
}

export interface SearchAnswer {
  plan: FindPlan;
  phase: "idle" | "running" | "done" | "error";
  error: string | null;
  progress: number | null;
  fresh: boolean;
  changed: boolean;
  spots: Spot[];
  counts: { pass: number; marginal: number; fail: number; full: number };
  radius_m: number;
  windowed: boolean;
  first_ms: number | null;
  last_ms: number | null;
}

export function distanceText(m: number): string {
  if (m < 950) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export function useSearchAnswer(site: { lat_deg: number; lon_deg: number }): SearchAnswer {
  const plan = useFindPlan();
  const phase = useSearchResults((s) => s.phase);
  const error = useSearchResults((s) => s.error);
  const progress = useSearchResults((s) => s.progress);
  const result = useSearchResults((s) => s.result);
  const resultBody = useSearchResults((s) => s.resultBody);
  const rows = useSearchResults((s) => s.candidates);
  return useMemo(() => {
    const same = resultBody !== null && plan.body !== null && JSON.stringify(resultBody) === JSON.stringify(plan.body);
    const body = same ? resultBody : plan.body;
    const spacing = body?.final_spacing_m ?? 0;
    const spots = same
      ? rows.map((row) => {
          const d = distance_m(site.lat_deg, site.lon_deg, row.lat_deg, row.lon_deg);
          const az = bearing_deg(site.lat_deg, site.lon_deg, row.lat_deg, row.lon_deg);
          return { row, dist_m: d, dir: SECTORS[Math.round((((az % 360) + 360) % 360) / 45) % 8]!, here: d < spacing * 0.75, landing_ms: parseUtc(row.landing_utc) };
        })
      : [];
    const c = result?.counts ?? {};
    const n = (k: string): number => (typeof c[k] === "number" ? c[k] : 0);
    const first = body?.first_utc ? parseUtc(body.first_utc) : null;
    const last = body?.last_utc ? parseUtc(body.last_utc) : null;
    return {
      plan,
      phase,
      error,
      progress,
      fresh: same && phase !== "running",
      changed: result !== null && !same,
      spots,
      counts: { pass: n("PASS"), marginal: n("MARGINAL"), fail: n("FAIL"), full: n("evaluated_full") },
      radius_m: body?.region.radius_m ?? plan.radiusKm * 1000,
      windowed: first !== null && last !== null,
      first_ms: first,
      last_ms: last,
    };
  }, [plan, phase, error, progress, result, resultBody, rows, site.lat_deg, site.lon_deg]);
}

export function sentence(text: string): string {
  const t = text.trim();
  if (!t) return t;
  const first = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(first) ? first : `${first}.`;
}
