import { useMemo, type ReactNode } from "react";
import type { Verdict } from "../../contract/types";
import type { ScanResult, ScanWindow, ServiceConstraintVerdict, TerrainMode } from "../../api/planning";
import { evaluateBody, SITE_ENDPOINTS, type EvaluateResult } from "../../api/site";
import { useAnalysis } from "../../api/useAnalysis";
import { Button } from "../../components/ui/Button";
import { Disclosure } from "../../components/ui/Disclosure";
import { EmptyState } from "../../components/ui/EmptyState";
import { Icon } from "../../components/ui/Icon";
import { Popover } from "../../components/ui/Popover";
import { Spinner } from "../../components/ui/Progress";
import { Stat } from "../../components/ui/Stat";
import { VerdictChip } from "../../components/ui/VerdictChip";
import { formatBounds, formatNum, formatSignedValue, formatValue } from "../../lib/format";
import { kindMarginName, kindWord, mixedKindsNote } from "../../lib/marginKind";
import { decimationNote } from "../../lib/seriesMeta";
import { MS_HOUR, roundToSecond, toIsoUtc, utcText } from "../../lib/time";
import { VERDICT_LABEL } from "../../lib/verdict";
import { TOTALS, hoursText, rankLabel, type RankBy } from "../../scenario/planSearch";
import type { Limit, Scenario } from "../../scenario/types";
import { type ClosingRow, bestDates, closingRows, constraintLabel, nearestCandidate, verdictOfCode, windowContaining } from "./adapt";
import { fractionText, headingFacts, offsetText, windowLength, windowMargin } from "./format";

const int = (n: number) => n.toLocaleString("en-US");
const VERDICTS = ["pass", "marginal", "fail"] as const;
const CLOSING_SHOWN = 3;

function ClosingList({ rows }: { rows: ClosingRow[] }) {
  const max = rows[0]?.count ?? 1;
  return (
    <>
      {rows.map((c) => (
        <li key={c.key} className="cal-closing-row">
          <span className="cal-closing-name">{c.label}</span>
          <span className="cal-closing-bar" aria-hidden="true">
            <i style={{ width: `${Math.max(2, (c.count / max) * 100)}%` }} />
          </span>
          <span className="num cal-closing-n">{int(c.count)}</span>
          <span className="num faint cal-closing-pct">{fractionText(c.share)}</span>
        </li>
      ))}
    </>
  );
}

export function ScanStats({ scan }: { scan: ScanResult }) {
  const closing = closingRows(scan);
  const thinned = decimationNote({
    decimated: scan.candidates.decimated,
    n_returned: scan.candidates.n_returned,
    n_total: scan.candidates.n_candidates,
  });
  const rest = closing.length - CLOSING_SHOWN;
  return (
    <section className="cal-stats" aria-label="Scan summary">
      <Stat label="Candidates" value={int(scan.candidates.n_candidates)} />
      {VERDICTS.map((v) => (
        <Stat key={v} label={VERDICT_LABEL[v]} value={int(scan.counts[v])} tone={scan.counts[v] > 0 ? v : "default"} sub={fractionText(scan.state_fraction?.[v])} />
      ))}
      <Stat label="Open windows" value={int(scan.windows.length)} />
      {thinned && (
        <Popover label="Thinned candidates" icon="alert" tone="marginal">
          <p className="cal-pop-text" data-testid="series-thinned">
            {thinned}
          </p>
        </Popover>
      )}
      {scan.counts.fail > 0 && closing.length > 0 && (
        <div className="cal-closing">
          <ol aria-label="Closing requirements">
            <ClosingList rows={closing.slice(0, CLOSING_SHOWN)} />
          </ol>
          {rest > 0 && (
            <Popover label={`+${rest}`} align="end" width={420}>
              <ol className="cal-closing-all" aria-label="Closing requirements">
                <ClosingList rows={closing} />
              </ol>
            </Popover>
          )}
        </div>
      )}
    </section>
  );
}

type KvRow = [ReactNode, ReactNode, "wide"?] | null | false | undefined | "";

