import { slipBody, type SlipParams } from "../../api/planning";
import { MS_HOUR, MS_MIN, parseUtc } from "../../lib/time";
import type { Candidate } from "../../scenario/alternatives";
import { isYear, type LandingWindow } from "../../scenario/planSearch";
import type { Scenario } from "../../scenario/types";
import { requestedSites, type SiteRef } from "./gridModel";
import { MAX_SLIP_H, SEARCH_DAYS, normalizeSlips } from "./options";

export interface CompareRequest {
  sites: SiteRef[];
  slips: number[];
  params: SlipParams;
  body: ReturnType<typeof slipBody>;
}

export function compareSlips(stored: readonly number[], window: LandingWindow | null, plannedMs: number | null): number[] {
  if (!window || isYear(window) || plannedMs === null) return [...stored];
  const start = Number(((window.first_ms - plannedMs) / MS_HOUR).toFixed(3));
  const inside = stored.filter((h) => {
    const at = plannedMs + h * MS_HOUR;
    return at >= window.first_ms - MS_MIN && at <= window.last_ms + MS_MIN;
  });
  return normalizeSlips(Math.abs(start) <= MAX_SLIP_H ? [...inside, start] : inside);
}

export function compareParams(sites: readonly SiteRef[], slips: readonly number[]): SlipParams {
  const extra = sites.slice(1);
  return {
    slips_h: [...slips],
    mode: "landing",
    search_days: SEARCH_DAYS,
    spacing_s: 3600,
    alternative_sites: extra.flatMap((s) => (s.catalog_id !== null ? [s.catalog_id] : [])),
    alternative_coordinates: extra.flatMap((s) => (s.catalog_id === null ? [{ name: s.name, lat_deg: s.lat_deg, lon_deg: s.lon_deg }] : [])),
  };
}

export function compareRequest(doc: Scenario, alternatives: readonly Candidate[], stored: readonly number[], window: LandingWindow | null): CompareRequest {
  const sites = requestedSites(doc.site, alternatives);
  const slips = compareSlips(stored, window, parseUtc(doc.landing_utc));
  const params = compareParams(sites, slips);
  return { sites, slips, params, body: slipBody(doc, params, "auto") };
}
