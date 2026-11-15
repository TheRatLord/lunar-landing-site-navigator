import type { components } from "./generated/schema";
import type { Scenario } from "../scenario/types";
import type { ServedMarginKind } from "../lib/marginKind";
import type { TerrainMode } from "./planning";

type Schemas = components["schemas"];

export const ELLIPSE_ENDPOINT = "/analyses/ellipse";

export type SampleState = "pass" | "marginal" | "fail" | "unknown";

export type EllipseSampleRef = Omit<Schemas["SampleRef"], "state"> & { state: SampleState };

export interface EllipseSamples {
  east_m: number[];
  north_m: number[];
  lat_deg: number[];
  lon_deg: number[];
  state: SampleState[];
  worst_margin: Array<number | null>;
  worst_margin_physical?: Array<number | null>;
  margin_unit?: Array<string | null>;
  limiting?: Array<string | null>;
  margin_kind?: Array<ServedMarginKind | null>;
  margin_note?: Array<string | null>;
}

interface ConvergenceRow {
  n: number;
  pass: number;
  marginal: number;
  fail: number;
  unknown: number;
}

export interface Convergence {
  rows: ConvergenceRow[];
  max_change_last_halving: number;
  tolerance: number;
  converged: boolean;
  binomial_standard_error: { pass: number; marginal: number; fail: number };
}

export type EllipseResult = Omit<Schemas["EllipseResult"], "best" | "worst" | "centre" | "convergence" | "samples"> & {
  best: EllipseSampleRef;
  worst: EllipseSampleRef;
  centre: EllipseSampleRef;
  convergence: Convergence;
  samples?: EllipseSamples | null;
};

export type EllipseMapGrid = Schemas["EllipseMapGrid"];

export interface EllipseParams {
  n_samples: number;
  seed: number;
  truncate: boolean;
  map_cells: number | null;
  hazard_slope_deg: number | null;
  hazard_roughness_m: number | null;
}

export const ELLIPSE_LIMITS = {
  nSamples: { min: 16, max: 8192 },
  mapCells: { min: 3, max: 65 },
  seedMax: 2 ** 31 - 1,
} as const;

export interface EllipseBody extends EllipseParams {
  scenario: Scenario;
  terrain: TerrainMode;
  wait_s: number;
  with_samples: boolean;
}

export function ellipseBody(scenario: Scenario, p: EllipseParams, terrain: TerrainMode): EllipseBody {
  return {
    scenario,
    terrain,
    wait_s: 3,
    n_samples: p.n_samples,
    seed: p.seed,
    truncate: p.truncate,
    map_cells: p.map_cells,
    hazard_slope_deg: p.hazard_slope_deg,
    hazard_roughness_m: p.hazard_roughness_m,
    with_samples: true,
  };
}
