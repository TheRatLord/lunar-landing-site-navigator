import { useCallback, useEffect, useState } from "react";
import { isAbort } from "../../api/client";
import { scenarioApi } from "../../scenario/api";
import { normalizeScenario } from "../../scenario/normalize";

export const stackKey = (w: { id: string; version: string }): string => `${w.id}@${w.version}`;

type StoredStack = string[] | null | "unread";

export function useStoredStacks(wanted: ReadonlyArray<{ id: string; version: string }>): { stacks: Record<string, StoredStack>; reset: () => void } {
  const [stacks, setStacks] = useState<Record<string, StoredStack>>({});
  const wantedKey = wanted.map(stackKey).join("|");
  useEffect(() => {
    const ctl = new AbortController();
    for (const w of wanted) {
      if (stackKey(w) in stacks) continue;
      void scenarioApi.get(w.id, { signal: ctl.signal }).then(
        (rec) => {
          const n = normalizeScenario(rec.document);
          setStacks((prev) => ({ ...prev, [stackKey(w)]: n.scenario ? (n.scenario.terrain_stores ?? null) : "unread" }));
        },
        (e: unknown) => {
          if (!isAbort(e)) setStacks((prev) => ({ ...prev, [stackKey(w)]: "unread" }));
        },
      );
    }
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey, stacks]);
  const reset = useCallback(() => setStacks({}), []);
  return { stacks, reset };
}
