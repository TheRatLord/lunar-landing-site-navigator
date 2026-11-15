import type { OpportunitySlot, Verdict } from "../../contract/types";
import type { ScanResult, ScanWindow } from "../../api/planning";
import { lowerBound } from "../../lib/scale";
import { MS_HOUR, parseUtc } from "../../lib/time";
import type { RankBy, TotalKey } from "../../scenario/planSearch";
import type { Limit } from "../../scenario/types";

export interface Lunation {
  number: number;
  start_ms: number;
}

export function verdictOfCode(states: ScanResult["states"], code: number): Verdict | null {
  for (const v of ["pass", "marginal", "fail"] as const) if (states[v] === code) return v;
  return null;
}

export function constraintLabel(scan: ScanResult, key: string | null): string | undefined {
  if (!key) return undefined;
  const limit = (scan.scenario?.constraints as unknown as Record<string, Limit | null | undefined>)[key];
  return limit?.label ?? key;
}

export function lunationsOf(scan: ScanResult): Lunation[] {
  return scan.calendar.lunations.map((l) => ({ number: l.number, start_ms: parseUtc(l.start_utc) ?? NaN })).filter((l) => Number.isFinite(l.start_ms));
}

export function calendarSlots(scan: ScanResult): OpportunitySlot[] {
  const cal = scan.calendar;
  const bin = cal.bin_h * MS_HOUR;
  const out: OpportunitySlot[] = [];
  cal.lunations.forEach((lun, li) => {
    const startMs = parseUtc(lun.start_utc);
    const states = cal.state[li];
    if (startMs === null || !states) return;
    for (let b = 0; b < states.length; b++) {
      const verdict = verdictOfCode(scan.states, states[b]!);
      if (verdict === null) continue;
      const key = cal.keys[cal.limiting[li]?.[b] ?? -1] ?? null;
      const open = cal.open_fraction[li]?.[b];
      out.push({ utc_ms: startMs + b * bin, verdict, limiting: verdict === "pass" ? undefined : constraintLabel(scan, key), open_fraction: open ?? undefined });
    }
  });
  return out;
}

export function bestCandidateIn(scan: ScanResult, fromMs: number, toMs: number): number {
  const c = scan.candidates;
  let best = -1;
  for (let i = 0; i < c.t_ms.length; i++) {
    const t = c.t_ms[i]!;
    if (t < fromMs || t >= toMs) continue;
    if (best < 0) {
      best = i;
      continue;
    }
    const a = c.state[i]!;
    const b = c.state[best]!;
    if (verdictRank(scan, a) > verdictRank(scan, b) || (a === b && (c.worst_margin[i] ?? -Infinity) > (c.worst_margin[best] ?? -Infinity))) best = i;
  }
  return best;
}

function verdictRank(scan: ScanResult, code: number): number {
  const v = verdictOfCode(scan.states, code);
  return v === "pass" ? 2 : v === "marginal" ? 1 : 0;
}

export function nearestCandidate(scan: ScanResult, ms: number): number {
  const t = scan.candidates.t_ms;
  if (t.length === 0) return -1;
  const lo = Math.min(lowerBound(t as ArrayLike<number>, ms), t.length - 1);
  return lo > 0 && Math.abs(t[lo - 1]! - ms) <= Math.abs(t[lo]! - ms) ? lo - 1 : lo;
}

export interface ClosingRow {
  key: string;
  label: string;
  count: number;
  share: number | null;
}

export function closingRows(scan: ScanResult): ClosingRow[] {
  return Object.entries(scan.closing_constraints)
    .filter(([, n]) => n > 0)
    .map(([key, count]) => ({ key, label: constraintLabel(scan, key) ?? key, count, share: scan.closing_fraction?.[key] ?? null }))
    .sort((a, b) => b.count - a.count);
}

export function windowContaining(windows: readonly ScanWindow[], ms: number): ScanWindow | null {
  return windows.find((w) => (parseUtc(w.start_utc) ?? Infinity) <= ms && ms <= (parseUtc(w.end_utc) ?? -Infinity)) ?? null;
}

export interface BestDate {
  t_ms: number;
  lunation: number;
  state: Verdict;
  totals: Record<TotalKey, number | null>;
  margin: number | null;
  marginUnit: string | null;
}

export function bestDates(scan: ScanResult, rank: RankBy): BestDate[] {
  const c = scan.candidates;
  const t = c.t_ms as ArrayLike<number>;
  const column = rank === "margin" ? c.worst_margin : c.totals?.[rank];
  const total = (key: TotalKey, i: number): number | null => c.totals?.[key]?.[i] ?? null;
  const out: Array<BestDate & { key: number }> = [];
  for (const lu of scan.calendar.lunations) {
    const a = parseUtc(lu.start_utc);
    const b = parseUtc(lu.end_utc);
    if (a === null || b === null) continue;
    let best = -1;
    let bestKey = -Infinity;
    for (let i = lowerBound(t, a); i < t.length && t[i]! < b; i++) {
      const v = column?.[i];
      const key = verdictRank(scan, c.state[i]!) * 1e6 + Math.max(-1e5, Math.min(1e5, v ?? -1e5));
      if (key > bestKey) {
        best = i;
        bestKey = key;
      }
    }
    const state = best >= 0 ? verdictOfCode(scan.states, c.state[best]!) : null;
    if (best < 0 || state === null) continue;
    out.push({
      t_ms: t[best]!,
      lunation: lu.number,
      state,
      totals: { sunlit_h: total("sunlit_h", best), contact_h: total("contact_h", best), sunlit_contact_h: total("sunlit_contact_h", best) },
      margin: c.worst_margin_physical[best] ?? null,
      marginUnit: c.margin_unit[best] ?? null,
      key: bestKey,
    });
  }
  return out.sort((x, y) => y.key - x.key);
}
