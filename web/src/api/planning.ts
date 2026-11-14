import type { Verdict } from "../contract/types";
import type { components } from "./generated/schema";
import type { Scenario } from "../scenario/types";
import { exportFiles, type ExportedFile } from "./exports";

export type TerrainMode = "auto" | "on" | "off";

export const PLANNING_ENDPOINTS = {
  scan: "/analyses/scan",
  slip: "/analyses/slip",
  compare: "/analyses/compare",
  exports: "/exports",
} as const;

type Schemas = components["schemas"];

export type VerdictState = Verdict | "unknown";
export type SlipMode = "landing" | "launch";
interface EchoedSite {
  lat_deg: number;
  lon_deg: number;
  name: string;
  catalog_id: string | null;
}

export type ServiceConstraintVerdict = Omit<Schemas["ConstraintVerdict"], "state"> & { state: VerdictState };
export type ServiceVerdict = Omit<Schemas["Verdict"], "state" | "constraints"> & { state: VerdictState; constraints: ServiceConstraintVerdict[] };

export type ScanWindow = Schemas["OpenWindow"] & { best_state: Verdict };
export type ScanResult = Omit<Schemas["ScanResult"], "states" | "counts" | "windows"> & {
  states: Record<Verdict, number>;
  counts: Record<Verdict, number>;
  windows: ScanWindow[];
};

export type SlipRow = Omit<Schemas["SlipRow"], "state" | "verdict" | "next_open_state"> & {
  state: VerdictState | "no_opportunity";
  verdict: ServiceVerdict | null;
  next_open_state: Verdict | null;
};
export type SlipSite = Omit<Schemas["SlipSiteResult"], "site" | "mode" | "rows"> & { site: EchoedSite; mode: SlipMode; rows: SlipRow[] };
export type SlipResult = Omit<Schemas["SlipResult"], "mode" | "results"> & { mode: SlipMode; results: SlipSite[] };

export type CompareMetric = Schemas["CompareMetric"];
export type CompareScenario = Omit<Schemas["CompareScenario"], "state" | "verdict" | "site"> & { state: VerdictState; verdict: ServiceVerdict; site: EchoedSite };
export type CompareResult = Omit<Schemas["CompareResult"], "scenarios"> & { scenarios: CompareScenario[] };

export interface ScanParams {
  start_utc: string;
  end_utc: string;
  spacing_s: number;
}

export interface SlipParams {
  slips_h: number[];
  mode: SlipMode;
  search_days: number;
  spacing_s: number;
  alternative_sites?: string[];
  alternative_coordinates?: Array<{ name: string; lat_deg: number; lon_deg: number }>;
}

export interface ScenarioItem {
  scenario?: Scenario;
  scenario_id?: string;
  overrides?: Record<string, unknown>;
}

export const scanBody = (scenario: Scenario, p: ScanParams, terrain: TerrainMode) => ({ scenario, ...p, max_candidates: 12_000, terrain, wait_s: 3 });
export const slipBody = (scenario: Scenario, p: SlipParams, terrain: TerrainMode) => ({
  scenario,
  ...p,
  alternative_sites: p.alternative_sites?.length ? p.alternative_sites : undefined,
  alternative_coordinates: p.alternative_coordinates?.length ? p.alternative_coordinates : undefined,
  terrain,
  wait_s: 3,
});
export const compareBody = (items: ScenarioItem[], names: string[], terrain: TerrainMode) => ({ items, names, terrain, wait_s: 3 });

export type PlanningExport = "calendar-csv" | "opportunities-csv" | "slip-csv" | "comparison-csv";

export function requestPlanningExport(kind: PlanningExport, body: Record<string, unknown>): Promise<ExportedFile[]> {
  return exportFiles(`${PLANNING_ENDPOINTS.exports}/${kind}`, body, { fallback: kind });
}
