import { create } from "zustand";
import type { SlipMode } from "../../api/planning";
import { MS_HOUR, MS_LUNATION } from "../../lib/time";

export const BASELINE_SITE = "baseline";
export const MAX_SLIPS = 64;
export const MAX_SLIP_H = 8760;
export const MAX_DETAIL = 4;

export type Pin = { kind: "cell"; site: string; slip_h: number } | { kind: "saved"; scenario_id: string };

export const pinKey = (p: Pin): string => (p.kind === "cell" ? `cell:${p.site}:${p.slip_h}` : `saved:${p.scenario_id}`);

export function normalizeSlips(hours: readonly number[]): number[] {
  const ok = new Set([0, ...hours.filter((h) => Number.isFinite(h) && Math.abs(h) <= MAX_SLIP_H)]);
  return [...ok]
    .sort((a, b) => Math.abs(a) - Math.abs(b))
    .slice(0, MAX_SLIPS)
    .sort((a, b) => a - b);
}

const DEFAULT_SLIPS_H = normalizeSlips([0, 24, 72, 168, 336, Math.round((MS_LUNATION / MS_HOUR) * 10) / 10]);

interface Stored {
  slips_h: number[];
  mode: SlipMode;
  search_days: number;
  pins: Pin[];
}

interface CompareOptions extends Stored {
  setSlips(hours: readonly number[]): void;
  addSlip(hours: number): void;
  removeSlip(hours: number): void;
  setMode(mode: SlipMode): void;
  setSearchDays(days: number): void;
  pin(p: Pin): void;
  unpin(p: Pin): void;
  togglePin(p: Pin): void;
  clearPins(): void;
}

const KEY = "lunarnav.compare";
const DEFAULTS: Stored = { slips_h: DEFAULT_SLIPS_H, mode: "landing", search_days: 60, pins: [] };

const isPin = (p: unknown): p is Pin =>
  !!p &&
  typeof p === "object" &&
  "kind" in p &&
  ((p.kind === "cell" && "site" in p && typeof p.site === "string" && "slip_h" in p && typeof p.slip_h === "number" && Number.isFinite(p.slip_h)) ||
    (p.kind === "saved" && "scenario_id" in p && typeof p.scenario_id === "string"));

function parseOptions(text: string | null): Stored {
  try {
    const raw: unknown = JSON.parse(text ?? "null");
    if (!raw || typeof raw !== "object") return DEFAULTS;
    const r = raw as Record<string, unknown>;
    return {
      slips_h: Array.isArray(r["slips_h"]) ? normalizeSlips(r["slips_h"].filter((h): h is number => typeof h === "number")) : DEFAULTS.slips_h,
      mode: r["mode"] === "launch" ? "launch" : "landing",
      search_days: typeof r["search_days"] === "number" && r["search_days"] > 0 && r["search_days"] <= 400 ? r["search_days"] : DEFAULTS.search_days,
      pins: Array.isArray(r["pins"]) ? r["pins"].filter(isPin) : [],
    };
  } catch {
    return DEFAULTS;
  }
}

function read(): Stored {
  try {
    return parseOptions(localStorage.getItem(KEY));
  } catch {
    return DEFAULTS;
  }
}

export const useCompareOptions = create<CompareOptions>((set, get) => ({
  ...read(),
  setSlips: (hours) => set({ slips_h: normalizeSlips(hours) }),
  addSlip: (hours) => set((s) => ({ slips_h: normalizeSlips([...s.slips_h, hours]) })),
  removeSlip: (hours) => set((s) => ({ slips_h: normalizeSlips(s.slips_h.filter((h) => h !== hours)) })),
  setMode: (mode) => set({ mode }),
  setSearchDays: (search_days) => set({ search_days }),
  pin: (p) => set((s) => (s.pins.some((x) => pinKey(x) === pinKey(p)) ? s : { pins: [...s.pins, p] })),
  unpin: (p) => set((s) => ({ pins: s.pins.filter((x) => pinKey(x) !== pinKey(p)) })),
  togglePin: (p) => (get().pins.some((x) => pinKey(x) === pinKey(p)) ? get().unpin(p) : get().pin(p)),
  clearPins: () => set({ pins: [] }),
}));

useCompareOptions.subscribe(({ slips_h, mode, search_days, pins }) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ slips_h, mode, search_days, pins } satisfies Stored));
  } catch {
  }
});
