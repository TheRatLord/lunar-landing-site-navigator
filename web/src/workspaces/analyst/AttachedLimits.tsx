import type { ReactNode } from "react";
import type { LimitNoteJson } from "../../api/site";
import { classifyLimits, type AttachedLimits, type PlainLimit } from "../../agent/limits";
import { splitLimitRefs } from "../../agent/typedInputs";
import { Disclosure } from "../../components/ui/Disclosure";
import { LimitsChip } from "../site/LimitsChip";
import { limitKey } from "../site/adapt";

function LimitText({ text, onOpenLedger }: { text: string; onOpenLedger: (id: string) => void }) {
  return (
    <span className="ev-limit-text">
      {splitLimitRefs(text).map((p, i) =>
        "ledgerId" in p ? (
          <button key={i} type="button" className="ev-link ev-limit-ref" onClick={() => onOpenLedger(p.ledgerId)}>
            {p.ledgerId}
          </button>
        ) : (
          p.text
        ),
      )}
    </span>
  );
}

export function Ids({ ids, onOpen, className = "ev-link" }: { ids: readonly string[]; onOpen: (id: string) => void; className?: string }) {
  return (
    <>
      {ids.map((id) => (
        <button key={id} type="button" className={className} onClick={() => onOpen(id)}>
          {id}
        </button>
      ))}
    </>
  );
}

function PlainGroup({ heading, items, onOpenLedger, lines }: { heading: string; items: readonly PlainLimit[]; onOpenLedger: (id: string) => void; lines?: ReadonlyMap<string, readonly string[]> }) {
  if (items.length === 0) return null;
  return (
    <section className="lim-plain" aria-label={`${heading} (${items.length})`} data-testid="limits-plain">
      <Disclosure title={heading} count={items.length}>
        <ul className="ev-lim-list">
          {items.map((l) => (
            <li key={`${l.id} ${l.text}`} data-limit={l.id}>
              <Disclosure
                title={
                  <>
                    <code>{l.id}</code> {l.title}
                  </>
                }
              >
                {l.text && (
                  <p className="ev-lim-text">
                    <LimitText text={l.text} onOpenLedger={onOpenLedger} />
                  </p>
                )}
                {(lines?.get(l.id) ?? []).map((line) => (
                  <p key={line} className="ev-lim-text">
                    <LimitText text={line} onOpenLedger={onOpenLedger} />
                  </p>
                ))}
                {l.source && <p className="ev-lim-src faint">{l.source}</p>}
                {l.citedBy.length > 0 && (
                  <p className="ev-meta-line lim-applies">
                    <Ids ids={l.citedBy} onOpen={onOpenLedger} />
                  </p>
                )}
              </Disclosure>
            </li>
          ))}
        </ul>
      </Disclosure>
    </section>
  );
}

const idLine = (note: LimitNoteJson): ReactNode => (
  <p className="ev-meta-line lim-applies">
    <code>{note.id}</code>
  </p>
);

const CONDUCT = "Harness conduct";
const UNSTORED = "Ids without a stored note";

export function AnswerLimits({ limits, onOpenLedger }: { limits: AttachedLimits; onOpenLedger: (id: string) => void }) {
  const citedBy = new Map<string, string[]>();
  for (const r of limits.report) {
    const k = limitKey(r.note);
    citedBy.set(k, [...new Set([...(citedBy.get(k) ?? []), ...r.citedBy])]);
  }
  const extra = (note: LimitNoteJson): ReactNode => {
    const ids = citedBy.get(limitKey(note)) ?? [];
    return (
      <p className="ev-meta-line lim-applies">
        <code>{note.id}</code>
        {ids.length > 0 && (
          <>
            {" "}
            · <Ids ids={ids} onOpen={onOpenLedger} />
          </>
        )}
      </p>
    );
  };
  return (
    <div data-testid="attached-limits">
      {limits.report.length > 0 && <LimitsChip limits={limits.report.map((r) => r.note)} stale={false} extra={extra} />}
      <PlainGroup heading={CONDUCT} items={limits.conduct} onOpenLedger={onOpenLedger} />
    </div>
  );
}

export function RecordLimits({ records, ids, notes, attached, onOpenLedger }: { records: readonly object[]; ids: readonly string[]; notes: Readonly<Record<string, readonly string[]>>; attached: AttachedLimits; onOpenLedger: (id: string) => void }) {
  const own = classifyLimits(records);
  const stored = new Set(own.report.map((r) => r.note.id));
  const conduct: PlainLimit[] = [];
  const unstored: PlainLimit[] = [];
  for (const id of ids) {
    if (stored.has(id)) continue;
    const c = attached.conduct.find((l) => l.id === id);
    if (c) conduct.push({ ...c, citedBy: [] });
    else unstored.push({ id, title: "", text: "", source: "", citedBy: [] });
  }
  const lines = new Map(Object.entries(notes));
  return (
    <div data-testid="record-limits">
      {own.report.length > 0 && <LimitsChip limits={own.report.map((r) => r.note)} stale={false} extra={idLine} />}
      <PlainGroup heading={CONDUCT} items={conduct} onOpenLedger={onOpenLedger} lines={lines} />
      <PlainGroup heading={UNSTORED} items={unstored} onOpenLedger={onOpenLedger} lines={lines} />
    </div>
  );
}
