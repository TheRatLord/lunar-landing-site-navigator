import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { StoreInfo, TilesetDef } from "../../api/terrain";
import { useColors } from "../../components/viz/useColors";
import { formatLat, formatLon } from "../../lib/coords";
import type { SiteEntry } from "../../scenario/api";
import type { BlockerMark } from "../../scenario/alternatives";
import type { CursorBus } from "./cursorBus";
import type { PinMark, RegionalMark } from "./overlays";
import { MapEngine, type ActiveLayer, type AltMark, type HoverTarget, type MapMode, type ScenarioMark } from "./engine";
import type { LatLon } from "./measure";
import { clipName } from "./paint";
import { KIND_STYLE } from "./sites";
import type { ViewKind } from "./urlState";
import type { MapView } from "./view";

export interface TileProblem {
  count: number;
  last: string;
}

export interface MapCanvasProps {
  kind: ViewKind;
  initialView: Partial<MapView> | null;
  tilesets: TilesetDef[] | null;
  renderVersion: string;
  stores: StoreInfo[];
  sites: SiteEntry[];
  layers: ActiveLayer[];
  graticule: boolean;
  showStores: boolean;
  showSites: boolean;
  selectedId: string | null;
  scenario: ScenarioMark | null;
  alternatives: AltMark[];
  blocker: BlockerMark | null;
  pins: PinMark[];
  selectedPin: number | null;
  regional: RegionalMark | null;
  regionalOpacity: number;
  measure: LatLon[];
  mode: MapMode;
  bus: CursorBus;
  onEngine(e: MapEngine | null): void;
  onPickSite(id: string | null): void;
  onPickPin(rank: number): void;
  onSetSite(lat: number, lon: number): void;
  onMeasure(p: LatLon): void;
  onView(v: MapView & { kind: ViewKind }): void;
  onTileProblem(p: TileProblem | null): void;
}

export function MapCanvas(props: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<MapEngine | null>(null);
  const live = useRef(props);
  const colors = useColors();
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const tileErrors = useRef({ count: 0, last: "" });
  const kind0 = useRef(props.kind);

  useEffect(() => {
    live.current = props;
  });

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const engine = new MapEngine(
      canvas,
      {
        onView: (v) => live.current.onView(v),
        onPickSite: (id) => live.current.onPickSite(id),
        onPickPin: (rank) => live.current.onPickPin(rank),
        onSetSite: (la, lo) => live.current.onSetSite(la, lo),
        onMeasure: (p) => live.current.onMeasure(p),
        onCursor: (c) => live.current.bus.emit(c),
        onHover: setHover,
        onTileError: (e, url) => {
          const t = tileErrors.current;
          t.count++;
          t.last = `${e instanceof Error ? e.message : String(e)} (${url})`;
          live.current.onTileProblem({ count: t.count, last: t.last });
        },
      },
      kind0.current,
    );
    engineRef.current = engine;
    const measureSize = () => {
      const r = wrap.getBoundingClientRect();
      engine.resize(Math.max(1, Math.floor(r.width)), Math.max(1, Math.floor(r.height)), window.devicePixelRatio || 1);
    };
    measureSize();
    const ro = new ResizeObserver(measureSize);
    ro.observe(wrap);
    live.current.onEngine(engine);
    return () => {
      ro.disconnect();
      live.current.onEngine(null);
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  const { kind, tilesets, renderVersion, initialView } = props;
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.setTilesets(tilesets, renderVersion);
  }, [tilesets, renderVersion]);

  const restoredFor = useRef<MapEngine | null>(null);
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    if (restoredFor.current !== e) {
      restoredFor.current = e;
      e.setView(kind, initialView ?? {});
    } else e.setKind(kind);
  }, [kind, initialView]);

  useEffect(() => engineRef.current?.setPalette(colors.get), [colors]);
  useEffect(() => engineRef.current?.setStores(props.stores), [props.stores]);
  useEffect(() => engineRef.current?.setSites(props.sites), [props.sites]);
  useEffect(() => engineRef.current?.setLayers(props.layers), [props.layers]);
  useEffect(() => engineRef.current?.setOptions({ graticule: props.graticule, stores: props.showStores, sites: props.showSites }), [props.graticule, props.showStores, props.showSites]);
  useEffect(() => engineRef.current?.setSelected(props.selectedId), [props.selectedId]);
  useEffect(() => engineRef.current?.setScenario(props.scenario), [props.scenario]);
  useEffect(() => engineRef.current?.setAlternatives(props.alternatives), [props.alternatives]);
  useEffect(() => engineRef.current?.setBlocker(props.blocker), [props.blocker]);
  useEffect(() => engineRef.current?.setPins(props.pins, props.selectedPin), [props.pins, props.selectedPin]);
  useEffect(() => engineRef.current?.setRegional(props.regional, props.regionalOpacity), [props.regional, props.regionalOpacity]);
  useEffect(() => engineRef.current?.setMeasure(props.measure), [props.measure]);
  useEffect(() => engineRef.current?.setMode(props.mode), [props.mode]);

  const tip = useMemo(() => {
    if (!hover) return null;
    if (hover.type === "site") {
      const s = props.sites.find((x) => x.id === hover.id);
      if (!s) return null;
      return { title: s.name, lines: [`${KIND_STYLE[s.kind].label} · ${s.confidence}`, `${formatLat(s.lat_deg)}  ${formatLon(s.lon_deg)}`] };
    }
    if (hover.type === "cluster") {
      const names = (hover.ids ?? []).flatMap((id) => props.sites.find((x) => x.id === id)?.name ?? []).map((n) => clipName(n, 38));
      return { title: `${names.length} sites`, lines: names.length > 6 ? [...names.slice(0, 5), `+${names.length - 5}`] : names };
    }
    if (hover.type === "alt") {
      const a = props.alternatives.find((x) => x.id === hover.id);
      return a ? { title: a.name, lines: ["Pinned for comparison", `${formatLat(a.lat_deg)}  ${formatLon(a.lon_deg)}`] } : null;
    }
    if (hover.type === "pin") {
      const pin = props.pins.find((x) => String(x.rank) === hover.id);
      return pin ? { title: `Site search result ${pin.title}`, lines: pin.lines } : null;
    }
    const sc = props.scenario;
    return sc ? { title: `Plan site: ${sc.name || "unnamed"}`, lines: [`${formatLat(sc.lat_deg)}  ${formatLon(sc.lon_deg)}`] } : null;
  }, [hover, props.sites, props.alternatives, props.pins, props.scenario]);

  return (
    <div ref={wrapRef} className="map-stage" data-mode={props.mode}>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        tabIndex={0}
        role="application"
        aria-label="Lunar map. Drag to pan, scroll or plus and minus to zoom, arrow keys to move."
        aria-describedby="map-hint"
        onKeyDown={(e) => {
          if (engineRef.current?.handleKey(e.nativeEvent)) e.preventDefault();
        }}
      >
        Lunar map
      </canvas>
      {tip && hover && (
        <div className="map-tip" role="tooltip" style={{ left: hover.x, top: hover.y }}>
          <strong>{tip.title}</strong>
          {tip.lines.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      )}
    </div>
  );
}
