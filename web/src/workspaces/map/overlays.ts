import type { SearchRow, SiteState } from "../../api/search";
import { formatValue } from "../../lib/format";
import { CONSTRAINT_META } from "../../scenario/editor/fieldSpecs";
import { hoursOrDays } from "../../scenario/when";

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
