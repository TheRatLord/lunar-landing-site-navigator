import { formatLimit, requirementName } from "../../lib/requirements";
import { clamp, wrap360 } from "../../lib/scale";
import { formatSigned, withUnit } from "../../lib/format";
import { quantityText } from "../../components/viz/units";
import type { Convergence, EllipseResult, EllipseSamples, SampleState } from "../../api/ellipse";
import type { Ellipse, Limit, Scenario } from "../../scenario/types";

export const STATES: readonly SampleState[] = ["pass", "marginal", "fail", "unknown"];
export const STATE_LABEL: Record<SampleState, string> = { pass: "Pass", marginal: "Marginal", fail: "Fail", unknown: "Unknown" };
export const PROB_KEY: Record<SampleState, string> = { pass: "PASS", marginal: "MARGINAL", fail: "FAIL", unknown: "UNKNOWN" };

const DEG = Math.PI / 180;

export function ellipsePoint(e: Pick<Ellipse, "azimuth_deg">, u: number, v: number): [number, number] {
  const az = e.azimuth_deg * DEG;
  return [u * Math.sin(az) + v * Math.cos(az), u * Math.cos(az) - v * Math.sin(az)];
}

export function ellipseOutline(e: Ellipse, k = 1, n = 120): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    out.push(ellipsePoint(e, e.semi_major_m * k * Math.cos(t), e.semi_minor_m * k * Math.sin(t)));
  }
  return out;
}

export function sigmaRings(e: Ellipse): Array<{ k: number; sigma: number }> {
  if (e.dispersion !== "gaussian" || !(e.sigma_level > 1)) return [];
  const out: Array<{ k: number; sigma: number }> = [];
  for (let s = 1; s < e.sigma_level - 1e-9; s++) out.push({ k: s / e.sigma_level, sigma: s });
  return out;
}

export function plotHalfWidth(e: Ellipse): number {
  return e.semi_major_m * 1.12;
}

export function toPx(east: number, north: number, halfM: number, size: number): [number, number] {
  const s = size / (2 * halfM);
  return [size / 2 + east * s, size / 2 - north * s];
}

const f1 = (v: number) => (Math.round(v * 10) / 10).toString();

export function polygonPath(pts: ReadonlyArray<readonly [number, number]>): string {
  return pts.map(([x, y], i) => `${i ? "L" : "M"}${f1(x)} ${f1(y)}`).join("") + "Z";
}

export function samplePath(state: SampleState, px: ReadonlyArray<readonly [number, number]>, r: number): string {
  let d = "";
  for (const [x, y] of px) {
    switch (state) {
      case "pass":
        d += `M${f1(x)} ${f1(y)}h0`;
        break;
      case "marginal":
        d += `M${f1(x)} ${f1(y - r)}l${f1(r * 0.9)} ${f1(r * 1.6)}h${f1(-r * 1.8)}z`;
        break;
      case "fail":
        d += `M${f1(x - r)} ${f1(y - r)}l${f1(2 * r)} ${f1(2 * r)}M${f1(x + r)} ${f1(y - r)}l${f1(-2 * r)} ${f1(2 * r)}`;
        break;
      case "unknown":
        d += `M${f1(x)} ${f1(y - r)}l${f1(r)} ${f1(r)}l${f1(-r)} ${f1(r)}l${f1(-r)} ${f1(-r)}z`;
        break;
    }
  }
  return d;
}

type StateCounts = Record<SampleState, number>;

export function countStates(samples: Pick<EllipseSamples, "state">): StateCounts {
  const c: StateCounts = { pass: 0, marginal: 0, fail: 0, unknown: 0 };
  for (const s of samples.state) c[s] += 1;
  return c;
}

export function indicesByState(samples: Pick<EllipseSamples, "state">): Record<SampleState, number[]> {
  const out: Record<SampleState, number[]> = { pass: [], marginal: [], fail: [], unknown: [] };
  samples.state.forEach((s, i) => out[s].push(i));
  return out;
}

export function stateShares(result: Pick<EllipseResult, "state_probability">): Record<SampleState, number | null> {
  const p = result.state_probability;
  return { pass: p[PROB_KEY.pass] ?? null, marginal: p[PROB_KEY.marginal] ?? null, fail: p[PROB_KEY.fail] ?? null, unknown: p[PROB_KEY.unknown] ?? null };
}

export function percent(v: number | null | undefined, decimals = 1): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "n/a" : withUnit((v * 100).toFixed(decimals), "%");
}

