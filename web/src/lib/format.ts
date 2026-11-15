import { wrap360 } from "./scale";
export const NBSP = "\u00A0";

export const glue = (text: string): string => text.replace(/ /g, NBSP);

export function withUnit(text: string, unit: string | null | undefined): string {
  const t = glue(text);
  if (!unit) return t;
  return unit.startsWith("°") ? `${t}${unit}` : `${t}${NBSP}${glue(unit)}`;
}

export function glueQuantities(text: string): string {
  return text.replace(/(?<=[0-9]) (?=(?:%|°|deg|km|ms|min|h|m|s)(?![A-Za-z0-9_]))/g, NBSP);
}

export function formatValue(v: number, unit: string | null | undefined, decimals = 2): string {
  const n = formatNum(v, decimals);
  return n === "—" ? n : withUnit(n, unit);
}

export function formatSignedValue(v: number | null | undefined, unit: string | null | undefined, decimals = 2): string {
  if (v === null || v === undefined) return "—";
  const n = formatSigned(v, decimals);
  return n === "—" ? n : withUnit(n, unit);
}

export function formatLimit(sense: "min" | "max", limit: number, unit: string | null | undefined, decimals = 2): string {
  return withUnit(`${sense === "min" ? "≥" : "≤"} ${formatNum(limit, decimals)}`, unit);
}

export function formatSigned(v: number, decimals = 2): string {
  if (!Number.isFinite(v)) return "—";
  return `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(decimals)}`;
}

export function formatNum(v: number, decimals = 2): string {
  if (!Number.isFinite(v)) return "—";
  const body = Math.abs(v).toFixed(decimals);
  return v < 0 && Number(body) !== 0 ? `−${body}` : body;
}

export function formatDeg(v: number, decimals = 1, opts: { azimuth?: boolean } = {}): string {
  if (!Number.isFinite(v)) return "—";
  let r = Number(v.toFixed(decimals));
  if (opts.azimuth) r = wrap360(r);
  if (r === 0) r = 0;
  return `${formatNum(r, decimals)}°`;
}

export function tickDecimals(ticks: readonly number[], max: number): number {
  if (ticks.length < 2) return max;
  const step = Math.abs(ticks[1]! - ticks[0]!);
  if (!(step > 0)) return max;
  let d = 0;
  while (d < max && Math.abs(step * 10 ** d - Math.round(step * 10 ** d)) > 1e-6) d++;
  return d;
}
