import { distinctKinds, kindMarginName, type ServedMarginKind } from "../../lib/marginKind";
import type { ScanWindow, ServiceConstraintVerdict, SlipRow } from "../../api/planning";
import { formatBounds, formatNum, formatSigned, formatSignedValue, formatValue, withUnit } from "../../lib/format";
import { MS_MIN } from "../../lib/time";

export function rowDecimals(values: ReadonlyArray<number | null | undefined>): number {
  const a = Math.max(0, ...values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).map(Math.abs));
  return a >= 100 ? 1 : a >= 1 ? 2 : 3;
}

interface ConstraintLine {
  key: string;
  label: string;
  state: ServiceConstraintVerdict["state"];
  value: string;
  limit: string;
  nominal: string;
  worst: string;
  headingDependent: boolean;
}

export function constraintLine(c: ServiceConstraintVerdict, decimals = 2): ConstraintLine {
  const limit = formatBounds(c.limit_min, c.limit_max, c.unit, decimals);
  return {
    key: c.key,
    label: c.label,
    state: c.state,
    value: c.value === null ? "—" : withUnit(formatNum(c.value, decimals), c.unit),
    limit: limit ? `required ${limit}` : "",
    nominal: `nominal margin ${formatSignedValue(c.margin, c.unit, decimals)}`,
    worst: `worst-case margin ${formatSignedValue(c.margin_worst, c.unit, decimals)}`,
    headingDependent: c.heading_dependent,
  };
}

interface HeadingCell {
  limit: string;
  worst: string | null;
  note: string | null;
}

export function headingCell(c: ServiceConstraintVerdict, decimals = 2): HeadingCell {
  const limit = formatBounds(c.limit_min, c.limit_max, c.unit, decimals);
  return {
    limit: limit ? `required ${limit}` : "",
    worst: c.margin_worst === null || c.margin_worst === undefined ? null : `worst-case margin ${formatSignedValue(c.margin_worst, c.unit, decimals)}`,
    note: c.heading_note ? c.heading_note : null,
  };
}

export function headingFacts(c: Pick<ServiceConstraintVerdict, "unit" | "heading_best" | "heading_worst" | "heading_basis">): { line: string; basis: string | null } | null {
  const best = c.heading_best ?? null;
  const worst = c.heading_worst ?? null;
  if (!best && !worst) return null;
  const deg = (d: number) => `${formatNum(d, Number.isInteger(d) ? 0 : 1)}°`;
  const value = (v: number) => (c.unit === "fraction" ? `${formatNum(100 * v, 2)}\u00a0%` : withUnit(formatNum(v, 2), c.unit));
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

export function limitingRow(r: SlipRow): ServiceConstraintVerdict | undefined {
  return r.verdict?.constraints.find((c) => c.key === r.limiting);
}

export interface MarginCell {
  text: string;
  title: string;
}

const scaleTitle = (kind: string, normalised: number | null | undefined) =>
  normalised === null || normalised === undefined
    ? `${kind} of the limiting requirement, in its own unit.`
    : `${kind} of the limiting requirement, in its own unit (normalised: ${formatSigned(normalised, 2)} × its margin scale).`;

export function fractionText(f: number | null | undefined): string {
  if (f === null || f === undefined || !Number.isFinite(f)) return "n/a";
  const p = 100 * f;
  return `${p.toFixed(f === 0 || f === 1 ? 0 : 1)}%`;
}

export function slipMargins(r: SlipRow): { nominal: MarginCell; worst: MarginCell; headingUnknown: MarginCell | null } {
  const c = limitingRow(r);
  return {
    headingUnknown:
      r.margin_kind === "best_case" && r.margin !== null
        ? { text: formatSignedValue(r.margin, "× margin scale"), title: `Margin (heading unknown) of the limiting requirement, normalised by its margin scale.${r.margin_note ? ` ${r.margin_note}` : ""}` }
        : null,
    nominal: { text: formatSignedValue(c?.margin, c?.unit), title: scaleTitle("Nominal margin", r.margin_kind === "nominal" ? r.margin : null) },
    worst: { text: formatSignedValue(c?.margin_worst, c?.unit), title: scaleTitle("Worst-case margin", r.margin_kind === "worst_case" ? r.margin : null) },
  };
}

export function windowMargin(w: ScanWindow): MarginCell {
  return {
    text: formatSignedValue(w.best_margin_physical, w.best_margin_unit),
    title: `${scaleTitle(`${kindMarginName(w.best_margin_kind)} at the best landing`, w.best_margin)}${w.best_margin_note ? ` ${w.best_margin_note}` : ""}`,
  };
}

export function windowLength(w: ScanWindow): { span: string; detail: string } {
  return {
    span: formatValue(w.duration_h, "h", 1),
    detail: `${w.n_candidates} candidate${w.n_candidates === 1 ? "" : "s"} every ${formatValue(w.spacing_h, "h", w.spacing_h % 1 ? 1 : 0)}`,
  };
}

export function offsetText(candidateMs: number, selectedMs: number): string {
  const dMin = Math.round(Math.abs(candidateMs - selectedMs) / MS_MIN);
  const h = Math.floor(dMin / 60);
  const m = dMin % 60;
  const amount = h > 0 ? `${withUnit(String(h), "h")} ${withUnit(String(m).padStart(2, "0"), "m")}` : withUnit(String(m), "m");
  return `${amount} ${candidateMs < selectedMs ? "before" : "after"}`;
}

export interface SlipPoint {
  row: SlipRow;
  y: number;
  kind: ServedMarginKind | null;
}

export function slipChartPoints(rows: readonly SlipRow[]): { unit: string | null; points: SlipPoint[]; kinds: ServedMarginKind[] } {
  const withMargin = rows.filter((r) => r.margin !== null);
  const physical = withMargin.map((r) => limitingRow(r));
  const unit = physical[0]?.unit ?? null;
  const sameUnit = unit !== null && unit !== "" && physical.every((c) => c !== undefined && c.unit === unit && c.margin_worst !== null);
  const points = withMargin.map((row, i): SlipPoint => (sameUnit ? { row, y: physical[i]!.margin_worst!, kind: "worst_case" } : { row, y: row.margin!, kind: row.margin_kind }));
  return { unit: sameUnit ? unit : null, kinds: distinctKinds(points.map((p) => p.kind)), points };
}
