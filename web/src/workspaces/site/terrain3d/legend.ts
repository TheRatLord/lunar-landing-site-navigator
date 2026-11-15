import { formatDeg } from "../../../lib/format";

export function directionLabel(name: string, d: { az_deg: number; el_deg: number }): string {
  return `${name} azimuth ${formatDeg(d.az_deg, 1, { azimuth: true })}, elevation ${formatDeg(d.el_deg, 2)}${d.el_deg <= 0 ? " (below horizon)" : ""}`;
}
