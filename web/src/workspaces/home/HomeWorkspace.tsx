import { siteLabel } from "../../lib/siteName";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PLANNING_ENDPOINTS, type ScanResult } from "../../api/planning";
import { useReportPlanning } from "../../api/report";
import { SITE_ENDPOINTS, evaluateBody, type EvaluateResult } from "../../api/site";
import { useAnalysis } from "../../api/useAnalysis";
import { useLoad } from "../../api/useLoad";
import { usePublishScreenContext } from "../../ask/screenContext";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { Spinner } from "../../components/ui/Progress";
import { HorizonPanorama } from "../../components/viz/HorizonPanorama";
import { formatLat, formatLon } from "../../lib/coords";
import { clamp } from "../../lib/scale";
import { parseUtc, toIsoUtc } from "../../lib/time";
import { catalogApi } from "../../scenario/api";
import { useAlternatives, type Candidate } from "../../scenario/alternatives";
import { activeRequirements, usePlanSearch, useRankBy } from "../../scenario/planSearch";
import { movePlanSite, routeStackIssues, useScenario } from "../../scenario/store";
import type { Scenario } from "../../scenario/types";
import { pointName } from "../map/siteMove";
import { evaluatedScenario, summarize } from "../site/adapt";
import { Headline } from "./Headline";
import { HomeMap, type MapFocus } from "./HomeMap";
import { adaptScan, bestLandings, scanParams, yearScanBody } from "./scan";
import { useApp } from "../../state/store";
import { SPAN_MS, adaptSurvey, roundToHour, spanStartFor, surveyBody, trackWindow, withExact, type Survey, type SurveySite } from "./survey";
import { PinnedRow, WindowStrip } from "./WindowStrip";
import "../../styles/home.css";

const loadSites = (signal: AbortSignal) => catalogApi.sites({ limit: 1000 }, { signal });
const MAX_PINS = 4;
const GROUND_PAD = 132;
const SKY_GAP = 28;
const FALLBACK_MS = Date.UTC(2027, 0, 12);
const round5 = (v: number): number => Math.round(v * 1e5) / 1e5;

function useSurvey(doc: Scenario, site: SurveySite, anchor: number | null) {
  const body = useMemo(() => (anchor === null ? null : surveyBody(doc, site, anchor)), [doc, site, anchor]);
  const run = useAnalysis<EvaluateResult>(SITE_ENDPOINTS.evaluate, body, { debounceMs: 120 });
  const survey = useMemo<Survey | null>(() => {
    if (!run.result) return null;
    const start = parseUtc(evaluatedScenario(run.result)?.landing_utc ?? null);
    return adaptSurvey(run.result, start ?? anchor ?? 0);
  }, [run.result, anchor]);
  return { run, survey };
}

const pinId = (s: SurveySite): string => s.catalog_id ?? `point:${s.lat_deg},${s.lon_deg}`;
const samePlace = (p: Candidate, s: SurveySite): boolean => p.id === pinId(s) || (Math.abs(p.lat_deg - s.lat_deg) < 1e-4 && Math.abs(p.lon_deg - s.lon_deg) < 1e-4);

function PinnedSite({ pin, doc, anchor, start, end, requirements, onSelect, onRemove }: { pin: Candidate; doc: Scenario; anchor: number; start: number; end: number; requirements: boolean; onSelect(): void; onRemove(): void }) {
  const site = useMemo<SurveySite>(() => ({ lat_deg: pin.lat_deg, lon_deg: pin.lon_deg, name: pin.name, catalog_id: pin.catalog_id }), [pin]);
  const { run, survey } = useSurvey(doc, site, requirements ? null : anchor);
  const params = useMemo(() => scanParams(anchor), [anchor]);
  const scanReq = useMemo(
    () => (requirements ? yearScanBody({ ...doc, site: { ...doc.site, lat_deg: site.lat_deg, lon_deg: site.lon_deg, name: site.name, catalog_id: site.catalog_id ?? undefined } }, params) : null),
    [requirements, doc, site, params],
  );
  const scanRun = useAnalysis<ScanResult>(PLANNING_ENDPOINTS.scan, scanReq, { debounceMs: 400 });
  const scan = useMemo(() => (scanRun.result && !scanRun.stale ? adaptScan(scanRun.result) : null), [scanRun.result, scanRun.stale]);
  return (
    <PinnedRow
      label={siteLabel(pin.name)}
      sub={`${formatLat(pin.lat_deg, 2)} ${formatLon(pin.lon_deg, 2)}`}
      survey={survey && !run.stale ? survey : null}
      scan={scan}
      requirements={requirements}
      failed={requirements ? scanRun.phase === "error" : run.phase === "error"}
      start_ms={start}
      end_ms={end}
      onSelect={onSelect}
      onRemove={onRemove}
    />
  );
}

