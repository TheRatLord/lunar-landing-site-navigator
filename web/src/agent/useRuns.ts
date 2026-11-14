import { useCallback, useEffect, useState } from "react";
import { ApiError, isAbort } from "../api/client";
import { agentApi } from "../api/endpoints";
import type { RunSummary } from "../api/types";
import { instructionsApi } from "./api";
import type { InstructionsInfo } from "./events";
import { isActiveState } from "./format";

export interface RunsData {
  runs: RunSummary[] | null;
  error: ApiError | null;
  refresh: () => void;
}

export function useRuns(pollMs = 4000): RunsData {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);
  const anyActive = runs?.some((r) => isActiveState(r.state)) ?? false;

  useEffect(() => {
    const ctl = new AbortController();
    agentApi.listRuns({ signal: ctl.signal }).then(
      (r) => {
        setRuns(r.slice().sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))));
        setError(null);
      },
      (e: unknown) => {
        if (!isAbort(e) && e instanceof ApiError) setError(e);
      },
    );
    return () => ctl.abort();
  }, [nonce]);

  useEffect(() => {
    if (!anyActive && !error) return;
    const t = setInterval(() => setNonce((n) => n + 1), pollMs);
    return () => clearInterval(t);
  }, [anyActive, error, pollMs]);

  return { runs, error, refresh: useCallback(() => setNonce((n) => n + 1), []) };
}

export interface ServiceInstructions {
  instructions: InstructionsInfo | null;
  error: ApiError | null;
}

export function useServiceInstructions(): ServiceInstructions {
  const [state, setState] = useState<ServiceInstructions>({ instructions: null, error: null });
  useEffect(() => {
    const ctl = new AbortController();
    instructionsApi.get({ signal: ctl.signal }).then(
      (instructions) => setState({ instructions, error: null }),
      (e: unknown) => {
        if (!isAbort(e) && e instanceof ApiError) setState({ instructions: null, error: e });
      },
    );
    return () => ctl.abort();
  }, []);
  return state;
}
