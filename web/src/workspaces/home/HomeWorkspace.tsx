import { siteLabel } from "../../lib/siteName";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PLANNING_ENDPOINTS, type ScanResult } from "../../api/planning";
import { useReportPlanning } from "../../api/report";
import { SITE_ENDPOINTS, type EvaluateResult } from "../../api/site";
import { prefetchAnalysis, useAnalysis } from "../../api/useAnalysis";
import { useLoad } from "../../api/useLoad";
import { usePublishScreenContext } from "../../ask/screenContext";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { ProgressBar, Spinner } from "../../components/ui/Progress";
import { MS_DAY, MS_HOUR, parseUtc, toIsoUtc } from "../../lib/time";
import { catalogApi } from "../../scenario/api";
import { useAlternatives } from "../../scenario/alternatives";
import { DEFAULT_RADIUS_KM, activeRequirements, effectiveWindow, isYear, rankLabel, usePlanSearch, useRankBy, yearFrom, yearText, type LandingWindow, type RankBy } from "../../scenario/planSearch";
import { chooseSite, searchHere, useSearchSite } from "../../scenario/searchAnchor";
import { movePlanSite, routeStackIssues, shiftPlanLanding, useScenario } from "../../scenario/store";
import type { Scenario } from "../../scenario/types";
import { spanText } from "../../scenario/when";
import { leftText } from "../map/eta";
import { announceSiteMove, pointName, siteSnapshot } from "../map/siteMove";
import { useFindOutOfDate, useFindPlan, useSearchCovers } from "../search/findSites";
import { useSearchResults } from "../search/results";
import { useCompareOptions } from "../compare/options";
import { compareRequest } from "../compare/request";
import { GlobeSearch } from "./globe/GlobeSearch";
import { adaptLattice, type Cell } from "../search/lattice";
import { MoonGlobe, type GlobeFocus } from "./globe/MoonGlobe";
import { useSubpoints } from "./globe/subpoints";
import { OptionList } from "./OptionList";
import { closestOption, hereOptions, pinOption, samePlace, sortOptions, spotOptions, type LandingOption, type Place } from "./options";
import { adaptScan, limitingAt, scanIndexAt, scanParams, verdictAt, yearScanBody, type YearScan } from "./scan";
import { STAY_FALLBACK_MS, adaptSurvey, stayBody, surveyBody } from "./survey";
import { useClockDriver, type Stay } from "./clock";
import { Selection, type StayLight } from "./Selection";
import { YearBar } from "./YearBar";
import "../../styles/home.css";

const loadSites = (signal: AbortSignal) => catalogApi.sites({ limit: 1000 }, { signal });
const MAX_PINS = 4;
const round5 = (v: number): number => Math.round(v * 1e5) / 1e5;
const sameWindow = (a: LandingWindow, b: LandingWindow): boolean => a.first_ms === b.first_ms && a.last_ms === b.last_ms;
const overlaps = (a: LandingWindow, b: LandingWindow): boolean => a.first_ms < b.last_ms && b.first_ms < a.last_ms;
let comparePrefetched = false;

function useYearScan(doc: Scenario, place: Place, view: LandingWindow) {
  const { lat_deg, lon_deg, name, catalog_id } = place;
  const body = useMemo(
    () => yearScanBody({ ...doc, site: { ...doc.site, lat_deg, lon_deg, name, catalog_id: catalog_id ?? undefined } }, scanParams(view.first_ms, view.last_ms)),
    [doc, lat_deg, lon_deg, name, catalog_id, view.first_ms, view.last_ms],
  );
  const run = useAnalysis<ScanResult>(PLANNING_ENDPOINTS.scan, body, { debounceMs: 400 });
  const scan = useMemo(() => (run.result && !run.stale ? adaptScan(run.result) : null), [run.result, run.stale]);
  return { run, scan };
}

function PinScan({ id, place, doc, view, onScan }: { id: string; place: Place; doc: Scenario; view: LandingWindow; onScan(id: string, scan: YearScan | null, failed: boolean): void }) {
  const { run, scan } = useYearScan(doc, place, view);
  const failed = run.phase === "error";
  useEffect(() => onScan(id, scan, failed), [id, scan, failed, onScan]);
  return null;
}

