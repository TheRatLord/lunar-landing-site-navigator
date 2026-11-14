import type { RegionalResult } from "../../api/regional";
import { BOUND_SUFFIX, CENSOR_BIT, METRIC_BY_KEY, type BoundKind } from "../../api/regional";
import { viridis } from "../../lib/colormaps";
import { formatSig, withUnit } from "../../lib/format";
import { polarInverse, type Hemisphere } from "../../lib/projection";
import type { Pair } from "../../components/ui/Pairs";

export const pairs = (...rows: Array<Pair | false | null | undefined | "">): Pair[] => rows.filter((r): r is Pair => !!r);

type CellVerdict = "pass" | "marginal" | "fail";

const NEAR_TERRAIN_BOUNDARY_BIT = 8;
export const NEAR_BOUNDARY_TEXT = "near a boundary between terrain products: not reliable";

const VERDICT_CODE: Record<number, CellVerdict> = { 1: "pass", 0: "marginal", [-1]: "fail" };

interface RegionalGrid {
  hemisphere: Hemisphere;
  x0_m: number;
  y0_m: number;
  spacing_m: number;
  n_rows: number;
  n_cols: number;
}

export interface RegionalCell {
  row: number;
  col: number;
  lat_deg: number;
  lon_deg: number;
  value: number;
  t: number | null;
  verdict: CellVerdict | null;
  censored: boolean;
  unreliable: boolean;
  point: number | null;
  lo: number | null;
  hi: number | null;
}

interface SequentialLegend {
  kind: "sequential";
  layer: string;
  min: number;
  max: number;
  unit: string | null;
  own: [number, number] | null;
  horizon: "raised" | "lowered" | null;
}

interface VerdictLegend {
  kind: "verdict";
  layer: "verdict";
  entries: Array<{ verdict: CellVerdict; code: number; label: string; token: string }>;
}

export type RegionalLegend = SequentialLegend | VerdictLegend;

