import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LimitNoteJson } from "../../api/site";
import { Disclosure } from "../../components/ui/Disclosure";
import { Popover } from "../../components/ui/Popover";
import { validationSourceHref } from "../../lib/evidence";
import { glueQuantities } from "../../lib/format";
import { LIMIT_KIND_LABEL, limitGroups, limitKey, type LimitGroup } from "./adapt";
import "../../styles/chrome.css";

const groupLabel = (g: LimitGroup) => (g.kind ? (LIMIT_KIND_LABEL as Record<string, string | undefined>)[g.kind] || g.notes[0]?.category || g.kind : "Other");

function Note({ note, extra }: { note: LimitNoteJson; extra?: (note: LimitNoteJson) => ReactNode }) {
  const href = validationSourceHref(note.source);
  const quotes = [note.quote, ...note.more].filter((q) => q);
  return (
    <li data-kind={note.kind} data-limit-id={note.id} className="lim-item">
      <Disclosure title={note.title}>
        <div className="lim-body">
          <p className="lim-text">{glueQuantities(note.text)}</p>
          <p className="lim-src">{href ? <Link to={href}>{note.source}</Link> : note.source}</p>
          {quotes.map((q) => (
            <blockquote key={q} className="lim-quote">
              {glueQuantities(q)}
            </blockquote>
          ))}
          {extra?.(note)}
        </div>
      </Disclosure>
    </li>
  );
}

function NoteList({ notes, extra }: { notes: readonly LimitNoteJson[]; extra?: (note: LimitNoteJson) => ReactNode }) {
  const seen = new Map<string, number>();
  return (
    <ul className="lim-list">
      {notes.map((n) => {
        const key = limitKey(n);
        const nth = seen.get(key) ?? 0;
        seen.set(key, nth + 1);
        return <Note key={nth === 0 ? key : `${key} #${nth}`} note={n} extra={extra} />;
      })}
    </ul>
  );
}

export interface LimitsChipProps {
  limits: readonly LimitNoteJson[] | undefined;
  stale: boolean;
  extra?: (note: LimitNoteJson) => ReactNode;
  align?: "start" | "end";
}

export function LimitsChip({ limits, stale, extra, align = "start" }: LimitsChipProps) {
  if (stale || !Array.isArray(limits)) return null;
  if (limits.length === 0) return <span className="chip chip-unknown" data-testid="limits">No caveats</span>;
  const groups = limitGroups(limits);
  const tone = groups.some((g) => g.kind === "known_miss") ? "fail" : groups.some((g) => g.kind === "model_limit" || g.kind === "not_modelled") ? "marginal" : "default";
  return (
    <span className="lim" data-testid="limits">
      <Popover label={`${limits.length} ${limits.length === 1 ? "caveat" : "caveats"}`} icon="shield" tone={tone} align={align} width={440}>
        <div className="lim-pop">
          {groups.map((g) => (
            <section key={g.kind ?? "other"} data-kind={g.kind ?? "other"} aria-label={`${groupLabel(g)} (${g.notes.length})`}>
              <Disclosure title={groupLabel(g)} count={g.notes.length}>
                <NoteList notes={g.notes} extra={extra} />
              </Disclosure>
            </section>
          ))}
        </div>
      </Popover>
    </span>
  );
}
