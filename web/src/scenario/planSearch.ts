import { create } from "zustand";
import { MS_DAY, MS_HOUR, parseUtc } from "../lib/time";
import { CONSTRAINT_META } from "./editor/fieldSpecs";
import type { Scenario } from "./types";

export type RankBy = "margin" | "sunlit_h" | "contact_h" | "sunlit_contact_h";
export type TotalKey = Exclude<RankBy, "margin">;

export const RANK_OPTIONS: Array<{ value: RankBy; label: string; short: string }> = [
  { value: "margin", label: "Margin against the requirements", short: "margin" },
  { value: "sunlit_h", label: "Most sunlight during the stay", short: "sunlight" },
  { value: "contact_h", label: "Most Earth contact during the stay", short: "Earth contact" },
  { value: "sunlit_contact_h", label: "Most sunlight with Earth contact", short: "sunlight with Earth contact" },
];

export const TOTALS: Array<{ key: TotalKey; label: string; short: string }> = [
  { key: "sunlit_h", label: "Sunlight", short: "Sun" },
  { key: "contact_h", label: "Earth contact", short: "Earth" },
  { key: "sunlit_contact_h", label: "Both together", short: "Both" },
];

export const MIN_RADIUS_KM = 0.1;
export const MAX_RADIUS_KM = 200;
export const RADIUS_PRESETS_KM = [1, 5, 20, 50];
export const DEFAULT_RADIUS_KM = 5;
const DEFAULT_WINDOW_DAYS = 90;

export interface LandingWindow {
  first_ms: number;
  last_ms: number;
}

interface Stored {
  radius_km: number | null;
  window: LandingWindow | null;
  rankBy: RankBy;
}

interface PlanSearch extends Stored {
  setRadius(km: number | null): void;
  setWindow(w: LandingWindow | null): void;
  setRankBy(r: RankBy): void;
}

const KEY = "lunarnav.plan-search";
const DEFAULTS: Stored = { radius_km: null, window: null, rankBy: "margin" };
const isRank = (v: unknown): v is RankBy => RANK_OPTIONS.some((o) => o.value === v);

function parse(text: string | null): Stored {
  try {
    const raw: unknown = JSON.parse(text ?? "null");
    if (!raw || typeof raw !== "object") return DEFAULTS;
    const r = raw as Record<string, unknown>;
    const km = r["radius_km"];
    const w = r["window"] as Record<string, unknown> | null | undefined;
    const first = w?.["first_ms"];
    const last = w?.["last_ms"];
    return {
      radius_km: typeof km === "number" && km >= MIN_RADIUS_KM && km <= MAX_RADIUS_KM ? km : null,
      window: typeof first === "number" && typeof last === "number" && Number.isFinite(first) && Number.isFinite(last) && last > first ? { first_ms: first, last_ms: last } : null,
      rankBy: isRank(r["rankBy"]) ? r["rankBy"] : "margin",
    };
  } catch {
    return DEFAULTS;
  }
}

function read(): Stored {
  try {
    return parse(localStorage.getItem(KEY));
  } catch {
    return DEFAULTS;
  }
}

export const usePlanSearch = create<PlanSearch>((set) => ({
  ...read(),
  setRadius: (radius_km) => set({ radius_km }),
  setWindow: (window) => set({ window }),
  setRankBy: (rankBy) => set({ rankBy }),
}));

usePlanSearch.subscribe(({ radius_km, window, rankBy }) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ radius_km, window, rankBy } satisfies Stored));
  } catch {
  }
});

export function activeRequirements(doc: Scenario): number {
  return CONSTRAINT_META.filter((m) => doc.constraints[m.key]).length;
}

export function effectiveRank(rankBy: RankBy, doc: Scenario): RankBy {
  return rankBy === "margin" && activeRequirements(doc) === 0 ? "sunlit_contact_h" : rankBy;
}

export function useRankBy(doc: Scenario): RankBy {
  return effectiveRank(usePlanSearch((s) => s.rankBy), doc);
}

export const rankLabel = (rank: RankBy): string => RANK_OPTIONS.find((o) => o.value === rank)?.short ?? rank;

export function defaultWindow(doc: Scenario): LandingWindow {
  const landing = parseUtc(doc.landing_utc) ?? Date.UTC(2027, 0, 1);
  return { first_ms: landing, last_ms: landing + DEFAULT_WINDOW_DAYS * MS_DAY };
}

export function yearAround(doc: Scenario): LandingWindow {
  const landing = parseUtc(doc.landing_utc) ?? Date.UTC(2027, 0, 1);
  return { first_ms: landing - 30 * MS_DAY, last_ms: landing + 335 * MS_DAY };
}

export function windowDays(w: LandingWindow): number {
  return (w.last_ms - w.first_ms) / MS_DAY;
}

export function niceSpacing_m(radius_m: number): number {
  const steps = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000];
  const target = radius_m / 25;
  return steps.find((s) => s >= target) ?? 20_000;
}

export function epochSpacing_h(w: LandingWindow, maxEpochs = 120): number {
  const hours = (w.last_ms - w.first_ms) / MS_HOUR;
  const steps = [1, 2, 3, 6, 12, 24, 48, 72, 168];
  return steps.find((s) => hours / s + 1 <= maxEpochs) ?? 168;
}

export function hoursText(h: number | null | undefined): string {
  if (h === null || h === undefined || !Number.isFinite(h)) return "–";
  return h >= 100 ? `${Math.round(h)} h` : `${h.toFixed(1)} h`;
}
