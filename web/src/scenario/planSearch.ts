import { create } from "zustand";
import { MS_DAY, MS_HOUR, parseUtc, toIsoUtc } from "../lib/time";
import { CONSTRAINT_META } from "./editor/fieldSpecs";
import { useScenario } from "./store";
import type { Scenario } from "./types";

export type RankBy = "margin" | "sunlit_h" | "contact_h" | "sunlit_contact_h";
export type TotalKey = Exclude<RankBy, "margin">;

export const RANK_OPTIONS: Array<{ value: RankBy; label: string; short: string }> = [
  { value: "sunlit_contact_h", label: "Sunlight with Earth link", short: "sunlight with Earth link" },
  { value: "sunlit_h", label: "Sunlight", short: "sunlight" },
  { value: "contact_h", label: "Earth link", short: "Earth link" },
  { value: "margin", label: "Margin on the requirements", short: "margin" },
];

export const TOTALS: Array<{ key: TotalKey; label: string; short: string }> = [
  { key: "sunlit_h", label: "Sunlight", short: "Sun" },
  { key: "contact_h", label: "Earth link", short: "Earth" },
  { key: "sunlit_contact_h", label: "Both together", short: "Both" },
];

export const MIN_RADIUS_KM = 0.1;
export const MAX_RADIUS_KM = 200;
export const RADIUS_PRESETS_KM = [1, 5, 20, 50];
export const DEFAULT_RADIUS_KM = 5;
const DEFAULT_WINDOW_DAYS = 90;
const DEFAULT_RANK: RankBy = "sunlit_contact_h";

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

const KEY = "lunarnav.plan-search.v2";
const DRAFT = "draft";
const DEFAULTS: Stored = { radius_km: null, window: null, rankBy: DEFAULT_RANK };
const isRank = (v: unknown): v is RankBy => RANK_OPTIONS.some((o) => o.value === v);
const okRadius = (km: unknown): km is number => typeof km === "number" && Number.isFinite(km) && km >= MIN_RADIUS_KM && km <= MAX_RADIUS_KM;
const okWindow = (first: unknown, last: unknown): boolean => typeof first === "number" && typeof last === "number" && Number.isFinite(first) && Number.isFinite(last) && last > first;

function parse(raw: unknown): Stored {
  if (!raw || typeof raw !== "object") return DEFAULTS;
  const r = raw as Record<string, unknown>;
  const w = r["window"] as Record<string, unknown> | null | undefined;
  const first = w?.["first_ms"];
  const last = w?.["last_ms"];
  return {
    radius_km: okRadius(r["radius_km"]) ? r["radius_km"] : null,
    window: okWindow(first, last) ? { first_ms: first as number, last_ms: last as number } : null,
    rankBy: isRank(r["rankBy"]) ? r["rankBy"] : DEFAULT_RANK,
  };
}

function readAll(): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function readFor(key: string): Stored {
  return parse(readAll()[key]);
}

function writeFor(key: string, value: Stored | null): void {
  try {
    const all = readAll();
    if (value === null) delete all[key];
    else all[key] = value;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
  }
}

export function searchToParams(base: URLSearchParams, v: Stored): URLSearchParams {
  const p = new URLSearchParams(base);
  if (v.radius_km === null) p.delete("radius");
  else p.set("radius", String(v.radius_km));
  if (v.window === null) {
    p.delete("from");
    p.delete("to");
  } else {
    p.set("from", toIsoUtc(v.window.first_ms));
    p.set("to", toIsoUtc(v.window.last_ms));
  }
  if (v.rankBy === DEFAULT_RANK) p.delete("rank");
  else p.set("rank", v.rankBy);
  return p;
}

function searchFromParams(p: URLSearchParams): Stored | null {
  if (!["radius", "from", "to", "rank"].some((k) => p.has(k))) return null;
  const km = Number(p.get("radius"));
  const first = parseUtc(p.get("from"));
  const last = parseUtc(p.get("to"));
  const rank = p.get("rank");
  return {
    radius_km: p.has("radius") && okRadius(km) ? km : null,
    window: okWindow(first, last) ? { first_ms: first as number, last_ms: last as number } : null,
    rankBy: isRank(rank) ? rank : DEFAULT_RANK,
  };
}

const startParams = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
const link = { id: startParams.get("scenario"), search: startParams.has("scenario") ? (searchFromParams(startParams) ?? DEFAULTS) : searchFromParams(startParams) };

const planKey = (s: { saved: { id: string } | null }): string => s.saved?.id ?? DRAFT;

function settingsFor(key: string): Stored {
  if (link.search && (link.id === null ? key === DRAFT : link.id === key)) {
    const v = link.search;
    link.search = null;
    writeFor(key, v);
    return v;
  }
  return readFor(key);
}

let currentKey = planKey(useScenario.getState());

export const usePlanSearch = create<PlanSearch>((set) => ({
  ...settingsFor(currentKey),
  setRadius: (radius_km) => set({ radius_km }),
  setWindow: (window) => set({ window }),
  setRankBy: (rankBy) => set({ rankBy }),
}));

usePlanSearch.subscribe(({ radius_km, window, rankBy }) => writeFor(currentKey, { radius_km, window, rankBy }));

useScenario.subscribe((s, prev) => {
  if (s.phase === "loading") return;
  const key = planKey(s);
  if (key === currentKey && s.session === prev.session) return;
  const carry = s.session === prev.session && prev.saved?.id !== s.saved?.id;
  const from = currentKey;
  currentKey = key;
  if (carry) {
    const { radius_km, window, rankBy } = usePlanSearch.getState();
    writeFor(key, { radius_km, window, rankBy });
    if (from === DRAFT) writeFor(DRAFT, null);
    return;
  }
  if (key === DRAFT) writeFor(DRAFT, null);
  usePlanSearch.setState(settingsFor(key));
});

export function currentSearch(): Stored {
  const { radius_km, window, rankBy } = usePlanSearch.getState();
  return { radius_km, window, rankBy };
}

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