function Kv({ rows }: { rows: KvRow[] }) {
  return (
    <dl className="cal-kv">
      {rows.map((r, i) =>
        r ? (
          <div key={i} className={`cal-kv-row ${r[2] === "wide" ? "is-wide" : ""}`}>
            <dt>{r[0]}</dt>
            <dd>{r[1]}</dd>
          </div>
        ) : null,
      )}
    </dl>
  );
}

export function SelectedEpoch({
  scan,
  selectedMs,
  landingMs,
  onSetLanding,
  doc,
  terrain,
  current,
}: {
  scan: ScanResult;
  selectedMs: number | null;
  landingMs: number | null;
  onSetLanding: (ms: number) => void;
  doc: Scenario;
  terrain: TerrainMode;
  current: boolean;
}) {
  const i = selectedMs === null ? -1 : nearestCandidate(scan, selectedMs);
  const c = scan.candidates;
  const t = i >= 0 ? (c.t_ms[i] ?? null) : null;
  const near = t !== null && selectedMs !== null && Math.abs(t - selectedMs) <= scan.calendar.bin_h * MS_HOUR;
  const body = useMemo(() => {
    if (!current || !near || selectedMs === null) return null;
    return evaluateBody(selectedMs === landingMs ? doc : { ...doc, landing_utc: toIsoUtc(roundToSecond(selectedMs)) }, terrain);
  }, [current, near, selectedMs, landingMs, doc, terrain]);
  const ev = useAnalysis<EvaluateResult>(SITE_ENDPOINTS.evaluate, body, { debounceMs: 400 });
  const exact = ev.phase === "done" && !ev.stale ? ev.result : null;
  const verdict = i >= 0 ? verdictOfCode(scan.states, c.state[i]!) : null;

  if (selectedMs === null)
    return (
      <section className="cal-sel" aria-label="Selected candidate">
        <EmptyState icon="calendar" title="Select a slot to inspect it" />
      </section>
    );
  if (!near || t === null || verdict === null)
    return (
      <section className="cal-sel" aria-label="Selected candidate">
        <div className="cal-sel-head">
          <span className="num cal-sel-time">{utcText(selectedMs)}</span>
        </div>
        <EmptyState icon="calendar" title="Not scanned" />
      </section>
    );

  const isLanding = landingMs === selectedMs;
  return (
    <section className="cal-sel" aria-label="Selected candidate">
      <div className="cal-sel-head">
        <span className="num cal-sel-time">{utcText(selectedMs)}</span>
        {exact?.verdict.state === "unknown" ? <span className="faint">Unknown</span> : <VerdictChip verdict={exact ? exact.verdict.state : verdict} compact />}
      </div>
      {isLanding ? (
        <span className="cal-landing" role="status">
          <Icon name="pin" size={12} />
          Plan landing
        </span>
      ) : (
        <Button variant="primary" size="sm" icon="pin" className="cal-set" onClick={() => onSetLanding(selectedMs)}>
          Set as landing
        </Button>
      )}
      {!exact && (
        <div className="cal-sel-source">
          <span>
            Scanned
            {t !== selectedMs && <span className="num"> · {utcText(t)} · {offsetText(t, selectedMs)}</span>}
          </span>
          {ev.phase === "running" && (
            <span className="cal-sel-busy" role="status">
              <Spinner size={12} />
              Evaluating
            </span>
          )}
          {ev.phase === "error" && (
            <span className="cal-bad" role="alert">
              Could not evaluate exactly: {ev.error?.message ?? "no detail"}
            </span>
          )}
        </div>
      )}
      {exact ? <Exact result={exact} /> : <Candidate scan={scan} i={i} verdict={verdict} />}
    </section>
  );
}

