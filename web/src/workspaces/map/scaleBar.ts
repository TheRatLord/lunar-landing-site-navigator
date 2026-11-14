export interface ScaleBar {
  meters: number;
  px: number;
  label: string;
}

function formatLength(m: number): string {
  if (m >= 1000) return `${m >= 100_000 ? (m / 1000).toFixed(0) : Number((m / 1000).toPrecision(6))} km`;
  return `${Number(m.toPrecision(6))} m`;
}

export function niceScaleBar(metersPerPx: number, minPx = 70, maxPx = 180): ScaleBar | null {
  if (!(metersPerPx > 0) || !Number.isFinite(metersPerPx)) return null;
  const target = Math.sqrt(minPx * maxPx) * metersPerPx;
  const decade = 10 ** Math.floor(Math.log10(target));
  let best: number | null = null;
  let bestScore = Infinity;
  for (const k of [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50]) {
    const m = k * decade;
    const px = m / metersPerPx;
    if (px < minPx || px > maxPx) continue;
    const score = Math.abs(Math.log(px / Math.sqrt(minPx * maxPx)));
    if (score < bestScore) {
      bestScore = score;
      best = m;
    }
  }
  if (best === null) return null;
  return { meters: best, px: best / metersPerPx, label: formatLength(best) };
}
