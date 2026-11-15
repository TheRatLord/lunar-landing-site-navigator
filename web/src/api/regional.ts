import { withUnit } from "../lib/format";
import type { components } from "./generated/schema";

type Schemas = components["schemas"];

export const REGIONAL_ENDPOINT = "/analyses/regional";

export type RegionalResult = Schemas["RegionalResult"];
type RegionalLimit = Schemas["RegionalLimit"];
export type RegionalBody = Pick<Schemas["RegionalRequest"], "lat_deg" | "lon_deg" | "size_m" | "spacing_m" | "start_utc" | "stop_utc"> &
  Partial<Omit<Schemas["RegionalRequest"], "lat_deg" | "lon_deg" | "size_m" | "spacing_m" | "start_utc" | "stop_utc">>;

export const MAX_REGIONAL_CELLS = 250_000;
const MAX_INLINE_CELLS = 65_536;
const MAX_REGION_SIZE_M = 200_000;
const MAX_REGIONAL_SPACING_M = 10_000;

export interface MetricSpec {
  key: string;
  label: string;
  unit: string;
  exact?: boolean;
  earth?: boolean;
}

export const REGIONAL_METRICS: MetricSpec[] = [
  { key: "average_illumination", label: "Average illumination", unit: "fraction" },
  { key: "sun_mean_flux", label: "Mean solar flux", unit: "fraction" },
  { key: "sunlit_fraction", label: "Sunlit fraction", unit: "fraction" },
  { key: "longest_sunlit_h", label: "Longest sunlit run", unit: "h" },
  { key: "longest_shadow_h", label: "Longest shadow run", unit: "h" },
  { key: "earth_fraction", label: "Earth visible fraction", unit: "fraction", earth: true },
  { key: "longest_earth_outage_h", label: "Longest Earth outage", unit: "h", earth: true },
  { key: "slope_deg", label: "Slope", unit: "°", exact: true },
  { key: "ground_height_m", label: "Ground height", unit: "m", exact: true },
];

export const CENSOR_BIT: Record<string, number> = { longest_sunlit_h: 1, longest_shadow_h: 2, longest_earth_outage_h: 4 };

export const METRIC_BY_KEY: Record<string, MetricSpec> = Object.fromEntries(REGIONAL_METRICS.map((m) => [m.key, m]));

export interface RegionalInput {
  lat_deg: number;
  lon_deg: number;
  size_m: number;
  spacing_m: number;
  start_utc: string;
  stop_utc: string;
  step_s: number;
  mast_height_m: number;
  metric: string;
  limit: RegionalLimit | null;
}

export function checkRegional(r: RegionalInput): { errors: string[]; side: number; cells: number; inlineOk: boolean } {
  const errors: string[] = [];
  const { lat_deg, lon_deg, size_m, spacing_m, step_s, mast_height_m } = r;
  if (!Number.isFinite(lat_deg) || Math.abs(lat_deg) > 90) errors.push("Centre latitude must be between −90° and 90°.");
  if (!Number.isFinite(lon_deg)) errors.push("Centre longitude is not a number.");
  if (!Number.isFinite(size_m) || size_m <= 0 || size_m > MAX_REGION_SIZE_M) errors.push(`Region side must be above 0 and at most ${withUnit(MAX_REGION_SIZE_M.toLocaleString("en-US"), "m")}.`);
  if (!Number.isFinite(spacing_m) || spacing_m <= 0 || spacing_m > MAX_REGIONAL_SPACING_M) errors.push(`Cell spacing must be above 0 and at most ${withUnit(MAX_REGIONAL_SPACING_M.toLocaleString("en-US"), "m")}.`);
  if (!Number.isFinite(step_s) || step_s < 60 || step_s > 86_400) errors.push(`Time step must be between ${withUnit("60", "s")} and ${withUnit("86,400", "s")}.`);
  if (!Number.isFinite(mast_height_m) || mast_height_m < 0 || mast_height_m > 100) errors.push(`Mast height must be between 0 and ${withUnit("100", "m")}.`);
  const a = Date.parse(r.start_utc);
  const b = Date.parse(r.stop_utc);
  if (!Number.isFinite(a) || !Number.isFinite(b)) errors.push("Both period bounds need a valid UTC time.");
  else if (b <= a) errors.push("The period must end after it starts.");
  if (r.limit && !Number.isFinite(r.limit.value)) errors.push("The limit value is not a number.");
  let side = Number.NaN;
  let cells = Number.NaN;
  if (Number.isFinite(size_m) && Number.isFinite(spacing_m) && spacing_m > 0) {
    side = Math.round(size_m / spacing_m);
    cells = side * side;
    if (side < 1) errors.push("The spacing is larger than the region: no cell fits.");
    else if (cells > MAX_REGIONAL_CELLS)
      errors.push(`This is ${side} × ${side} = ${cells.toLocaleString("en-US")} cells; the engine refuses more than ${MAX_REGIONAL_CELLS.toLocaleString("en-US")}. Use a coarser spacing or a smaller region.`);
  }
  return { errors, side, cells, inlineOk: cells <= MAX_INLINE_CELLS };
}

export function regionalBody(r: RegionalInput, inline: boolean): RegionalBody {
  const metric = METRIC_BY_KEY[r.metric];
  return {
    lat_deg: r.lat_deg,
    lon_deg: r.lon_deg,
    size_m: r.size_m,
    spacing_m: r.spacing_m,
    start_utc: r.start_utc,
    stop_utc: r.stop_utc,
    step_s: r.step_s,
    mast_height_m: r.mast_height_m,
    bounds: true,
    do_earth: metric?.earth === true,
    ...(r.limit ? { limits: { [r.metric]: r.limit } } : {}),
    inline: inline ? [r.metric, ...(metric?.exact ? [] : [`${r.metric}_lo`, `${r.metric}_hi`]), "censoring_flags", ...(r.limit ? ["verdict"] : [])] : [],
    wait_s: 3,
  };
}
