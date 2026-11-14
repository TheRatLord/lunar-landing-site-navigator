import { utcText } from "../../lib/time";
import type { CompareMetric, CompareResult, ServiceConstraintVerdict } from "../../api/planning";
import { VerdictChip } from "../../components/ui/VerdictChip";
import { formatLat, formatLon } from "../../lib/coords";
import { formatNum, formatValue } from "../../lib/format";
import { whenLines } from "../../lib/when";
import { constraintLine, headingCell, headingFacts, rowDecimals } from "../calendar/format";
import { differingConstraints, differingMetrics } from "./matrixDiff";
import { CellVerdict } from "./Shortlist";

function ConstraintCell({ c }: { c: ServiceConstraintVerdict | undefined }) {
  if (!c) return <span className="cmp-dim">—</span>;
  if (c.state === "unknown") return <span className="chip chip-unknown">Unknown{c.censored ? ", censored" : ""}</span>;
  const line = constraintLine(c);
  if (line.headingDependent) {
    const h = headingCell(c);
    const facts = headingFacts(c);
    return (
      <span className="cmp-cc">
        <span className="cmp-cc-head">
          <VerdictChip verdict={c.state} compact />
          <span>Depends on heading</span>
        </span>
        <span className="cmp-cc-lines num">
          {h.limit && <span>{h.limit}</span>}
          {h.worst && <span>{h.worst}</span>}
          {facts && <span data-testid="heading-facts">{facts.line}</span>}
          {facts?.basis && <span>{facts.basis}</span>}
          {h.note && <span>{h.note}</span>}
        </span>
      </span>
    );
  }
  return (
    <span className="cmp-cc">
      <span className="cmp-cc-head">
        <VerdictChip verdict={c.state} compact />
        <span className="num">{line.value}</span>
      </span>
      <span className="cmp-cc-lines num">
        {line.limit && <span>{line.limit}</span>}
        <span>{line.nominal}</span>
        <span>{line.worst}</span>
      </span>
    </span>
  );
}

function MetricWhen({ m, i }: { m: CompareMetric; i: number }) {
  const lines = whenLines(m.when?.[i], (v) => formatValue(v, m.unit, rowDecimals(m.values)));
  if (lines.length === 0) return null;
  return (
    <span className="cmp-sub" data-testid="metric-when">
      {lines.map((l) => l.text).join(" · ")}
    </span>
  );
}

function MetricCell({ m, i }: { m: CompareMetric; i: number }) {
  const v = m.values[i];
  const d = rowDecimals(m.values);
  const lo = m.low[i];
  const hi = m.high[i];
  const unit = m.unit && <span className="cmp-dim"> {m.unit}</span>;
  if (v === null || v === undefined) {
    if (lo === null || lo === undefined || hi === null || hi === undefined) return <span className="cmp-dim">—</span>;
    return (
      <span className="num" data-testid="metric-range-only">
        <span className="cmp-dim">—</span>
        <span className="cmp-sub">
          {formatNum(lo, d)} to {formatNum(hi, d)}
          {m.unit && ` ${m.unit}`}
        </span>
      </span>
    );
  }
  const spread = lo !== null && lo !== undefined && hi !== null && hi !== undefined && formatNum(lo, d) !== formatNum(hi, d);
  return (
    <span className="num">
      {formatNum(v, d)}
      {unit}
      {spread && (
        <span className="cmp-sub">
          {formatNum(lo!, d)} to {formatNum(hi!, d)}
        </span>
      )}
    </span>
  );
}

export function Matrix({ result, differencesOnly = false }: { result: CompareResult; differencesOnly?: boolean }) {
  const cols = result.scenarios;
  const keys: string[] = [];
  const labels = new Map<string, string>();
  for (const s of cols)
    for (const c of s.verdict.constraints)
      if (!labels.has(c.key)) {
        keys.push(c.key);
        labels.set(c.key, c.label);
      }
  const differing = differencesOnly ? differingConstraints(cols) : null;
  const differingMetric = differencesOnly ? differingMetrics(result) : null;
  const shownKeys = differing ? keys.filter((k) => differing.has(k)) : keys;
  const shownMetrics = differingMetric ? result.metrics.filter((m) => differingMetric.has(m.key)) : result.metrics;
  const hidden = keys.length - shownKeys.length + result.metrics.length - shownMetrics.length;
  return (
    <div className="cmp-matrix-wrap">
      <table className="cmp-matrix">
        <caption className="sr-only">Options side by side: verdicts, requirements and metrics</caption>
        <thead>
          <tr>
            <th scope="col" className="cmp-matrix-corner">
              {differencesOnly && (
                <span className="cmp-dim num" role="status" data-testid="matrix-hidden">
                  {hidden} hidden
                </span>
              )}
            </th>
            {cols.map((s) => (
              <th key={s.name} scope="col" className="cmp-matrix-col">
                <span className="cmp-col-name">{s.name}</span>
                {s.site.name !== s.name && <span className="cmp-col-sub">{s.site.name}</span>}
                <span className="cmp-col-sub num">
                  {formatLat(s.site.lat_deg, 3)} {formatLon(s.site.lon_deg, 3)}
                </span>
                <span className="cmp-col-sub num">{utcText(s.landing_utc)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Verdict</th>
            {cols.map((s) => (
              <td key={s.name}>
                <CellVerdict state={s.state} />
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">Limiting</th>
            {cols.map((s) => (
              <td key={s.name}>{s.verdict.constraints.find((c) => c.key === s.limiting)?.label ?? s.limiting ?? <span className="cmp-dim">—</span>}</td>
            ))}
          </tr>
          {shownKeys.length > 0 && (
            <tr className="cmp-matrix-section">
              <th scope="colgroup" colSpan={cols.length + 1}>
                Requirements
              </th>
            </tr>
          )}
          {shownKeys.map((k) => (
            <tr key={k}>
              <th scope="row">{labels.get(k)}</th>
              {cols.map((s) => (
                <td key={s.name}>
                  <ConstraintCell c={s.verdict.constraints.find((c) => c.key === k)} />
                </td>
              ))}
            </tr>
          ))}
          {shownMetrics.length > 0 && (
            <tr className="cmp-matrix-section">
              <th scope="colgroup" colSpan={cols.length + 1}>
                Metrics
              </th>
            </tr>
          )}
          {shownMetrics.map((m) => (
            <tr key={m.key}>
              <th scope="row">{m.label}</th>
              {cols.map((s, i) => (
                <td key={s.name}>
                  <MetricCell m={m} i={i} />
                  <MetricWhen m={m} i={i} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
