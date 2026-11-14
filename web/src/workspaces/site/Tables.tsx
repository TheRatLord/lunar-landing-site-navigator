import type { EvaluateResult, MetricJson } from "../../api/site";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { Disclosure } from "../../components/ui/Disclosure";
import { Popover } from "../../components/ui/Popover";
import { formatValue } from "../../lib/format";
import { metricWhenLines, metricNoteText, metricRangeText, metricValueText } from "./adapt";

function MetricDetail({ m }: { m: MetricJson }) {
  const lines = metricWhenLines([m])[m.key] ?? [];
  const note = metricNoteText(m);
  const res = m.when_resolution_s;
  const hasRes = res !== null && res !== undefined;
  if (!note && lines.length === 0 && !hasRes && !m.when_basis) return null;
  return (
    <Popover label="Details" icon={note ? "alert" : "clock"} align="end" width={360}>
      <div className="mt-detail">
        {note && <p>{note}</p>}
        {lines.length > 0 && (
          <ul className="mt-when" aria-label={`When the ${m.label.toLowerCase()} occurs`}>
            {lines.map((l) => (
              <li key={l.world} className="num">
                {l.text}
              </li>
            ))}
          </ul>
        )}
        {hasRes && <p className="faint num">resolution {formatValue(res, "s", Number.isInteger(res) ? 0 : 2)}</p>}
        {m.when_basis && <p className="faint">{m.when_basis}</p>}
      </div>
    </Popover>
  );
}

const COLUMNS: Column<MetricJson>[] = [
  { key: "label", header: "Metric", render: (m) => m.label },
  { key: "value", header: "Value", numeric: true, render: (m) => <span className="num">{metricValueText(m)}</span> },
  { key: "range", header: "Range", numeric: true, render: (m) => <span className="num">{metricRangeText(m)}</span> },
  { key: "unit", header: "Unit", render: (m) => <span className="faint">{m.unit || "—"}</span> },
  { key: "detail", header: <span className="sr-only">Details</span>, width: "1%", render: (m) => <MetricDetail m={m} /> },
];

export function MetricsTable({ result }: { result: EvaluateResult }) {
  return (
    <Disclosure title="All metrics" count={result.metrics.length}>
      <DataTable columns={COLUMNS} rows={result.metrics} rowKey={(m) => m.key} caption="Evaluation metrics with units and bounds" empty="No metrics" />
    </Disclosure>
  );
}
