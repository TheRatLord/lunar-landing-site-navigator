import { useCallback, useEffect, useState } from "react";
import { ApiError, isAbort } from "./client";

export type Loaded<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; error: ApiError };

export function useLoad<T>(load: (signal: AbortSignal) => Promise<T>): { state: Loaded<T>; reload: () => void } {
  const [state, setState] = useState<Loaded<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const ctl = new AbortController();
    load(ctl.signal).then(
      (data) => setState({ status: "ready", data }),
      (e: unknown) => {
        if (isAbort(e)) return;
        setState({ status: "error", error: e instanceof ApiError ? e : new ApiError({ status: 0, title: "Request failed", detail: String(e), cause: e }) });
      },
    );
    return () => ctl.abort();
  }, [load, nonce]);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    setNonce((n) => n + 1);
  }, []);
  return { state, reload };
}
