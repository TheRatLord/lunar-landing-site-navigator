import { clamp } from "../../lib/scale";
import { requirementName } from "../../lib/requirements";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { usePublishScreenContext } from "../../ask/screenContext";
import type { CountdownKind } from "../../contract/types";
import { ApiError } from "../../api/client";
import { SITE_ENDPOINTS, evaluateBody, type EvaluateResult, type Observer } from "../../api/site";
import { useAnalysis } from "../../api/useAnalysis";
import { ServiceNotice } from "../../components/ServiceNotice";
import { Countdown } from "../../components/viz/Countdown";
import { ConstraintPanel } from "../../components/viz/ConstraintPanel";
import { HorizonPanorama } from "../../components/viz/HorizonPanorama";
import { Timeline } from "../../components/viz/Timeline";
import { EmptyState } from "../../components/ui/EmptyState";
import { Tabs, type TabItem } from "../../components/ui/Panel";
import { Select } from "../../components/ui/Fields";
import { Spinner } from "../../components/ui/Progress";
import { useScenario } from "../../scenario/store";
import { useOverlays } from "../../scenario/alternatives";
import { useApp } from "../../state/store";
import { startPlay } from "../../shell/TimeScrubber";
import {
  adaptConstraints,
  adaptHorizon,
  adaptStations,
  adaptSunlight,
  adaptTrack,
  attributionLabel,
  constraintIntervals,
  crossingEvents,
  directionsAt,
  evaluatedScenario,
  eventRequest,
  headingView,
  observerHeightM,
  metricWhenLines,
  seriesExtent,
  stationGroups,
  summarize,
  timelineRows,
} from "./adapt";
import { AttributionBar } from "./Attribution";
import { BatteryWarning } from "./Battery";
import { HeadingPanel } from "./HeadingPanel";
import { SiteHeader } from "./SiteHeader";
import { MetricsTable } from "./Tables";
import { useAttribution } from "./useAttribution";
import "../../styles/site.css";

const Terrain3D = lazy(() => import("./terrain3d/Terrain3D"));

type View = "panorama" | "terrain";

const VIEW_TABS = [
  { id: "panorama", label: "Horizon" },
  { id: "terrain", label: "3D terrain" },
] as const satisfies readonly TabItem[];

const VIEW_NAME: Record<View, string> = { panorama: "Horizon panorama", terrain: "3D terrain" };

let keptView: View = "panorama";