export interface RegionalLayerView {
  grid: RegionalGrid;
  layer: string;
  cells: RegionalCell[];
  legend: RegionalLegend;
  nodata: number;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

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

export function layerName(metric: string, bound: BoundKind): string {
  return METRIC_BY_KEY[metric]?.exact ? metric : `${metric}${BOUND_SUFFIX[bound]}`;
}

export function metricDomain(result: RegionalResult, metric: string): [number, number] | null {
  const names = [layerName(metric, "value"), layerName(metric, "lo"), layerName(metric, "hi")];
  let lo = Infinity;
  let hi = -Infinity;
  for (const info of result.layers) {
    if (!names.includes(info.name) || info.min === null || info.max === null) continue;
    lo = Math.min(lo, info.min);
    hi = Math.max(hi, info.max);
  }
  return lo <= hi ? [lo, hi] : null;
}

const VERDICT_LEGEND: VerdictLegend = {
  kind: "verdict",
  layer: "verdict",
  entries: [
    { verdict: "pass", code: 1, label: "Pass on the pessimistic end of the bracket", token: "c-pass" },
    { verdict: "marginal", code: 0, label: "Marginal: inside the bracket", token: "c-marginal" },
    { verdict: "fail", code: -1, label: "Fail on the optimistic end of the bracket", token: "c-fail" },
  ],
};

export function regionalLayer(result: RegionalResult, layer: string, domain?: [number, number] | null): RegionalLayerView | null {
  const grid = parseGrid(result.spec);
  const data = result.inline[layer];
  if (!grid || !data) return null;
  const isVerdict = layer === "verdict";
  const info = result.layers.find((l) => l.name === layer);
  const range = domain ?? (info && info.min !== null && info.max !== null ? [info.min, info.max] : null);
  const span = range ? range[1] - range[0] : 0;
  const metric = layer.replace(/_(lo|hi)$/, "");
  const bit = (CENSOR_BIT[metric] ?? 0) * (metric === layer ? 1 : 16);
  const flags = result.inline["censoring_flags"];
  const point = result.inline[metric];
  const lower = result.inline[`${metric}_lo`];
  const upper = result.inline[`${metric}_hi`];
  const cells: RegionalCell[] = [];
  let nodata = 0;
  for (let row = 0; row < data.length && row < grid.n_rows; row++) {
    const line = data[row]!;
    for (let col = 0; col < line.length && col < grid.n_cols; col++) {
      const v = line[col];
      const flagsAt = flags?.[row]?.[col] ?? 0;
      const unreliable = (flagsAt & NEAR_TERRAIN_BOUNDARY_BIT) !== 0;
      if (v === null || v === undefined || !Number.isFinite(v)) {
        nodata++;
        continue;
      }
      const verdict = isVerdict ? (VERDICT_CODE[v] ?? null) : null;
      if (isVerdict && verdict === null && !unreliable) {
        nodata++;
        continue;
      }
      const { lat_deg, lon_deg } = polarInverse(grid.hemisphere, grid.x0_m + col * grid.spacing_m, grid.y0_m - row * grid.spacing_m);
      cells.push({
        row,
        col,
        lat_deg,
        lon_deg,
        value: v,
        t: isVerdict || unreliable || !range ? null : span > 0 ? (v - range[0]) / span : 0.5,
        verdict,
        censored: (flagsAt & bit) !== 0,
        unreliable,
        point: isVerdict ? null : num(point?.[row]?.[col]),
        lo: isVerdict ? null : num(lower?.[row]?.[col]),
        hi: isVerdict ? null : num(upper?.[row]?.[col]),
      });
    }
  }
  const legend: RegionalLegend = isVerdict
    ? VERDICT_LEGEND
    : {
        kind: "sequential",
        layer,
        horizon: layerSupport(result, layer)?.horizon_shift ?? null,
        min: range ? range[0] : NaN,
        max: range ? range[1] : NaN,
        unit: layerSupport(result, metric)?.unit ?? null,
        own: info && info.min !== null && info.max !== null ? [info.min, info.max] : null,
      };
  return { grid, layer, cells, legend, nodata };
}

export function cellColour(cell: RegionalCell, legend: RegionalLegend, token: (name: string) => string): string | null {
  if (cell.unreliable) return token("c-dark");
  if (legend.kind === "verdict") {
    const e = legend.entries.find((x) => x.verdict === cell.verdict);
    return e ? token(e.token) : null;
  }
  return cell.t === null ? null : viridis(cell.t);
}

export interface ErrorStats {
  mean_signed: number | null;
  mean_abs: number;
  p95_abs: number | null;
  p99_abs: number | null;
  max_abs: number;
  n_cells: number | null;
}

interface BracketCoverage {
  coverage: number;
  misses: number;
  cells: number;
  calibration_target: number | null;
}

interface ValidationRecord {
  configuration: string | null;
  applies_to_run: boolean | null;
  bracket_coverage: BracketCoverage | null;
  measured_error: ErrorStats | null;
  measured_by: string | null;
}

const BRACKET_ONLY = "bracket_only";

export interface LayerSupport {
  point_value: string;
  bracket_layers: string[];
  unit: string | null;
  error_unit: string | null;
  run_error: ErrorStats | null;
  run_measured_on: string | null;
  validation: ValidationRecord | null;
  note: string | null;
  bracket_low_horizon?: "raised" | "lowered" | null;
  bracket_high_horizon?: "raised" | "lowered" | null;
  horizon_shift?: "raised" | "lowered" | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const rec = (v: unknown): object | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? v : null);

function errorStats(v: unknown): ErrorStats | null {
  const o = rec(v);
  if (!o) return null;
  const mean = num(Reflect.get(o, "mean_abs"));
  const max = num(Reflect.get(o, "max_abs"));
  if (mean === null || max === null) return null;
  return {
    mean_signed: num(Reflect.get(o, "mean_signed")),
    mean_abs: mean,
    p95_abs: num(Reflect.get(o, "p95_abs")),
    p99_abs: num(Reflect.get(o, "p99_abs")),
    max_abs: max,
    n_cells: num(Reflect.get(o, "n_cells")),
  };
}

function bracketCoverage(v: unknown): BracketCoverage | null {
  const o = rec(v);
  if (!o) return null;
  const coverage = num(Reflect.get(o, "coverage"));
  const misses = num(Reflect.get(o, "misses"));
  const cells = num(Reflect.get(o, "cells"));
  return coverage === null || misses === null || cells === null ? null : { coverage, misses, cells, calibration_target: num(Reflect.get(o, "calibration_target")) };
}

const RANGE_ONLY: Record<string, boolean> = { longest_shadow_h: true, longest_earth_outage_h: true };

export function layerSupport(result: RegionalResult, metric: string): LayerSupport | null {
  const table = result.header["layer_support"];
  const r = rec(table) ? rec(Reflect.get(table as object, metric)) : null;
  const pointValue = r ? str(Reflect.get(r, "point_value")) : null;
  if (!r || pointValue === null) {
    return RANGE_ONLY[metric]
      ? {
          point_value: BRACKET_ONLY,
          bracket_layers: [`${metric}_lo`, `${metric}_hi`],
          unit: null,
          error_unit: null,
          run_error: null,
          run_measured_on: null,
          validation: null,
          bracket_low_horizon: null,
          bracket_high_horizon: null,
          horizon_shift: null,
          note: "This result carried no support record from the engine. This run length is shown only as a range [bracket low, bracket high], as the engine does for it. Point values come from the site search (exact engine).",
        }
      : null;
  }
  const layers: unknown = Reflect.get(r, "bracket_layers");
  const v = rec(Reflect.get(r, "validation"));
  const validation: ValidationRecord | null = v
    ? {
        configuration: str(Reflect.get(v, "configuration")),
        applies_to_run: typeof Reflect.get(v, "applies_to_run") === "boolean" ? (Reflect.get(v, "applies_to_run") as boolean) : null,
        bracket_coverage: bracketCoverage(Reflect.get(v, "bracket_coverage")),
        measured_error: errorStats(Reflect.get(v, "measured_error")),
        measured_by: str(Reflect.get(v, "measured_by")),
      }
    : errorStats(Reflect.get(r, "measured_error")) || bracketCoverage(Reflect.get(r, "bracket_coverage"))
      ? {
          configuration: null,
          applies_to_run: null,
          bracket_coverage: bracketCoverage(Reflect.get(r, "bracket_coverage")),
          measured_error: errorStats(Reflect.get(r, "measured_error")),
          measured_by: str(Reflect.get(r, "measured_by")),
        }
      : null;
  return {
    point_value: pointValue,
    bracket_layers: Array.isArray(layers) ? layers.filter((b): b is string => typeof b === "string") : [],
    unit: str(Reflect.get(r, "unit")),
    error_unit: str(Reflect.get(r, "error_unit")) ?? (v ? null : str(Reflect.get(r, "unit"))),
    run_error: errorStats(Reflect.get(r, "run_measured_error")),
    run_measured_on: str(Reflect.get(r, "run_measured_on")),
    validation,
    note: str(Reflect.get(r, "note")),
    bracket_low_horizon: move(Reflect.get(r, "bracket_low_horizon")),
    bracket_high_horizon: move(Reflect.get(r, "bracket_high_horizon")),
    horizon_shift: move(Reflect.get(r, "horizon_shift")),
  };
}

export interface RegionalHeaderInfo {
  warnings: string[];
  bracketWidths: Record<string, { p50: number; p95: number; max: number | null; shareWider5: number | null; unit: string | null }>;
  coverage: { cells_with_terrain: number; cells_without_terrain: number } | null;
  cellsFlagged: number | null;
  flagRadius: { cells: number; m: number } | null;
  calibration: { n_cells: number; quantile: number | null; shift_lo_deg: number | null; shift_hi_deg: number | null } | null;
  run: {
    n_epochs: number | null;
    step_s: number | null;
    mast_height_m: number | null;
    sun_rule: string | null;
    earth_rule: string | null;
    n_az: number | null;
    engine: string | null;
    config_hash: string | null;
  } | null;
  timing: { wall_s: number; cells: number | null } | null;
  grid: { crs: string | null; registration: string | null } | null;
  provenance: { code: string | null; packageSourceSha256: string | null } | null;
}

export function regionalHeaderInfo(result: RegionalResult): RegionalHeaderInfo {
  const h = result.header;
  const w: unknown = Reflect.get(h, "warnings");
  const widthsRaw = rec(Reflect.get(h, "bracket_widths"));
  const widths: RegionalHeaderInfo["bracketWidths"] = {};
  if (widthsRaw)
    for (const [k, v] of Object.entries(widthsRaw)) {
      const o = rec(v);
      const p50 = num(o ? Reflect.get(o, "p50") : null);
      const p95 = num(o ? Reflect.get(o, "p95") : null);
      if (o && p50 !== null && p95 !== null)
        widths[k] = { p50, p95, max: num(Reflect.get(o, "max")), shareWider5: num(Reflect.get(o, "share_wider_than_5_points")), unit: str(Reflect.get(o, "unit")) };
    }
  const cov = rec(Reflect.get(h, "coverage"));
  const withT = cov ? num(Reflect.get(cov, "cells_with_terrain")) : null;
  const withoutT = cov ? num(Reflect.get(cov, "cells_without_terrain")) : null;
  const sc = rec(Reflect.get(h, "store_changes"));
  const rc = sc ? num(Reflect.get(sc, "radius_cells")) : null;
  const rm = sc ? num(Reflect.get(sc, "radius_m")) : null;
  const bc = rec(Reflect.get(h, "bracket_calibration"));
  const cal = bc ? rec(Reflect.get(bc, "calibration")) : null;
  const calN = cal ? num(Reflect.get(cal, "n_cells")) : null;
  const spec = rec(Reflect.get(h, "spec"));
  const method = rec(Reflect.get(h, "method"));
  const time = rec(Reflect.get(h, "time"));
  const timing = rec(Reflect.get(h, "timing"));
  const wall = timing ? num(Reflect.get(timing, "wall_s")) : null;
  const grid = rec(Reflect.get(h, "grid"));
  return {
    warnings: Array.isArray(w) ? w.filter((x): x is string => typeof x === "string" && x !== "") : [],
    bracketWidths: widths,
    coverage: withT !== null && withoutT !== null ? { cells_with_terrain: withT, cells_without_terrain: withoutT } : null,
    cellsFlagged: sc ? num(Reflect.get(sc, "cells_flagged")) : null,
    flagRadius: rc !== null && rm !== null ? { cells: rc, m: rm } : null,
    calibration:
      cal && calN !== null
        ? { n_cells: calN, quantile: num(Reflect.get(cal, "quantile")), shift_lo_deg: bc ? num(Reflect.get(bc, "shift_lo_deg")) : null, shift_hi_deg: bc ? num(Reflect.get(bc, "shift_hi_deg")) : null }
        : null,
    run:
      spec || method || time
        ? {
            n_epochs: time ? num(Reflect.get(time, "n_epochs")) : null,
            step_s: spec ? num(Reflect.get(spec, "step_s")) : null,
            mast_height_m: spec ? num(Reflect.get(spec, "mast_height_m")) : null,
            sun_rule: spec ? str(Reflect.get(spec, "sun_rule")) : null,
            earth_rule: spec ? str(Reflect.get(spec, "earth_rule")) : null,
            n_az: method ? num(Reflect.get(method, "n_az")) : null,
            engine: str(Reflect.get(h, "horizon_engine_reference")),
            config_hash: str(Reflect.get(h, "config_hash")),
          }
        : null,
    timing: wall !== null ? { wall_s: wall, cells: timing ? num(Reflect.get(timing, "cells")) : null } : null,
    provenance: ((pv) =>
      pv && (str(Reflect.get(pv, "code")) || str(Reflect.get(pv, "package_source_sha256")))
        ? { code: str(Reflect.get(pv, "code")), packageSourceSha256: str(Reflect.get(pv, "package_source_sha256")) }
        : null)(rec(result.provenance)),
    grid: grid ? { crs: str(Reflect.get(grid, "crs_proj4")), registration: str(Reflect.get(grid, "registration")) } : null,
  };
}

export type BracketWidth = RegionalHeaderInfo["bracketWidths"][string];

export function bracketWidth(info: RegionalHeaderInfo, metric: string): BracketWidth | null {
  return info.bracketWidths[metric] ?? info.bracketWidths[`${metric}_lo`] ?? info.bracketWidths[`${metric}_hi`] ?? null;
}

export function pointValueAllowed(support: LayerSupport | null): boolean {
  return support?.point_value !== BRACKET_ONLY;
}

export interface ReadoutContext {
  support: LayerSupport | null;
  unit: string;
}

export const withMinus = (text: string): string => text.replace(/^-/, "\u2212");

export const fmtNum = (v: number, unit: string) => withUnit(withMinus(Number.isInteger(v) ? v.toLocaleString("en-US") : formatSig(v, 4)), unit && unit !== "fraction" ? unit : null);

export function cellReadout(cell: RegionalCell, layer: string, ctx: ReadoutContext): string {
  const { unit, support } = ctx;
  if (cell.unreliable) return layer === "verdict" ? NEAR_BOUNDARY_TEXT : `${NEAR_BOUNDARY_TEXT} (the engine wrote ${fmtNum(cell.value, unit)})`;
  const range = cell.lo !== null && cell.hi !== null ? `${fmtNum(cell.lo, "")}–${fmtNum(cell.hi, unit)}` : null;
  const atLeast = cell.censored ? " (a run touching an end of the period is cut by it: at least this long)" : "";
  if (support?.point_value === BRACKET_ONLY) return `${range ? `range ${range}` : `${layer.endsWith("_hi") ? "bracket high" : "bracket low"} ${fmtNum(cell.value, unit)}`}${atLeast}`;
  if (support?.point_value === "approximate" && range) return `${cell.point !== null ? fmtNum(cell.point, unit) : "no value"} (range ${range})${atLeast}`;
  const end = layer.endsWith("_lo") ? "bracket low" : layer.endsWith("_hi") ? "bracket high" : null;
  if (end) return `${end} ${fmtNum(cell.value, unit)}${cell.point !== null ? ` (value ${fmtNum(cell.point, unit)})` : ""}${atLeast}`;
  return `${cell.censored ? "at least " : ""}${fmtNum(cell.value, unit)}`;
}

export function bracketCoverageText(support: LayerSupport | null): string | null {
  const c = support?.validation?.bracket_coverage;
  if (!c) return null;
  const target = c.calibration_target === null ? "" : `, calibrated for ${withUnit((c.calibration_target * 100).toFixed(0), "%")}`;
  return `estimated bracket; contained the exact value in ${withUnit((c.coverage * 100).toFixed(2), "%")} of ${c.cells.toLocaleString("en-US")} independent test cells (${c.misses} ${c.misses === 1 ? "miss" : "misses"}${target}); not a guaranteed bound`;
}

export function validatedAtText(support: LayerSupport | null): string {
  const c = support?.validation?.configuration;
  return c ? `validated at ${shortConfiguration(c)}` : "validated (configuration not stated)";
}

export function validationDiffers(support: LayerSupport | null): boolean {
  return support?.validation?.applies_to_run === false;
}

function splitConfiguration(config: string): { text: string; stores: string[] } {
  const i = config.indexOf(", stores ");
  if (i < 0) return { text: config, stores: [] };
  return {
    text: config.slice(0, i),
    stores: config
      .slice(i + ", stores ".length)
      .split(",")
      .filter((x) => x !== ""),
  };
}

export function shortConfiguration(config: string): string {
  const { text, stores } = splitConfiguration(config);
  return stores.length > 0 ? `${text}, ${stores.length} DEM${stores.length === 1 ? "" : "s"}` : text;
}

const signed = (v: number): string => `${v === 0 ? "" : v < 0 ? "\u2212" : "+"}${Math.abs(v).toFixed(4)}\u00b0`;

type HorizonMove = "raised" | "lowered";

export interface BracketShift {
  layer: string;
  low: string | null;
  high: string | null;
}

export interface BracketedMetric {
  layer: string;
  low: HorizonMove | null;
  high: HorizonMove | null;
}

const move = (v: unknown): HorizonMove | null => (v === "raised" || v === "lowered" ? v : null);

export function bracketedMetrics(result: RegionalResult): BracketedMetric[] {
  return result.layers
    .map((l) => l.name)
    .filter((n) => n.endsWith("_lo"))
    .map((n) => n.slice(0, -3))
    .map((layer) => {
      const s = layerSupport(result, layer);
      return { layer, low: s?.bracket_low_horizon ?? null, high: s?.bracket_high_horizon ?? null };
    });
}

export function bracketShifts(
  cal: { shift_lo_deg: number | null; shift_hi_deg: number | null },
  layers: readonly BracketedMetric[],
): { lowered: string; raised: string; perLayer: BracketShift[] } | null {
  if (cal.shift_lo_deg === null || cal.shift_hi_deg === null) return null;
  const lowered = signed(-cal.shift_lo_deg);
  const raised = signed(cal.shift_hi_deg);
  const by = (m: HorizonMove | null) => (m === "raised" ? raised : m === "lowered" ? lowered : null);
  return { lowered, raised, perLayer: layers.map((l) => ({ layer: l.layer, low: by(l.low), high: by(l.high) })) };
}
