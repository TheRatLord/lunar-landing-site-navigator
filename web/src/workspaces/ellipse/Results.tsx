import type { EllipseResult, EllipseSampleRef, SampleState } from "../../api/ellipse";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { Disclosure } from "../../components/ui/Disclosure";
import { Pairs } from "../../components/ui/Pairs";
import { Stat } from "../../components/ui/Stat";
import { VerdictChip } from "../../components/ui/VerdictChip";
import { formatLat, formatLon } from "../../lib/coords";
import { formatSig, withUnit } from "../../lib/format";
import { kindWord } from "../../lib/marginKind";
import { BASIS_LABEL, type Basis } from "../../scenario/types";
import { TerrainStackTag } from "../search/TerrainStackTag";
import { PROB_KEY, STATES, STATE_LABEL, hazardOriginText, isUnpublished, limitInfo, marginText, offsetText, percent, standardError, stateShares } from "./adapt";
import type { Marker } from "./EllipsePlot";

function EstimateTag({ basis }: { basis: Basis | null | undefined }) {
  if (!basis || !isUnpublished(basis)) return null;
  return <span className="chip chip-marginal">{BASIS_LABEL[basis]}</span>;
}

function StateChip({ state }: { state: SampleState }) {
  if (state === "unknown") return <span className="chip chip-unknown">Unknown</span>;
  return <VerdictChip verdict={state} compact />;
}

const share = (v: number | null) => (v === null || !Number.isFinite(v) ? "n/a" : (v * 100).toFixed(1));

