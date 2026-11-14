import { useEffect, useState } from "react";
import { ApiError, isAbort, sendJson } from "../../api/client";
import { issuesFromError, useScenario } from "../store";
import type { Scenario } from "../types";

export type ValidationState = "idle" | "checking" | "ok" | "invalid" | "unavailable";

interface Result {
  doc: Scenario;
  state: "ok" | "invalid" | "unavailable";
}

let unavailable = false;

export function useLiveValidation(): { state: ValidationState } {
  const doc = useScenario((s) => s.doc);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (!doc || unavailable) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      sendJson("/scenarios/validate", { document: doc }, { signal: ctl.signal }).then(
        () => {
          useScenario.getState().clearIssues();
          setResult({ doc, state: "ok" });
        },
        (e: unknown) => {
          if (isAbort(e)) return;
          if (e instanceof ApiError && e.status === 422) {
            useScenario.setState({ issues: issuesFromError(e) });
            setResult({ doc, state: "invalid" });
          } else if (e instanceof ApiError && (e.status === 404 || e.status === 405)) {
            unavailable = true;
            setResult({ doc, state: "unavailable" });
          }
        },
      );
    }, 700);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [doc]);

  if (!doc) return { state: "idle" };
  if (unavailable) return { state: "unavailable" };
  if (!result || result.doc !== doc) return { state: "checking" };
  return { state: result.state };
}
