import { create } from "zustand";
import { isAbort } from "../../api/client";
import { runAnalysis } from "../../api/jobs";
import { useReportSurveys } from "../../api/report";
import { SEARCH_ENDPOINT, searchRows, type SearchBody, type SearchResult, type SearchRow } from "../../api/search";
import { learnPace } from "../map/eta";

export function searchScenarioKey(doc: unknown): string | null {
  return doc ? JSON.stringify(doc) : null;
}

type Phase = "idle" | "running" | "done" | "error";

interface SearchResultsStore {
  body: SearchBody | null;
  phase: Phase;
  progress: number | null;
  startedMs: number | null;
  guessS: number;
  error: string | null;
  result: SearchResult | null;
  resultBody: SearchBody | null;
  candidates: SearchRow[];
  scenarioKey: string | null;
  stale: boolean;
  shown: boolean;
  run(body: SearchBody, guessS: number): void;
  cancel(): void;
  setShown(shown: boolean): void;
}

let controller: AbortController | null = null;

export const useSearchResults = create<SearchResultsStore>((set, get) => ({
  body: null,
  phase: "idle",
  progress: null,
  startedMs: null,
  guessS: 0,
  error: null,
  result: null,
  resultBody: null,
  candidates: [],
  scenarioKey: null,
  stale: false,
  shown: true,
  run: (body, guessS) => {
    controller?.abort();
    const ctl = new AbortController();
    controller = ctl;
    const startedMs = Date.now();
    let cached = false;
    set({ body, phase: "running", progress: null, startedMs, guessS, error: null, shown: true });
    runAnalysis<SearchResult>(SEARCH_ENDPOINT, body, {
      signal: ctl.signal,
      onStatus: (st) => {
        if (controller === ctl) set({ progress: st.progress ?? null });
      },
      onCache: (hit) => {
        cached = hit;
      },
    }).then(
      (result) => {
        if (controller !== ctl) return;
        controller = null;
        if (!cached) learnPace("search", guessS, (Date.now() - startedMs) / 1000);
        set({ phase: "done", progress: 1, result, resultBody: body, candidates: searchRows(result), scenarioKey: searchScenarioKey(body.scenario), stale: false });
        useReportSurveys.getState().publishSearch({ request: body, stale: false });
      },
      (e: unknown) => {
        if (controller !== ctl || ctl.signal.aborted || isAbort(e)) return;
        controller = null;
        set({ phase: "error", error: e instanceof Error ? e.message : String(e) });
      },
    );
  },
  cancel: () => {
    controller?.abort();
    controller = null;
    set({ phase: get().result ? "done" : "idle", progress: null, body: get().resultBody });
  },
  setShown: (shown) => set({ shown }),
}));