function ConstraintRow({ c }: { c: ServiceConstraintVerdict }) {
  const facts = c.heading_dependent ? headingFacts(c) : null;
  const limit = formatBounds(c.limit_min, c.limit_max, c.unit);
  const value = c.value === null || c.value === undefined ? "—" : formatValue(c.value, c.unit, 2);
  return (
    <li className="cal-crow">
      <Disclosure
        title={
          <span className="cal-crow-head">
            <i className={`cal-dot cal-dot-${c.state}`} role="img" aria-label={c.state} />
            <span className="cal-crow-name">{c.label}</span>
            <span className="num cal-crow-val">{c.heading_dependent ? "by heading" : value}</span>
            <span className={`num cal-crow-margin cal-tone-${c.state}`}>{formatSignedValue(c.heading_dependent ? c.margin_worst : c.margin, c.unit)}</span>
          </span>
        }
      >
        <Kv
          rows={[
            limit && ["Threshold", <span className="num">{limit}</span>],
            !c.heading_dependent && ["Nominal margin", <span className="num">{formatSignedValue(c.margin, c.unit)}</span>],
            ["Worst-case margin", <span className="num">{formatSignedValue(c.margin_worst, c.unit)}</span>],
            facts && ["Heading", <span className="num" data-testid="exact-heading-facts">{facts.line}</span>, "wide"],
            facts?.basis && ["Basis", <span data-testid="exact-heading-basis">{facts.basis}</span>, "wide"],
            c.heading_note && ["Note", <span data-testid="exact-heading-note">{c.heading_note}</span>, "wide"],
          ]}
        />
      </Disclosure>
    </li>
  );
}

function Exact({ result }: { result: EvaluateResult }) {
  const limiting = result.verdict.constraints.find((k) => k.key === result.verdict.limiting);
  return (
    <>
      {limiting && result.verdict.state !== "pass" && <Kv rows={[["Limiting", limiting.label]]} />}
      <ul className="cal-crows" aria-label="Requirements">
        {result.verdict.constraints.map((k) => (
          <ConstraintRow key={k.key} c={k} />
        ))}
      </ul>
    </>
  );
}

function Candidate({ scan, i, verdict }: { scan: ScanResult; i: number; verdict: Verdict }) {
  const c = scan.candidates;
  const limiting = constraintLabel(scan, c.limiting[i] ?? null);
  const normalised = c.worst_margin[i];
  const physical = c.worst_margin_physical[i];
  const margin =
    normalised === null || normalised === undefined
      ? null
      : physical === null || physical === undefined
        ? formatSignedValue(normalised, "× margin scale", 2)
        : formatSignedValue(physical, c.margin_unit[i], 2);
  const limits = scan.scenario?.constraints as unknown as Record<string, Limit | null | undefined>;
  return (
    <Kv
      rows={[
        limiting && verdict !== "pass" && ["Limiting", limiting],
        margin !== null && [
          kindMarginName(c.margin_kind?.[i]),
          <span className="cal-kv-inline">
            <span className="num">{margin}</span>
            {c.margin_note?.[i] && (
              <Popover label="Note" icon="info" align="end">
                <p className="cal-pop-text" data-testid="candidate-margin-note">
                  {c.margin_note[i]}
                </p>
              </Popover>
            )}
          </span>,
        ],
        ...TOTALS.map(({ key, label }): [ReactNode, ReactNode] => [`${label} in the stay`, <span className="num">{hoursText(c.totals?.[key]?.[i])}</span>]),
        c.sun_el_deg[i] != null && ["Sun elevation", <span className="num">{formatNum(c.sun_el_deg[i]!, 1)}°</span>],
        c.local_solar_time_h[i] != null && ["Local solar time", <span className="num">{formatValue(c.local_solar_time_h[i]!, "h", 1)}</span>],
        ...Object.entries(c.values).map(([key, col]): [ReactNode, ReactNode] => {
          const v = col[i];
          const l = limits?.[key];
          const lim = formatBounds(l?.min, l?.max, null);
          return [
            l?.label ?? key,
            <span className="cal-kv-inline num">
              {v === null || v === undefined ? "—" : formatValue(v, l?.unit, 2)}
              {lim && <span className="faint">{lim}</span>}
            </span>,
          ];
        }),
      ]}
    />
  );
}

