import { MAX_SLIP_H } from "../workspaces/compare/options";
import type { Candidate } from "../scenario/alternatives";
import type { TurnDigestScenario } from "../api/types";
import { formatLat, formatLon } from "../lib/coords";
import { parseUtc } from "../lib/time";

export interface SiteFact {
  lat_deg: number;
  lon_deg: number;
  name: string | null;
  landing_utc: string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

function siteFromObject(o: unknown, landing: unknown = null): SiteFact | null {
  if (!isObj(o) || !num(o["lat_deg"]) || !num(o["lon_deg"]) || Math.abs(o["lat_deg"]) > 90) return null;
  return { lat_deg: o["lat_deg"], lon_deg: o["lon_deg"], name: text(o["name"]), landing_utc: text(landing) };
}

export function siteFromRow(row: unknown): SiteFact | null {
  return siteFromObject(row, isObj(row) ? row["landing_utc"] : null);
}

export function siteFromDigest(s: TurnDigestScenario): SiteFact | null {
  return siteFromObject({ lat_deg: s.lat_deg, lon_deg: s.lon_deg, name: s.name ?? s.site }, s.landing_utc);
}

function siteFromToolInput(input: unknown): SiteFact | null {
  if (!isObj(input)) return null;
  const landing = input["landing_utc"];
  return siteFromObject(input, landing) ?? siteFromObject(input["site"], landing);
}

function sitesInResult(doc: unknown): SiteFact[] {
  const out: SiteFact[] = [];
  const walk = (node: unknown, depth: number) => {
    if (depth > 4) return;
    if (Array.isArray(node)) {
      for (const x of node) {
        const s = siteFromRow(isObj(x) && isObj(x["site"]) ? { ...x["site"], name: x["name"] ?? x["site"]["name"], landing_utc: x["landing_utc"] } : x);
        if (s) out.push(s);
        else walk(x, depth + 1);
      }
    } else if (isObj(node)) for (const v of Object.values(node)) walk(v, depth + 1);
  };
  walk(doc, 0);
  return out;
}

const SAME_PLACE_DEG = 1e-4;
const samePlace = (a: { lat_deg: number; lon_deg: number }, b: { lat_deg: number; lon_deg: number }) =>
  Math.abs(a.lat_deg - b.lat_deg) < SAME_PLACE_DEG && Math.abs(a.lon_deg - b.lon_deg) < SAME_PLACE_DEG;

interface OwnScenario {
  lat_deg: number;
  lon_deg: number;
  landing_utc: string;
}

interface CompareAdd {
  sites: Candidate[];
  slips_h: number[];
  own: number;
  present: number;
}

export function planCompareAdd(facts: readonly SiteFact[], own: OwnScenario | null, existing: readonly Candidate[], slips: readonly number[]): CompareAdd {
  const plan: CompareAdd = { sites: [], slips_h: [], own: 0, present: 0 };
  const workMs = own ? parseUtc(own.landing_utc) : null;
  for (const f of facts) {
    if (own && samePlace(f, own)) plan.own += 1;
    else if ([...existing, ...plan.sites].some((c) => samePlace(f, c))) plan.present += 1;
    else {
      plan.sites.push({
        id: `custom-${Math.round(f.lat_deg * 1e4)}_${Math.round(f.lon_deg * 1e4)}`,
        name: f.name ?? `${formatLat(f.lat_deg, 4)} ${formatLon(f.lon_deg, 4)}`,
        lat_deg: f.lat_deg,
        lon_deg: f.lon_deg,
        catalog_id: null,
      });
    }
    const ms = f.landing_utc === null ? null : parseUtc(f.landing_utc);
    if (ms !== null && workMs !== null) {
      const h = Math.round(((ms - workMs) / 3_600_000) * 1000) / 1000;
      if (h !== 0 && Math.abs(h) <= MAX_SLIP_H && !slips.includes(h) && !plan.slips_h.includes(h)) plan.slips_h.push(h);
    }
  }
  return plan;
}

export function distinctSites(facts: readonly SiteFact[]): SiteFact[] {
  const out: SiteFact[] = [];
  for (const f of facts) if (!out.some((o) => samePlace(f, o))) out.push(f);
  return out;
}

export function sitesOfToolCall(input: unknown, result: unknown): SiteFact[] {
  const own = siteFromToolInput(input);
  return distinctSites([...(own ? [own] : []), ...sitesInResult(result)]);
}
