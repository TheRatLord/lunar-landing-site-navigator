import type { IntervalRow, LineRow } from "../../contract/types";
import { formatNum, formatValue, glue, withUnit } from "../../lib/format";
import { intervalsContain } from "../../lib/intervals";
import { clamp, lowerBound } from "../../lib/scale";
import { formatUtc } from "../../lib/time";

interface LineReading {
  value: number | null;
  lo: number | null;
  hi: number | null;
  range: boolean;
  note: string | null;
  also: Array<{ world: string; value: number }>;
}

const SAMPLE_TOL_MS = 0.5;

export function nearestSample(utc_ms: ArrayLike<number>, t: number): number {
  const n = utc_ms.length;
  if (n === 0 || t < utc_ms[0]! || t > utc_ms[n - 1]!) return -1;
  if (n === 1) return 0;
  const j = clamp(lowerBound(utc_ms, t), 1, n - 1);
  return t - utc_ms[j - 1]! <= utc_ms[j]! - t ? j - 1 : j;
}

export function sampleNote(utc_ms: ArrayLike<number>, i: number, t: number): string | null {
  const at = utc_ms[i]!;
  return Math.abs(at - t) < SAMPLE_TOL_MS ? null : formatUtc(at, { date: Math.floor(at / 86_400_000) !== Math.floor(t / 86_400_000) });
}

function readLine(r: LineRow, t: number): LineReading | null {
  const here = (r.marks ?? []).filter((m) => Math.abs(m.t_ms - t) < SAMPLE_TOL_MS && m.value !== null);
  const mk = here[0];
  if (mk) {
    return {
      value: mk.value,
      lo: null,
      hi: null,
      range: false,
      note: `min · ${mk.world}`,
      also: here.slice(1).map((m) => ({ world: m.world, value: m.value! })),
    };
  }
  const i = nearestSample(r.utc_ms, t);
  if (i < 0) return null;
  return {
    value: r.value[i] ?? null,
    lo: r.lo ? (r.lo[i] ?? null) : null,
    hi: r.hi ? (r.hi[i] ?? null) : null,
    range: r.noNominal === true,
    note: sampleNote(r.utc_ms, i, t),
    also: [],
  };
}

const finite = (x: number | null): x is number => x !== null && Number.isFinite(x);

function bandText(rd: LineReading, d: number): string | null {
  return finite(rd.lo) && finite(rd.hi) ? glue(`${formatNum(rd.lo, d)}–${formatNum(rd.hi, d)}`) : null;
}

export function gutterReadout(r: LineRow, t: number): string {
  const rd = readLine(r, t);
  if (rd === null) return "—";
  if (rd.range) return bandText(rd, r.decimals ?? 2) ?? "—";
  return finite(rd.value) ? formatNum(rd.value, r.decimals ?? 2) : "—";
}

export function gutterNote(r: LineRow, t: number): string | null {
  return readLine(r, t)?.note ?? null;
}

export function describeLine(r: LineRow, t: number): string {
  const rd = readLine(r, t);
  if (rd === null) return "—";
  const d = r.decimals ?? 2;
  const b = bandText(rd, d);
  const also = rd.also.map((a) => ` · ${a.world} ${formatValue(a.value, r.unit, d)}`).join("");
  const from = rd.note === null ? "" : ` · ${rd.note}${also}`;
  if (rd.range) return b === null ? "—" : `${b}${from}`;
  if (!finite(rd.value)) return "—";
  return `${formatValue(rd.value, r.unit, d)}${b === null ? "" : ` [${b}]`}${from}`;
}

export function describeInterval(r: IntervalRow, t: number): string {
  const inBest = intervalsContain(r.best, t);
  const opt = r.optimistic ? intervalsContain(r.optimistic, t) : null;
  const pess = r.pessimistic ? intervalsContain(r.pessimistic, t) : null;
  const parts = [inBest ? "yes" : "no"];
  if (pess !== null || opt !== null) {
    parts.push(`(${pess === null ? "" : `pess ${pess ? "yes" : "no"}`}${pess !== null && opt !== null ? ", " : ""}${opt === null ? "" : `opt ${opt ? "yes" : "no"}`})`);
  }
  const win = r.best.find((iv) => t >= iv.start_ms && t <= iv.end_ms);
  if (win) {
    const open = win.start_open === true || win.end_open === true;
    if (typeof win.duration_h === "number") parts.push(`· ${withUnit(`${open ? "≥ " : ""}${formatNum(win.duration_h, 1)}`, "h")}`);
    else if (open) parts.push("· open");
  }
  return parts.join(" ");
}