export function standardError(c: Convergence, key: "pass" | "marginal" | "fail"): string {
  const se = c.binomial_standard_error[key];
  return se === undefined ? "" : `± ${withUnit((se * 100).toFixed(1), "%")}`;
}

interface LimitInfo {
  label: string;
  unit: string;
  rule: string;
}

export function limitInfo(scenario: Scenario | { [key: string]: unknown } | null, key: string): LimitInfo {
  const constraints = (scenario as { constraints?: Record<string, unknown> } | null)?.constraints;
  const lim = constraints?.[key] as Limit | null | undefined;
  if (!lim || typeof lim !== "object" || !("unit" in lim)) return { label: key.replace(/_/g, " "), unit: "", rule: "" };
  const lo = lim.min ?? null;
  const hi = lim.max ?? null;
  return { label: requirementName(key, lim.label), unit: lim.unit, rule: formatLimit(lo, hi, lim.unit) };
}


export function offsetText(east: number, north: number): string {
  const d = Math.hypot(east, north);
  if (d < 0.5) return "at the centre";
  const az = wrap360(Math.atan2(east, north) / DEG);
  return `${withUnit(String(Math.round(d)), "m")} at ${String(Math.round(az) % 360).padStart(3, "0")}°`;
}

export function hillshade(heights: Float32Array, n: number, spacingM: number, dark: boolean): Uint8ClampedArray {
  const out = new Uint8ClampedArray(n * n * 4);
  const az = 315 * DEG;
  const alt = 40 * DEG;
  const lx = Math.sin(az) * Math.cos(alt);
  const ly = Math.cos(az) * Math.cos(alt);
  const lz = Math.sin(alt);
  const h = (r: number, c: number) => heights[clamp(r, 0, n - 1) * n + clamp(c, 0, n - 1)]!;
  const lo = dark ? 28 : 150;
  const hi = dark ? 120 : 236;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const o = (r * n + c) * 4;
      const z = heights[r * n + c]!;
      if (z !== z) continue;
      const dzdx = (h(r, c + 1) - h(r, c - 1)) / (2 * spacingM);
      const dzdy = (h(r - 1, c) - h(r + 1, c)) / (2 * spacingM);
      const inv = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const lam = Math.max(0, (-dzdx * lx - dzdy * ly + lz) * inv);
      const t = Math.min(1, lam / Math.sin(alt) / 1.15);
      const v = lo + (hi - lo) * t;
      out[o] = v;
      out[o + 1] = v;
      out[o + 2] = v;
      out[o + 3] = 255;
    }
  }
  return out;
}

export function samplesCsv(result: EllipseResult): string {
  const s = result.samples;
  if (!s) return "";
  const head = [
    `# plan: ${result.scenario_name}`,
    `# scenario_sha256: ${result.scenario_sha256 ?? ""}`,
    `# provider: ${result.provider}`,
    `# scheme: ${result.scheme}`,
    `# n_samples: ${result.n_samples}; seed: ${result.seed}`,
    "# validation: see docs/validation/scenario.md section 9. Offsets are east/north metres from the site centre.",
    "# worst_margin is normalised; worst_margin_physical is the same margin in margin_unit; margin_kind says which case it is, as the service served it.",
    "index,east_m,north_m,lat_deg,lon_deg,state,worst_margin,worst_margin_physical,margin_unit,margin_kind,limiting",
  ];
  const num = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "" : String(v));
  const txt = (v: string | null | undefined) => v ?? "";
  const rows = s.state.map((st, i) =>
    [i, num(s.east_m[i]), num(s.north_m[i]), num(s.lat_deg[i]), num(s.lon_deg[i]), st, num(s.worst_margin[i]), num(s.worst_margin_physical?.[i]), txt(s.margin_unit?.[i]), txt(s.margin_kind?.[i]), txt(s.limiting?.[i])].join(","),
  );
  return head.concat(rows).join("\n") + "\n";
}

const signedMargin = (v: number | null | undefined) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  if (Math.abs(v) < 5e-4) return "≈ 0";
  return formatSigned(v, Math.abs(v) < 0.005 ? 3 : 2);
};

interface MarginRef {
  worst_margin: number | null;
  worst_margin_physical?: number | null;
  margin_unit?: string | null;
}


export function marginText(r: MarginRef): string {
  const phys = r.worst_margin_physical;
  if (phys !== null && phys !== undefined && Number.isFinite(phys)) return quantityText(phys, r.margin_unit, { sign: true });
  const norm = r.worst_margin;
  return `${norm === null || norm === undefined ? "n/a" : signedMargin(norm)} normalised`;
}

