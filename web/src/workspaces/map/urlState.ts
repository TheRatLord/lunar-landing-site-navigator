import { clamp } from "../../lib/scale";

export type ViewKind = "south" | "north" | "global";

export const viewKindFor = (lat: number): ViewKind => (lat <= -60 ? "south" : lat >= 60 ? "north" : "global");

export const VIEW_KINDS: readonly ViewKind[] = ["south", "north", "global"];

interface LayerSetting {
  id: string;
  opacity: number;
}

export interface MapUrlState {
  view: ViewKind | null;
  x: number | null;
  y: number | null;
  z: number | null;
  layers: LayerSetting[] | null;
  site: string | null;
}

const num = (v: string | null): number | null => {
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function parseMapUrl(params: URLSearchParams): MapUrlState {
  const view = params.get("view");
  const layersRaw = params.get("layers");
  let layers: LayerSetting[] | null = null;
  if (layersRaw !== null) {
    layers = [];
    for (const part of layersRaw.split(",")) {
      const [id, op] = part.split(":");
      if (!id) continue;
      const o = op === undefined ? 1 : Number(op);
      layers.push({ id, opacity: Number.isFinite(o) ? clamp(o, 0, 1) : 1 });
    }
  }
  return {
    view: VIEW_KINDS.includes(view as ViewKind) ? (view as ViewKind) : null,
    x: num(params.get("x")),
    y: num(params.get("y")),
    z: num(params.get("z")),
    layers,
    site: params.get("site") || null,
  };
}

function roundCentre(view: ViewKind, v: number): number {
  return view === "global" ? Math.round(v * 1e5) / 1e5 : Math.round(v * 10) / 10;
}

export interface MapUrlWrite {
  view: ViewKind;
  cx: number;
  cy: number;
  zoom: number;
  layers: LayerSetting[];
  site: string | null;
}

export function writeMapUrl(base: URLSearchParams, s: MapUrlWrite): string {
  const p = new URLSearchParams(base);
  p.set("view", s.view);
  p.set("x", String(roundCentre(s.view, s.cx)));
  p.set("y", String(roundCentre(s.view, s.cy)));
  p.set("z", s.zoom.toFixed(2));
  p.set("layers", s.layers.map((l) => (l.opacity === 1 ? l.id : `${l.id}:${Math.round(l.opacity * 100) / 100}`)).join(","));
  if (s.site) p.set("site", s.site);
  else p.delete("site");
  return p.toString().replace(/%3A/g, ":").replace(/%2C/g, ",");
}
