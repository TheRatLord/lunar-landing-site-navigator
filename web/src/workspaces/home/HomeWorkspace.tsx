import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../api/client";
import { SITE_ENDPOINTS, type EvaluateResult } from "../../api/site";
import { useAnalysis } from "../../api/useAnalysis";
import { useLoad } from "../../api/useLoad";
import { usePublishScreenContext } from "../../ask/screenContext";
import { ServiceNotice } from "../../components/ServiceNotice";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { Spinner } from "../../components/ui/Progress";
import { HorizonPanorama } from "../../components/viz/HorizonPanorama";
import { formatLat, formatLon } from "../../lib/coords";
import { formatNum } from "../../lib/format";
import { clamp } from "../../lib/scale";
import { interpTrack } from "../../lib/track";
import { MS_DAY, parseUtc, toIsoUtc } from "../../lib/time";
import { catalogApi } from "../../scenario/api";
import { useAlternatives, type Candidate } from "../../scenario/alternatives";
import { movePlanSite, useScenario } from "../../scenario/store";
import type { Scenario } from "../../scenario/types";
import { evaluatedScenario } from "../site/adapt";
import { HomeMap, type MapFocus } from "./HomeMap";
import {
  SPAN_MS,
  adaptSurvey,
  coverage,
  dayText,
  dayTimeText,
  inSpan,
  longestWindow,
  nextWindow,
  roundToHour,
  spanStartFor,
  spanText,
  stateAt,
  surveyBody,
  trackWindow,
  windowAt,
  type BodyState,
  type Survey,
  type SurveySite,
} from "./survey";
import { PinnedRow, WindowStrip } from "./WindowStrip";
import "../../styles/home.css";

// Three.js is large: the ground view loads only when someone goes down to the ground.
const GroundView = lazy(() => import("./ground/GroundView").then((m) => ({ default: m.GroundView })));

const loadSites = (signal: AbortSignal) => catalogApi.sites({ limit: 1000 }, { signal });
const PLAY_MS_PER_S = 2 * MS_DAY;
const MAX_PINS = 4;
const FALLBACK_MS = Date.UTC(2027, 0, 12);
const round5 = (v: number): number => Math.round(v * 1e5) / 1e5;

function useSurvey(doc: Scenario, site: SurveySite, anchor: number) {
  const body = useMemo(() => surveyBody(doc, site, anchor), [doc, site, anchor]);
  const run = useAnalysis<EvaluateResult>(SITE_ENDPOINTS.evaluate, body, { debounceMs: 120 });
  const survey = useMemo<Survey | null>(() => {
    if (!run.result) return null;
    const start = parseUtc(evaluatedScenario(run.result)?.landing_utc ?? null);
    return adaptSurvey(run.result, start ?? anchor);
  }, [run.result, anchor]);
  return { run, survey };
}

const pinId = (s: SurveySite): string => s.catalog_id ?? `point:${s.lat_deg},${s.lon_deg}`;

function PinnedSite({ pin, doc, anchor, start, end, onSelect, onRemove }: { pin: Candidate; doc: Scenario; anchor: number; start: number; end: number; onSelect(): void; onRemove(): void }) {
  const site = useMemo<SurveySite>(() => ({ lat_deg: pin.lat_deg, lon_deg: pin.lon_deg, name: pin.name, catalog_id: pin.catalog_id }), [pin]);
  const { run, survey } = useSurvey(doc, site, anchor);
  return (
    <PinnedRow
      label={pin.name}
      sub={`${formatLat(pin.lat_deg, 2)} ${formatLon(pin.lon_deg, 2)}`}
      survey={survey && !run.stale ? survey : null}
      failed={run.phase === "error"}
      start_ms={start}
      end_ms={end}
      onSelect={onSelect}
      onRemove={onRemove}
    />
  );
}

