export interface BinsRequest {
  heights: Float32Array;
  n: number;
  cell: number;
  bins: number;
  maxDist: number;
}

export function horizonBins({ heights: h, n, cell, bins, maxDist }: BinsRequest): Float32Array {
  const dists: number[] = [];
  for (let d = cell; d <= maxDist; d += Math.max(0.75 * cell, 0.05 * d)) dists.push(d);
  const steps = dists.length;
  const offI = new Float32Array(bins * steps);
  const offJ = new Float32Array(bins * steps);
  const step = (2 * Math.PI) / bins;
  for (let b = 0; b < bins; b++) {
    const az = b * step;
    for (let s = 0; s < steps; s++) {
      offI[b * steps + s] = (Math.sin(az) * dists[s]!) / cell;
      offJ[b * steps + s] = (-Math.cos(az) * dists[s]!) / cell;
    }
  }
  const out = new Float32Array(n * n * bins);
  const lim = n - 1.001;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const h0 = h[k]!;
      for (let b = 0; b < bins; b++) {
        let best = -1;
        for (let s = 0; s < steps; s++) {
          const fi = i + offI[b * steps + s]!;
          const fj = j + offJ[b * steps + s]!;
          if (fi < 0 || fj < 0 || fi > lim || fj > lim) break;
          const ii = fi | 0;
          const jj = fj | 0;
          const u = fi - ii;
          const v = fj - jj;
          const q = jj * n + ii;
          const hh = (h[q]! * (1 - u) + h[q + 1]! * u) * (1 - v) + (h[q + n]! * (1 - u) + h[q + n + 1]! * u) * v;
          const t = (hh - h0) / dists[s]!;
          if (t > best) best = t;
        }
        out[k * bins + b] = (Math.atan(best) * 180) / Math.PI;
      }
    }
  }
  return out;
}
