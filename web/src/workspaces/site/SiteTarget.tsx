import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { usePublishScreenContext } from "../../ask/screenContext";
import { ApiError } from "../../api/client";
import { SITE_ENDPOINTS, evaluateBody, fetchPublishedPaths, type EvaluateResult, type Observer } from "../../api/site";
import { useAnalysis } from "../../api/useAnalysis";
import { ServiceNotice } from "../../components/ServiceNotice";
import { Countdown } from "../../components/viz/Countdown";
import { ConstraintPanel } from "../../components/viz/ConstraintPanel";
import { HorizonPanorama } from "../../components/viz/HorizonPanorama";
import { Timeline } from "../../components/viz/Timeline";
import { EmptyState } from "../../components/ui/EmptyState";
import { Icon } from "../../components/ui/Icon";
import { Popover } from "../../components/ui/Popover";
import { Tabs, type TabItem } from "../../components/ui/Panel";
import { Segmented } from "../../components/ui/Segmented";
import { Spinner } from "../../components/ui/Progress";
import { decimationNote } from "../../lib/seriesMeta";
import { useScenario } from "../../scenario/store";
import { useOverlays } from "../../scenario/alternatives";
import { OriginBadge } from "../../scenario/editor/controls";
import { useApp } from "../../state/store";
import {
  adaptConstraints,
  adaptHorizon,
  adaptStations,
  adaptClearance,
  adaptSunlight,
  adaptTrack,
  attributionLabel,
  boundLines,
  crossingEvents,
  directionsAt,
  evaluatedScenario,
  eventRequest,
  headingView,
  observerHeightM,
  metricWhenLines,
  seriesExtent,
  summarize,
  timelineRows,
} from "./adapt";
import { AttributionBar, EventButtons } from "./Attribution";
import { CompareTerrain } from "./CompareTerrain";
import { HeadingPanel } from "./HeadingPanel";
import { SiteHeader } from "./SiteHeader";
import { MetricsTable } from "./Tables";
import { useAttribution } from "./useAttribution";
import "../../styles/site.css";

const Terrain3D = lazy(() => import("./terrain3d/Terrain3D"));

type View = "panorama" | "terrain" | "compare";

const VIEW_TABS = [
  { id: "panorama", label: "Horizon" },
  { id: "terrain", label: "3D" },
  { id: "compare", label: "Smooth sphere" },
] as const satisfies readonly TabItem[];

const VIEW_NAME: Record<View, string> = { panorama: "Horizon panorama", terrain: "3D terrain", compare: "Terrain against smooth sphere" };

