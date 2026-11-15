import type { RegionalResult } from "../../api/regional";
import { CENSOR_BIT } from "../../api/regional";
import { viridis } from "../../lib/colormaps";
import type { Hemisphere } from "../../lib/projection";

type CellVerdict = "pass" | "marginal" | "fail";

const NEAR_TERRAIN_BOUNDARY_BIT = 8;
const BRACKET_ONLY = "bracket_only";
const RANGE_ONLY: Record<string, boolean> = { longest_shadow_h: true, longest_earth_outage_h: true };

const VERDICT_CODE: Record<number, CellVerdict> = { 1: "pass", 0: "marginal", [-1]: "fail" };

interface RegionalGrid {
  hemisphere: Hemisphere;
  x0_m: number;
  y0_m: number;
  spacing_m: number;
  n_rows: number;
  n_cols: number;
}

interface RegionalCell {
  row: number;
  col: number;
  t: number | null;
  verdict: CellVerdict | null;
  censored: boolean;
  unreliable: boolean;
}

interface SequentialLegend {
  kind: "sequential";
  min: number;
  max: number;
}

interface VerdictLegend {
  kind: "verdict";
  entries: Array<{ verdict: CellVerdict; token: string }>;
}

type RegionalLegend = SequentialLegend | VerdictLegend;

export interface RegionalLayerView {
  grid: RegionalGrid;
  cells: RegionalCell[];
  legend: RegionalLegend;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const rec = (v: unknown): object | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? v : null);

function parseGrid(spec: RegionalResult["spec"]): RegionalGrid | null {
  const x0 = num(spec["x0_m"]);
  const y0 = num(spec["y0_m"]);
  const spacing = num(spec["spacing_m"]);
  const rows = num(spec["n_rows"]);
  const cols = num(spec["n_cols"]);
  const pole = spec["pole"];
  if (x0 === null || y0 === null || spacing === null || rows === null || cols === null || (pole !== -1 && pole !== 1)) return null;
  return { hemisphere: pole === -1 ? "south" : "north", x0_m: x0, y0_m: y0, spacing_m: spacing, n_rows: rows, n_cols: cols };
}

const VERDICT_LEGEND: VerdictLegend = {
  kind: "verdict",
  entries: [
    { verdict: "pass", token: "c-pass" },
    { verdict: "marginal", token: "c-marginal" },
    { verdict: "fail", token: "c-fail" },
  ],
};

export function pointValueAllowed(result: RegionalResult, metric: string): boolean {
  const table = rec(result.header["layer_support"]);
  const r = table ? rec(Reflect.get(table, metric)) : null;
  const pv: unknown = r ? Reflect.get(r, "point_value") : null;
  return typeof pv === "string" && pv !== "" ? pv !== BRACKET_ONLY : !RANGE_ONLY[metric];
}

export function regionalLayer(result: RegionalResult, layer: string): RegionalLayerView | null {
  const grid = parseGrid(result.spec);
  const data = result.inline[layer];
  if (!grid || !data) return null;
  const isVerdict = layer === "verdict";
  const info = result.layers.find((l) => l.name === layer);
  const range = info && info.min !== null && info.max !== null ? [info.min, info.max] : null;
  const span = range ? range[1]! - range[0]! : 0;
  const metric = layer.replace(/_(lo|hi)$/, "");
  const bit = (CENSOR_BIT[metric] ?? 0) * (metric === layer ? 1 : 16);
  const flags = result.inline["censoring_flags"];
  const cells: RegionalCell[] = [];
  for (let row = 0; row < data.length && row < grid.n_rows; row++) {
    const line = data[row]!;
    for (let col = 0; col < line.length && col < grid.n_cols; col++) {
      const v = line[col];
      const flagsAt = flags?.[row]?.[col] ?? 0;
      const unreliable = (flagsAt & NEAR_TERRAIN_BOUNDARY_BIT) !== 0;
      if (v === null || v === undefined || !Number.isFinite(v)) continue;
      const verdict = isVerdict ? (VERDICT_CODE[v] ?? null) : null;
      if (isVerdict && verdict === null && !unreliable) continue;
      cells.push({
        row,
        col,
        t: isVerdict || unreliable || !range ? null : span > 0 ? (v - range[0]!) / span : 0.5,
        verdict,
        censored: (flagsAt & bit) !== 0,
        unreliable,
      });
    }
  }
  const legend: RegionalLegend = isVerdict ? VERDICT_LEGEND : { kind: "sequential", min: range ? range[0]! : NaN, max: range ? range[1]! : NaN };
  return { grid, cells, legend };
}

export function cellColour(cell: RegionalCell, legend: RegionalLegend, token: (name: string) => string): string | null {
  if (cell.unreliable) return token("c-dark");
  if (legend.kind === "verdict") {
    const e = legend.entries.find((x) => x.verdict === cell.verdict);
    return e ? token(e.token) : null;
  }
  return cell.t === null ? null : viridis(cell.t);
}
