import { siteLabel } from "../../lib/siteName";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PLANNING_ENDPOINTS, type ScanResult } from "../../api/planning";
import { useReportPlanning } from "../../api/report";
import { SITE_ENDPOINTS, type EvaluateResult } from "../../api/site";
import { useAnalysis } from "../../api/useAnalysis";
import { useLoad } from "../../api/useLoad";
import { usePublishScreenContext } from "../../ask/screenContext";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { ProgressBar, Spinner } from "../../components/ui/Progress";
import { VERDICT_LABEL } from "../../lib/verdict";
import { parseUtc, toIsoUtc } from "../../lib/time";
import { catalogApi } from "../../scenario/api";
import { useAlternatives } from "../../scenario/alternatives";
import { DEFAULT_RADIUS_KM, activeRequirements, effectiveWindow, isYear, rankLabel, shiftYear, usePlanSearch, useRankBy, yearFrom, yearText, type LandingWindow, type RankBy } from "../../scenario/planSearch";
import { movePlanSite, routeStackIssues, useScenario } from "../../scenario/store";
import type { Scenario } from "../../scenario/types";
import { spanText, whenText } from "../../scenario/when";
import { leftText } from "../map/eta";
import { announceSiteMove, pointName, siteSnapshot } from "../map/siteMove";
import { useFindOutOfDate, useFindPlan, useSearchCovers } from "../search/findSites";
import { useSearchResults } from "../search/results";
import { GlobeSearch } from "./globe/GlobeSearch";
import { adaptLattice, type Cell } from "./globe/lattice";
import { MoonGlobe, type GlobeFocus } from "./globe/MoonGlobe";
import { useSubpoints } from "./globe/subpoints";
import { OptionList } from "./OptionList";
import { closestOption, hereOptions, pinOption, samePlace, sortOptions, spotOptions, type LandingOption, type Place } from "./options";
import { adaptScan, limitingAt, scanIndexAt, scanParams, verdictAt, yearScanBody, type YearScan } from "./scan";
import { adaptSurvey, surveyBody } from "./survey";
import { YearBar } from "./YearBar";
import "../../styles/home.css";

