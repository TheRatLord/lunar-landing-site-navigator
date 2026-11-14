import { formatBounds, formatSignedValue } from "../../lib/format";
import { Popover } from "../../components/ui/Popover";
import { VerdictChip } from "../../components/ui/VerdictChip";
import { headingCell, headingFacts } from "../calendar/format";
import { barGeometry, barName, type MarginCell } from "./bars";

export function MarginBar({ cell, scale }: { cell: MarginCell; scale: number }) {
  if (cell.kind === "unset") return <span className="cmp-dim">—</span>;
  if (cell.kind === "unknown") return <span className="cmp-dim">Unknown{cell.censored ? ", censored" : ""}</span>;
  if (cell.kind === "none")
    return (
      <span className="cmp-mtext">
        {cell.c.state !== "unknown" && <VerdictChip verdict={cell.c.state} compact />}
        <span className="cmp-dim">No margin</span>
      </span>
    );
  if (cell.kind === "heading") {
    const c = cell.c;
    const h = headingCell(c);
    const facts = headingFacts(c);
    const limit = formatBounds(c.limit_min, c.limit_max, c.unit);
    return (
      <Popover label="Heading" tone={c.state === "unknown" ? "default" : c.state} width={300}>
        <dl className="cmp-dl">
          <div className="cmp-dl-row">
            <dt>{c.label}</dt>
            <dd>{c.state !== "unknown" && <VerdictChip verdict={c.state} compact />}</dd>
          </div>
          {limit && (
            <div className="cmp-dl-row">
              <dt>Threshold</dt>
              <dd className="num">{limit}</dd>
            </div>
          )}
          {c.margin_worst !== null && c.margin_worst !== undefined && (
            <div className="cmp-dl-row">
              <dt>Worst-case margin</dt>
              <dd className="num">{formatSignedValue(c.margin_worst, c.unit)}</dd>
            </div>
          )}
        </dl>
        {facts && <p className="cmp-card-note">{facts.line}</p>}
        {facts?.basis && <p className="cmp-card-note">{facts.basis}</p>}
        {h.note && <p className="cmp-card-note">{h.note}</p>}
      </Popover>
    );
  }
  const g = barGeometry(cell, scale);
  const name = barName(cell.c, cell.worst, cell.best);
  const state = cell.c.state;
  return (
    <span className={`cmp-mbar cmp-s-${state}`} role="img" aria-label={name} data-testid="margin-bar">
      <span className="cmp-mbar-track" aria-hidden="true">
        <i className="cmp-mbar-fill" style={{ left: `${g.left}%`, width: `${g.width}%` }} />
        {g.whisker && <i className="cmp-mbar-whisker" style={{ left: `${g.whisker.left}%`, width: `${g.whisker.width}%` }} />}
        <i className="cmp-mbar-limit" />
      </span>
      <span className="num cmp-mbar-text" aria-hidden="true">
        {formatSignedValue(cell.nominal, cell.c.unit)}
      </span>
    </span>
  );
}
