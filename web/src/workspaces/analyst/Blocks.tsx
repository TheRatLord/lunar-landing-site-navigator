import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { toMs, type TurnCitation, type TurnDigestRow, type TurnIssue } from "../../api/types";
import { citationToken, type AnswerMark, type Block, type ErrorBlock, type GuardBlock, type InboxBlock, type NoteBlock, type SignoffBlock, type SystemBlock, type TextBlock, type ToolBlock, type TurnEndBlock, type UserBlock } from "../../agent/reduce";
import { citationTarget, SOURCE_LABEL } from "../../agent/citations";
import { formatBytes, formatCost, formatMs, formatToolInput, formatToolResult, formatTokens, parseToolResultMeta, shortHash, shortToolName, turnStatusLabel, type ToolResultMeta } from "../../agent/format";
import { CodeBlock } from "../../components/content/CodeBlock";
import { Markdown } from "../../components/content/Markdown";
import { classifyLimits } from "../../agent/limits";
import { AddToCompare } from "../../ask/AddToCompare";
import { splitContext } from "../../ask/contextBlock";
import { sitesOfToolCall, siteFromDigest, type SiteFact } from "../../ask/siteFacts";
import { parseResult } from "../../agent/rows";
import { AnswerLimits, Ids } from "./AttachedLimits";
import { Chip, type ChipTone } from "./Chip";
import { Disclosure } from "../../components/ui/Disclosure";
import { Icon, type IconName } from "../../components/ui/Icon";
import { Spinner } from "../../components/ui/Progress";
import { formatUtc } from "../../lib/time";

export interface BlockActions {
  onOpenLedger: (ledgerId: string, row?: string | null) => void;
  onOpenAssumption: (id: string) => void;
  onOpenArtifact: (id: string) => void;
  onOpenInstructions: () => void;
  onOpenInbox: (name: string) => void;
  onAddToCompare?: (facts: readonly SiteFact[]) => void;
}

function Time({ ts }: { ts: Block["ts"] }) {
  const ms = toMs(ts);
  if (ms === undefined) return null;
  return (
    <time className="ev-time num" dateTime={new Date(ms).toISOString()} title={formatUtc(ms)}>
      {formatUtc(ms).slice(11, 19)}Z
    </time>
  );
}

function UserCard({ b }: { b: UserBlock }) {
  const { question, context } = splitContext(b.text);
  return (
    <article className="ev ev-user" aria-label="Your prompt">
      <header className="ev-head">
        <span className="ev-who">You</span>
        <span className="faint num">Turn {b.turn}</span>
        <Time ts={b.ts} />
      </header>
      <p className="ev-user-text">{question}</p>
      {context && (
        <Disclosure title="Context">
          <pre className="ev-user-text ev-pre">{context}</pre>
        </Disclosure>
      )}
    </article>
  );
}

const ANSWER_TAG: Record<AnswerMark["kind"], { tone: ChipTone; icon: IconName; label: string; sr: string }> = {
  final: { tone: "pass", icon: "check", label: "Final", sr: "Final answer. It passed the answer check" },
  unverified: { tone: "marginal", icon: "warn", label: "Unverified", sr: "Not verified. The answer check found issues in it" },
  withheld: { tone: "fail", icon: "cross", label: "Withheld", sr: "Withheld. The answer check could not run" },
};

function AssistantText({ b, mark, sources, outstanding, actions }: { b: TextBlock; mark: AnswerMark | undefined; sources: ReadonlyMap<string, TurnCitation> | undefined; outstanding: readonly TurnIssue[] | undefined; actions: BlockActions }) {
  const tag = mark ? ANSWER_TAG[mark.kind] : null;
  const onCite = useCallback((id: string, row: string | null) => openCitation(id, row, sources?.get(citationToken({ id, row }))?.kinds, actions), [actions, sources]);
  const citeKind = useMemo(
    () => (sources ? (id: string, row: string | null) => { const c = sources.get(citationToken({ id, row })); return c?.kinds?.length ? { kinds: c.kinds, label: kindsLabel(c.kinds) } : undefined; } : undefined),
    [sources],
  );
  return (
    <article className={`ev ev-text ${mark ? `ev-answer-${mark.kind}` : ""}`} aria-label={mark?.kind === "unverified" ? "Assistant answer, not verified" : mark?.kind === "final" ? "Assistant final answer" : "Assistant response"} aria-busy={b.streaming}>
      <header className="ev-head">
        <span className="ev-who">Assistant</span>
        {b.streaming && (
          <Chip tone="live" busy>
            Streaming
          </Chip>
        )}
        {tag && (
          <Chip tone={tag.tone} icon={tag.icon} className="chip-verdict">
            {tag.label}
            <span className="sr-only">: {tag.sr}</span>
          </Chip>
        )}
        <Time ts={b.ts} />
      </header>
      {outstanding && outstanding.length > 0 && (
        <div className="ev-outstanding" data-testid="outstanding-issues">
          <p className="ev-sub">
            Issues <span className="num">{outstanding.length}</span>
          </p>
          <IssueList issues={outstanding} />
        </div>
      )}
      <Markdown source={b.text} onCite={onCite} citeKind={citeKind} />
      {b.streaming && <span className="ev-caret" aria-hidden />}
    </article>
  );
}

