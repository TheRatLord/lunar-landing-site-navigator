import { utcText } from "../../lib/time";
import { Fragment, useState } from "react";
import type { SlipMode, SlipRow } from "../../api/planning";
import { IconButton } from "../../components/ui/Button";
import { formatNum, formatSigned } from "../../lib/format";
import { kindMarginName } from "../../lib/marginKind";
import { slipMargins } from "../calendar/format";
import { delayHours, delayLabel } from "./delays";
import { limitingShort } from "./gridModel";
import { CellVerdict } from "./Shortlist";

function hasDetail(r: SlipRow): boolean {
  return Boolean(r.explanation || r.margin_note || r.margin !== null);
}

export function SlipTable({ rows, mode }: { rows: SlipRow[]; mode: SlipMode }) {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const launch = mode === "launch";
  const headingUnknown = rows.some((r) => r.margin_kind === "best_case");
  const span = 8 + (launch ? 1 : 0) + (headingUnknown ? 1 : 0);
  const toggle = (h: number) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(h)) next.delete(h);
      else next.add(h);
      return next;
    });
  return (
    <table className="table cmp-slip-rows">
      <caption className="sr-only">Verdict and margins for each delay</caption>
      <thead>
        <tr>
          <th scope="col">Delay</th>
          {launch && <th scope="col">Launch</th>}
          <th scope="col">Landing</th>
          <th scope="col">Verdict</th>
          {headingUnknown && (
            <th scope="col" className="num-col">
              Heading unknown
            </th>
          )}
          <th scope="col">Limiting</th>
          <th scope="col" className="num-col">
            Nominal
          </th>
          <th scope="col" className="num-col">
            Worst case
          </th>
          <th scope="col">Next open</th>
          <th scope="col">
            <span className="sr-only">Detail</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const m = slipMargins(r);
          const isOpen = open.has(r.slip_h);
          const detailId = `cmp-slip-${r.slip_h}`;
          return (
            <Fragment key={r.slip_h}>
              <tr>
                <td className="num">{delayLabel(r.slip_h)}</td>
                {launch && <td className="num">{utcText(r.launch_utc)}</td>}
                <td className="num">{utcText(r.landing_utc)}</td>
                <td>
                  <CellVerdict state={r.state} />
                </td>
                {headingUnknown && <td className="num num-col">{m.headingUnknown?.text ?? "—"}</td>}
                <td>{limitingShort(r) ?? <span className="cmp-dim">—</span>}</td>
                <td className="num num-col">{m.nominal.text}</td>
                <td className="num num-col">{m.worst.text}</td>
                <td className="num">
                  {r.next_open_utc === null ? (
                    <span className="cmp-dim">{r.state === "pass" || r.state === "marginal" ? "Open" : "None"}</span>
                  ) : (
                    <span className="cmp-win">
                      {utcText(r.next_open_utc)}
                      {r.next_open_wait_h !== null && r.next_open_wait_h > 0 && <span className="cmp-dim"> +{formatNum(r.next_open_wait_h, 1)} h</span>}
                    </span>
                  )}
                </td>
                <td className="cmp-slip-toggle">
                  {hasDetail(r) && (
                    <IconButton
                      icon={isOpen ? "chevronUp" : "chevronDown"}
                      size="sm"
                      label={isOpen ? "Hide detail" : "Show detail"}
                      aria-expanded={isOpen}
                      aria-controls={isOpen ? detailId : undefined}
                      onClick={() => toggle(r.slip_h)}
                    />
                  )}
                </td>
              </tr>
              {isOpen && (
                <tr className="cmp-slip-detail" id={detailId}>
                  <td colSpan={span}>
                    <dl className="cmp-dl cmp-dl-inline">
                      <div className="cmp-dl-row">
                        <dt>Delay</dt>
                        <dd className="num">{delayHours(r.slip_h)}</dd>
                      </div>
                      {r.margin !== null && (
                        <div className="cmp-dl-row">
                          <dt>{kindMarginName(r.margin_kind)}</dt>
                          <dd className="num">{formatSigned(r.margin, 2)} × margin scale</dd>
                        </div>
                      )}
                    </dl>
                    {r.margin_note && (
                      <p className="cmp-note" data-testid="slip-margin-note">
                        {r.margin_note}
                      </p>
                    )}
                    {r.explanation && <p className="cmp-note">{r.explanation}</p>}
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
