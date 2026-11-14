import { clamp, wrap180, wrap360 } from "./scale";
export const MOON_R_M = 1737400;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export type Hemisphere = "south" | "north";

export function polarForward(
  hemisphere: Hemisphere,
  lat_deg: number,
  lon_deg: number,
  R = MOON_R_M,
): { x_m: number; y_m: number } {
  const lam = lon_deg * D2R;
  if (hemisphere === "south") {
    const rho = 2 * R * Math.tan(Math.PI / 4 + (lat_deg * D2R) / 2);
    return { x_m: rho * Math.sin(lam), y_m: rho * Math.cos(lam) };
  }
  const rho = 2 * R * Math.tan(Math.PI / 4 - (lat_deg * D2R) / 2);
  return { x_m: rho * Math.sin(lam), y_m: -rho * Math.cos(lam) };
}

export function polarInverse(
  hemisphere: Hemisphere,
  x_m: number,
  y_m: number,
  R = MOON_R_M,
): { lat_deg: number; lon_deg: number } {
  const rho = Math.hypot(x_m, y_m);
  if (hemisphere === "south") {
    const lat = 2 * Math.atan(rho / (2 * R)) - Math.PI / 2;
    const lon = rho === 0 ? 0 : Math.atan2(x_m, y_m);
    return { lat_deg: lat * R2D, lon_deg: wrap180(lon * R2D) };
  }
  const lat = Math.PI / 2 - 2 * Math.atan(rho / (2 * R));
  const lon = rho === 0 ? 0 : Math.atan2(x_m, -y_m);
  return { lat_deg: lat * R2D, lon_deg: wrap180(lon * R2D) };
}

export function polarScale(hemisphere: Hemisphere, lat_deg: number): number {
  const s = Math.sin(lat_deg * D2R);
  return 2 / (1 + (hemisphere === "south" ? -s : s));
}

export interface Projection {
  kind: "polar-stereographic" | "equirectangular";
  hemisphere: Hemisphere | null;
  R: number;
  units: "m" | "deg";
  forward(lat_deg: number, lon_deg: number): [number, number];
  inverse(x: number, y: number): [number, number];
  groundPerUnit(lat_deg: number): { x: number; y: number };
}

function parseProj(proj: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tok of proj.trim().split(/\s+/)) {
    if (!tok.startsWith("+")) continue;
    const [k = "", v] = tok.slice(1).split("=");
    out[k] = v ?? "";
  }
  return out;
}

export function projectionFromProj(proj: string): Projection {
  const p = parseProj(proj);
  const R = p.R ? Number(p.R) : MOON_R_M;
  if (p.proj === "stere") {
    const lat0 = Number(p.lat_0);
    const latTs = p.lat_ts === undefined ? lat0 : Number(p.lat_ts);
    const k = p.k === undefined ? (p.k_0 === undefined ? 1 : Number(p.k_0)) : Number(p.k);
    const lon0 = p.lon_0 ? Number(p.lon_0) : 0;
    if (Math.abs(lat0) !== 90 || latTs !== lat0 || k !== 1 || lon0 !== 0 || Number(p.x_0 ?? 0) !== 0 || Number(p.y_0 ?? 0) !== 0) {
      throw new Error(`unsupported stereographic definition: ${proj}`);
    }
    const h: Hemisphere = lat0 < 0 ? "south" : "north";
    return {
      kind: "polar-stereographic",
      hemisphere: h,
      R,
      units: "m",
      forward(lat, lon) {
        const r = polarForward(h, lat, lon, R);
        return [r.x_m, r.y_m];
      },
      inverse(x, y) {
        const r = polarInverse(h, x, y, R);
        return [r.lat_deg, r.lon_deg];
      },
      groundPerUnit(lat) {
        const s = 1 / polarScale(h, lat);
        return { x: s, y: s };
      },
    };
  }
  if (p.proj === "longlat" || p.proj === "latlong") {
    const pm = p.pm === undefined || p.pm === "greenwich" ? 0 : Number(p.pm);
    if (Number(p.lon_0 ?? 0) !== 0 || pm !== 0) throw new Error(`unsupported longlat definition (lon_0 / pm): ${proj}`);
    const mPerDeg = R * D2R;
    return {
      kind: "equirectangular",
      hemisphere: null,
      R,
      units: "deg",
      forward(lat, lon) {
        return [lon, lat];
      },
      inverse(x, y) {
        return [clamp(y, -90, 90), wrap180(x)];
      },
      groundPerUnit(lat) {
        return { x: mPerDeg * Math.max(1e-9, Math.cos(lat * D2R)), y: mPerDeg };
      },
    };
  }
  throw new Error(`unsupported projection: ${proj}`);
}

export interface TileGridDef {
  extent: [number, number, number, number];
  tilesX0: number;
  tilesY0: number;
  minZ: number;
  maxZ: number;
  tileSize: number;
}

export function tileSpan(g: TileGridDef, z: number): [number, number] {
  const f = 2 ** z;
  return [(g.extent[2] - g.extent[0]) / (g.tilesX0 * f), (g.extent[3] - g.extent[1]) / (g.tilesY0 * f)];
}

export function tileBounds(g: TileGridDef, z: number, x: number, y: number): [number, number, number, number] {
  const [w, h] = tileSpan(g, z);
  const xmin = g.extent[0] + x * w;
  const ymax = g.extent[3] - y * h;
  return [xmin, ymax - h, xmin + w, ymax];
}

export function tilePixel(g: TileGridDef, z: number, mx: number, my: number): { x: number; y: number; px: number; py: number } {
  const [w, h] = tileSpan(g, z);
  const fx = (mx - g.extent[0]) / w;
  const fy = (g.extent[3] - my) / h;
  const x = Math.floor(fx);
  const y = Math.floor(fy);
  return { x, y, px: (fx - x) * g.tileSize, py: (fy - y) * g.tileSize };
}

export function distance_m(lat1: number, lon1: number, lat2: number, lon2: number, R = MOON_R_M): number {
  const p1 = lat1 * D2R;
  const p2 = lat2 * D2R;
  const dp = p2 - p1;
  const dl = (lon2 - lon1) * D2R;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearing_deg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * D2R;
  const p2 = lat2 * D2R;
  const dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return wrap360(Math.atan2(y, x) * R2D);
}

export function destination(lat_deg: number, lon_deg: number, az_deg: number, dist_m: number, R = MOON_R_M): [number, number] {
  const d = dist_m / R;
  const p1 = lat_deg * D2R;
  const th = az_deg * D2R;
  const sp2 = Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(th);
  const p2 = Math.asin(clamp(sp2, -1, 1));
  const l2 = lon_deg * D2R + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * sp2);
  return [p2 * R2D, wrap180(l2 * R2D)];
}

export function ellipseOutline(
  lat_deg: number,
  lon_deg: number,
  semiMajor_m: number,
  semiMinor_m: number,
  azimuth_deg: number,
  n = 72,
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * Math.PI;
    const a = semiMajor_m * Math.cos(t);
    const b = semiMinor_m * Math.sin(t);
    const r = Math.hypot(a, b);
    const az = azimuth_deg + Math.atan2(b, a) * R2D;
    out.push(destination(lat_deg, lon_deg, az, r));
  }
  return out;
}
