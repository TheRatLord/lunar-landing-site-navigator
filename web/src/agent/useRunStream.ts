import { stripBidiDeep } from "./bidi";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ApiError, isAbort } from "../api/client";
import { agentApi } from "../api/endpoints";
import { openEventStream, type StreamStatusInfo } from "../api/sse";
import type { RunSummary } from "../api/types";
import type { StreamEvent } from "./events";
import { applyEvents, initialRunState, isRunning, type RunState } from "./reduce";
import { isActiveState } from "./format";

type Action = { runId: string; events: StreamEvent[] };

function reducer(state: RunState, a: Action): RunState {
  const base = state.runId === a.runId ? state : initialRunState(a.runId);
  return applyEvents(base, a.events);
}

export interface RunConnection {
  state: RunState;
  summary: RunSummary | null;
  loadError: ApiError | null;
  stream: StreamStatusInfo;
  recoveries: number;
  lastResumeSeq: number | null;
  streamsBusy: boolean;
  reload: () => void;
  follow: () => void;
}

const IDLE: StreamStatusInfo = { status: "ended" };

interface Meta {
  runId: string | null;
  summary: RunSummary | null;
  loadError: ApiError | null;
  stream: StreamStatusInfo;
  recoveries: number;
  lastResumeSeq: number | null;
  streamsBusy: boolean;
}

const freshMeta = (runId: string | null): Meta => ({ runId, summary: null, loadError: null, stream: IDLE, recoveries: 0, lastResumeSeq: null, streamsBusy: false });

export function useRunStream(runId: string | null): RunConnection {
  const [reduced, dispatch] = useReducer(reducer, runId, initialRunState);
  const [meta, setMeta] = useState<Meta>(() => freshMeta(runId));
  const [nonce, setNonce] = useState(0);

  if (meta.runId !== runId) setMeta(freshMeta(runId));
  const empty = useMemo(() => initialRunState(runId), [runId]);
  const state = reduced.runId === runId ? reduced : empty;

  const stateRef = useRef(state);
  const metaRef = useRef(meta);
  useEffect(() => {
    stateRef.current = state;
    metaRef.current = meta;
  }, [state, meta]);

  useEffect(() => {
    if (!runId) return;
    const patch = (p: Partial<Meta>) => setMeta((m) => (m.runId === runId ? { ...m, ...p } : m));
    const ctl = new AbortController();
    agentApi.getRun(runId, { signal: ctl.signal }).then(
      (summary) => patch({ summary }),
      (e: unknown) => {
        if (!isAbort(e) && e instanceof ApiError) patch({ loadError: e });
      },
    );

    let pending: StreamEvent[] = [];
    let frame = 0;
    const flush = () => {
      frame = 0;
      const batch = pending;
      pending = [];
      if (batch.length) dispatch({ runId, events: batch });
    };
    let wasReconnecting = false;
    let seqAtLastEnd = stateRef.current.lastSeq;
    let barrenEnds = 0;
    const resumeAfter = stateRef.current.lastSeq;
    const es = openEventStream({
      path: agentApi.eventsPath(runId),
      ...(resumeAfter >= 0 ? { lastEventId: String(resumeAfter) } : {}),
      reconnectOnEnd: () => {
        const seq = stateRef.current.lastSeq;
        barrenEnds = seq > seqAtLastEnd ? 0 : barrenEnds + 1;
        seqAtLastEnd = seq;
        if (barrenEnds > 2) return false;
        return isRunning(stateRef.current) || isActiveState(metaRef.current.summary?.state);
      },
      onMessage: (m) => {
        try {
          const e = stripBidiDeep(JSON.parse(m.data) as StreamEvent);
          if (typeof e.seq !== "number") return;
          pending.push(e);
          if (!frame) frame = requestAnimationFrame(flush);
        } catch {
        }
      },
      onStatus: (info) => {
        if (info.error instanceof ApiError && info.error.status === 429) {
          es.close();
          patch({ stream: { status: "failed", error: info.error }, streamsBusy: true });
          return;
        }
        patch({ stream: info, streamsBusy: false });
        if (info.status === "reconnecting") wasReconnecting = true;
        if (info.status === "open" && wasReconnecting) {
          wasReconnecting = false;
          setMeta((mm) => (mm.runId === runId ? { ...mm, recoveries: mm.recoveries + 1, lastResumeSeq: stateRef.current.lastSeq } : mm));
        }
        if (info.status === "failed" && info.error instanceof ApiError) {
          const err = info.error;
          setMeta((mm) => (mm.runId === runId ? { ...mm, loadError: mm.loadError ?? err } : mm));
        }
      },
    });
    return () => {
      ctl.abort();
      es.close();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [runId, nonce]);

  const turns = state.totals.turns;
  useEffect(() => {
    if (!runId || turns === 0) return;
    const ctl = new AbortController();
    agentApi.getRun(runId, { signal: ctl.signal }).then(
      (summary) => setMeta((m) => (m.runId === runId ? { ...m, summary } : m)),
      () => undefined,
    );
    return () => ctl.abort();
  }, [runId, turns]);

  const reload = useCallback(() => {
    setMeta((m) => freshMeta(m.runId));
    setNonce((n) => n + 1);
  }, []);
  const follow = useCallback(() => {
    if (metaRef.current.stream.status === "ended") setNonce((n) => n + 1);
  }, []);
  return { state, ...meta, reload, follow };
}
