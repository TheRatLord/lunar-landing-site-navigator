import type { ScanParams, ScanResult } from "../../api/planning";
import { scanBody } from "../../api/planning";
import type { Interval, Verdict } from "../../contract/types";
import { lowerBound } from "../../lib/scale";
import { MS_HOUR, parseUtc, toIsoUtc } from "../../lib/time";
import type { LandingWindow, RankBy, TotalKey } from "../../scenario/planSearch";
import type { Limit, Scenario } from "../../scenario/types";
import { SPAN_MS } from "./survey";

export interface VerdictSpan extends Interval {
  verdict: Verdict;
}

export interface BestLanding {
  t_ms: number;
  verdict: Verdict;
  hours: number | null;
  key: number;
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

export function scanParams(startMs: number): ScanParams {
  return { start_utc: toIsoUtc(startMs), end_utc: toIsoUtc(startMs + SPAN_MS), spacing_s: 3600 };
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
  return limit?.label ?? key;
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

export function nextPass(s: YearScan, ms: number): number | null {
  for (let i = lowerBound(s.times, ms + 1); i < s.times.length; i++) if (s.verdicts[i] === "pass") return s.times[i]!;
  return null;
}

const RANK_OF: Record<Verdict, number> = { pass: 2, marginal: 1, fail: 0 };

export function bestLandings(s: YearScan, rank: RankBy, window: LandingWindow | null): BestLanding[] {
  const c = s.result.candidates;
  const tie = c.totals?.["sunlit_contact_h"];
  const column = rank === "margin" ? c.worst_margin : c.totals?.[rank as TotalKey];
  const out: BestLanding[] = [];
  for (const day of s.lunarDays) {
    const from = Math.max(day.start_ms, window?.first_ms ?? -Infinity);
    const to = Math.min(day.end_ms, window ? window.last_ms + 1 : Infinity);
    if (to <= from) continue;
    let best: BestLanding | null = null;
    for (let i = 0; i < c.t_ms.length; i++) {
      const t = c.t_ms[i];
      if (t === null || t === undefined || t < from || t >= to) continue;
      const v = verdictOf(s.result.states, c.state[i]);
      if (v === null || v === "fail") continue;
      const score = Math.max(-1e5, Math.min(1e5, column?.[i] ?? -1e5));
      const key = RANK_OF[v] * 1e12 + score * 1e4 + (tie?.[i] ?? 0);
      if (!best || key > best.key) best = { t_ms: t, verdict: v, hours: tie?.[i] ?? null, key };
    }
    if (best) out.push(best);
  }
  return out;
}
