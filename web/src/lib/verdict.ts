import type { Verdict } from "../contract/types";

export const VERDICT_LABEL: Record<Verdict, string> = { pass: "Pass", marginal: "Marginal", fail: "Fail" };

export function marginOf(value: number, limit: number, sense: "min" | "max"): number {
  return sense === "min" ? value - limit : limit - value;
}

export function classify(best: boolean, pessimistic: boolean): Verdict {
  if (!best) return "fail";
  return pessimistic ? "pass" : "marginal";
}
