import { MOON_R_M, type Hemisphere } from "../../lib/projection";

const RAD = Math.PI / 180;

export function polarInverse(hemisphere: Hemisphere, xM: number, yM: number): { lat_deg: number; lon_deg: number } {
  const rho = Math.hypot(xM, yM);
  const c = 2 * Math.atan(rho / (2 * MOON_R_M));
  const lon = hemisphere === "south" ? Math.atan2(xM, yM) : Math.atan2(xM, -yM);
  const lat = hemisphere === "south" ? -Math.PI / 2 + c : Math.PI / 2 - c;
  return { lat_deg: lat / RAD, lon_deg: rho === 0 ? 0 : lon / RAD };
}