export function HomeWorkspace() {
  const doc = useScenario((s) => s.doc)!;
  const edit = useScenario((s) => s.edit);
  const pins = useAlternatives((s) => s.items);
  const addPin = useAlternatives((s) => s.add);
  const removePin = useAlternatives((s) => s.remove);
  const rank = useRankBy(doc);
  const planWindow = usePlanSearch((s) => s.window);
  const setWindow = usePlanSearch((s) => s.setWindow);
  const setRankBy = usePlanSearch((s) => s.setRankBy);
  const radiusKm = usePlanSearch((s) => s.radius_km);
  const setRadius = usePlanSearch((s) => s.setRadius);
  const sitesLoad = useLoad(loadSites);
  const sites = useMemo(() => (sitesLoad.state.status === "ready" ? sitesLoad.state.data.items : []), [sitesLoad.state]);
  const navigate = useNavigate();

  const centre = useSearchSite();
  const lat = centre?.lat_deg ?? doc.site.lat_deg;
  const lon = centre?.lon_deg ?? doc.site.lon_deg;
  const name = centre?.name ?? doc.site.name ?? "";
  const catalogId = centre?.catalog_id ?? null;
  const site = useMemo<Place>(() => ({ lat_deg: lat, lon_deg: lon, name, catalog_id: catalogId }), [lat, lon, name, catalogId]);
  const siteName = siteLabel(name) || "Unnamed site";
  const cLat = doc.site.lat_deg;
  const cLon = doc.site.lon_deg;
  const cName = doc.site.name ?? "";
  const cId = doc.site.catalog_id ?? null;
  const chosen = useMemo<Place>(() => ({ lat_deg: cLat, lon_deg: cLon, name: cName, catalog_id: cId }), [cLat, cLon, cName, cId]);
  const chosenName = siteLabel(cName) || pointName(cLat, cLon);
  const away = !samePlace(chosen, site);
  const landingMs = parseUtc(doc.landing_utc) ?? STAY_FALLBACK_MS;

  const win = effectiveWindow(doc, planWindow);
  const [view, setView] = useState<LandingWindow>(() => (isYear(win) ? win : yearFrom(win.first_ms)));
  const wantView = isYear(win) ? win : overlaps(view, win) ? view : yearFrom(win.first_ms);
  if (!sameWindow(wantView, view)) setView(wantView);
  const listWin = win;
  const whole = listWin.first_ms <= view.first_ms && listWin.last_ms >= view.last_ms;

  const [focus, setFocus] = useState<GlobeFocus>(() => ({ lat_deg: cLat, lon_deg: cLon, radius_m: 0, nonce: 0 }));
  const placeKey = `${cLat},${cLon}`;
  const [shownPlace, setShownPlace] = useState(placeKey);
  const [mapPlace, setMapPlace] = useState<string | null>(null);
  if (shownPlace !== placeKey) {
    setShownPlace(placeKey);
    if (mapPlace !== placeKey) setFocus((f) => ({ lat_deg: cLat, lon_deg: cLon, radius_m: 0, nonce: f.nonce + 1 }));
  }

  const requirements = activeRequirements(doc);
  const { run: scanRun, scan } = useYearScan(doc, site, view);
  const surveyReq = useMemo(() => (requirements === 0 ? surveyBody(doc, site, view.first_ms, view.last_ms) : null), [requirements, doc, site, view.first_ms, view.last_ms]);
  const surveyRun = useAnalysis<EvaluateResult>(SITE_ENDPOINTS.evaluate, surveyReq, { debounceMs: 120 });
  const survey = useMemo(() => (surveyRun.result && !surveyRun.stale ? adaptSurvey(surveyRun.result, view.first_ms, view.last_ms) : null), [surveyRun.result, surveyRun.stale, view.first_ms, view.last_ms]);
  useEffect(() => routeStackIssues(scanRun.error), [scanRun.error]);
  const setReportScan = useReportPlanning((s) => s.setScan);
  useEffect(() => {
    if (scan) setReportScan(scanParams(view.first_ms, view.last_ms), "auto");
  }, [scan, view.first_ms, view.last_ms, setReportScan]);

  const [pinScans, setPinScans] = useState<Record<string, { scan: YearScan | null; failed: boolean }>>({});
  const reportPin = useCallback((id: string, s: YearScan | null, failed: boolean) => {
    setPinScans((m) => (m[id]?.scan === s && m[id]?.failed === failed ? m : { ...m, [id]: { scan: s, failed } }));
  }, []);
  const demo = useScenario((s) => s.demo);
  const compareSlipsStored = useCompareOptions((s) => s.slips_h);
  const pinsReady = pins.length > 0 && pins.every((p) => pinScans[p.id]?.scan);
  useEffect(() => {
    if (!demo || !scan || !pinsReady || comparePrefetched) return;
    comparePrefetched = true;
    prefetchAnalysis(PLANNING_ENDPOINTS.slip, compareRequest(doc, pins, compareSlipsStored, planWindow).body);
    void import("../compare/CompareWorkspace");
  }, [demo, scan, pinsReady, doc, pins, compareSlipsStored, planWindow]);
  const pinPlaces = useMemo(() => pins.map((p) => ({ id: p.id, label: siteLabel(p.name) || pointName(p.lat_deg, p.lon_deg), place: { lat_deg: p.lat_deg, lon_deg: p.lon_deg, name: p.name, catalog_id: p.catalog_id } })), [pins]);

  const findPlan = useFindPlan();
  const covers = useSearchCovers(findPlan, site);
  const searchStale = useFindOutOfDate(findPlan);
  const searchPhase = useSearchResults((st) => st.phase);
  const searchProgress = useSearchResults((st) => st.progress);
  const searchStarted = useSearchResults((st) => st.startedMs);
  const searchGuess = useSearchResults((st) => st.guessS);
  const searchError = useSearchResults((st) => st.error);
  const searchResult = useSearchResults((st) => st.result);
  const searchBodyDone = useSearchResults((st) => st.resultBody);
  const searchShown = useSearchResults((st) => st.shown);
  const searchRows = useSearchResults((st) => st.candidates);
  const runSearch = useSearchResults((st) => st.run);
  const cancelSearch = useSearchResults((st) => st.cancel);
  const lattice = useMemo(() => (searchShown && searchResult && searchBodyDone ? adaptLattice(searchResult, searchBodyDone) : null), [searchShown, searchResult, searchBodyDone]);
  const [seenResult, setSeenResult] = useState(searchResult);
  if (seenResult !== searchResult) {
    setSeenResult(searchResult);
    const r = searchBodyDone?.region;
    if (searchResult && r) setFocus((f) => ({ lat_deg: r.lat_deg, lon_deg: r.lon_deg, radius_m: r.radius_m ?? 20_000, nonce: f.nonce + 1 }));
  }

  const pinned = useMemo(
    () => sortOptions(pinPlaces.map((p) => pinOption(p.id, p.place, p.label, pinScans[p.id]?.scan ?? null, pinScans[p.id]?.failed ?? false, rank, listWin))),
    [pinPlaces, pinScans, rank, listWin],
  );
  const here = useMemo(() => (scan ? hereOptions(scan, rank, listWin, site, siteName) : []), [scan, rank, listWin, site, siteName]);
  const closest = useMemo(() => (scan && here.length === 0 ? closestOption(scan, rank, listWin, site, siteName) : null), [scan, here.length, rank, listWin, site, siteName]);
  const spots = useMemo(
    () =>
      radiusKm !== null && covers && searchBodyDone
        ? spotOptions(searchRows, site, searchBodyDone.final_spacing_m, rank, pointName).filter((o) => !pins.some((p) => samePlace(p, o.place)))
        : [],
    [radiusKm, covers, searchBodyDone, searchRows, rank, site, pins],
  );
  const ranked = useMemo(() => sortOptions([...(closest ? [closest] : here), ...spots]), [closest, here, spots]);

  const atLanding = (o: LandingOption) => samePlace(o.place, chosen) && o.t_ms !== null && Math.abs(o.t_ms - landingMs) < 30 * 60_000;
  const selectedOpt = [...pinned, ...ranked].find(atLanding) ?? null;
  const selectedKey = selectedOpt?.key ?? null;
  const selectedN = ranked.findIndex(atLanding) + 1 || null;

  const [hovered, setHovered] = useState<LandingOption | null>(null);
  const hoverTimer = useRef(0);
  const previewOption = useCallback((o: LandingOption | null) => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHovered(o), o ? 120 : 200);
  }, []);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  const preview = hovered && hovered.key !== selectedKey && [...pinned, ...ranked].some((o) => o.key === hovered.key) ? hovered : null;
  const stayMs = doc.mission_duration_h * MS_HOUR;
  const stay = useMemo<Stay>(() => ({ start_ms: landingMs, end_ms: landingMs + stayMs }), [landingMs, stayMs]);
  const previewStart = preview?.t_ms ?? null;
  const previewStay = useMemo<Stay | null>(() => (previewStart === null ? null : { start_ms: previewStart, end_ms: previewStart + stayMs }), [previewStart, stayMs]);
  useClockDriver(previewStay ?? stay);

  const lightReq = useMemo(() => stayBody(doc), [doc]);
  const lightRun = useAnalysis<EvaluateResult>(SITE_ENDPOINTS.evaluate, lightReq, { debounceMs: 250 });
  const light = useMemo<StayLight | null>(() => {
    if (!lightRun.result || lightRun.stale) return null;
    const sv = adaptSurvey(lightRun.result, landingMs, landingMs + stayMs);
    return { start_ms: landingMs, end_ms: landingMs + stayMs, sun: sv.sun, earth: sv.earth };
  }, [lightRun.result, lightRun.stale, landingMs, stayMs]);

  const keepYear = useCallback(
    (t: number | null) => {
      if (planWindow === null && t !== null && !sameWindow(yearFrom(t), win)) setWindow(win);
    },
    [planWindow, win, setWindow],
  );
  const land = useCallback(
    (t: number) => {
      keepYear(t);
      edit(["landing_utc"], toIsoUtc(t));
    },
    [keepYear, edit],
  );
  const moveTo = useCallback(
    (p: Place, t: number | null, fromGlobe: boolean, choice = false) => {
      const prev = siteSnapshot();
      keepYear(t);
      if (fromGlobe) setMapPlace(`${p.lat_deg},${p.lon_deg}`);
      const next = { lat_deg: p.lat_deg, lon_deg: p.lon_deg, name: p.name, catalog_id: p.catalog_id };
      if (choice) chooseSite(next);
      else {
        searchHere();
        movePlanSite(next);
      }
      if (t !== null) edit(["landing_utc"], toIsoUtc(t));
      if (!choice) announceSiteMove(prev, () => navigate("/site"));
    },
    [keepYear, edit, navigate],
  );
  const select = useCallback(
    (o: LandingOption) => {
      if (samePlace(o.place, chosen)) {
        if (o.t_ms !== null) land(o.t_ms);
      } else moveTo(o.place, o.t_ms, false, true);
    },
    [chosen, land, moveTo],
  );
  const pinOf = (p: Place) => ({ id: p.catalog_id ?? `point:${p.lat_deg},${p.lon_deg}`, name: p.name || pointName(p.lat_deg, p.lon_deg), lat_deg: p.lat_deg, lon_deg: p.lon_deg, catalog_id: p.catalog_id });

  const pickCatalogSite = useCallback(
    (id: string) => {
      const s = sites.find((x) => x.id === id);
      if (s) moveTo({ lat_deg: s.lat_deg, lon_deg: s.lon_deg, name: s.name, catalog_id: s.id }, null, true);
    },
    [sites, moveTo],
  );
  const setPoint = useCallback((la: number, lo: number) => moveTo({ lat_deg: round5(la), lon_deg: round5(lo), name: pointName(la, lo), catalog_id: null }, null, true), [moveTo]);
  const takeCell = useCallback(
    (c: Cell, withDate: boolean) => moveTo({ lat_deg: round5(c.lat_deg), lon_deg: round5(c.lon_deg), name: pointName(c.lat_deg, c.lon_deg), catalog_id: null }, withDate && c.best_ms !== null ? c.best_ms : null, true, true),
    [moveTo],
  );

  const sub = useSubpoints(view.first_ms - 15 * MS_DAY, view.last_ms + 45 * MS_DAY);
  const pinMarks = useMemo(() => pins.filter((p) => !samePlace(p, chosen)).map((p) => ({ id: p.id, name: p.name, lat_deg: p.lat_deg, lon_deg: p.lon_deg })), [pins, chosen]);

  const windowPhrase = whole ? `any time in ${yearText(view)}` : spanText(listWin.first_ms, listWin.last_ms - 1);
  const scope = `${siteName}${radiusKm !== null ? ` and ${radiusKm} km around` : ""} · ${windowPhrase}`;
  const planIndex = scan && !away ? scanIndexAt(scan, landingMs) : null;
  const planVerdict = requirements === 0 ? null : scan && planIndex !== null ? verdictAt(scan, planIndex) : (selectedOpt?.verdict ?? null);
  const planLimiting = scan && planIndex !== null ? limitingAt(scan, planIndex) : (selectedOpt?.limiting ?? null);
  const chosenPin = pins.find((p) => samePlace(p, chosen)) ?? null;
  const chosenScan = !away ? scan : chosenPin ? (pinScans[chosenPin.id]?.scan ?? null) : null;

  const notice = scanRun.phase === "error" ? (
    <p className="opts-note" role="alert">
      Couldn't check {yearText(view)}.{" "}
      <button type="button" className="opts-link" onClick={scanRun.rerun}>
        Retry
      </button>
    </p>
  ) : !scan ? (
    <p className="opts-note" role="status">
      <Spinner size={12} /> Checking {yearText(view)}
    </p>
  ) : here.length === 0 ? (
    <div className="opts-empty">
      <p>
        <strong>No landing meets the limits.</strong>
        {scan.closing ? ` Mostly ${scan.closing}.` : ""}
      </p>
      <div className="opts-empty-actions">
        {!whole && (
          <Button size="sm" onClick={() => setWindow(view)}>
            Whole year
          </Button>
        )}
        {radiusKm === null && (
          <Button size="sm" onClick={() => setRadius(DEFAULT_RADIUS_KM)}>
            Within {DEFAULT_RADIUS_KM} km
          </Button>
        )}
      </div>
    </div>
  ) : null;

  const search =
    radiusKm === null ? (
      <Button size="sm" variant="ghost" icon="plus" onClick={() => setRadius(DEFAULT_RADIUS_KM)}>
        Spots within {DEFAULT_RADIUS_KM} km
      </Button>
    ) : searchPhase === "running" && searchStarted !== null ? (
      <div className="opts-search" role="status">
        <div className="opts-search-row">
          <span>
            Searching {radiusKm} km · {leftText(searchStarted, searchProgress, searchGuess)}
          </span>
          <Button size="sm" variant="ghost" onClick={cancelSearch}>
            Cancel
          </Button>
        </div>
        <ProgressBar value={searchProgress ?? 0} label="Search progress" />
      </div>
    ) : covers ? (
      spots.length === 0 ? <p className="opts-note">No better spot within {radiusKm} km.</p> : null
    ) : (
      <div className="opts-search">
        {searchPhase === "error" && searchError && <p className="opts-note">{searchError}</p>}
        <Button size="sm" variant="primary" icon="search" disabled={!findPlan.body} title={findPlan.reason ?? undefined} onClick={() => findPlan.body && runSearch(findPlan.body, findPlan.guessS)}>
          Search within {radiusKm} km · {findPlan.about}
        </Button>
      </div>
    );

  const top = ranked[0] ?? null;
  usePublishScreenContext({
    where: "Overview",
    summary: top
      ? `Landing options for ${scope}, ranked by ${rankLabel(rank)}. Top: ${top.label}${top.t_ms !== null ? ` landing ${toIsoUtc(top.t_ms)}` : ""} (${top.verdict ?? "unknown"}).`
      : "",
    lines: [...pinned, ...ranked].slice(0, 8).map((o) => `${o.kind === "pin" ? "Pinned " : ""}${o.label}${o.t_ms !== null ? ` ${toIsoUtc(o.t_ms)}` : ""}: ${o.verdict ?? "unknown"}${o.limiting ? `, limited by ${o.limiting}` : ""}`),
  });

  const marks = useMemo(() => ranked.map((o, i) => ({ o, n: i + 1 })).filter(({ o }) => o.kind === "here" && o.t_ms !== null && o.verdict !== "fail").map(({ o, n }) => ({ key: o.key, t_ms: o.t_ms!, n, verdict: o.verdict })), [ranked]);

  return (
    <div className="home" aria-label="Overview page">
      <h1 className="sr-only">Overview: {siteName}</h1>
      {pinPlaces.map((p) => (
        <PinScan key={p.id} id={p.id} place={p.place} doc={doc} view={view} onScan={reportPin} />
      ))}
      <section className="home-hero" data-theme="dark" data-stale={!scan}>
        <MoonGlobe
          site={chosen}
          centre={site}
          preview={preview && !samePlace(preview.place, chosen) ? preview.place : null}
          focus={focus}
          sites={sites}
          pins={pinMarks}
          timeMs={landingMs}
          sub={sub}
          areaRadius_m={(radiusKm ?? findPlan.radiusKm) * 1000}
          lattice={lattice}
          latticeStale={searchStale}
          ranked={covers ? searchRows : []}
          onPickSite={pickCatalogSite}
          onSetPoint={setPoint}
          onUseCell={takeCell}
          onPickPin={(p) => moveTo({ lat_deg: p.lat_deg, lon_deg: p.lon_deg, name: p.name, catalog_id: pins.find((x) => x.id === p.id)?.catalog_id ?? null }, null, true)}
        />
        {lattice && !searchStale && (
          <div className="home-finder" data-theme="dark">
            <GlobeSearch lattice={lattice} tools={false} />
          </div>
        )}
        {scan && scan.result.provider !== "terrain" && (
          <p className="home-sky-note">
            <Icon name="warn" size={12} /> No terrain data: smooth-sphere horizon
          </p>
        )}
      </section>

      <OptionList
        pinned={pinned}
        ranked={ranked}
        rank={rank}
        requirements={requirements}
        selectedKey={selectedKey}
        previewKey={preview?.key ?? null}
        onPreview={previewOption}
        notice={notice}
        search={search}
        scope={scope}
        selection={
          <Selection
            name={chosenName}
            t_ms={landingMs}
            end_ms={landingMs + stayMs}
            light={light}
            verdict={planVerdict}
            limiting={planLimiting}
            n={selectedN}
            pinned={chosenPin !== null}
            canPin={pins.length < MAX_PINS}
            away={away}
            onShift={(d) => shiftPlanLanding(d * MS_DAY)}
            onPin={() => addPin(pinOf(chosen))}
            onUnpin={() => chosenPin && removePin(chosenPin.id)}
            onSearchHere={searchHere}
            onOpen={() => navigate("/site")}
          />
        }
        bar={
          <YearBar
            view={view}
            window={win}
            spans={requirements > 0 ? (chosenScan?.spans ?? null) : null}
            both={requirements > 0 || away ? null : (survey?.both ?? null)}
            marks={away ? [] : marks}
            stay={stay}
            preview={previewStay}
            busy={away ? chosenPin !== null && requirements > 0 && !chosenScan : requirements > 0 ? !scan : !survey}
            onPick={(ms) => land(ms)}
          />
        }
        onRank={(r: RankBy) => setRankBy(r)}
        onSelect={select}
        onOpen={(o) => {
          select(o);
          navigate("/site");
        }}
        onPin={(o) => addPin(pinOf(o.place))}
        onUnpin={(o) => {
          const p = pins.find((x) => samePlace(x, o.place));
          if (p) removePin(p.id);
        }}
        canPin={(o) => pins.length < MAX_PINS && !pins.some((p) => samePlace(p, o.place))}
      />
    </div>
  );
}
