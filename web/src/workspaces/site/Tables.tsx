import type { EvaluateResult, MetricJson } from "../../api/site";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { Disclosure } from "../../components/ui/Disclosure";
import { Popover } from "../../components/ui/Popover";
import { quantityText, whenText } from "../../components/viz/units";
import { glueQuantities } from "../../lib/format";
import { whenLines } from "../../lib/when";

const q = (v: number | null, unit: string) => quantityText(v, unit, { decimals: unit === "fraction" || unit === "" ? 0 : 1 });

function valueText(m: MetricJson): string {
  const lo = m.low;
  const hi = m.high;
  if (m.value === null) {
    if (lo !== null && hi !== null) return q(lo, m.unit) === q(hi, m.unit) ? q(lo, m.unit) : `${q(lo, m.unit)} to ${q(hi, m.unit)}`;
    return m.censored ? "none" : "—";
  }
  return `${m.censored ? "≥ " : ""}${q(m.value, m.unit)}`;
}

function rangeText(m: MetricJson): string {
  if (m.value === null || m.low === null || m.high === null) return "";
  const lo = q(m.low, m.unit);
  const hi = q(m.high, m.unit);
  if (lo === hi) return "";
  return `${lo} to ${m.one_sided ? "≥ " : ""}${hi}`;
}

function MetricDetail({ m }: { m: MetricJson }) {
  const lines = whenLines(m.when).filter((l) => l.t_ms !== null);
  const note = m.note ? glueQuantities(m.note) : "";
  if (!note && lines.length === 0) return null;
  return (
    <Popover label="Details" iconOnly icon={note ? "alert" : "clock"} align="end" width={320}>
      <div className="mt-detail">
        {note && <p>{note}</p>}
        {lines.length > 0 && <p className="num">{[...new Set(lines.map((l) => whenText(l.t_ms!)))].join(", ")}</p>}
      </div>
    </Popover>
  );
}

const COLUMNS: Column<MetricJson>[] = [
  { key: "label", header: "Metric", render: (m) => m.label },
  { key: "value", header: "Value", numeric: true, render: (m) => <span className="num">{valueText(m)}</span> },
  { key: "range", header: "Best to worst", numeric: true, render: (m) => <span className="num dim">{rangeText(m)}</span> },
  { key: "detail", header: <span className="sr-only">Details</span>, width: "1%", render: (m) => <MetricDetail m={m} /> },
];

export function MetricsTable({ result }: { result: EvaluateResult }) {
  return (
    <Disclosure title="All metrics" count={result.metrics.length}>
      <DataTable columns={COLUMNS} rows={result.metrics} rowKey={(m) => m.key} caption="Evaluation metrics" empty="No metrics" />
    </Disclosure>
  );
}
