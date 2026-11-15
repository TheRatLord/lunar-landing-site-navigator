import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePublishScreenContext } from "../../ask/screenContext";
import { useSearchParams } from "react-router-dom";
import { terrainApi } from "../../api/terrain";
import { IconButton } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { Toolstrip } from "../../components/ui/Toolstrip";
import { PageHeader } from "../../components/ui/PageHeader";
import { Tabs } from "../../components/ui/Panel";
import { ServiceNotice } from "../../components/ServiceNotice";
import { useColors } from "../../components/viz/useColors";
import { catalogApi, type SiteEntry } from "../../scenario/api";
import { useAlternatives, useOverlays } from "../../scenario/alternatives";
import { useScenario, writePlanSite } from "../../scenario/store";
import { toast } from "../../state/toasts";
import { ExploreTabs } from "../explore/ExploreTabs";
import { regionalLayer } from "../regional/regionalLayer";
import { useRegionalLayer } from "../regional/regionalLayerStore";
import { searchPinsCurrent, useSearchResults } from "../search/results";
import "../../styles/map.css";
import { TILESET_OF_VIEW } from "./basis";
import { CursorBus } from "./cursorBus";
import type { MapEngine, MapMode, ScenarioMark } from "./engine";
import { KindGlyph } from "./KindGlyph";
import { LayersPanel } from "./LayersPanel";
import { MapCanvas, type TileProblem } from "./MapCanvas";
import { LAYER_ORDER, MapStoreContext, createMapStore, DEFAULT_LAYERS, useMapStore, useMapStoreApi, type DockTab, type MapStore } from "./mapStore";
import { MeasurePanel } from "./MeasurePanel";
import { bracketAccount, drawnLayer, pinMarks, regionalMark, regionalScaleWarning, regionalSummary, type RegionalDrawn } from "./overlays";
import { Readout } from "./Readout";
import { ShortcutsOverlay } from "./ShortcutsOverlay";
import { SiteCard } from "./SiteCard";
import { SitesPanel } from "./SitesPanel";
import { filterSites } from "./sites";
import { Toolbar } from "./Toolbar";
import { parseMapUrl, writeMapUrl, type MapUrlState, type ViewKind } from "./urlState";
import { useLoad } from "../../api/useLoad";

const loadTilesets = (signal: AbortSignal) => terrainApi.tilesets({ signal });
const loadStores = (signal: AbortSignal) => terrainApi.stores({ signal });
const loadSites = (signal: AbortSignal) => catalogApi.sites({ limit: 1000 }, { signal });

const DOCK_TABS = [
  { id: "layers", label: "Layers" },
  { id: "sites", label: "Sites" },
  { id: "measure", label: "Measure" },
];

function initialStore(url: MapUrlState): Partial<MapStore> {
  const init: Partial<MapStore> = {};
  if (url.view) init.kind = url.view;
  if (url.site) init.selectedId = url.site;
  if (url.layers) {
    const on = new Map(url.layers.map((l) => [l.id, l.opacity]));
    init.layers = Object.fromEntries(LAYER_ORDER.map((id) => [id, { on: on.has(id), opacity: on.get(id) ?? DEFAULT_LAYERS[id].opacity }])) as MapStore["layers"];
  }
  return init;
}

const onLayers = (layers: MapStore["layers"]) => LAYER_ORDER.filter((id) => layers[id].on).map((id) => ({ id, opacity: layers[id].opacity }));

function viewFor(lat: number, current: ViewKind): ViewKind {
  if (current === "global") return current;
  if (current === "south" && lat <= -60) return current;
  if (current === "north" && lat >= 60) return current;
  return lat <= -60 ? "south" : lat >= 60 ? "north" : "global";
}

const isTyping = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

const round5 = (v: number): number => Math.round(v * 1e5) / 1e5;

export function MapWorkspace() {
  const [params] = useSearchParams();
  const [url] = useState(() => parseMapUrl(params));
  const [store] = useState(() => createMapStore(initialStore(url)));
  return (
    <MapStoreContext value={store}>
      <MapInner url={url} />
    </MapStoreContext>
  );
}

