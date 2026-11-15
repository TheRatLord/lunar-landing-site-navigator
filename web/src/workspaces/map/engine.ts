import { fetchTileBitmap, tileUrl, type TileLayerId, type TilesetDef } from "../../api/terrain";
import {
  MOON_R_M,
  destination,
  ellipseOutline,
  polarForward,
  tileBounds,
  tilePixel,
  tileSpan,
} from "../../lib/projection";
import { prefersReducedMotion } from "../../lib/media";
import { clamp } from "../../lib/scale";
import type { BlockerMark } from "../../scenario/alternatives";
import type { SiteEntry } from "../../scenario/api";
import { basisFor, type MapBasis } from "./basis";
import type { PinMark, RegionalMark } from "./overlays";
import { badgeSpot, clusterPoints, placeLabels, type LabelBox, type LabelSpot } from "./declutter";
import type { Rect } from "./rect";
import { buildGraticule, dropOverlaps, type GraticuleLabel } from "./graticule";
import { heightAt, slopeAt, type HeightTile, type PixelGround } from "./heights";
import { formatBearing, formatDistance, legs, type LatLon } from "./measure";
import {
  BADGE_FONT,
  BADGE_R,
  CLUSTER_R,
  LABEL_FONT,
  NAME_FONT,
  NAME_FONT_STRONG,
  PALETTE_TOKENS,
  PIN_FONT,
  drawCluster,
  drawMarker,
  drawNorthArrow,
  clipName,
  drawScaleBar,
  haloText,
  plateText,
  type Palette,
} from "./paint";
import { niceScaleBar } from "./scaleBar";
import { KIND_STYLE, type SiteKind } from "./sites";
import { TileCache, tileKey, type TileWant } from "./tileCache";
import type { ViewKind } from "./urlState";
import {
  clampView,
  fitBounds,
  fitExtent,
  makeFrame,
  panBy,
  tileLevel,
  toMapX,
  toMapY,
  toScreenX,
  toScreenY,
  viewBounds,
  visibleTiles,
  zoomAbout,
  type Frame,
  type MapView,
  type TileRef,
} from "./view";

export type MapMode = "choose" | "measure";

export interface ActiveLayer {
  id: TileLayerId;
  opacity: number;
}

export interface ScenarioMark {
  lat_deg: number;
  lon_deg: number;
  name: string;
  ellipse: { semi_major_m: number; semi_minor_m: number; azimuth_deg: number } | null;
}

export interface AltMark {
  id: string;
  name: string;
  lat_deg: number;
  lon_deg: number;
}

export interface CursorInfo {
  lat_deg: number;
  lon_deg: number;
  x_m: number | null;
  y_m: number | null;
  height: { state: "ok" | "nodata" | "loading" | "na"; value_m: number | null; slope_deg: number | null; baseline_m: PixelGround | null; pixel_m: PixelGround | null };
}

export interface HoverTarget {
  type: "site" | "scenario" | "alt" | "pin" | "cluster" | "probe";
  id: string;
  x: number;
  y: number;
  ids?: readonly string[];
}

export interface EngineHooks {
  onView(view: MapView & { kind: ViewKind }): void;
  onPickSite(id: string | null): void;
  onPickPin(rank: number): void;
  onSetSite(lat_deg: number, lon_deg: number): void;
  onMeasure(p: LatLon): void;
  onCursor(c: CursorInfo | null): void;
  onHover(h: HoverTarget | null): void;
  onTileError(e: unknown, url: string): void;
  onPickProbe?(): void;
}

export interface SearchArea {
  lat_deg: number;
  lon_deg: number;
  radius_m: number;
}

export interface MapOptions {
  graticule: boolean;
  sites: boolean;
  compass: boolean;
}

interface SiteMarker {
  site: SiteEntry;
  mx: number;
  my: number;
  ok: boolean;
}

interface Hit {
  type: HoverTarget["type"];
  id: string;
  x: number;
  y: number;
  r: number;
  ids?: readonly string[];
}

const TILE_CAPACITY = 480;
const MAX_LABELS = 70;
const CLUSTER_PX = 28;
const DRAG_PX = 4;
type HatchKind = "cut" | "unreliable";
const HATCH_KINDS: readonly HatchKind[] = ["cut", "unreliable"];
const HATCH_CELL: Record<HatchKind, (c: RegionalMark["cells"][number]) => boolean> = { cut: (c) => c.censored && !c.unreliable, unreliable: (c) => c.unreliable };

export class MapEngine {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private raf = 0;
  private destroyed = false;

  private basis: MapBasis;
  private tilesets: TilesetDef[] | null = null;
  private renderVersion = "";
  private views: Partial<Record<ViewKind, MapView>> = {};
  private view: MapView = { cx: 0, cy: 0, zoom: 0 };
  private needFit = true;
  private lastEmitted = "";

  private layers: ActiveLayer[] = [];
  private showGraticule = true;
  private showSitesLayer = true;
  private showCompass = true;
  private area: SearchArea | null = null;
  private probe: { lat: number; lon: number } | null = null;
  private frameListeners = new Set<() => void>();
  private labelSpots = new Map<string, LabelSpot>();
  private labelTexts = new Map<string, string>();
  private sitesRaw: SiteEntry[] = [];
  private markers: SiteMarker[] = [];
  private selectedId: string | null = null;
  private scenario: ScenarioMark | null = null;
  private scenarioOutline: Float64Array | null = null;
  private alts: AltMark[] = [];
  private blocker: BlockerMark | null = null;
  private pins: PinMark[] = [];
  private selectedPin: number | null = null;
  private regional: RegionalMark | null = null;
  private regionalOpacity = 0.7;
  private regionalBake: HTMLCanvasElement | null = null;
  private hatches: Partial<Record<HatchKind, { colour: string; pattern: CanvasPattern }>> = {};
  private measure: LatLon[] = [];
  private mode: MapMode = "choose";
  private pal: Palette | null = null;
  private kindColors: Record<SiteKind, string> | null = null;

  private tiles: TileCache<ImageBitmap>;
  private heights: TileCache<HeightTile>;
  private wantSig = "";
  private heightWantKey = "";
  private scratch: CanvasRenderingContext2D | null = null;

