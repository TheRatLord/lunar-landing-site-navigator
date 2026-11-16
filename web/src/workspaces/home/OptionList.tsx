import { useState, type ReactNode } from "react";
import { Button, IconButton } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { Spinner } from "../../components/ui/Progress";
import { Segmented } from "../../components/ui/Segmented";
import { formatQuantity } from "../../lib/requirements";
import { hoursText, type RankBy } from "../../scenario/planSearch";
import { dayText } from "../../scenario/when";
import { VERDICT_LABEL } from "../../lib/verdict";
import type { LandingOption } from "./options";

interface OptionListProps {
  pinned: LandingOption[];
  ranked: LandingOption[];
  rank: RankBy;
  requirements: number;
  selectedKey: string | null;
  previewKey: string | null;
  notice: ReactNode;
  search: ReactNode;
  bar: ReactNode;
  selection: ReactNode;
  scope: string;
  onRank(r: RankBy): void;
  onSelect(o: LandingOption): void;
  onPreview(o: LandingOption | null): void;
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

const BESIDE: Record<RankBy, RankBy> = { sunlit_h: "contact_h", contact_h: "sunlit_h", sunlit_contact_h: "sunlit_h", margin: "sunlit_contact_h" };

const labelOf = (key: RankBy): string => VALUES.find((v) => v.key === key)!.label;

function amount(o: LandingOption, key: RankBy): number | null {
  const v = key === "margin" ? o.margin : o.totals[key];
  return v !== null && Number.isFinite(v) ? v : null;
}

function value(o: LandingOption, key: RankBy): string {
  if (key === "margin") return o.margin === null ? "–" : formatQuantity(o.margin, o.marginUnit, { sign: true });
  return hoursText(o.totals[key]);
}

function Row({ o, n, rank, top, values, requirements, withSite, selected, previewing, onSelect, onPreview, onOpen, tools }: { o: LandingOption; n: number | null; rank: RankBy; top: number; values: typeof VALUES; requirements: number; withSite: boolean; selected: boolean; previewing: boolean; onSelect(): void; onPreview(on: boolean): void; onOpen(): void; tools: ReactNode }) {
  const blank = o.pending || o.failed;
  const time = o.t_ms === null ? null : new Date(o.t_ms).toISOString().slice(11, 16);
  const state = o.failed ? "Couldn't compute" : o.pending ? "Checking the year" : o.t_ms === null ? (o.note ?? "No landing time") : null;
  const pin = n === null;
  const lead = pin ? o.label : (state ?? dayText(o.t_ms!));
  const rest = pin ? (state ?? `${dayText(o.t_ms!)} ${time}`) : state ? (withSite ? o.label : null) : withSite ? `${time} ${o.label}` : time;
  const got = blank ? null : amount(o, rank);
  const share = got === null || top <= 0 ? 0 : Math.max(0, Math.min(1, got / top));
  const judged = !blank && requirements > 0 && o.verdict !== null;
  const all = values.map((v) => `${v.label} ${value(o, v.key)}`).join(", ");
  return (
    <tr className="ol-row" data-kind={pin ? "pin" : "rank"} data-blank={blank || o.t_ms === null || undefined} aria-current={selected || undefined} data-preview={previewing || undefined} onClick={onSelect} onMouseEnter={() => onPreview(true)} onMouseLeave={() => onPreview(false)} title={o.note ?? undefined}>
      <td className="ol-n num">{pin ? <Icon name="pin" size={13} /> : n}</td>
      <td className="ol-main">
        <button type="button" className="ol-pick num" title={o.note ?? (o.t_ms === null ? o.place.name : `Use ${o.place.name} at this landing time`)}>
          {o.pending ? <Spinner size={10} /> : null}
          <b>{lead}</b>
          {rest && <span>{rest}</span>}
        </button>
      </td>
      <td className="ol-bar">{!blank && <i style={{ width: `${share * 100}%` }} />}</td>
      <td className="ol-val num">{blank ? "" : value(o, rank)}</td>
      <td className="ol-side num" title={blank ? undefined : all}>
        {blank ? (
          ""
        ) : judged ? (
          <>
            <span data-tone={o.verdict!}>{VERDICT_LABEL[o.verdict!]}</span>
            {o.verdict === "pass" ? ` · ${labelOf(BESIDE[rank])} ${value(o, BESIDE[rank])}` : o.limiting ? ` · ${o.limiting}` : ""}
          </>
        ) : (
          `${labelOf(BESIDE[rank])} ${value(o, BESIDE[rank])}`
        )}
      </td>
      <td className="ol-tools" onClick={(e) => e.stopPropagation()}>
        <span>
          {tools}
          <IconButton icon="chevronRight" size="sm" variant="ghost" label={`Open ${o.label} in Site`} disabled={o.pending} onClick={onOpen} />
        </span>
      </td>
    </tr>
  );
}

export function OptionList({ pinned, ranked, rank, requirements, selectedKey, previewKey, onPreview, notice, search, bar, selection, scope, onRank, onSelect, onOpen, onPin, onUnpin, canPin }: OptionListProps) {
  const [all, setAll] = useState(false);
  const values = VALUES.filter((v) => !(requirements === 0 && v.key === "margin"));
  const shown = all ? ranked : ranked.slice(0, SHOWN);
  const top = Math.max(0, ...[...pinned, ...ranked].map((o) => (o.pending || o.failed ? 0 : (amount(o, rank) ?? 0))));
  const withSite = ranked.some((o) => o.kind !== "here");
  const row = (o: LandingOption, n: number | null) => (
    <Row
      key={o.key}
      o={o}
      n={n}
      rank={rank}
      top={top}
      values={values}
      requirements={requirements}
      withSite={withSite}
      selected={o.key === selectedKey}
      previewing={o.key === previewKey && o.key !== selectedKey}
      onSelect={() => onSelect(o)}
      onPreview={(on) => onPreview(on && !o.pending && !o.failed && o.t_ms !== null ? o : null)}
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
      {selection}
      {bar}
      <header className="ol-head">
        <h2 className="ol-title">Landing options</h2>
        <Segmented label="Rank by" size="sm" value={rank} onChange={(v) => onRank(v as RankBy)} options={values.map((v) => ({ value: v.key, label: v.label }))} />
      </header>
      <table className="ol" data-rank={rank}>
        <caption className="sr-only">Landing options for {scope}</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Landing (UTC)</th>
            <th scope="col">Share of the best</th>
            <th scope="col">{labelOf(rank)}</th>
            <th scope="col">Notes</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        {pinned.length > 0 && (
          <tbody>
            <tr className="ol-group">
              <th scope="colgroup" colSpan={6}>
                Pinned sites
              </th>
            </tr>
            {pinned.map((o) => row(o, null))}
          </tbody>
        )}
        <tbody>
          <tr className="ol-group">
            <th scope="colgroup" colSpan={6}>
              Ranked landings
            </th>
          </tr>
          {notice && (
            <tr className="ol-notice">
              <td colSpan={6}>{notice}</td>
            </tr>
          )}
          {shown.map((o, i) => row(o, i + 1))}
        </tbody>
      </table>
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
