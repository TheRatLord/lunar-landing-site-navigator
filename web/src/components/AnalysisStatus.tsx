import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { queueSummary } from "../api/queue";
import type { AnalysisControls, AnalysisState } from "../api/useAnalysis";
import { ServiceNotice } from "./ServiceNotice";
import { Button, IconButton } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { Popover } from "./ui/Popover";
import { ProgressBar, Spinner } from "./ui/Progress";
import "../styles/chrome.css";
import { clamp } from "../lib/scale";

export interface AnalysisStatusProps {
  state: Pick<AnalysisState<unknown>, "phase" | "progress" | "stage" | "jobId" | "cached" | "error" | "stale"> &
    Partial<Pick<AnalysisState<unknown>, "jobState" | "queue" | "createdMs" | "cancelNote" | "cancelEffect">> &
    Omit<AnalysisControls, "forceCancel"> &
    Partial<Pick<AnalysisControls, "forceCancel">>;
  what: string;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ago`;
}

/** True once the phase has changed to done during this session; false after any later change away from it. */
function useFinishedHere(phase: AnalysisStatusProps["state"]["phase"]): boolean {
  const [seen, setSeen] = useState(phase);
  const [finished, setFinished] = useState(false);
  if (phase !== seen) {
    setSeen(phase);
    setFinished(phase === "done");
  }
  return finished;
}

function Since() {
  const [at] = useState(() => Date.now());
  const [now, setNow] = useState(at);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="faint num">{ago(now - at)}</span>;
}

export function AnalysisStatus({ state, what }: AnalysisStatusProps) {
  const finishedHere = useFinishedHere(state.phase);
  return (
    <>
      <StatusBody state={state} what={what} finishedHere={finishedHere} />
      {state.cancelNote && state.phase !== "running" && <CancelNote state={state} />}
    </>
  );
}

function CancelNote({ state }: Pick<AnalysisStatusProps, "state">) {
  const [busy, setBusy] = useState(false);
  const detached = state.cancelEffect === "detached";
  return (
    <div className="an-status an-chip an-chip-stale" role="status">
      <Icon name="warn" size={12} />
      <span>{detached ? "Not stopped" : state.cancelNote}</span>
      {detached && <span className="faint">{state.cancelNote}</span>}
      {detached && state.forceCancel && (
        <Button
          size="sm"
          variant="ghost"
          icon="stop"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void state.forceCancel!().finally(() => setBusy(false));
          }}
        >
          Stop for everyone
        </Button>
      )}
    </div>
  );
}

function Stale() {
  return (
    <span className="an-chip an-chip-stale" role="status">
      <Icon name="warn" size={12} />
      Inputs changed
    </span>
  );
}

function StatusBody({ state, what, finishedHere }: AnalysisStatusProps & { finishedHere: boolean }) {
  if (state.phase === "error" && state.error) {
    const err = state.error instanceof ApiError ? state.error : new ApiError({ status: 0, title: "Could not run the analysis", detail: state.error.message });
    return (
      <>
        <ServiceNotice error={err} what={what} onRetry={state.rerun} />
        {state.stale && <OutOfDate state={state} />}
      </>
    );
  }
  if (state.phase === "running" && state.jobState === "queued") {
    const q = queueSummary(state.queue ?? null, state.createdMs ?? null);
    return (
      <div className="an-status" role="status" aria-live="polite">
        <Spinner />
        <span>{q.headline}</span>
        {(q.waited || q.reason || q.ahead || state.jobId) && (
          <Popover iconOnly label="Queue" icon="clock">
            <div className="an-detail">
              {q.waited && <p className="num">{q.waited}</p>}
              {q.reason && <p>{q.reason}</p>}
              {q.ahead && <p>{q.ahead}</p>}
              {state.jobId && <p className="num">job {state.jobId}</p>}
            </div>
          </Popover>
        )}
        <IconButton icon="close" label="Cancel" size="sm" onClick={state.cancel} />
        {state.stale && <Stale />}
      </div>
    );
  }
  if (state.phase === "running") {
    const pct = state.progress === null ? null : Math.round(clamp(state.progress, 0, 1) * 100);
    return (
      <div className="an-status an-running" role="status" aria-live="polite">
        <Spinner />
        <span className="an-stage">{state.stage ?? "Running"}</span>
        <span className="an-bar">
          <ProgressBar value={state.progress} label={`Progress of ${what}`} />
        </span>
        {pct !== null && <span className="num an-pct">{pct}%</span>}
        {state.jobId && <span className="faint num an-job">job {state.jobId}</span>}
        <IconButton icon="close" label="Cancel" size="sm" onClick={state.cancel} />
        {state.stale && <Stale />}
      </div>
    );
  }
  if (state.stale) return <OutOfDate state={state} />;
  if (state.phase === "done") {
    return (
      <div className="an-status" role="status">
        <span className="an-dot an-dot-ok" aria-hidden="true" />
        <span>{state.cached ? "From cache" : "Computed"}</span>
        {finishedHere && <Since />}
        {state.jobId && <span className="faint num an-job">job {state.jobId}</span>}
        <IconButton icon="reset" label="Recompute" size="sm" onClick={state.rerun} />
      </div>
    );
  }
  return null;
}

export function OutOfDate({ state }: Pick<AnalysisStatusProps, "state">) {
  return (
    <div className="an-status an-chip an-chip-stale" role="status">
      <Icon name="warn" size={12} />
      <span>Inputs changed</span>
      <IconButton icon="reset" label="Recompute" size="sm" onClick={state.rerun} />
    </div>
  );
}
