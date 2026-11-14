import { create } from "zustand";
import type { RegionalBody, RegionalResult } from "../../api/regional";
import type { LayerSupport } from "./regionalLayer";

export interface RegionalLayerShown {
  result: RegionalResult;
  request: RegionalBody;
  stale: boolean;
  metric: string;
  layer: string;
  domain: [number, number] | null;
  support: LayerSupport | null;
}

export const useRegionalLayer = create<{ shown: RegionalLayerShown | null }>(() => ({ shown: null }));
