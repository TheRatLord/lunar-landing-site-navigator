import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { terrainApi } from "../../api/terrain";
import type { SearchRow } from "../../api/search";
import { useLoad } from "../../api/useLoad";
import { ServiceNotice } from "../../components/ServiceNotice";
import { IconButton } from "../../components/ui/Button";
import { Tabs } from "../../components/ui/Panel";
import { useColors } from "../../components/viz/useColors";
import { parseUtc } from "../../lib/time";
import { catalogApi, type SiteEntry } from "../../scenario/api";
import { useAlternatives, useOverlays } from "../../scenario/alternatives";
import { movePlanSite, useScenario } from "../../scenario/store";
import { whenText } from "../../scenario/when";
import { regionalView } from "../regional/RegionalRow";
import { useRegionalLayer } from "../regional/regionalLayerStore";
import { useFindPlan } from "../search/findSites";
import { ResultsPanel } from "../search/ResultsPanel";
import { useSearchResults } from "../search/results";
import "../../styles/map.css";
import { TILESET_OF_VIEW } from "./basis";
import { CursorBus } from "./cursorBus";
import { leftText } from "./eta";
import type { ActiveLayer, MapEngine, MapOptions, ScenarioMark, SearchArea } from "./engine";
import { KindGlyph } from "./KindGlyph";
import { LayersPanel } from "./LayersPanel";
import { MapCanvas, type TileProblem } from "./MapCanvas";
import { MapPopup, PlaceActions, SiteSources, SiteTitleIcon, siteFacts } from "./MapPopup";
import { useMapStore, type DockTab } from "./mapStore";
import { STATE_WORD, marginText, pinMarks, regionalMark } from "./overlays";
import { Readout } from "./Readout";
import { announceSiteMove, pointName, restoreSite, siteSnapshot } from "./siteMove";
import { KIND_ORDER, KIND_STYLE } from "./sites";
import { SitesPanel } from "./SitesPanel";
import { Toolbar } from "./Toolbar";
import { pointFromUrl, viewKindFor, type ViewKind } from "./urlState";
import type { MapView } from "./view";

const loadTilesets = (signal: AbortSignal) => terrainApi.tilesets({ signal });
const loadSites = (signal: AbortSignal) => catalogApi.sites({ limit: 1000 }, { signal });

const DOCK_TABS = [
  { id: "layers", label: "Layers" },
  { id: "sites", label: "Sites" },
  { id: "results", label: "Results" },
];
const SITE_RADIUS_M = 45_000;
const POINT_RADIUS_M = 15_000;
const round5 = (v: number): number => Math.round(v * 1e5) / 1e5;
const isTyping = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
const siteKeyOf = (site: { lat_deg: number; lon_deg: number } | undefined): string => (site ? `${site.lat_deg},${site.lon_deg}` : "");

let framedRegional: unknown = null;
let framedBlocker: unknown = null;

interface Start {
  kind: ViewKind;
  view: MapView | null;
  point: { lat_deg: number; lon_deg: number } | null;
}

