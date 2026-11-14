import { create } from "zustand";
import { polarInverse, polarScale } from "../../lib/projection";
import type { ViewKind } from "../map/urlState";

export interface PublishedMapView {
  kind: ViewKind;
  bounds: [number, number, number, number];
}

export const useMapView = create<{ view: PublishedMapView | null }>(() => ({ view: null }));

export function publishMapView(view: PublishedMapView): void {
  useMapView.setState({ view });
}

export type MapViewRegion =
  | { kind: "disc"; lat_deg: number; lon_deg: number; radius_m: number }
  | { kind: "box"; south: number; north: number; west: number; east: number };

export function regionFromMapView(v: PublishedMapView): MapViewRegion {
  const [x0, y0, x1, y1] = v.bounds;
  if (v.kind === "global") return { kind: "box", south: Math.max(-90, y0), north: Math.min(90, y1), west: Math.max(-180, x0), east: Math.min(180, x1) };
  const c = polarInverse(v.kind, (x0 + x1) / 2, (y0 + y1) / 2);
  const half_map_m = Math.min(x1 - x0, y1 - y0) / 2;
  return { kind: "disc", lat_deg: c.lat_deg, lon_deg: c.lon_deg, radius_m: half_map_m / polarScale(v.kind, c.lat_deg) };
}
