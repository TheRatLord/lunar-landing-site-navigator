import { requirementName } from "../../lib/requirements";
import type { ScanParams, ScanResult } from "../../api/planning";
import { scanBody } from "../../api/planning";
import type { Interval, Verdict } from "../../contract/types";
import { lowerBound } from "../../lib/scale";
import { MS_DAY, MS_HOUR, parseUtc, toIsoUtc } from "../../lib/time";
import type { LandingWindow, RankBy, TotalKey } from "../../scenario/planSearch";
import type { Limit, Scenario } from "../../scenario/types";

export interface VerdictSpan extends Interval {
  verdict: Verdict;
}

export interface BestLanding {
  t_ms: number;
  index: number;
  verdict: Verdict;
}

export interface YearScan {
  spans: VerdictSpan[];
  passFraction: number;
  closing: string | null;
  times: number[];
  verdicts: Array<Verdict | null>;
  limiting: Array<string | null>;
  lunarDays: Interval[];
  result: ScanResult;
}

export function scanParams(startMs: number, endMs: number): ScanParams {
  return { start_utc: toIsoUtc(startMs), end_utc: toIsoUtc(endMs), spacing_s: 3600 };
}

export function yearScanBody(doc: Scenario, params: ScanParams) {
  return scanBody({ ...doc, landing_utc: params.start_utc }, params, "auto");
}

function verdictOf(states: ScanResult["states"], code: number | undefined): Verdict | null {
  for (const v of ["pass", "marginal", "fail"] as const) if (states[v] === code) return v;
  return null;
}

export function requirementLabel(scan: ScanResult, key: string | null): string | null {
  if (!key) return null;
  const limit = (scan.scenario?.constraints as unknown as Record<string, Limit | null | undefined> | undefined)?.[key];
  return requirementName(key, limit?.label);
}

export function adaptScan(scan: ScanResult): YearScan {
  const c = scan.candidates;
  const times: number[] = [];
  const verdicts: Array<Verdict | null> = [];
  const limiting: Array<string | null> = [];
  for (let i = 0; i < c.t_ms.length; i++) {
    const t = c.t_ms[i];
    if (t === null || t === undefined) continue;
    times.push(t);
    verdicts.push(verdictOf(scan.states, c.state[i]));
    limiting.push(c.limiting[i] ?? null);
  }
  const spans: VerdictSpan[] = [];
  const step = scan.spacing_s * 1000;
  for (let i = 0; i < times.length; i++) {
    const v = verdicts[i];
    if (!v) continue;
    const start = times[i]!;
    const end = i + 1 < times.length ? Math.min(times[i + 1]!, start + step) : start + step;
    const last = spans[spans.length - 1];
    if (last && last.verdict === v && last.end_ms >= start) last.end_ms = end;
    else spans.push({ start_ms: start, end_ms: end, verdict: v });
  }
  const top = Object.entries(scan.closing_constraints)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])[0];
  const lunarDays: Interval[] = [];
  for (const l of scan.calendar.lunations) {
    const a = parseUtc(l.start_utc);
    const b = parseUtc(l.end_utc);
    if (a !== null && b !== null) lunarDays.push({ start_ms: a, end_ms: b });
  }
  return {
    spans,
    passFraction: scan.state_fraction?.["pass"] ?? (scan.candidates.n_candidates ? scan.counts.pass / scan.candidates.n_candidates : 0),
    closing: top ? requirementLabel(scan, top[0]) : null,
    times,
    verdicts,
    limiting,
    lunarDays,
    result: scan,
  };
}

export function scanAt(s: YearScan, ms: number): { verdict: Verdict; limiting: string | null } | null {
  const i = Math.min(lowerBound(s.times, ms), s.times.length - 1);
  if (i < 0) return null;
  const j = i > 0 && Math.abs(s.times[i - 1]! - ms) <= Math.abs(s.times[i]! - ms) ? i - 1 : i;
  if (Math.abs(s.times[j]! - ms) > MS_HOUR) return null;
  const v = s.verdicts[j];
  return v ? { verdict: v, limiting: requirementLabel(s.result, s.limiting[j] ?? null) } : null;
}

