import type { SearchRow, SiteState } from "../../api/search";
import { formatValue } from "../../lib/format";
import { CONSTRAINT_META } from "../../scenario/editor/fieldSpecs";
import { hoursOrDays } from "../../scenario/when";
import { cellColour, type RegionalLayerView } from "../regional/regionalLayer";

export interface PinMark {
  rank: number;
  lat_deg: number;
  lon_deg: number;
  state: SiteState;
  title: string;
  lines: string[];
}

export const STATE_WORD: Record<SiteState, string> = { pass: "Pass", marginal: "Marginal", fail: "Fail", unknown: "No verdict" };

const SHORT = new Map<string, string>(CONSTRAINT_META.map((m) => [m.key, m.short]));

export function marginText(r: SearchRow): string | null {
  if (r.margin === null) return null;
  const name = (r.limitingKey && SHORT.get(r.limitingKey)) || r.limitingLabel;
  const amount = r.unit === "h" ? hoursOrDays(Math.abs(r.margin)) : formatValue(Math.abs(r.margin), r.unit, 1);
  return `${name ? `${name} ` : ""}${r.margin >= 0 ? `${amount} spare` : `misses by ${amount}`}`;
}

export function pinMarks(rows: readonly SearchRow[]): PinMark[] {
  return rows.map((r) => {
    const margin = marginText(r);
    return { rank: r.rank, lat_deg: r.lat_deg, lon_deg: r.lon_deg, state: r.state, title: `#${r.rank} · ${STATE_WORD[r.state]}`, lines: margin ? [margin] : [] };
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
