import { createContext, useContext } from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import type { LatLon } from "./measure";
import { KIND_ORDER, type SiteKind } from "./sites";
import type { MapMode } from "./engine";
import type { ViewKind } from "./urlState";

export interface LayerState {
  on: boolean;
  opacity: number;
}

export const LAYER_ORDER = ["relief", "elevation", "slope"] as const;
export type VisualLayerId = (typeof LAYER_ORDER)[number];

export const DEFAULT_LAYERS: Record<VisualLayerId, LayerState> = {
  relief: { on: true, opacity: 1 },
  elevation: { on: false, opacity: 0.55 },
  slope: { on: false, opacity: 0.55 },
};

export type DockTab = "layers" | "sites" | "measure";

interface SiteSnapshot {
  lat_deg: number;
  lon_deg: number;
  name: string;
  catalog_id: string | null;
}

export interface MapStore {
  kind: ViewKind;
  layers: Record<VisualLayerId, LayerState>;
  graticule: boolean;
  stores: boolean;
  sites: boolean;
  pins: boolean;
  regional: boolean;
  regionalOpacity: number;
  kinds: ReadonlySet<SiteKind>;
  confidence: string | null;
  status: string | null;
  query: string;
  selectedId: string | null;
  mode: MapMode;
  measure: LatLon[];
  undo: SiteSnapshot[];
  dockOpen: boolean;
  tab: DockTab;
  shortcuts: boolean;

  set(patch: Partial<Omit<MapStore, "set" | "setLayer" | "toggleKind" | "addMeasure" | "popMeasure" | "pushUndo" | "popUndo">>): void;
  setLayer(id: VisualLayerId, patch: Partial<LayerState>): void;
  toggleKind(k: SiteKind): void;
  addMeasure(p: LatLon): void;
  popMeasure(): void;
  pushUndo(s: SiteSnapshot): void;
  popUndo(): SiteSnapshot | null;
}

export function createMapStore(init: Partial<MapStore>): StoreApi<MapStore> {
  return createStore<MapStore>((set, get) => ({
  kind: "south",
  layers: DEFAULT_LAYERS,
  graticule: true,
  stores: false,
  sites: true,
  pins: true,
  regional: true,
  regionalOpacity: 0.7,
  kinds: new Set(KIND_ORDER),
  confidence: null,
  status: null,
  query: "",
  selectedId: null,
  mode: "pan",
  measure: [],
  undo: [],
  dockOpen: true,
  tab: "layers",
  shortcuts: false,

  set: (patch) => set(patch),
  setLayer: (id, patch) => set((s) => ({ layers: { ...s.layers, [id]: { ...s.layers[id], ...patch } } })),
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
  ...init,
}));
}

export const MapStoreContext = createContext<StoreApi<MapStore> | null>(null);

function identity<T>(x: T): T {
  return x;
}

export function useMapStore(): MapStore;
export function useMapStore<T>(selector: (s: MapStore) => T): T;
export function useMapStore<T>(selector: (s: MapStore) => T = identity as (s: MapStore) => T): T {
  return useStore(useMapStoreApi(), selector);
}

export function useMapStoreApi(): StoreApi<MapStore> {
  const api = useContext(MapStoreContext);
  if (!api) throw new Error("useMapStore outside MapStoreContext");
  return api;
}
