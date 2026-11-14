import type { ConstraintVerdict } from "../../contract/types";
import { Disclosure } from "../../components/ui/Disclosure";
import { Panel } from "../../components/ui/Panel";
import { Stat } from "../../components/ui/Stat";
import { formatNum } from "../../lib/format";
import { arcPath, arcText, type HeadingConstraintView, type HeadingView } from "./adapt";

const C = 70;
const R = 52;

function point(deg: number, r: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
}

function Ring({ view, c, label }: { view: HeadingView; c: HeadingConstraintView; label: string }) {
  const marks: Array<{ deg: number | null; cls: string; text: string }> = [
    { deg: view.best, cls: "hd-best", text: "best single" },
    { deg: view.worst, cls: "hd-worst", text: "worst single" },
    { deg: view.nominalYaw, cls: "hd-nominal", text: "nominal" },
  ];
  const aria = `${label}: heading passes for ${c.allPass ? "every heading" : c.nonePass ? "no heading" : arcText(c.passing)}, clockwise from north`;
  return (
    <svg className="hd-ring" viewBox="0 0 140 140" role="img" aria-label={aria}>
      <circle cx={C} cy={C} r={R} className="hd-base" />
      {c.allPass ? <circle cx={C} cy={C} r={R} className="hd-pass" /> : c.passing.map((a, i) => <path key={i} d={arcPath(a, C, R)} className="hd-pass" />)}
      {[0, 90, 180, 270].map((d) => {
        const [x, y] = point(d, R + 14);
        return (
          <text key={d} x={x} y={y} className="hd-tick" textAnchor="middle" dominantBaseline="middle">
            {d === 0 ? "N" : d === 90 ? "E" : d === 180 ? "S" : "W"}
          </text>
        );
      })}
      {marks.map((m) => {
        if (m.deg === null) return null;
        const [x, y] = point(m.deg, R);
        return (
          <circle key={m.text} cx={x} cy={y} r={m.text === "nominal" ? 3 : 4.5} className={m.cls}>
            <title>{`${m.text} heading ${Math.round(m.deg)}°`}</title>
          </circle>
        );
      })}
    </svg>
  );
}

const CAUSE_SHORT: Record<string, string> = { heading: "Heading", terrain: "Terrain", both: "Heading and terrain", none: "None" };

const deg = (v: number | null) => (v === null ? "—" : Math.round(v));
const fmt = (v: number) => formatNum(v, 2);

export function HeadingPanel({ view, rows }: { view: HeadingView; rows: readonly ConstraintVerdict[] }) {
  const shown = view.constraints.filter((c) => c.samples.length > 0 || c.passing.length > 0 || c.allPass || c.nonePass);
  const soc: Array<{ key: string; label: string; r: [number, number] | null }> = [
    { key: "total", label: "Total", r: view.socMinTotal },
    { key: "heading", label: "Heading alone", r: view.socMinHeadingOnly },
    { key: "terrain", label: "Terrain alone", r: view.socMinHorizonOnly },
  ];
  const notes = rows.filter((r) => r.heading_note || r.heading_facts);
  return (
    <Panel
      title="Lander heading"
      actions={
        <>
          {!view.known && <span className="chip chip-unknown">Heading unknown</span>}
          {view.known && <span className="chip chip-unknown num">{deg(view.nominalYaw)}° ± {formatNum(view.uncertaintyDeg, 0)}°</span>}
          {view.known && <span className="faint">{view.nominalBasis}</span>}
          {!view.depends && <span className="chip chip-unknown">Heading has no effect</span>}
        </>
      }
    >
      <div className="hd">
        <div className="hd-stats">
          <div className="hd-stat">
            <i className="hd-sw hd-best" aria-hidden="true" />
            <Stat label="Best" value={deg(view.best)} unit="°" />
          </div>
          <div className="hd-stat">
            <i className="hd-sw hd-worst" aria-hidden="true" />
            <Stat label="Worst" value={deg(view.worst)} unit="°" sub={view.worstArcs.length > 0 ? arcText(view.worstArcs) : undefined} />
          </div>
          {view.nominalYaw !== null && (
            <div className="hd-stat">
              <i className="hd-sw hd-nominal" aria-hidden="true" />
              <Stat label="Nominal" value={deg(view.nominalYaw)} unit="°" />
            </div>
          )}
        </div>
        {view.socMinTotal && (
          <table className="hd-soc">
            <caption className="sr-only">Minimum state of charge, lower and upper bound</caption>
            <thead>
              <tr>
                <th scope="col">Minimum state of charge</th>
                <th scope="col" className="num-col">
                  Lower
                </th>
                <th scope="col" className="num-col">
                  Upper
                </th>
              </tr>
            </thead>
            <tbody>
              {soc.map(
                (s) =>
                  s.r && (
                    <tr key={s.key}>
                      <th scope="row">{s.label}</th>
                      <td className="num num-col">{fmt(s.r[0])}</td>
                      <td className="num num-col">{fmt(s.r[1])}</td>
                    </tr>
                  ),
              )}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Set by</th>
                <td colSpan={2} className="num-col">
                  <span className="chip chip-unknown">{CAUSE_SHORT[view.cause] ?? view.cause}</span>
                </td>
              </tr>
            </tfoot>
          </table>
        )}
        <div className="hd-rings">
          {shown.map((c) => {
            const row = rows.find((r) => r.id === c.key);
            const label = row?.label ?? c.key;
            return (
              <figure key={c.key} className="hd-fig">
                <Ring view={view} c={c} label={label} />
                <figcaption className="hd-cap">
                  <strong>{label}</strong>
                  <span className="num">{c.allPass ? "all headings" : c.nonePass ? "no heading" : arcText(c.passing)}</span>
                  {c.limit_min !== null && (
                    <span className="faint num">
                      ≥ {formatNum(c.limit_min, 2)} {c.unit}
                    </span>
                  )}
                </figcaption>
              </figure>
            );
          })}
        </div>
      </div>
      {notes.length > 0 && (
        <Disclosure title="Heading notes" count={notes.length}>
          <div className="site-basis">
            {notes.map((r) => (
              <div key={r.id} className="hd-note">
                <p>
                  <strong>{r.label}</strong> {r.heading_note}
                </p>
                {r.heading_facts && (
                  <p data-testid="heading-facts">
                    {r.heading_facts.line}
                    {r.heading_facts.basis && <span className="faint hd-basis">{r.heading_facts.basis}</span>}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Disclosure>
      )}
    </Panel>
  );
}
