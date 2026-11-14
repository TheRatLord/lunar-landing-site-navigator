import { lowerBound } from "./scale";

export function minMaxEnvelope(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  x0: number,
  x1: number,
  buckets: number,
): Float64Array {
  const n = Math.min(x.length, y.length);
  if (n === 0 || x1 < x[0]! || x0 > x[n - 1]!) return new Float64Array(0);
  const i0 = Math.max(0, lowerBound(x, x0) - 1);
  const i1 = Math.min(n, lowerBound(x, x1) + 1);
  if (i0 >= i1) return new Float64Array(0);

  const count = i1 - i0;
  if (count <= buckets * 4) {
    const out = new Float64Array(count * 2);
    for (let i = 0; i < count; i++) {
      out[2 * i] = x[i0 + i]!;
      out[2 * i + 1] = y[i0 + i]!;
    }
    return out;
  }

  const w = (x1 - x0) / buckets;
  const out: number[] = [];
  let b = -1;
  let first = 0;
  let last = 0;
  let iMin = 0;
  let iMax = 0;
  let have = false;

  const flush = () => {
    if (!have) return;
    const idx = Array.from(new Set([first, iMin, iMax, last])).sort((a, c) => a - c);
    for (const k of idx) out.push(x[k]!, y[k]!);
  };

  for (let i = i0; i < i1; i++) {
    const yi = y[i]!;
    if (Number.isNaN(yi)) {
      flush();
      have = false;
      b = -1;
      out.push(x[i]!, NaN);
      continue;
    }
    const bi = Math.floor((x[i]! - x0) / w);
    if (bi !== b || !have) {
      flush();
      b = bi;
      first = last = iMin = iMax = i;
      have = true;
    } else {
      last = i;
      if (yi < y[iMin]!) iMin = i;
      if (yi > y[iMax]!) iMax = i;
    }
  }
  flush();
  return Float64Array.from(out);
}

export function bandEnvelope(
  x: ArrayLike<number>,
  lo: ArrayLike<number>,
  hi: ArrayLike<number>,
  x0: number,
  x1: number,
  buckets: number,
): Float64Array {
  const n = Math.min(x.length, lo.length, hi.length);
  if (n === 0 || x1 < x[0]! || x0 > x[n - 1]!) return new Float64Array(0);
  const i0 = Math.max(0, lowerBound(x, x0) - 1);
  const i1 = Math.min(n, lowerBound(x, x1) + 1);
  if (i0 >= i1) return new Float64Array(0);
  const w = (x1 - x0) / buckets;
  const out: number[] = [];
  let b = Number.NaN;
  let bx = 0;
  let bl = 0;
  let bh = 0;
  for (let i = i0; i < i1; i++) {
    if (Number.isNaN(lo[i]!) || Number.isNaN(hi[i]!)) {
      if (!Number.isNaN(b)) out.push(bx, bl, bh);
      b = Number.NaN;
      out.push(x[i]!, NaN, NaN);
      continue;
    }
    const bi = Math.floor((x[i]! - x0) / w);
    if (bi !== b) {
      if (!Number.isNaN(b)) out.push(bx, bl, bh);
      b = bi;
      bx = x[i]!;
      bl = lo[i]!;
      bh = hi[i]!;
    } else {
      if (lo[i]! < bl) bl = lo[i]!;
      if (hi[i]! > bh) bh = hi[i]!;
    }
  }
  if (!Number.isNaN(b)) out.push(bx, bl, bh);
  return Float64Array.from(out);
}