export function SiteTarget() {
  const doc = useScenario((s) => s.doc)!;
  const timeMs = useApp((s) => s.timeMs);
  const setTime = useApp((s) => s.setTime);
  const bounds = useApp((s) => s.bounds);
  const blocker = useOverlays((s) => s.blocker);
  useEffect(() => startPlay(), []);

  const [view, setViewState] = useState<View>(() => keptView);
  const setView = (v: View) => {
    keptView = v;
    setViewState(v);
  };
  const [observer, setObserver] = useState<Observer>("array");
  const [tracing, setTracing] = useState<CountdownKind | null>(null);

  const mainBody = useMemo(() => evaluateBody(doc, "auto"), [doc]);
  const evaluation = useAnalysis<EvaluateResult>(SITE_ENDPOINTS.evaluate, mainBody, { debounceMs: 350 });
  const attr = useAttribution(doc);

  const result = evaluation.result;
  const stale = evaluation.stale;
  const evaluated = useMemo(() => (result ? evaluatedScenario(result) : null), [result]);
  const summary = useMemo(() => (result ? summarize(result) : null), [result]);
  const constraints = useMemo(() => (result ? adaptConstraints(result.verdict.constraints) : null), [result]);
  const events = useMemo(() => (result ? crossingEvents(result.intervals) : []), [result]);
  const spans = useMemo(() => (result ? constraintIntervals(result.intervals) : new Map<string, [number, number]>()), [result]);
  const showable = useMemo(() => new Set(spans.keys()), [spans]);
  const rows = useMemo(() => (result ? timelineRows(result, evaluated) : []), [result, evaluated]);
  const whenById = useMemo(() => (result ? metricWhenLines(result.metrics) : undefined), [result]);
  const extent = useMemo<[number, number]>(() => (result ? (seriesExtent(result.series) ?? [bounds.start_ms, bounds.end_ms]) : [bounds.start_ms, bounds.end_ms]), [result, bounds]);
  const sunTrack = useMemo(() => (result ? adaptTrack(result.series, "sun") : null), [result]);
  const earthTrack = useMemo(() => (result ? adaptTrack(result.series, "earth") : null), [result]);
  const sunlight = useMemo(() => (result ? adaptSunlight(result.series) : null), [result]);
  const dirs = useMemo(() => (result ? directionsAt(result.series, timeMs) : { sun: null, earth: null }), [result, timeMs]);
  const stations = useMemo(() => (result ? stationGroups(adaptStations(result.series, result.intervals, evaluated, timeMs), evaluated) : []), [result, evaluated, timeMs]);
  const heading = useMemo(() => headingView(result?.heading), [result]);
  const headingRows = useMemo(() => (constraints?.constraints ?? []).filter((c) => c.heading_dependent), [constraints]);

  const horizonSrc = result?.horizons?.[observer] ?? null;
  const horizon = useMemo(() => (horizonSrc ? adaptHorizon(horizonSrc) : null), [horizonSrc]);

  usePublishScreenContext({
    where: "Site, Landing site",
    summary: VIEW_NAME[view],
    lines: [`The mission timeline is shown above the ${VIEW_NAME[view]}.`, ...(view === "panorama" ? [`The horizon is drawn for the ${observer} height.`] : [])],
  });

  const heightLabel = (o: Observer) => {
    const h = result?.horizons?.[o] ? result.horizons[o].height_m : evaluated ? observerHeightM(evaluated, o) : null;
    return `${o === "array" ? "Solar array" : "Antenna"}${h !== null ? ` ${h} m` : ""}`;
  };
  const markedAz = attr.state.az_deg ?? (attr.state.result?.event ? attr.state.result.event.az_deg : null);
  const eventsAt = Math.min(Math.max(timeMs, extent[0]), extent[1]);
  const unevaluated = constraints?.unevaluated ?? [];

  return (
    <div className="site" aria-label="Site page">
      <h1 className="sr-only">Site: {doc.name}</h1>
      <SiteHeader doc={doc} evaluated={evaluated} result={result} summary={summary} run={evaluation} />

      {evaluation.error && evaluation.phase === "error" && (
        <div className="site-pad">
          <ServiceNotice
            error={evaluation.error instanceof ApiError ? evaluation.error : new ApiError({ status: 0, title: "Could not evaluate the site", detail: evaluation.error.message })}
            what="the site evaluation"
            onRetry={evaluation.rerun}
          />
        </div>
      )}
      {!result && evaluation.phase !== "error" && (
        <div className="site-loading" aria-hidden>
          <Spinner size={14} />
        </div>
      )}

      {result && (
        <div className={`site-body ${stale ? "is-stale" : ""}`}>
          <div className="site-grid">
            <div className="site-main">
              <section className="site-card" aria-label={VIEW_NAME[view]}>
                <header className="site-card-head">
                  <Tabs tabs={VIEW_TABS} value={view} onChange={(v) => setView(v as View)} label="Site view" />
                  <span className="grow" />
                  {view === "panorama" && (
                    <label className="site-seen">
                      <span>Seen from</span>
                      <Select
                        aria-label="Horizon seen from"
                        value={observer}
                        onChange={(v) => setObserver(v as Observer)}
                        options={[
                          { value: "array", label: heightLabel("array") },
                          { value: "antenna", label: heightLabel("antenna") },
                        ]}
                      />
                    </label>
                  )}
                </header>

                <AttributionBar state={attr.state} scenario={evaluated} onClear={attr.clear} onShow3D={view === "terrain" ? null : () => setView("terrain")} />

                <div className="site-visual">
                  {view === "panorama" &&
                    (horizon ? (
                      <HorizonPanorama
                        horizon={horizon}
                        sun={sunTrack ?? undefined}
                        earth={earthTrack ?? undefined}
                        sunlight={sunlight ?? undefined}
                        stations={stations}
                        timeMs={timeMs}
                        markedAz_deg={markedAz}
                        title="Horizon"
                        onBlockerRequest={(r) => attr.request({ az_deg: r.az_deg, observer }, "Horizon", r.az_deg)}
                      />
                    ) : (
                      <EmptyState icon="eyeOff" title="No horizon for this height" />
                    ))}
                  {view === "terrain" && (
                    <Suspense
                      fallback={
                        <div className="site-loading" role="status">
                          <Spinner size={14} />
                        </div>
                      }
                    >
                      <Terrain3D scenario={stale && evaluated ? evaluated : doc} sun={dirs.sun} earth={dirs.earth} blocker={blocker} />
                    </Suspense>
                  )}
                </div>
              </section>

              <Timeline rows={rows} extent={extent} timeMs={timeMs} onTimeChange={setTime} title="Mission timeline" extra={!stale && <BatteryWarning doc={doc} evaluated={evaluated} result={result} />} />
            </div>

            <aside className="site-rail" aria-label="Requirements and events">
              <ConstraintPanel constraints={constraints?.constraints ?? []} limitingId={summary?.limitingKey ?? null} title="Requirements"
                whenById={whenById}
                showable={showable}
                onShow={(id) => {
                  const span = spans.get(id);
                  if (!span) return;
                  setTime(clamp(span[0], extent[0], extent[1]));
                }}
              />
              {unevaluated.length > 0 && <p className="site-unevaluated">Not evaluated: {unevaluated.map((c) => requirementName(c.key, c.label)).join(", ")}</p>}
              <Countdown
                events={events}
                timeMs={eventsAt}
                startMs={extent[0]}
                endMs={extent[1]}
                title="Next events"
                tracing={attr.state.phase === "running" ? tracing : null}
                onTrace={(kind, e) => {
                  setTracing(kind);
                  attr.request(eventRequest(kind, e, eventsAt), attributionLabel(kind, e), null);
                  setTime(e.best_ms);
                }}
              />
            </aside>
          </div>

          <div className="site-below">
            {heading && headingRows.length > 0 && <HeadingPanel view={heading} rows={headingRows} />}
            <MetricsTable result={result} />
          </div>
        </div>
      )}
    </div>
  );
}
