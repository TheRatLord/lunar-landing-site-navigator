import type { components } from "../api/generated/schema";
import { getJson, request, sendJson, type Query } from "../api/client";
import type { RevisionInfo, Scenario, ScenarioRecord, ScenarioSummary } from "./types";

type Opts = { signal?: AbortSignal };

export type SiteEntry = components["schemas"]["SiteEntry"];
export type StationEntry = components["schemas"]["StationEntry"];

export interface Page<T> {
  total: number;
  items: T[];
}

interface SiteQuery extends Query {
  kind?: string;
  region?: string;
  bbox?: string;
  q?: string;
  confidence?: string;
  limit?: number;
  offset?: number;
}

export const catalogApi = {
  sites: (q: SiteQuery = {}, o: Opts = {}) => getJson<Page<SiteEntry>>("/sites", { query: q, ...o }),
  site: (id: string, o: Opts = {}) => getJson<SiteEntry>(`/sites/${encodeURIComponent(id)}`, o),
  stations: (q: Query = {}, o: Opts = {}) => getJson<Page<StationEntry>>("/stations", { query: q, ...o }),
};

export type ProfileEntry = components["schemas"]["ProfileEntry"];
export type ConstraintPreset = components["schemas"]["ConstraintPresetEntry"];
export type NetworkPreset = components["schemas"]["NetworkPresetEntry"];

export const presetsApi = {
  profiles: async (o: Opts = {}) => (await getJson<{ profiles: ProfileEntry[] }>("/profiles", o)).profiles,
  constraints: async (o: Opts = {}) => (await getJson<{ presets: ConstraintPreset[] }>("/constraints/presets", o)).presets,
  networks: async (o: Opts = {}) => (await getJson<{ presets: NetworkPreset[] }>("/networks/presets", o)).presets,
};

export const scenarioApi = {
  list: (q: { q?: string; limit?: number; offset?: number } = {}, o: Opts = {}) => getJson<Page<ScenarioSummary>>("/scenarios", { query: q, ...o }),
  get: (id: string, o: Opts = {}) => getJson<ScenarioRecord>(`/scenarios/${encodeURIComponent(id)}`, o),
  create: (document: Scenario, o: Opts = {}) => sendJson<ScenarioRecord>("/scenarios", { document }, o),
  update: (id: string, expectedVersion: number, document: Scenario, o: Opts = {}) =>
    request(`/scenarios/${encodeURIComponent(id)}`, { method: "PUT", body: { expected_version: expectedVersion, document }, ...o }).then((r) => r.json() as Promise<ScenarioRecord>),
  remove: (id: string, o: Opts = {}) => request(`/scenarios/${encodeURIComponent(id)}`, { method: "DELETE", ...o }).then(() => undefined),
  revisions: (id: string, o: Opts = {}) => getJson<RevisionInfo[]>(`/scenarios/${encodeURIComponent(id)}/revisions`, o),
  revision: (id: string, version: number, o: Opts = {}) => getJson<ScenarioRecord>(`/scenarios/${encodeURIComponent(id)}/revisions/${version}`, o),
};
