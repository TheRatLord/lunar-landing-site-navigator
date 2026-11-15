import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, isAbort } from "../../api/client";
import { agentApi } from "../../api/endpoints";
import { toMs, type ArtifactRecord, type ChainStatus, type LedgerEntry, type LedgerList, type LedgerResult } from "../../api/types";
import { formatBytes, formatMs, languageFor, shortHash } from "../../agent/format";
import { NO_LIMITS, type AttachedLimits } from "../../agent/limits";
import { findCitedRow, hasRowTable, parseResult } from "../../agent/rows";
import { AddToCompare } from "../../ask/AddToCompare";
import { distinctSites, siteFromRow, type SiteFact } from "../../ask/siteFacts";
import { CodeBlock } from "../../components/content/CodeBlock";
import { Markdown } from "../../components/content/Markdown";
import { ServiceNotice } from "../../components/ServiceNotice";
import { EmptyState } from "../../components/ui/EmptyState";
import { Icon, type IconName } from "../../components/ui/Icon";
import { Spinner } from "../../components/ui/Progress";
import { parseCsv } from "../../lib/csv";
import { formatUtc } from "../../lib/time";
import { toast } from "../../state/toasts";
import { Ids, RecordLimits } from "./AttachedLimits";
import { Chip } from "./Chip";
import { useLedger, useScrollWhen, type LedgerData } from "./useLedger";

export interface LedgerPanelProps {
  runId: string;
  revision: number;
  focusId: string | null;
  focusNonce?: number;
}

export function State<D>({ ledger, what, empty, emptyIcon, count, children }: { ledger: LedgerData<D>; what: string; empty: string; emptyIcon: IconName; count: (d: D) => number; children: (data: D) => ReactNode }) {
  if (ledger.error) return <ServiceNotice error={ledger.error} what={what} />;
  if (!ledger.data) return ledger.loading ? <p className="panel-pad"><Spinner size={12} label={`Loading ${what}`} /></p> : <EmptyState icon={emptyIcon} title={empty} />;
  if (count(ledger.data) === 0) return <EmptyState icon={emptyIcon} title={empty} />;
  return <>{children(ledger.data)}</>;
}

export function CopyHash({ value, label, done = `${label} copied` }: { value: string; label: string; done?: string }) {
  return (
    <button
      type="button"
      className="ev-hash"
      title={value}
      aria-label={`${shortHash(value)} (copy ${label})`}
      onClick={() => navigator.clipboard.writeText(value).then(() => toast({ kind: "success", title: done }, 1500))}
    >
      {shortHash(value)}
    </button>
  );
}

