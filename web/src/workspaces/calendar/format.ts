import type { ServiceConstraintVerdict } from "../../api/planning";
import { formatNum, withUnit } from "../../lib/format";

export function headingFacts(c: Pick<ServiceConstraintVerdict, "unit" | "heading_best" | "heading_worst" | "heading_basis">): { line: string; basis: string | null } | null {
  const best = c.heading_best ?? null;
  const worst = c.heading_worst ?? null;
  if (!best && !worst) return null;
  const deg = (d: number) => `${formatNum(d, Number.isInteger(d) ? 0 : 1)}°`;
  const value = (v: number) => (c.unit === "fraction" ? `${formatNum(100 * v, 2)} %` : withUnit(formatNum(v, 2), c.unit));
  const parts: string[] = [];
  if (best) parts.push(`Best single heading ${deg(best.yaw_deg)}: ${value(best.value)}`);
  if (worst) {
    const arcs = worst.arcs_deg.map(([a, b]) => `${deg(a!)} to ${deg(b!)}`).join(", ");
    parts.push(`${best ? "worst" : "Worst single heading"} ${deg(worst.yaw_deg)}${arcs ? ` (${worst.arcs_deg.length > 1 ? "arcs" : "arc"} ${arcs})` : ""}: ${value(worst.value)}`);
  }
  const horizons = [...new Set([best?.horizon, worst?.horizon].filter((h): h is "nominal" => !!h))];
  if (horizons.length > 0) parts.push(`${horizons.join(", ")} horizon`);
  return { line: parts.join(" · "), basis: c.heading_basis ? c.heading_basis : null };
}