function BodyCard({ body, state, timeMs, elevation }: { body: "sun" | "earth"; state: BodyState; timeMs: number; elevation: number | null }) {
  const sun = body === "sun";
  const title = sun ? (state.up ? "Sunlight" : "Dark") : state.up ? "Earth in view" : "Earth hidden";
  const next = sun ? (state.up ? "until sunset" : "until sunrise") : state.up ? "until Earth sets" : "until Earth rises";
  return (
    <div className={`home-card home-card-${body}`} data-up={state.up}>
      <div className="home-card-head">
        <Icon name={sun ? "sun" : "earth"} size={14} />
        {title}
      </div>
      {state.change_ms === null ? (
        <>
          <div className="home-card-value">All year</div>
          <div className="home-card-sub">{state.up ? "no end within this year" : sun ? "no sunrise within this year" : "never rises within this year"}</div>
        </>
      ) : (
        <>
          <div className="home-card-value num">{spanText(state.change_ms - timeMs)}</div>
          <div className="home-card-sub">
            {next} · {dayTimeText(state.change_ms)}
          </div>
        </>
      )}
      {elevation !== null && (
        <div className="home-card-foot num">
          {sun ? "Sun" : "Earth"} centre {formatNum(elevation, 1)}° {elevation >= 0 ? "above" : "below"} the level horizon
        </div>
      )}
    </div>
  );
}