export function scoreAt(s: YearScan, i: number, rank: RankBy): { score: number | null; tie: number | null } {
  const c = s.result.candidates;
  const column = rank === "margin" ? c.worst_margin : c.totals?.[rank as TotalKey];
  return { score: column?.[i] ?? null, tie: c.totals?.["sunlit_contact_h"]?.[i] ?? null };
}

export function totalsAt(s: YearScan, i: number): Record<TotalKey, number | null> {
  const t = s.result.candidates.totals;
  return { sunlit_h: t?.["sunlit_h"]?.[i] ?? null, contact_h: t?.["contact_h"]?.[i] ?? null, sunlit_contact_h: t?.["sunlit_contact_h"]?.[i] ?? null };
}

export function verdictAt(s: YearScan, i: number): Verdict | null {
  return verdictOf(s.result.states, s.result.candidates.state[i]);
}

export function limitingAt(s: YearScan, i: number): string | null {
  return requirementLabel(s.result, s.result.candidates.limiting[i] ?? null);
}

const keyOf = (v: Verdict, score: number | null, tie: number | null): number => (v === "pass" ? 2e13 : v === "marginal" ? 1e13 : 0) + Math.max(-1e5, Math.min(1e5, score ?? -1e5)) * 1e4 + (tie ?? 0);

export function bestLandings(s: YearScan, rank: RankBy, window: LandingWindow): BestLanding[] {
  const c = s.result.candidates;
  const out: Array<BestLanding & { key: number }> = [];
  for (const day of s.lunarDays) {
    const from = Math.max(day.start_ms, window.first_ms);
    const to = Math.min(day.end_ms, window.last_ms);
    if (to <= from) continue;
    let best: (BestLanding & { key: number }) | null = null;
    for (let i = 0; i < c.t_ms.length; i++) {
      const t = c.t_ms[i];
      if (t === null || t === undefined || t < from || t >= to) continue;
      const v = verdictOf(s.result.states, c.state[i]);
      if (v === null || v === "fail") continue;
      const { score, tie } = scoreAt(s, i, rank);
      const key = keyOf(v, score, tie);
      if (!best || key > best.key) best = { t_ms: t, index: i, verdict: v, key };
    }
    if (best) out.push(best);
  }
  const kept: Array<BestLanding & { key: number }> = [];
  for (const b of out) {
    const last = kept[kept.length - 1];
    if (last && b.t_ms - last.t_ms < 10 * MS_DAY) {
      if (b.key > last.key) kept[kept.length - 1] = b;
    } else kept.push(b);
  }
  return kept.map(({ key: _key, ...b }) => b);
}

export function closestFail(s: YearScan, rank: RankBy, window: LandingWindow): number | null {
  const c = s.result.candidates;
  let best: number | null = null;
  let bestKey = -Infinity;
  for (let i = 0; i < c.t_ms.length; i++) {
    const t = c.t_ms[i];
    if (t === null || t === undefined || t < window.first_ms || t >= window.last_ms) continue;
    const m = c.worst_margin[i];
    const key = (m ?? -1e5) * 1e4 + (scoreAt(s, i, rank).tie ?? 0);
    if (key > bestKey) {
      bestKey = key;
      best = i;
    }
  }
  return best;
}

export function scanIndexAt(s: YearScan, ms: number): number | null {
  const c = s.result.candidates;
  let best: number | null = null;
  for (let i = 0; i < c.t_ms.length; i++) {
    const t = c.t_ms[i];
    if (t === null || t === undefined) continue;
    if (Math.abs(t - ms) <= MS_HOUR / 2 && (best === null || Math.abs(t - ms) < Math.abs(c.t_ms[best]! - ms))) best = i;
  }
  return best;
}
