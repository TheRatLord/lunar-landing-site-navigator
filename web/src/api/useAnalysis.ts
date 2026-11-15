import { useEffect, useMemo, useReducer, useRef } from "react";
import type { JobStatus } from "../contract/types";
import { cancelJob, runAnalysis, type CancelReply } from "./jobs";
import { isAbort, reportError } from "./client";
import { queueInfoFrom, type QueueInfo } from "./queue";

type AnalysisPhase = "idle" | "running" | "done" | "error";

export interface AnalysisState<R> {
  phase: AnalysisPhase;
  progress: number | null;
  stage: string | undefined;
  jobId: string | null;
  jobState: JobStatus["state"] | null;
  queue: QueueInfo | null;
  createdMs: number | null;
  result: R | null;
  stale: boolean;
  cached: boolean;
  error: Error | null;
  cancelNote: string | null;
  cancelEffect: CancelReply["effect"] | null;
}

export interface AnalysisControls {
  cancel(): void;
  forceCancel(): Promise<void>;
  rerun(): void;
}

type Inner<R> = Omit<AnalysisState<R>, "stale"> & { key: string; resultKey: string | null };

type AnalysisAction<R> =
  | { type: "start"; key: string }
  | { type: "status"; key: string; status: JobStatus }
  | { type: "done"; key: string; result: R; cached: boolean }
  | { type: "fail"; key: string; error: Error }
  | { type: "cancel"; key: string }
  | { type: "cancelReply"; key: string; detail: string; effect: CancelReply["effect"] };

const RESET = { progress: null, stage: undefined, jobId: null, jobState: null, queue: null, createdMs: null, cached: false, error: null, cancelNote: null, cancelEffect: null } as const;

function initialAnalysis<R>(): Inner<R> {
  return { ...RESET, key: "", phase: "idle", result: null, resultKey: null };
}

function reduceAnalysis<R>(s: Inner<R>, a: AnalysisAction<R>): Inner<R> {
  if (a.type === "start") return { ...s, ...RESET, key: a.key, phase: "running" };
  if (a.key !== s.key) return s;
  switch (a.type) {
    case "status":
      return {
        ...s,
        jobId: a.status.id,
        jobState: a.status.state,
        queue: a.status.state === "queued" ? queueInfoFrom(a.status) : null,
        createdMs: a.status.created_ms ?? s.createdMs,
        progress: a.status.progress ?? null,
        stage: a.status.stage ?? undefined,
      };
    case "done":
      return { ...s, phase: "done", progress: 1, result: a.result, resultKey: a.key, cached: a.cached, error: null };
    case "fail":
      return { ...s, phase: "error", error: a.error };
    case "cancelReply":
      return { ...s, cancelNote: a.detail, cancelEffect: a.effect };
    case "cancel":
      return { ...s, phase: s.result !== null && s.resultKey === a.key ? "done" : "idle", progress: null };
  }
}

function analysisView<R>({ key: innerKey, resultKey, ...inner }: Inner<R>, key: string): AnalysisState<R> {
  const current = innerKey === key && key !== "";
  return {
    ...inner,
    ...(current ? {} : RESET),
    phase: key === "" ? "idle" : current ? inner.phase : "running",
    stale: inner.result !== null && resultKey !== key,
  };
}

const cache = new Map<string, unknown>();
const CACHE_MAX = 24;

export function useAnalysis<R>(path: string, body: unknown, opts: { debounceMs?: number } = {}): AnalysisState<R> & AnalysisControls {
  const key = body === null ? "" : `${path}\n${JSON.stringify(body)}`;
  const debounceMs = opts.debounceMs ?? 250;
  const [inner, dispatch] = useReducer(reduceAnalysis<R>, undefined, initialAnalysis<R>);
  const [nonce, bump] = useReducer((n: number) => n + 1, 0);
  const ctlRef = useRef<AbortController | null>(null);
  const bodyRef = useRef(body);
  useEffect(() => {
    bodyRef.current = body;
  });

  useEffect(() => {
    if (!key) return;
    const ctl = new AbortController();
    ctlRef.current = ctl;
    const timer = setTimeout(() => {
      const hit = nonce === 0 ? (cache.get(key) as R | undefined) : undefined;
      dispatch({ type: "start", key });
      if (hit !== undefined) {
        dispatch({ type: "done", key, result: hit, cached: true });
        return;
      }
      let cachedByService = false;
      runAnalysis<R>(path, bodyRef.current, {
        signal: ctl.signal,
        onStatus: (status) => dispatch({ type: "status", key, status }),
        onCancel: (reply) => {
          if (reply.effect === "detached") dispatch({ type: "cancelReply", key, detail: reply.detail, effect: reply.effect });
        },
        onCache: (hit) => {
          cachedByService = hit;
        },
      }).then(
        (result) => {
          cache.set(key, result);
          if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
          dispatch({ type: "done", key, result, cached: cachedByService });
        },
        (e: unknown) => {
          if (ctl.signal.aborted || isAbort(e)) return;
          dispatch({ type: "fail", key, error: e instanceof Error ? e : new Error(String(e)) });
        },
      );
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [key, path, nonce, debounceMs]);

  return useMemo(
    () => ({
      ...analysisView(inner, key),
      cancel: () => {
        ctlRef.current?.abort();
        dispatch({ type: "cancel", key });
      },
      forceCancel: async () => {
        if (!inner.jobId || inner.key !== key) return;
        try {
          const reply = await cancelJob(inner.jobId, { force: true });
          dispatch({ type: "cancelReply", key, detail: reply.detail, effect: reply.effect });
        } catch (e) {
          reportError(e, "Could not stop the job for everyone");
        }
      },
      rerun: bump,
    }),
    [inner, key],
  );
}
