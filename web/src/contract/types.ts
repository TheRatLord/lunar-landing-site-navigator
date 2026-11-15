type NumArray = ArrayLike<number>;

export interface HorizonProfile {
  az_deg: NumArray;
  elev_deg: NumArray;
  elev_lo_deg: NumArray;
  elev_hi_deg: NumArray;
  blocker_dist_m: NumArray;
}

export interface TargetTrack {
  utc_ms: NumArray;
  az_deg: NumArray;
  el_deg: NumArray;
  ang_radius_deg: NumArray;
}

export interface SunlightSeries {
  utc_ms: NumArray;
  fraction: NumArray;
  lo?: NumArray;
  hi?: NumArray;
  eclipse?: NumArray;
}

export interface BandSeries {
  utc_ms: NumArray;
  value: NumArray;
  lo?: NumArray;
  hi?: NumArray;
}

export interface StationMarker {
  id: string;
  label: string;
  az_deg: number;
  el_deg: number;
  in_contact: boolean;
}

export type Verdict = "pass" | "marginal" | "fail";

export type ConstraintCase = "nominal" | "optimistic" | "pessimistic";
export type LimitSide = "min" | "max";

export interface ConstraintVerdict {
  id: string;
  label: string;
  unit: string;
  value: number;
  value_worlds?: Record<ConstraintCase, number | null>;
  margin_worlds?: Record<ConstraintCase, number | null>;
  margin_limits?: Record<ConstraintCase, LimitSide | null>;
  worst_world?: ConstraintCase;
  worst_limit?: LimitSide;
  case_basis?: "horizon" | "heading";
  limit?: number;
  sense?: LimitSide;
  margin: number;
  verdict: Verdict;
  decimals?: number;
  limit_range?: [number, number];
  margin_worst?: number;
  censored?: boolean;
  heading_dependent?: boolean;
  heading_note?: string;
  heading_facts?: { line: string; basis: string | null };
  cause?: string;
}

export interface Interval {
  start_ms: number;
  end_ms: number;
  start_open?: boolean;
  end_open?: boolean;
  duration_h?: number | null;
}

export interface IntervalRow {
  kind: "intervals";
  id: string;
  label: string;
  color: string;
  best: Interval[];
  optimistic?: Interval[];
  pessimistic?: Interval[];
}

export interface LineMark {
  t_ms: number;
  world: string;
  label: string;
  text: string;
  value: number | null;
}

export interface LineRow {
  kind: "line";
  id: string;
  label: string;
  unit: string;
  color: string;
  utc_ms: NumArray;
  value: NumArray;
  lo?: NumArray;
  hi?: NumArray;
  domain?: [number, number];
  threshold?: { value: number; label: string };
  decimals?: number;
  noNominal?: boolean;
  notes?: string[];
  marks?: LineMark[];
}

export type TimelineRow = IntervalRow | LineRow;

export type CountdownKind = "sunset" | "sunrise" | "earthset" | "earthrise";

export interface CrossingEvent {
  kind: CountdownKind;
  best_ms: number;
  earliest_ms: number;
  latest_ms: number;
  earliest_open?: boolean;
  latest_open?: boolean;
  title?: string;
  cause?: string;
}

export interface JobStatus {
  id: string;
  label: string;
  state: "queued" | "running" | "done" | "failed" | "cancelled";
  progress: number | null;
  stage?: string;
  kind?: string;
  created_ms?: number;
  started_ms?: number;
  job_class?: "short" | "long";
  queue?: JobQueue | null;
}

export interface JobQueue {
  position: number;
  waiting_for: "worker" | "long-limit";
  ahead_count: number;
  ahead: { id: string; kind: string; label: string; state: "running" | "queued" }[];
}
