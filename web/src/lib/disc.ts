import { wrap360 } from "./scale";

export function horizonAt(elev: ArrayLike<number>, az_deg: number): number {
  const n = elev.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return elev[0]!;
  const f = (wrap360(az_deg) / 360) * n;
  const i = Math.floor(f);
  const t = f - i;
  const a = elev[i % n]!;
  const b = elev[(i + 1) % n]!;
  return a + (b - a) * t;
}

export function discFractionAboveHorizon(
  elev: ArrayLike<number>,
  az_deg: number,
  el_deg: number,
  r_deg: number,
  slices = 96,
  samplesPerChord = 48,
): number {
  if (!(r_deg > 0)) return Number.NaN;
  let visible = 0;
  let total = 0;
  for (let s = 0; s < slices; s++) {
    const dy = -r_deg + ((s + 0.5) / slices) * 2 * r_deg;
    const half = Math.sqrt(Math.max(0, r_deg * r_deg - dy * dy));
    const e = el_deg + dy;
    const cosE = Math.max(0.05, Math.cos((e * Math.PI) / 180));
    const azHalf = half / cosE;
    let above = 0;
    for (let k = 0; k < samplesPerChord; k++) {
      const a = az_deg - azHalf + ((k + 0.5) / samplesPerChord) * 2 * azHalf;
      if (horizonAt(elev, a) < e) above++;
    }
    visible += (half * above) / samplesPerChord;
    total += half;
  }
  return total > 0 ? visible / total : Number.NaN;
}