  private hits: Hit[] = [];
  private hover: HoverTarget | null = null;
  private cursorPx: { x: number; y: number } | null = null;
  private cursorDirty = false;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: null | { kind: "pan" | "pinch"; startX: number; startY: number; lastX: number; lastY: number; moved: boolean; pinch?: number } = null;
  private anim: null | { from: MapView; to: MapView; t0: number; ms: number } = null;
  private statusDirty = true;
  private lastStatusAt = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hooks: EngineHooks,
    initialKind: ViewKind,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas is not available");
    this.ctx = ctx;
    this.basis = basisFor(initialKind, null);
    this.tiles = new TileCache<ImageBitmap>({
      capacity: TILE_CAPACITY,
      maxConcurrent: 6,
      fetch: (url, signal) => fetchTileBitmap(url, signal),
      dispose: (b) => b.close(),
      onSettled: () => {
        this.statusDirty = true;
        this.invalidate();
      },
      onError: (e, url) => this.hooks.onTileError(e, url),
    });
    this.heights = new TileCache<HeightTile>({
      capacity: 48,
      maxConcurrent: 2,
      fetch: (url, signal) => this.fetchHeights(url, signal),
      onSettled: () => {
        this.cursorDirty = true;
        this.invalidate();
      },
      onError: (e, url) => this.hooks.onTileError(e, url),
    });
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onPointerDown);
    c.removeEventListener("pointermove", this.onPointerMove);
    c.removeEventListener("pointerup", this.onPointerUp);
    c.removeEventListener("pointercancel", this.onPointerUp);
    c.removeEventListener("pointerleave", this.onPointerLeave);
    c.removeEventListener("wheel", this.onWheel);
    this.tiles.clear();
    this.heights.clear();
    this.frameListeners.clear();
  }

  onFrame(fn: () => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  screenOf(lat: number, lon: number): { x: number; y: number } | null {
    if (this.w === 0) return null;
    return this.onScreen(this.frame(), lat, lon, 0);
  }

  get kind(): ViewKind {
    return this.basis.kind;
  }

  resize(w: number, h: number, dpr: number): void {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    if (this.needFit && w > 0) this.applyDefaultView();
    this.invalidate();
  }

  setPalette(get: (token: string) => string): void {
    const p = {} as Record<string, string>;
    for (const [k, token] of Object.entries(PALETTE_TOKENS)) p[k] = get(token);
    this.pal = p as unknown as Palette;
    const kc = {} as Record<SiteKind, string>;
    for (const [kind, st] of Object.entries(KIND_STYLE)) kc[kind as SiteKind] = get(st.token);
    this.kindColors = kc;
    this.invalidate();
  }

  setTilesets(list: TilesetDef[] | null, renderVersion: string): void {
    this.tilesets = list;
    this.renderVersion = renderVersion;
    this.tiles.clear();
    this.heights.clear();
    this.wantSig = "";
    this.heightWantKey = "";
    this.rebase(this.basis.kind, false);
  }

  setKind(kind: ViewKind): void {
    if (kind === this.basis.kind) return;
    this.views[this.basis.kind] = this.view;
    this.rebase(kind, true);
  }

  private rebase(kind: ViewKind, restore: boolean): void {
    this.basis = basisFor(kind, this.tilesets);
    this.rebuildAll();
    const saved = restore ? this.views[kind] : undefined;
    if (saved) this.view = saved;
    else if (restore || this.needFit) {
      this.needFit = true;
      if (this.w > 0) this.applyDefaultView();
    } else {
      this.view = this.w > 0 ? clampView(this.basis.grid, { w: this.w, h: this.h }, this.view) : this.view;
    }
    this.hooks.onHover(null);
    this.hover = null;
    this.invalidate();
  }

  private applyDefaultView(): void {
    this.view = fitExtent(this.basis.grid, { w: this.w, h: this.h });
    this.needFit = false;
  }

  setView(kind: ViewKind, v: Partial<MapView>): void {
    if (kind !== this.basis.kind) this.rebase(kind, false);
    const base = this.needFit && this.w > 0 ? fitExtent(this.basis.grid, { w: this.w, h: this.h }) : this.view;
    const next = { cx: v.cx ?? base.cx, cy: v.cy ?? base.cy, zoom: v.zoom ?? base.zoom };
    this.view = this.w > 0 ? clampView(this.basis.grid, { w: this.w, h: this.h }, next) : next;
    if (v.cx !== undefined || v.zoom !== undefined) this.needFit = false;
    this.invalidate();
  }

  getBounds(): [number, number, number, number] {
    return viewBounds(this.frame());
  }

  getView(): MapView {
    return this.view;
  }

  setLayers(layers: ActiveLayer[]): void {
    this.layers = layers;
    this.wantSig = "";
    this.invalidate();
  }

  setOptions(o: MapOptions): void {
    this.showGraticule = o.graticule;
    this.showSitesLayer = o.sites;
    this.showCompass = o.compass;
    this.invalidate();
  }

  setSearchArea(a: SearchArea | null): void {
    this.area = a;
    this.invalidate();
  }

  setProbe(p: { lat_deg: number; lon_deg: number } | null): void {
    this.probe = p ? { lat: p.lat_deg, lon: p.lon_deg } : null;
    this.invalidate();
  }

  setSites(sites: SiteEntry[]): void {
    this.sitesRaw = sites;
    this.rebuildSites();
    this.invalidate();
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
    this.invalidate();
  }

  setScenario(s: ScenarioMark | null): void {
    this.scenario = s;
    this.rebuildScenario();
    this.invalidate();
  }

  setAlternatives(a: AltMark[]): void {
    this.alts = a;
    this.invalidate();
  }

  setBlocker(b: BlockerMark | null): void {
    this.blocker = b;
    this.invalidate();
  }

  setPins(pins: PinMark[], selected: number | null): void {
    this.pins = pins;
    this.selectedPin = selected;
    this.invalidate();
  }

  setRegional(mark: RegionalMark | null, opacity: number): void {
    this.regional = mark;
    this.regionalOpacity = opacity;
    this.regionalBake = null;
    if (mark && mark.n_cols > 0 && mark.n_rows > 0) {
      const c = document.createElement("canvas");
      c.width = mark.n_cols;
      c.height = mark.n_rows;
      const g = c.getContext("2d");
      if (g) {
        for (const cell of mark.cells) {
          g.fillStyle = cell.colour;
          g.fillRect(cell.col, cell.row, 1, 1);
        }
        this.regionalBake = c;
      }
    }
    this.canvas.dataset["regionalCells"] = String(mark?.cells.length ?? 0);
    this.canvas.dataset["regionalCensored"] = String(mark?.cells.filter((c) => c.censored && !c.unreliable).length ?? 0);
    this.canvas.dataset["regionalUnreliable"] = String(mark?.cells.filter((c) => c.unreliable).length ?? 0);
    this.invalidate();
  }

  setMeasure(points: LatLon[]): void {
    this.measure = points;
    this.invalidate();
  }

  setMode(mode: MapMode): void {
    this.mode = mode;
    this.updateCursorStyle();
    this.invalidate();
  }

  private rebuildAll(): void {
    this.rebuildSites();
    this.rebuildScenario();
  }

  private rebuildSites(): void {
    const { proj, grid } = this.basis;
    const [x0, y0, x1, y1] = grid.extent;
    this.markers = this.sitesRaw
      .map((site) => {
        const [mx, my] = proj.forward(site.lat_deg, site.lon_deg);
        const ok = Number.isFinite(mx) && Number.isFinite(my) && mx >= x0 && mx <= x1 && my >= y0 && my <= y1;
        return { site, mx, my, ok };
      })
      .sort((a, b) => KIND_STYLE[a.site.kind].z - KIND_STYLE[b.site.kind].z);
  }

  private scenarioPos(): { lat: number; lon: number } | null {
    return this.scenario ? { lat: this.scenario.lat_deg, lon: this.scenario.lon_deg } : null;
  }

  private rebuildScenario(): void {
    const pos = this.scenarioPos();
    const e = this.scenario?.ellipse;
    if (!pos || !e) {
      this.scenarioOutline = null;
      return;
    }
    const ring = ellipseOutline(pos.lat, pos.lon, e.semi_major_m, e.semi_minor_m, e.azimuth_deg, 96);
    const pts: number[] = [];
    for (const [lat, lon] of ring) {
      const [x, y] = this.basis.proj.forward(lat, lon);
      pts.push(x, y);
    }
    this.scenarioOutline = Float64Array.from(pts);
  }

  flyTo(target: MapView, ms = 380): void {
    const vp = { w: this.w, h: this.h };
    const to = clampView(this.basis.grid, vp, target);
    if (ms <= 0 || prefersReducedMotion() || this.w === 0) {
      this.anim = null;
      this.view = to;
    } else {
      this.anim = { from: this.view, to, t0: performance.now(), ms };
    }
    this.invalidate();
  }

  flyToLatLon(lat: number, lon: number): void {
    const [x, y] = this.basis.proj.forward(lat, lon);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.flyTo({ cx: x, cy: y, zoom: Math.max(this.view.zoom, this.basis.grid.maxZ - 4) });
  }

  fitAround(lat: number, lon: number, radius_m: number): void {
    const pts = [0, 90, 180, 270].map((az) => destination(lat, lon, az, radius_m)).concat([[lat, lon]]);
    const xy = pts.map(([la, lo]) => this.basis.proj.forward(la, lo));
    if (this.basis.proj.kind === "equirectangular") for (const p of xy) p[0] = lon + ((((p[0] - lon) % 360) + 540) % 360) - 180;
    const xs = xy.map((p) => p[0]);
    const ys = xy.map((p) => p[1]);
    if (!xs.every(Number.isFinite) || !ys.every(Number.isFinite)) return;
    this.flyTo(fitBounds(this.basis.grid, { w: this.w, h: this.h }, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], 64, this.basis.grid.maxZ + 1));
  }

  fitScenario(): void {
    const pos = this.scenarioPos();
    if (!pos) return;
    const e = this.scenario?.ellipse;
    this.fitAround(pos.lat, pos.lon, Math.max(2500, (e ? Math.max(e.semi_major_m, e.semi_minor_m) : 0) * 2.2));
  }

  fitBlocker(): void {
    const b = this.blocker;
    if (!b) return;
    const mid = destination(b.from.lat_deg, b.from.lon_deg, b.azimuth_deg, b.distance_m / 2);
    this.fitAround(mid[0], mid[1], Math.max(600, b.distance_m * 0.75));
  }

  fitRegion(): void {
    this.flyTo(fitExtent(this.basis.grid, { w: this.w, h: this.h }));
  }

  zoomBy(dz: number): void {
    const target = zoomAbout(this.basis.grid, { w: this.w, h: this.h }, this.view, this.w / 2, this.h / 2, this.view.zoom + dz);
    this.flyTo(target, 160);
  }

  handleKey(e: KeyboardEvent): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const step = e.shiftKey ? 320 : 80;
    switch (e.key) {
      case "+":
      case "=":
        this.zoomBy(1);
        return true;
      case "-":
      case "_":
        this.zoomBy(-1);
        return true;
      case "ArrowLeft":
        this.nudge(step, 0);
        return true;
      case "ArrowRight":
        this.nudge(-step, 0);
        return true;
      case "ArrowUp":
        this.nudge(0, step);
        return true;
      case "ArrowDown":
        this.nudge(0, -step);
        return true;
      default:
        return false;
    }
  }

  private nudge(dx: number, dy: number): void {
    this.anim = null;
    this.view = panBy(this.basis.grid, { w: this.w, h: this.h }, this.view, dx, dy);
    this.cursorDirty = true;
    this.invalidate();
  }

  private frame(): Frame {
    return makeFrame(this.basis.grid, this.view, { w: this.w, h: this.h });
  }

  private screenToLatLon(sx: number, sy: number): [number, number] {
    const f = this.frame();
    return this.basis.proj.inverse(toMapX(f, sx), toMapY(f, sy));
  }

  private onScreen(f: Frame, lat: number, lon: number, pad: number): { x: number; y: number } | null {
    const [mx, my] = this.basis.proj.forward(lat, lon);
    if (!Number.isFinite(mx) || !Number.isFinite(my)) return null;
    const x = toScreenX(f, mx);
    const y = toScreenY(f, my);
    return x < -pad || x > this.w + pad || y < -pad || y > this.h + pad ? null : { x, y };
  }

  private local(e: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private hitAt(x: number, y: number, only?: HoverTarget["type"]): Hit | null {
    let best: Hit | null = null;
    let bestD = Infinity;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i]!;
      if (only && h.type !== only) continue;
      const d = Math.hypot(h.x - x, h.y - y);
      if (d <= h.r && d < bestD) {
        best = h;
        bestD = d;
      }
    }
    return best;
  }

  private updateCursorStyle(hit: Hit | null = null): void {
    const c = this.canvas.style;
    if (this.drag?.moved && this.drag.kind === "pan") c.cursor = "grabbing";
    else if (hit && this.mode === "choose") c.cursor = "pointer";
    else c.cursor = "crosshair";
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    this.canvas.focus({ preventScroll: true });
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    this.canvas.setPointerCapture(e.pointerId);
    this.anim = null;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      this.drag = { kind: "pinch", startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, moved: true, pinch: Math.hypot(a.x - b.x, a.y - b.y) };
      return;
    }
    this.drag = { kind: "pan", startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, moved: false };
    if (this.hover) {
      this.hover = null;
      this.hooks.onHover(null);
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.local(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
    const d = this.drag;
    this.cursorPx = p;
    this.cursorDirty = true;
    if (d?.kind === "pinch" && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (d.pinch && dist > 0) {
        const dz = Math.log2(dist / d.pinch);
        this.view = zoomAbout(this.basis.grid, { w: this.w, h: this.h }, this.view, (a.x + b.x) / 2, (a.y + b.y) / 2, this.view.zoom + dz);
        d.pinch = dist;
      }
      this.invalidate();
      return;
    }
    if (d) {
      if (!d.moved && Math.hypot(p.x - d.startX, p.y - d.startY) > DRAG_PX) d.moved = true;
      if (d.moved) {
        this.view = panBy(this.basis.grid, { w: this.w, h: this.h }, this.view, p.x - d.lastX, p.y - d.lastY);
        this.updateCursorStyle();
      }
      d.lastX = p.x;
      d.lastY = p.y;
      this.invalidate();
      return;
    }
    const hit = this.hitAt(p.x, p.y);
    const same = hit && this.hover && hit.id === this.hover.id && hit.type === this.hover.type;
    if (!same) {
      this.hover = hit ? { type: hit.type, id: hit.id, x: hit.x, y: hit.y, ids: hit.ids } : null;
      this.hooks.onHover(this.hover);
      this.invalidate();
    }
    this.updateCursorStyle(hit);
    this.invalidate();
  };

  private onPointerUp = (e: PointerEvent): void => {
    const p = this.local(e);
    this.pointers.delete(e.pointerId);
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    const d = this.drag;
    if (d?.kind === "pinch") {
      if (this.pointers.size < 2) this.drag = null;
      return;
    }
    this.drag = null;
    if (!d || e.type === "pointercancel") {
      this.updateCursorStyle();
      this.invalidate();
      return;
    }
    if (d.moved) {
      this.updateCursorStyle();
      this.hooks.onView({ ...this.view, kind: this.basis.kind });
      return;
    }
    this.click(p.x, p.y);
  };

  private onPointerLeave = (): void => {
    if (this.drag) return;
    this.cursorPx = null;
    this.hooks.onCursor(null);
    if (this.hover) {
      this.hover = null;
      this.hooks.onHover(null);
      this.invalidate();
    }
  };

  private click(x: number, y: number): void {
    const [lat, lon] = this.screenToLatLon(x, y);
    if (this.mode === "measure") {
      this.hooks.onMeasure({ lat_deg: lat, lon_deg: lon });
      return;
    }
    const hit = this.hitAt(x, y);
    if (hit?.type === "site") this.hooks.onPickSite(hit.id);
    else if (hit?.type === "cluster") this.openCluster(hit.ids ?? []);
    else if (hit?.type === "pin") this.hooks.onPickPin(Number(hit.id));
    else if (hit?.type === "probe") this.hooks.onPickProbe?.();
    else if (!hit) this.hooks.onSetSite(lat, lon);
  }

  private openCluster(ids: readonly string[]): void {
    const members = this.markers.filter((m) => m.ok && ids.includes(m.site.id));
    const lead = ids[0];
    if (members.length === 0 || lead === undefined) return;
    const xs = members.map((m) => m.mx);
    const ys = members.map((m) => m.my);
    const target = fitBounds(this.basis.grid, { w: this.w, h: this.h }, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], Math.min(this.w, this.h) * 0.3);
    if (target.zoom <= this.view.zoom + 0.01) this.hooks.onPickSite(lead);
    else this.flyTo(target);
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = this.local(e);
    const unit = e.deltaMode === 1 ? 0.06 : e.deltaMode === 2 ? 1 : 0.0022;
    const dz = clamp(-e.deltaY * unit, -1, 1);
    this.anim = null;
    this.view = zoomAbout(this.basis.grid, { w: this.w, h: this.h }, this.view, p.x, p.y, this.view.zoom + dz);
    this.cursorPx = p;
    this.cursorDirty = true;
    this.invalidate();
  };


  private async fetchHeights(url: string, signal: AbortSignal): Promise<HeightTile | null> {
    const bmp = await fetchTileBitmap(url, signal);
    if (!bmp) return null;
    if (!this.scratch) {
      const c = document.createElement("canvas");
      c.width = 256;
      c.height = 256;
      this.scratch = c.getContext("2d", { willReadFrequently: true });
    }
    const g = this.scratch;
    if (!g) {
      bmp.close();
      return null;
    }
    g.clearRect(0, 0, 256, 256);
    g.drawImage(bmp, 0, 0);
    const data = g.getImageData(0, 0, 256, 256).data;
    bmp.close();
    return { data, size: 256 };
  }

  private cursorInfo(): CursorInfo | null {
    const pt = this.cursorPx;
    if (!pt) return null;
    const f = this.frame();
    const mx = toMapX(f, pt.x);
    const my = toMapY(f, pt.y);
    const { proj, grid, tileset } = this.basis;
    const [lat, lon] = proj.inverse(mx, my);
    const inside = mx >= grid.extent[0] && mx <= grid.extent[2] && my >= grid.extent[1] && my <= grid.extent[3];
    const polar = proj.kind === "polar-stereographic";
    const info: CursorInfo = {
      lat_deg: lat,
      lon_deg: lon,
      x_m: polar ? mx : null,
      y_m: polar ? my : null,
      height: { state: "na", value_m: null, slope_deg: null, baseline_m: null, pixel_m: null },
    };
    if (!tileset || !inside || !tileset.layers.some((l) => l.id === "heights")) return info;
    const z0 = tileLevel(grid, this.view.zoom, 1);
    const wantKey = tileKey(tileset.id, "heights", z0, tilePixel(grid, z0, mx, my).x, tilePixel(grid, z0, mx, my).y);
    if (wantKey !== this.heightWantKey) {
      this.heightWantKey = wantKey;
      const t = tilePixel(grid, z0, mx, my);
      this.heights.want([{ key: wantKey, url: tileUrl(tileset, this.renderVersion, "heights", z0, t.x, t.y) }]);
    }
    info.height.state = "loading";
    for (let z = z0; z >= grid.minZ; z--) {
      const t = tilePixel(grid, z, mx, my);
      const entry = this.heights.get(tileKey(tileset.id, "heights", z, t.x, t.y));
      if (!entry) continue;
      if (entry.state === "missing") {
        info.height.state = "nodata";
        return info;
      }
      if (entry.state !== "ready" || !entry.value) continue;
      const h = heightAt(entry.value, t.px, t.py);
      if (h === null) {
        info.height.state = "nodata";
        return info;
      }
      const span = tileSpan(grid, z);
      const g = proj.groundPerUnit(lat);
      const pixelM = { x: (span[0] / grid.tileSize) * g.x, y: (span[1] / grid.tileSize) * g.y };
      const s = slopeAt(entry.value, t.px, t.py, pixelM);
      info.height = { state: "ok", value_m: h, slope_deg: s?.slope_deg ?? null, baseline_m: s?.baseline_m ?? null, pixel_m: pixelM };
      return info;
    }
    return info;
  }

  invalidate(): void {
    if (this.destroyed || this.raf) return;
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    this.raf = 0;
    if (this.destroyed || this.w === 0 || !this.pal) return;
    if (this.anim) {
      const a = this.anim;
      const t = Math.min(1, (now - a.t0) / a.ms);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      this.view = { cx: a.from.cx + (a.to.cx - a.from.cx) * e, cy: a.from.cy + (a.to.cy - a.from.cy) * e, zoom: a.from.zoom + (a.to.zoom - a.from.zoom) * e };
      this.cursorDirty = true;
      if (t >= 1) this.anim = null;
      else this.invalidate();
    }
    this.paint();
    for (const fn of this.frameListeners) fn();
    if (this.cursorDirty) {
      this.cursorDirty = false;
      this.hooks.onCursor(this.cursorInfo());
    }
    const sig = `${this.basis.kind}|${this.view.cx.toFixed(2)}|${this.view.cy.toFixed(2)}|${this.view.zoom.toFixed(3)}`;
    if (sig !== this.lastEmitted && !this.drag?.moved) {
      this.lastEmitted = sig;
      this.canvas.dataset["view"] = sig;
      this.hooks.onView({ ...this.view, kind: this.basis.kind });
    }
    if (now - this.lastStatusAt > 250 || this.statusDirty) {
      this.lastStatusAt = now;
      this.statusDirty = false;
      const s = this.tiles.stats();
      this.canvas.dataset["tilesLoading"] = String(s.loading);
      this.canvas.dataset["tilesFailed"] = String(s.failed);
    }
  };

  private paint(): void {
    const ctx = this.ctx;
    const p = this.pal!;
    const f = this.frame();
    const { w, h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, w, h);
    this.hits.length = 0;

    this.paintBase(ctx, f, p);
    this.paintTiles(ctx, f);
    this.paintRegional(ctx, f, p);
    const gridLabels = this.showGraticule ? this.paintGraticule(ctx, f, p) : [];
    this.paintScenarioEllipse(ctx, f, p);
    const taken = this.paintSites(ctx, f, p);
    ctx.font = LABEL_FONT;
    for (const l of dropOverlaps(gridLabels, taken)) {
      if (l.y < 56 || (l.x < 210 && l.y > this.h - 56) || (l.x > this.w - 80 && l.y < 80)) continue;
      haloText(ctx, l.text, l.x, l.y, p.text2, p.bg, l.align, l.baseline);
    }
    this.paintArea(ctx, f, p);
    this.paintAlternatives(ctx, f, p);
    this.paintPins(ctx, f, p);
    this.paintProbe(ctx, f, p);
    this.paintBlocker(ctx, f, p);
    this.paintMeasure(ctx, f, p);
    this.paintScenarioMarker(ctx, f, p);
    this.paintHud(ctx, f, p);
  }

  private paintBase(ctx: CanvasRenderingContext2D, f: Frame, p: Palette): void {
    const { grid, proj, tileset } = this.basis;
    const x0 = toScreenX(f, grid.extent[0]);
    const x1 = toScreenX(f, grid.extent[2]);
    const y0 = toScreenY(f, grid.extent[3]);
    const y1 = toScreenY(f, grid.extent[1]);
    ctx.fillStyle = p.bgRaised;
    if (!tileset && proj.kind === "polar-stereographic") {
      const r = (x1 - x0) / 2;
      ctx.beginPath();
      ctx.arc((x0 + x1) / 2, (y0 + y1) / 2, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = p.borderStrong;
      ctx.lineWidth = 1;
      ctx.stroke();
      return;
    }
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = p.borderStrong;
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
  }

  private paintTiles(ctx: CanvasRenderingContext2D, f: Frame): void {
    const ts = this.basis.tileset;
    if (!ts || this.layers.length === 0) return;
    const g = this.basis.grid;
    const z = tileLevel(g, f.zoom, this.dpr);
    const bounds = viewBounds(f);
    const exact = visibleTiles(g, z, bounds, this.view.cx, this.view.cy);
    const zc = Math.max(g.minZ, z - 2);
    const coarse = zc < z ? visibleTiles(g, zc, bounds, this.view.cx, this.view.cy, 16) : [];
    const sig = `${ts.id}|${z}|${exact.length ? `${exact[0]!.x},${exact[0]!.y}|${exact[exact.length - 1]!.x},${exact[exact.length - 1]!.y}` : "-"}|${exact.length}|${this.layers.map((l) => l.id).join(",")}`;
    if (sig !== this.wantSig) {
      this.wantSig = sig;
      const want: TileWant[] = [];
      for (const list of [coarse, exact]) {
        for (const t of list) {
          for (const l of this.layers) want.push({ key: tileKey(ts.id, l.id, t.z, t.x, t.y), url: tileUrl(ts, this.renderVersion, l.id, t.z, t.x, t.y) });
        }
      }
      this.tiles.want(want);
      this.statusDirty = true;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    for (const l of this.layers) {
      ctx.globalAlpha = l.opacity;
      for (const t of exact) this.drawTile(ctx, f, ts.id, l.id, t);
    }
    ctx.globalAlpha = 1;
  }

  private drawTile(ctx: CanvasRenderingContext2D, f: Frame, tsId: string, layer: TileLayerId, t: TileRef): void {
    const g = this.basis.grid;
    const [xmin, ymin, xmax, ymax] = tileBounds(g, t.z, t.x, t.y);
    const dx = Math.floor(toScreenX(f, xmin));
    const dy = Math.floor(toScreenY(f, ymax));
    const dw = Math.ceil(toScreenX(f, xmax)) - dx;
    const dh = Math.ceil(toScreenY(f, ymin)) - dy;
    const size = g.tileSize;
    const entry = this.tiles.get(tileKey(tsId, layer, t.z, t.x, t.y));
    if (entry?.state === "ready" && entry.value) {
      ctx.drawImage(entry.value, 0, 0, size, size, dx, dy, dw, dh);
      return;
    }
    if (entry?.state === "missing") return;
    for (let d = 1; d <= 8 && t.z - d >= g.minZ; d++) {
      const f2 = 2 ** d;
      const px = Math.floor(t.x / f2);
      const py = Math.floor(t.y / f2);
      const anc = this.tiles.get(tileKey(tsId, layer, t.z - d, px, py));
      if (anc?.state === "ready" && anc.value) {
        const sw = size / f2;
        ctx.drawImage(anc.value, (t.x - px * f2) * sw, (t.y - py * f2) * sw, sw, sw, dx, dy, dw, dh);
        return;
      }
      if (anc?.state === "missing") return;
    }
    if (t.z + 1 <= g.maxZ) {
      for (let cy = 0; cy < 2; cy++) {
        for (let cx = 0; cx < 2; cx++) {
          const ch = this.tiles.get(tileKey(tsId, layer, t.z + 1, t.x * 2 + cx, t.y * 2 + cy));
          if (ch?.state === "ready" && ch.value) {
            ctx.drawImage(ch.value, 0, 0, size, size, dx + (cx * dw) / 2, dy + (cy * dh) / 2, dw / 2, dh / 2);
          }
        }
      }
    }
  }

  private paintGraticule(ctx: CanvasRenderingContext2D, f: Frame, p: Palette): GraticuleLabel[] {
    const g = buildGraticule(this.basis.proj, f, this.basis.grid.extent);
    ctx.lineWidth = 1;
    for (const major of [false, true]) {
      ctx.beginPath();
      for (const l of g.lines) {
        if (l.major !== major) continue;
        ctx.moveTo(l.pts[0]!, l.pts[1]!);
        for (let i = 2; i < l.pts.length; i += 2) ctx.lineTo(l.pts[i]!, l.pts[i + 1]!);
      }
      ctx.strokeStyle = major ? p.gridStrong : p.grid;
      ctx.stroke();
    }
    return g.labels;
  }

  private paintScenarioEllipse(ctx: CanvasRenderingContext2D, f: Frame, p: Palette): void {
    const o = this.scenarioOutline;
    const pos = this.scenarioPos();
    if (!o || !pos) return;
    const e = this.scenario?.ellipse;
    if (!e) return;
    const rPx = Math.max(e.semi_major_m, e.semi_minor_m) / (f.upp * this.basis.proj.groundPerUnit(pos.lat).x);
    if (rPx < 3) return;
    ctx.beginPath();
    for (let i = 0; i < o.length; i += 2) {
      const sx = (o[i]! - f.x0) / f.upp;
      const sy = (f.y0 - o[i + 1]!) / f.upp;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.fillStyle = p.accent;
    ctx.globalAlpha = 0.16;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = p.bg;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    const sx = toScreenX(f, this.basis.proj.forward(pos.lat, pos.lon)[0]);
    const sy = toScreenY(f, this.basis.proj.forward(pos.lat, pos.lon)[1]);
    const [la, lo] = destination(pos.lat, pos.lon, e.azimuth_deg, e.semi_major_m);
    const [ax, ay] = this.basis.proj.forward(la, lo);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(toScreenX(f, ax), toScreenY(f, ay));
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private fixedMarks(ctx: CanvasRenderingContext2D, f: Frame, texts: Map<string, string>): { boxes: Rect[]; labels: LabelBox[] } {
    const boxes: Rect[] = [];
    const labels: LabelBox[] = [];
    const mark = (lat: number, lon: number, r: number, id?: string, text?: string): void => {
      const pt = this.onScreen(f, lat, lon, 30);
      if (!pt) return;
      const { x, y } = pt;
      boxes.push([x - r, y - r, x + r, y + r]);
      if (id === undefined || text === undefined) return;
      labels.push({ id, x, y, r, w: ctx.measureText(text).width, must: true });
      texts.set(id, text);
    };
    const sc = this.scenarioPos();
    ctx.font = NAME_FONT_STRONG;
    if (sc) mark(sc.lat, sc.lon, 13, "@scenario", clipName(this.scenario?.name || "Plan site", 34));
    ctx.font = NAME_FONT;
    for (const a of this.alts) {
      const same = sc !== null && Math.abs(a.lat_deg - sc.lat) < 1e-5 && Math.abs(a.lon_deg - sc.lon) < 1e-5;
      if (same) mark(a.lat_deg, a.lon_deg, 10);
      else mark(a.lat_deg, a.lon_deg, 10, `@alt:${a.id}`, clipName(a.name, 28));
    }
    for (const pin of this.pins) mark(pin.lat_deg, pin.lon_deg, 11);
    return { boxes, labels };
  }

  private paintLabel(ctx: CanvasRenderingContext2D, id: string, font: string, fill: string, halo: string): void {
    const s = this.labelSpots.get(id);
    const text = this.labelTexts.get(id);
    if (!s || text === undefined) return;
    ctx.font = font;
    haloText(ctx, text, s.x, s.y, fill, halo, s.align);
  }

  private paintSites(ctx: CanvasRenderingContext2D, f: Frame, p: Palette): Rect[] {
    const colors = this.kindColors!;
    const w = this.w;
    const h = this.h;
    const pts: Array<{ id: string; x: number; y: number; prio: number; m: SiteMarker }> = [];
    let picked: { x: number; y: number; m: SiteMarker } | null = null;
    for (const m of this.showSitesLayer ? this.markers : []) {
      if (!m.ok) continue;
      const x = (m.mx - f.x0) / f.upp;
      const y = (f.y0 - m.my) / f.upp;
      if (x < -20 || x > w + 20 || y < -20 || y > h + 20) continue;
      if (m.site.id === this.selectedId) picked = { x, y, m };
      else pts.push({ id: m.site.id, x, y, prio: KIND_STYLE[m.site.kind].z, m });
    }
    const markerBoxes: Rect[] = [];
    const labels: LabelBox[] = [];
    const texts = new Map<string, string>();
    const fixed = this.fixedMarks(ctx, f, texts);
    const sc = this.scenarioPos();
    const scPt = sc ? this.onScreen(f, sc.lat, sc.lon, 30) : null;
    const single = (x: number, y: number, site: SiteEntry, sel: boolean): void => {
      const st = KIND_STYLE[site.kind];
      drawMarker(ctx, st.shape, x, y, st.shape === "dot" ? 5.5 : 6, colors[site.kind], p.bg, site.confidence === "high");
      this.hits.push({ type: "site", id: site.id, x, y, r: 10 });
      markerBoxes.push([x - 8, y - 8, x + 8, y + 8]);
      if (site.kind === "poi" && f.zoom < this.basis.grid.minZ + 5 && !sel) return;
      if (scPt && Math.abs(x - scPt.x) < 3 && Math.abs(y - scPt.y) < 3) return;
      const text = clipName(site.name.replace(/^Artemis candidate region: /, ""), 28);
      ctx.font = sel ? NAME_FONT_STRONG : NAME_FONT;
      const box: LabelBox = { id: site.id, x, y, r: 8, w: ctx.measureText(text).width, must: sel };
      if (sel) labels.unshift(box);
      else labels.push(box);
      texts.set(site.id, text);
    };
    const seeds: Rect[] = picked ? [...fixed.boxes, [picked.x - 11, picked.y - 11, picked.x + 11, picked.y + 11]] : fixed.boxes;
    for (const c of clusterPoints(pts, CLUSTER_PX)) {
      const lead = c.members[0]!;
      if (c.members.length === 1) {
        single(lead.x, lead.y, lead.m.site, false);
        continue;
      }
      const kind = lead.m.site.kind;
      const snap = badgeSpot(c.x, c.y, CLUSTER_R, BADGE_R, seeds, markerBoxes);
      const r = snap ? BADGE_R : CLUSTER_R;
      const x = snap?.x ?? c.x;
      const y = snap?.y ?? c.y;
      drawCluster(ctx, x, y, r, c.members.length, c.members.every((q) => q.m.site.kind === kind) ? colors[kind] : p.text2, p);
      this.hits.push({ type: "cluster", id: lead.id, x, y, r: r + 3, ids: c.members.map((q) => q.id) });
      markerBoxes.push([x - r - 2, y - r - 2, x + r + 2, y + r + 2]);
      if (this.hover?.type !== "cluster" || this.hover.id !== lead.id) continue;
      ctx.beginPath();
      ctx.arc(x, y, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = p.text;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    if (picked) single(picked.x, picked.y, picked.m.site, true);
    const placed = placeLabels([...fixed.labels, ...labels], [...fixed.boxes, ...markerBoxes], w, h, MAX_LABELS);
    this.labelSpots = new Map(placed.spots.map((s) => [s.id, s]));
    this.labelTexts = texts;
    for (const b of labels) this.paintLabel(ctx, b.id, b.must ? NAME_FONT_STRONG : NAME_FONT, p.text, p.bg);
    const taken = [...fixed.boxes, ...placed.rects, ...markerBoxes];
    if (!this.showSitesLayer) return taken;
    for (const id of new Set([this.selectedId, this.hover?.type === "site" ? this.hover.id : null])) {
      if (!id) continue;
      const m = this.markers.find((mk) => mk.site.id === id);
      if (!m?.ok) continue;
      const x = (m.mx - f.x0) / f.upp;
      const y = (f.y0 - m.my) / f.upp;
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.strokeStyle = id === this.selectedId ? p.focus : p.text;
      ctx.lineWidth = id === this.selectedId ? 2 : 1.2;
      ctx.stroke();
    }
    return taken;
  }

  private paintArea(ctx: CanvasRenderingContext2D, f: Frame, p: Palette): void {
    const a = this.area;
    if (!a) return;
    const proj = this.basis.proj;
    ctx.beginPath();
    let prevX = NaN;
    for (let az = 0; az <= 360; az += 4) {
      const [la, lo] = destination(a.lat_deg, a.lon_deg, az, a.radius_m);
      const [mx, my] = proj.forward(la, lo);
      if (!Number.isFinite(mx) || !Number.isFinite(my)) continue;
      const sx = toScreenX(f, mx);
      const sy = toScreenY(f, my);
      if (az === 0 || (proj.kind === "equirectangular" && Math.abs(sx - prevX) > this.w / 2)) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
      prevX = sx;
    }
    ctx.strokeStyle = p.bg;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = p.text;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private paintProbe(ctx: CanvasRenderingContext2D, f: Frame, p: Palette): void {
    const q = this.probe;
    if (!q) return;
    const pt = this.onScreen(f, q.lat, q.lon, 30);
    if (!pt) return;
    const { x, y } = pt;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x - 4, y - 8, x - 9, y - 12, x - 9, y - 19);
    ctx.arc(x, y - 19, 9, Math.PI, 0);
    ctx.bezierCurveTo(x + 9, y - 12, x + 4, y - 8, x, y);
    ctx.closePath();
    ctx.fillStyle = p.bg;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = p.text;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y - 19, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = p.text;
    ctx.fill();
    this.hits.push({ type: "probe", id: "probe", x, y: y - 16, r: 14 });
  }

  private paintAlternatives(ctx: CanvasRenderingContext2D, f: Frame, p: Palette): void {
    if (this.alts.length === 0) return;
    ctx.font = BADGE_FONT;
    this.alts.forEach((a, i) => {
      const pt = this.onScreen(f, a.lat_deg, a.lon_deg, 20);
      if (!pt) return;
      const { x, y } = pt;
      ctx.beginPath();
      ctx.arc(x, y, 8.5, 0, Math.PI * 2);
      ctx.fillStyle = p.network;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = p.bg;
      ctx.stroke();
      ctx.fillStyle = p.bg;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String.fromCharCode(65 + (i % 26)), x, y + 0.5);
      this.paintLabel(ctx, `@alt:${a.id}`, NAME_FONT, p.text, p.bg);
      ctx.font = BADGE_FONT;
      this.hits.push({ type: "alt", id: a.id, x, y, r: 11 });
    });
  }

  private paintPins(ctx: CanvasRenderingContext2D, f: Frame, p: Palette): void {
    if (this.pins.length === 0) return;
    const fill: Record<PinMark["state"], string> = { pass: p.pass, marginal: p.marginal, fail: p.fail, unknown: p.text3 };
    ctx.font = PIN_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const order = [...this.pins].sort((a, b) => Number(a.rank === this.selectedPin) - Number(b.rank === this.selectedPin) || b.rank - a.rank);
    for (const pin of order) {
      const pt = this.onScreen(f, pin.lat_deg, pin.lon_deg, 20);
      if (!pt) continue;
      const { x, y } = pt;
      const sel = pin.rank === this.selectedPin;
      const r = sel ? 12 : 9;
      if (sel) {
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.lineWidth = 5;
        ctx.strokeStyle = p.bg;
        ctx.stroke();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = p.text;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = fill[pin.state];
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = p.bg;
      ctx.stroke();
      ctx.fillStyle = p.bg;
      ctx.fillText(String(pin.rank), x, y + 0.5);
      this.hits.push({ type: "pin", id: String(pin.rank), x, y, r: r + 3 });
    }
  }

  private paintRegional(ctx: CanvasRenderingContext2D, f: Frame, p: Palette): void {
    const m = this.regional;
    const bake = this.regionalBake;
    const drawn = m !== null && bake !== null && m.hemisphere === this.basis.kind;
    if (this.canvas.dataset["regionalDrawn"] !== String(drawn)) this.canvas.dataset["regionalDrawn"] = String(drawn);
    if (!m || !bake || !drawn) return;
    const s = m.spacing_m;
    const x = toScreenX(f, m.x0_m - s / 2);
    const y = toScreenY(f, m.y0_m + s / 2);
    const w = (m.n_cols * s) / f.upp;
    const h = (m.n_rows * s) / f.upp;
    ctx.save();
    ctx.globalAlpha = this.regionalOpacity;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bake, x, y, w, h);
    ctx.restore();
    const cell = s / f.upp;
    if (cell >= 3) for (const kind of HATCH_KINDS) this.paintHatch(ctx, m, kind, x, y, cell, p);
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = p.text2;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  private paintHatch(ctx: CanvasRenderingContext2D, m: RegionalMark, kind: HatchKind, x: number, y: number, cell: number, p: Palette): void {
    let hatch = this.hatches[kind];
    if (!hatch || hatch.colour !== p.text) {
      const t = document.createElement("canvas");
      t.width = 6;
      t.height = 6;
      const g = t.getContext("2d");
      if (!g) return;
      g.strokeStyle = p.text;
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(0, 6);
      g.lineTo(6, 0);
      g.moveTo(-1, 1);
      g.lineTo(1, -1);
      g.moveTo(5, 7);
      g.lineTo(7, 5);
      if (kind === "unreliable") {
        g.moveTo(0, 0);
        g.lineTo(6, 6);
        g.moveTo(-1, 5);
        g.lineTo(1, 7);
        g.moveTo(5, -1);
        g.lineTo(7, 1);
      }
      g.stroke();
      const pattern = ctx.createPattern(t, "repeat");
      if (!pattern) return;
      hatch = { colour: p.text, pattern };
      this.hatches[kind] = hatch;
    }
    ctx.save();
    ctx.beginPath();
    let any = false;
    for (const c of m.cells) {
      if (!HATCH_CELL[kind](c)) continue;
      const cx = x + c.col * cell;
      const cy = y + c.row * cell;
      if (cx + cell < 0 || cx > this.w || cy + cell < 0 || cy > this.h) continue;
      ctx.rect(cx, cy, cell, cell);
      any = true;
    }
    if (any) {
      ctx.clip();
      ctx.globalAlpha = Math.min(0.9, this.regionalOpacity + 0.2);
      ctx.fillStyle = hatch.pattern;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    ctx.restore();
  }

  private paintScenarioMarker(ctx: CanvasRenderingContext2D, f: Frame, p: Palette): void {
    const pos = this.scenarioPos();
    if (!pos) return;
    const [mx, my] = this.basis.proj.forward(pos.lat, pos.lon);
    if (!Number.isFinite(mx) || mx < this.basis.grid.extent[0] || mx > this.basis.grid.extent[2] || my < this.basis.grid.extent[1] || my > this.basis.grid.extent[3]) return;
    const x = toScreenX(f, mx);
    const y = toScreenY(f, my);
    if (x < -30 || x > this.w + 30 || y < -30 || y > this.h + 30) return;
    for (const [col, lw] of [[p.bg, 5], [p.accent, 2.2]] as const) {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.moveTo(x - 13, y);
      ctx.lineTo(x - 3, y);
      ctx.moveTo(x + 3, y);
      ctx.lineTo(x + 13, y);
      ctx.moveTo(x, y - 13);
      ctx.lineTo(x, y - 3);
      ctx.moveTo(x, y + 3);
      ctx.lineTo(x, y + 13);
      ctx.stroke();
    }
    this.paintLabel(ctx, "@scenario", NAME_FONT_STRONG, p.accentText, p.bg);
    this.hits.push({ type: "scenario", id: "scenario", x, y, r: 14 });
  }

  private paintBlocker(ctx: CanvasRenderingContext2D, f: Frame, p: Palette): void {
    const b = this.blocker;
    if (!b) return;
    const proj = this.basis.proj;
    const [ax, ay] = proj.forward(b.from.lat_deg, b.from.lon_deg);
    const [bx, by] = proj.forward(b.to.lat_deg, b.to.lon_deg);
    if (![ax, ay, bx, by].every(Number.isFinite)) return;
    const x0 = toScreenX(f, ax);
    const y0 = toScreenY(f, ay);
    const x1 = toScreenX(f, bx);
    const y1 = toScreenY(f, by);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = p.bg;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = p.fail;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.fillStyle = p.fail;
    ctx.strokeStyle = p.bg;
    ctx.lineWidth = 1.5;
    ctx.fillRect(x1 - 4.5, y1 - 4.5, 9, 9);
    ctx.strokeRect(x1 - 4.5, y1 - 4.5, 9, 9);
    const text = [`Blocker · az ${formatBearing(b.azimuth_deg)} · ${formatDistance(b.distance_m)}`, b.label].filter(Boolean);
    plateText(ctx, text, (x0 + x1) / 2, (y0 + y1) / 2 - 22, p, this.w, this.h, p.fail, [this.w - 80, 0, this.w, 80]);
  }

  private paintMeasure(ctx: CanvasRenderingContext2D, f: Frame, p: Palette): void {
    const pts = this.measure;
    if (pts.length === 0) return;
    const proj = this.basis.proj;
    const lg = legs(pts);
    ctx.lineJoin = "round";
    for (const l of lg) {
      const n = Math.max(2, Math.min(64, Math.ceil(l.distance_m / (MOON_R_M * 0.002))));
      ctx.beginPath();
      let prevX = NaN;
      for (let i = 0; i <= n; i++) {
        const [la, lo] = i === 0 ? [l.from.lat_deg, l.from.lon_deg] : i === n ? [l.to.lat_deg, l.to.lon_deg] : destination(l.from.lat_deg, l.from.lon_deg, l.bearing_deg, (l.distance_m * i) / n);
        const [mx, my] = proj.forward(la, lo);
        const sx = toScreenX(f, mx);
        const sy = toScreenY(f, my);
        if (i === 0 || (proj.kind === "equirectangular" && Math.abs(sx - prevX) > this.w)) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
        prevX = sx;
      }
      ctx.strokeStyle = p.bg;
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.strokeStyle = p.text;
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    pts.forEach((pt, i) => {
      const [mx, my] = proj.forward(pt.lat_deg, pt.lon_deg);
      const x = toScreenX(f, mx);
      const y = toScreenY(f, my);
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = p.bg;
      ctx.fill();
      ctx.strokeStyle = p.text;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = BADGE_FONT;
      haloText(ctx, String(i + 1), x + 8, y - 6, p.text, p.bg);
    });
    lg.forEach((l, i) => {
      const [la, lo] = destination(l.from.lat_deg, l.from.lon_deg, l.bearing_deg, l.distance_m / 2);
      const [mx, my] = proj.forward(la, lo);
      const lines = [`${formatDistance(l.distance_m)} · ${formatBearing(l.bearing_deg)}`];
      if (lg.length > 1 && i === lg.length - 1) lines.push(`total ${formatDistance(l.cumulative_m)}`);
      plateText(ctx, lines, toScreenX(f, mx), toScreenY(f, my) - 18, p, this.w, this.h, p.text);
    });
  }

  private paintHud(ctx: CanvasRenderingContext2D, f: Frame, p: Palette): void {
    const { proj } = this.basis;
    const [lat, lon] = proj.inverse(this.view.cx, this.view.cy);
    const g = proj.groundPerUnit(lat);
    const bar = niceScaleBar(f.upp * g.x);
    if (bar) drawScaleBar(ctx, bar, 18, this.h - 14, "", p);
    if (this.showCompass && proj.kind === "polar-stereographic") {
      const north = this.northDirection(f, lat, lon);
      drawNorthArrow(ctx, this.w - 44, 44, north[0], north[1], p);
    }
  }

  private northDirection(f: Frame, lat: number, lon: number): [number, number] {
    const hem = this.basis.proj.hemisphere!;
    const a = polarForward(hem, lat, lon);
    const nlat = lat - 0.01;
    const b = polarForward(hem, Math.abs(nlat) > 89.9999 ? lat : nlat, lon);
    const dx = (b.x_m - a.x_m) / f.upp;
    const dy = -(b.y_m - a.y_m) / f.upp;
    const n = Math.hypot(dx, dy);
    if (n < 1e-9 || Math.abs(lat) > 89.9999) return [0, -1];
    return [dx / n, dy / n];
  }
}
