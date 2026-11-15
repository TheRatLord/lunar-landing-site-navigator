import { useCallback, useEffect, useReducer, useRef } from "react";
import { ApiError, isAbort, reportError } from "../../api/client";
import { runAnalysis } from "../../api/jobs";
import { SITE_ENDPOINTS, attributionBody, type AttributionRequest, type AttributionResult } from "../../api/site";
import { useOverlays, type BlockerMark } from "../../scenario/alternatives";
import type { Scenario } from "../../scenario/types";
import { blockerMark, terrainSets } from "./adapt";

export interface AttributionState {
  phase: "idle" | "running" | "done" | "error";
  label: string;
  az_deg: number | null;
  result: AttributionResult | null;
  error: Error | null;
  missing: boolean;
  doc: Scenario | null;
}

const IDLE: AttributionState = { phase: "idle", label: "", az_deg: null, result: null, error: null, missing: false, doc: null };

type Action = { type: "start"; label: string; az_deg: number | null; doc: Scenario } | { type: "done"; result: AttributionResult } | { type: "fail"; error: Error } | { type: "clear" };

function reduce(s: AttributionState, a: Action): AttributionState {
  switch (a.type) {
    case "start":
      return { phase: "running", label: a.label, az_deg: a.az_deg, result: null, error: null, missing: false, doc: a.doc };
    case "done":
      return { ...s, phase: "done", result: a.result };
    case "fail":
      return { ...s, phase: "error", error: a.error, missing: a.error instanceof ApiError && (a.error.status === 404 || a.error.status === 405) };
    case "clear":
      return IDLE;
  }
}

let kept: { state: AttributionState; blocker: BlockerMark | null } = { state: IDLE, blocker: null };

export function useAttribution(scenario: Scenario) {
  const [state, dispatch] = useReducer(reduce, scenario, (doc) => (kept.state.doc === doc && kept.state.phase === "done" ? kept.state : IDLE));
  const ctlRef = useRef<AbortController | null>(null);
  const setBlocker = useOverlays((s) => s.setBlocker);

  useEffect(() => {
    kept = { ...kept, state };
  }, [state]);

  useEffect(() => {
    if (kept.state.doc === scenario && kept.state.phase === "done") {
      setBlocker(kept.blocker);
      return;
    }
    ctlRef.current?.abort();
    kept = { state: IDLE, blocker: null };
    setBlocker(null);
  }, [scenario, setBlocker]);

  useEffect(
    () => () => {
      ctlRef.current?.abort();
      setBlocker(null);
    },
    [setBlocker],
  );

  const request = useCallback(
    (req: AttributionRequest, label: string, az_deg: number | null) => {
      ctlRef.current?.abort();
      const ctl = new AbortController();
      ctlRef.current = ctl;
      kept = { ...kept, blocker: null };
      dispatch({ type: "start", label, az_deg, doc: scenario });
      runAnalysis<AttributionResult>(SITE_ENDPOINTS.attribution, attributionBody(scenario, "auto", req), { signal: ctl.signal }).then(
        (result) => {
          dispatch({ type: "done", result });
          const ev = result.event;
          const az = result.azimuth;
          const mark = ev
            ? (terrainSets(ev) ? blockerMark(scenario, label, ev.az_deg, ev.blocker_dist_m, ev.blocker) : null)
            : az
              ? blockerMark(scenario, label, az.az_deg, az.blocker_dist_m, az.blocker)
              : null;
          kept = { ...kept, blocker: mark };
          setBlocker(mark);
        },
        (e: unknown) => {
          if (ctl.signal.aborted || isAbort(e)) return;
          const error = e instanceof Error ? e : new Error(String(e));
          dispatch({ type: "fail", error });
          setBlocker(null);
          if (!(error instanceof ApiError && (error.status === 404 || error.status === 405))) reportError(error, "Could not trace the blocker");
        },
      );
    },
    [scenario, setBlocker],
  );

  const clear = useCallback(() => {
    ctlRef.current?.abort();
    kept = { state: IDLE, blocker: null };
    dispatch({ type: "clear" });
    setBlocker(null);
  }, [setBlocker]);

  return { state: state.doc === scenario ? state : IDLE, request, clear };
}