export function HomeWorkspace() {
  const doc = useScenario((s) => s.doc)!;
  const edit = useScenario((s) => s.edit);
  const pins = useAlternatives((s) => s.items);
  const addPin = useAlternatives((s) => s.add);
  const removePin = useAlternatives((s) => s.remove);
  const sitesLoad = useLoad(loadSites);
  const sites = useMemo(() => (sitesLoad.state.status === "ready" ? sitesLoad.state.data.items : []), [sitesLoad.state]);

  const lat = doc.site.lat_deg;
  const lon = doc.site.lon_deg;
  const name = doc.site.name ?? "";
  const catalogId = doc.site.catalog_id ?? null;
  const site = useMemo<SurveySite>(() => ({ lat_deg: lat, lon_deg: lon, name, catalog_id: catalogId }), [lat, lon, name, catalogId]);
  const landingMs = parseUtc(doc.landing_utc) ?? FALLBACK_MS;

  const [anchor, setAnchor] = useState(() => spanStartFor(landingMs));
  if (!inSpan(landingMs, anchor)) setAnchor(spanStartFor(landingMs));
  const [live, setLive] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [focus, setFocus] = useState<MapFocus>(() => ({ lat_deg: lat, lon_deg: lon, nonce: 0 }));
  const place = `${lat},${lon}`;
  const [shownPlace, setShownPlace] = useState(place);
  const [mapPlace, setMapPlace] = useState<string | null>(null);
  if (shownPlace !== place) {
    setShownPlace(place);
    if (mapPlace !== place) setFocus((f) => ({ lat_deg: lat, lon_deg: lon, nonce: f.nonce + 1 }));
  }
  const [ground, setGround] = useState(false);

  const { run, survey } = useSurvey(doc, site, anchor);
  const start = survey?.start_ms ?? anchor;
  const end = start + SPAN_MS;
  const timeMs = clamp(live ?? landingMs, start, end);

  const commit = useCallback(
    (ms: number) => {
      setLive(null);
      edit(["landing_utc"], toIsoUtc(roundToHour(ms)));
    },
    [edit],
  );

  const liveRef = useRef(timeMs);
  useEffect(() => {
    liveRef.current = timeMs;
  });
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = liveRef.current + Math.min(0.25, (now - last) / 1000) * PLAY_MS_PER_S;
      last = now;
      if (next >= end) {
        setPlaying(false);
        return;
      }
      liveRef.current = next;
      setLive(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      commit(liveRef.current);
    };
  }, [playing, end, commit]);

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
  const setPoint = useCallback((la: number, lo: number) => moveOnMap({ lat_deg: round5(la), lon_deg: round5(lo), name: "Map point", catalog_id: null }), [moveOnMap]);

  const pinned = pins.some((p) => p.id === pinId(site));
  const pinMarks = useMemo(() => pins.filter((p) => p.id !== pinId(site)).map((p) => ({ id: p.id, name: p.name, lat_deg: p.lat_deg, lon_deg: p.lon_deg })), [pins, site]);

  const fresh = survey !== null && !run.stale;
  const sun = survey ? stateAt(survey.sun, timeMs, survey) : null;
  const earth = survey ? stateAt(survey.earth, timeMs, survey) : null;
  const usable = survey ? windowAt(survey.both, timeMs) : null;
  const upcoming = survey ? nextWindow(survey.both, timeMs) : null;
  const longest = survey ? longestWindow(survey.both) : null;
  const sunNow = survey?.sunTrack ? interpTrack(survey.sunTrack, timeMs) : null;
  const earthNow = survey?.earthTrack ? interpTrack(survey.earthTrack, timeMs) : null;
  const sunWindow = useMemo(() => trackWindow(survey?.sunTrack ?? null, timeMs), [survey, timeMs]);
  const earthWindow = useMemo(() => trackWindow(survey?.earthTrack ?? null, timeMs), [survey, timeMs]);

  const headline = !survey || !sun || !earth
    ? null
    : usable
      ? { tone: "pass", text: `Power and a direct Earth link for the next ${spanText(usable.end_ms - timeMs)}` }
      : sun.up
        ? { tone: "marginal", text: "Sunlit, but Earth is below the horizon: no direct link" }
        : earth.up
          ? { tone: "marginal", text: "Earth is in view, but the site is dark: no solar power" }
          : { tone: "fail", text: "Dark and out of Earth's view" };

  usePublishScreenContext({
    where: "Overview",
    summary: headline?.text ?? "",
    lines: survey
      ? [
          `The overview shows one year of Sun and Earth visibility from ${dayText(start, true)} for ${name} at ${lat} deg latitude, ${lon} deg longitude.`,
          `Sunlit ${Math.round(coverage(survey.sun, survey) * 100)} percent of the year, Earth in view ${Math.round(coverage(survey.earth, survey) * 100)} percent, both ${Math.round(coverage(survey.both, survey) * 100)} percent.`,
        ]
      : [],
  });

  return (
    <div className="home" aria-label="Overview page">
      <h1 className="sr-only">Overview: {name}</h1>
      {run.error && run.phase === "error" ? (
        <div className="home-pad">
          <ServiceNotice
            error={run.error instanceof ApiError ? run.error : new ApiError({ status: 0, title: "Could not compute this site", detail: run.error.message })}
            what="the year of Sun and Earth visibility"
            onRetry={run.rerun}
          />
        </div>
      ) : (
        <section className="home-verdict" data-stale={!fresh} aria-live="polite">
          <div className="home-headline">
            {headline ? (
              <>
                <p className="home-headline-text">
                  <span className="home-tone" data-tone={headline.tone} aria-hidden="true" />
                  {headline.text}
                </p>
                <p className="home-headline-sub">
                  {usable ? (
                    <>
                      This window: {dayText(usable.start_ms)} to {dayText(usable.end_ms)}, {spanText(usable.end_ms - usable.start_ms)}
                    </>
                  ) : upcoming ? (
                    <>
                      Next window with both:{" "}
                      <button type="button" className="home-jump" onClick={() => commit(upcoming.start_ms + 3_600_000)}>
                        {dayText(upcoming.start_ms)}, {spanText(upcoming.end_ms - upcoming.start_ms)}
                      </button>
                    </>
                  ) : (
                    <>No later window with both in this year.</>
                  )}
                  {longest && longest !== usable && longest !== upcoming && (
                    <>
                      {" · "}
                      Longest this year:{" "}
                      <button type="button" className="home-jump" onClick={() => commit(longest.start_ms + 3_600_000)}>
                        {dayText(longest.start_ms)}, {spanText(longest.end_ms - longest.start_ms)}
                      </button>
                    </>
                  )}
                </p>
                <Link className="home-more" to="/site" title="Requirements, uncertainty, battery, ground stations and exports for this site and date">
                  Check every requirement
                  <Icon name="chevronRight" size={12} />
                </Link>
              </>
            ) : (
              <p className="home-headline-wait" role="status">
                <Spinner size={14} /> {run.stage ?? "Computing"}
              </p>
            )}
          </div>
          {sun && <BodyCard body="sun" state={sun} timeMs={timeMs} elevation={sunNow ? sunNow.el_deg : null} />}
          {earth && <BodyCard body="earth" state={earth} timeMs={timeMs} elevation={earthNow ? earthNow.el_deg : null} />}
        </section>
      )}

      {ground ? (
        <div className="home-stage home-stage-ground" data-stale={!fresh}>
          <Suspense
            fallback={
              <p className="home-sky-wait" role="status">
                <Spinner size={14} />
              </p>
            }
          >
            <GroundView
              key={`${lat},${lon}`}
              siteName={name}
              lat={lat}
              lon={lon}
              eyeM={doc.profile.array_height_m}
              horizon={survey?.horizon ?? null}
              sunTrack={survey?.sunTrack ?? null}
              earthTrack={survey?.earthTrack ?? null}
              timeMs={timeMs}
              onExit={() => setGround(false)}
            />
          </Suspense>
        </div>
      ) : (
        <div className="home-stage">
          <div className="home-pane home-pane-map">
            <HomeMap site={site} focus={focus} sites={sites} pinned={pinMarks} onPickSite={pickCatalogSite} onSetPoint={setPoint} onStand={() => setGround(true)} />
          </div>
          <div className="home-pane home-pane-sky" data-stale={!fresh}>
            {survey?.horizon ? (
              <HorizonPanorama
                horizon={survey.horizon}
                sun={sunWindow}
                earth={earthWindow}
                timeMs={timeMs}
                elevationFit={survey.fit ?? undefined}
                discInset={false}
                title="Sun and Earth against the horizon, seen from the site"
              />
            ) : (
              <div className="home-sky-wait" role="status">
                {run.phase !== "error" && <Spinner size={14} />}
              </div>
            )}
            {survey?.smooth && (
              <p className="home-sky-note">
                <Icon name="warn" size={12} /> No terrain data here: the horizon is a smooth sphere.
              </p>
            )}
          </div>
        </div>
      )}

      <WindowStrip
        start_ms={start}
        end_ms={end}
        timeMs={timeMs}
        survey={survey}
        busy={!fresh}
        onScrub={setLive}
        onCommit={commit}
        tools={
          <>
            <Button size="sm" variant="ghost" icon={playing ? "pause" : "play"} aria-pressed={playing} title="Run the date forward through the year" onClick={() => setPlaying(!playing)}>
              {playing ? "Pause" : "Play year"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={pinned ? "check" : "pin"}
              disabled={pinned || pins.length >= MAX_PINS}
              title={pinned ? "This site is pinned below" : pins.length >= MAX_PINS ? `Unpin a site first (${MAX_PINS} at most)` : "Keep this site's row on the timeline, then try another site"}
              onClick={() => addPin({ id: pinId(site), name: name || "Unnamed site", lat_deg: lat, lon_deg: lon, catalog_id: catalogId })}
            >
              {pinned ? "Pinned" : "Pin site"}
            </Button>
          </>
        }
      >
        {pins.map((p) => (
          <PinnedSite
            key={p.id}
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
      <p className="home-foot">
        Nominal terrain horizon for a {doc.profile.array_height_m} m solar array and a {doc.profile.antenna_height_m} m antenna. Uncertainty ranges, battery, ground stations and slope are on the{" "}
        <Link to="/site">Site</Link> page.
      </p>
    </div>
  );
}
