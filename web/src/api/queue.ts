import type { JobStatus, JobQueue } from "../contract/types";

const AHEAD_SHOWN = 4;

export interface QueueInfo {
  position: number;
  jobClass: "short" | "long" | null;
  waitingFor: "worker" | "long-limit";
  aheadCount: number;
  ahead: JobQueue["ahead"];
}

export function queueInfoFrom(status: JobStatus): QueueInfo | null {
  const q = status.queue;
  if (!q) return null;
  return { position: q.position, jobClass: status.job_class ?? null, waitingFor: q.waiting_for, aheadCount: q.ahead_count, ahead: q.ahead };
}

export interface QueueSummary {
  headline: string;
  reason: string | null;
  ahead: string | null;
  waited: string | null;
}

function ordinal(n: number): string {
  const r = n % 100;
  const suffix = r >= 11 && r <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

export function queueSummary(info: QueueInfo | null, createdMs: number | null): QueueSummary {
  let headline = "Queued";
  let reason: string | null = null;
  let ahead: string | null = null;
  if (info) {
    headline = `Queued: ${ordinal(info.position)} in line${info.jobClass ? ` for ${info.jobClass} jobs` : ""}`;
    reason =
      info.waitingFor === "long-limit"
        ? "Long jobs may not take every worker: one stays free for short analyses."
        : "All workers are busy.";
    const shown = info.ahead.slice(0, AHEAD_SHOWN);
    if (shown.length > 0) {
      const more = Math.max(0, info.aheadCount - shown.length);
      ahead = shown.map((j) => `${j.label || j.kind} (${j.state})`).join(", ") + (more > 0 ? `, +${more} more` : "");
    }
  }
  const waited = createdMs != null && Number.isFinite(createdMs) ? `queued since ${new Date(createdMs).toISOString().slice(11, 19)} UTC` : null;
  return { headline, reason, ahead, waited };
}
