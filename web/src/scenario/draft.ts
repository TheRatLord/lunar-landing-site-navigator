import { formatProblems, normalizeScenario } from "./normalize";
import type { Scenario } from "./types";

export interface SavedRef {
  id: string;
  version: number;
  updated_utc: string;
}

export interface Draft {
  doc: Scenario;
  saved: SavedRef | null;
  baseline: string | null;
  tab?: string;
}

export interface DraftProblem {
  summary: string;
  details: string[];
}

export type DraftRead =
  | { kind: "none" }
  | { kind: "ok"; draft: Draft; unknownFields: string[] }
  | { kind: "bad"; problem: DraftProblem };

function isSavedRef(v: unknown): v is SavedRef {
  return !!v && typeof v === "object" && "id" in v && typeof v.id === "string" && "version" in v && typeof v.version === "number" && "updated_utc" in v && typeof v.updated_utc === "string";
}

export function readDraftText(raw: string | null): DraftRead {
  if (raw === null || raw === "") return { kind: "none" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { kind: "bad", problem: { summary: "", details: [e instanceof Error ? e.message : String(e)] } };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { kind: "bad", problem: { summary: "The stored draft is not a draft record.", details: ["expected an object with a “doc” field"] } };
  }
  const rec = parsed as Record<string, unknown>;
  if (!("doc" in rec) || rec["doc"] === null || rec["doc"] === undefined) {
    return { kind: "bad", problem: { summary: "The stored draft holds no plan.", details: ["doc: missing (required)"] } };
  }
  const n = normalizeScenario(rec["doc"]);
  if (!n.scenario) return { kind: "bad", problem: { summary: "The stored draft is not a valid plan.", details: formatProblems(n.problems) } };
  const saved = isSavedRef(rec["saved"]) ? rec["saved"] : null;
  return {
    kind: "ok",
    unknownFields: n.unknownFields,
    draft: {
      doc: n.scenario,
      saved,
      baseline: typeof rec["baseline"] === "string" ? rec["baseline"] : null,
      ...(typeof rec["tab"] === "string" ? { tab: rec["tab"] } : {}),
    },
  };
}
