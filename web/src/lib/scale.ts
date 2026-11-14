export type Range = [number, number];

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function zoomDomain(domain: Range, anchor: number, factor: number, limits: Range, minSpan: number): Range {
  const span = domain[1] - domain[0];
  const maxSpan = limits[1] - limits[0];
  const newSpan = clamp(span / factor, Math.min(minSpan, maxSpan), maxSpan);
  const pivot = domain[0] + anchor * span;
  return shiftInto([pivot - anchor * newSpan, pivot + (1 - anchor) * newSpan], limits);
}

export function panDomain(domain: Range, delta: number, limits: Range): Range {
  return shiftInto([domain[0] + delta, domain[1] + delta], limits);
}

function shiftInto(d: Range, limits: Range): Range {
  const span = d[1] - d[0];
  if (span >= limits[1] - limits[0]) return [limits[0], limits[1]];
  if (d[0] < limits[0]) return [limits[0], limits[0] + span];
  if (d[1] > limits[1]) return [limits[1] - span, limits[1]];
  return d;
}

export function niceTicks(lo: number, hi: number, target = 6): number[] {
  if (!(hi > lo)) return [];
  const raw = (hi - lo) / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
  const out: number[] = [];
  const first = Math.ceil(lo / step - 1e-9) * step;
  for (let v = first; v <= hi + step * 1e-9; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
  }
  return out;
}

export function lowerBound(x: ArrayLike<number>, v: number): number {
  let lo = 0;
  let hi = x.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (x[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export const wrap360 = (a: number) => ((a % 360) + 360) % 360;

export const wrap180 = (a: number) => wrap360(a + 180) - 180;
