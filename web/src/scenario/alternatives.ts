import { create } from "zustand";

export interface Candidate {
  id: string;
  name: string;
  lat_deg: number;
  lon_deg: number;
  catalog_id: string | null;
}

interface AlternativesStore {
  items: Candidate[];
  add(c: Candidate): void;
  remove(id: string): void;
  clear(): void;
}

const KEY = "lunarnav.alternatives";

const isCandidate = (c: unknown): c is Candidate =>
  !!c &&
  typeof c === "object" &&
  "id" in c && typeof c.id === "string" &&
  "name" in c && typeof c.name === "string" &&
  "lat_deg" in c && typeof c.lat_deg === "number" && Number.isFinite(c.lat_deg) &&
  "lon_deg" in c && typeof c.lon_deg === "number" && Number.isFinite(c.lon_deg) &&
  "catalog_id" in c && (c.catalog_id === null || typeof c.catalog_id === "string");

function read(): Candidate[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter(isCandidate) : [];
  } catch {
    return [];
  }
}

export const useAlternatives = create<AlternativesStore>((set) => ({
  items: read(),
  add: (c) => set((s) => (s.items.some((x) => x.id === c.id) ? s : { items: [...s.items, c] })),
  remove: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
  clear: () => set({ items: [] }),
}));

export function seedAlternatives(items: Candidate[]): void {
  try {
    if (localStorage.getItem(KEY) !== null) return;
  } catch {
    return;
  }
  if (useAlternatives.getState().items.length === 0) useAlternatives.setState({ items });
}

useAlternatives.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s.items));
  } catch {
  }
});

export interface BlockerMark {
  from: { lat_deg: number; lon_deg: number };
  to: { lat_deg: number; lon_deg: number };
  azimuth_deg: number;
  distance_m: number;
  label: string;
}

interface OverlayStore {
  blocker: BlockerMark | null;
  setBlocker(b: BlockerMark | null): void;
  picking: boolean;
  setPicking(on: boolean): void;
}

export const useOverlays = create<OverlayStore>((set) => ({
  blocker: null,
  setBlocker: (blocker) => set({ blocker }),
  picking: false,
  setPicking: (picking) => set({ picking }),
}));
