import { useEffect, useMemo, useRef, useState } from "react";
import { assumptionApi, inboxApi, type AssumptionList, type InboxList } from "../agent/api";
import { formatCost, isActiveState, spendSummary } from "../agent/format";
import { classifyLimits } from "../agent/limits";
import { currentRunStart, isRunning } from "../agent/reduce";
import { summariseAssumptions } from "../agent/signoff";
import { useRuns, useServiceInstructions } from "../agent/useRuns";
import { useRunStream, type RunConnection } from "../agent/useRunStream";
import { agentApi } from "../api/endpoints";
import type { ArtifactRecord, LedgerEntry, LedgerList } from "../api/types";
import { ServiceNotice } from "../components/ServiceNotice";
import { Button, IconButton } from "../components/ui/Button";
import { Segmented } from "../components/ui/Segmented";
import { Toolstrip } from "../components/ui/Toolstrip";
import { Tabs, type TabItem } from "../components/ui/Panel";
import { ProgressBar, Spinner } from "../components/ui/Progress";
import { ActivityStream } from "../workspaces/analyst/ActivityStream";
import { AssumptionsPanel } from "../workspaces/analyst/AssumptionsPanel";
import type { BlockActions } from "../workspaces/analyst/Blocks";
import { Chip } from "../workspaces/analyst/Chip";
import { Composer } from "../workspaces/analyst/Composer";
import { InboxPanel } from "../workspaces/analyst/InboxPanel";
import { InstructionsPanel } from "../workspaces/analyst/InstructionsPanel";
import { ArtefactsPanel, ProvenancePanel } from "../workspaces/analyst/LedgerPanels";
import { RunList, RunMenu, RunStateChips, ThreadTitle } from "../workspaces/analyst/RunList";
import { useLedger } from "../workspaces/analyst/useLedger";
import { ASK_BUTTON_ID, useAsk, type DetailTab } from "./askStore";
import { FollowUp } from "./FollowUp";
import { useAlternatives } from "../scenario/alternatives";
import { useScenario } from "../scenario/store";
import { toast } from "../state/toasts";
import { delayLabels } from "../workspaces/compare/delays";
import { useCompareOptions } from "../workspaces/compare/options";
import { planCompareAdd, type SiteFact } from "./siteFacts";

const NEW_RUN = "";

function addToCompare(facts: readonly SiteFact[]): void {
  const doc = useScenario.getState().doc;
  const alt = useAlternatives.getState();
  const opts = useCompareOptions.getState();
  const plan = planCompareAdd(facts, doc ? { lat_deg: doc.site.lat_deg, lon_deg: doc.site.lon_deg, landing_utc: doc.landing_utc } : null, alt.items, opts.slips_h);
  for (const c of plan.sites) alt.add(c);
  for (const h of plan.slips_h) opts.addSlip(h);

  const parts: string[] = [];
  if (plan.sites.length > 0) parts.push(plan.sites.map((s) => s.name).join(", "));
  if (plan.slips_h.length > 0) parts.push(`delay ${delayLabels(plan.slips_h).join(", ")} against the plan's landing time`);
  if (plan.own > 0) parts.push(plan.own === 1 ? "the plan's own site is already in Compare" : `${plan.own} sites are the plan's own site, already in Compare`);
  if (plan.present > 0) parts.push(plan.present === 1 ? "one site was already added" : `${plan.present} sites were already added`);
  const changed = plan.sites.length + plan.slips_h.length > 0;
  toast({ kind: changed ? "success" : "info", title: changed ? "Added to Compare" : "Nothing new for Compare", detail: parts.join("; ") });
}

function StreamChip({ conn, running }: { conn: RunConnection; running: boolean }) {
  const { stream, state } = conn;
  if (stream.status === "open") {
    return (
      <Chip tone={running ? "live" : "default"} busy={running} className="num">
        #{state.lastSeq}
      </Chip>
    );
  }
  if (stream.status === "connecting") return <Chip busy>Connecting</Chip>;
  if (stream.status === "ended" && state.lastSeq >= 0) return <Chip className="num">#{state.lastSeq}</Chip>;
  return null;
}

