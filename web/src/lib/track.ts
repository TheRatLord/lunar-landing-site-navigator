import type { HorizonProfile, TargetTrack } from "../contract/types";
import { clamp, lowerBound, wrap180, wrap360 } from "./scale";

export function interpTrack(track: TargetTrack, utc_ms: number): { az_deg: number; el_deg: number; ang_radius_deg: number } | null {
  const n = track.utc_ms.length;
  if (n === 0 || utc_ms < track.utc_ms[0]! || utc_ms > track.utc_ms[n - 1]!) return null;
  const j = clamp(lowerBound(track.utc_ms, utc_ms), 1, n - 1);
  const i = n === 1 ? 0 : j - 1;
  const k = n === 1 ? 0 : j;
  const t0 = track.utc_ms[i]!;
  const t1 = track.utc_ms[k]!;
  const u = t1 === t0 ? 0 : (utc_ms - t0) / (t1 - t0);
  const a0 = track.az_deg[i]!;
  const a1 = track.az_deg[k]!;
  return {
    az_deg: wrap360(a0 + wrap180(a1 - a0) * u),
    el_deg: track.el_deg[i]! + (track.el_deg[k]! - track.el_deg[i]!) * u,
    ang_radius_deg: track.ang_radius_deg[i]! + (track.ang_radius_deg[k]! - track.ang_radius_deg[i]!) * u,
  };
}

export const arrMin = (a: ArrayLike<number>) => {
  let m = Infinity;
  for (let i = 0; i < a.length; i++) if (a[i]! < m) m = a[i]!;
  return m;
};
export const arrMax = (a: ArrayLike<number>) => {
  let m = -Infinity;
  for (let i = 0; i < a.length; i++) if (a[i]! > m) m = a[i]!;
  return m;
};

export function elevationExtent(h: HorizonProfile, tracks: TargetTrack[]): [number, number] {
  let lo = arrMin(h.elev_lo_deg);
  let hi = arrMax(h.elev_hi_deg);
  for (const t of tracks) {
    lo = Math.min(lo, arrMin(t.el_deg));
    hi = Math.max(hi, arrMax(t.el_deg));
  }
  lo = Math.max(lo, -12);
  hi = Math.min(hi, 25);
  if (!(hi > lo)) return [lo - 1.5, lo + 1.5];
  const pad = Math.max(0.35, (hi - lo) * 0.12);
  return [lo - pad, hi + pad];
}
