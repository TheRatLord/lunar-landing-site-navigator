import { useState } from "react";
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
  count?: { verb: string; total: number };
}

const PREPARING = /^(ephemeris table|utc strings|epochs)$/i;

export function stageText(stage: string | undefined): string {
  if (!stage) return "Running";
  if (PREPARING.test(stage)) return "Preparing";
  const s = stage.replace(/ the scenario for its limits$/i, "").replace(/ scenarios\b/gi, " plans");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function AnalysisStatus({ state, what, count }: AnalysisStatusProps) {
  return (
    <>
      <StatusBody state={state} what={what} count={count} />
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

function StatusBody({ state, what, count }: AnalysisStatusProps) {
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
        {(q.waited || q.reason || q.ahead) && (
          <Popover iconOnly label="Queue" icon="clock">
            <div className="an-detail">
              {q.waited && <p className="num">{q.waited}</p>}
              {q.reason && <p>{q.reason}</p>}
              {q.ahead && <p>{q.ahead}</p>}
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
        <span className="an-stage">{count ? `${count.verb} ${Math.round(clamp(state.progress ?? 0, 0, 1) * count.total)} of ${count.total}` : stageText(state.stage)}</span>
        <span className="an-bar">
          <ProgressBar value={state.progress} label={`Progress of ${what}`} />
        </span>
        {pct !== null && !count && <span className="num an-pct">{pct}%</span>}
        <IconButton icon="close" label="Cancel" size="sm" onClick={state.cancel} />
        {state.stale && <Stale />}
      </div>
    );
  }
  if (state.stale) return <OutOfDate state={state} />;
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
