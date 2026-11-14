import type { components } from "./generated/schema";
import { formatSig, withUnit } from "../lib/format";
import { getJson } from "./client";

export type RegionalValidationRecord = components["schemas"]["RegionalValidationRecord"];
export type RegionalLayerValidation = components["schemas"]["RegionalLayerValidation"];

export const getRegionalValidation = (): Promise<RegionalValidationRecord> => getJson<RegionalValidationRecord>("/meta/regional-validation");

export function recordDocId(document: string): string | null {
  const m = /docs\/(validation\/[A-Za-z0-9_-]+)\.md/.exec(document);
  return m ? m[1]! : null;
}

const num = (o: Record<string, unknown>, k: string): number | null => (typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : null);

export function measuredError(l: RegionalLayerValidation): { mean_signed: number | null; mean_abs: number | null; p95_abs: number | null; p99_abs: number | null; max_abs: number | null } {
  const e = l.measured_error;
  return { mean_signed: num(e, "mean_signed"), mean_abs: num(e, "mean_abs"), p95_abs: num(e, "p95_abs"), p99_abs: num(e, "p99_abs"), max_abs: num(e, "max_abs") };
}

export function signedError(x: number | null, unit: string): string {
  if (x === null) return "–";
  return withUnit(x === 0 ? "0" : `${x < 0 ? "−" : "+"}${formatSig(Math.abs(x), 3)}`, unit);
}

export const READING: Record<RegionalLayerValidation["point_value"], string> = {
  supported: "value supported within its measured error",
  approximate: "approximate: read the range beside the value",
  bracket_only: "range only: never one value",
};

export function configurationPairs(c: Record<string, unknown>): string[] {
  return Object.entries(c).map(([k, v]) => {
    const text = Array.isArray(v) ? (v.length > 5 ? `${v.length} entries` : v.join(", ")) : typeof v === "object" && v !== null ? JSON.stringify(v) : typeof v === "string" && /^[0-9a-f]{64}$/.test(v) ? `${v.slice(0, 12)}…` : String(v);
    return `${k.replace(/_/g, " ")} ${text}`;
  });
}
