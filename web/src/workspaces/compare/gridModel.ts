import { utcText } from "../../lib/time";
import type { SlipResult, SlipRow, SlipSite, VerdictState } from "../../api/planning";
import { limitingRow, slipMargins } from "../calendar/format";
import { formatSigned, formatSignedValue } from "../../lib/format";
import { kindWord } from "../../lib/marginKind";
import { VERDICT_LABEL } from "../../lib/verdict";
import { delayLabel } from "./delays";
import { BASELINE_SITE } from "./options";

export interface SiteRef {
  key: string;
  name: string;
  lat_deg: number;
  lon_deg: number;
  catalog_id: string | null;
}

type CellState = VerdictState | "no_opportunity";

export const CELL_MARK: Record<CellState, { word: string }> = {
  pass: { word: VERDICT_LABEL.pass },
  marginal: { word: VERDICT_LABEL.marginal },
  fail: { word: VERDICT_LABEL.fail },
  unknown: { word: "Unknown" },
  no_opportunity: { word: "No landing" },
};

const EPS_DEG = 1e-6;
const sameSpot = (a: { lat_deg: number; lon_deg: number }, b: { lat_deg: number; lon_deg: number }) =>
  Math.abs(a.lat_deg - b.lat_deg) < EPS_DEG && Math.abs(a.lon_deg - b.lon_deg) < EPS_DEG;

function siteKeys(served: readonly Pick<SlipSite, "site">[], requested: readonly SiteRef[]): Array<string | null> {
  const free = [...requested];
  return served.map((s) => {
    const at = free.findIndex((r) => r.catalog_id === s.site.catalog_id && sameSpot(r, s.site));
    return at < 0 ? null : free.splice(at, 1)[0]!.key;
  });
}

export function requestedSites(
  doc: { site: { name: string; lat_deg: number; lon_deg: number; catalog_id?: string | null } },
  alternatives: ReadonlyArray<{ id: string; name: string; lat_deg: number; lon_deg: number; catalog_id: string | null }>,
): SiteRef[] {
  const s = doc.site;
  return [
    { key: BASELINE_SITE, name: s.name || "Baseline", lat_deg: s.lat_deg, lon_deg: s.lon_deg, catalog_id: s.catalog_id ?? null },
    ...alternatives.map((a) => ({ key: a.id, name: a.name, lat_deg: a.lat_deg, lon_deg: a.lon_deg, catalog_id: a.catalog_id })),
  ];
}

export function findCell(result: SlipResult | null, keys: ReadonlyArray<string | null>, site: string, slip_h: number): { site: SlipSite; row: SlipRow } | null {
  const i = keys.indexOf(site);
  const s = i < 0 ? undefined : result?.results[i];
  const row = s?.rows.find((r) => r.slip_h === slip_h);
  return s && row ? { site: s, row } : null;
}

export function limitingLabel(row: SlipRow): string | null {
  return limitingRow(row)?.label ?? row.limiting;
}

function rowMarginText(row: SlipRow): string | null {
  if (row.margin_kind === null) return null;
  const m = slipMargins(row);
  const cell = row.margin_kind === "worst_case" ? m.worst : row.margin_kind === "nominal" ? m.nominal : m.headingUnknown;
  return cell ? `${kindWord(row.margin_kind)} margin ${cell.text}` : null;
}

export function cellName(siteName: string, row: SlipRow, pinned: number | null): string {
  const parts = [`${siteName}, ${delayLabel(row.slip_h)}`];
  parts.push(row.landing_utc ? `landing ${utcText(row.landing_utc)} UTC` : "no landing");
  parts.push(CELL_MARK[row.state].word);
  const limiting = limitingLabel(row);
  if (limiting) parts.push(`limited by ${limiting}`);
  const margin = rowMarginText(row);
  if (margin) parts.push(margin);
  else if (row.margin_note) parts.push(row.margin_note);
  if (row.next_open_utc) parts.push(`next open ${utcText(row.next_open_utc)} UTC`);
  if (pinned !== null) parts.push(`in the shortlist as number ${pinned}`);
  return parts.join("; ");
}

const SHORT_NAME: Record<string, string> = {
  landing_sun_elevation_deg: "Sun elevation",
  landing_hours_after_sunrise: "Since sunrise",
  dte_at_landing_deg: "Earth elevation",
  min_sunlit_hours_after_landing: "Sunlight",
  max_dark_span_h: "Dark span",
  min_state_of_charge: "Battery",
  min_contact_fraction: "Contact",
  max_contact_gap_h: "Contact gap",
  min_link_margin_db: "Link margin",
  max_slope_deg: "Slope",
};

export function shortName(key: string | null | undefined, label: string | null | undefined): string | null {
  return (key ? SHORT_NAME[key] : undefined) ?? label ?? key ?? null;
}

export function limitingShort(row: SlipRow): string | null {
  return shortName(row.limiting, limitingLabel(row));
}

export function cellFigure(row: SlipRow): string | null {
  const c = limitingRow(row);
  if (c && typeof c.margin === "number" && Number.isFinite(c.margin)) return formatSignedValue(c.margin, c.unit, 1);
  if (c && typeof c.margin_worst === "number" && Number.isFinite(c.margin_worst)) return formatSignedValue(c.margin_worst, c.unit, 1);
  if (row.margin !== null && Number.isFinite(row.margin)) return `${formatSigned(row.margin, 2)} ×`;
  return null;
}

interface GridRow {
  key: string | null;
  site: SlipSite;
  name: string;
}

export function gridRows(result: SlipResult, requested: readonly SiteRef[]): GridRow[] {
  const keys = siteKeys(result.results, requested);
  return result.results.map((site, i) => ({
    key: keys[i] ?? null,
    site,
    name: requested.find((r) => r.key === keys[i])?.name ?? site.site_name ?? site.scenario_name,
  }));
}

export function worksParts(site: Pick<SlipSite, "n_pass" | "rows">): { pass: number; total: number; marginal: number } {
  return { pass: site.n_pass, total: site.rows.length, marginal: site.rows.filter((r) => r.state === "marginal").length };
}
