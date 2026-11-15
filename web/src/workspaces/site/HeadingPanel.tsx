import type { ConstraintVerdict } from "../../contract/types";
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
    { deg: view.best, cls: "hd-best", text: "best" },
    { deg: view.worst, cls: "hd-worst", text: "worst" },
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

const deg = (v: number | null) => (v === null ? "—" : Math.round(v));

export function HeadingPanel({ view, rows }: { view: HeadingView; rows: readonly ConstraintVerdict[] }) {
  const shown = view.constraints.filter((c) => rows.some((r) => r.id === c.key) && (c.samples.length > 0 || c.passing.length > 0 || c.allPass || c.nonePass));
  const same = view.best !== null && view.worst !== null && Math.round(view.best) === Math.round(view.worst);
  return (
    <Panel title="Lander heading" actions={view.known ? <span className="faint num">Nominal {deg(view.nominalYaw)}° ± {formatNum(view.uncertaintyDeg, 0)}°</span> : undefined}>
      <div className="hd">
        <div className="hd-stats">
          {same ? (
            <p className="hd-same">{shown.some((c) => c.key === "min_state_of_charge" && c.nonePass) ? "Battery runs flat at every heading" : "Same result at every heading"}</p>
          ) : (
            <>
              <div className="hd-stat">
                <i className="hd-sw hd-best" aria-hidden="true" />
                <Stat label="Best" value={deg(view.best)} unit="°" />
              </div>
              <div className="hd-stat">
                <i className="hd-sw hd-worst" aria-hidden="true" />
                <Stat label="Worst" value={deg(view.worst)} unit="°" />
              </div>
            </>
          )}
        </div>
        <div className="hd-rings">
          {shown.map((c) => {
            const row = rows.find((r) => r.id === c.key);
            const label = row?.label ?? c.key;
            return (
              <figure key={c.key} className="hd-fig">
                <Ring view={view} c={c} label={label} />
                <figcaption className="hd-cap">
                  <strong>{label}</strong>
                  <span className="num">{c.allPass ? "every heading passes" : c.nonePass ? "no heading passes" : `passes ${arcText(c.passing)}`}</span>
                </figcaption>
              </figure>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
