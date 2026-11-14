import { stripBidi, stripBidiDeep } from "../agent/bidi";
import { apiUrl, getJson, getText, sendJson } from "./client";
import type {
  ArtifactRecord,
  LedgerResult,
  EvidenceDoc,
  Instructions,
  LedgerEntry,
  LedgerList,
  RunSummary,
} from "./types";

type Opts = { signal?: AbortSignal };

export const agentApi = {
  async listRuns(o: Opts = {}): Promise<RunSummary[]> {
    return stripBidiDeep(await getJson<RunSummary[]>("/agent/runs", o));
  },
  getRun: async (id: string, o: Opts = {}) => stripBidiDeep(await getJson<RunSummary>(`/agent/runs/${encodeURIComponent(id)}`, o)),
  createRun: async (prompt: string, model?: string, budgetUsd?: number, o: Opts = {}) =>
    stripBidiDeep(await sendJson<RunSummary>("/agent/runs", { prompt, ...(model ? { model } : {}), ...(budgetUsd !== undefined ? { budget_usd: budgetUsd } : {}) }, o)),
  sendMessage: (id: string, prompt: string, o: Opts = {}) =>
    sendJson<unknown>(`/agent/runs/${encodeURIComponent(id)}/messages`, { prompt }, o),
  interrupt: (id: string, o: Opts = {}) => sendJson<unknown>(`/agent/runs/${encodeURIComponent(id)}/interrupt`, {}, o),
  async ledger(id: string, o: Opts = {}): Promise<LedgerList<LedgerEntry>> {
    return stripBidiDeep(await getJson<LedgerList<LedgerEntry>>(`/agent/runs/${encodeURIComponent(id)}/ledger`, o));
  },
  ledgerResult: async (runId: string, ledgerId: string, rowId?: string | null, o: Opts = {}) =>
    stripBidiDeep(await getJson<LedgerResult>(`/agent/runs/${encodeURIComponent(runId)}/ledger/${encodeURIComponent(ledgerId)}/result`, { query: rowId ? { row_id: rowId } : undefined, ...o })),
  async artifacts(id: string, o: Opts = {}): Promise<LedgerList<ArtifactRecord>> {
    return stripBidiDeep(await getJson<LedgerList<ArtifactRecord>>(`/agent/runs/${encodeURIComponent(id)}/artifacts`, o));
  },
  artifactUrl: (runId: string, artifactId: string, version?: number) =>
    apiUrl(`/agent/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}/content`, { version }),
  artifactText: async (runId: string, artifactId: string, version?: number, o: Opts = {}) =>
    stripBidi(await getText(`/agent/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}/content`, { query: { version }, ...o })),
  instructions: async (o: Opts = {}) => stripBidiDeep(await getJson<Instructions>("/agent/instructions", o)),
  eventSchema: (o: Opts = {}) => getJson<Record<string, unknown>>("/agent/event-schema", o),
  eventsPath: (id: string) => `/agent/runs/${encodeURIComponent(id)}/events`,
};

export const evidenceApi = {
  list: (o: Opts = {}) => getJson<EvidenceDoc[]>("/evidence", o),
  doc: (docId: string, o: Opts = {}) => getText(`/evidence/${docId.split("/").map(encodeURIComponent).join("/")}`, o),
  assetUrl: (path: string) => apiUrl(`/evidence/assets/${path.split("/").map(encodeURIComponent).join("/")}`),
};

export const metaApi = {
  get: (o: Opts = {}) => getJson<unknown>("/meta", o),
};
