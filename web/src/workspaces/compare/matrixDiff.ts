import type { CompareMetric, CompareResult, ServiceConstraintVerdict } from "../../api/planning";
import { formatNum } from "../../lib/format";
import { whenLines } from "../../lib/when";
import { constraintLine, headingCell, headingFacts, rowDecimals } from "../calendar/format";

function constraintSignature(c: ServiceConstraintVerdict | undefined): string {
  if (!c) return "not set";
  if (c.state === "unknown") return `unknown|${c.censored}`;
  const line = constraintLine(c);
  if (line.headingDependent) return JSON.stringify([c.state, "heading", headingCell(c), headingFacts(c)]);
  return JSON.stringify([c.state, line.value, line.limit, line.nominal, line.worst]);
}

function metricSignature(m: CompareMetric, i: number): string {
  const d = rowDecimals(m.values);
  const n = (v: number | null | undefined) => (v === null || v === undefined ? "—" : formatNum(v, d));
  const when = whenLines(m.when?.[i], (v) => formatNum(v, d)).map((l) => l.text);
  return JSON.stringify([n(m.values[i]), n(m.low[i]), n(m.high[i]), when]);
}

const allSame = (xs: readonly string[]) => xs.every((x) => x === xs[0]);

export function differingConstraints(scenarios: CompareResult["scenarios"]): Set<string> {
  const keys = new Set(scenarios.flatMap((s) => s.verdict.constraints.map((c) => c.key)));
  return new Set([...keys].filter((k) => !allSame(scenarios.map((s) => constraintSignature(s.verdict.constraints.find((c) => c.key === k))))));
}

export function differingMetrics(result: CompareResult): Set<string> {
  return new Set(result.metrics.filter((m) => !allSame(result.scenarios.map((_, i) => metricSignature(m, i)))).map((m) => m.key));
}

export function matrixHeadingDependent(result: CompareResult): boolean {
  return result.scenarios.some((s) => s.verdict.constraints.some((c) => c.heading_dependent && c.state !== "unknown"));
}
