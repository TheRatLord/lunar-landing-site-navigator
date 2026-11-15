import { create } from "zustand";
import { MS_HOUR, MS_LUNATION } from "../../lib/time";

export const BASELINE_SITE = "baseline";
export const MAX_SLIPS = 64;
export const MAX_SLIP_H = 8760;
export const SEARCH_DAYS = 60;

export function normalizeSlips(hours: readonly number[]): number[] {
  const ok = new Set([0, ...hours.filter((h) => Number.isFinite(h) && Math.abs(h) <= MAX_SLIP_H)]);
  return [...ok]
    .sort((a, b) => Math.abs(a) - Math.abs(b))
    .slice(0, MAX_SLIPS)
    .sort((a, b) => a - b);
}

const DEFAULT_SLIPS_H = normalizeSlips([0, 24, 72, 168, 336, Math.round((MS_LUNATION / MS_HOUR) * 10) / 10]);

interface CompareOptions {
  slips_h: number[];
  setSlips(hours: readonly number[]): void;
  addSlip(hours: number): void;
  removeSlip(hours: number): void;
}

const KEY = "lunarnav.compare";

function read(): number[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    const slips = raw && typeof raw === "object" ? (raw as Record<string, unknown>)["slips_h"] : null;
    return Array.isArray(slips) ? normalizeSlips(slips.filter((h): h is number => typeof h === "number")) : DEFAULT_SLIPS_H;
  } catch {
    return DEFAULT_SLIPS_H;
  }
}

export const useCompareOptions = create<CompareOptions>((set) => ({
  slips_h: read(),
  setSlips: (hours) => set({ slips_h: normalizeSlips(hours) }),
  addSlip: (hours) => set((s) => ({ slips_h: normalizeSlips([...s.slips_h, hours]) })),
  removeSlip: (hours) => set((s) => ({ slips_h: normalizeSlips(s.slips_h.filter((h) => h !== hours)) })),
}));

useCompareOptions.subscribe(({ slips_h }) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ slips_h }));
  } catch {
  }
});
