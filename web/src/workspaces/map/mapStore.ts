import { create } from "zustand";
import type { LatLon } from "./measure";
import { KIND_ORDER, type SiteKind } from "./sites";
import type { MapMode } from "./engine";
import type { SiteSnapshot } from "./siteMove";
import type { ViewKind } from "./urlState";
import type { MapView } from "./view";

export type BaseLayer = "relief" | "elevation" | "slope";
export type Popup = { kind: "site"; id: string } | { kind: "pin"; rank: number } | { kind: "probe" };

export interface MapStore {
  base: BaseLayer;
  baseOpacity: number;
  graticule: boolean;
  sites: boolean;
  searchLayer: boolean;
  skyLayer: boolean;
  kinds: ReadonlySet<SiteKind>;
  popup: Popup | null;
  probe: LatLon | null;
  mode: MapMode;
  measure: LatLon[];
  undo: SiteSnapshot[];
  dockOpen: boolean;
  saved: { kind: ViewKind; view: MapView; siteKey: string } | null;

  set(patch: Partial<Omit<MapStore, "set" | "toggleKind" | "addMeasure" | "popMeasure" | "pushUndo" | "popUndo">>): void;
  toggleKind(k: SiteKind): void;
  addMeasure(p: LatLon): void;
  popMeasure(): void;
  pushUndo(s: SiteSnapshot): void;
  popUndo(): SiteSnapshot | null;
}

export const useMapStore = create<MapStore>((set, get) => ({
  base: "relief",
  baseOpacity: 0.55,
  graticule: true,
  sites: true,
  searchLayer: true,
  skyLayer: true,
  kinds: new Set(KIND_ORDER),
  popup: null,
  probe: null,
  mode: "choose",
  measure: [],
  undo: [],
  dockOpen: true,
  saved: null,

  set: (patch) => set(patch),
  toggleKind: (k) =>
    set((s) => {
      const next = new Set(s.kinds);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return { kinds: next };
    }),
  addMeasure: (p) => set((s) => ({ measure: [...s.measure, p] })),
  popMeasure: () => set((s) => ({ measure: s.measure.slice(0, -1) })),
  pushUndo: (snap) => set((s) => ({ undo: [...s.undo.slice(-19), snap] })),
  popUndo: () => {
    const u = get().undo;
    const last = u[u.length - 1] ?? null;
    if (last) set({ undo: u.slice(0, -1) });
    return last;
  },
}));
