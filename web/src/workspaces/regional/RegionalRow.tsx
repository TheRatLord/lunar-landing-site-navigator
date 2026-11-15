import { useEffect, useMemo, useReducer } from "react";
import { checkRegional, regionalBody, type RegionalBody, type RegionalResult } from "../../api/regional";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Fields";
import { ProgressBar } from "../../components/ui/Progress";
import { useColors } from "../../components/viz/useColors";
import { cssGradient, viridis } from "../../lib/colormaps";
import { formatSig } from "../../lib/format";
import { MS_HOUR, parseUtc, toIsoUtc } from "../../lib/time";
import { DEFAULT_RADIUS_KM, niceSpacing_m, usePlanSearch } from "../../scenario/planSearch";
import { useScenario } from "../../scenario/store";
import { hoursOrDays } from "../../scenario/when";
import type { ConstraintKey, Limit, Scenario } from "../../scenario/types";
import { aboutText, leftText, pace } from "../map/eta";
import { LayerRow, Opacity, Ramp } from "../map/LayerRow";
import { pointValueAllowed, regionalLayer, type RegionalLayerView } from "./regionalLayer";
import { useRegionalLayer } from "./regionalLayerStore";
import "../../styles/regional.css";

interface Metric {
  key: string;
  label: string;
  limit?: ConstraintKey;
}

const METRICS: Metric[] = [
  { key: "sunlit_fraction", label: "Sunlight" },
  { key: "longest_shadow_h", label: "Longest dark span", limit: "max_dark_span_h" },
  { key: "earth_fraction", label: "Earth in view" },
  { key: "longest_earth_outage_h", label: "Longest without Earth" },
  { key: "slope_deg", label: "Slope", limit: "max_slope_deg" },
];

const RAMP = cssGradient(viridis, 11);

function limitOf(doc: Scenario, key: ConstraintKey | undefined): number | null {
  if (!key) return null;
  const l: unknown = doc.constraints[key];
  if (!l || typeof l !== "object" || !("max" in l)) return null;
  return typeof (l as Limit).max === "number" ? (l as Limit).max! : null;
}

export function regionalRequest(doc: Scenario, radiusKm: number | null, window: { first_ms: number; last_ms: number } | null, metric: string): { body: RegionalBody; guessS: number } | null {
  const side = Math.min(200_000, (radiusKm ?? DEFAULT_RADIUS_KM) * 2000);
  const landing = parseUtc(doc.landing_utc) ?? Date.now();
  const start = window?.first_ms ?? landing;
  const stop = window?.last_ms ?? landing + doc.mission_duration_h * MS_HOUR;
  const limit = limitOf(doc, METRICS.find((m) => m.key === metric)?.limit);
  const input = {
    lat_deg: doc.site.lat_deg,
    lon_deg: doc.site.lon_deg,
    size_m: side,
    spacing_m: niceSpacing_m(side / 2),
    start_utc: toIsoUtc(start),
    stop_utc: toIsoUtc(stop),
    step_s: 3600,
    mast_height_m: Math.min(100, Math.max(0, doc.profile.array_height_m ?? 0)),
    metric,
    limit: limit === null ? null : { op: "<=" as const, value: limit },
  };
  const check = checkRegional(input);
  if (check.errors.length > 0 || !check.inlineOk) return null;
  const guessS = (120 + 0.1 * check.cells) * Math.max(1, (stop - start) / MS_HOUR / 336) * pace("regional");
  return { body: regionalBody(input, true), guessS };
}

export function regionalView(result: RegionalResult, body: RegionalBody, metric: string): RegionalLayerView | null {
  if (body.limits && "verdict" in result.inline) return regionalLayer(result, "verdict");
  const layer = result.inline[metric] && pointValueAllowed(result, metric) ? metric : `${metric}_lo`;
  return regionalLayer(result, result.inline[layer] ? layer : metric);
}

const value = (v: number, unit: string | null): string => (unit === "fraction" || unit === null ? `${Math.round(v * 100)}%` : unit === "h" ? hoursOrDays(v) : `${formatSig(v, 3, { trim: true })}${unit === "°" ? "°" : ` ${unit}`}`);

