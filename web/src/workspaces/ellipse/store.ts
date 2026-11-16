import { useMemo } from "react";
import { create } from "zustand";
import { isAbort } from "../../api/client";
import { ELLIPSE_ENDPOINT, type EllipseBody, type EllipseParams, type EllipseResult } from "../../api/ellipse";
import { runAnalysis } from "../../api/jobs";
import { queueInfoFrom, type QueueInfo } from "../../api/queue";
import { useReportSurveys } from "../../api/report";
import type { JobStatus } from "../../contract/types";
import type { Scenario } from "../../scenario/types";

export const DEFAULT_POINTS = 64;

export const ellipseParams = (points: string): EllipseParams => ({
  n_samples: points.trim() === "" ? Number.NaN : Number(points),
  seed: 0,
  truncate: true,
  map_cells: null,
  hazard_slope_deg: null,
  hazard_roughness_m: null,
});

type Phase = "idle" | "running" | "done" | "error";

interface EllipseRun {
  points: string;
  body: EllipseBody | null;
  phase: Phase;
  progress: number | null;
  stage: string | undefined;
  jobState: JobStatus["state"] | null;
  queue: QueueInfo | null;
  createdMs: number | null;
  result: EllipseResult | null;
  resultBody: EllipseBody | null;
  error: Error | null;
  setPoints(points: string): void;
  run(body: EllipseBody): void;
  cancel(): void;
}

let ctl: AbortController | null = null;

const IDLE_JOB = { progress: null, stage: undefined, jobState: null, queue: null, createdMs: null } as const;

export const useEllipseRun = create<EllipseRun>((set, get) => ({
  points: String(DEFAULT_POINTS),
  body: null,
  phase: "idle",
  ...IDLE_JOB,
  result: null,
  resultBody: null,
  error: null,
  setPoints: (points) => set({ points }),
  run: (body) => {
    ctl?.abort();
    const mine = new AbortController();
    ctl = mine;
    set({ body, phase: "running", ...IDLE_JOB, error: null });
    runAnalysis<EllipseResult>(ELLIPSE_ENDPOINT, body, {
      signal: mine.signal,
      onStatus: (s) =>
        ctl === mine &&
        set({ jobState: s.state, progress: s.progress ?? null, stage: s.stage ?? undefined, queue: s.state === "queued" ? queueInfoFrom(s) : null, createdMs: s.created_ms ?? get().createdMs }),
    }).then(
      (result) => {
        if (ctl !== mine) return;
        ctl = null;
        set({ phase: "done", ...IDLE_JOB, result, resultBody: body });
        useReportSurveys.getState().publishEllipse({ request: body, stale: false });
      },
      (e: unknown) => {
        if (ctl !== mine || mine.signal.aborted || isAbort(e)) return;
        ctl = null;
        set({ phase: "error", ...IDLE_JOB, error: e instanceof Error ? e : new Error(String(e)) });
      },
    );
  },
  cancel: () => {
    ctl?.abort();
    ctl = null;
    set((s) => ({ phase: s.result ? "done" : "idle", ...IDLE_JOB, body: s.resultBody }));
  },
}));

export function samePlan(a: Scenario | null | undefined, b: Scenario | null | undefined): boolean {
  return !!a && !!b && (a === b || JSON.stringify(a) === JSON.stringify(b));
}

export function useEllipsePassShare(doc: Scenario | null): number | null {
  const result = useEllipseRun((s) => s.result);
  const body = useEllipseRun((s) => s.resultBody);
  return useMemo(() => {
    if (!result || !body || !samePlan(body.scenario, doc)) return null;
    const p = result.state_probability["PASS"];
    return typeof p === "number" && Number.isFinite(p) ? p : null;
  }, [result, body, doc]);
}
