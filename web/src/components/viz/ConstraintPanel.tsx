import { useMemo, useState } from "react";
import type { ConstraintVerdict, Verdict } from "../../contract/types";
import { formatLimit, formatRange, formatSignedValue, formatValue } from "../../lib/format";
import type { WhenLine } from "../../lib/when";
import { VERDICT_LABEL } from "../../lib/verdict";
import { DataTable, type Column } from "../ui/DataTable";
import { Icon } from "../ui/Icon";
import { Panel } from "../ui/Panel";
import { VerdictChip } from "../ui/VerdictChip";

export interface ConstraintPanelProps {
  constraints: ConstraintVerdict[];
  limitingId: string | null;
  overall: Verdict | null;
  onSelect?: (c: ConstraintVerdict) => void;
  selectedId?: string | null;
  title?: string;
  whenById?: Readonly<Record<string, readonly WhenLine[]>>;
}

const CAUSE_LABEL: Record<string, string> = { heading: "heading", terrain: "terrain", both: "heading and terrain" };
const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function limitText(c: ConstraintVerdict): string {
  const d = c.decimals ?? 2;
  if (c.limit_range) return `within ${formatRange(c.limit_range[0], c.limit_range[1], c.unit, d)}`;
  return c.sense && c.limit !== undefined ? formatLimit(c.sense, c.limit, c.unit, d) : "";
}

type Pair = readonly [string, string];

function detailPairs(c: ConstraintVerdict, when: readonly WhenLine[] | undefined): Pair[] {
  const d = c.decimals ?? 2;
  const out: Pair[] = [];
  const w = c.value_worlds;
  if (w) {
    for (const k of ["optimistic", "pessimistic"] as const) if (w[k] !== null && w[k] !== undefined) out.push([capFirst(k), formatValue(w[k]!, c.unit, d)]);
    if (out.length > 0 && c.case_basis) out.push(["Cases by", c.case_basis]);
  }
  if (c.margin_worst !== undefined) {
    out.push(["Worst margin", formatSignedValue(c.margin_worst, c.unit, d)]);
    if (c.worst_world) out.push(["Worst case", c.worst_world]);
    if (c.worst_limit) {
      const v = c.limit_range ? c.limit_range[c.worst_limit === "min" ? 0 : 1] : c.sense === c.worst_limit ? c.limit : undefined;
      out.push(["Against", v === undefined ? (c.worst_limit === "min" ? "lower threshold" : "upper threshold") : formatLimit(c.worst_limit, v, c.unit, d)]);
    }
  }
  if (when && when.length > 0) out.push(["Minimum at", when.map((l) => l.text).join(" · ")]);
  if (c.cause && CAUSE_LABEL[c.cause]) out.push(["Set by", CAUSE_LABEL[c.cause]!]);
  if (c.heading_dependent && c.heading_note) out.push(["Heading", c.heading_note]);
  return out;
}

export function ConstraintPanel({ constraints, limitingId, overall, onSelect, selectedId, title = "Requirements", whenById }: ConstraintPanelProps) {
  const limiting = useMemo(() => (limitingId ? (constraints.find((c) => c.id === limitingId) ?? null) : null), [constraints, limitingId]);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const counts = { pass: 0, marginal: 0, fail: 0 };
  for (const c of constraints) counts[c.verdict]++;

  const columns: Column<ConstraintVerdict>[] = [
    {
      key: "verdict",
      header: "Verdict",
      width: "88px",
      render: (c) => <VerdictChip verdict={c.verdict} compact />,
    },
    {
      key: "label",
      header: "Requirement",
      render: (c) => {
        const pairs = open.has(c.id) ? detailPairs(c, whenById?.[c.id]) : [];
        return (
          <span className="cp-name">
            <span className="cp-title">
              {c.label}
              {limiting?.id === c.id && <span className="chip cp-limiting">Limiting</span>}
            </span>
            {pairs.length > 0 && (
              <dl className="cp-detail">
                {pairs.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd className="num">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </span>
        );
      },
    },
    {
      key: "value",
      header: "Value",
      numeric: true,
      width: "112px",
      render: (c) =>
        c.heading_dependent ? (
          <span className="faint">by heading</span>
        ) : (
          <span>
            {c.censored ? "≥ " : ""}
            {formatValue(c.value, c.unit, c.decimals ?? 2)}
          </span>
        ),
    },
    {
      key: "limit",
      header: "Threshold",
      numeric: true,
      width: "128px",
      render: (c) => <span className="dim">{limitText(c)}</span>,
    },
    {
      key: "margin",
      header: "Margin",
      numeric: true,
      width: "112px",
      render: (c) =>
        c.heading_dependent ? (
          c.margin_worst !== undefined ? (
            <span>
              <span className={`cp-margin ${c.verdict}`}>{formatSignedValue(c.margin_worst, c.unit, c.decimals ?? 2)}</span> <span className="faint">worst</span>
            </span>
          ) : (
            <span className="faint">—</span>
          )
        ) : (
          <span className={`cp-margin ${c.verdict}`}>{formatSignedValue(c.margin, c.unit, c.decimals ?? 2)}</span>
        ),
    },
    {
      key: "more",
      header: <span className="sr-only">Details</span>,
      width: "36px",
      render: (c) => {
        if (detailPairs(c, whenById?.[c.id]).length === 0) return null;
        const isOpen = open.has(c.id);
        return (
          <button
            type="button"
            className="cp-more"
            aria-expanded={isOpen}
            aria-label={`Details for ${c.label}`}
            onClick={(e) => {
              e.stopPropagation();
              toggle(c.id);
            }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Icon name={isOpen ? "chevronUp" : "chevronDown"} size={12} />
          </button>
        );
      },
    },
  ];

  return (
    <Panel
      title={title}
      flush
      actions={
        constraints.length > 0 && (
          <div className="cp-summary" role="group" aria-label={overall ? `Overall ${VERDICT_LABEL[overall]}: ${counts.pass} pass, ${counts.marginal} marginal, ${counts.fail} fail` : "Overall verdict not stated"}>
            {overall && <VerdictChip verdict={overall} compact />}
            <span className="cp-counts num">
              <span className="pass">
                <Icon name="check" size={12} /> {counts.pass}
              </span>
              <span className="marginal">
                <Icon name="warn" size={12} /> {counts.marginal}
              </span>
              <span className="fail">
                <Icon name="cross" size={12} /> {counts.fail}
              </span>
            </span>
          </div>
        )
      }
    >
      <div className="cp">
        <DataTable
          caption="Requirement verdicts"
          columns={columns}
          rows={constraints}
          rowKey={(c) => c.id}
          selectedKey={selectedId}
          onRowClick={onSelect}
          empty="No requirements set"
        />
      </div>
    </Panel>
  );
}
