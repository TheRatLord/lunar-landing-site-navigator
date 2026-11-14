import { utcText } from "../../lib/time";
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import type { SlipMode, SlipRow, SlipSite } from "../../api/planning";
import { Icon } from "../../components/ui/Icon";
import { Pairs, type Pair } from "../../components/ui/Pairs";
import { VerdictChip } from "../../components/ui/VerdictChip";
import { formatLat, formatLon } from "../../lib/coords";
import { formatNum } from "../../lib/format";
import { clamp } from "../../lib/scale";
import { slipMargins } from "../calendar/format";
import { delayHours, delayLabel } from "./delays";
import { CELL_MARK, cellFigure, cellName, limitingLabel, limitingShort, worksParts } from "./gridModel";
import { pinKey, type Pin } from "./options";

export interface GridSite {
  key: string | null;
  name: string;
  lat_deg: number;
  lon_deg: number;
  planned: boolean;
  site: SlipSite | null;
}

interface Hover {
  r: number;
  c: number;
  el: HTMLElement;
}

export function Grid({
  delays,
  sites,
  landing,
  mode,
  pins,
  openSite,
  onTogglePin,
  onOpenSite,
}: {
  delays: readonly number[];
  sites: readonly GridSite[];
  landing: (h: number) => string | null;
  mode: SlipMode;
  pins: readonly Pin[];
  openSite: number | null;
  onTogglePin: (site: string, slip_h: number) => void;
  onOpenSite: (i: number) => void;
}) {
  const [active, setActive] = useState({ r: 0, c: 0 });
  const [hover, setHover] = useState<Hover | null>(null);
  const table = useRef<HTMLTableElement>(null);
  const ran = sites.some((s) => s.site !== null);
  const number = (key: string | null, slip_h: number) => {
    if (key === null) return null;
    const at = pins.findIndex((p) => pinKey(p) === pinKey({ kind: "cell", site: key, slip_h }));
    return at < 0 ? null : at + 1;
  };

  const move = (e: KeyboardEvent, r: number, c: number) => {
    const to =
      e.key === "ArrowRight" ? { r, c: c + 1 }
      : e.key === "ArrowLeft" ? { r, c: c - 1 }
      : e.key === "ArrowDown" ? { r: r + 1, c }
      : e.key === "ArrowUp" ? { r: r - 1, c }
      : e.key === "Home" ? { r, c: 0 }
      : e.key === "End" ? { r, c: delays.length - 1 }
      : null;
    if (!to || to.r < 0 || to.r >= sites.length || to.c < 0 || to.c >= delays.length) return;
    e.preventDefault();
    setActive(to);
    table.current?.querySelector<HTMLButtonElement>(`button[data-r="${to.r}"][data-c="${to.c}"]`)?.focus();
  };

  const hovered = hover ? sites[hover.r] : undefined;
  const hoveredRow = hover && hovered?.site ? hovered.site.rows.find((x) => x.slip_h === delays[hover.c]) : undefined;

  return (
    <div className="cmp-grid-wrap">
      <table className="cmp-grid" ref={table}>
        <caption className="sr-only">
          Options: sites down, delays across. Each cell is a button that adds the option to the shortlist or takes it out. Arrow keys move between cells.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="cmp-grid-corner">
              <span className="sr-only">Site</span>
            </th>
            {delays.map((h) => {
              const at = landing(h);
              return (
                <th key={h} scope="col" aria-label={`${delayLabel(h)}${at ? `, landing ${utcText(at)} UTC` : ""}`}>
                  <span className="cmp-col-delay num">
                    {h === 0 && <Icon name="pin" size={12} />}
                    {delayLabel(h)}
                  </span>
                  <span className="cmp-sub num">{at ? utcText(at).slice(0, 10) : "\u00a0"}</span>
                </th>
              );
            })}
            {ran && (
              <th scope="col" className="cmp-grid-end">
                Pass
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {sites.map((row, r) => (
            <tr key={`${row.key ?? row.name}-${r}`} className={openSite === r ? "is-open" : undefined}>
              <th scope="row" className="cmp-grid-site">
                {row.site ? (
                  <button
                    type="button"
                    className="cmp-site-btn"
                    aria-expanded={openSite === r}
                    aria-controls="cmp-detail"
                    aria-label={`${row.name}, ${formatLat(row.lat_deg, 2)} ${formatLon(row.lon_deg, 2)}: delays`}
                    onClick={() => onOpenSite(r)}
                  >
                    <SiteName row={row} />
                    <Icon name="chevronRight" size={12} className="cmp-site-chevron" />
                  </button>
                ) : (
                  <span className="cmp-site-btn is-static" aria-label={`${row.name}, ${formatLat(row.lat_deg, 2)} ${formatLon(row.lon_deg, 2)}`}>
                    <SiteName row={row} />
                  </span>
                )}
              </th>
              {delays.map((h, c) => {
                const cell = row.site ? row.site.rows.find((x) => x.slip_h === h) : undefined;
                const n = number(row.key, h);
                if (row.site && !cell)
                  return (
                    <td key={h} className="cmp-cell">
                      <span className="cmp-btn cmp-s-none" aria-label="no result">
                        —
                      </span>
                    </td>
                  );
                const name = cell ? cellName(row.name, cell, n) : `${row.name}, ${delayLabel(h)}${n !== null ? `; in the shortlist as number ${n}` : ""}`;
                const state = cell ? `cmp-s-${cell.state}` : "cmp-s-empty";
                const body = cell ? <CellBody row={cell} /> : null;
                const hoverProps = cell
                  ? {
                      onMouseEnter: (e: MouseEvent<HTMLElement>) => setHover({ r, c, el: e.currentTarget }),
                      onMouseLeave: () => setHover(null),
                    }
                  : {};
                return (
                  <td key={h} className="cmp-cell">
                    {row.key === null ? (
                      <span className={`cmp-btn ${state}`} role="img" aria-label={name} {...hoverProps}>
                        {body}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={`cmp-btn ${state}${n !== null ? " is-pinned" : ""}`}
                        aria-pressed={n !== null}
                        aria-label={name}
                        tabIndex={active.r === r && active.c === c ? 0 : -1}
                        data-pin={n ?? undefined}
                        data-r={r}
                        data-c={c}
                        onFocus={(e) => {
                          setActive({ r, c });
                          if (cell) setHover({ r, c, el: e.currentTarget });
                        }}
                        onBlur={() => setHover(null)}
                        onKeyDown={(e) => move(e, r, c)}
                        onClick={() => onTogglePin(row.key!, h)}
                        {...hoverProps}
                      >
                        {body}
                      </button>
                    )}
                  </td>
                );
              })}
              {ran && <PassCell site={row.site} />}
            </tr>
          ))}
        </tbody>
      </table>
      {hover && hovered && hoveredRow && (
        <CellCard anchor={hover.el} name={hovered.name} row={hoveredRow} mode={mode} pinned={number(hovered.key, hoveredRow.slip_h)} />
      )}
    </div>
  );
}

function SiteName({ row }: { row: GridSite }) {
  return (
    <span className="cmp-site-name">
      {row.planned && <Icon name="pin" size={12} className="cmp-pin-icon" />}
      <span className="ellipsis">{row.name}</span>
    </span>
  );
}

function CellBody({ row }: { row: SlipRow }) {
  if (row.state === "no_opportunity" || row.state === "unknown")
    return (
      <span className="cmp-cell-fig" aria-hidden="true">
        {CELL_MARK[row.state].word}
      </span>
    );
  const figure = cellFigure(row);
  const limiting = limitingShort(row);
  return (
    <>
      <span className="cmp-cell-fig num" aria-hidden="true">
        {figure ?? CELL_MARK[row.state].word}
      </span>
      {limiting && (
        <span className="cmp-cell-lim" aria-hidden="true">
          {limiting}
        </span>
      )}
    </>
  );
}

function PassCell({ site }: { site: SlipSite | null }) {
  if (!site) return <td className="cmp-grid-end" />;
  const { pass, total, marginal } = worksParts(site);
  return (
    <td className="cmp-grid-end num">
      <span className="cmp-pass">
        {pass}/{total}
      </span>
      {marginal > 0 && (
        <span className="cmp-pass-marginal" aria-label={`${marginal} marginal`}>
          +{marginal}
        </span>
      )}
    </td>
  );
}

const GAP = 6;

function CellCard({ anchor, name, row, mode, pinned }: { anchor: HTMLElement; name: string; row: SlipRow; mode: SlipMode; pinned: number | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const a = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = clamp(a.left + a.width / 2 - w / 2, GAP, window.innerWidth - w - GAP);
    const below = a.bottom + GAP;
    const top = below + h > window.innerHeight - GAP ? Math.max(GAP, a.top - GAP - h) : below;
    setPos({ left, top });
  }, [anchor, row]);
  const m = slipMargins(row);
  const pairs: Array<Pair | null | false> = [
    mode === "launch" && ["Launch", utcText(row.launch_utc)],
    ["Landing", row.landing_utc ? utcText(row.landing_utc) : "—"],
    [
      "Verdict",
      row.state === "pass" || row.state === "marginal" || row.state === "fail" ? <VerdictChip verdict={row.state} compact /> : CELL_MARK[row.state].word,
    ],
    ["Limiting", limitingLabel(row) ?? "—"],
    ["Nominal margin", m.nominal.text],
    ["Worst-case margin", m.worst.text],
    m.headingUnknown && ["Margin, heading unknown", m.headingUnknown.text],
    [
      "Next open",
      row.next_open_utc
        ? `${utcText(row.next_open_utc)}${row.next_open_wait_h !== null && row.next_open_wait_h > 0 ? ` (+${formatNum(row.next_open_wait_h, 1)} h)` : ""}`
        : row.state === "pass" || row.state === "marginal"
          ? "Open"
          : "None",
    ],
    pinned !== null && ["Shortlist", `#${pinned}`],
  ];
  return createPortal(
    <div
      ref={ref}
      className="cmp-card"
      role="tooltip"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
    >
      <div className="cmp-card-head">
        <span className="ellipsis">{name}</span>
        <span className="num cmp-card-delay">{delayLabel(row.slip_h)} · {delayHours(row.slip_h)}</span>
      </div>
      <Pairs className="cmp-dl" rows={pairs} />
      {row.margin_note && <p className="cmp-card-note">{row.margin_note}</p>}
    </div>,
    document.body,
  );
}
