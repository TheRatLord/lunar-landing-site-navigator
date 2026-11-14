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
export const MAP_STATE = { unknown: -1, fail: 0, marginal: 1, pass: 2, outside: -2 } as const;

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

export const DEFAULT_PARAMS: EllipseParams = {
  n_samples: 512,
  seed: 0,
  truncate: true,
  map_cells: 17,
  hazard_slope_deg: null,
  hazard_roughness_m: null,
};

export function validateParams(p: EllipseParams, scenario: Scenario | null): string[] {
  const out: string[] = [];
  const L = ELLIPSE_LIMITS;
  if (!scenario?.ellipse) out.push("The plan has no landing ellipse. Set its semi-axes on the Mission page.");
  if (!Number.isInteger(p.n_samples) || p.n_samples < L.nSamples.min || p.n_samples > L.nSamples.max)
    out.push(`Samples must be a whole number from ${L.nSamples.min} to ${L.nSamples.max.toLocaleString("en-US")}; the engine refuses more with a 422.`);
  if (!Number.isInteger(p.seed) || p.seed < 0 || p.seed > L.seedMax) out.push(`Seed must be a whole number from 0 to ${L.seedMax.toLocaleString("en-US")}.`);
  if (p.map_cells !== null && (!Number.isInteger(p.map_cells) || p.map_cells < L.mapCells.min || p.map_cells > L.mapCells.max))
    out.push(`Map nodes per side must be a whole number from ${L.mapCells.min} to ${L.mapCells.max}, or empty to skip the map.`);
  if (p.hazard_slope_deg !== null && !(p.hazard_slope_deg > 0 && p.hazard_slope_deg <= 90)) out.push("Hazard slope must be above 0 and at most 90 degrees.");
  if (p.hazard_roughness_m !== null && !(p.hazard_roughness_m > 0)) out.push("Hazard roughness must be above 0 m.");
  return out;
}

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
