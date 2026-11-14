import { useId, type ReactNode } from "react";
import type { SlipRow } from "../../api/planning";
import { formatSigned } from "../../lib/format";
import { kindMarginName, kindWord, type ServedMarginKind } from "../../lib/marginKind";
import { slipChartPoints, type SlipPoint } from "../calendar/format";
import { VERDICT_LABEL } from "../../lib/verdict";

const W = 440;
const H = 250;
const M = { l: 46, r: 12, t: 12, b: 30 };

function niceStep(span: number): number {
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag;
}

type Kind = ServedMarginKind | null;

function shape(kind: Kind, cx: number, cy: number): ReactNode {
  if (kind === "nominal") return <rect x={cx - 4.5} y={cy - 4.5} width={9} height={9} />;
  if (kind === "best_case") return <path d={`M${cx},${cy - 6.5} L${cx + 6.5},${cy} L${cx},${cy + 6.5} L${cx - 6.5},${cy} Z`} />;
  if (kind === "worst_case") return <circle cx={cx} cy={cy} r={5} />;
  return <circle cx={cx} cy={cy} r={3.2} />;
}

function runsByKind(pts: readonly SlipPoint[]): SlipPoint[][] {
  const runs: SlipPoint[][] = [];
  for (const p of pts) {
    const last = runs[runs.length - 1];
    if (last && last[0]!.kind === p.kind) last.push(p);
    else runs.push([p]);
  }
  return runs;
}

export function SlipChart({ rows }: { rows: SlipRow[] }) {
  const id = useId();
  const { unit, points, kinds } = slipChartPoints(rows);
  const pts = points.sort((a, b) => a.row.slip_h - b.row.slip_h);
  if (pts.length === 0) {
    return (
      <div className="cmp-nochart" role="note" data-testid="slip-no-margin">
        <span>No margins</span>
        {[...new Set(rows.map((r) => r.margin_note).filter((n): n is string => n !== null))].map((n) => (
          <span key={n} className="cmp-note">
            {n}
          </span>
        ))}
      </div>
    );
  }
  const xs = pts.map((p) => p.row.slip_h);
  const ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(0, ...ys);
  const y1 = Math.max(0, ...ys);
  const ySpan = y1 - y0 || 1;
  const xSpan = x1 - x0 || 1;
  const X = (v: number) => M.l + ((v - x0) / xSpan) * (W - M.l - M.r);
  const Y = (v: number) => H - M.b - ((v - y0) / ySpan) * (H - M.t - M.b);
  const yStep = niceStep(ySpan);
  const yTicks: number[] = [];
  for (let v = Math.ceil(y0 / yStep) * yStep; v <= y1 + 1e-9; v += yStep)
    yTicks.push(Number(v.toFixed(6)));
  const lines = runsByKind(pts)
    .filter((run) => run.length > 1)
    .map((run) => run.map((p, i) => `${i ? "L" : "M"}${X(p.row.slip_h).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" "));
  const axis = unit ? `Worst-case margin (${unit})` : `${kinds.length === 1 ? kindMarginName(kinds[0]) : "Margin"} (× margin scale)`;
  const pointText = (p: SlipPoint) => `${p.row.slip_h} h ${p.row.state} ${kindWord(p.kind) ?? "margin"} ${formatSigned(p.y, 1)}`;
  const summary = `${axis} against delay: ${pts.map(pointText).join("; ")}${kinds.length > 1 ? ". Points of different kinds are not joined" : ""}`;
  return (
    <>
      <svg
        className="slip-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-labelledby={id}
      >
        <title id={id}>{summary}</title>
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={M.l}
              x2={W - M.r}
              y1={Y(v)}
              y2={Y(v)}
              className={v === 0 ? "slip-zero" : "slip-grid"}
            />
            <text x={M.l - 6} y={Y(v) + 3} textAnchor="end" className="slip-tick">
              {v}
            </text>
          </g>
        ))}
        {pts.map((p, i) =>
          i === 0 || X(p.row.slip_h) - X(pts[i - 1]!.row.slip_h) >= 30 ? (
            <text
              key={p.row.slip_h}
              x={X(p.row.slip_h)}
              y={H - M.b + 14}
              textAnchor="middle"
              className="slip-tick"
            >
              {p.row.slip_h > 0 ? "+" : ""}
              {p.row.slip_h}
            </text>
          ) : null,
        )}
        <text
          x={(M.l + W - M.r) / 2}
          y={H - 3}
          textAnchor="middle"
          className="slip-axis"
        >
          Delay (h)
        </text>
        <text
          transform={`translate(11 ${(M.t + H - M.b) / 2}) rotate(-90)`}
          textAnchor="middle"
          className="slip-axis"
        >
          {axis}
        </text>
        {lines.map((d) => (
          <path key={d} d={d} className="slip-line" />
        ))}
        {pts.map((p) => (
          <g key={p.row.slip_h} className={`slip-${p.row.state}`}>
            <title>{pointText(p)}</title>
            {shape(p.kind, X(p.row.slip_h), Y(p.y))}
          </g>
        ))}
      </svg>
      <ul className="slip-legend" aria-label="Chart key" data-testid="slip-legend">
        {kinds.map((k) => (
          <li key={k}>
            <svg viewBox="0 0 14 14" width={14} height={14} aria-hidden="true" className="slip-chart">
              <g className="slip-key">{shape(k, 7, 7)}</g>
            </svg>
            {kindMarginName(k)}
          </li>
        ))}
        {(["pass", "marginal", "fail"] as const).map((v) => (
          <li key={v}>
            <svg viewBox="0 0 14 14" width={14} height={14} aria-hidden="true" className="slip-chart">
              <g className={`slip-${v}`}>{shape(null, 7, 7)}</g>
            </svg>
            {VERDICT_LABEL[v]}
          </li>
        ))}
      </ul>
    </>
  );
}
