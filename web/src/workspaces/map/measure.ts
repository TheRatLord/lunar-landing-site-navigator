import { bearing_deg, distance_m } from "../../lib/projection";

export interface LatLon {
  lat_deg: number;
  lon_deg: number;
}

export interface Leg {
  from: LatLon;
  to: LatLon;
  distance_m: number;
  bearing_deg: number;
  cumulative_m: number;
}

export function legs(points: readonly LatLon[]): Leg[] {
  const out: Leg[] = [];
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const d = distance_m(a.lat_deg, a.lon_deg, b.lat_deg, b.lon_deg);
    sum += d;
    out.push({ from: a, to: b, distance_m: d, bearing_deg: bearing_deg(a.lat_deg, a.lon_deg, b.lat_deg, b.lon_deg), cumulative_m: sum });
  }
  return out;
}

export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return "—";
  if (m < 1000) return `${m < 100 ? m.toFixed(1) : m.toFixed(0)} m`;
  const km = m / 1000;
  const s = km < 100 ? km.toFixed(3) : km < 1000 ? km.toFixed(2) : km.toFixed(1);
  const [int, frac] = s.split(".");
  return `${int!.replace(/\B(?=(\d{3})+(?!\d))/g, "\u2009")}${frac ? `.${frac}` : ""} km`;
}

export function formatBearing(deg: number): string {
  return `${deg.toFixed(1)}°`;
}
