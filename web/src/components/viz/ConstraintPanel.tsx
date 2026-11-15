import { Fragment, useState } from "react";
import type { ConstraintVerdict, Verdict } from "../../contract/types";
import type { WhenLine } from "../../lib/when";
import { Icon, type IconName } from "../ui/Icon";
import { Panel } from "../ui/Panel";
import { quantityText, whenText } from "./units";
import { requirementName } from "../../lib/requirements";

export interface ConstraintPanelProps {
  constraints: ConstraintVerdict[];
  limitingId: string | null;
  title?: string;
  whenById?: Readonly<Record<string, readonly WhenLine[]>>;
  showable?: ReadonlySet<string>;
  onShow?: (id: string) => void;
}

const VERDICT_ICON: Record<Verdict, IconName> = { pass: "check", marginal: "warn", fail: "cross" };
const VERDICT_WORD: Record<Verdict, string> = { pass: "Pass", marginal: "Marginal", fail: "Fail" };
const CAUSE_LABEL: Record<string, string> = { heading: "Heading", terrain: "Terrain", both: "Heading and terrain" };

export function limitText(c: Pick<ConstraintVerdict, "limit" | "limit_range" | "sense" | "unit">): string {
  if (c.limit_range) return `${quantityText(c.limit_range[0], c.unit, { exact: true })}–${quantityText(c.limit_range[1], c.unit, { exact: true })}`;
  if (!c.sense || c.limit === undefined) return "";
  return `${c.sense === "min" ? "≥" : "≤"} ${quantityText(c.limit, c.unit, { exact: true })}`;
}

function valueText(c: ConstraintVerdict): string {
  if (c.heading_dependent) {
    const worst = c.value_worlds?.pessimistic;
    return worst !== null && worst !== undefined && Number.isFinite(worst) ? quantityText(worst, c.unit) : "by heading";
  }
  return `${c.censored ? "≥ " : ""}${quantityText(c.value, c.unit)}`;
}

function marginOf(c: ConstraintVerdict): number | null {
  if (c.heading_dependent) return c.margin_worst ?? null;
  return Number.isFinite(c.margin) ? c.margin : null;
}

function detailPairs(c: ConstraintVerdict, when: readonly WhenLine[] | undefined): Array<readonly [string, string]> {
  const out: Array<readonly [string, string]> = [];
  const w = c.value_worlds;
  const best = w?.optimistic;
  const worst = w?.pessimistic;
  if (best !== null && best !== undefined && worst !== null && worst !== undefined) {
    const lo = quantityText(worst, c.unit);
    const hi = quantityText(best, c.unit);
    if (lo !== hi) out.push(["Worst to best case", `${lo} to ${hi}`]);
  }
  if (c.margin_worst !== undefined && !c.heading_dependent) {
    const wm = quantityText(c.margin_worst, c.unit, { sign: true });
    if (wm !== quantityText(c.margin, c.unit, { sign: true })) out.push(["Worst margin", wm]);
  }
  const at = (when ?? []).filter((l) => l.t_ms !== null);
  if (at.length > 0) out.push(["When", [...new Set(at.map((l) => whenText(l.t_ms!)))].join(", ")]);
  if (c.cause && CAUSE_LABEL[c.cause]) out.push(["Set by", CAUSE_LABEL[c.cause]!]);
  if (c.heading_dependent && c.heading_note) out.push(["Heading", c.heading_note]);
  return out;
}

export function ConstraintPanel({ constraints, limitingId, title = "Requirements", whenById, showable, onShow }: ConstraintPanelProps) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Panel title={title} flush>
      {constraints.length === 0 ? (
        <p className="cp-empty">No requirements set</p>
      ) : (
        <table className="cp">
          <caption className="sr-only">Requirement verdicts</caption>
          <thead>
            <tr>
              <th scope="col">Requirement</th>
              <th scope="col" className="cp-n">
                Value
              </th>
              <th scope="col" className="cp-n">
                Limit
              </th>
              <th scope="col" className="cp-n">
                Margin
              </th>
            </tr>
          </thead>
          <tbody>
            {constraints.map((c) => {
              const pairs = detailPairs(c, whenById?.[c.id]);
              const isOpen = open === c.id && pairs.length > 0;
              const m = marginOf(c);
              const shows = c.verdict !== "pass" && onShow !== undefined && (showable?.has(c.id) ?? false);
              const clickable = pairs.length > 0 || shows;
              const act = () => {
                if (pairs.length > 0) setOpen(isOpen ? null : c.id);
                if (shows && !isOpen) onShow(c.id);
              };
              return (
                <Fragment key={c.id}>
                  <tr
                    className={`cp-row ${clickable ? "cp-click" : ""} ${isOpen ? "is-open" : ""}`}
                    onClick={clickable ? act : undefined}
                    onKeyDown={(e) => {
                      if (clickable && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        act();
                      }
                    }}
                    tabIndex={clickable ? 0 : undefined}
                    aria-expanded={pairs.length > 0 ? isOpen : undefined}
                  >
                    <th scope="row">
                      <span className="cp-name">
                        <span className={`cp-icon ${c.verdict}`} role="img" aria-label={VERDICT_WORD[c.verdict]}>
                          <Icon name={VERDICT_ICON[c.verdict]} size={12} strokeWidth={2.2} />
                        </span>
                        <span>{requirementName(c.id, c.label)}</span>
                      </span>
                    </th>
                    <td className="cp-n num">{valueText(c)}</td>
                    <td className="cp-n num dim">{limitText(c)}</td>
                    <td className="cp-n num">
                      <span className={`cp-margin ${c.verdict}`}>{m === null ? "—" : quantityText(m, c.unit, { sign: true })}</span>
                      {c.heading_dependent && m !== null && <span className="cp-tag">worst</span>}
                      {limitingId === c.id && c.verdict !== "pass" && <span className="cp-tag">limiting</span>}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="cp-detail-row">
                      <td colSpan={4}>
                        <dl className="cp-detail">
                          {pairs.map(([k, v]) => (
                            <div key={k}>
                              <dt>{k}</dt>
                              <dd className="num">{v}</dd>
                            </div>
                          ))}
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