function WindowDetail({ w }: { w: ScanWindow }) {
  const m = windowMargin(w);
  const kind = kindWord(w.best_margin_kind);
  return (
    <Kv
      rows={[
        [
          "Best landing",
          <span className="cal-kv-inline">
            <VerdictChip verdict={w.best_state} compact />
            <span className="num">{utcText(w.best_utc)}</span>
          </span>,
        ],
        ...TOTALS.map(({ key, label }): [ReactNode, ReactNode] => [`${label} in the stay`, <span className="num">{hoursText(w.best_totals?.[key])}</span>]),
        ["Pass", <span className="num">{w.n_pass}/{w.n_candidates}</span>],
        ["Robust", <span className="num">{w.robust.length}</span>],
        [
          "Margin",
          <span className="cal-kv-inline">
            <span className="num">{m.text}</span>
            {kind && <span className="faint">{kind}</span>}
          </span>,
        ],
        ["Candidates", <span className="num">{windowLength(w).detail}</span>],
        w.best_margin_note && ["Note", <span data-testid="window-margin-note">{w.best_margin_note}</span>, "wide"],
      ]}
    />
  );
}

export function BestDates({ scan, rank, selectedMs, onSelect }: { scan: ScanResult; rank: RankBy; selectedMs: number | null; onSelect: (ms: number) => void }) {
  const rows = useMemo(() => bestDates(scan, rank), [scan, rank]);
  return (
    <section className="cal-wins" aria-label="Best landing dates">
      <header className="cal-rail-head">
        <h2 className="cal-rail-title">Best landing in each lunar day</h2>
        <span className="grow" />
        <span className="faint cal-best-rank">by {rankLabel(rank)}</span>
      </header>
      {rows.length === 0 ? (
        <EmptyState icon="calendar" title="No landing dates scanned" />
      ) : (
        <ol className="cal-win-list">
          {rows.map((r, i) => {
            const on = selectedMs === r.t_ms;
            const main = rank === "margin" ? (r.margin === null ? "–" : formatSignedValue(r.margin, r.marginUnit, 1)) : hoursText(r.totals[rank]);
            return (
              <li key={r.lunation} className={on ? "is-on" : undefined}>
                <button type="button" className="cal-win cal-best" aria-pressed={on} aria-label={`Rank ${i + 1}: ${utcText(r.t_ms)}, ${VERDICT_LABEL[r.state]}, ${main}`} onClick={() => onSelect(r.t_ms)}>
                  <i className={`cal-dot cal-dot-${r.state}`} aria-hidden="true" />
                  <span className="num">
                    <span className="faint cal-best-n">{i + 1}</span>
                    {utcText(r.t_ms)}
                  </span>
                  <span className="num faint">{TOTALS.map(({ key, short }) => `${short} ${hoursText(r.totals[key])}`).join(" · ")}</span>
                  <span className="num cal-win-len">{main}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function WindowList({ scan, selectedMs, onSelect }: { scan: ScanResult; selectedMs: number | null; onSelect: (w: ScanWindow) => void }) {
  const current = selectedMs === null ? null : windowContaining(scan.windows, selectedMs);
  const kindsNote = mixedKindsNote(
    scan.windows.map((w) => w.best_margin_kind),
    "windows are listed in the order the engine returned them",
  );
  return (
    <section className="cal-wins" aria-label="Open windows">
      <header className="cal-rail-head">
        <h2 className="cal-rail-title">Open windows</h2>
        <span className="grow" />
        {kindsNote && (
          <Popover label="Mixed margins" icon="alert" tone="marginal" align="end">
            <p className="cal-pop-text" data-testid="windows-kinds-note">
              {kindsNote}
            </p>
          </Popover>
        )}
      </header>
      {scan.windows.length === 0 ? (
        <EmptyState icon="calendar" title="No window passes" />
      ) : (
        <ul className="cal-win-list">
          {scan.windows.map((w) => {
            const on = current !== null && current.start_utc === w.start_utc;
            return (
              <li key={w.start_utc ?? ""} className={on ? "is-on" : undefined}>
                <button type="button" className="cal-win" aria-pressed={on} onClick={() => onSelect(w)}>
                  <i className={`cal-dot cal-dot-${w.best_state}`} aria-hidden="true" />
                  <span className="num">{utcText(w.start_utc)}</span>
                  <span className="num faint">{utcText(w.end_utc)}</span>
                  <span className="num cal-win-len">{windowLength(w).span}</span>
                </button>
                {on && (
                  <div className="cal-win-detail">
                    <WindowDetail w={w} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
