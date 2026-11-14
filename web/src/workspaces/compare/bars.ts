import { formatSignedValue } from "../../lib/format";
import type { ServiceConstraintVerdict } from "../../api/planning";
import { clamp } from "../../lib/scale";
import { CONSTRAINT_KEYS } from "../../scenario/types";
import { constraintLine } from "../calendar/format";
import { CELL_MARK } from "./grid";

export type MarginCell =
  | { kind: "unset" }
  | { kind: "unknown"; censored: boolean }
  | { kind: "heading"; c: ServiceConstraintVerdict }
  | { kind: "none"; c: ServiceConstraintVerdict }
  | { kind: "bar"; c: ServiceConstraintVerdict; nominal: number; worst: number | null; best: number | null };

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function marginCell(c: ServiceConstraintVerdict | undefined): MarginCell {
  if (!c) return { kind: "unset" };
  if (c.state === "unknown") return { kind: "unknown", censored: c.censored };
  if (c.heading_dependent) return { kind: "heading", c };
  if (!finite(c.margin)) return { kind: "none", c };
  const worlds = Object.values(c.margin_worlds ?? {}).filter(finite);
  return { kind: "bar", c, nominal: c.margin, worst: finite(c.margin_worst) ? c.margin_worst : null, best: worlds.length > 0 ? Math.max(...worlds) : null };
}

export function columnScale(cells: readonly MarginCell[]): number {
  let m = 0;
  for (const c of cells)
    if (c.kind === "bar") m = Math.max(m, Math.abs(c.nominal), Math.abs(c.worst ?? 0), Math.abs(c.best ?? 0));
  return m;
}

interface BarGeometry {
  left: number;
  width: number;
  whisker: { left: number; width: number } | null;
  side: "inside" | "outside" | "on";
}

export function barGeometry(cell: Extract<MarginCell, { kind: "bar" }>, scale: number): BarGeometry {
  const at = (v: number) => (scale > 0 ? clamp(50 + (50 * v) / scale, 0, 100) : 50);
  const n = at(cell.nominal);
  const lo = cell.worst === null || cell.best === null ? null : at(Math.min(cell.worst, cell.best));
  const hi = cell.worst === null || cell.best === null ? null : at(Math.max(cell.worst, cell.best));
  return {
    left: Math.min(50, n),
    width: Math.abs(n - 50),
    whisker: lo === null || hi === null ? null : { left: lo, width: hi - lo },
    side: cell.nominal > 0 ? "inside" : cell.nominal < 0 ? "outside" : "on",
  };
}

interface ConstraintColumn {
  key: string;
  label: string;
  unit: string;
}

export function constraintColumns(rows: ReadonlyArray<readonly ServiceConstraintVerdict[]>): ConstraintColumn[] {
  const seen = new Map<string, ConstraintColumn>();
  for (const cs of rows) for (const c of cs) if (!seen.has(c.key)) seen.set(c.key, { key: c.key, label: c.label, unit: c.unit });
  const known = CONSTRAINT_KEYS.filter((k) => seen.has(k));
  const rest = [...seen.keys()].filter((k) => !(CONSTRAINT_KEYS as readonly string[]).includes(k));
  return [...known, ...rest].map((k) => seen.get(k)!);
}

export type SortDir = "asc" | "desc";

export function sortByMargin<T>(rows: readonly T[], nominal: (row: T) => number | null, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, m: nominal(row) }))
    .sort((a, b) => (a.m === null && b.m === null ? a.i - b.i : a.m === null ? 1 : b.m === null ? -1 : sign * (a.m - b.m) || a.i - b.i))
    .map((x) => x.row);
}

export function barName(c: ServiceConstraintVerdict, worst: number | null, best: number | null): string {
  const line = constraintLine(c);
  const parts = [`${c.label}: ${CELL_MARK[c.state].word}`, line.nominal];
  if (worst !== null) parts.push(`worst-case margin ${formatSignedValue(worst, c.unit)}`);
  if (best !== null) parts.push(`best-case margin ${formatSignedValue(best, c.unit)}`);
  if (line.limit) parts.push(line.limit);
  return parts.join("; ");
}