const kindsLabel = (kinds: readonly string[]) => kinds.map((k) => SOURCE_LABEL[k as keyof typeof SOURCE_LABEL] ?? k).join(" + ");

function openCitation(id: string, row: string | null, kinds: readonly string[] | undefined, actions: BlockActions) {
  const target = citationTarget(id);
  if (target === "ledger") actions.onOpenLedger(id, row);
  else if (target === "assumption") actions.onOpenAssumption(id);
  else if (target === "artifact") actions.onOpenArtifact(id);
  else if (kinds?.includes("document") || id[0] === "D") actions.onOpenInbox("");
}

function Reasoning({ b }: { b: TextBlock }) {
  const [open, setOpen] = useState(false);
  const preview = b.text.replace(/\s+/g, " ").slice(0, 110);
  return (
    <article className="ev ev-reasoning" aria-label="Reasoning">
      <button type="button" className="ev-row" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {b.streaming ? <Spinner size={12} /> : <Icon name="chevronRight" size={12} className="ev-chevron" />}
        <span className="ev-who">Reasoning</span>
        <span className="ev-headline">{open ? "" : preview}</span>
        <span className="grow" />
        <span className="faint num">{b.text.length.toLocaleString("en-US")}</span>
      </button>
      {open && (
        <div className="ev-reasoning-body">
          <Markdown source={b.text} />
        </div>
      )}
    </article>
  );
}

function ToolState({ tool }: { tool: ToolBlock }) {
  if (tool.denial) return <span className="ev-state ev-st-denied"><Icon name="shield" size={13} /><span className="sr-only">Denied</span></span>;
  if (!tool.result) return <span className="ev-state ev-st-run"><Spinner size={12} /><span className="sr-only">Running</span></span>;
  if (tool.result.isError) return <span className="ev-state ev-st-error"><Icon name="cross" size={13} /><span className="sr-only">Error</span></span>;
  return <span className="ev-state ev-st-ok"><Icon name="check" size={13} /><span className="sr-only">Done</span></span>;
}

function Alert({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className="ev-denied" role="alert">
      <Icon name={icon} size={14} />
      <div>{children}</div>
    </div>
  );
}

