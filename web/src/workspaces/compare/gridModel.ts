import { siteLabel } from "../../lib/siteName";
import { formatQuantity, outcomeFromJson, requirementName, verdictSentence } from "../../lib/requirements";
import type { ServiceConstraintVerdict, SlipResult, SlipRow, SlipSite } from "../../api/planning";
import { MS_HOUR, parseUtc } from "../../lib/time";
import { VERDICT_LABEL } from "../../lib/verdict";
import { BASELINE_SITE, SEARCH_DAYS } from "./options";

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

export const siteName = (name: string | null | undefined): string => siteLabel(name).trim() || "Unnamed site";

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

export function limitingShort(row: SlipRow): string | null {
  return limitingName(row);
}

function limiting(row: SlipRow): ServiceConstraintVerdict | null {
  return row.verdict?.constraints.find((c) => c.key === row.limiting) ?? null;
}

export function limitingName(row: SlipRow): string | null {
  if (!row.limiting) return null;
  return requirementName(row.limiting, limiting(row)?.label);
}

function quantity(v: number, unit: string): string {
  return formatQuantity(v, unit, { sign: true });
}

export function rowVerdict(row: SlipRow): string | null {
  if (!row.verdict || (row.state !== "pass" && row.state !== "marginal" && row.state !== "fail")) return null;
  const outcomes = row.verdict.constraints.filter((c) => c.state === "pass" || c.state === "marginal" || c.state === "fail").map(outcomeFromJson);
  const soc = row.verdict.constraints.find((c) => c.key === "min_state_of_charge" && c.heading_dependent);
  const best = soc?.heading_best?.value;
  const everyHeading = !!soc && typeof best === "number" && soc.limit_min !== null && best < soc.limit_min;
  return verdictSentence(row.state, outcomes, { batteryEveryHeading: everyHeading })?.detail ?? null;
}

const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function marginValue(row: SlipRow): { value: number; unit: string; worst: boolean } | null {
  const c = limiting(row);
  if (!c) return null;
  const worst = finite(c.margin_worst);
  const nominal = finite(c.margin);
  if (row.state === "marginal" && worst !== null) return { value: worst, unit: c.unit, worst: true };
  const v = nominal ?? worst;
  return v === null ? null : { value: v, unit: c.unit, worst: nominal === null };
}

export function marginText(row: SlipRow): string | null {
  const m = marginValue(row);
  return m === null ? null : quantity(m.value, m.unit);
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
  if (next === null) return `none in ${SEARCH_DAYS} d`;
  const sameDay = Math.floor(next / (24 * MS_HOUR)) === Math.floor(landingMs / (24 * MS_HOUR));
  const d = new Date(next);
  return `next ${dayText(next, new Date(landingMs).getUTCFullYear() !== d.getUTCFullYear())}${sameDay ? ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : ""}`;
}
