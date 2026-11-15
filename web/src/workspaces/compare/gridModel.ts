import type { ServiceConstraintVerdict, SlipResult, SlipRow, SlipSite } from "../../api/planning";
import { formatSigned } from "../../lib/format";
import { MS_HOUR, parseUtc } from "../../lib/time";
import { VERDICT_LABEL } from "../../lib/verdict";
import { BASELINE_SITE } from "./options";

export interface SiteRef {
  key: string;
  name: string;
  lat_deg: number;
  lon_deg: number;
  catalog_id: string | null;
}

type CellState = SlipRow["state"];

export const STATE_WORD: Record<CellState, string> = {
  pass: VERDICT_LABEL.pass,
  marginal: VERDICT_LABEL.marginal,
  fail: VERDICT_LABEL.fail,
  unknown: "Unknown",
  no_opportunity: "No landing",
};

export const works = (s: CellState): boolean => s === "pass" || s === "marginal";

const PREFIX = /^Artemis candidate region:\s*/i;
export const siteName = (name: string | null | undefined): string => (name ?? "").replace(PREFIX, "").trim() || "Unnamed site";

const EPS_DEG = 1e-6;
type Spot = { lat_deg: number; lon_deg: number; catalog_id?: string | null };
export const sameSite = (a: Spot, b: Spot): boolean =>
  (a.catalog_id && b.catalog_id ? a.catalog_id === b.catalog_id : false) ||
  (Math.abs(a.lat_deg - b.lat_deg) < EPS_DEG && Math.abs(a.lon_deg - b.lon_deg) < EPS_DEG);

export function requestedSites(
  plan: { name: string; lat_deg: number; lon_deg: number; catalog_id?: string | null },
  alternatives: ReadonlyArray<{ id: string; name: string; lat_deg: number; lon_deg: number; catalog_id: string | null }>,
): SiteRef[] {
  const out: SiteRef[] = [{ key: BASELINE_SITE, name: siteName(plan.name), lat_deg: plan.lat_deg, lon_deg: plan.lon_deg, catalog_id: plan.catalog_id ?? null }];
  for (const a of alternatives) {
    if (out.some((r) => sameSite(r, a))) continue;
    out.push({ key: a.id, name: siteName(a.name), lat_deg: a.lat_deg, lon_deg: a.lon_deg, catalog_id: a.catalog_id });
  }
  return out;
}

export function servedByKey(result: SlipResult | null, requested: readonly SiteRef[]): Map<string, SlipSite> {
  const out = new Map<string, SlipSite>();
  if (!result) return out;
  const free = [...requested];
  for (const s of result.results) {
    const at = free.findIndex((r) => (r.catalog_id && s.site.catalog_id ? r.catalog_id === s.site.catalog_id : r.catalog_id === s.site.catalog_id && sameSite({ ...r, catalog_id: null }, { ...s.site, catalog_id: null })));
    if (at >= 0) out.set(free.splice(at, 1)[0]!.key, s);
  }
  return out;
}

const SHORT_NAME: Record<string, string> = {
  landing_sun_elevation_deg: "Sun elevation",
  landing_hours_after_sunrise: "Since sunrise",
  dte_at_landing_deg: "Earth elevation",
  min_sunlit_hours_after_landing: "Sunlight",
  max_dark_span_h: "Longest dark span",
  min_total_sunlit_h: "Sunlight total",
  min_total_contact_h: "Earth link total",
  min_total_sunlit_contact_h: "Sunlight with Earth link",
  min_state_of_charge: "Battery",
  min_contact_fraction: "Earth link share",
  max_contact_gap_h: "Earth link gap",
  min_link_margin_db: "Link margin",
  max_slope_deg: "Slope",
};

const CELL_NAME: Record<string, string> = {
  max_dark_span_h: "Dark span",
  min_total_sunlit_contact_h: "Sun and Earth",
  min_total_contact_h: "Earth link",
  min_total_sunlit_h: "Sunlight",
};

export function limitingShort(row: SlipRow): string | null {
  return (row.limiting ? CELL_NAME[row.limiting] : undefined) ?? limitingName(row);
}

function limiting(row: SlipRow): ServiceConstraintVerdict | null {
  return row.verdict?.constraints.find((c) => c.key === row.limiting) ?? null;
}

export function limitingName(row: SlipRow): string | null {
  if (!row.limiting) return null;
  return SHORT_NAME[row.limiting] ?? limiting(row)?.label ?? row.limiting;
}

function quantity(v: number, unit: string): string {
  if (unit === "deg" || unit === "°") return `${formatSigned(v, 1)}°`;
  if (unit === "h" && Math.abs(v) >= 48) return `${formatSigned(v / 24, 1)} d`;
  if (unit === "fraction") return `${formatSigned(v * 100, 1)} %`;
  return unit ? `${formatSigned(v, 1)} ${unit}` : formatSigned(v, 1);
}

export function marginText(row: SlipRow): string | null {
  const c = limiting(row);
  if (!c) return null;
  const v = typeof c.margin === "number" && Number.isFinite(c.margin) ? c.margin : typeof c.margin_worst === "number" && Number.isFinite(c.margin_worst) ? c.margin_worst : null;
  return v === null ? null : quantity(v, c.unit);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

export function dayText(ms: number, year = false): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ""}`;
}

export function dateText(ms: number): string {
  const d = new Date(ms);
  return `${dayText(ms, true)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function nextText(row: SlipRow, landingMs: number): string {
  const next = parseUtc(row.next_open_utc ?? null);
  if (next === null) return "";
  const sameDay = Math.floor(next / (24 * MS_HOUR)) === Math.floor(landingMs / (24 * MS_HOUR));
  const d = new Date(next);
  return `next ${sameDay ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : dayText(next, new Date(landingMs).getUTCFullYear() !== d.getUTCFullYear())}`;
}