function ToolAlerts({ meta }: { meta: ToolResultMeta }) {
  return (
    <>
      {meta.invariantViolations.length > 0 && (
        <Alert icon="cross">
          <strong>Invalid result</strong>
          <ul>
            {meta.invariantViolations.map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
        </Alert>
      )}
      {meta.refusals.length > 0 && (
        <Alert icon="shield">
          <strong>Refused</strong>
          <ul>
            {meta.refusals.map((r, i) => (
              <li key={i}>
                <code>{r.code}</code> {r.message}
              </li>
            ))}
          </ul>
        </Alert>
      )}
    </>
  );
}

function MetaList({ title, items }: { title: string; items: ReactNode[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <p className="ev-sub">{title}</p>
      <ul className="ev-meta-list">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function ToolDetails({ meta, actions }: { meta: ToolResultMeta; actions: BlockActions }) {
  return (
    <div className="ev-meta">
      <MetaList title="Warnings" items={meta.warnings} />
      <MetaList title="Caveats" items={meta.limits.map((l) => <><code>{l.id}</code> {l.title || l.text}</>)} />
      {meta.dependsOn.length > 0 && (
        <section>
          <p className="ev-sub">Assumptions</p>
          <p className="ev-meta-line">
            <Ids ids={meta.dependsOn} onOpen={actions.onOpenAssumption} />
          </p>
        </section>
      )}
      <MetaList title="Files" items={meta.resultFiles.map((f) => <code>{f}</code>)} />
    </div>
  );
}

function ToolCard({ b, actions }: { b: ToolBlock; actions: BlockActions }) {
  const failed = Boolean(b.denial) || b.result?.isError === true;
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? failed;
  const input = formatToolInput(b.name, b.input);
  const result = b.result ? formatToolResult(b.result.content) : null;
  const meta = b.result ? parseToolResultMeta(b.result.content) : null;
  const sites = useMemo(() => sitesOfToolCall(b.input, b.result && !b.result.truncated && !b.result.isError ? parseResult(b.result.content) : null), [b.input, b.result]);
  const invalid = (meta?.invariantViolations.length ?? 0) > 0;
  const t0 = toMs(b.ts);
  const t1 = b.result ? toMs(b.result.ts) : undefined;
  const duration = t0 !== undefined && t1 !== undefined ? formatMs(t1 - t0) : null;
  const kind = b.toolKind ?? (b.name.startsWith("mcp__") ? "engine" : "builtin");

  return (
    <article className={`ev ev-tool ${b.denial ? "is-denied" : failed ? "is-error" : ""}`} aria-label={`Tool call ${shortToolName(b.name)}`}>
      <button type="button" className="ev-row ev-tool-head" aria-expanded={expanded} onClick={() => setOpen(!expanded)}>
        <ToolState tool={b} />
        <span className="ev-tool-name">{shortToolName(b.name)}</span>
        <span className="ev-headline">{input.headline}</span>
        <span className="grow" />
        {invalid && <Chip tone="fail">Invalid</Chip>}
        {(meta?.refusals.length ?? 0) > 0 && <Chip tone="fail">Refused</Chip>}
        {duration && <span className="faint num">{duration}</span>}
        <Icon name="chevronRight" size={12} className="ev-chevron" />
      </button>
      {b.denial && (
        <Alert icon="shield">
          <strong>Permission denied</strong> <code>{b.denial.rule}</code>
          <div>{b.denial.reason}</div>
        </Alert>
      )}
      {meta && <ToolAlerts meta={meta} />}
      {expanded && (
        <div className="ev-tool-body">
          <div className="ev-result-meta">
            <Chip>{kind}</Chip>
            {b.readOnly === false && b.toolKind === "engine" && <Chip tone="marginal">Writes</Chip>}
            {result && <Chip>{result.json ? "JSON as received" : "Output"}</Chip>}
            {b.result?.truncated && <Chip tone="marginal">Clipped</Chip>}
            {b.result?.sha256 && (
              <code className="faint" title={b.result.sha256}>
                {shortHash(b.result.sha256)}
              </code>
            )}
            <span className="grow" />
            {sites.length > 0 && <AddToCompare facts={sites} onAdd={actions.onAddToCompare} />}
            {b.result?.ledgerId && (
              <button type="button" className="ev-link" onClick={() => actions.onOpenLedger(b.result!.ledgerId!)}>
                <Icon name="link" size={12} /> {b.result.ledgerId}
              </button>
            )}
          </div>
          {input.parts.map((p, i) => (
            <CodeBlock key={i} code={p.code} language={p.language} label={p.label} />
          ))}
          {result && (
            <>
              {meta && <ToolDetails meta={meta} actions={actions} />}
              <CodeBlock code={result.text} language={result.language} label={b.result?.isError ? "error output" : "output"} collapseAfter={16} />
            </>
          )}
        </div>
      )}
    </article>
  );
}

function Note({ b, actions }: { b: NoteBlock; actions: BlockActions }) {
  if (b.kind === "assumption") {
    const e = b.event as Extract<NoteBlock["event"], { assumption_id: string }>;
    return (
      <article className="ev ev-note">
        <Icon name="list" size={13} />
        <code className="ev-id">{e.assumption_id}</code>
        {e.needs_signoff && (
          <Chip tone="marginal" icon="warn">
            Needs sign-off
          </Chip>
        )}
        <button type="button" className="ev-link ev-note-text" onClick={() => actions.onOpenAssumption(e.assumption_id)}>
          {e.statement}
        </button>
      </article>
    );
  }
  const e = b.event as Extract<NoteBlock["event"], { artifact_id: string }>;
  return (
    <article className="ev ev-note">
      <Icon name={e.kind === "figure" ? "image" : e.kind === "script" ? "code" : "file"} size={13} />
      <code className="ev-id">{e.artifact_id}</code>
      <button type="button" className="ev-link ev-note-text" onClick={() => actions.onOpenArtifact(e.artifact_id)}>
        {e.path}
      </button>
      <span className="faint num">v{e.version}</span>
    </article>
  );
}

function Signoff({ b, actions }: { b: SignoffBlock; actions: BlockActions }) {
  const e = b.event;
  const accepted = e.decision === "accepted";
  return (
    <article className="ev ev-note" aria-label={`Sign-off of ${e.assumption_id}`}>
      <Icon name={accepted ? "check" : "cross"} size={13} />
      <code className="ev-id">{e.assumption_id}</code>
      <Chip tone={accepted ? "pass" : "fail"}>{accepted ? "Accepted" : "Rejected"}</Chip>
      <button type="button" className="ev-link ev-note-text" onClick={() => actions.onOpenAssumption(e.assumption_id)}>
        {e.who}: {e.note}
      </button>
    </article>
  );
}

const GUARD_TONE: Record<GuardBlock["event"]["status"], { tone: ChipTone; icon: IconName }> = {
  passed: { tone: "pass", icon: "check" },
  flagged: { tone: "marginal", icon: "warn" },
  error: { tone: "fail", icon: "plug" },
};

function IssueList({ issues }: { issues: readonly TurnIssue[] }) {
  return (
    <ul className="ev-guard-issues">
      {issues.map((i, k) => (
        <li key={k} data-issue-kind={i.kind}>
          <code>{i.kind}</code> {i.text}
          {i.line ? <span className="faint"> (line {i.line})</span> : null}
          {i.detail && <div className="dim">{i.detail}</div>}
        </li>
      ))}
    </ul>
  );
}

function Guard({ b }: { b: GuardBlock }) {
  const e = b.event;
  const g = GUARD_TONE[e.status];
  const n = e.issues.length;
  const notes = e.notes ?? [];
  const what = {
    passed: "Answer check passed",
    flagged: `The answer check flagged ${n} issue${n === 1 ? "" : "s"}. The answer was released as written. Treat it as not verified`,
    error: "The answer check could not run. No answer was released, and the turn ended as an error. This is not a finding about the answer",
  }[e.status];
  return (
    <article className={`ev ev-guard ev-guard-${e.status}`} aria-label="Answer check">
      <div className="ev-guard-head">
        <Icon name="shield" size={13} />
        <span className="ev-who">Answer check</span>
        <Chip tone={g.tone} icon={g.icon} className="chip-verdict">
          {e.status === "error" ? "Could not run" : e.status === "flagged" ? `Flagged ${n}` : "Passed"}
        </Chip>
        {e.status !== "error" && <span className="faint num">#{e.attempt}</span>}
      </div>
      {e.detail && <p className="ev-guard-detail">{e.detail}</p>}
      {n > 0 && <IssueList issues={e.issues} />}
      <Disclosure title="Scope">
        <p className="ev-guard-scope" data-testid="guard-scope">
          {what}.
        </p>
        <p className="ev-guard-scope faint">The answer check looks for mechanical mistakes in numbers, signs, units, times, rows and attribution. It does not prove that a sentence is true.</p>
      </Disclosure>
      {notes.length > 0 && (
        <Disclosure title="Not used by the check" count={notes.length}>
          <ul className="ev-guard-notes">
            {notes.map((t, k) => (
              <li key={k}>{t}</li>
            ))}
          </ul>
        </Disclosure>
      )}
    </article>
  );
}

function Inbox({ b, actions }: { b: InboxBlock; actions: BlockActions }) {
  const e = b.event;
  return (
    <article className="ev ev-note" aria-label={`Inbox file ${e.name}`}>
      <Icon name="file" size={13} />
      <button type="button" className="ev-link ev-note-text" onClick={() => actions.onOpenInbox(e.name)}>
        {e.name}
      </button>
      <span className="faint num">{formatBytes(e.size_bytes)}</span>
      <code className="faint" title={e.sha256}>
        {shortHash(e.sha256)}
      </code>
    </article>
  );
}

function ErrorCard({ b }: { b: ErrorBlock }) {
  return (
    <article className="ev ev-error" role="alert">
      <Icon name="cross" size={14} />
      <div>
        <strong>Error</strong> <code>{b.errorKind}</code>
        <div>{b.message}</div>
      </div>
      <Time ts={b.ts} />
    </article>
  );
}

const verdictText = (v: { state: string; limiting?: string | null }) => (v.limiting ? `${v.state} (limiting: ${v.limiting})` : v.state);

function digestVerdict(d: TurnDigestRow): string {
  if (d.verdict) return verdictText(d.verdict);
  if (d.verdicts?.length) return d.verdicts.map((v) => `${v.row ?? "-"} ${verdictText(v)}`).join("; ");
  if (d.states) return Object.entries(d.states).map(([s, n]) => `${n} ${s}`).join(", ");
  return "no verdict";
}

const VERDICT_TONE = /^(pass|marginal|fail)/i;

function DigestList({ rows, actions }: { rows: TurnDigestRow[]; actions: BlockActions }) {
  return (
    <ul className="ev-digest" data-testid="digest-table">
      {rows.map((d) => {
        const verdict = digestVerdict(d);
        const tone = VERDICT_TONE.exec(verdict)?.[1]?.toLowerCase() as ChipTone | undefined;
        return (
          <li key={d.id} data-cited={d.cited ? "yes" : "no"}>
            <div className="ev-digest-head">
              <button type="button" className="ev-link" onClick={() => actions.onOpenLedger(d.id, null)}>
                {d.id}
              </button>
              <span className="faint">{d.tool}</span>
              <span className="grow" />
              <Chip tone={d.cited ? "pass" : "marginal"}>{d.cited ? "Cited" : "Uncited"}</Chip>
            </div>
            {d.scenarios.map((s) => (
              <div key={s.id} className="ev-digest-scn" data-testid="digest-scenario">
                <span className="mono">{s.site ?? s.id}</span>
                {s.landing_utc ? <span className="faint num">{s.landing_utc}</span> : null}
                {s.name ? <span className="faint ev-digest-name">{s.name}</span> : null}
                <AddToCompare facts={[siteFromDigest(s)].filter((f) => f !== null)} onAdd={actions.onAddToCompare} />
              </div>
            ))}
            <div className="ev-digest-foot">
              <Chip tone={tone ?? "default"} {...(tone ? { className: "chip-verdict" } : {})}>{verdict}</Chip>
              {d.limits.map((l) => (
                <code key={l} className="ev-digest-id">
                  {l}
                </code>
              ))}
              {d.assumptions.map((a) => (
                <button key={a.id} type="button" className="ev-link ev-digest-id" title={a.status} onClick={() => actions.onOpenAssumption(a.id)}>
                  {a.id} ({a.status})
                </button>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function HarnessAdded({ b, actions }: { b: TurnEndBlock; actions: BlockActions }) {
  const others = b.citations.filter((c) => c.kinds?.length && !(c.kinds.length === 1 && c.kinds[0] === "engine_result"));
  if (b.digest.length === 0 && others.length === 0 && b.limits.length === 0 && b.assumptions.length === 0) return null;
  return (
    <div className="ev ev-harness" data-testid="harness-added" role="group" aria-label="Added by the harness">
      <Disclosure
        title={
          <>
            Harness
            {b.limits.length > 0 && <Chip>{b.limits.length} {b.limits.length === 1 ? "caveat" : "caveats"}</Chip>}
            {others.length > 0 && <Chip>{others.length} sources</Chip>}
            {b.assumptions.length > 0 && <Chip>{b.assumptions.length} assumptions</Chip>}
          </>
        }
      >
        <div className="ev-harness-body">
          {b.digest.length > 0 && <DigestList rows={b.digest} actions={actions} />}
          {b.limits.length > 0 && <AnswerLimits limits={classifyLimits(b.limits)} onOpenLedger={(id) => actions.onOpenLedger(id)} />}
          {others.length > 0 && (
            <>
              <p className="ev-sub">Sources</p>
              <ul className="ev-harness-list">
                {others.map((c) => (
                  <li key={citationToken(c)} data-source-kinds={c.kinds?.join(" ")}>
                    <button type="button" className="ev-link" onClick={() => openCitation(c.id, c.row, c.kinds, actions)}>
                      {c.id === "U" ? "[U]" : citationToken(c)}
                    </button>{" "}
                    {kindsLabel(c.kinds ?? [])}
                    {c.tool ? <span className="faint"> · {c.tool}</span> : null}
                  </li>
                ))}
              </ul>
            </>
          )}
          {b.assumptions.length > 0 && (
            <>
              <p className="ev-sub">Assumptions</p>
              <ul className="ev-harness-list">
                {b.assumptions.map((a) => (
                  <li key={a.id} data-assumption-status={a.status}>
                    <button type="button" className="ev-link" onClick={() => actions.onOpenAssumption(a.id)}>
                      {a.id}
                    </button>{" "}
                    <Chip tone={a.status === "accepted" ? "pass" : a.status === "rejected" ? "fail" : "marginal"}>{a.status}</Chip> {a.statement}{" "}
                    <span className="ev-meta-line">
                      <Ids ids={a.cited_by} onOpen={actions.onOpenLedger} />
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </Disclosure>
    </div>
  );
}

function TurnEnd({ b }: { b: TurnEndBlock }) {
  const u = b.usage;
  const unverified = b.status === "completed" && b.outstanding.length > 0;
  const tone = b.status === "completed" && !unverified ? "ok" : b.status === "completed" || b.status === "interrupted" ? "warn" : "error";
  return (
    <div className={`ev ev-turnend tone-${tone}`} role="separator" aria-label={`End of turn ${b.turn}`}>
      <span className="ev-turnend-status">
        <Icon name={tone === "ok" ? "check" : tone === "warn" ? "warn" : "cross"} size={12} /> Turn {b.turn} {turnStatusLabel(b.status, b.outstanding.length)}
      </span>
      <span>{formatMs(u.duration_ms ?? undefined)}</span>
      <span>{formatCost(u.cost_usd)}</span>
      <span>{formatTokens(u.input_tokens + u.cache_read_tokens + u.cache_creation_tokens)} in</span>
      <span>{formatTokens(u.output_tokens)} out</span>
      {b.numModelTurns !== undefined && <span>{b.numModelTurns} model {b.numModelTurns === 1 ? "turn" : "turns"}</span>}
      {b.denials > 0 && (
        <span className="ev-turnend-denials">
          <Icon name="shield" size={12} /> {b.denials} denied
        </span>
      )}
    </div>
  );
}

function System({ b, actions }: { b: SystemBlock; actions: BlockActions }) {
  const e = b.event;
  return (
    <div className="ev ev-system">
      <Icon name="info" size={12} />
      {e.type === "run_start" ? (
        <>
          <span>
            {e.resumed_from || b.seq > 0 ? "Resumed" : "Started"} · {e.model} · {e.prompt_version} <code>{shortHash(e.prompt_sha256)}</code>
            {" "}
            · <code title={e.prompt_template_sha256}>{shortHash(e.prompt_template_sha256)}</code>
            {e.sandbox ? ` · sandbox ${e.sandbox.enabled ? "on" : "OFF"}` : ""} · {e.tools.length} tools
          </span>
          <button type="button" className="ev-link" onClick={actions.onOpenInstructions}>
            Instructions
          </button>
        </>
      ) : e.type === "session_init" ? (
        <span>
          Session {e.session_id.slice(0, 8)} · {e.resolved_model ?? "model"}
          {e.cli_version ? ` · CLI ${e.cli_version}` : ""}
        </span>
      ) : (
        <span>
          Ended ({e.status}){e.turns !== undefined ? ` · ${e.turns} turn${e.turns === 1 ? "" : "s"}` : ""}
          {e.usage?.cost_usd != null ? ` · ${formatCost(e.usage.cost_usd)}` : ""}
        </span>
      )}
    </div>
  );
}

export const BlockView = memo(function BlockView({ block, actions, mark, sources, outstanding }: { block: Block; actions: BlockActions; mark?: AnswerMark | undefined; sources?: ReadonlyMap<string, TurnCitation> | undefined; outstanding?: readonly TurnIssue[] | undefined }) {
  switch (block.kind) {
    case "user":
      return <UserCard b={block} />;
    case "text":
      return <AssistantText b={block} mark={mark} sources={sources} outstanding={outstanding} actions={actions} />;
    case "reasoning":
      return <Reasoning b={block} />;
    case "tool":
      return <ToolCard b={block} actions={actions} />;
    case "assumption":
    case "artifact":
      return <Note b={block} actions={actions} />;
    case "signoff":
      return <Signoff b={block} actions={actions} />;
    case "guard":
      return <Guard b={block} />;
    case "inbox":
      return <Inbox b={block} actions={actions} />;
    case "error":
      return <ErrorCard b={block} />;
    case "turn_end":
      return (
        <>
          <HarnessAdded b={block} actions={actions} />
          <TurnEnd b={block} />
        </>
      );
    case "system":
      return <System b={block} actions={actions} />;
  }
});
