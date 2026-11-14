import type { Legend } from "../../api/terrain";

interface LegendTick {
  pos: number;
  label: string;
}

export interface LegendModel {
  gradient: string | null;
  ticks: LegendTick[];
  units: string;
  min: number | null;
  max: number | null;
}

function fmt(v: number): string {
  const a = Math.abs(v);
  const s = a >= 100 || Number.isInteger(v) ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
  return s.replace("-", "−");
}

function thinTicks(ticks: LegendTick[]): LegendTick[] {
  const CHAR = 0.022;
  const gap = (a: LegendTick, b: LegendTick) => ((a.label.length + b.label.length) / 2) * CHAR + 0.015;
  const kept: LegendTick[] = [];
  for (const t of ticks) {
    const prev = kept[kept.length - 1];
    if (prev && t.pos - prev.pos < gap(prev, t)) {
      if (t !== ticks[ticks.length - 1]) continue;
      kept.pop();
    }
    kept.push(t);
  }
  return kept;
}

export function legendModel(l: Legend): LegendModel {
  const stops = l.stops && l.stops.length >= 2 ? [...l.stops].sort((a, b) => a.value - b.value) : null;
  const min = l.min ?? stops?.[0]?.value ?? null;
  const max = l.max ?? stops?.[stops.length - 1]?.value ?? null;
  const span = min !== null && max !== null && max > min ? max - min : null;
  const at = (v: number): number => (span ? Math.min(1, Math.max(0, (v - min!) / span)) : 0);

  if (l.type === "ramp" && stops && span) {
    const gradient = `linear-gradient(to right, ${stops.map((s) => `${s.color} ${(at(s.value) * 100).toFixed(2)}%`).join(", ")})`;
    return { gradient, ticks: thinTicks(stops.map((s) => ({ pos: at(s.value), label: fmt(s.value) }))), units: l.units, min, max };
  }
  if (l.type === "greyscale" && span) {
    return {
      gradient: "linear-gradient(to right, #000000, #ffffff)",
      ticks: [
        { pos: 0, label: fmt(min!) },
        { pos: 1, label: fmt(max!) },
      ],
      units: l.units,
      min,
      max,
    };
  }
  return { gradient: null, ticks: [], units: l.units, min, max };
}
