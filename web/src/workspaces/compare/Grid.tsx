import { useRef, useState, type KeyboardEvent } from "react";
import type { SlipRow } from "../../api/planning";
import { IconButton } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { MS_HOUR } from "../../lib/time";
import { delayLabels } from "./delays";
import { STATE_WORD, dateText, dayText, limitingShort, nextText, works, type SiteRef } from "./gridModel";
import { BASELINE_SITE } from "./options";

export interface Cell {
  site: string;
  slip_h: number;
}

export function Grid({
  sites,
  slips,
  plannedMs,
  cellAt,
  selected,
  onSelect,
  onRemoveSite,
  onRemoveSlip,
}: {
  sites: readonly SiteRef[];
  slips: readonly number[];
  plannedMs: number | null;
  cellAt: (key: string, h: number) => SlipRow | null;
  selected: Cell | null;
  onSelect: (cell: Cell | null) => void;
  onRemoveSite: (key: string) => void;
  onRemoveSlip: (h: number) => void;
}) {
  const [active, setActive] = useState({ r: 0, c: 0 });
  const table = useRef<HTMLTableElement>(null);
  const labels = delayLabels(slips);
  const at = (h: number) => (plannedMs === null ? null : plannedMs + h * MS_HOUR);
  const plannedYear = plannedMs === null ? null : new Date(plannedMs).getUTCFullYear();

  const move = (e: KeyboardEvent, r: number, c: number) => {
    const to =
      e.key === "ArrowRight" ? { r, c: c + 1 }
      : e.key === "ArrowLeft" ? { r, c: c - 1 }
      : e.key === "ArrowDown" ? { r: r + 1, c }
      : e.key === "ArrowUp" ? { r: r - 1, c }
      : e.key === "Home" ? { r, c: 0 }
      : e.key === "End" ? { r, c: slips.length - 1 }
      : null;
    if (!to || to.r < 0 || to.r >= sites.length || to.c < 0 || to.c >= slips.length) return;
    e.preventDefault();
    setActive(to);
    table.current?.querySelector<HTMLButtonElement>(`button[data-r="${to.r}"][data-c="${to.c}"]`)?.focus();
  };

  return (
    <div className="cmp-grid-wrap">
      <table className="cmp-grid" ref={table}>
        <caption className="sr-only">Sites by landing date</caption>
        <thead>
          <tr>
            <th scope="col" className="cmp-grid-corner">
              <span className="sr-only">Site</span>
            </th>
            {slips.map((h, i) => {
              const ms = at(h);
              return (
                <th key={h} scope="col" className="cmp-col">
                  <span className="cmp-col-head">
                    <span className="cmp-col-date num">{ms === null ? labels[i] : dayText(ms, new Date(ms).getUTCFullYear() !== plannedYear)}</span>
                    {h !== 0 && <IconButton icon="close" size="sm" className="cmp-x" label={`Remove ${ms === null ? labels[i] : dayText(ms, true)}`} onClick={() => onRemoveSlip(h)} />}
                  </span>
                  <span className="cmp-col-sub num">{h === 0 ? "Planned" : labels[i]}</span>
                </th>
              );
            })}
            <th scope="col" className="cmp-grid-end">
              Works
            </th>
          </tr>
        </thead>
        <tbody>
          {sites.map((site, r) => {
            const cells = slips.map((h) => cellAt(site.key, h));
            const known = cells.filter((x) => x !== null);
            const plan = site.key === BASELINE_SITE;
            return (
              <tr key={site.key}>
                <th scope="row" className="cmp-grid-site">
                  <span className="cmp-site">
                    {plan && <Icon name="pin" size={12} className="cmp-pin" />}
                    <span className="ellipsis" title={site.name}>
                      {site.name}
                    </span>
                    {plan ? <span className="sr-only">, the plan site</span> : <IconButton icon="close" size="sm" className="cmp-x" label={`Remove ${site.name}`} onClick={() => onRemoveSite(site.key)} />}
                  </span>
                </th>
                {slips.map((h, c) => {
                  const row = cells[c];
                  const ms = at(h);
                  const on = selected?.site === site.key && selected.slip_h === h;
                  if (!row || ms === null)
                    return (
                      <td key={h} className="cmp-cell">
                        <span className="cmp-btn cmp-s-empty" />
                      </td>
                    );
                  return (
                    <td key={h} className="cmp-cell">
                      <button
                        type="button"
                        className={`cmp-btn cmp-s-${row.state}`}
                        aria-pressed={on}
                        aria-label={`${site.name}, ${dateText(ms)}: ${STATE_WORD[row.state]}${works(row.state) || !row.next_open_utc ? "" : `, ${nextText(row, ms)}`}`}
                        tabIndex={active.r === r && active.c === c ? 0 : -1}
                        data-r={r}
                        data-c={c}
                        onFocus={() => setActive({ r, c })}
                        onKeyDown={(e) => move(e, r, c)}
                        onClick={() => onSelect(on ? null : { site: site.key, slip_h: h })}
                      >
                        <CellBody row={row} landingMs={ms} />
                      </button>
                    </td>
                  );
                })}
                <td className="cmp-grid-end num">{known.length > 0 ? `${known.filter((x) => x.state === "pass").length}/${slips.length}` : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CellBody({ row, landingMs }: { row: SlipRow; landingMs: number }) {
  const sub = row.state === "pass" || row.state === "unknown" ? null : row.state !== "marginal" && row.next_open_utc ? nextText(row, landingMs) : limitingShort(row);
  return (
    <>
      <span className="cmp-cell-word" aria-hidden="true">
        {STATE_WORD[row.state]}
      </span>
      {sub && (
        <span className="cmp-cell-sub num" aria-hidden="true">
          {sub}
        </span>
      )}
    </>
  );
}