const loadSites = (signal: AbortSignal) => catalogApi.sites({ limit: 1000 }, { signal });
const MAX_PINS = 4;
const FALLBACK_MS = Date.UTC(2027, 0, 1);
const round5 = (v: number): number => Math.round(v * 1e5) / 1e5;
const sameWindow = (a: LandingWindow, b: LandingWindow): boolean => a.first_ms === b.first_ms && a.last_ms === b.last_ms;
const overlaps = (a: LandingWindow, b: LandingWindow): boolean => a.first_ms < b.last_ms && b.first_ms < a.last_ms;

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

  const lat = doc.site.lat_deg;
  const lon = doc.site.lon_deg;
  const name = doc.site.name ?? "";
  const catalogId = doc.site.catalog_id ?? null;
  const site = useMemo<Place>(() => ({ lat_deg: lat, lon_deg: lon, name, catalog_id: catalogId }), [lat, lon, name, catalogId]);
  const siteName = siteLabel(name) || "Unnamed site";
  const landingMs = parseUtc(doc.landing_utc) ?? FALLBACK_MS;

  const win = effectiveWindow(doc, planWindow);
  const [view, setView] = useState<LandingWindow>(() => (isYear(win) ? win : yearFrom(win.first_ms)));
  const wantView = isYear(win) ? win : overlaps(view, win) ? view : yearFrom(win.first_ms);
  if (!sameWindow(wantView, view)) setView(wantView);
  const [draftWin, setDraftWin] = useState<LandingWindow | null>(null);
  const listWin = draftWin ?? win;
  const whole = listWin.first_ms <= view.first_ms && listWin.last_ms >= view.last_ms;

  const [focus, setFocus] = useState<GlobeFocus>(() => ({ lat_deg: lat, lon_deg: lon, radius_m: 0, nonce: 0 }));
  const placeKey = `${lat},${lon}`;
  const [shownPlace, setShownPlace] = useState(placeKey);
  const [mapPlace, setMapPlace] = useState<string | null>(null);
  if (shownPlace !== placeKey) {
    setShownPlace(placeKey);
    if (mapPlace !== placeKey) setFocus((f) => ({ lat_deg: lat, lon_deg: lon, radius_m: 0, nonce: f.nonce + 1 }));
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

  const atLanding = (o: LandingOption) => samePlace(o.place, site) && o.t_ms !== null && Math.abs(o.t_ms - landingMs) < 30 * 60_000;
  const selectedKey = [...pinned, ...ranked].find(atLanding)?.key ?? null;

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
    (p: Place, t: number | null, fromGlobe: boolean) => {
      const prev = siteSnapshot();
      keepYear(t);
      if (fromGlobe) setMapPlace(`${p.lat_deg},${p.lon_deg}`);
      movePlanSite({ lat_deg: p.lat_deg, lon_deg: p.lon_deg, name: p.name, catalog_id: p.catalog_id });
      if (t !== null) edit(["landing_utc"], toIsoUtc(t));
      announceSiteMove(prev, () => navigate("/site"));
    },
    [keepYear, edit, navigate],
  );
  const select = useCallback(
    (o: LandingOption) => {
      if (samePlace(o.place, site)) {
        if (o.t_ms !== null) land(o.t_ms);
      } else moveTo(o.place, o.t_ms, false);
    },
    [site, land, moveTo],
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
    (c: Cell, withDate: boolean) => moveTo({ lat_deg: round5(c.lat_deg), lon_deg: round5(c.lon_deg), name: pointName(c.lat_deg, c.lon_deg), catalog_id: null }, withDate && c.best_ms !== null ? c.best_ms : null, true),
    [moveTo],
  );

  const sub = useSubpoints(view.first_ms, view.last_ms);
  const pinMarks = useMemo(() => pins.filter((p) => !samePlace(p, site)).map((p) => ({ id: p.id, name: p.name, lat_deg: p.lat_deg, lon_deg: p.lon_deg })), [pins, site]);

  const windowPhrase = whole ? `any time in ${yearText(view)}` : spanText(listWin.first_ms, listWin.last_ms - 1);
  const scope = `${siteName}${radiusKm !== null ? ` and ${radiusKm} km around` : ""} · ${windowPhrase}`;
  const planIndex = scan ? scanIndexAt(scan, landingMs) : null;
  const planVerdict = scan && planIndex !== null ? verdictAt(scan, planIndex) : null;

  const notice = scanRun.phase === "error" ? (
    <p className="opts-note" role="alert">
      Couldn't check the year.{" "}
      <button type="button" className="opts-link" onClick={scanRun.rerun}>
        Retry
      </button>
    </p>
  ) : !scan ? (
    <p className="opts-note" role="status">
      <Spinner size={12} /> Checking every landing hour in {yearText(view)}
    </p>
  ) : here.length === 0 ? (
    <div className="opts-empty">
      <p>
        <strong>Nothing at {siteName} meets the requirements {whole ? `in ${yearText(view)}` : "in this window"}.</strong>
        {scan.closing ? ` It is most often limited by ${scan.closing}.` : ""} The closest landing is below.
      </p>
      <div className="opts-empty-actions">
        {!whole && (
          <Button size="sm" onClick={() => setWindow(view)}>
            Search the whole year
          </Button>
        )}
        {radiusKm === null && (
          <Button size="sm" onClick={() => setRadius(DEFAULT_RADIUS_KM)}>
            Look within {DEFAULT_RADIUS_KM} km
          </Button>
        )}
      </div>
    </div>
  ) : null;

  const search =
    radiusKm === null ? (
      <p className="opts-note">
        Only this site is searched.{" "}
        <button type="button" className="opts-link" onClick={() => setRadius(DEFAULT_RADIUS_KM)}>
          Add spots within {DEFAULT_RADIUS_KM} km
        </button>
      </p>
    ) : searchPhase === "running" && searchStarted !== null ? (
      <div className="opts-search" role="status">
        <div className="opts-search-row">
          <span>Searching within {radiusKm} km · {leftText(searchStarted, searchProgress, searchGuess)}</span>
          <Button size="sm" variant="ghost" onClick={cancelSearch}>
            Cancel
          </Button>
        </div>
        <ProgressBar value={searchProgress ?? 0} label="Search progress" />
      </div>
    ) : covers ? (
      <p className="opts-note">
        {spots.length === 0 ? `No other spot within ${radiusKm} km made the top of the search.` : `Includes the best spots within ${radiusKm} km.`}
      </p>
    ) : (
      <div className="opts-search">
        <p className="opts-note">
          {searchResult ? "The nearby search is out of date." : `Spots within ${radiusKm} km need a search across the window.`}
          {searchPhase === "error" && searchError ? ` ${searchError}` : ""}
        </p>
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
          site={site}
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
        <div className="home-plan">
          <p className="home-plan-site">{siteName}</p>
          <p className="home-plan-when">
            {whenText(landingMs)}
            {requirements > 0 && planVerdict && (
              <span className="home-plan-verdict" data-tone={planVerdict}>
                {VERDICT_LABEL[planVerdict]}
                {planVerdict !== "pass" && planIndex !== null && scan && limitingAt(scan, planIndex) ? ` · ${limitingAt(scan, planIndex)}` : ""}
              </span>
            )}
          </p>
        </div>
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
        notice={notice}
        search={search}
        scope={scope}
        bar={
          <YearBar
            view={view}
            window={win}
            spans={requirements > 0 ? (scan?.spans ?? null) : null}
            both={requirements > 0 ? null : (survey?.both ?? null)}
            marks={marks}
            landingMs={landingMs}
            busy={requirements > 0 ? !scan : !survey}
            onWindow={(w) => setWindow(w.first_ms <= view.first_ms && w.last_ms >= view.last_ms ? view : w)}
            onDraft={setDraftWin}
            onPick={(ms) => land(ms)}
            onYear={(d) => setWindow(shiftYear(view, d))}
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
