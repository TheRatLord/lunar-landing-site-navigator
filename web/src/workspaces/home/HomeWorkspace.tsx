import { siteLabel } from "../../lib/siteName";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { PLANNING_ENDPOINTS, type ScanResult } from "../../api/planning";
import { useReportPlanning } from "../../api/report";
import { SITE_ENDPOINTS, evaluateBody, type EvaluateResult } from "../../api/site";
import { useAnalysis } from "../../api/useAnalysis";
import { useLoad } from "../../api/useLoad";
import { usePublishScreenContext } from "../../ask/screenContext";
import { Button, IconButton } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { formatLat, formatLon } from "../../lib/coords";
import { clamp } from "../../lib/scale";
import { parseUtc, toIsoUtc } from "../../lib/time";
import { catalogApi } from "../../scenario/api";
import { useAlternatives, type Candidate } from "../../scenario/alternatives";
import { activeRequirements, usePlanSearch, useRankBy } from "../../scenario/planSearch";
import { movePlanSite, routeStackIssues, useScenario } from "../../scenario/store";
import type { Scenario } from "../../scenario/types";
import { announceSiteMove, pointName, siteSnapshot } from "../map/siteMove";
import { useFindOutOfDate, useFindPlan } from "../search/findSites";
import { useSearchResults } from "../search/results";
import { GlobeSearch } from "./globe/GlobeSearch";
import { adaptLattice, type Cell } from "./globe/lattice";
import { MoonGlobe, type GlobeFocus } from "./globe/MoonGlobe";
import { useSubpoints } from "./globe/subpoints";
import { evaluatedScenario, summarize } from "../site/adapt";
import { Headline } from "./Headline";
import { adaptScan, bestLandings, scanParams, yearScanBody } from "./scan";
import { SPAN_MS, adaptSurvey, roundToHour, spanStartFor, surveyBody, withExact, type Survey, type SurveySite } from "./survey";
import { PinnedRow, WindowStrip } from "./WindowStrip";
import { AskSwitch } from "./AskSwitch";
import { distanceText, useSearchAnswer, type Spot } from "./answer";
import { useQuestion } from "./question";
import { WhereAnswer } from "./WhereAnswer";
import { STATE_WORD } from "../map/overlays";
import "../../styles/home.css";

const loadSites = (signal: AbortSignal) => catalogApi.sites({ limit: 1000 }, { signal });
const MAX_PINS = 4;
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

interface StripSiteProps {
  site: SurveySite;
  label: string;
  sub: string;
  tone?: string;
  mark_ms?: number | null;
  tools?: ReactNode;
  doc: Scenario;
  anchor: number;
  start: number;
  end: number;
  requirements: boolean;
  onSelect(): void;
  onRemove?(): void;
}