function useTick(on: boolean): void {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(tick, 5000);
    return () => window.clearInterval(id);
  }, [on]);
}

export function RegionalRow({ view, onShow }: { view: RegionalLayerView | null; onShow(): void }) {
  const doc = useScenario((s) => s.doc);
  const radiusKm = usePlanSearch((s) => s.radius_km);
  const window = usePlanSearch((s) => s.window);
  const r = useRegionalLayer();
  const colors = useColors();
  const running = r.phase === "running";
  useTick(running);
  const polar = doc !== null && Math.abs(doc.site.lat_deg) >= 60;
  const req = useMemo(() => (doc && polar ? regionalRequest(doc, radiusKm, window, r.metric) : null), [doc, polar, radiusKm, window, r.metric]);
  const sameAsShown = req !== null && r.resultBody !== null && JSON.stringify(req.body) === JSON.stringify(r.resultBody);
  const unit = r.resultMetric === null ? null : r.resultMetric === "slope_deg" ? "°" : r.resultMetric.endsWith("_h") ? "h" : "fraction";
  const censored = view?.legend.kind === "sequential" && view.cells.some((c) => c.censored && !c.unreliable);
  const unreliable = view?.cells.some((c) => c.unreliable) ?? false;

  return (
    <LayerRow
      on={r.shown && view !== null}
      disabled={view === null}
      label="Area analysis"
      onChange={(shown) => {
        r.set({ shown });
        if (shown) onShow();
      }}
      chips={
      <div className="rg-row">
          <div className="rg-controls">
            <Select aria-label="Area analysis metric" value={r.metric} options={METRICS.map((m) => ({ value: m.key, label: m.label }))} onChange={r.setMetric} disabled={!polar || running} />
            <Button size="sm" icon="play" disabled={req === null || running || (sameAsShown && r.phase === "done")} onClick={() => req && r.run(req.body, req.guessS)}>
              Compute
            </Button>
          </div>
          {running && r.startedMs !== null ? (
            <div className="rg-run" role="status">
              <div className="rg-run-line">
                <span>Computing · {leftText(r.startedMs, r.progress, r.guessS)}</span>
                <Button size="sm" variant="ghost" onClick={r.cancel}>
                  Cancel
                </Button>
              </div>
              <ProgressBar value={r.progress ?? 0} label="Area analysis progress" />
            </div>
          ) : (
            <span className="rg-hint">{!polar ? "Polar sites only" : r.phase === "error" ? `Failed: ${r.error}` : req && !sameAsShown ? aboutText(req.guessS) : null}</span>
          )}
          {view && r.shown && (
            <>
              {view.legend.kind === "verdict" ? (
                <ul className="map-legend-rows rg-legend" aria-label="Area analysis legend">
                  {view.legend.entries.map((e) => (
                    <li key={e.verdict}>
                      <span className="map-swatch" style={{ background: colors.get(e.token) }} aria-hidden="true" /> {e.verdict === "pass" ? "Pass" : e.verdict === "fail" ? "Fail" : "Marginal"}
                    </li>
                  ))}
                </ul>
              ) : (
                <Ramp label={METRICS.find((m) => m.key === r.resultMetric)?.label ?? "Area analysis"} gradient={RAMP} min={value(view.legend.min, unit)} max={value(view.legend.max, unit)} />
              )}
              {(censored || unreliable) && (
                <ul className="map-legend-rows rg-legend">
                  {censored && (
                    <li>
                      <span className="map-hatch" aria-hidden="true" /> At least this long
                    </li>
                  )}
                  {unreliable && (
                    <li>
                      <span className="map-swatch" style={{ background: colors.get("c-dark") }} aria-hidden="true" /> Not reliable
                    </li>
                  )}
                </ul>
              )}
              <Opacity label="Area analysis opacity" value={r.opacity} min={10} onChange={(v) => r.set({ opacity: v })} />
            </>
          )}
        </div>
      }
    />
  );
}
