import { useEffect, useState } from "react";
import type { JobStatus } from "../../contract/types";
import { formatDuration } from "../../lib/time";
import { Button } from "./Button";
import { clamp } from "../../lib/scale";

export function Spinner({ size = 14, label }: { size?: number; label?: string }) {
  return (
    <span className="spinner" role={label ? "status" : undefined} aria-label={label} style={{ width: size, height: size }} />
  );
}

export interface ProgressBarProps {
  value: number | null;
  label: string;
}

export function ProgressBar({ value, label }: ProgressBarProps) {
  const pct = value === null ? undefined : Math.round(clamp(value, 0, 1) * 100);
  return (
    <div
      className={`progress ${value === null ? "indeterminate" : ""}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <div className="progress-fill" style={value === null ? undefined : { width: `${pct}%` }} />
    </div>
  );
}

export interface JobProgressProps {
  job: JobStatus;
  onCancel?: () => void;
}

export function JobProgress({ job, onCancel }: JobProgressProps) {
  const active = job.state === "queued" || job.state === "running";
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  const elapsed = job.started_ms !== undefined ? nowMs - job.started_ms : undefined;
  return (
    <div className={`job job-${job.state}`}>
      <div className="job-row">
        {active && <Spinner />}
        <span className="job-label">{job.label}</span>
        <span className="grow" />
        <span className="job-state num">
          {job.state === "running" && job.progress !== null ? `${Math.round(job.progress * 100)}%` : job.state}
        </span>
        {active && onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      <ProgressBar value={active ? job.progress : job.state === "done" ? 1 : 0} label={job.label} />
      <div className="job-meta faint">
        <span>{job.stage ?? " "}</span>
        {elapsed !== undefined && <span className="num">{formatDuration(elapsed)} elapsed</span>}
      </div>
    </div>
  );
}
