import { requirementName } from "../../lib/requirements";
import type { EllipseResult, EllipseSampleRef, SampleState } from "../../api/ellipse";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { Disclosure } from "../../components/ui/Disclosure";
import { Pairs } from "../../components/ui/Pairs";
import { VerdictChip } from "../../components/ui/VerdictChip";
import { withUnit } from "../../lib/format";
import { STATES, STATE_LABEL, limitInfo, marginText, offsetText, percent, standardError, stateShares } from "./adapt";
import type { Marker } from "./EllipsePlot";

function StateChip({ state }: { state: SampleState }) {
  if (state === "unknown") return <span className="chip chip-unknown">Unknown</span>;
  return <VerdictChip verdict={state} compact />;
}

const share = (v: number | null) => (v === null || !Number.isFinite(v) ? "n/a" : (v * 100).toFixed(1));

export function ResultStats({ result }: { result: EllipseResult }) {
  const shares = stateShares(result);
  const c = result.convergence;
  const shown = STATES.filter((s) => s !== "unknown" || (shares[s] ?? 0) > 0);
  return (
    <section className="el-sec el-outcome" aria-label="Verdict summary">
      <h3 className="el-sec-title">Verdicts</h3>
      <div className="el-stack" role="img" aria-label={STATES.map((s) => `${STATE_LABEL[s]} ${percent(shares[s])}`).join(", ")}>
        {STATES.map((s) => ((shares[s] ?? 0) > 0 ? <span key={s} className={`el-seg el-seg-${s}`} style={{ width: `${(shares[s] ?? 0) * 100}%` }} /> : null))}
      </div>
      <dl className="el-shares">
        {shown.map((s) => (
          <div key={s} className="el-share" data-state={s} data-zero={(shares[s] ?? 0) > 0 ? undefined : true} data-testid={s === "pass" ? "pass-fraction" : undefined}>
            <dt>{STATE_LABEL[s]}</dt>
            <dd className="num">
              {share(shares[s])}
              <span>%</span>
            </dd>
            {s !== "unknown" && (shares[s] ?? 0) > 0 && (shares[s] ?? 0) < 1 && <span className="el-share-se num">{standardError(c, s)}</span>}
          </div>
        ))}
      </dl>
    </section>
  );
}

export function Warnings({ result }: { result: EllipseResult }) {
  if (result.warnings.length === 0) return null;
  return (
    <ul className="el-warnings" role="status">
      {result.warnings.map((w) => (
        <li key={w}>{w}</li>
      ))}
    </ul>
  );
}

interface PointRow {
  key: Marker;
  role: string;
  ref: EllipseSampleRef;
}

export function PointsPanel({ result, selected, onSelect }: { result: EllipseResult; selected: Marker | null; onSelect: (m: Marker | null) => void }) {
  const rows: PointRow[] = [
    { key: "worst", role: "Worst", ref: result.worst },
    { key: "best", role: "Best", ref: result.best },
    { key: "centre", role: "Centre", ref: result.centre },
  ];
  const sameLimit = rows.every((r) => r.ref.limiting === rows[0]!.ref.limiting);
  const cols: Column<PointRow>[] = [
    {
      key: "role",
      header: "Point",
      render: (r) => (
        <span className="el-cellstack">
          <span>{r.role}</span>
          {!sameLimit && r.ref.limiting && <span className="faint">{requirementName(r.ref.limiting, limitInfo(result.scenario, r.ref.limiting).label)}</span>}
        </span>
      ),
    },
    { key: "state", header: "Verdict", render: (r) => <StateChip state={r.ref.state} /> },
    {
      key: "m",
      header: "Margin",
      numeric: true,
      render: (r) => (
        <>{marginText(r.ref)}</>
      ),
    },
  ];
  const sel = rows.find((r) => r.key === selected)?.ref ?? null;
  return (
    <section className="el-sec" aria-label="Points">
      <h3 className="el-sec-title">
        Landing points
        {sameLimit && rows[0]!.ref.limiting && <span className="el-sec-note">limited by {requirementName(rows[0]!.ref.limiting, limitInfo(result.scenario, rows[0]!.ref.limiting).label).toLowerCase()}</span>}
      </h3>
      <DataTable columns={cols} rows={rows} rowKey={(r) => r.key} caption="Worst, best and centre landing points of the sample" selectedKey={selected} onRowClick={(r) => onSelect(selected === r.key ? null : r.key)} />
      {sel && (
        <div className="el-detail" data-testid="ellipse-point">
          <Pairs
            className="el-dl"
            rows={[
              ["Limiting requirement", sel.limiting ? requirementName(sel.limiting, limitInfo(result.scenario, sel.limiting).label) : "none"],
              ["Offset", offsetText(sel.east_m, sel.north_m)],
              sel.slope_deg !== null && sel.slope_deg !== undefined ? ["Slope", withUnit(sel.slope_deg.toFixed(1), "°")] : null,
              sel.margin_note ? ["Note", <span key="n" data-testid="ellipse-margin-note">{sel.margin_note}</span>] : null,
            ]}
          />
        </div>
      )}
    </section>
  );
}

interface ConstraintRow {
  key: string;
  label: string;
  rule: string;
  pass: number | null;
  notFail: number | null;
  unknown: number | null;
}

export function ConstraintTable({ result }: { result: EllipseResult }) {
  const rows: ConstraintRow[] = Object.entries(result.constraint_probability).map(([key, p]) => {
    const info = limitInfo(result.scenario, key);
    return { key, label: info.label, rule: info.rule, pass: p["pass"] ?? null, notFail: p["not_fail"] ?? null, unknown: p["unknown"] ?? null };
  });
  if (rows.length === 0) return null;
  const anyUnknown = rows.some((r) => (r.unknown ?? 0) > 0);
  const cols: Column<ConstraintRow>[] = [
    {
      key: "c",
      header: "Requirement",
      render: (r) => (
        <span className="el-cellstack">
          <span>{r.label}</span>
          {r.rule && <span className="faint num">{r.rule}</span>}
        </span>
      ),
    },
    { key: "pass", header: "Pass", numeric: true, render: (r) => percent(r.pass) },
    { key: "nf", header: "Pass or marginal", numeric: true, render: (r) => percent(r.notFail) },
    ...(anyUnknown ? [{ key: "u", header: "Unknown", numeric: true, render: (r: ConstraintRow) => percent(r.unknown) }] : []),
  ];
  return (
    <section className="el-sec" aria-label="Requirements">
      <h3 className="el-sec-title">Requirements</h3>
      <DataTable columns={cols} rows={rows} rowKey={(r) => r.key} caption="Probability of meeting each requirement over the landing ellipse" />
    </section>
  );
}

function ClosingPairs({ result }: { result: EllipseResult }) {
  const closing = Object.entries(result.closing_constraints ?? {})
    .map(([key, count]) => ({ key, count, frac: result.closing_fraction?.[key] ?? null }))
    .sort((a, b) => b.count - a.count);
  return (
    <div data-testid="ellipse-closing">
      <Pairs className="el-dl" rows={closing.map((c) => [limitInfo(result.scenario, c.key).label, percent(c.frac)])} />
    </div>
  );
}

export function ResultDetails({ result }: { result: EllipseResult }) {
  const hasClosing = Object.keys(result.closing_constraints ?? {}).length > 0;
  return (
    <div className="el-more">
      {!result.convergence.converged && <p className="chip chip-marginal">Result not yet stable: run more points</p>}
      {hasClosing && (
        <Disclosure title="Why points fail">
          <ClosingPairs result={result} />
        </Disclosure>
      )}
    </div>
  );
}
