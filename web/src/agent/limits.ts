import type { LimitNoteJson } from "../api/site";

type Raw = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

interface ReportLimit {
  note: LimitNoteJson;
  citedBy: string[];
}

export interface PlainLimit {
  id: string;
  title: string;
  text: string;
  source: string;
  citedBy: string[];
}

export interface AttachedLimits {
  report: ReportLimit[];
  conduct: PlainLimit[];
}

const plain = (r: Raw): PlainLimit => ({ id: str(r["id"]), title: str(r["title"]), text: str(r["text"]), source: str(r["source"]), citedBy: ids(r["cited_by"]) });

function reportNote(r: Raw): LimitNoteJson | null {
  const kind = str(r["kind"]);
  if (kind === "") return null;
  const params = r["parameters"];
  return {
    id: str(r["id"]),
    title: str(r["title"]),
    kind: kind as LimitNoteJson["kind"],
    category: str(r["category"]),
    text: str(r["text"]),
    parameters: params && typeof params === "object" && !Array.isArray(params) ? (params as Record<string, unknown>) : {},
    source: str(r["source"]),
    quote: str(r["quote"]),
    more: ids(r["more"]),
  };
}

export const NO_LIMITS: AttachedLimits = { report: [], conduct: [] };

export function classifyLimits(entries: readonly object[]): AttachedLimits {
  const out: AttachedLimits = { report: [], conduct: [] };
  for (const e of entries) {
    const r = e as Raw;
    if (typeof r["id"] !== "string") continue;
    const note = reportNote(r);
    if (note) out.report.push({ note, citedBy: ids(r["cited_by"]) });
    else out.conduct.push(plain(r));
  }
  return out;
}
