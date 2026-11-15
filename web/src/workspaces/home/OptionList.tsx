import { useState, type ReactNode } from "react";
import { Button, IconButton } from "../../components/ui/Button";
import { Select } from "../../components/ui/Fields";
import { Icon } from "../../components/ui/Icon";
import { Spinner } from "../../components/ui/Progress";
import { formatQuantity } from "../../lib/requirements";
import { RANK_OPTIONS, hoursText, type RankBy } from "../../scenario/planSearch";
import { whenText } from "../../scenario/when";
import { VERDICT_LABEL } from "../../lib/verdict";
import type { LandingOption } from "./options";

interface OptionListProps {
  pinned: LandingOption[];
  ranked: LandingOption[];
  rank: RankBy;
  requirements: number;
  selectedKey: string | null;
  notice: ReactNode;
  search: ReactNode;
  bar: ReactNode;
  scope: string;
  onRank(r: RankBy): void;
  onSelect(o: LandingOption): void;
  onOpen(o: LandingOption): void;
  onPin(o: LandingOption): void;
  onUnpin(o: LandingOption): void;
  canPin(o: LandingOption): boolean;
}

const SHOWN = 8;

function value(o: LandingOption, rank: RankBy): string {
  if (rank === "margin") return o.margin === null ? "–" : formatQuantity(o.margin, o.marginUnit, { sign: true });
  return hoursText(o.totals[rank]);
}

function Row({ o, n, rank, requirements, selected, onSelect, onOpen, tools }: { o: LandingOption; n: number | null; rank: RankBy; requirements: number; selected: boolean; onSelect(): void; onOpen(): void; tools: ReactNode }) {
  const tone = o.pending || o.failed ? "wait" : requirements === 0 ? "none" : (o.verdict ?? "none");
  const title = o.t_ms === null ? o.label : whenText(o.t_ms);
  const status = o.failed
    ? `${o.label} · couldn't compute`
    : o.pending
      ? `${o.label} · checking the year`
      : [o.t_ms === null ? (o.note ?? "") : o.label, requirements > 0 && o.verdict ? VERDICT_LABEL[o.verdict] : null, o.limiting ? `limited by ${o.limiting}` : null].filter(Boolean).join(" · ");
  return (
    <li className="opt" data-tone={tone} aria-current={selected || undefined}>
      <button type="button" className="opt-main" onClick={onSelect} title={o.note ?? (o.t_ms === null ? undefined : "Use this site and landing time")}>
        <span className="opt-n num">{n === null ? <Icon name="pin" size={12} /> : n}</span>
        <span className="opt-text">
          <strong>{title}</strong>
          <span className="opt-sub">{o.pending ? <Spinner size={10} /> : null} {status}</span>
        </span>
        <span className="opt-value num">{o.pending || o.failed ? "" : value(o, rank)}</span>
      </button>
      <span className="opt-tools">
        {tools}
        <IconButton icon="chevronRight" size="sm" variant="ghost" label={`Open ${o.label} in Site`} disabled={o.pending} onClick={onOpen} />
      </span>
    </li>
  );
}

export function OptionList({ pinned, ranked, rank, requirements, selectedKey, notice, search, bar, scope, onRank, onSelect, onOpen, onPin, onUnpin, canPin }: OptionListProps) {
  const [all, setAll] = useState(false);
  const options = RANK_OPTIONS.filter((o) => !(requirements === 0 && o.value === "margin")).map((o) => ({ value: o.value, label: o.label }));
  const shown = all ? ranked : ranked.slice(0, SHOWN);
  const row = (o: LandingOption, n: number | null) => (
    <Row
      key={o.key}
      o={o}
      n={n}
      rank={rank}
      requirements={requirements}
      selected={o.key === selectedKey}
      onSelect={() => onSelect(o)}
      onOpen={() => onOpen(o)}
      tools={
        o.kind === "pin" ? (
          <IconButton icon="close" size="sm" variant="ghost" label={`Unpin ${o.label}`} onClick={() => onUnpin(o)} />
        ) : canPin(o) ? (
          <IconButton icon="pin" size="sm" variant="ghost" label={`Pin ${o.label}`} onClick={() => onPin(o)} />
        ) : null
      }
    />
  );
  return (
    <section className="opts" aria-label="Landing options">
      <header className="opts-head">
        <div className="opts-title">
          <h2>Landing options</h2>
          <p>{scope}</p>
        </div>
        <label className="opts-rank">
          <span>Rank by</span>
          <Select aria-label="Rank landing options by" value={rank} options={options} onChange={(v) => onRank(v as RankBy)} />
        </label>
      </header>
      {bar}
      <div className="opts-scroll">
        {pinned.length > 0 && (
          <>
            <p className="opts-group">Pinned</p>
            <ul className="opts-list">{pinned.map((o) => row(o, null))}</ul>
          </>
        )}
        <p className="opts-group">{requirements === 0 ? "Ranked · no requirements set, so every landing counts" : "Ranked"}</p>
        {notice}
        {ranked.length > 0 && <ul className="opts-list">{shown.map((o, i) => row(o, i + 1))}</ul>}
        {ranked.length > SHOWN && (
          <Button size="sm" variant="ghost" className="opts-more" onClick={() => setAll((a) => !a)}>
            {all ? "Show fewer" : `Show all ${ranked.length}`}
          </Button>
        )}
        {search}
      </div>
    </section>
  );
}
