import { useMemo, useState } from "react";
import { IconButton } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { VerdictChip } from "../../components/ui/VerdictChip";
import { columnScale, constraintColumns, marginCell, sortByMargin, type SortDir } from "./bars";
import { CELL_MARK, shortName } from "./grid";
import { nominalOf, type ShortRow } from "./items";
import { MarginBar } from "./MarginBar";
import { BASELINE_SITE, MAX_DETAIL, type Pin } from "./options";

export function Shortlist({
  rows,
  ticked,
  canTick,
  onTick,
  onUnpin,
}: {
  rows: ShortRow[];
  ticked: ReadonlySet<string>;
  canTick: (row: ShortRow) => boolean;
  onTick: (key: string) => void;
  onUnpin: (pin: Pin) => void;
}) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(null);
  const columns = useMemo(() => constraintColumns(rows.map((r) => r.constraints)), [rows]);
  const ordered = useMemo(() => (sort ? sortByMargin(rows, (r) => nominalOf(r, sort.key), sort.dir) : rows), [rows, sort]);
  const scales = useMemo(
    () => new Map(columns.map((c) => [c.key, columnScale(rows.map((r) => marginCell(r.constraints.find((x) => x.key === c.key))))])),
    [columns, rows],
  );
  const clickSort = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, dir: "desc" } : s.dir === "desc" ? { key, dir: "asc" } : null));
  const full = ticked.size >= MAX_DETAIL;

  return (
    <div className="cmp-short-wrap">
      <table className="cmp-short">
        <caption className="sr-only">
          Shortlisted options with the margin of each requirement against its threshold. A bar to the right of the centre line passes the threshold; the thin line runs from the worst case to the best case. Each bar is scaled within its own column.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="cmp-short-name">
              <span className="sr-only">Option</span>
            </th>
            <th scope="col" className="cmp-short-tick">
              <Icon name="table" size={14} />
              <span className="sr-only">In All metrics, up to {MAX_DETAIL}</span>
            </th>
            <th scope="col" className="cmp-short-verdict">
              <span className="sr-only">Verdict</span>
            </th>
            {columns.map((c) => {
              const dir = sort?.key === c.key ? sort.dir : null;
              return (
                <th key={c.key} scope="col" className="cmp-short-col" aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}>
                  <button type="button" className="cmp-sort" aria-label={`${c.label}${c.unit ? `, ${c.unit}` : ""}: order by nominal margin`} onClick={() => clickSort(c.key)}>
                    <span className="ellipsis">{shortName(c.key, c.label)}</span>
                    {c.unit && <span className="cmp-sort-unit">{c.unit}</span>}
                    <Icon name={dir === "asc" ? "chevronUp" : "chevronDown"} size={12} className={dir ? "cmp-sort-on" : "cmp-sort-off"} />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {ordered.map((r) => {
            const isTicked = ticked.has(r.key);
            return (
              <tr key={r.key}>
                <th scope="row" className="cmp-short-name">
                  <span className="cmp-short-id">
                    <span className="cmp-badge num" aria-label={`Number ${r.number}`}>
                      {r.number}
                    </span>
                    {r.pin.kind === "saved" && (
                      <>
                        <Icon name="folder" size={12} className="cmp-kind-icon" />
                        <span className="sr-only">Saved plan</span>
                      </>
                    )}
                    {r.pin.kind === "cell" && r.pin.site === BASELINE_SITE && (
                      <>
                        <Icon name="pin" size={12} className="cmp-kind-icon" />
                        <span className="sr-only">Plan site</span>
                      </>
                    )}
                    <span className="ellipsis cmp-short-title">{r.name}</span>
                    <IconButton icon="close" label={`Remove ${r.name}`} size="sm" variant="ghost" className="cmp-row-remove" onClick={() => onUnpin(r.pin)} />
                  </span>
                </th>
                <td className="cmp-short-tick">
                  <input
                    type="checkbox"
                    checked={isTicked}
                    disabled={!canTick(r) || (!isTicked && full)}
                    aria-label={`Show every number of ${r.name}`}
                    onChange={() => onTick(r.key)}
                  />
                </td>
                {r.source.kind === "note" ? (
                  <td colSpan={1 + columns.length} className="cmp-short-note" data-testid="shortlist-note">
                    {r.source.text}
                  </td>
                ) : (
                  <>
                    <td className="cmp-short-verdict">
                      <span className="cmp-verdict">
                        <CellVerdict state={r.state} />
                        {r.limiting && <span className="cmp-sub ellipsis">{r.limiting}</span>}
                      </span>
                      {r.source.kind === "slip" && r.source.row.margin_note && r.state === "no_opportunity" && (
                        <span className="cmp-sub">{r.source.row.margin_note}</span>
                      )}
                    </td>
                    {columns.map((c) => (
                      <td key={c.key} className="cmp-short-cell">
                        <MarginBar cell={marginCell(r.constraints.find((x) => x.key === c.key))} scale={scales.get(c.key) ?? 0} />
                      </td>
                    ))}
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function CellVerdict({ state }: { state: ShortRow["state"] }) {
  if (state === null) return null;
  if (state === "unknown" || state === "no_opportunity") return <span className="chip chip-unknown">{CELL_MARK[state].word}</span>;
  return <VerdictChip verdict={state} compact />;
}