export function SiteTarget() {
  const doc = useScenario((s) => s.doc)!;
  const timeMs = useApp((s) => s.timeMs);
  const setTime = useApp((s) => s.setTime);
  const range = useApp((s) => s.range);
  const setRange = useApp((s) => s.setRange);
  const bounds = useApp((s) => s.bounds);
  const blocker = useOverlays((s) => s.blocker);

  const [view, setView] = useState<View>("panorama");
  const [observer, setObserver] = useState<Observer>("array");
  const [selected, setSelected] = useState<string | null>(null);

  const [published, setPublished] = useState<Set<string> | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    fetchPublishedPaths(ctl.signal).then(setPublished, () => undefined);
    return () => ctl.abort();
  }, []);
  const compare = view === "compare";
  const mainBody = useMemo(() => evaluateBody(doc, "auto"), [doc]);
  const onBody = useMemo(() => (compare ? evaluateBody(doc, "on") : null), [doc, compare]);
  const offBody = useMemo(() => (compare ? evaluateBody(doc, "off") : null), [doc, compare]);
  const evaluation = useAnalysis<EvaluateResult>(SITE_ENDPOINTS.evaluate, mainBody, { debounceMs: 350 });
  const terrainOn = useAnalysis<EvaluateResult>(SITE_ENDPOINTS.evaluate, onBody, { debounceMs: 350 });
  const terrainOff = useAnalysis<EvaluateResult>(SITE_ENDPOINTS.evaluate, offBody, { debounceMs: 350 });
  const attr = useAttribution(doc);

  const result = evaluation.result;
  const stale = evaluation.stale;
  const evaluated = useMemo(() => (result ? evaluatedScenario(result) : null), [result]);
  const summary = useMemo(() => (result ? summarize(result) : null), [result]);
  const constraints = useMemo(() => (result ? adaptConstraints(result.verdict.constraints) : null), [result]);
  const events = useMemo(() => (result ? crossingEvents(result.intervals, result.next_events) : []), [result]);
  const rows = useMemo(() => (result ? timelineRows(result, evaluated) : []), [result, evaluated]);
  const whenById = useMemo(() => (result ? metricWhenLines(result.metrics) : undefined), [result]);
  const extent = useMemo<[number, number]>(() => (result ? (seriesExtent(result.series) ?? [bounds.start_ms, bounds.end_ms]) : [bounds.start_ms, bounds.end_ms]), [result, bounds]);
  const series = useMemo(() => {
    if (!result) return null;
    const m = result.series_meta;
    const note = decimationNote({ decimated: m.decimated, n_returned: m.n_returned, n_total: m.n_window, decimation: m.decimation });
    return note ? { note, label: `${m.n_returned.toLocaleString("en-US")} of ${m.n_window.toLocaleString("en-US")} samples` } : null;
  }, [result]);
  const sunTrack = useMemo(() => (result ? adaptTrack(result.series, "sun") : null), [result]);
  const earthTrack = useMemo(() => (result ? adaptTrack(result.series, "earth") : null), [result]);
  const sunlight = useMemo(() => (result ? adaptSunlight(result.series) : null), [result]);
  const clearance = useMemo(() => (result ? adaptClearance(result.series) : null), [result]);
  const dirs = useMemo(() => (result ? directionsAt(result.series, timeMs) : { sun: null, earth: null }), [result, timeMs]);
  const stations = useMemo(() => (result ? adaptStations(result.series, result.intervals, evaluated, timeMs) : []), [result, evaluated, timeMs]);
  const heading = useMemo(() => headingView(result?.heading), [result]);
  const headingRows = useMemo(() => (constraints?.constraints ?? []).filter((c) => c.heading_dependent), [constraints]);

  const horizonSrc = result?.horizons?.[observer] ?? null;
  const horizon = useMemo(() => (horizonSrc ? adaptHorizon(horizonSrc) : null), [horizonSrc]);
  const shownHeight = horizonSrc ? horizonSrc.height_m : null;

  usePublishScreenContext({
    where: "Site, Target point",
    summary: VIEW_NAME[view],
    lines: [`The view is ${VIEW_NAME[view]}.`, ...(view === "panorama" ? [`The horizon is drawn for the ${observer} observer height.`] : [])],
  });

  const heightLabel = (o: Observer) => {
    const h = result?.horizons?.[o] ? result.horizons[o].height_m : evaluated ? observerHeightM(evaluated, o) : null;
    return `${o === "array" ? "Array" : "Antenna"}${h !== null ? ` · ${h} m` : ""}`;
  };
  const attrReason = published !== null && !published.has(SITE_ENDPOINTS.attribution) ? `Not connected: POST ${SITE_ENDPOINTS.attribution}` : null;
  const selectedId = selected ?? summary?.limitingKey ?? null;
  const explanation = result?.explanations?.find((e) => e.key === selectedId)?.text ?? null;
  const markedAz = attr.state.az_deg ?? (attr.state.result?.event ? attr.state.result.event.az_deg : null);
  const selectedBound = result?.bounds?.find((b) => b.key === selectedId) ?? null;
  const boundNotes = selectedBound ? boundLines(selectedBound) : [];
  const basisCount = (explanation ? 1 : 0) + boundNotes.length;
  const mast = evaluated?.profile.antenna_height_max_m;

  return (
    <div className="site" aria-label="Site page">
      <h1 className="sr-only">Site: {doc.name}</h1>
      <SiteHeader doc={doc} evaluated={evaluated} result={result} summary={summary} run={evaluation} published={published} observer={observer} />

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
        <div className="site-loading" role="status">
          <Spinner size={14} />
          <span className="faint">{evaluation.stage ?? ""}</span>
        </div>
      )}

      {result && (
        <div className={`site-body ${stale ? "is-stale" : ""}`}>
          <div className="site-grid">
            <div className="site-main">
              <div className="site-toolbar">
                <Tabs tabs={VIEW_TABS} value={view} onChange={(v) => setView(v as View)} label="Site view" />
                {view === "panorama" && (
                  <>
                    <Segmented
                      label="Observer height"
                      size="sm"
                      value={observer}
                      onChange={(v) => setObserver(v as Observer)}
                      options={[
                        { value: "array", label: heightLabel("array") },
                        { value: "antenna", label: heightLabel("antenna") },
                      ]}
                    />
                    {evaluated && <OriginBadge origin={evaluated.profile.origins?.[`${observer}_height_m`]} />}
                    {observer === "antenna" && mast != null && shownHeight !== null && (
                      <span className="faint num site-mast">
                        <Icon name="antenna" size={12} /> ≤ {mast} m
                      </span>
                    )}
                  </>
                )}
                <span className="grow" />
                <EventButtons
                  events={events}
                  timeMs={timeMs}
                  disabledReason={attrReason}
                  busy={attr.state.phase === "running"}
                  onAttribute={(kind, e) => attr.request(eventRequest(kind, e, timeMs), attributionLabel(kind, e), null)}
                />
              </div>

              <div className="site-visual">
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
                      title="Horizon profile"
                      onBlockerRequest={(r) => attr.request({ az_deg: r.az_deg, observer }, `Azimuth ${r.az_deg.toFixed(1)}° · ${observer}`, r.az_deg)}
                    />
                  ) : (
                    <EmptyState icon="eyeOff" title={`No ${observer} horizon`} />
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
                {view === "compare" && <CompareTerrain on={terrainOn} off={terrainOff} timeMs={timeMs} />}
              </div>

              <AttributionBar state={attr.state} onClear={attr.clear} onShow3D={() => setView("terrain")} />
            </div>

            <aside className="site-rail" aria-label="Requirements and events">
              <ConstraintPanel
                constraints={constraints?.constraints ?? []}
                limitingId={summary?.limitingKey ?? null}
                overall={summary && summary.overall !== "unknown" ? summary.overall : null}
                selectedId={selectedId}
                onSelect={(c) => setSelected(c.id)}
                title="Requirements"
                whenById={whenById}
              />
              {(basisCount > 0 || (constraints && constraints.unevaluated.length > 0)) && (
                <div className="site-rail-notes">
                  {constraints && constraints.unevaluated.length > 0 && (
                    <span className="site-unevaluated" aria-label="Not evaluated">
                      <Icon name="warn" size={12} />
                      {constraints.unevaluated.map((c) => (
                        <span key={c.key} className="chip chip-unknown">
                          {c.label}
                        </span>
                      ))}
                    </span>
                  )}
                  {basisCount > 0 && (
                    <Popover label="Method" icon="info" align="end" width={360}>
                      <div className="site-basis">
                        {explanation && <p>{explanation}</p>}
                        {boundNotes.length > 0 && (
                          <ul aria-label="Why this range">
                            {boundNotes.map((l) => (
                              <li key={l}>{l}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </Popover>
                  )}
                </div>
              )}
              <Countdown events={events} timeMs={timeMs} title="Next horizon events" />
            </aside>
          </div>

          <div className="site-below">
            <Timeline rows={rows} extent={extent} timeMs={timeMs} onTimeChange={setTime} range={range} onRangeChange={setRange} title="Mission timeline" />
            {series && (
              <div className="site-series" data-testid="series-thinned">
                <Popover label={series.label} icon="info">
                  <p className="site-basis">{series.note}</p>
                </Popover>
              </div>
            )}
            {heading && (heading.depends || headingRows.length > 0) && <HeadingPanel view={heading} rows={headingRows} />}
            <MetricsTable result={result} />
          </div>
        </div>
      )}
    </div>
  );
}
