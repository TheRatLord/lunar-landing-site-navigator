import { useState, type ReactNode } from "react";
import { Button, IconButton } from "../../components/ui/Button";
import { Select } from "../../components/ui/Fields";
import { Icon } from "../../components/ui/Icon";
import { Spinner } from "../../components/ui/Progress";
import { formatQuantity } from "../../lib/requirements";
import { RANK_OPTIONS, hoursText, type RankBy } from "../../scenario/planSearch";
import { dayText } from "../../scenario/when";
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

const VALUES: Array<{ key: RankBy; label: string }> = [
  { key: "sunlit_h", label: "Sunlight" },
  { key: "contact_h", label: "Earth link" },
  { key: "sunlit_contact_h", label: "Sun + Earth link" },
  { key: "margin", label: "Margin" },
];

function value(o: LandingOption, key: RankBy): string {
  if (key === "margin") return o.margin === null ? "–" : formatQuantity(o.margin, o.marginUnit, { sign: true });
  return hoursText(o.totals[key]);
}

function Row({ o, n, rank, values, requirements, selected, onSelect, onOpen, tools }: { o: LandingOption; n: number | null; rank: RankBy; values: typeof VALUES; requirements: number; selected: boolean; onSelect(): void; onOpen(): void; tools: ReactNode }) {
  const tone = o.pending || o.failed ? "wait" : requirements === 0 ? "none" : (o.verdict ?? "none");
  const blank = o.pending || o.failed;
  const when =
    o.failed ? "Couldn't compute" : o.pending ? "Checking the year" : o.t_ms === null ? (o.note ?? "No landing time") : (
      <span>
        {dayText(o.t_ms)} <span className="ot-time">{new Date(o.t_ms).toISOString().slice(11, 16)}</span>
      </span>
    );
  return (
    <tr className="ot-row" data-tone={tone} data-blank={blank || o.t_ms === null || undefined} aria-current={selected || undefined} onClick={onSelect} title={o.note ?? undefined}>
      <td className="ot-n-cell">
        <span className="ot-n num">{n === null ? <Icon name="pin" size={12} /> : n}</span>
      </td>
      <td className="ot-when">
        <button type="button" className="ot-pick num" title={o.note ?? (o.t_ms === null ? undefined : "Use this site and landing time")}>
          {o.pending ? <Spinner size={10} /> : null}
          {when}
        </button>
      </td>
      <td className="ot-site" title={o.place.name}>
        {o.label}
      </td>
      {requirements > 0 && <td className="ot-verdict">{!blank && o.verdict ? <span data-tone={o.verdict}>{VERDICT_LABEL[o.verdict]}</span> : "–"}</td>}
      <td className="ot-limit">{blank ? "" : (o.limiting ?? "–")}</td>
      {values.map((v) => (
        <td key={v.key} className="ot-val num" data-rank={v.key === rank || undefined}>
          {blank ? "" : value(o, v.key)}
        </td>
      ))}
      <td className="ot-tools" onClick={(e) => e.stopPropagation()}>
        <span>
          {tools}
          <IconButton icon="chevronRight" size="sm" variant="ghost" label={`Open ${o.label} in Site`} disabled={o.pending} onClick={onOpen} />
        </span>
      </td>
    </tr>
  );
}

export function OptionList({ pinned, ranked, rank, requirements, selectedKey, notice, search, bar, scope, onRank, onSelect, onOpen, onPin, onUnpin, canPin }: OptionListProps) {
  const [all, setAll] = useState(false);
  const options = RANK_OPTIONS.filter((o) => !(requirements === 0 && o.value === "margin")).map((o) => ({ value: o.value, label: o.label }));
  const values = VALUES.filter((v) => !(requirements === 0 && v.key === "margin"));
  const cols = 5 + values.length + (requirements > 0 ? 1 : 0);
  const shown = all ? ranked : ranked.slice(0, SHOWN);
  const row = (o: LandingOption, n: number | null) => (
    <Row
      key={o.key}
      o={o}
      n={n}
      rank={rank}
      values={values}
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
      <div className="ot-wrap">
        <table className="ot">
          <caption className="sr-only">Landing options for {scope}</caption>
          <thead>
            <tr>
              <th scope="col" className="ot-n-cell">
                <span className="sr-only">Rank</span>#
              </th>
              <th scope="col">Landing (UTC)</th>
              <th scope="col">Site</th>
              {requirements > 0 && <th scope="col">Verdict</th>}
              <th scope="col">Limited by</th>
              {values.map((v) => (
                <th key={v.key} scope="col" className="ot-val" data-rank={v.key === rank || undefined} aria-sort={v.key === rank ? "descending" : undefined}>
                  {v.key === rank && <Icon name="chevronDown" size={12} />}
                  {v.label}
                </th>
              ))}
              <th scope="col" className="ot-tools">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          {pinned.length > 0 && (
            <tbody>
              <tr className="ot-group">
                <th scope="colgroup" colSpan={cols}>
                  Pinned
                </th>
              </tr>
              {pinned.map((o) => row(o, null))}
            </tbody>
          )}
          <tbody>
            <tr className="ot-group">
              <th scope="colgroup" colSpan={cols}>
                {requirements === 0 ? "Ranked · no requirements set, so every landing counts" : "Ranked"}
              </th>
            </tr>
            {notice && (
              <tr className="ot-notice">
                <td colSpan={cols}>{notice}</td>
              </tr>
            )}
            {shown.map((o, i) => row(o, i + 1))}
          </tbody>
        </table>
      </div>
      <footer className="opts-foot">
        {ranked.length > SHOWN && (
          <Button size="sm" variant="ghost" className="opts-more" onClick={() => setAll((a) => !a)}>
            {all ? "Show fewer" : `Show all ${ranked.length}`}
          </Button>
        )}
        {search}
      </footer>
    </section>
  );
}