function StripSite({ site: given, label, sub, tone, mark_ms, tools, doc, anchor, start, end, requirements, onSelect, onRemove }: StripSiteProps) {
  const { lat_deg, lon_deg, name, catalog_id } = given;
  const site = useMemo<SurveySite>(() => ({ lat_deg, lon_deg, name, catalog_id }), [lat_deg, lon_deg, name, catalog_id]);
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
      label={label}
      sub={sub}
      tone={tone}
      mark_ms={mark_ms}
      tools={tools}
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
  const [focus, setFocus] = useState<GlobeFocus>(() => ({ lat_deg: lat, lon_deg: lon, radius_m: 0, nonce: 0 }));
  const place = `${lat},${lon}`;
  const [shownPlace, setShownPlace] = useState(place);
  const [mapPlace, setMapPlace] = useState<string | null>(null);
  if (shownPlace !== place) {
    setShownPlace(place);
    if (mapPlace !== place) setFocus((f) => ({ lat_deg: lat, lon_deg: lon, radius_m: 0, nonce: f.nonce + 1 }));
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

  const ask = useQuestion((st) => st.ask);
  const setAsk = useQuestion((st) => st.setAsk);
  useEffect(() => useQuestion.getState().seePlace(place), [place]);
  const answer = useSearchAnswer(site);
  const scrub = useCallback(
    (ms: number) => {
      setAsk("when");
      setLive(ms);
    },
    [setAsk],
  );
  const commit = useCallback(
    (ms: number) => {
      setAsk("when");
      setLive(null);
      edit(["landing_utc"], toIsoUtc(roundToHour(ms)));
    },
    [edit, setAsk],
  );

  const navigate = useNavigate();
  const moveOnMap = useCallback(
    (next: SurveySite, landing_ms?: number) => {
      const prev = siteSnapshot();
      setMapPlace(`${next.lat_deg},${next.lon_deg}`);
      movePlanSite({ lat_deg: next.lat_deg, lon_deg: next.lon_deg, name: next.name, catalog_id: next.catalog_id ?? null });
      if (landing_ms !== undefined) edit(["landing_utc"], toIsoUtc(roundToHour(landing_ms)));
      announceSiteMove(prev, () => navigate("/site"));
    },
    [edit, navigate],
  );
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

  const takeCell = useCallback(
    (c: Cell, withDate: boolean) =>
      moveOnMap({ lat_deg: round5(c.lat_deg), lon_deg: round5(c.lon_deg), name: pointName(c.lat_deg, c.lon_deg), catalog_id: null }, withDate && c.best_ms !== null ? c.best_ms : undefined),
    [moveOnMap],
  );

  const sub = useSubpoints(start, end);
  const findPlan = useFindPlan();
  const searchStale = useFindOutOfDate(findPlan);
  const searchResult = useSearchResults((st) => st.result);
  const searchBodyDone = useSearchResults((st) => st.resultBody);
  const searchShown = useSearchResults((st) => st.shown);
  const ranked = useSearchResults((st) => st.candidates);
  const lattice = useMemo(() => (searchShown && searchResult && searchBodyDone ? adaptLattice(searchResult, searchBodyDone) : null), [searchShown, searchResult, searchBodyDone]);
  useEffect(() => {
    if (searchResult) useQuestion.getState().seeResult(searchResult);
  }, [searchResult]);
  const takeSpot = useCallback(
    (sp: Spot) =>
      moveOnMap(
        { lat_deg: round5(sp.row.lat_deg), lon_deg: round5(sp.row.lon_deg), name: pointName(sp.row.lat_deg, sp.row.lon_deg), catalog_id: null },
        answer.windowed && sp.landing_ms !== null ? sp.landing_ms : undefined,
      ),
    [moveOnMap, answer.windowed],
  );
  const where = ask === "where";
  const stripSpots = where && answer.fresh ? answer.spots.filter((sp) => !sp.here).slice(0, 3) : [];
  const [seenResult, setSeenResult] = useState(searchResult);
  if (seenResult !== searchResult) {
    setSeenResult(searchResult);
    const r = searchBodyDone?.region;
    if (searchResult && r) setFocus((f) => ({ lat_deg: r.lat_deg, lon_deg: r.lon_deg, radius_m: r.radius_m ?? 20_000, nonce: f.nonce + 1 }));
  }

  const pinned = pins.some((p) => samePlace(p, site));
  const pinMarks = useMemo(() => pins.filter((p) => !samePlace(p, site)).map((p) => ({ id: p.id, name: p.name, lat_deg: p.lat_deg, lon_deg: p.lon_deg })), [pins, site]);

  const fresh = survey !== null;
  const verdictRef = useRef<HTMLElement>(null);

  const topSpot = answer.fresh ? (answer.spots[0] ?? null) : null;
  usePublishScreenContext({
    where: "Overview",
    summary:
      where && topSpot
        ? `Site search within ${distanceText(answer.radius_m)}: ${answer.counts.pass} pass, ${answer.counts.marginal} marginal; best spot ${topSpot.here ? "is the plan site" : `${distanceText(topSpot.dist_m)} ${topSpot.dir} of the plan site`} (${topSpot.row.state})`
        : summary
          ? `Requirement verdict ${summary.overall}${summary.limiting ? `, limited by ${summary.limiting.label}` : ""}`
          : "",
    lines:
      where && topSpot
        ? [`Best spot ${topSpot.row.lat_deg.toFixed(4)}, ${topSpot.row.lon_deg.toFixed(4)} landing ${topSpot.row.landing_utc}${answer.windowed ? `, passes at ${topSpot.row.n_epochs_pass} of ${topSpot.row.n_epochs} landing times` : ""}.`]
        : scan
          ? [`The plan meets its requirements for ${Math.round(scan.passFraction * 100)} percent of landing times in the year from ${toIsoUtc(start)}.`]
          : [],
  });

  return (
    <div className="home" aria-label="Overview page">
      <h1 className="sr-only">Overview: {name}</h1>
      <section className="home-hero" data-theme="dark" data-stale={!fresh}>
        <MoonGlobe
          site={site}
          focus={focus}
          sites={sites}
          pins={pinMarks}
          timeMs={timeMs}
          sub={sub}
          areaRadius_m={(radiusKm ?? findPlan.radiusKm) * 1000}
          lattice={lattice}
          latticeStale={searchStale}
          ranked={ranked}
          onPickSite={pickCatalogSite}
          onSetPoint={setPoint}
          onUseCell={takeCell}
          onPickPin={(p) => moveOnMap({ lat_deg: p.lat_deg, lon_deg: p.lon_deg, name: p.name, catalog_id: pins.find((x) => x.id === p.id)?.catalog_id ?? null })}
        />
        {where ? (
          <WhereAnswer
            ask={<AskSwitch doc={doc} />}
            blockRef={verdictRef}
            answer={answer}
            siteName={siteLabel(name) || "the site"}
            landingMs={landingMs}
            requirements={requirements}
            rank={rank}
            onUse={takeSpot}
            onJump={commit}
          />
        ) : (
        <Headline
          ask={<AskSwitch doc={doc} />}
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
        )}
        {(where || (lattice && !searchStale)) && (
          <div className="home-finder" data-theme="dark">
            <GlobeSearch lattice={lattice} tools={where} />
          </div>
        )}
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
        onScrub={scrub}
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
        {stripSpots.map((sp) => (
          <StripSite
            key={`spot:${sp.row.lat_deg},${sp.row.lon_deg}`}
            site={{ lat_deg: sp.row.lat_deg, lon_deg: sp.row.lon_deg, name: pointName(sp.row.lat_deg, sp.row.lon_deg), catalog_id: null }}
            label={`#${sp.row.rank} · ${distanceText(sp.dist_m)} ${sp.dir}`}
            sub={`${STATE_WORD[sp.row.state]} in the search${answer.windowed && sp.row.n_epochs > 1 ? `, at ${sp.row.n_epochs_pass} of ${sp.row.n_epochs} landing times` : ""}`}
            tone={sp.row.state}
            mark_ms={answer.windowed ? sp.landing_ms : null}
            tools={
              pins.some((p) => samePlace(p, { lat_deg: sp.row.lat_deg, lon_deg: sp.row.lon_deg, name: "", catalog_id: null })) || pins.length >= MAX_PINS ? null : (
                <IconButton
                  icon="pin"
                  size="sm"
                  label="Pin this spot"
                  onClick={() => addPin({ id: `point:${sp.row.lat_deg},${sp.row.lon_deg}`, name: pointName(sp.row.lat_deg, sp.row.lon_deg), lat_deg: sp.row.lat_deg, lon_deg: sp.row.lon_deg, catalog_id: null })}
                />
              )
            }
            requirements={showScan}
            doc={doc}
            anchor={anchor}
            start={start}
            end={end}
            onSelect={() => takeSpot(sp)}
          />
        ))}
        {pins.filter((p) => !samePlace(p, site)).map((p) => (
          <StripSite
            key={p.id}
            requirements={showScan}
            site={{ lat_deg: p.lat_deg, lon_deg: p.lon_deg, name: p.name, catalog_id: p.catalog_id }}
            label={siteLabel(p.name)}
            sub={`${formatLat(p.lat_deg, 2)} ${formatLon(p.lon_deg, 2)}`}
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
