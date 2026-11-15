import { useEffect, useState } from "react";
import { isAbort } from "../../api/client";
import { useFieldErrors } from "../fieldErrors";
import { getIn, type Path } from "../path";
import { issuesAt, useScenario } from "../store";
import type { Origin } from "../types";

export function useField<T>(path: Path): { value: T | undefined; issue: string | null; set(v: unknown): void } {
  const value = useScenario((s) => getIn(s.doc, path) as T | undefined);
  const issue = useScenario((s) => issuesAt(s, path).map((i) => i.msg).join("; "));
  const edit = useScenario((s) => s.edit);
  return { value, issue: issue || null, set: (v) => edit(path, v) };
}

export const USER_ORIGIN: Origin = { basis: "user", label: "", source_url: null, note: "" };

export const editedOrigin = (o: Origin): Origin => ({
  basis: "user",
  label: `Edited from: ${o.label || o.basis}`,
  source_url: o.source_url ?? null,
  note: o.note ?? "",
});

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface SearchState<T> {
  q: string;
  value: T | null;
  error: unknown;
}

export function useSearch<T>(query: string, load: (q: string, signal: AbortSignal) => Promise<T> | null, delayMs = 180, reload = 0): SearchState<T> | null {
  const [state, setState] = useState<SearchState<T> | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    const q = query.trim();
    const t = setTimeout(() => {
      load(q, ctl.signal)?.then(
        (value) => setState({ q, value, error: null }),
        (error: unknown) => !isAbort(error) && setState({ q, value: null, error }),
      );
    }, delayMs);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [query, load, delayMs, reload]);
  return state;
}

export function useReportFieldError(id: string, error: string | null): void {
  useEffect(() => {
    useFieldErrors.getState().report(id, error);
  }, [id, error]);
  useEffect(() => () => useFieldErrors.getState().report(id, null), [id]);
}
