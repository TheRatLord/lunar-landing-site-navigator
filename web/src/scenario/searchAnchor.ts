import { create } from "zustand";
import { movePlanSite, useScenario } from "./store";

export interface AnchorPlace {
  lat_deg: number;
  lon_deg: number;
  name: string;
  catalog_id: string | null;
}

export const useSearchAnchor = create<{ held: AnchorPlace | null }>(() => ({ held: null }));

let choosing = false;

function planPlace(): AnchorPlace | null {
  const doc = useScenario.getState().doc;
  return doc ? { lat_deg: doc.site.lat_deg, lon_deg: doc.site.lon_deg, name: doc.site.name ?? "", catalog_id: doc.site.catalog_id ?? null } : null;
}

export function chooseSite(site: AnchorPlace): void {
  if (useSearchAnchor.getState().held === null) useSearchAnchor.setState({ held: planPlace() });
  choosing = true;
  try {
    movePlanSite(site);
  } finally {
    choosing = false;
  }
  const held = useSearchAnchor.getState().held;
  if (held && held.lat_deg === site.lat_deg && held.lon_deg === site.lon_deg) useSearchAnchor.setState({ held: null });
}

export function searchHere(): void {
  useSearchAnchor.setState({ held: null });
}

export function useSearchSite(): AnchorPlace | null {
  const held = useSearchAnchor((s) => s.held);
  const lat_deg = useScenario((s) => s.doc?.site.lat_deg);
  const lon_deg = useScenario((s) => s.doc?.site.lon_deg);
  const name = useScenario((s) => s.doc?.site.name);
  const catalog_id = useScenario((s) => s.doc?.site.catalog_id);
  if (held) return held;
  if (lat_deg === undefined || lon_deg === undefined) return null;
  return { lat_deg, lon_deg, name: name ?? "", catalog_id: catalog_id ?? null };
}

export function searchSiteNow(): AnchorPlace | null {
  return useSearchAnchor.getState().held ?? planPlace();
}

useScenario.subscribe((s, prev) => {
  if (useSearchAnchor.getState().held === null) return;
  const moved = s.doc?.site.lat_deg !== prev.doc?.site.lat_deg || s.doc?.site.lon_deg !== prev.doc?.site.lon_deg;
  if (s.session !== prev.session || s.saved?.id !== prev.saved?.id || s.demo !== prev.demo || (moved && !choosing)) useSearchAnchor.setState({ held: null });
});