function SpendMeter({ cost, cap, turns, detail, reached }: { cost: number | null | undefined; cap: number | null | undefined; turns: number; detail: string; reached: boolean }) {
  const ratio = typeof cap === "number" && cap > 0 ? Math.min(1, (cost ?? 0) / cap) : null;
  return (
    <span className={`ev-spend ${reached ? "is-cap" : ""}`} data-testid="run-spend">
      <span className="num">
        {formatCost(cost)}
        {typeof cap === "number" && <span className="faint"> / {formatCost(cap)}</span>}
      </span>
      {ratio !== null && (
        <span className="ev-spend-bar">
          <ProgressBar value={ratio} label="Spend against the cap" />
        </span>
      )}
      {turns > 0 && <span className="faint num">{turns} turn{turns === 1 ? "" : "s"}</span>}
      <span className="sr-only">{detail}</span>
    </span>
  );
}

export function AskDock() {
  const { open, mode, view, runId, tab } = useAsk();
  const full = mode === "full";
  const runs = useRuns();
  const service = useServiceInstructions();
  const conn = useRunStream(runId);
  const { state, summary, stream } = conn;

  const [focus, setFocus] = useState<{ id: string; n: number; row: string | null } | null>(null);
  const [wide, setWide] = useState(false);
  const [listOpen, setListOpen] = useState(true);
  const [dismissedResume, setDismissedResume] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftKey = runId ?? NEW_RUN;
  const setDraft = (text: string) => setDrafts((d) => ({ ...d, [draftKey]: text }));

  const select = (id: string | null) => {
    setFocus(null);
    useAsk.getState().select(id);
  };

  const heading = useRef<HTMLHeadingElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLElement>(null);
  const Title = full ? "h1" : "h2";
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) (menuButton.current ?? heading.current)?.focus();
    if (!open && wasOpen.current && root.current?.contains(document.activeElement)) document.getElementById(ASK_BUTTON_ID)?.focus();
    wasOpen.current = open;
  }, [open]);

  const actions: BlockActions = useMemo(() => {
    const show = (t: DetailTab, id: string | null, row: string | null = null) => {
      if (id !== null) setFocus((f) => ({ id, row, n: (f?.n ?? 0) + 1 }));
      const ask = useAsk.getState();
      ask.setTab(t);
      if (ask.mode === "dock") ask.setView("details");
    };
    return {
      onOpenLedger: (id, row = null) => show("provenance", id, row),
      onOpenAssumption: (id) => show("assumptions", id),
      onOpenArtifact: (id) => show("artefacts", id),
      onOpenInstructions: () => show("instructions", null),
      onOpenInbox: (name) => show("inbox", name),
      onAddToCompare: addToCompare,
    };
  }, []);

  const running = isRunning(state) || (summary ? isActiveState(summary.state) && state.lastSeq < 0 : false);
  const costUsd = state.totals.costUsd || summary?.cost_usd;
  const spend = spendSummary({ costUsd, budgetUsd: summary?.budget_usd, turnsEnded: state.totals.turns || summary?.turns || 0, running });
  const refreshRuns = runs.refresh;
  useEffect(() => refreshRuns(), [running, state.totals.turns, refreshRuns]);
  const start = currentRunStart(state);
  const resultTexts = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of state.blocks) if (b.kind === "tool" && b.result?.ledgerId && !b.result.truncated) m.set(b.result.ledgerId, b.result.content);
    return m;
  }, [state.blocks]);
  const attached = useMemo(() => classifyLimits(state.blocks.flatMap((b) => (b.kind === "turn_end" ? b.limits : []))), [state.blocks]);
  const ledgerList = useLedger<LedgerList<LedgerEntry>>(runId, state.ledgerRevision, agentApi.ledger);
  const assumptionList = useLedger<AssumptionList>(runId, state.ledgerRevision, assumptionApi.list);
  const inboxList = useLedger<InboxList>(runId, state.ledgerRevision, inboxApi.list);
  const artefactList = useLedger<LedgerList<ArtifactRecord>>(runId, state.ledgerRevision, agentApi.artifacts);

  const awaiting = runId && assumptionList.data ? summariseAssumptions(assumptionList.data.assumptions).pending : null;
  const isRunningNow = runId !== null && running;
  useEffect(() => useAsk.getState().setStatus({ pending: awaiting, running: isRunningNow }), [awaiting, isRunningNow]);

  const count = (n: number | undefined) => (runId && n !== undefined ? <span className="faint num">{n}</span> : null);
  const tabs: TabItem[] = [
    { id: "instructions", label: "Instructions" },
    { id: "assumptions", label: <>Assumptions{count(assumptionList.data?.assumptions.length)}</>, disabled: !runId },
    { id: "inbox", label: <>Inbox{count(inboxList.data?.files.length)}</>, disabled: !runId },
    { id: "provenance", label: <>Provenance{count(ledgerList.data?.entries.length)}</>, disabled: !runId },
    { id: "artefacts", label: <>Artefacts{count(artefactList.data?.entries.length)}</>, disabled: !runId },
  ];
  const activeTab: DetailTab = !runId && tab !== "instructions" ? "instructions" : tab;

  const runNotFound = conn.loadError?.notFound ?? false;
  const showStream = runId !== null && !conn.loadError;
  const resumeBanner = conn.lastResumeSeq !== null && dismissedResume !== conn.recoveries;

  const instructionsView = (() => {
    const ins = start ?? service.instructions;
    if (!ins) {
      return service.error ? <ServiceNotice error={service.error} what="the assistant's instructions" /> : <p className="panel-pad"><Spinner size={12} label="Loading instructions" /></p>;
    }
    return <InstructionsPanel instructions={ins} source={start ? "run" : "service"} current={service.instructions} runBudgetUsd={summary?.budget_usd} />;
  })();


  return (
    <section ref={root} className="ask-dock" id="ask-dock" tabIndex={-1} role={full ? "main" : "complementary"} data-mode={mode} data-view={view} hidden={!open} aria-label="Ask">
      <div className="ask-bar">
        {full && <IconButton icon="list" size="sm" label="Threads" pressed={listOpen} onClick={() => setListOpen((v) => !v)} />}
        <Title ref={heading} tabIndex={-1} className="ask-title">
          <span className="sr-only">Ask: </span>
          {full ? <ThreadTitle runs={runs.runs} selected={runId} /> : <RunMenu data={runs} selected={runId} onSelect={select} buttonRef={menuButton} />}
        </Title>
        <span className="grow" />
        {!full && (
          <Segmented
            label="Show"
            size="sm"
            value={view}
            onChange={(v) => useAsk.getState().setView(v as "conversation" | "details")}
            options={[
              { value: "conversation", label: "Conversation" },
              { value: "details", label: "Details" },
            ]}
          />
        )}
        <Toolstrip>
          {full && <IconButton icon="panelRight" size="sm" label="Widen details" pressed={wide} onClick={() => setWide((v) => !v)} />}
          <IconButton icon={full ? "collapse" : "expand"} size="sm" label={full ? "Dock to the side" : "Expand to full page"} onClick={() => useAsk.getState().setMode(full ? "dock" : "full")} />
          <IconButton icon="close" size="sm" label="Close Ask" shortcut="Alt+A" onClick={() => useAsk.getState().setOpen(false)} />
        </Toolstrip>
      </div>

      <div className={`ask-body ${listOpen ? "" : "list-closed"} ${wide ? "side-wide" : ""}`}>
        <aside className="analyst-list" aria-label="Threads" hidden={!full || !listOpen}>
          <RunList data={runs} selected={runId} onSelect={select} onNew={() => select(null)} />
        </aside>

        <section className="analyst-main" aria-label="Conversation" hidden={!full && view !== "conversation"}>
          {runId && (
            <header className="analyst-head">
              <div className="analyst-head-row">
                <span className="analyst-title mono">{runId}</span>
                <StreamChip conn={conn} running={running} />
              </div>
              {summary && (
                <div className="analyst-head-row">
                  <RunStateChips state={summary.state} status={summary.status} />
                  <span className="mono faint ellipsis">{summary.model}</span>
                  <span className="grow" />
                  <SpendMeter cost={costUsd} cap={summary.budget_usd} turns={state.totals.turns || summary.turns || 0} detail={spend.detail} reached={spend.capReached} />
                </div>
              )}
              {showStream && (stream.status === "reconnecting" || stream.status === "failed" || (resumeBanner && stream.status === "open") || state.runStarts.length > 1) && (
                <div className="analyst-head-row">
                  {stream.status === "reconnecting" && (
                    <Chip tone="marginal" busy role="status" className="num">
                      Reconnecting · {stream.attempt ?? 1}
                    </Chip>
                  )}
                  {stream.status === "failed" && (
                    <>
                      <Chip tone={conn.streamsBusy ? "marginal" : "fail"} icon="plug" role="alert">
                        {conn.streamsBusy ? "Too many streams" : `Stream lost${stream.error ? `: ${stream.error.message}` : ""}`}
                      </Chip>
                      <Button size="sm" icon="refresh" onClick={conn.reload}>
                        Reconnect
                      </Button>
                    </>
                  )}
                  {resumeBanner && stream.status === "open" && (
                    <>
                      <Chip tone="pass" icon="check" role="status" className="num">
                        Resumed after #{conn.lastResumeSeq}
                      </Chip>
                      <IconButton icon="close" size="sm" label="Dismiss" onClick={() => setDismissedResume(conn.recoveries)} />
                    </>
                  )}
                  {state.runStarts.length > 1 && (
                    <Chip icon="info" className="num">
                      Restarted ×{state.runStarts.length - 1}
                    </Chip>
                  )}
                </div>
              )}
            </header>
          )}

          {conn.loadError && runId && (
            <div className="analyst-center">
              <ServiceNotice error={conn.loadError} what={runNotFound ? `thread ${runId}` : "this thread"} onRetry={conn.reload} />
              {runNotFound && (
                <Button onClick={() => select(null)} icon="plus">
                  New thread
                </Button>
              )}
            </div>
          )}

          {!runId && (
            <div className="analyst-center">
              <Composer
                prompt={drafts[NEW_RUN] ?? ""}
                onPrompt={setDraft}
                onStarted={(id) => {
                  select(id);
                  runs.refresh();
                }}
              />
            </div>
          )}

          {showStream && (
            <>
              <ActivityStream blocks={state.blocks} actions={actions} live={running} />
              <FollowUp key={runId} runId={runId} running={running} onSent={conn.follow} costUsd={costUsd} budgetUsd={summary?.budget_usd} text={drafts[runId] ?? ""} onText={setDraft} />
            </>
          )}
        </section>

        <aside className="analyst-side" aria-label="Thread details" hidden={!full && view !== "details"}>
          <div className="side-head">
            <Tabs tabs={tabs} value={activeTab} onChange={(t) => useAsk.getState().setTab(t as DetailTab)} label="Thread details" panels />
          </div>
          <div className="side-body" role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
            {activeTab === "instructions" && instructionsView}
            {runId && activeTab === "assumptions" && <AssumptionsPanel key={runId} runId={runId} revision={state.ledgerRevision} focusId={focus?.id ?? null} onOpenLedger={actions.onOpenLedger} />}
            {runId && activeTab === "inbox" && <InboxPanel key={runId} runId={runId} revision={state.ledgerRevision} focusId={focus?.id ?? null} />}
            {runId && activeTab === "provenance" && (
              <ProvenancePanel key={runId} runId={runId} revision={state.ledgerRevision} focusId={focus?.id ?? null} focusRow={focus?.row ?? null} resultTexts={resultTexts} attached={attached} focusNonce={focus?.n ?? 0} onOpenAssumption={actions.onOpenAssumption} onOpenLedger={actions.onOpenLedger} onAddToCompare={actions.onAddToCompare} />
            )}
            {runId && activeTab === "artefacts" && <ArtefactsPanel key={runId} runId={runId} revision={state.ledgerRevision} focusId={focus?.id ?? null} />}
          </div>
        </aside>
      </div>
    </section>
  );
}
