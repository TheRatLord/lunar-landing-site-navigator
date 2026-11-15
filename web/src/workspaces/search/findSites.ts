import { useMemo } from "react";
import { checkSearch, searchBody, type SearchBody } from "../../api/search";
import { toIsoUtc } from "../../lib/time";
import { DEFAULT_RADIUS_KM, effectiveRank, epochSpacing_h, niceSpacing_m, usePlanSearch, windowDays } from "../../scenario/planSearch";
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
  const { region: _region, scenario, ...rest } = body;
  const { site: _site, name: _name, ...plan } = (scenario ?? {}) as Scenario;
  return JSON.stringify({ rest, plan });
};

export function useFindPlan(): FindPlan {
  const doc = useScenario((s) => s.doc);
  const planRadius = usePlanSearch((s) => s.radius_km);
  const window = usePlanSearch((s) => s.window);
  const rankBy = usePlanSearch((s) => s.rankBy);
  return useMemo(() => {
    const radiusKm = planRadius ?? DEFAULT_RADIUS_KM;
    if (!doc) return { body: null, reason: "Plan not loaded yet", guessS: 0, about: "", radiusKm };
    const radius_m = radiusKm * 1000;
    const spacing = niceSpacing_m(radius_m);
    const step = window ? epochSpacing_h(window) : 0;
    const epochs = window ? { first_utc: toIsoUtc(window.first_ms), last_utc: toIsoUtc(window.last_ms), spacing_h: step } : null;
    const region = { kind: "disc" as const, lat_deg: doc.site.lat_deg, lon_deg: doc.site.lon_deg, radius_m };
    const check = checkSearch(region, spacing, TOP_K, epochs);
    if (check.errors.length > 0) return { body: null, reason: check.errors[0]!, guessS: 0, about: "", radiusKm };
    const landings = window ? Math.floor((windowDays(window) * 24) / step) + 1 : 1;
    const guessS = 60 * (1 + (landings - 1) / 40) * pace("search");
    return { body: searchBody(doc, region, spacing, TOP_K, epochs, effectiveRank(rankBy, doc)), reason: null, guessS, about: aboutText(guessS), radiusKm };
  }, [doc, planRadius, window, rankBy]);
}

export function useFindOutOfDate(plan: FindPlan): boolean {
  const resultBody = useSearchResults((s) => s.resultBody);
  return resultBody !== null && plan.body !== null && withoutSite(resultBody) !== withoutSite(plan.body);
}
