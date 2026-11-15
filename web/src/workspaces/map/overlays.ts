import type { SearchRow, SiteState } from "../../api/search";
import { formatQuantity, requirementName } from "../../lib/requirements";

export interface PinMark {
  rank: number;
  lat_deg: number;
  lon_deg: number;
  state: SiteState;
  title: string;
  lines: string[];
}

export const STATE_WORD: Record<SiteState, string> = { pass: "Pass", marginal: "Marginal", fail: "Fail", unknown: "Unknown" };

export function marginText(r: SearchRow): string | null {
  if (r.margin === null) return null;
  const name = requirementName(r.limitingKey, r.limitingLabel);
  return `${name ? `${name} ` : ""}${formatQuantity(r.margin, r.unit, { sign: true })}`;
}

export function pinMarks(rows: readonly SearchRow[]): PinMark[] {
  return rows.map((r) => {
    const margin = marginText(r);
    return { rank: r.rank, lat_deg: r.lat_deg, lon_deg: r.lon_deg, state: r.state, title: `#${r.rank} · ${STATE_WORD[r.state]}`, lines: margin ? [margin] : [] };
  });
}
