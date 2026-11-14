import type { MarginKind, SearchRow, SiteState } from "../../api/search";
import { formatLat, formatLon } from "../../lib/coords";
import { formatValue } from "../../lib/format";
import { BASIS_LABEL } from "../../scenario/types";
import schema from "../../api/openapi.json";
import type { ViewKind } from "./urlState";
import { bracketCoverageText, cellColour, pointValueAllowed, validatedAtText, type LayerSupport, type RegionalLayerView } from "../regional/regionalLayer";
import type { RegionalResult } from "../../api/regional";
import type { RegionalLayerShown } from "../regional/regionalLayerStore";

export interface PinMark {
  rank: number;
  lat_deg: number;
  lon_deg: number;
  state: SiteState;
  title: string;
  lines: string[];
}

const STATE_WORD: Record<SiteState, string> = { pass: "pass", marginal: "marginal", fail: "fail", unknown: "no verdict" };
const MARGIN_WORD: Record<MarginKind, string> = { "worst-case": "worst case", nominal: "nominal", "heading unknown": "heading unknown" };

export function pinMarks(rows: readonly SearchRow[]): PinMark[] {
  return rows.map((r) => {
    const lines = [`${formatLat(r.lat_deg)}  ${formatLon(r.lon_deg)}`];
    if (r.margin !== null) lines.push(`Margin ${formatValue(r.margin, r.unit, 1)}${r.marginKind ? ` (${MARGIN_WORD[r.marginKind]})` : ""}${r.limitingLabel ? ` on ${r.limitingLabel}` : ""}`);
    else if (r.limitingLabel) lines.push(`Limited by ${r.limitingLabel}`);
    if (r.marginNote) lines.push(r.marginNote);
    else if (r.headingDependent) lines.push("Lander heading unknown: the verdict follows the engine's heading rule");
    if (r.limitBasis) lines.push(`Threshold basis: ${BASIS_LABEL[r.limitBasis].toLowerCase()} (not a published figure)`);
    return { rank: r.rank, lat_deg: r.lat_deg, lon_deg: r.lon_deg, state: r.state, title: `#${r.rank} · ${STATE_WORD[r.state]}`, lines };
  });
}

export interface RegionalMark {
  hemisphere: "south" | "north";
  x0_m: number;
  y0_m: number;
  spacing_m: number;
  n_rows: number;
  n_cols: number;
  cells: Array<{ row: number; col: number; colour: string; censored: boolean; unreliable: boolean }>;
}

export function regionalMark(view: RegionalLayerView, token: (name: string) => string): RegionalMark {
  const cells: RegionalMark["cells"] = [];
  for (const c of view.cells) {
    const colour = cellColour(c, view.legend, token);
    if (colour) cells.push({ row: c.row, col: c.col, colour, censored: c.censored, unreliable: c.unreliable });
  }
  const g = view.grid;
  return { hemisphere: g.hemisphere, x0_m: g.x0_m, y0_m: g.y0_m, spacing_m: g.spacing_m, n_rows: g.n_rows, n_cols: g.n_cols, cells };
}

export interface DrawnLayer {
  layer: string;
  bracket: "low" | "high" | null;
}

export function drawnLayer(shown: Pick<RegionalLayerShown, "layer" | "metric" | "support">): DrawnLayer {
  const layer = !pointValueAllowed(shown.support) && shown.layer === shown.metric ? `${shown.metric}_lo` : shown.layer;
  return { layer, bracket: layer.endsWith("_lo") ? "low" : layer.endsWith("_hi") ? "high" : null };
}

export function bracketAccount(bracket: DrawnLayer["bracket"], support: LayerSupport | null): string | null {
  const coverage = bracket === null ? null : bracketCoverageText(support);
  return coverage === null ? null : `${coverage} (${validatedAtText(support)})`;
}

export function regionalSummary(request: RegionalLayerShown["request"]): string {
  const day = (iso: string) => iso.slice(0, 10);
  return `Centre ${formatLat(request.lat_deg)} ${formatLon(request.lon_deg)} · ${formatValue(request.size_m / 1000, "km", 1)} square · ${day(request.start_utc)} to ${day(request.stop_utc)}`;
}

export interface RegionalDrawn {
  view: RegionalLayerView;
  bracket: DrawnLayer["bracket"];
  summary: string;
  supportNote: string | null;
  unreliable: number;
  coverage: string | null;
  scaleWarning: string | null;
}

const REGIONAL_GRID = /\(([^()]*polar stereographic[^()]*)\)/.exec(schema.components.schemas.RegionalRequest.description.replace(/\s+/g, " "))?.[1]?.trim() ?? null;
const VIEW_NAME: Record<"south" | "north", string> = { south: "south polar view (key 1)", north: "north polar view (key 2)" };

export function regionalScaleWarning(result: Pick<RegionalResult, "warnings" | "header">): string | null {
  const header = result.header["warnings"];
  const all = [...result.warnings, ...(Array.isArray(header) ? header : [])];
  return all.find((w): w is string => typeof w === "string" && w.startsWith("map scale factor")) ?? null;
}

export function regionalViewNote(kind: ViewKind, hemisphere: "south" | "north" | null, scaleWarning: string | null): string | null {
  if (kind !== "global" && (hemisphere === null || hemisphere === kind)) return null;
  const where = REGIONAL_GRID === null ? "a polar grid" : `the ${REGIONAL_GRID}`;
  const views = hemisphere === null ? `${VIEW_NAME.south} or ${VIEW_NAME.north}` : VIEW_NAME[hemisphere];
  const view = kind === "global" ? "the global view" : `the ${kind} polar view`;
  const warning = scaleWarning === null ? "" : ` The engine's warning on this result: "${scaleWarning}".`;
  return `Regional cells are not drawn on ${view}: the engine computes them on ${where} (its description of the regional request), so the Map draws them only on the ${views}.${warning}`;
}

