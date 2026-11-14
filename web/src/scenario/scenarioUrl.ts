import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "../state/toasts";
import { selectDirty, useScenario } from "./store";

const SCENARIO_ID_RE = /^scen-[0-9a-f]{12}$/;

function scenarioIdFromParams(params: URLSearchParams): string | null {
  const id = params.get("scenario");
  return id !== null && SCENARIO_ID_RE.test(id) ? id : null;
}

function withScenarioParam(base: URLSearchParams, id: string | null): URLSearchParams {
  const p = new URLSearchParams(base);
  if (id) p.set("scenario", id);
  else p.delete("scenario");
  return p;
}

function openFromLink(): void {
  if (typeof window === "undefined") return;
  const id = scenarioIdFromParams(new URLSearchParams(window.location.search));
  const s = useScenario.getState();
  if (id === null || id === s.saved?.id) return;
  if (selectDirty(s)) {
    toast({
      kind: "warning",
      title: "Could not open the linked plan",
      detail: `The open plan has unsaved edits. Save or discard them, then open ${id} from Plans.`,
    });
    return;
  }
  void s.load(id);
}

openFromLink();

export function useScenarioUrl(): void {
  const [params, setParams] = useSearchParams();
  const savedId = useScenario((s) => s.saved?.id ?? null);
  const loading = useScenario((s) => s.phase === "loading");
  useEffect(() => {
    if (loading || params.get("scenario") === savedId) return;
    setParams(withScenarioParam(params, savedId), { replace: true });
  }, [loading, savedId, params, setParams]);
}
