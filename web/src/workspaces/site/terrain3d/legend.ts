import { formatDeg, formatSig, formatValue, withUnit } from "../../../lib/format";
import { R_MOON_M } from "./mesh";

function curvatureDropM(dist_m: number, radius_m = R_MOON_M): number {
  return (dist_m * dist_m) / (2 * radius_m);
}

function curvatureSlopeDeg(dist_m: number, radius_m = R_MOON_M): number {
  return (Math.atan(dist_m / radius_m) * 180) / Math.PI;
}

const cornerDistanceM = (size_m: number): number => (size_m / 2) * Math.SQRT2;

export function heightLegendText(size_m: number, radius_m = R_MOON_M): string {
  const drop = curvatureDropM(cornerDistanceM(size_m), radius_m);
  return `height above the plane that touches the reference sphere at the patch centre; the sphere falls away from that plane by up to ${withUnit(formatSig(drop, 2), "m")} at the corners, so heights above the sphere itself are up to that much higher`;
}

export function slopeLegendText(spacing_m: number, size_m: number, radius_m = R_MOON_M): string {
  const extra = curvatureSlopeDeg(cornerDistanceM(size_m), radius_m);
  return `slope over the ${withUnit(formatSig(spacing_m, 3, { trim: true }), "m")} grid, relative to the plane that touches the reference sphere at the patch centre; sphere curvature adds up to ${formatDeg(extra, 2)} at the corners`;
}

export function directionLabel(name: string, d: { az_deg: number; el_deg: number }): string {
  return `${name} az ${formatDeg(d.az_deg, 1, { azimuth: true })} el ${formatDeg(d.el_deg, 2)}${d.el_deg <= 0 ? " (below horizon)" : ""}`;
}

export function sunLightText(sunEl_deg: number | null, shadowedPct: number, shadowN: number): string {
  if (sunEl_deg === null || !Number.isFinite(sunEl_deg)) return " · no Sun data at this time: ambient light only";
  if (!(sunEl_deg > 0)) return ` · Sun at or below the local horizontal (served elevation ${formatDeg(sunEl_deg, 2)}): ambient light only`;
  return ` · ${formatValue(shadowedPct, "%", 1)} in shadow (test grid ${shadowN}²)`;
}
