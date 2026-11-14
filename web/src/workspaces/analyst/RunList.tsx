import { useState, type RefObject } from "react";
import { toMs, type RunSummary } from "../../api/types";
import { formatCost, isActiveState, runStatusTone, type RunStatusTone } from "../../agent/format";
import type { RunsData } from "../../agent/useRuns";
import { ServiceNotice } from "../../components/ServiceNotice";
import { Button, IconButton } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Icon } from "../../components/ui/Icon";
import { PopoverPanel } from "../../components/ui/Popover";
import { Spinner } from "../../components/ui/Progress";
import { formatUtc } from "../../lib/time";
import { Chip, type ChipTone } from "./Chip";

const STATUS_TONE: Record<RunStatusTone, ChipTone> = { warn: "marginal", error: "fail", cancelled: "default", other: "default" };

export function RunStateChips({ state, status }: { state: string; status?: string | null | undefined }) {
  const active = isActiveState(state);
  const tone = runStatusTone(status);
  return (
    <>
      <Chip tone={active ? "live" : "default"} busy={active}>
        {state}
      </Chip>
      {tone && (
        <Chip tone={STATUS_TONE[tone]} data-testid="run-status">
          {status}
        </Chip>
      )}
    </>
  );
}

const runTitle = (r: Pick<RunSummary, "first_prompt" | "run_id">): string => (r.first_prompt || r.run_id).replace(/\s+/g, " ");

export function ThreadTitle({ runs, selected }: { runs: RunSummary[] | null; selected: string | null }) {
  const current = selected === null ? undefined : runs?.find((r) => r.run_id === selected);
  return <span className="ellipsis">{selected === null ? "New thread" : current ? runTitle(current) : selected}</span>;
}

function RunItem({ run, selected, onSelect }: { run: RunSummary; selected: boolean; onSelect: () => void }) {
  const started = toMs(run.created_at);
  return (
    <li>
      <button type="button" className={`run-item ${selected ? "is-selected" : ""}`} aria-current={selected ? "true" : undefined} onClick={onSelect}>
        <span className="run-prompt">{runTitle(run)}</span>
        <span className="run-meta">
          <RunStateChips state={run.state} status={run.status} />
          <span className="mono dim ellipsis">{run.model}</span>
        </span>
        <span className="run-meta faint num">
          <span className="mono ellipsis" title={run.run_id}>
            {run.run_id}
          </span>
          <span>{formatCost(run.cost_usd)}</span>
          <span>{run.turns ?? 0} turn{run.turns === 1 ? "" : "s"}</span>
          {started !== undefined && <span>{formatUtc(started).slice(5, 16)}Z</span>}
        </span>
      </button>
    </li>
  );
}

function RunItems({ data, selected, onSelect }: { data: RunsData; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <>
      {data.error && <ServiceNotice error={data.error} what="the thread list" onRetry={data.refresh} />}
      {!data.error && data.runs === null && (
        <p className="panel-pad">
          <Spinner size={12} />
        </p>
      )}
      {data.runs?.length === 0 && <EmptyState icon="history" title="No threads yet" />}
      <ul className="runlist-items" aria-label="Threads">
        {data.runs?.map((r) => (
          <RunItem key={r.run_id} run={r} selected={r.run_id === selected} onSelect={() => onSelect(r.run_id)} />
        ))}
      </ul>
    </>
  );
}

export function RunList({ data, selected, onSelect, onNew }: { data: RunsData; selected: string | null; onSelect: (id: string) => void; onNew: () => void }) {
  return (
    <div className="runlist">
      <div className="runlist-actions">
        <Button size="sm" icon="plus" className="grow" onClick={onNew}>
          New thread
        </Button>
        <IconButton icon="refresh" size="sm" label="Refresh threads" onClick={data.refresh} />
      </div>
      <RunItems data={data} selected={selected} onSelect={onSelect} />
    </div>
  );
}

export function RunMenu({ data, selected, onSelect, buttonRef }: { data: RunsData; selected: string | null; onSelect: (id: string | null) => void; buttonRef: RefObject<HTMLButtonElement | null> }) {
  const [open, setOpen] = useState(false);
  const pick = (id: string | null) => {
    setOpen(false);
    buttonRef.current?.focus();
    onSelect(id);
  };
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-ghost btn-sm ask-run-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ThreadTitle runs={data.runs} selected={selected} />
        <Icon name="chevronDown" size={12} />
      </button>
      <PopoverPanel open={open} anchor={buttonRef} onClose={() => setOpen(false)} label="Threads" width={380}>
        <button type="button" className="run-item run-new" aria-current={selected === null ? "true" : undefined} onClick={() => pick(null)}>
          <Icon name="plus" size={14} />
          <span>New thread</span>
        </button>
        <RunItems data={data} selected={selected} onSelect={pick} />
      </PopoverPanel>
    </>
  );
}
