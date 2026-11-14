import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, isAbort } from "../../api/client";

export interface LedgerData<D> {
  data: D | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

interface Fetched<D> {
  data: D | null;
  error: ApiError | null;
  loading: boolean;
  key: string;
}

export function useLedger<D>(runId: string | null, revision: number, load: (id: string, o: { signal: AbortSignal }) => Promise<D>): LedgerData<D> {
  const [state, setState] = useState<Fetched<D>>({ data: null, error: null, loading: false, key: "" });
  const [nonce, setNonce] = useState(0);
  const key = `${runId ?? ""}`;

  if (state.key !== key) setState({ data: null, error: null, loading: runId !== null, key });

  useEffect(() => {
    if (!runId) return;
    const ctl = new AbortController();
    load(runId, { signal: ctl.signal }).then(
      (data) => setState({ data, error: null, loading: false, key }),
      (e: unknown) => {
        if (isAbort(e)) return;
        const error = e instanceof ApiError ? e : null;
        setState((s) => ({ ...s, error, loading: false }));
      },
    );
    return () => ctl.abort();
  }, [runId, revision, nonce, load, key]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data: state.data, error: state.error, loading: state.loading, reload };
}

export function useScrollWhen(active: boolean, token = 0) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!active) return;
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    ref.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  }, [active, token]);
  return ref;
}
