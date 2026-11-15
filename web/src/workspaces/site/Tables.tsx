import type { EvaluateResult, MetricJson } from "../../api/site";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { Disclosure } from "../../components/ui/Disclosure";
import { Popover } from "../../components/ui/Popover";
import { quantityText, whenText } from "../../components/viz/units";
import { metricName } from "../../lib/requirements";
import { glueQuantities } from "../../lib/format";
import { whenLines } from "../../lib/when";

const q = (v: number | null, unit: string) => quantityText(v, unit);

function valueText(m: MetricJson): string {
  const lo = m.low;
  const hi = m.high;
  if (m.value === null) {
    if (lo !== null && hi !== null) return q(lo, m.unit) === q(hi, m.unit) ? q(lo, m.unit) : `${q(lo, m.unit)} to ${q(hi, m.unit)}`;
    return m.censored ? "none" : "—";
  }
  return `${m.censored ? "≥ " : ""}${q(m.value, m.unit)}`;
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

const REPEATED = new Set(["contact_sunlit_hours", "time_to_next_sunset_h", "time_to_next_earthset_h"]);

const COLUMNS: Column<MetricJson>[] = [
  { key: "label", header: "Metric", render: (m) => metricName(m.key, m.label) },
  { key: "value", header: "Value", numeric: true, render: (m) => <span className="num">{valueText(m)}</span> },
  { key: "detail", header: <span className="sr-only">Details</span>, width: "1%", render: (m) => <MetricDetail m={m} /> },
];

const REQUIREMENT_METRIC: Record<string, string> = { max_dark_span_h: "longest_dark_span_h", max_slope_deg: "slope_deg", max_contact_gap_h: "longest_outage_h" };

export function MetricsTable({ result }: { result: EvaluateResult }) {
  const shown = new Set(result.verdict.constraints.map((c) => REQUIREMENT_METRIC[c.key]).filter((k): k is string => k !== undefined));
  const rows = result.metrics.filter((m) => !REPEATED.has(m.key) && !shown.has(m.key));
  return (
    <Disclosure title="All metrics" count={rows.length}>
      <DataTable columns={COLUMNS} rows={rows} rowKey={(m) => m.key} caption="Evaluation metrics" empty="No metrics" />
    </Disclosure>
  );
}
