import { useMemo } from "react";
import { checkSearch, searchBody, type SearchBody } from "../../api/search";
import { distance_m } from "../../lib/projection";
import { toIsoUtc } from "../../lib/time";
import { DEFAULT_RADIUS_KM, effectiveRank, effectiveWindow, epochSpacing_h, niceSpacing_m, usePlanSearch, windowDays } from "../../scenario/planSearch";
import { useSearchSite } from "../../scenario/searchAnchor";
import { useScenario } from "../../scenario/store";
import type { Scenario } from "../../scenario/types";
import { aboutText, pace } from "../map/eta";
import { useSearchResults } from "./results";

const TOP_K = 20;

export interface FindPlan {
  body: SearchBody | null;
  reason: string | null;
  guessS: number;
  about: string;
  radiusKm: number;
}

const withoutSite = (body: SearchBody | null): string => {
  if (!body) return "";
  const { region, scenario, rank_by: _rank, ...rest } = body;
  const { site: _site, name: _name, landing_utc: _landing, ...plan } = (scenario ?? {}) as Scenario;
  return JSON.stringify({ rest, plan, radius: region.radius_m ?? null });
};

export function useFindPlan(): FindPlan {
  const doc = useScenario((s) => s.doc);
  const planRadius = usePlanSearch((s) => s.radius_km);
  const planWindow = usePlanSearch((s) => s.window);
  const rankBy = usePlanSearch((s) => s.rankBy);
  const centre = useSearchSite();
  const lat = centre?.lat_deg;
  const lon = centre?.lon_deg;
  return useMemo(() => {
    const radiusKm = planRadius ?? DEFAULT_RADIUS_KM;
    if (!doc || lat === undefined || lon === undefined) return { body: null, reason: "Plan not loaded yet", guessS: 0, about: "", radiusKm };
    const window = effectiveWindow(doc, planWindow);
    const radius_m = radiusKm * 1000;
    const spacing = niceSpacing_m(radius_m);
    const step = epochSpacing_h(window);
    const epochs = { first_utc: toIsoUtc(window.first_ms), last_utc: toIsoUtc(window.last_ms), spacing_h: step };
    const region = { kind: "disc" as const, lat_deg: lat, lon_deg: lon, radius_m };
    const check = checkSearch(region, spacing, TOP_K, epochs);
    if (check.errors.length > 0) return { body: null, reason: check.errors[0]!, guessS: 0, about: "", radiusKm };
    const landings = Math.floor((windowDays(window) * 24) / step) + 1;
    const guessS = 60 * (1 + (landings - 1) / 40) * pace("search");
    return { body: searchBody(doc, region, spacing, TOP_K, epochs, effectiveRank(rankBy, doc)), reason: null, guessS, about: aboutText(guessS), radiusKm };
  }, [doc, lat, lon, planRadius, planWindow, rankBy]);
}

export function useFindOutOfDate(plan: FindPlan): boolean {
  const resultBody = useSearchResults((s) => s.resultBody);
  return resultBody !== null && plan.body !== null && withoutSite(resultBody) !== withoutSite(plan.body);
}

export function useSearchCovers(plan: FindPlan, site: { lat_deg: number; lon_deg: number }): boolean {
  const resultBody = useSearchResults((s) => s.resultBody);
  const result = useSearchResults((s) => s.result);
  if (!result || !resultBody || !plan.body || withoutSite(resultBody) !== withoutSite(plan.body)) return false;
  const r = resultBody.region;
  return r.radius_m != null && distance_m(r.lat_deg, r.lon_deg, site.lat_deg, site.lon_deg) <= r.radius_m;
}
