import type { Scenario } from "../scenario/types";
import { request, type Query } from "./client";
import type { components } from "./generated/schema";
import { exportFiles, type ExportedFile } from "./exports";
import type { ServiceConstraintVerdict, ServiceVerdict, TerrainMode } from "./planning";

type Schemas = components["schemas"];

export type { TerrainMode };
export type Observer = "array" | "antenna";

export type Column = ReadonlyArray<number | null>;

export type IntervalJson = Schemas["Interval"];
export type ConstraintVerdictJson = ServiceConstraintVerdict;
export type MetricJson = Schemas["Metric"];
export type HeadingJson = Schemas["HeadingResult"];
export type TerrainStackJson = Schemas["TerrainStackUsed"];
export type LimitNoteJson = Schemas["LimitNote"];
export type HorizonCurve = Schemas["HorizonCurve"];
export type EvaluateSeries = Schemas["Series"];
export type EvaluateResult = Omit<Schemas["EvaluateResult"], "verdict"> & { verdict: ServiceVerdict };
export type AttributionResult = Schemas["AttributionResult"];
export type Provenance = EvaluateResult["provenance"];
export type BlockerPoint = NonNullable<Schemas["HorizonPeak"]["blocker"]>;

export type AttributionRequest =
  | { kind: "sunset" | "sunrise" | "earthset" | "earthrise"; from_utc: string }
  | { az_deg: number; observer: Observer };

export const SITE_ENDPOINTS = {
  evaluate: "/analyses/evaluate",
  attribution: "/analyses/attribution",
  patch: "/terrain/patch",
  exports: "/exports",
} as const;

export function evaluateBody(scenario: Scenario, terrain: TerrainMode): { scenario: Scenario; terrain: TerrainMode } {
  return { scenario, terrain };
}

export function attributionBody(scenario: Scenario, terrain: TerrainMode, req: AttributionRequest) {
  return { scenario, terrain, ...req };
}

export async function fetchTerrainPatch(q: { lat: number; lon: number; size_m: number; n: number }, signal?: AbortSignal): Promise<ArrayBuffer> {
  const res = await request(SITE_ENDPOINTS.patch, { query: q as unknown as Query, accept: "application/octet-stream", signal });
  return res.arrayBuffer();
}

export type ExportKind = "aem" | "timeseries-csv" | "timeseries-json" | "intervals-csv" | "metrics-csv" | "scenario-json" | "bundle";

export function requestExport(
  kind: ExportKind,
  scenario: Scenario,
  terrain: TerrainMode,
  opts: { aem_horizon?: Observer; aem_bound?: "nominal" | "optimistic" | "pessimistic" } = {},
): Promise<ExportedFile[]> {
  return exportFiles(`${SITE_ENDPOINTS.exports}/${kind}`, { scenario, terrain, ...opts }, { fallback: kind, inlineManifest: kind === "bundle" });
}
