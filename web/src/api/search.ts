import { kindWord } from "../lib/marginKind";
import type { components } from "./generated/schema";
import { parseUtc, roundToSecond, toIsoUtc } from "../lib/time";
import type { Basis, Limit, Scenario } from "../scenario/types";
import { UNPUBLISHED_BASES } from "../scenario/types";

type Schemas = components["schemas"];

export const SEARCH_ENDPOINT = "/analyses/search";

type SearchRegion = Schemas["SearchRegionModel"];
export type SearchResult = Schemas["SearchResult"];
export type SearchBody = Pick<Schemas["SearchRequest"], "region" | "final_spacing_m"> &
  Partial<Omit<Schemas["SearchRequest"], "region" | "final_spacing_m">>;

export const MAX_SEARCH_POINTS = 250_000;
const MAX_RADIUS_M = 200_000;
const MAX_SPACING_M = 20_000;
const MAX_TOP_K = 500;
const M_PER_DEG = 30_323;

export type RegionInput =
  | { kind: "disc"; lat_deg: number; lon_deg: number; radius_m: number }
  | { kind: "box"; lat_min: number; lat_max: number; lon_min: number; lon_max: number };

function regionModel(r: RegionInput): SearchRegion {
  if (r.kind === "disc") return { lat_deg: r.lat_deg, lon_deg: r.lon_deg, radius_m: r.radius_m };
  return {
    lat_deg: (r.lat_min + r.lat_max) / 2,
    lon_deg: (r.lon_min + r.lon_max) / 2,
    polygon: [
      [r.lat_min, r.lon_min],
      [r.lat_min, r.lon_max],
      [r.lat_max, r.lon_max],
      [r.lat_max, r.lon_min],
    ],
  };
}

function regionHalfWidth_m(r: SearchRegion): number {
  if (r.radius_m != null) return r.radius_m;
  const p = r.polygon ?? [];
  const lats = p.map((v) => v[0]);
  const lons = p.map((v) => v[1]);
  const dlat = (Math.max(...lats) - Math.min(...lats)) * M_PER_DEG;
  const dlon = (Math.max(...lons) - Math.min(...lons)) * M_PER_DEG * Math.max(Math.cos((r.lat_deg * Math.PI) / 180), 0.01);
  return Math.max(dlat, dlon) / 2 + 1;
}

export function checkSearch(region: RegionInput, spacing_m: number, top_k: number, epochs: { first_utc: string; last_utc: string; spacing_h: number } | null): { errors: string[]; points: number } {
  const errors: string[] = [];
  if (region.kind === "disc") {
    if (!Number.isFinite(region.lat_deg) || Math.abs(region.lat_deg) > 90) errors.push("Centre latitude must be between −90° and 90°.");
    if (!Number.isFinite(region.lon_deg)) errors.push("Centre longitude is not a number.");
    if (!Number.isFinite(region.radius_m) || region.radius_m <= 0 || region.radius_m > MAX_RADIUS_M) errors.push(`Radius must be above 0 and at most ${MAX_RADIUS_M.toLocaleString("en-US")} m.`);
  } else {
    const { lat_min, lat_max, lon_min, lon_max } = region;
    if (![lat_min, lat_max, lon_min, lon_max].every(Number.isFinite)) errors.push("Every box edge needs a number.");
    else {
      if (Math.abs(lat_min) > 90 || Math.abs(lat_max) > 90) errors.push("Box latitudes must be between −90° and 90°.");
      if (lat_min >= lat_max) errors.push("The south edge must be below the north edge.");
      if (lon_min >= lon_max) errors.push("The west edge must be west of the east edge (use longitudes beyond 180° to cross the antimeridian).");
    }
  }
  if (!Number.isFinite(spacing_m) || spacing_m <= 0 || spacing_m > MAX_SPACING_M) errors.push(`Final spacing must be above 0 and at most ${MAX_SPACING_M.toLocaleString("en-US")} m.`);
  if (!Number.isInteger(top_k) || top_k < 1 || top_k > MAX_TOP_K) errors.push(`Ranked sites must be a whole number from 1 to ${MAX_TOP_K}.`);
  if (epochs) {
    const a = Date.parse(epochs.first_utc);
    const b = Date.parse(epochs.last_utc);
    if (!Number.isFinite(a) || !Number.isFinite(b)) errors.push("Both ends of the landing window need a valid UTC time.");
    else if (b <= a) errors.push("The landing window must end after it starts.");
    if (!Number.isFinite(epochs.spacing_h) || epochs.spacing_h <= 0 || epochs.spacing_h > 8760) errors.push("The spacing between landings must be above 0 and at most 8,760 h.");
  }
  let points = Number.NaN;
  if (errors.length === 0) {
    points = ((2 * regionHalfWidth_m(regionModel(region))) / spacing_m) ** 2;
    if (points > MAX_SEARCH_POINTS)
      errors.push(
        `This region implies about ${Math.round(points).toLocaleString("en-US")} grid points at ${spacing_m} m; the engine refuses more than ${MAX_SEARCH_POINTS.toLocaleString("en-US")}. Use a coarser spacing or a smaller region.`,
      );
  }
  return { errors, points };
}

