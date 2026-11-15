import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { currentSearch, searchToParams, usePlanSearch } from "./planSearch";
import { selectDirty, useScenario } from "./store";

const SCENARIO_ID_RE = /^scen-[0-9a-f]{12}$/;

function scenarioIdFromParams(params: URLSearchParams): string | null {
  const id = params.get("scenario");
  return id !== null && SCENARIO_ID_RE.test(id) ? id : null;
}

function planParams(base: URLSearchParams, id: string | null): URLSearchParams {
  const p = new URLSearchParams(base);
  if (id) p.set("scenario", id);
  else p.delete("scenario");
  return searchToParams(p, currentSearch());
}

export function planLink(): string | null {
  const id = useScenario.getState().saved?.id ?? null;
  if (id === null) return null;
  const p = planParams(new URLSearchParams(), id);
  return `${window.location.origin}${window.location.pathname}?${p.toString()}`;
}

function openFromLink(): void {
  if (typeof window === "undefined") return;
  const id = scenarioIdFromParams(new URLSearchParams(window.location.search));
  const s = useScenario.getState();
  if (id === null || id === s.saved?.id) return;
  if (selectDirty(s)) useScenario.setState({ pendingLink: id });
  else void s.load(id);
}

openFromLink();

export function useScenarioUrl(): void {
  const [params, setParams] = useSearchParams();
  const savedId = useScenario((s) => s.saved?.id ?? null);
  const hold = useScenario((s) => s.phase === "loading" || s.pendingLink !== null);
  const radius = usePlanSearch((s) => s.radius_km);
  const win = usePlanSearch((s) => s.window);
  const rank = usePlanSearch((s) => s.rankBy);
  useEffect(() => {
    if (hold) return;
    const next = planParams(params, savedId);
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [hold, savedId, params, setParams, radius, win, rank]);
}
