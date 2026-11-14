import type { Interval } from "../contract/types";

export function intervalsContain(intervals: readonly Interval[], t: number): boolean {
  let lo = 0;
  let hi = intervals.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const iv = intervals[mid]!;
    if (t < iv.start_ms) hi = mid - 1;
    else if (t >= iv.end_ms) lo = mid + 1;
    else return true;
  }
  return false;
}

export function visibleIntervals(intervals: readonly Interval[], t0: number, t1: number): [number, number] {
  let lo = 0;
  let hi = intervals.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (intervals[mid]!.end_ms <= t0) lo = mid + 1;
    else hi = mid;
  }
  const first = lo;
  hi = intervals.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (intervals[mid]!.start_ms <= t1) lo = mid + 1;
    else hi = mid;
  }
  return [first, lo];
}