export function ChainBanner({ chain, count }: { chain: ChainStatus; count?: number | undefined }) {
  if (chain.ok) {
    return (
      <div className="ev-chain" role="status">
        <Chip tone="pass" icon="check">
          Chain verified{count === undefined ? "" : ` · ${count}`}
        </Chip>
      </div>
    );
  }
  return (
    <div className="ev-chain ev-chain-bad" role="alert">
      <Chip tone="fail" icon="cross">
        Chain broken
      </Chip>
      {chain.problems.length > 0 && (
        <ul>
          {chain.problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const KNOWN_KEYS: Record<string, true> = Object.fromEntries(
  ["ledger_id", "tool", "source", "status", "input", "input_sha256", "output", "output_sha256", "data_versions", "depends_on", "limits", "limit_records", "limit_notes", "files", "result_file", "scenario_id", "provenance", "rows", "output_kind", "values", "calls", "invalid", "error", "duration_ms", "prev", "ts"].map((k) => [k, true as const]),
);

const json = (v: unknown): string => JSON.stringify(v, null, 2) ?? "null";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <p className="ev-sub">{label}</p>
      {children}
    </>
  );
}

function HashList({ label, rows, what }: { label: string; rows: [string, string][]; what: string }) {
  if (rows.length === 0) return null;
  return (
    <Field label={label}>
      <ul className="led-versions">
        {rows.map(([path, hash]) => (
          <li key={path}>
            <code>{path}</code> <CopyHash value={hash} label={what} />
          </li>
        ))}
      </ul>
    </Field>
  );
}

interface RowActions {
  onOpenAssumption: (id: string) => void;
  onOpenLedger: (id: string, row?: string | null) => void;
  onAddToCompare?: (facts: readonly SiteFact[]) => void;
}

type RowFetch = { key: string; state: "ok"; res: LedgerResult } | { key: string; state: "failed"; status: number | null; title?: string; detail?: string };

function CitedRowBlock({ runId, ledgerId, row, output, resultText, resultFile, declared, nonce, onAddToCompare }: { onAddToCompare: RowActions["onAddToCompare"]; runId: string | undefined; ledgerId: string; row: string; output: unknown; resultText: string | undefined; resultFile: string | null; declared: Record<string, string> | undefined; nonce: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const key = `${runId ?? ""}|${ledgerId}|${row}`;
  const [answer, setAnswer] = useState<RowFetch | null>(null);
  useEffect(() => {
    if (!runId) return;
    const ctl = new AbortController();
    agentApi.ledgerResult(runId, ledgerId, row, { signal: ctl.signal }).then(
      (res) => setAnswer({ key, state: "ok", res }),
      (err: unknown) => {
        if (!isAbort(err)) setAnswer(err instanceof ApiError ? { key, state: "failed", status: err.status, title: err.title, ...(err.detail ? { detail: err.detail } : {}) } : { key, state: "failed", status: null });
      },
    );
    return () => ctl.abort();
  }, [runId, ledgerId, row, key]);
  const fetched = answer?.key === key ? answer : null;
  const served = fetched?.state === "ok" ? fetched.res : null;
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" });
  }, [row, nonce, served]);
  const inline = typeof output === "string" ? parseResult(output) : output;
  const streamCopy = parseResult(resultText);
  const hit = findCitedRow(inline, row, declared) ?? findCitedRow(streamCopy, row, declared);
  const haveResult = (inline !== null && inline !== undefined) || streamCopy !== null;
  const tableLocal = hasRowTable(inline, declared) || hasRowTable(streamCopy, declared);
  const refused = fetched?.state === "failed" && fetched.status === 404 && fetched.detail ? fetched : null;
  const rows = served?.row ?? null;
  const ids = served?.row_ids ?? [];
  const siteFacts = distinctSites((rows && rows.length > 0 ? rows : hit ? [hit.item] : []).flatMap((r) => siteFromRow(r) ?? []));
  return (
    <div ref={ref} className="led-cited-row" data-testid="cited-row" role="group" aria-label={`Cited row ${row}`}>
      <p className="ev-sub">
        Row <code>{row}</code>
        {served === null && hit && <span className="faint"> · {hit.path}</span>}
        {served !== null && rows !== null && rows.length > 0 && <span className="faint"> · as served</span>}
      </p>
      <AddToCompare facts={siteFacts} onAdd={onAddToCompare} />
      {served !== null ? (
        rows !== null && rows.length > 0 ? (
          rows.map((r, i) => <CodeBlock key={i} code={json(r)} language="json" label={rows.length > 1 ? `row ${row} (${i + 1}/${rows.length})` : `row ${row}`} collapseAfter={14} />)
        ) : ids.length > 0 ? (
          <p className="ev-fail">
            No row <code>{row}</code>. Rows ({ids.length}): {ids.slice(0, 12).map((x, i) => <span key={x}>{i > 0 ? ", " : ""}<code>{x}</code></span>)}
            {ids.length > 12 ? ", ..." : ""}
          </p>
        ) : (
          <p className="faint">
            No rows declared, so <code>{row}</code> matches nothing
          </p>
        )
      ) : refused ? (
        <>
          <p className="ev-fail" data-testid="cited-row-refused">
            HTTP 404, {refused.title}: {refused.detail}
          </p>
          {hit && <CodeBlock code={json(hit.item)} language="json" label={`row ${row} (inline output at ${hit.path})`} collapseAfter={14} />}
        </>
      ) : hit ? (
        <CodeBlock code={json(hit.item)} language="json" label={`row ${row}`} collapseAfter={14} />
      ) : fetched === null && runId && !haveResult ? (
        <p className="faint" role="status">
          <Spinner size={10} label="Loading row" />
        </p>
      ) : haveResult ? (
        <p className={tableLocal ? "ev-fail" : "faint"}>
          {tableLocal ? <>No per-site row <code>{row}</code></> : <>No rows declared, so <code>{row}</code> matches nothing</>}
        </p>
      ) : (
        <p className="faint">
          Row not available{fetched?.state === "failed" && fetched.status !== null ? ` · HTTP ${fetched.status}` : ""}
          {resultFile ? ` · stored in ${resultFile}` : ""}
        </p>
      )}
    </div>
  );
}

function LedgerRow({ e, focused, nonce, actions, focusRow = null, resultText, runId, attached = NO_LIMITS }: { e: LedgerEntry; attached?: AttachedLimits; runId?: string | undefined; focused: boolean; nonce: number; actions: RowActions; focusRow?: string | null; resultText?: string | undefined }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? focused;
  const ref = useScrollWhen(focused, nonce);
  const ts = toMs(e.ts);
  const failed = e.status === "error" || Boolean(e.error);
  const invalid = e.invalid ?? [];
  const script = e.source === "script";
  const values = Object.entries(e.values ?? {});
  const rest = Object.fromEntries(Object.entries(e).filter(([k]) => !KNOWN_KEYS[k]));
  const hasProvenance = e.provenance !== undefined && e.provenance !== null && !(Array.isArray(e.provenance) && e.provenance.length === 0);
  const deps = e.depends_on ?? [];
  const limits = e.limits ?? [];
  const stored = e as LedgerEntry & { limit_records?: object[] | null; limit_notes?: Record<string, string[]> | null };
  const limitRecords = stored.limit_records ?? [];
  const limitNotes = stored.limit_notes ?? {};
  const files = e.files ?? [];
  const calls = e.calls ?? [];
  return (
    <li ref={ref} className={`led-item ${focused ? "is-focus" : ""} ${failed ? "is-error" : ""}`} id={`ledger-${e.ledger_id}`}>
      <button type="button" className="led-row-btn" aria-expanded={expanded} onClick={() => setOpen(!expanded)}>
        <Icon name={expanded ? "chevronDown" : "chevronRight"} size={12} />
        <span className="led-id">{e.ledger_id}</span>
        <span className="ev-tool-name">{e.tool.replace(/^mcp__.*?__/, "")}</span>
        {script && <Chip>Script</Chip>}
        {e.output_kind && <Chip>{e.output_kind.replace(/_/g, " ")}</Chip>}
        <span className="grow" />
        {failed && <Chip tone="fail">Error</Chip>}
        {invalid.length > 0 && <Chip tone="fail">Invalid</Chip>}
        {e.duration_ms !== undefined && <span className="faint num">{formatMs(e.duration_ms)}</span>}
      </button>
      <div className="led-digests">
        {e.input_sha256 && (
          <span>
            In <CopyHash value={e.input_sha256} label="input digest" />
          </span>
        )}
        {e.output_sha256 ? (
          <span>
            Out <CopyHash value={e.output_sha256} label="output digest" />
          </span>
        ) : (
          <span className="faint">No output digest</span>
        )}
        {ts !== undefined && <span className="faint num">{formatUtc(ts, { seconds: true })}</span>}
      </div>
      {!expanded && (deps.length > 0 || limits.length > 0 || files.length > 0) && (
        <p className="led-glance faint">
          {deps.length > 0 && <span>{deps.join(", ")}</span>}
          {limits.length > 0 && <span>{limits.length} caveat{limits.length === 1 ? "" : "s"}</span>}
          {files.length > 0 && <span>{files.length} file{files.length === 1 ? "" : "s"}</span>}
        </p>
      )}
      {expanded && (
        <div className="led-body">
          {e.error && <p className="ev-fail">{e.error}</p>}
          {focused && focusRow !== null && <CitedRowBlock runId={runId} ledgerId={e.ledger_id} row={focusRow} output={e.output} resultText={resultText} resultFile={e.result_file ?? null} declared={e.rows} nonce={nonce} onAddToCompare={actions.onAddToCompare} />}
          {invalid.length > 0 && (
            <Field label="Failed invariant checks">
              <ul className="led-versions" data-testid="ledger-invalid">
                {invalid.map((m, i) => (
                  <li key={i} className="ev-fail">
                    {m}
                  </li>
                ))}
              </ul>
            </Field>
          )}
          {deps.length > 0 && (
            <Field label="Assumptions">
              <p className="ev-meta-line">
                <Ids ids={deps} onOpen={actions.onOpenAssumption} />
              </p>
            </Field>
          )}
          {limits.length > 0 && (
            <Field label="Caveats">
              <RecordLimits records={limitRecords} ids={limits} notes={limitNotes} attached={attached} onOpenLedger={actions.onOpenLedger} />
            </Field>
          )}
          {e.scenario_id && (
            <p className="faint">
              Plan <code>{e.scenario_id}</code>
            </p>
          )}
          {e.result_file && (
            <p className="faint">
              Result file <code>{e.result_file}</code>
            </p>
          )}
          <HashList label="Files" rows={files.map((f) => [f.path, f.sha256] as [string, string])} what="file digest" />
          <HashList label="Data versions" rows={Object.entries(e.data_versions ?? {})} what="data version" />
          {values.length > 0 && (
            <Field label="Values">
              <ul className="led-versions" data-testid="script-values">
                {values.map(([name, v]) =>
                  typeof v === "string" ? (
                    <li key={name} className="ev-fail">
                      <code>{name}</code>: {v}
                    </li>
                  ) : (
                  <li key={name}>
                    <code>{name}</code> = {typeof v.value === "string" ? v.value : JSON.stringify(v.value)}
                    {v.unit ? ` ${v.unit}` : ""}
                    {(v.inputs?.length ?? 0) > 0 && (
                      <span className="faint">
                        {" "}
                        ←{" "}
                        {v.inputs!.map((id) => (
                          <button key={id} type="button" className="ev-link" onClick={() => (id.startsWith("A") ? actions.onOpenAssumption(id) : actions.onOpenLedger(id))}>
                            {id}
                          </button>
                        ))}
                      </span>
                    )}
                  </li>
                  ),
                )}
              </ul>
            </Field>
          )}
          {calls.length > 0 && (
            <Field label="Calls">
              <ul className="led-versions">
                {calls.map((c, i) => (
                  <li key={i}>
                    <code>{c.fn ?? "?"}</code>
                    {c.seconds !== null && c.seconds !== undefined ? <span className="faint"> {c.seconds} s</span> : null}
                    {c.args_digest ? <> <CopyHash value={c.args_digest} label="argument digest" /></> : null}
                  </li>
                ))}
              </ul>
            </Field>
          )}
          <CodeBlock code={json(e.input)} language="json" label={script ? "script input" : "input"} collapseAfter={10} />
          {e.output !== undefined && e.output !== null && (
            <CodeBlock code={typeof e.output === "string" ? e.output : json(e.output)} language="json" label="output" collapseAfter={10} />
          )}
          {hasProvenance && <CodeBlock code={json(e.provenance)} language="json" label="provenance" collapseAfter={10} />}
          {Object.keys(rest).length > 0 && <CodeBlock code={json(rest)} language="json" label="other fields" collapseAfter={10} />}
          {e.prev && (
            <p className="faint">
              Previous entry <code title={e.prev}>{shortHash(e.prev)}</code>
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function ProvenancePanel({ runId, revision, focusId, focusRow = null, resultTexts, focusNonce = 0, attached = NO_LIMITS, onOpenAssumption, onOpenLedger, onAddToCompare }: LedgerPanelProps & RowActions & { focusRow?: string | null; resultTexts?: ReadonlyMap<string, string>; attached?: AttachedLimits }) {
  const ledger = useLedger<LedgerList<LedgerEntry>>(runId, revision, agentApi.ledger);
  const actions: RowActions = { onOpenAssumption, onOpenLedger, onAddToCompare };
  return (
    <div className="led">
      <State ledger={ledger} what="the provenance ledger" empty="No entries" emptyIcon="table" count={(d) => d.entries.length}>
        {(d) => (
          <>
            <ChainBanner chain={d.chain} count={d.entries.length} />
            {focusId !== null && /^[LS]\d{3,6}$/.test(focusId) && !d.entries.some((e) => e.ledger_id === focusId) && (
              <p className="ev-chain" role="status">
                <Chip tone="marginal" icon="alert">
                  {focusId} is not in the ledger
                </Chip>
              </p>
            )}
            <ul className="led-list">
              {d.entries.map((e) => (
                <LedgerRow key={e.ledger_id} e={e} focused={focusId === e.ledger_id} nonce={focusNonce} actions={actions} focusRow={focusRow} resultText={resultTexts?.get(e.ledger_id)} runId={runId} attached={attached} />
              ))}
            </ul>
          </>
        )}
      </State>
    </div>
  );
}

type Preview = { kind: "image" } | { kind: "markdown" | "code" | "csv"; language?: string } | { kind: "none" };

function previewKind(a: ArtifactRecord): Preview {
  const mime = a.mime ?? "";
  const path = a.path.toLowerCase();
  if (mime.startsWith("image/") && mime !== "image/svg+xml") return { kind: "image" };
  if (/\.(png|jpe?g|webp|gif)$/.test(path)) return { kind: "image" };
  if (mime === "text/markdown" || path.endsWith(".md")) return { kind: "markdown" };
  if (mime === "text/csv" || path.endsWith(".csv")) return { kind: "csv" };
  const language = languageFor(path.includes(".") ? path : mime);
  if (language !== "plaintext" || mime.startsWith("text/")) return { kind: "code", language };
  return { kind: "none" };
}

function ArtifactPreview({ runId, a }: { runId: string; a: ArtifactRecord }) {
  const kind = previewKind(a);
  const url = agentApi.artifactUrl(runId, a.artifact_id, a.version);
  const needsText = kind.kind === "markdown" || kind.kind === "code" || kind.kind === "csv";
  const [text, setText] = useState<{ value: string } | { error: ApiError } | null>(null);

  useEffect(() => {
    if (!needsText) return;
    const ctl = new AbortController();
    agentApi.artifactText(runId, a.artifact_id, a.version, { signal: ctl.signal }).then(
      (value) => setText({ value }),
      (e: unknown) => {
        if (!isAbort(e) && e instanceof ApiError) setText({ error: e });
      },
    );
    return () => ctl.abort();
  }, [runId, a.artifact_id, a.version, needsText]);

  if (kind.kind === "image") return <img className="art-img" src={url} alt={a.description || a.path} />;
  if (kind.kind === "none") return <p className="faint">No preview</p>;
  if (!text) return <p className="faint"><Spinner size={12} label="Loading preview" /></p>;
  if ("error" in text) return <ServiceNotice error={text.error} what={`artefact ${a.artifact_id}`} />;
  if (kind.kind === "markdown") return <Markdown source={text.value} />;
  if (kind.kind === "csv") {
    const rows = parseCsv(text.value);
    const [head, ...body] = rows;
    return (
      <div className="md-table-wrap" tabIndex={0} role="region" aria-label={`${a.path} preview`}>
        <table>
          <thead>
            <tr>{head?.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr>
          </thead>
          <tbody>
            {body.map((r, i) => (
              <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return <CodeBlock code={text.value} language={kind.language} label={a.path} collapseAfter={40} />;
}

function ArtifactRow({ versions, runId, focused }: { versions: ArtifactRecord[]; runId: string; focused: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const expanded = open ?? focused;
  const ref = useScrollWhen(focused);
  const latest = versions[versions.length - 1]!;
  const a = versions.find((v) => v.version === picked) ?? latest;
  const icon = a.kind === "figure" ? "image" : a.kind === "script" ? "code" : "file";
  return (
    <li ref={ref} className={`led-item ${focused ? "is-focus" : ""}`}>
      <button type="button" className="led-row-btn" aria-expanded={expanded} onClick={() => setOpen(!expanded)}>
        <Icon name={expanded ? "chevronDown" : "chevronRight"} size={12} />
        <Icon name={icon} size={13} />
        <span className="led-id">{a.artifact_id}</span>
        <span className="art-path">{a.path}</span>
        <span className="grow" />
        <Chip>{a.kind}</Chip>
        {versions.length === 1 && <span className="faint num">v{a.version}</span>}
      </button>
      {versions.length > 1 && (
        <div className="art-versions" role="group" aria-label={`Versions of ${a.artifact_id}`}>
          {versions.map((v) => (
            <button key={v.version} type="button" className="btn btn-ghost btn-sm art-version" aria-pressed={v.version === a.version} onClick={() => (setPicked(v.version), setOpen(true))}>
              v{v.version}
            </button>
          ))}
        </div>
      )}
      {a.description && <p className="led-desc">{a.description}</p>}
      <div className="led-digests">
        <span>
          <CopyHash value={a.sha256} label="artefact digest" />
        </span>
        <span className="faint num">{formatBytes(a.size_bytes)}</span>
        <span className="grow" />
        <a className="ev-link" href={agentApi.artifactUrl(runId, a.artifact_id, a.version)} download={a.path.split("/").pop()}>
          <Icon name="download" size={12} /> Download
        </a>
      </div>
      {expanded && (
        <div className="led-body">
          <ArtifactPreview key={`${a.artifact_id}@${a.version}`} runId={runId} a={a} />
        </div>
      )}
    </li>
  );
}

export function ArtefactsPanel({ runId, revision, focusId }: LedgerPanelProps) {
  const ledger = useLedger<LedgerList<ArtifactRecord>>(runId, revision, agentApi.artifacts);
  return (
    <div className="led">
      <State ledger={ledger} what="artefacts" empty="No artefacts" emptyIcon="file" count={(d) => d.entries.length}>
        {(d) => (
          <ul className="led-list">
            {[...Map.groupBy(d.entries, (a) => a.artifact_id)].map(([id, versions]) => (
              <ArtifactRow key={id} versions={versions.slice().sort((x, y) => x.version - y.version)} runId={runId} focused={focusId === id} />
            ))}
          </ul>
        )}
      </State>
    </div>
  );
}
