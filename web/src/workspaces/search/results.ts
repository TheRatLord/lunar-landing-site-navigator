import { create } from "zustand";
import type { SearchRow } from "../../api/search";

export function searchScenarioKey(doc: unknown): string | null {
  return doc ? JSON.stringify(doc) : null;
}

interface SearchResultsStore {
  candidates: SearchRow[];
  scenarioKey: string | null;
  stale: boolean;
  selectedRank: number | null;
  setCandidates(rows: SearchRow[], scenarioKey: string | null): void;
  setStale(stale: boolean): void;
  select(rank: number | null): void;
  clear(): void;
}

export const useSearchResults = create<SearchResultsStore>((set) => ({
  candidates: [],
  scenarioKey: null,
  stale: false,
  selectedRank: null,
  setCandidates: (candidates, scenarioKey) => set({ candidates, scenarioKey, stale: false, selectedRank: null }),
  setStale: (stale) => set({ stale }),
  select: (selectedRank) => set({ selectedRank }),
  clear: () => set({ candidates: [], scenarioKey: null, stale: false, selectedRank: null }),
}));

export function searchPinsCurrent(s: Pick<SearchResultsStore, "candidates" | "scenarioKey" | "stale">, doc: unknown): boolean {
  return s.candidates.length > 0 && !s.stale && s.scenarioKey !== null && s.scenarioKey === searchScenarioKey(doc);
}
