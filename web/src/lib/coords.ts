import { wrap180 } from "./scale";
export type ParseResult = { ok: true; value: number } | { ok: false; error: string };

export type LatLonResult = { ok: true; lat: number; lon: number } | { ok: false; error: string };

const NUM = String.raw`[+\-−]?(?:\d+(?:\.\d*)?|\.\d+)`;
const SINGLE_RE = new RegExp(String.raw`^\s*(${NUM})\s*°?\s*([NSEWnsew])?\s*$`);

export function parseLat(text: string): ParseResult {
  return parseAxis(text, "lat");
}

export function parseLon(text: string): ParseResult {
  return parseAxis(text, "lon");
}

function parseAxis(text: string, axis: "lat" | "lon"): ParseResult {
  if (text.trim() === "") return { ok: false, error: "Required" };
  const m = SINGLE_RE.exec(text.replace(/−/g, "-"));
  if (!m) return { ok: false, error: "Enter decimal degrees, e.g. -89.54" };
  const raw = m[1]!;
  let v = Number(raw);
  const hemi = m[2]?.toUpperCase();
  if (hemi) {
    const okHemi = axis === "lat" ? hemi === "N" || hemi === "S" : hemi === "E" || hemi === "W";
    if (!okHemi) return { ok: false, error: axis === "lat" ? "Use N or S" : "Use E or W" };
    const negative = hemi === "S" || hemi === "W";
    const sign = raw.startsWith("-") ? -1 : raw.startsWith("+") ? 1 : 0;
    if (v !== 0 && sign !== 0 && sign < 0 !== negative) {
      return { ok: false, error: `Sign contradicts ${hemi}: write ${Math.abs(v)} ${hemi} or ${sign < 0 ? "−" : "+"}${Math.abs(v)}` };
    }
    v = negative ? -Math.abs(v) : Math.abs(v);
  }
  if (!Number.isFinite(v)) return { ok: false, error: "Not a number" };
  if (axis === "lat") {
    if (v < -90 || v > 90) return { ok: false, error: "Latitude must be within ±90°" };
    return { ok: true, value: v };
  }
  if (v < -180 || v > 360) return { ok: false, error: "Longitude must be within −180…360°" };
  return { ok: true, value: normaliseLon(v) };
}

function normaliseLon(v: number): number {
  if (v >= -180 && v < 180) return v;
  return wrap180(v);
}

export function parseLatLon(text: string): LatLonResult {
  const cleaned = text.replace(/\b(lat(itude)?|lon(gitude)?)\b\s*[:=]?/gi, " ").replace(/−/g, "-").replace(/,/g, " ").trim().replace(/[()[\]]/g, " ");
  const parts = cleaned.split(/\s+/).filter(Boolean);
  const tokens: string[] = [];
  for (const p of parts) {
    if (/^[NSEWnsew]$/.test(p) && tokens.length) tokens[tokens.length - 1] += p;
    else tokens.push(p);
  }
  if (tokens.length !== 2) return { ok: false, error: "Expected two values: latitude, longitude" };
  let [a, b] = tokens as [string, string];
  if (/[EWew]$/.test(a) && /[NSns]$/.test(b)) [a, b] = [b, a];
  const lat = parseLat(a);
  if (!lat.ok) return { ok: false, error: `Latitude: ${lat.error}` };
  const lon = parseLon(b);
  if (!lon.ok) return { ok: false, error: `Longitude: ${lon.error}` };
  return { ok: true, lat: lat.value, lon: lon.value };
}

function formatHemi(v: number, decimals: number, neg: string, pos: string): string {
  if (!Number.isFinite(v)) return "—";
  const body = Math.abs(v).toFixed(decimals);
  if (Number(body) === 0) return `${body}°`;
  return `${body}°${v < 0 ? neg : pos}`;
}

export function formatLat(v: number, decimals = 4): string {
  return formatHemi(v, decimals, "S", "N");
}

export function formatLon(v: number, decimals = 4): string {
  return formatHemi(v, decimals, "W", "E");
}
