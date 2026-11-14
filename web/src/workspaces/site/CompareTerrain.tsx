import { useMemo } from "react";
import { ApiError } from "../../api/client";
import type { AnalysisControls, AnalysisState } from "../../api/useAnalysis";
import type { EvaluateResult, HorizonCurve } from "../../api/site";
import { OutOfDate } from "../../components/AnalysisStatus";
import { ServiceNotice } from "../../components/ServiceNotice";
import { Spinner } from "../../components/ui/Progress";
import { Stat } from "../../components/ui/Stat";
import { VerdictChip } from "../../components/ui/VerdictChip";
import { formatNum, formatSignedValue } from "../../lib/format";
import { formatUtc } from "../../lib/time";
import { KIND_LABEL, crossingEvents, eventDeltas, eventName, formatDelta, summarize, toArray, type EventDelta } from "./adapt";

export type SideState = Pick<AnalysisState<EvaluateResult>, "result" | "phase" | "error" | "stale" | "progress" | "stage" | "jobId" | "cached"> & AnalysisControls;

const W = 360;
const H = 110;

function path(az: ArrayLike<number>, el: ArrayLike<number>, lo: number, hi: number): string {
  const n = az.length;
  let d = "";
  for (let i = 0; i < n; i++) {
    const v = el[i]!;
    if (!Number.isFinite(v)) continue;
    const x = (az[i]! / 360) * W;
    const y = H - ((v - lo) / (hi - lo)) * H;
    d += `${d ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

function horizonOf(r: EvaluateResult | null): HorizonCurve | null {
  return r?.horizons?.array ?? null;
}

function Side({ title, s, kind }: { title: string; s: SideState; kind: "terrain" | "sphere" }) {
  const sum = s.result ? summarize(s.result) : null;
  const h = horizonOf(s.result);
  const max = h ? Math.max(...toArray(h.elev_deg).filter(Number.isFinite)) : null;
  const lim = sum?.limiting ?? null;
  return (
    <div className={`site-cmp-side site-cmp-${kind} ${s.stale ? "is-stale" : ""}`}>
      <h3 className="site-cmp-h">
        <span className="site-cmp-swatch" aria-hidden="true" />
        {title}
        {s.result && <span className="faint num site-cmp-provider">{s.result.provider}</span>}
        {sum && sum.overall !== "unknown" && <VerdictChip verdict={sum.overall} compact />}
      </h3>
      {s.phase === "error" && s.error instanceof ApiError ? (
        <ServiceNotice error={s.error} what={`the ${title.toLowerCase()} evaluation`} onRetry={s.rerun} />
      ) : s.phase === "error" ? (
        <p role="alert">{s.error?.message}</p>
      ) : !s.result ? (
        <p role="status">
          <Spinner size={12} />
        </p>
      ) : (
        <div className="site-cmp-stats">
          {lim && <Stat label={lim.label} value={formatSignedValue(lim.margin, lim.unit, lim.decimals ?? 2)} tone={lim.verdict} />}
          <Stat label="Highest horizon" value={max !== null && Number.isFinite(max) ? formatNum(max, 2) : "—"} unit="°" />
        </div>
      )}
    </div>
  );
}

function Deltas({ rows }: { rows: EventDelta[] }) {
  return (
    <table className="site-cmp-table">
      <caption className="sr-only">Next horizon crossings with terrain and on the smooth sphere</caption>
      <thead>
        <tr>
          <th scope="col">Event</th>
          <th scope="col">Terrain</th>
          <th scope="col">Smooth sphere</th>
          <th scope="col" className="r">
            Terrain − sphere
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.kind}>
            <th scope="row">{KIND_LABEL[r.kind]}</th>
            <td className="num">
              {r.terrain ? formatUtc(r.terrain.best_ms) : "—"}
              {r.terrain?.title && <span className="faint"> · {eventName(r.kind, r.terrain).toLowerCase()}</span>}
            </td>
            <td className="num">
              {r.sphere ? formatUtc(r.sphere.best_ms) : "—"}
              {r.sphere?.title && <span className="faint"> · {eventName(r.kind, r.sphere).toLowerCase()}</span>}
            </td>
            <td className="num r">{r.delta_min === null ? "—" : formatDelta(r.delta_min)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CompareTerrain({ on, off, timeMs }: { on: SideState; off: SideState; timeMs: number }) {
  const rows = useMemo(() => (on.result && off.result ? eventDeltas(crossingEvents(on.result.intervals, on.result.next_events), crossingEvents(off.result.intervals, off.result.next_events), timeMs) : []), [on.result, off.result, timeMs]);
  const geom = useMemo(() => {
    const a = horizonOf(on.result);
    const b = horizonOf(off.result);
    if (!a || !b) return null;
    const ea = toArray(a.elev_deg);
    const eb = toArray(b.elev_deg);
    const hi = Math.max(0.5, ...ea, ...eb);
    const lo = Math.min(-0.5, ...ea.filter(Number.isFinite), ...eb.filter(Number.isFinite));
    return { lo, hi, terrain: path(toArray(a.az_deg), ea, lo, hi), sphere: path(toArray(b.az_deg), eb, lo, hi), zero: H - ((0 - lo) / (hi - lo)) * H };
  }, [on.result, off.result]);
  const busy = on.phase === "running" || off.phase === "running";

  return (
    <div className="site-stage site-cmp" aria-busy={busy}>
      {(on.stale || off.stale) && <OutOfDate state={on.stale ? on : off} />}
      <div className="site-cmp-sides">
        <Side title="Terrain" s={on} kind="terrain" />
        <Side title="Smooth sphere" s={off} kind="sphere" />
      </div>
      {geom && (
        <figure className="site-cmp-fig">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Horizon elevation against azimuth, 0 to 360 degrees, from ${formatNum(geom.lo, 1)} to ${formatNum(geom.hi, 1)} degrees: with terrain (solid) and smooth sphere (dashed)`}>
            <line x1="0" x2={W} y1={geom.zero} y2={geom.zero} className="site-cmp-zero" />
            <path d={geom.sphere} className="site-cmp-line-sphere" />
            <path d={geom.terrain} className="site-cmp-line-terrain" />
          </svg>
          <span className="site-cmp-axis site-cmp-hi num">{formatNum(geom.hi, 1)}°</span>
          <span className="site-cmp-axis site-cmp-lo num">{formatNum(geom.lo, 1)}°</span>
          <span className="site-cmp-axis site-cmp-az0 num">0°</span>
          <span className="site-cmp-axis site-cmp-az1 num">360°</span>
        </figure>
      )}
      {rows.length > 0 && <Deltas rows={rows} />}
    </div>
  );
}
