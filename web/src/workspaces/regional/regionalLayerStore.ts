import { create } from "zustand";
import { isAbort } from "../../api/client";
import { runAnalysis } from "../../api/jobs";
import { REGIONAL_ENDPOINT, type RegionalBody, type RegionalResult } from "../../api/regional";
import { learnPace } from "../map/eta";

type Phase = "idle" | "running" | "done" | "error";

interface RegionalRun {
  metric: string;
  phase: Phase;
  progress: number | null;
  startedMs: number | null;
  guessS: number;
  error: string | null;
  result: RegionalResult | null;
  resultBody: RegionalBody | null;
  resultMetric: string | null;
  shown: boolean;
  opacity: number;
  setMetric(metric: string): void;
  run(body: RegionalBody, guessS: number): void;
  cancel(): void;
  set(patch: Partial<Pick<RegionalRun, "shown" | "opacity">>): void;
}

let controller: AbortController | null = null;

export const useRegionalLayer = create<RegionalRun>((set, get) => ({
  metric: "sunlit_fraction",
  phase: "idle",
  progress: null,
  startedMs: null,
  guessS: 0,
  error: null,
  result: null,
  resultBody: null,
  resultMetric: null,
  shown: true,
  opacity: 0.7,
  setMetric: (metric) => set({ metric }),
  run: (body, guessS) => {
    controller?.abort();
    const ctl = new AbortController();
    controller = ctl;
    const metric = get().metric;
    const startedMs = Date.now();
    let cached = false;
    set({ phase: "running", progress: null, startedMs, guessS, error: null });
    runAnalysis<RegionalResult>(REGIONAL_ENDPOINT, body, {
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
        if (!cached) learnPace("regional", guessS, (Date.now() - startedMs) / 1000);
        set({ phase: "done", progress: 1, result, resultBody: body, resultMetric: metric, shown: true });
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
    set({ phase: get().result ? "done" : "idle", progress: null });
  },
  set: (patch) => set(patch),
}));