export function MapWorkspace() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const s = useMapStore();
  const doc = useScenario((st) => st.doc);
  const site = doc?.site;
  const ellipse = doc?.ellipse;
  const alternatives = useAlternatives((st) => st.items);
  const addAlternative = useAlternatives((st) => st.add);
  const blocker = useOverlays((st) => st.blocker);
  const tilesets = useLoad(loadTilesets);
  const sitesLoad = useLoad(loadSites);
  const colors = useColors();
  const bus = useMemo(() => new CursorBus(), []);
  const searchRef = useRef<HTMLInputElement>(null);
  const [engine, setEngine] = useState<MapEngine | null>(null);
  const [tileProblem, setTileProblem] = useState<TileProblem | null>(null);

  const [start] = useState<Start>(() => {
    const point = pointFromUrl(params);
    if (point) return { kind: viewKindFor(point.lat_deg), view: null, point };
    if (blocker && blocker !== framedBlocker) return { kind: viewKindFor(blocker.from.lat_deg), view: null, point: null };
    const saved = useMapStore.getState().saved;
    if (saved && saved.siteKey === siteKeyOf(site)) return { kind: saved.kind, view: saved.view, point: null };
    return { kind: site ? viewKindFor(site.lat_deg) : "south", view: null, point: null };
  });
  const [kind, setKind] = useState<ViewKind>(start.kind);
  const polar: "south" | "north" = kind !== "global" ? kind : (site?.lat_deg ?? -1) < 0 ? "south" : "north";

  const plan = useFindPlan();
  const search = useSearchResults();
  const regional = useRegionalLayer();

  const tilesetList = tilesets.state.status === "ready" ? tilesets.state.data.tilesets : null;
  const renderVersion = tilesets.state.status === "ready" ? tilesets.state.data.render_version : "";
  const tileset = tilesetList?.find((t) => t.id === TILESET_OF_VIEW[kind]) ?? null;
  const allSites = useMemo(() => (sitesLoad.state.status === "ready" ? sitesLoad.state.data.items : null), [sitesLoad.state]);
  const shownSites = useMemo(() => (allSites ?? []).filter((x) => s.kinds.has(x.kind)), [allSites, s.kinds]);
  const kindCounts = useMemo(() => new Map(KIND_ORDER.map((k) => [k, (allSites ?? []).filter((x) => x.kind === k).length])), [allSites]);

  const scenario = useMemo<ScenarioMark | null>(() => (site ? { lat_deg: site.lat_deg, lon_deg: site.lon_deg, name: site.name ?? "", ellipse: ellipse ?? null } : null), [site, ellipse]);
  const layers = useMemo<ActiveLayer[]>(() => (s.base === "relief" ? [{ id: "relief", opacity: 1 }] : [{ id: "relief", opacity: 1 }, { id: s.base, opacity: s.baseOpacity }]), [s.base, s.baseOpacity]);
  const options = useMemo<MapOptions>(() => ({ graticule: s.graticule, sites: s.sites, compass: true }), [s.graticule, s.sites]);
  const pins = useMemo(() => (search.shown ? pinMarks(search.candidates) : []), [search.shown, search.candidates]);
  const areaBody = search.phase === "running" ? search.body : search.resultBody;
  const area = useMemo<SearchArea | null>(() => {
    const r = areaBody?.region;
    if (r && typeof r.radius_m === "number") return search.shown ? { lat_deg: r.lat_deg, lon_deg: r.lon_deg, radius_m: r.radius_m } : null;
    return site && plan.radiusKm ? { lat_deg: site.lat_deg, lon_deg: site.lon_deg, radius_m: plan.radiusKm * 1000 } : null;
  }, [areaBody, search.shown, site, plan.radiusKm]);
  const regionalLayerView = useMemo(
    () => (regional.result && regional.resultBody && regional.resultMetric ? regionalView(regional.result, regional.resultBody, regional.resultMetric) : null),
    [regional.result, regional.resultBody, regional.resultMetric],
  );
  const regionalCells = useMemo(() => (regional.shown && regionalLayerView ? regionalMark(regionalLayerView, colors.get) : null), [regional.shown, regionalLayerView, colors]);

  const popup = s.popup;
  const popupSite = popup?.kind === "site" ? (allSites?.find((x) => x.id === popup.id) ?? null) : null;
  const popupPin = popup?.kind === "pin" ? (search.candidates.find((r) => r.rank === popup.rank) ?? null) : null;
  const pinLanding = popupPin && popupPin.n_epochs > 1 ? parseUtc(popupPin.landing_utc) : null;

  const engineRef = useRef<MapEngine | null>(null);
  useEffect(() => {
    engineRef.current = engine;
  }, [engine]);

  const showKind = useCallback((k: ViewKind) => {
    setKind(k);
    engineRef.current?.setKind(k);
  }, []);

  const goTo = useCallback(
    (la: number, lo: number, radius_m: number) => {
      showKind(viewKindFor(la));
      engineRef.current?.fitAround(la, lo, radius_m);
    },
    [showKind],
  );

  const fitSite = useCallback(() => {
    const sc = useScenario.getState().doc;
    if (sc) goTo(sc.site.lat_deg, sc.site.lon_deg, SITE_RADIUS_M);
  }, [goTo]);

  const showRegional = useCallback(() => {
    const { resultBody } = useRegionalLayer.getState();
    if (resultBody) goTo(resultBody.lat_deg, resultBody.lon_deg, (resultBody.size_m / 2) * 1.2);
  }, [goTo]);

  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || !engine || !tilesetList) return;
    framed.current = true;
    const id = window.setTimeout(() => {
      const p = start.point;
      if (p) {
        useMapStore.getState().set({ probe: p, popup: { kind: "probe" } });
        goTo(p.lat_deg, p.lon_deg, POINT_RADIUS_M);
      } else if (blocker && blocker !== framedBlocker) {
        framedBlocker = blocker;
        engine.fitBlocker();
      } else if (!start.view) fitSite();
    }, 0);
    return () => window.clearTimeout(id);
  }, [engine, tilesetList, start, blocker, goTo, fitSite]);

  useEffect(() => {
    if (!engine || !blocker || blocker === framedBlocker || !framed.current) return;
    framedBlocker = blocker;
    showKind(viewKindFor(blocker.from.lat_deg));
    engine.fitBlocker();
  }, [engine, blocker, showKind]);

  useEffect(() => {
    if (!engine || !regional.result || regional.result === framedRegional) return;
    framedRegional = regional.result;
    showRegional();
  }, [engine, regional.result, showRegional]);

  useEffect(() => {
    if (useOverlays.getState().picking) useOverlays.getState().setPicking(false);
  }, []);

  const viewRef = useRef<MapView | null>(start.view);
  useEffect(
    () => () => {
      const v = viewRef.current;
      const sc = useScenario.getState().doc;
      if (v && engineRef.current) useMapStore.getState().set({ saved: { kind: engineRef.current.kind, view: v, siteKey: siteKeyOf(sc?.site) } });
    },
    [],
  );

  const openSite = useCallback(() => navigate("/site"), [navigate]);
  const adoptSite = useCallback(
    (next: { lat_deg: number; lon_deg: number; name: string; catalog_id: string | null }) => {
      const prev = siteSnapshot();
      if (!prev) return;
      useMapStore.getState().pushUndo(prev);
      movePlanSite(next);
      announceSiteMove(prev, openSite);
    },
    [openSite],
  );

  const closePopup = useCallback(() => useMapStore.getState().set({ popup: null, probe: null }), []);

  const onSetSite = useCallback(
    (la: number, lo: number) => {
      if (useMapStore.getState().popup) return closePopup();
      adoptSite({ lat_deg: round5(la), lon_deg: round5(lo), name: pointName(la, lo), catalog_id: null });
    },
    [closePopup, adoptSite],
  );

  const pickSite = useCallback((id: string | null) => useMapStore.getState().set({ popup: id ? { kind: "site", id } : null, probe: null }), []);
  const pickPin = useCallback((rank: number) => useMapStore.getState().set({ popup: { kind: "pin", rank }, probe: null }), []);
  const pickProbe = useCallback(() => useMapStore.getState().set({ popup: { kind: "probe" } }), []);

  const focusSite = useCallback(
    (x: SiteEntry) => {
      pickSite(x.id);
      goTo(x.lat_deg, x.lon_deg, x.extent_km ? Math.max(x.extent_km * 750, 3000) : 8000);
    },
    [goTo, pickSite],
  );
  const focusPoint = useCallback(
    (la: number, lo: number) => {
      useMapStore.getState().set({ probe: { lat_deg: la, lon_deg: lo }, popup: { kind: "probe" } });
      goTo(la, lo, POINT_RADIUS_M);
    },
    [goTo],
  );
  const focusPin = useCallback(
    (r: SearchRow) => {
      pickPin(r.rank);
      const e = engineRef.current;
      if (e && !e.screenOf(r.lat_deg, r.lon_deg)) goTo(r.lat_deg, r.lon_deg, 4000);
    },
    [goTo, pickPin],
  );

  const runFind = useCallback(() => {
    const st = useSearchResults.getState();
    useMapStore.getState().set({ dockOpen: true, tab: "results" });
    if (!plan.body || st.phase === "running") return;
    if (st.resultBody && JSON.stringify(st.resultBody) === JSON.stringify(plan.body)) return;
    if (useMapStore.getState().popup?.kind === "pin") useMapStore.getState().set({ popup: null });
    st.run(plan.body, plan.guessS);
    const r = plan.body.region;
    if (typeof r.radius_m === "number") goTo(r.lat_deg, r.lon_deg, r.radius_m * 1.4);
  }, [plan, goTo]);

  const undo = useCallback(() => {
    const snap = useMapStore.getState().popUndo();
    if (snap) restoreSite(snap);
  }, []);

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keyRef.current = (e) => {
      if (e.defaultPrevented || isTyping(e.target)) return;
      const st = useMapStore.getState();
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "z") {
        if (st.undo.length > 0) {
          e.preventDefault();
          undo();
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === "Escape") {
        if (st.popup) closePopup();
        else if (st.measure.length > 0) st.set({ measure: [] });
        else if (st.mode === "measure") st.set({ mode: "choose" });
        else return;
      } else if (key === "m") st.set({ mode: st.mode === "measure" ? "choose" : "measure", measure: [] });
      else if (key === "f") fitSite();
      else if (key === "l") st.set({ dockOpen: !st.dockOpen });
      else if (key === "/") searchRef.current?.focus();
      else if (key === "Backspace" && st.mode === "measure") st.popMeasure();
      else if (key === "+" || key === "=") engineRef.current?.zoomBy(1);
      else if (key === "-" || key === "_") engineRef.current?.zoomBy(-1);
      else return;
      e.preventDefault();
    };
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const tsError = tilesets.state.status === "error" ? tilesets.state.error : null;
  const inCompare = (id: string) => alternatives.some((a) => a.id === id);
  const isPlanAt = (la: number, lo: number) => site !== undefined && Math.abs(site.lat_deg - la) < 1e-6 && Math.abs(site.lon_deg - lo) < 1e-6;
  const current = search.resultBody !== null && plan.body !== null && JSON.stringify(search.resultBody) === JSON.stringify(plan.body);
  const findLabel =
    search.phase === "running" && search.startedMs !== null
      ? { label: "Searching", note: leftText(search.startedMs, search.progress, search.guessS).replace("about ", "~"), busy: true }
      : { label: "Find sites", note: current ? `${search.candidates.length} found` : plan.body ? plan.about.replace("about ", "~") : null, busy: false };
  const pinName = (r: SearchRow) => `Find sites #${r.rank}`;
  const pinId = (r: SearchRow) => `search-${r.lat_deg.toFixed(5)}_${r.lon_deg.toFixed(5)}`;
  const probe = s.probe;

  return (
    <div className="map-ws" data-dock={s.dockOpen ? "open" : "closed"}>
      <h1 className="sr-only">Map</h1>
      <div className="map-body">
        <div className="map-main">
          <div className="map-view">
            <MapCanvas
              kind={kind}
              initialView={start.view}
              tilesets={tilesetList}
              renderVersion={renderVersion}
              sites={shownSites}
              layers={layers}
              options={options}
              selectedId={popupSite?.id ?? null}
              scenario={scenario}
              alternatives={alternatives}
              blocker={blocker}
              pins={pins}
              selectedPin={popupPin?.rank ?? null}
              area={area}
              probe={probe}
              regional={regionalCells}
              regionalOpacity={regional.opacity}
              measure={s.measure}
              mode={s.mode}
              bus={bus}
              onEngine={setEngine}
              onPickSite={pickSite}
              onPickPin={pickPin}
              onPickProbe={pickProbe}
              onSetSite={onSetSite}
              onMeasure={s.addMeasure}
              onView={(v) => {
                viewRef.current = { cx: v.cx, cy: v.cy, zoom: v.zoom };
              }}
              onTileProblem={setTileProblem}
            />
            <Toolbar
              kind={kind}
              polar={polar}
              mode={s.mode}
              canFitSite={scenario !== null}
              sites={allSites ?? []}
              searchRef={searchRef}
              find={findLabel}
              onKind={showKind}
              onZoom={(dz) => engine?.zoomBy(dz)}
              onFitSite={fitSite}
              onMeasure={() => s.set({ mode: s.mode === "measure" ? "choose" : "measure", measure: [] })}
              onSite={focusSite}
              onPoint={focusPoint}
              onFind={runFind}
              dockOpen={s.dockOpen}
              onDock={() => s.set({ dockOpen: true })}
            />
            {tsError && (
              <div className="map-banner">
                <ServiceNotice error={tsError} what="the map tiles" onRetry={tilesets.reload} />
              </div>
            )}
            {tileProblem && tileProblem.count > 20 && !tsError && (
              <div className="map-banner">
                <p className="map-warn">Some map tiles failed to load</p>
              </div>
            )}
            <Readout bus={bus} />
            {s.sites && (
              <div className="map-float map-float-br map-key" role="group" aria-label="Site kinds">
                {KIND_ORDER.filter((k) => (kindCounts.get(k) ?? 0) > 0).map((k) => (
                  <button key={k} type="button" className="map-key-item" aria-pressed={s.kinds.has(k)} onClick={() => s.toggleKind(k)}>
                    <KindGlyph kind={k} />
                    {KIND_STYLE[k].label}
                  </button>
                ))}
              </div>
            )}
            {popupSite && (
              <MapPopup engine={engine} lat={popupSite.lat_deg} lon={popupSite.lon_deg} title={popupSite.name} icon={<SiteTitleIcon site={popupSite} />} onClose={closePopup}>
                <p className="map-popup-facts">{siteFacts(popupSite)}</p>
                <SiteSources site={popupSite} />
                <PlaceActions
                  isPlan={site?.catalog_id === popupSite.id && isPlanAt(popupSite.lat_deg, popupSite.lon_deg)}
                  inCompare={inCompare(popupSite.id)}
                  onUse={() => adoptSite({ lat_deg: popupSite.lat_deg, lon_deg: popupSite.lon_deg, name: popupSite.name, catalog_id: popupSite.id })}
                  onCompare={() => addAlternative({ id: popupSite.id, name: popupSite.name, lat_deg: popupSite.lat_deg, lon_deg: popupSite.lon_deg, catalog_id: popupSite.id })}
                />
              </MapPopup>
            )}
            {popupPin && (
              <MapPopup engine={engine} lat={popupPin.lat_deg} lon={popupPin.lon_deg} title={`#${popupPin.rank} · ${STATE_WORD[popupPin.state]}`} onClose={closePopup}>
                {marginText(popupPin) && <p className="map-popup-facts">{marginText(popupPin)}</p>}
                {pinLanding !== null && <p className="map-popup-facts">Best landing {whenText(pinLanding)} · the plan keeps its own landing time</p>}
                <PlaceActions
                  isPlan={isPlanAt(popupPin.lat_deg, popupPin.lon_deg)}
                  inCompare={inCompare(pinId(popupPin))}
                  onUse={() => adoptSite({ lat_deg: popupPin.lat_deg, lon_deg: popupPin.lon_deg, name: pinName(popupPin), catalog_id: null })}
                  onCompare={() => addAlternative({ id: pinId(popupPin), name: pinName(popupPin), lat_deg: popupPin.lat_deg, lon_deg: popupPin.lon_deg, catalog_id: null })}
                />
              </MapPopup>
            )}
            {popup?.kind === "probe" && probe && (
              <MapPopup engine={engine} lat={probe.lat_deg} lon={probe.lon_deg} title={pointName(probe.lat_deg, probe.lon_deg)} onClose={closePopup}>
                <PlaceActions
                  isPlan={isPlanAt(round5(probe.lat_deg), round5(probe.lon_deg))}
                  inCompare={inCompare(`point-${probe.lat_deg.toFixed(5)}_${probe.lon_deg.toFixed(5)}`)}
                  onUse={() => adoptSite({ lat_deg: round5(probe.lat_deg), lon_deg: round5(probe.lon_deg), name: pointName(probe.lat_deg, probe.lon_deg), catalog_id: null })}
                  onCompare={() => addAlternative({ id: `point-${probe.lat_deg.toFixed(5)}_${probe.lon_deg.toFixed(5)}`, name: pointName(probe.lat_deg, probe.lon_deg), lat_deg: probe.lat_deg, lon_deg: probe.lon_deg, catalog_id: null })}
                />
              </MapPopup>
            )}
          </div>
        </div>
        {s.dockOpen && (
          <aside className="map-dock" aria-label="Map panels">
            <div className="map-dock-head">
              <Tabs tabs={DOCK_TABS} value={s.tab} onChange={(id) => s.set({ tab: id as DockTab })} label="Map panels" panels />
              <IconButton icon="panelRight" label="Hide panel" shortcut="L" size="sm" onClick={() => s.set({ dockOpen: false })} />
            </div>
            <div role="tabpanel" id={`tabpanel-${s.tab}`} aria-labelledby={`tab-${s.tab}`} className="map-tabpanel">
              {s.tab === "layers" && <LayersPanel tileset={tileset} regional={regionalLayerView} onShowRegional={showRegional} />}
              {s.tab === "sites" && (
                <SitesPanel sites={allSites ? shownSites : null} selectedId={popupSite?.id ?? null} error={sitesLoad.state.status === "error" ? sitesLoad.state.error : null} onRetry={sitesLoad.reload} onSelect={focusSite} />
              )}
              {s.tab === "results" && <ResultsPanel plan={plan} selected={popupPin?.rank ?? null} onRun={runFind} onPick={focusPin} />}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

