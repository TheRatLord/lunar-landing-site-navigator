import { create } from "zustand";
import type { SearchResult } from "../../api/search";
import { defaultWindow, usePlanSearch, type LandingWindow } from "../../scenario/planSearch";
import type { Scenario } from "../../scenario/types";

export type Ask = "when" | "where";
export type Question = "when" | "near" | "window";

interface QuestionStore {
  ask: Ask;
  place: string | null;
  seen: SearchResult | null;
  lastWindow: LandingWindow | null;
  setAsk(ask: Ask): void;
  seePlace(place: string): void;
  seeResult(result: SearchResult): void;
  choose(q: Question, doc: Scenario): void;
}

export const useQuestion = create<QuestionStore>((set, get) => ({
  ask: "when",
  place: null,
  seen: null,
  lastWindow: null,
  setAsk: (ask) => {
    if (get().ask !== ask) set({ ask });
  },
  seePlace: (place) => {
    const s = get();
    if (s.place === place) return;
    set(s.place === null ? { place } : { place, ask: "when" });
  },
  seeResult: (result) => {
    if (get().seen !== result) set({ seen: result, ask: "where" });
  },
  choose: (q, doc) => {
    const plan = usePlanSearch.getState();
    if (q === "when") return set({ ask: "when" });
    if (q === "near") {
      if (plan.window) set({ lastWindow: plan.window });
      plan.setWindow(null);
    } else if (!plan.window) {
      plan.setWindow(get().lastWindow ?? defaultWindow(doc));
    }
    set({ ask: "where" });
  },
}));

export function questionOf(ask: Ask, window: LandingWindow | null): Question {
  return ask === "when" ? "when" : window ? "window" : "near";
}