export function searchBody(
  scenario: Scenario,
  region: RegionInput,
  spacing_m: number,
  top_k: number,
  epochs: { first_utc: string; last_utc: string; spacing_h: number } | null,
  rank_by: Schemas["SearchRequest"]["rank_by"] = "margin",
): SearchBody {
  return {
    scenario,
    region: regionModel(region),
    final_spacing_m: spacing_m,
    top_k,
    rank_by,
    ...(epochs ? { first_utc: epochs.first_utc, last_utc: epochs.last_utc, epoch_spacing_h: epochs.spacing_h } : {}),
    with_grid: true,
    terrain: "auto",
    wait_s: 3,
  };
}

export type SiteState = "pass" | "marginal" | "fail" | "unknown";
const STATES: Record<string, SiteState> = { pass: "pass", marginal: "marginal", fail: "fail" };

export type MarginKind = NonNullable<ReturnType<typeof kindWord>>;

export interface SearchRow {
  rank: number;
  lat_deg: number;
  lon_deg: number;
  state: SiteState;
  normalised: number | null;
  margin: number | null;
  unit: string;
  marginKind: MarginKind | null;
  marginNote: string | null;
  limitingKey: string | null;
  limitingLabel: string;
  limitBasis: Basis | null;
  headingDependent: boolean;
  landing_utc: string;
  n_epochs_pass: number;
  n_epochs: number;
  slope_deg: number | null;
  totals: Record<string, number | null>;
}

function limitOf(scenario: unknown, key: string): Limit | null {
  if (!scenario || typeof scenario !== "object") return null;
  const c: unknown = Reflect.get(scenario, "constraints");
  if (!c || typeof c !== "object") return null;
  const l: unknown = Reflect.get(c, key);
  return l && typeof l === "object" && "margin_scale" in l ? (l as Limit) : null;
}

export function searchRows(result: SearchResult): SearchRow[] {
  return result.sites.map((s) => {
    const limit = s.limiting ? limitOf(result.scenario, s.limiting) : null;
    const basis = limit?.origin?.basis;
    const state = STATES[s.state] ?? "unknown";
    return {
      rank: s.rank,
      lat_deg: s.lat_deg,
      lon_deg: s.lon_deg,
      state,
      normalised: s.worst_margin,
      margin: s.worst_margin_physical,
      unit: s.margin_unit ?? "",
      marginKind: kindWord(s.margin_kind),
      marginNote: s.margin_note ?? null,
      limitingKey: s.limiting,
      limitingLabel: limit?.label || s.limiting || "",
      limitBasis: basis && UNPUBLISHED_BASES.has(basis) ? basis : null,
      headingDependent: s.limiting === "min_state_of_charge" && s.values[s.limiting] === null,
      landing_utc: secondUtc(s.landing_utc),
      n_epochs_pass: s.n_epochs_pass,
      n_epochs: s.n_epochs,
      slope_deg: s.slope_deg,
      totals: s.totals ?? {},
    };
  });
}

function secondUtc(utc: string): string {
  const ms = parseUtc(utc);
  return ms === null ? utc : toIsoUtc(roundToSecond(ms));
}