export function HomeWorkspace() {
  const doc = useScenario((s) => s.doc)!;
  const edit = useScenario((s) => s.edit);
  const pins = useAlternatives((s) => s.items);
  const addPin = useAlternatives((s) => s.add);
  const removePin = useAlternatives((s) => s.remove);
  const rank = useRankBy(doc);
  const landingWindow = usePlanSearch((s) => s.window);
  const sitesLoad = useLoad(loadSites);
  const sites = useMemo(() => (sitesLoad.state.status === "ready" ? sitesLoad.state.data.items : []), [sitesLoad.state]);

  const lat = doc.site.lat_deg;
  const lon = doc.site.lon_deg;
  const name = doc.site.name ?? "";
  const catalogId = doc.site.catalog_id ?? null;
  const site = useMemo<SurveySite>(() => ({ lat_deg: lat, lon_deg: lon, name, catalog_id: catalogId }), [lat, lon, name, catalogId]);
  const landingMs = parseUtc(doc.landing_utc) ?? FALLBACK_MS;

  const anchor = spanStartFor(landingMs);
  const [live, setLive] = useState<number | null>(null);
  const [focus, setFocus] = useState<MapFocus>(() => ({ lat_deg: lat, lon_deg: lon, nonce: 0 }));
  const place = `${lat},${lon}`;
  const [shownPlace, setShownPlace] = useState(place);
  const [mapPlace, setMapPlace] = useState<string | null>(null);
  if (shownPlace !== place) {
    setShownPlace(place);
    if (mapPlace !== place) setFocus((f) => ({ lat_deg: lat, lon_deg: lon, nonce: f.nonce + 1 }));
  }

  const { run, survey: yearSurvey } = useSurvey(doc, site, anchor);
  const start = anchor;
  const end = start + SPAN_MS;
  const timeMs = clamp(live ?? landingMs, start, end);

  const evalBody = useMemo(() => evaluateBody(doc, "auto"), [doc]);
  const evaluation = useAnalysis<EvaluateResult>(SITE_ENDPOINTS.evaluate, evalBody, { debounceMs: 350 });
  const exact = evaluation.result && !evaluation.stale ? evaluation.result : null;
  const survey = useMemo(() => (yearSurvey && !run.stale ? (exact ? withExact(yearSurvey, exact) : yearSurvey) : null), [yearSurvey, run.stale, exact]);
  const summary = useMemo(() => (evaluation.result && !evaluation.stale ? summarize(evaluation.result) : null), [evaluation.result, evaluation.stale]);

  const requirements = activeRequirements(doc);
  const showScan = requirements > 0;
  const params = useMemo(() => scanParams(anchor), [anchor]);
  const scanReq = useMemo(() => (showScan ? yearScanBody(doc, params) : null), [showScan, doc, params]);
  const scanRun = useAnalysis<ScanResult>(PLANNING_ENDPOINTS.scan, scanReq, { debounceMs: 400 });
  const scan = useMemo(() => (scanRun.result && !scanRun.stale ? adaptScan(scanRun.result) : null), [scanRun.result, scanRun.stale]);
  const best = useMemo(() => (scan ? bestLandings(scan, rank, landingWindow, survey?.both ?? null) : []), [scan, rank, landingWindow, survey]);
  const radiusKm = usePlanSearch((s) => s.radius_km);
  const failed = run.phase === "error" || evaluation.phase === "error" || scanRun.phase === "error";
  const retry = useCallback(() => {
    if (run.phase === "error") run.rerun();
    if (evaluation.phase === "error") evaluation.rerun();
    if (scanRun.phase === "error") scanRun.rerun();
  }, [run, evaluation, scanRun]);
  useEffect(() => routeStackIssues(scanRun.error), [scanRun.error]);
  const setReportScan = useReportPlanning((s) => s.setScan);
  useEffect(() => {
    if (scan) setReportScan(params, "auto");
  }, [scan, params, setReportScan]);

  const commit = useCallback(
    (ms: number) => {
      setLive(null);
      edit(["landing_utc"], toIsoUtc(roundToHour(ms)));
    },
    [edit],
  );

  const moveOnMap = useCallback((next: SurveySite) => {
    setMapPlace(`${next.lat_deg},${next.lon_deg}`);
    movePlanSite({ lat_deg: next.lat_deg, lon_deg: next.lon_deg, name: next.name, catalog_id: next.catalog_id ?? null });
  }, []);
  const pickCatalogSite = useCallback(
    (id: string) => {
      const s = sites.find((x) => x.id === id);
      if (s) moveOnMap({ lat_deg: s.lat_deg, lon_deg: s.lon_deg, name: s.name, catalog_id: s.id });
    },
    [sites, moveOnMap],
  );
  const setPoint = useCallback(
    (la: number, lo: number) => moveOnMap({ lat_deg: round5(la), lon_deg: round5(lo), name: pointName(la, lo), catalog_id: null }),
    [moveOnMap],
  );

  const pinned = pins.some((p) => samePlace(p, site));
  const pinMarks = useMemo(() => pins.filter((p) => !samePlace(p, site)).map((p) => ({ id: p.id, name: p.name, lat_deg: p.lat_deg, lon_deg: p.lon_deg })), [pins, site]);

  const fresh = survey !== null;
  const theme = useApp((st) => st.theme);
  const verdictRef = useRef<HTMLElement>(null);
  const locatorRef = useRef<HTMLDivElement>(null);
  const [skyPad, setSkyPad] = useState(190);
  const [scalePad, setScalePad] = useState(190);
  useEffect(() => {
    const el = verdictRef.current;
    if (!el) return;
    const locator = locatorRef.current;
    const measure = () => {
      const below = locator && locator.offsetHeight > 0 ? locator.offsetTop + locator.offsetHeight : el.offsetTop + el.offsetHeight;
      setSkyPad(Math.round(Math.max(el.offsetTop + el.offsetHeight, below) + SKY_GAP));
      setScalePad(Math.round(below + SKY_GAP));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (locator) ro.observe(locator);
    return () => ro.disconnect();
  }, []);
  const sunWindow = useMemo(() => trackWindow(survey?.sunTrack ?? null, timeMs), [survey, timeMs]);
  const earthWindow = useMemo(() => trackWindow(survey?.earthTrack ?? null, timeMs), [survey, timeMs]);

  usePublishScreenContext({
    where: "Overview",
    summary: summary ? `Requirement verdict ${summary.overall}${summary.limiting ? `, limited by ${summary.limiting.label}` : ""}` : "",
    lines: scan ? [`The plan meets its requirements for ${Math.round(scan.passFraction * 100)} percent of landing times in the year from ${toIsoUtc(start)}.`] : [],
  });

  return (
    <div className="home" aria-label="Overview page">
      <h1 className="sr-only">Overview: {name}</h1>
      <section className="home-hero" data-theme="dark" data-stale={!fresh}>
        {survey?.horizon ? (
          <HorizonPanorama
            compact
            skyPad={skyPad}
            scalePad={scalePad}
            groundPad={GROUND_PAD}
            horizon={survey.horizon}
            sun={sunWindow}
            earth={earthWindow}
            timeMs={timeMs}
            elevationFit={survey.fit ?? undefined}
            title="Sun and Earth paths over the terrain horizon"
          />
        ) : (
          <div className="home-sky-wait" role="status">
            {!failed && <Spinner size={16} />}
          </div>
        )}
        <Headline
          blockRef={verdictRef}
          survey={survey}
          failed={failed}
          onRetry={retry}
          timeMs={timeMs}
          dragging={live !== null}
          requirements={requirements}
          summary={live === null ? summary : null}
          evaluation={evaluation}
          scan={showScan ? scan : null}
          best={best}
          onJump={commit}
        />
        <div ref={locatorRef} className="home-locator" data-theme={theme}>
          <HomeMap site={site} focus={focus} sites={sites} pinned={pinMarks} onPickSite={pickCatalogSite} onSetPoint={setPoint} radiusKm={radiusKm} />
        </div>
        {survey?.smooth && (
          <p className="home-sky-note">
            <Icon name="warn" size={12} /> No terrain data: smooth-sphere horizon
          </p>
        )}
      </section>

      <WindowStrip
        start_ms={start}
        end_ms={end}
        timeMs={timeMs}
        survey={survey}
        busy={!fresh}
        failed={failed}
        siteName={siteLabel(name) || "Unnamed site"}
        scan={showScan ? scan : null}
        scanState={!showScan ? "off" : scan ? "ready" : scanRun.phase === "error" ? "failed" : "busy"}
        best={best}
        onScrub={setLive}
        onCommit={commit}
        landingWindow={landingWindow}
        tools={
          pinned ? null : (
            <Button
              size="sm"
              variant="ghost"
              icon="pin"
              disabled={pins.length >= MAX_PINS}
              title={pins.length >= MAX_PINS ? `Up to ${MAX_PINS} pinned sites` : "Compare this site"}
              onClick={() => addPin({ id: pinId(site), name: name || "Unnamed site", lat_deg: lat, lon_deg: lon, catalog_id: catalogId })}
            >
              Pin
            </Button>
          )
        }
      >
        {pins.filter((p) => !samePlace(p, site)).map((p) => (
          <PinnedSite
            key={p.id}
            requirements={showScan}
            pin={p}
            doc={doc}
            anchor={anchor}
            start={start}
            end={end}
            onSelect={() => movePlanSite({ lat_deg: p.lat_deg, lon_deg: p.lon_deg, name: p.name, catalog_id: p.catalog_id })}
            onRemove={() => removePin(p.id)}
          />
        ))}
      </WindowStrip>
    </div>
  );
}