export function ResultStats({ result }: { result: EllipseResult }) {
  const shares = stateShares(result);
  const c = result.convergence;
  const worst = result.worst;
  const worstLimit = worst.limiting ? limitInfo(result.scenario, worst.limiting).label : null;
  const tone = (s: SampleState, v: number | null) => (s !== "unknown" && (v ?? 0) > 0 ? s : "default");
  const margin = marginText(worst);
  const cut = margin.search(/\s\S+$/);
  return (
    <section className="el-stats" aria-label="Verdict summary">
      <div className="el-stats-row">
        <span data-testid="pass-fraction">
          <Stat label="Pass" value={share(shares.pass)} unit="%" tone={tone("pass", shares.pass)} sub={standardError(c, "pass")} />
        </span>
        <Stat label="Marginal" value={share(shares.marginal)} unit="%" tone={tone("marginal", shares.marginal)} sub={standardError(c, "marginal")} />
        <Stat label="Fail" value={share(shares.fail)} unit="%" tone={tone("fail", shares.fail)} sub={standardError(c, "fail")} />
        <Stat
          label="Worst margin"
          value={cut < 0 ? margin : margin.slice(0, cut)}
          unit={cut < 0 ? undefined : margin.slice(cut + 1)}
          tone={tone(worst.state, 1)}
          sub={[kindWord(worst.margin_kind), worstLimit].filter(Boolean).join(" · ") || undefined}
        />
      </div>
      <div className="el-stack" role="img" aria-label={STATES.map((s) => `${STATE_LABEL[s]} ${percent(shares[s])}`).join(", ")}>
        {STATES.map((s) => ((shares[s] ?? 0) > 0 ? <span key={s} className={`el-seg el-seg-${s}`} style={{ width: `${(shares[s] ?? 0) * 100}%` }} /> : null))}
      </div>
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
  const cols: Column<PointRow>[] = [
    { key: "role", header: "Point", render: (r) => r.role },
    { key: "state", header: "Verdict", render: (r) => <StateChip state={r.ref.state} /> },
    {
      key: "m",
      header: "Margin",
      numeric: true,
      render: (r) => (
        <>
          {marginText(r.ref)} <span className="faint">{kindWord(r.ref.margin_kind)}</span>
        </>
      ),
    },
  ];
  const sel = rows.find((r) => r.key === selected)?.ref ?? null;
  return (
    <section className="el-sec" aria-label="Points">
      <DataTable columns={cols} rows={rows} rowKey={(r) => r.key} caption="Worst, best and centre landing points of the sample" selectedKey={selected} onRowClick={(r) => onSelect(selected === r.key ? null : r.key)} />
      {sel && (
        <div className="el-detail" data-testid="ellipse-point">
          <Pairs
            className="el-dl"
            rows={[
              ["Limiting", sel.limiting ? limitInfo(result.scenario, sel.limiting).label : "none"],
              ["Offset", offsetText(sel.east_m, sel.north_m)],
              sel.lat_deg !== undefined && sel.lon_deg !== undefined ? ["Position", `${formatLat(sel.lat_deg, 5)} ${formatLon(sel.lon_deg, 5)}`] : null,
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
  basis: Basis | null;
  pass: number | null;
  notFail: number | null;
  unknown: number | null;
}

export function ConstraintTable({ result }: { result: EllipseResult }) {
  const rows: ConstraintRow[] = Object.entries(result.constraint_probability).map(([key, p]) => {
    const info = limitInfo(result.scenario, key);
    return { key, label: info.label, rule: info.rule ? withUnit(info.rule, info.unit) : "", basis: info.basis, pass: p["pass"] ?? null, notFail: p["not_fail"] ?? null, unknown: p["unknown"] ?? null };
  });
  if (rows.length === 0) return null;
  const anyUnknown = rows.some((r) => (r.unknown ?? 0) > 0);
  const cols: Column<ConstraintRow>[] = [
    {
      key: "c",
      header: "Requirement",
      render: (r) => (
        <span className="el-cellstack">
          <span className="row">
            {r.label} <EstimateTag basis={r.basis} />
          </span>
          {r.rule && <span className="faint num">{r.rule}</span>}
        </span>
      ),
    },
    { key: "pass", header: "Pass", numeric: true, render: (r) => percent(r.pass) },
    { key: "nf", header: "Not fail", numeric: true, render: (r) => percent(r.notFail) },
    ...(anyUnknown ? [{ key: "u", header: "Unknown", numeric: true, render: (r: ConstraintRow) => percent(r.unknown) }] : []),
  ];
  return (
    <section className="el-sec" aria-label="Requirements">
      <DataTable columns={cols} rows={rows} rowKey={(r) => r.key} caption="Probability of meeting each requirement over the landing ellipse" />
    </section>
  );
}

interface PctRow {
  key: string;
  label: string;
  unit: string;
  basis: Basis | null;
  stats: Record<string, number | null>;
}

const PCT_COLS = ["p5", "p25", "p50", "p75", "p95"] as const;
const num = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "n/a" : Number(v.toPrecision(4)).toString().replace(/^-/, "\u2212"));

function PercentileTable({ result }: { result: EllipseResult }) {
  const rows: PctRow[] = Object.entries(result.percentiles).map(([key, stats]) => {
    const info = limitInfo(result.scenario, key);
    return { key, label: info.label, unit: info.unit, basis: info.basis, stats };
  });
  const cols: Column<PctRow>[] = [
    {
      key: "v",
      header: "Requirement",
      render: (r) => (
        <span className="row">
          {r.label} <EstimateTag basis={r.basis} /> <span className="faint">{r.unit}</span>
        </span>
      ),
    },
    ...PCT_COLS.map<Column<PctRow>>((p) => ({ key: p, header: p.toUpperCase(), numeric: true, render: (r) => num(r.stats[p]) })),
    { key: "min", header: "Min", numeric: true, render: (r) => num(r.stats["min"]) },
    { key: "max", header: "Max", numeric: true, render: (r) => num(r.stats["max"]) },
  ];
  return (
    <div className="el-scroll">
      <DataTable columns={cols} rows={rows} rowKey={(r) => r.key} caption="Percentiles, minimum and maximum of every requirement value over the landing ellipse" empty="No percentiles" />
    </div>
  );
}

function ConvergenceTable({ result }: { result: EllipseResult }) {
  const c = result.convergence;
  const cols: Column<(typeof c.rows)[number]>[] = [
    { key: "n", header: "Points", numeric: true, render: (r) => r.n.toLocaleString("en-US") },
    { key: "pass", header: "Pass", numeric: true, render: (r) => percent(r.pass) },
    { key: "marginal", header: "Marginal", numeric: true, render: (r) => percent(r.marginal) },
    { key: "fail", header: "Fail", numeric: true, render: (r) => percent(r.fail) },
  ];
  return (
    <>
      <DataTable columns={cols} rows={c.rows} rowKey={(r) => String(r.n)} caption="Verdict shares among the first n sampled points" />
      <Pairs
        className="el-dl"
        rows={[
          ["Last halving", withUnit((c.max_change_last_halving * 100).toFixed(1), "%")],
          ["Tolerance", withUnit((c.tolerance * 100).toFixed(1), "%")],
        ]}
      />
    </>
  );
}

function HazardPairs({ result }: { result: EllipseResult }) {
  const slope = result.hazard_limits["slope_deg"] ?? null;
  const rough = result.hazard_limits["roughness_m"] ?? null;
  const origin = (key: string) => {
    const o = hazardOriginText(result.hazard_origins?.[key]);
    if (!o) return null;
    return (
      <span data-testid="ellipse-hazard-origin" className="faint">
        {o.url ? (
          <a href={o.url} target="_blank" rel="noreferrer noopener">
            {o.text}
          </a>
        ) : (
          o.text
        )}
      </span>
    );
  };
  const hazardPass = result.state_probability_non_hazardous[PROB_KEY.pass] ?? null;
  return (
    <Pairs
      className="el-dl"
      rows={[
        ["Hazardous", percent(result.hazard_fraction)],
        slope !== null ? ["Slope over", <span key="s" className="row">{withUnit(String(slope), "°")} {origin("slope_deg")}</span>] : null,
        rough !== null ? ["Roughness over", <span key="r" className="row">{withUnit(String(rough), "m")} {origin("roughness_m")}</span>] : null,
        hazardPass !== null ? ["Pass elsewhere", percent(hazardPass)] : null,
      ]}
    />
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

function ProvenancePairs({ result, relief }: { result: EllipseResult; relief: number | null }) {
  const ell = (result.scenario as { ellipse?: { dispersion?: string; sigma_level?: number } } | null)?.ellipse;
  return (
    <div className="el-prov">
      <TerrainStackTag stack={result.terrain_stack} />
      <Pairs
        className="el-dl"
        rows={[
          ["Horizon", result.provider === "terrain" ? "Terrain" : "Smooth sphere"],
          ["Points", result.n_samples.toLocaleString("en-US")],
          ["Seed", String(result.seed)],
          ["Scheme", result.scheme],
          ell?.dispersion ? ["Dispersion", `${ell.dispersion}${ell.dispersion === "gaussian" && result.truncated_to_ellipse ? ` · truncated ${ell.sigma_level}σ` : ""}`] : null,
          relief !== null ? ["Relief source", withUnit(formatSig(relief, 3, { trim: true }), "m")] : null,
          result.scenario_sha256 ? ["Plan", <span key="h" className="mono">{result.scenario_sha256.slice(0, 12)}</span>] : null,
        ]}
      />
    </div>
  );
}

export function ResultDetails({ result, relief }: { result: EllipseResult; relief: number | null }) {
  const c = result.convergence;
  const hasClosing = Object.keys(result.closing_constraints ?? {}).length > 0;
  return (
    <div className="el-more">
      {hasClosing && (
        <Disclosure title="Failing points">
          <ClosingPairs result={result} />
        </Disclosure>
      )}
      <Disclosure title="Hazard">
        <HazardPairs result={result} />
      </Disclosure>
      <Disclosure
        title={
          <>
            Convergence
            {!c.converged && <span className="chip chip-marginal">Not settled</span>}
          </>
        }
      >
        <ConvergenceTable result={result} />
      </Disclosure>
      <Disclosure title="Distribution">
        <PercentileTable result={result} />
      </Disclosure>
      <Disclosure title="Provenance">
        <ProvenancePairs result={result} relief={relief} />
      </Disclosure>
    </div>
  );
}