function MapInner({ url }: { url: MapUrlState }) {
  const api = useMapStoreApi();
  const s = useMapStore();
  const [params, setParams] = useSearchParams();
  const tilesets = useLoad(loadTilesets);
  const storesLoad = useLoad(loadStores);
  const sitesLoad = useLoad(loadSites);
  const [engine, setEngine] = useState<MapEngine | null>(null);
  const [tileProblem, setTileProblem] = useState<TileProblem | null>(null);
  const bus = useMemo(() => new CursorBus(), []);
  const searchRef = useRef<HTMLInputElement>(null);

  const doc = useScenario((st) => st.doc);
  const lat = useScenario((st) => st.doc?.site.lat_deg);
  const lon = useScenario((st) => st.doc?.site.lon_deg);
  const name = useScenario((st) => st.doc?.site.name);
  const catalogId = useScenario((st) => st.doc?.site.catalog_id ?? null);
  const ellipse = useScenario((st) => st.doc?.ellipse);
  const alternatives = useAlternatives((st) => st.items);
  const addAlternative = useAlternatives((st) => st.add);
  const blocker = useOverlays((st) => st.blocker);
  const picking = useOverlays((st) => st.picking);
  const setPicking = useOverlays((st) => st.setPicking);

  const candidates = useSearchResults((st) => st.candidates);
  const searchScenarioKeyStored = useSearchResults((st) => st.scenarioKey);
  const searchStale = useSearchResults((st) => st.stale);
  const selectedRank = useSearchResults((st) => st.selectedRank);
  const selectRank = useSearchResults((st) => st.select);
  const regionalShown = useRegionalLayer((st) => st.shown);
  const colors = useColors();
  const pinsCurrent = useMemo(() => searchPinsCurrent({ candidates, scenarioKey: searchScenarioKeyStored, stale: searchStale }, doc), [candidates, searchScenarioKeyStored, searchStale, doc]);
  const pinsOutOfDate = candidates.length > 0 && !pinsCurrent;
  const regionalOutOfDate = regionalShown?.stale === true;
  const pins = useMemo(() => (s.pins && pinsCurrent ? pinMarks(candidates) : []), [s.pins, pinsCurrent, candidates]);
  const regionalDrawn = useMemo<RegionalDrawn | null>(() => {
    if (!regionalShown || regionalShown.stale) return null;
    const { layer, bracket } = drawnLayer(regionalShown);
    const view = regionalLayer(regionalShown.result, layer, regionalShown.domain);
    return view ? { view, bracket, summary: regionalSummary(regionalShown.request), supportNote: regionalShown.support?.note ?? null, unreliable: view.cells.filter((c) => c.unreliable).length, coverage: bracketAccount(bracket, regionalShown.support), scaleWarning: regionalScaleWarning(regionalShown.result) } : null;
  }, [regionalShown]);
  const regionalCells = useMemo(() => (s.regional && regionalDrawn ? regionalMark(regionalDrawn.view, colors.get) : null), [s.regional, regionalDrawn, colors]);

  const mode: MapMode = picking ? "set" : s.mode;
  const tilesetList = tilesets.state.status === "ready" ? tilesets.state.data.tilesets : null;
  const renderVersion = tilesets.state.status === "ready" ? tilesets.state.data.render_version : "";
  const storeList = useMemo(() => (storesLoad.state.status === "ready" ? storesLoad.state.data.stores : []), [storesLoad.state]);
  const allSites = useMemo(() => (sitesLoad.state.status === "ready" ? sitesLoad.state.data.items : null), [sitesLoad.state]);
  const shownSites = useMemo(() => filterSites(allSites ?? [], { kinds: s.kinds, confidence: s.confidence, status: s.status, query: "" }), [allSites, s.kinds, s.confidence, s.status]);
  const selected = useMemo(() => allSites?.find((x) => x.id === s.selectedId) ?? null, [allSites, s.selectedId]);

  const scenario = useMemo<ScenarioMark | null>(() => (lat === undefined || lon === undefined ? null : { lat_deg: lat, lon_deg: lon, name: name ?? "", ellipse: ellipse ?? null }), [lat, lon, name, ellipse]);
  const layers = useMemo(() => onLayers(s.layers), [s.layers]);
  const tileset = tilesetList?.find((t) => t.id === TILESET_OF_VIEW[s.kind]) ?? null;
  const initialView = useMemo(() => (url.x !== null || url.y !== null || url.z !== null ? { cx: url.x ?? undefined, cy: url.y ?? undefined, zoom: url.z ?? undefined } : null), [url]);

  const engineRef = useRef<MapEngine | null>(null);
  const paramsRef = useRef(params);
  const setParamsRef = useRef(setParams);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    paramsRef.current = params;
    setParamsRef.current = setParams;
  });
  const scheduleUrl = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const st = api.getState();
      const e = engineRef.current;
      const v = e?.getView();
      if (!e || !v) return;
      setParamsRef.current(writeMapUrl(paramsRef.current, { view: st.kind, cx: v.cx, cy: v.cy, zoom: v.zoom, layers: onLayers(st.layers), site: st.selectedId }), { replace: true });
    }, 450);
  }, [api]);
  useEffect(() => {
    engineRef.current = engine;
    if (engine) scheduleUrl();
  }, [engine, scheduleUrl]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    scheduleUrl();
  }, [s.kind, s.layers, s.selectedId, scheduleUrl]);

  const showLat = useCallback(
    (e: MapEngine | null, la: number) => {
      const kind = viewFor(la, api.getState().kind);
      if (kind === api.getState().kind) return;
      api.getState().set({ kind });
      e?.setKind(kind);
    },
    [api],
  );

  const goTo = useCallback(
    (la: number, lo: number, opts: { radius_m?: number } = {}) => {
      const e = engineRef.current;
      if (!e) return;
      showLat(e, la);
      if (opts.radius_m) e.fitAround(la, lo, opts.radius_m);
      else e.flyToLatLon(la, lo);
    },
    [showLat],
  );

  const focusSite = useCallback(
    (site: SiteEntry) => {
      api.getState().set({ selectedId: site.id });
      goTo(site.lat_deg, site.lon_deg, site.extent_km ? { radius_m: site.extent_km * 750 } : {});
    },
    [api, goTo],
  );

  const applySite = useCallback(
    (la: number, lo: number, meta: { name: string; catalog_id: string | null }, exact = false): boolean => {
      const sc = useScenario.getState();
      if (!sc.doc) {
        toast({ kind: "warning", title: "Plan not loaded yet" });
        return false;
      }
      api.getState().pushUndo({ lat_deg: sc.doc.site.lat_deg, lon_deg: sc.doc.site.lon_deg, name: sc.doc.site.name, catalog_id: sc.doc.site.catalog_id ?? null });
      writePlanSite(exact ? la : round5(la), exact ? lo : round5(lo), meta.name, meta.catalog_id);
      return true;
    },
    [api],
  );

  const onSetSite = useCallback(
    (la: number, lo: number) => {
      if (applySite(la, lo, { name: "Map point", catalog_id: null })) {
        if (useOverlays.getState().picking) setPicking(false);
        api.getState().set({ mode: "pan" });
      }
    },
    [applySite, api, setPicking],
  );

  const undo = useCallback(() => {
    const snap = api.getState().popUndo();
    if (snap) writePlanSite(snap.lat_deg, snap.lon_deg, snap.name, snap.catalog_id);
  }, [api]);

  const setMode = useCallback(
    (m: MapMode) => {
      if (useOverlays.getState().picking && m !== "set") setPicking(false);
      api.getState().set({ mode: m });
    },
    [api, setPicking],
  );

  const fitSite = useCallback(() => {
    const sc = useScenario.getState().doc;
    if (!sc) return;
    showLat(engineRef.current, sc.site.lat_deg);
    engineRef.current?.fitScenario();
  }, [showLat]);

  const switchKind = (kind: ViewKind) => s.set({ kind });

  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !engine || !allSites || !url.site) return;
    restored.current = true;
    const site = allSites.find((x) => x.id === url.site);
    if (site && url.x === null) focusSite(site);
  }, [engine, allSites, url, focusSite]);

  const lastBlocker = useRef<unknown>(null);
  useEffect(() => {
    if (!engine || !blocker || blocker === lastBlocker.current) return;
    lastBlocker.current = blocker;
    showLat(engine, blocker.from.lat_deg);
    engine.fitBlocker();
  }, [engine, blocker, showLat]);

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keyRef.current = (e) => {
      if (e.defaultPrevented || isTyping(e.target) || api.getState().shortcuts) return;
      const st = api.getState();
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "z") {
        if (st.undo.length > 0) {
          e.preventDefault();
          undo();
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const kindKeys: Record<string, ViewKind> = { "1": "south", "2": "north", "3": "global" };
      if (key === "Escape") {
        if (useOverlays.getState().picking) setPicking(false);
        else if (st.mode === "set") st.set({ mode: "pan" });
        else if (st.measure.length > 0) st.set({ measure: [] });
        else if (st.mode === "measure") st.set({ mode: "pan" });
        else if (st.selectedId) st.set({ selectedId: null });
        else return;
      } else if (key === "s") setMode(mode === "set" ? "pan" : "set");
      else if (key === "m") setMode(mode === "measure" ? "pan" : "measure");
      else if (key === "f") fitSite();
      else if (key === "r") engineRef.current?.fitRegion();
      else if (key === "g") st.set({ graticule: !st.graticule });
      else if (key === "l") st.set({ dockOpen: !st.dockOpen });
      else if (key === "?") st.set({ shortcuts: true });
      else if (key === "/") {
        st.set({ dockOpen: true, tab: "sites" });
        window.setTimeout(() => searchRef.current?.focus(), 0);
      } else if (key === "Backspace" && st.mode === "measure") st.popMeasure();
      else if (kindKeys[key]) switchKind(kindKeys[key]);
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

  usePublishScreenContext({
    where: "Explore, Map",
    summary: alternatives.length > 0 ? `${alternatives.length} pinned alternative site${alternatives.length === 1 ? "" : "s"}` : "",
    lines: [
      `The map shows the ${s.kind === "global" ? "global" : s.kind + " polar"} view.`,
      ...alternatives.map((a) => `Pinned alternative site "${a.name}" at ${a.lat_deg} deg latitude, ${a.lon_deg} deg longitude.`),
    ],
  });

  const tsError = tilesets.state.status === "error" ? tilesets.state.error : null;
  const modeName = mode === "set" ? "Pick plan site on map" : mode === "measure" ? "Measure" : null;
  const siteCount = allSites ? { shown: shownSites.length, total: allSites.length } : null;
  const hemisphere = s.kind === "south" ? "south" : s.kind === "north" ? "north" : null;

  return (
    <div className="map-ws" data-dock={s.dockOpen ? "open" : "closed"}>
      <h1 className="sr-only">Map</h1>
      <PageHeader
        tabs={<ExploreTabs />}
        actions={
          <Toolstrip>
            <IconButton icon="info" label="Keyboard shortcuts" shortcut="?" size="sm" onClick={() => s.set({ shortcuts: true })} />
            <IconButton icon="panelRight" label="Side panel" shortcut="L" size="sm" pressed={s.dockOpen} onClick={() => s.set({ dockOpen: !s.dockOpen })} />
          </Toolstrip>
        }
      />
      <div className="map-body">
        <div className="map-main">
          <div className="map-view">
            <MapCanvas
              kind={s.kind}
              initialView={initialView}
              tilesets={tilesetList}
              renderVersion={renderVersion}
              stores={storeList}
              sites={shownSites}
              layers={layers}
              graticule={s.graticule}
              showStores={s.stores}
              showSites={s.sites}
              selectedId={s.selectedId}
              scenario={scenario}
              alternatives={alternatives}
              blocker={blocker}
              pins={pins}
              selectedPin={selectedRank}
              regional={regionalCells}
              regionalOpacity={s.regionalOpacity}
              measure={s.measure}
              mode={mode}
              bus={bus}
              onEngine={setEngine}
              onPickSite={(id) => s.set({ selectedId: id })}
              onPickPin={selectRank}
              onSetSite={onSetSite}
              onMeasure={s.addMeasure}
              onView={scheduleUrl}
              onTileProblem={setTileProblem}
            />
            <Toolbar
              kind={s.kind}
              hemisphere={hemisphere}
              mode={mode}
              canSet={doc !== null || picking}
              canFitSite={scenario !== null}
              canUndo={s.undo.length > 0}
              onKind={switchKind}
              onMode={setMode}
              onZoom={(dz) => engine?.zoomBy(dz)}
              onFitSite={fitSite}
              onFitRegion={() => engine?.fitRegion()}
              onUndo={undo}
              onGo={(la, lo) => goTo(la, lo)}
            />
            {modeName && (
              <div id="map-hint" className="map-mode" role="status">
                <Icon name={mode === "measure" ? "ruler" : "site"} size={14} />
                {modeName}
                <kbd className="kbd">Esc</kbd>
              </div>
            )}
            {tsError && (
              <div className="map-banner">
                <ServiceNotice error={tsError} what="the terrain tile definitions (GET /api/v1/terrain/tilesets)" onRetry={tilesets.reload} />
              </div>
            )}
            <Readout bus={bus} />
            {s.sites && (
              <div className="map-float map-float-br map-key" role="img" aria-label="Filled marker: high confidence. Hollow marker: lower confidence.">
                <KindGlyph kind="landed" />
                High confidence
                <KindGlyph kind="landed" hollow />
                Lower confidence
              </div>
            )}
          </div>
        </div>
        {s.dockOpen && (
          <aside className="map-dock" aria-label="Map panels">
            <div className="map-dock-head">
              <Tabs tabs={DOCK_TABS} value={s.tab} onChange={(id) => s.set({ tab: id as DockTab })} label="Map panels" panels />
            </div>
            <div role="tabpanel" id={`tabpanel-${s.tab}`} aria-labelledby={`tab-${s.tab}`} className="map-tabpanel">
              {s.tab === "layers" && (
                <LayersPanel
                  tileset={tileset}
                  tilesets={tilesets.state}
                  stores={storesLoad.state}
                  onRetryStores={storesLoad.reload}
                  tileProblem={tileProblem}
                  siteCount={siteCount}
                  kind={s.kind}
                  pinCount={pinsCurrent ? candidates.length : 0}
                  pinsOutOfDate={pinsOutOfDate}
                  regional={regionalDrawn}
                  regionalOutOfDate={regionalOutOfDate}
                />
              )}
              {s.tab === "sites" && (
                <SitesPanel
                  sites={allSites}
                  loading={sitesLoad.state.status === "loading"}
                  error={sitesLoad.state.status === "error" ? sitesLoad.state.error : null}
                  onRetry={sitesLoad.reload}
                  onSelect={focusSite}
                  searchRef={searchRef}
                />
              )}
              {s.tab === "measure" && <MeasurePanel />}
            </div>
            {selected && (
              <SiteCard
                site={selected}
                canUse={doc !== null}
                isUsed={doc !== null && lat === selected.lat_deg && lon === selected.lon_deg && catalogId === selected.id}
                isAlternative={alternatives.some((a) => a.id === selected.id)}
                onUse={() => {
                  if (applySite(selected.lat_deg, selected.lon_deg, { name: selected.name, catalog_id: selected.id }, true)) {
                    toast({ kind: "success", title: "Site set", detail: selected.name });
                  }
                }}
                onAddAlternative={() => addAlternative({ id: selected.id, name: selected.name, lat_deg: selected.lat_deg, lon_deg: selected.lon_deg, catalog_id: selected.id })}
                onFly={() => focusSite(selected)}
                onClose={() => s.set({ selectedId: null })}
              />
            )}
          </aside>
        )}
      </div>
      {s.shortcuts && <ShortcutsOverlay onClose={() => s.set({ shortcuts: false })} />}
    </div>
  );
}
