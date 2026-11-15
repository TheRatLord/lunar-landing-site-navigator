import { lazy, Suspense, useMemo, useState } from "react";
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
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Tabs, type TabItem } from "../../components/ui/Panel";
import { Segmented } from "../../components/ui/Segmented";
import { Spinner } from "../../components/ui/Progress";
import { useScenario } from "../../scenario/store";
import { useOverlays } from "../../scenario/alternatives";
import { useApp } from "../../state/store";
import {
  adaptConstraints,
  adaptHorizon,
  adaptStations,
  adaptClearance,
  adaptSunlight,
  adaptTrack,
  attributionLabel,
  crossingEvents,
  directionsAt,
  evaluatedScenario,
  eventRequest,
  headingView,
  observerHeightM,
  metricWhenLines,
  rangeOnlyRows,
  seriesExtent,
  stationGroups,
  summarize,
  timelineRows,
} from "./adapt";
import { AttributionBar } from "./Attribution";
import { HeadingPanel } from "./HeadingPanel";
import { SiteHeader } from "./SiteHeader";
import { MetricsTable } from "./Tables";
import { useAttribution } from "./useAttribution";
import "../../styles/site.css";

const Terrain3D = lazy(() => import("./terrain3d/Terrain3D"));

type View = "timeline" | "panorama" | "terrain";

const VIEW_TABS = [
  { id: "timeline", label: "Timeline" },
  { id: "panorama", label: "Horizon" },
  { id: "terrain", label: "3D" },
] as const satisfies readonly TabItem[];

const VIEW_NAME: Record<View, string> = { timeline: "Mission timeline", panorama: "Horizon panorama", terrain: "3D terrain" };

export function SiteTarget() {
  const doc = useScenario((s) => s.doc)!;
  const timeMs = useApp((s) => s.timeMs);
  const setTime = useApp((s) => s.setTime);
  const bounds = useApp((s) => s.bounds);
  const blocker = useOverlays((s) => s.blocker);

  const [view, setView] = useState<View>("timeline");
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
  const rows = useMemo(() => (result ? timelineRows(result, evaluated) : []), [result, evaluated]);
  const whenById = useMemo(() => (result ? metricWhenLines(result.metrics) : undefined), [result]);
  const extent = useMemo<[number, number]>(() => (result ? (seriesExtent(result.series) ?? [bounds.start_ms, bounds.end_ms]) : [bounds.start_ms, bounds.end_ms]), [result, bounds]);
  const sunTrack = useMemo(() => (result ? adaptTrack(result.series, "sun") : null), [result]);
  const earthTrack = useMemo(() => (result ? adaptTrack(result.series, "earth") : null), [result]);
  const sunlight = useMemo(() => (result ? adaptSunlight(result.series) : null), [result]);
  const clearance = useMemo(() => (result ? adaptClearance(result.series) : null), [result]);
  const dirs = useMemo(() => (result ? directionsAt(result.series, timeMs) : { sun: null, earth: null }), [result, timeMs]);
  const stations = useMemo(() => (result ? stationGroups(adaptStations(result.series, result.intervals, evaluated, timeMs), evaluated) : []), [result, evaluated, timeMs]);
  const heading = useMemo(() => headingView(result?.heading), [result]);
  const headingRows = useMemo(() => (constraints?.constraints ?? []).filter((c) => c.heading_dependent), [constraints]);

  const horizonSrc = result?.horizons?.[observer] ?? null;
  const horizon = useMemo(() => (horizonSrc ? adaptHorizon(horizonSrc) : null), [horizonSrc]);

  usePublishScreenContext({
    where: "Site, Landing point",
    summary: VIEW_NAME[view],
    lines: [`The view is ${VIEW_NAME[view]}.`, ...(view === "panorama" ? [`The horizon is drawn for the ${observer} height.`] : [])],
  });

  const heightLabel = (o: Observer) => {
    const h = result?.horizons?.[o] ? result.horizons[o].height_m : evaluated ? observerHeightM(evaluated, o) : null;
    return `${o === "array" ? "Solar array" : "Antenna"}${h !== null ? ` ${h} m` : ""}`;
  };
  const markedAz = attr.state.az_deg ?? (attr.state.result?.event ? attr.state.result.event.az_deg : null);
  const outside = result !== null && (timeMs < extent[0] - 60_000 || timeMs > extent[1] + 60_000);
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
              <div className="site-toolbar">
                <Tabs tabs={VIEW_TABS} value={view} onChange={(v) => setView(v as View)} label="Site view" />
                {view === "panorama" && (
                  <Segmented
                    label="Seen from"
                    size="sm"
                    value={observer}
                    onChange={(v) => setObserver(v as Observer)}
                    options={[
                      { value: "array", label: heightLabel("array") },
                      { value: "antenna", label: heightLabel("antenna") },
                    ]}
                  />
                )}
                <span className="grow" />
                {outside && (
                  <span className="site-outside" role="status">
                    Outside the mission
                    <Button size="sm" onClick={() => setTime(extent[0])}>
                      Jump to landing
                    </Button>
                  </span>
                )}
              </div>

              <div className="site-visual">
                {view === "timeline" && <Timeline rows={rows} extent={extent} timeMs={timeMs} onTimeChange={setTime} title="Mission timeline" note={rangeOnlyRows(rows) ? "Heading unknown: battery band spans the best to worst heading" : null} />}
                {view === "panorama" &&
                  (horizon ? (
                    <HorizonPanorama
                      horizon={horizon}
                      sun={sunTrack ?? undefined}
                      earth={earthTrack ?? undefined}
                      sunlight={sunlight ?? undefined}
                      clearance={clearance ?? undefined}
                      stations={stations}
                      timeMs={timeMs}
                      markedAz_deg={markedAz}
                      title="Horizon"
                      onBlockerRequest={(r) => attr.request({ az_deg: r.az_deg, observer }, `Horizon at ${Math.round(r.az_deg)}°`, r.az_deg)}
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

              <AttributionBar state={attr.state} scenario={evaluated} onClear={attr.clear} onShow3D={view === "terrain" ? null : () => setView("terrain")} />
            </div>

            <aside className="site-rail" aria-label="Requirements and events">
              <ConstraintPanel constraints={constraints?.constraints ?? []} limitingId={summary?.limitingKey ?? null} title="Requirements" whenById={whenById} />
              {unevaluated.length > 0 && <p className="site-unevaluated">Not evaluated: {unevaluated.map((c) => c.label).join(", ")}</p>}
              <Countdown
                events={events}
                timeMs={eventsAt}
                title="Next events"
                tracing={attr.state.phase === "running" ? tracing : null}
                onTrace={(kind, e) => {
                  setTracing(kind);
                  if (view === "timeline") setView("panorama");
                  attr.request(eventRequest(kind, e, eventsAt), attributionLabel(kind, e), null);
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
