import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { HorizonProfile, StationMarker, SunlightSeries, TargetTrack } from "../../contract/types";
import { discFractionAboveHorizon, horizonAt } from "../../lib/disc";
import { formatDeg, formatNum, tickDecimals } from "../../lib/format";
import { clamp, lowerBound, niceTicks, wrap180, wrap360 } from "../../lib/scale";
import { arrMax, arrMin, elevationExtent, interpTrack } from "../../lib/track";
import { IconButton } from "../ui/Button";
import { Slider } from "../ui/Fields";
import { Canvas } from "./canvas";
import { placeLabels, type Bounds } from "./labels";
import { MONO, SANS, drawReadout, localPoint, roundRect, type Size, type ThemeColors } from "./draw";
import { useColors } from "./useColors";
import { earthCentre, earthInsetPairs, formatBlockerDistance, servedSunlight, sunDiscLit, sunInsetPairs, type InsetPair } from "./panoramaText";

export interface BlockerRequest {
  az_deg: number;
  elev_deg: number;
  blocker_dist_m: number;
  index: number;
}

export interface PanoramaStation extends StationMarker {
  members?: ReadonlyArray<{ label: string; in_contact: boolean }>;
}

export interface HorizonPanoramaProps {
  horizon: HorizonProfile;
  sun?: TargetTrack;
  earth?: TargetTrack;
  sunlight?: SunlightSeries;
  stations?: PanoramaStation[];
  timeMs: number;
  onBlockerRequest?: (req: BlockerRequest) => void;
  markedAz_deg?: number | null;
  title?: string;
  elevationFit?: [number, number];
  discInset?: boolean;
  compact?: boolean;
}

const PLOT = { left: 44, right: 12, top: 26, bottom: 10 } as const;
const INSET_W = 140;
const INSET_H = 128;
const INSET_FOOT = 52;
const INSET_GUTTER = INSET_W + 12;
const DISC_R = 22;
const MAX_VEXAG = 60;
const DEFAULT_VEXAG = 15;
const STATION_HIT_PX = 9;
const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

interface View {
  azCenter: number;
  azSpan: number;
  manual: { vexag: number; elCenter: number } | null;
}

interface Layout {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  w: number;
  h: number;
  pxX: number;
  pxY: number;
  vexag: number;
  elCenter: number;
  azCenter: number;
  azSpan: number;
}

function makeLayout(size: Size, view: View, extent: [number, number], gutter: number): Layout {
  const x0 = PLOT.left;
  const x1 = size.w - PLOT.right - gutter;
  const y0 = PLOT.top;
  const y1 = size.h - PLOT.bottom;
  const plotW = Math.max(10, x1 - x0);
  const plotH = Math.max(10, y1 - y0);
  const pxX = plotW / view.azSpan;
  let vexag: number;
  let elCenter: number;
  if (view.manual) {
    ({ vexag, elCenter } = view.manual);
  } else {
    const span = Math.max(3, extent[1] - extent[0]);
    vexag = clamp(plotH / (span * pxX), 1, DEFAULT_VEXAG);
    elCenter = (extent[0] + extent[1]) / 2;
  }
  return { x0, x1, y0, y1, w: size.w, h: size.h, pxX, pxY: pxX * vexag, vexag, elCenter, azCenter: view.azCenter, azSpan: view.azSpan };
}

const toX = (L: Layout, azUnwrapped: number) => (L.x0 + L.x1) / 2 + (azUnwrapped - L.azCenter) * L.pxX;
const toY = (L: Layout, el: number) => (L.y0 + L.y1) / 2 - (el - L.elCenter) * L.pxY;
const fromX = (L: Layout, x: number) => L.azCenter + (x - (L.x0 + L.x1) / 2) / L.pxX;

function azStepFor(pxX: number): number {
  return [1, 2, 5, 10, 15, 30, 45, 90].find((s) => s * pxX >= 64) ?? 90;
}

function horizonPath(L: Layout, elev: ArrayLike<number>): Array<[number, number]> {
  const n = elev.length;
  const step = 360 / n;
  const lo = L.azCenter - L.azSpan / 2 - step;
  const hi = L.azCenter + L.azSpan / 2 + step;
  const pts: Array<[number, number]> = [];
  for (let i = Math.floor(lo / step); i <= Math.ceil(hi / step); i++) {
    pts.push([toX(L, i * step), toY(L, elev[((i % n) + n) % n]!)]);
  }
  return pts;
}

function tracePath(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>, move = true): void {
  pts.forEach(([x, y], i) => (i === 0 && move ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
}

interface BodyStyle {
  color: string;
  soft: string;
  highlight: string;
  name: string;
}

interface PendingLabel {
  text: string;
  color: string;
  font: string;
  ax: number;
  ay: number;
  gap: number;
  side?: "left" | "right";
}

function drawLabels(ctx: CanvasRenderingContext2D, labels: PendingLabel[], bounds: Bounds): void {
  if (labels.length === 0) return;
  const requests = labels.map((l) => {
    ctx.font = l.font;
    return { ax: l.ax, ay: l.ay, gap: l.gap, side: l.side, w: Math.ceil(ctx.measureText(l.text).width) + 2, h: 13 };
  });
  const placed = placeLabels(requests, bounds);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  labels.forEach((l, i) => {
    const p = placed[i]!;
    const r = requests[i]!;
    if (p.leader) {
      const [nx, ny] = p.leader;
      const d = Math.hypot(nx - l.ax, ny - l.ay) || 1;
      ctx.beginPath();
      ctx.moveTo(l.ax + ((nx - l.ax) / d) * Math.min(l.gap, d), l.ay + ((ny - l.ay) / d) * Math.min(l.gap, d));
      ctx.lineTo(nx, ny);
      ctx.strokeStyle = l.color;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.font = l.font;
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, p.x + 1, p.y + r.h / 2);
  });
}

function litDisc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, style: BodyStyle, alpha: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = style.color;
  ctx.fill();
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, style.highlight);
  g.addColorStop(0.75, style.color);
  g.addColorStop(1, style.color);
  ctx.globalAlpha = alpha * 0.5;
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

function drawDisc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  style: BodyStyle,
  clipAbove: ((ctx: CanvasRenderingContext2D) => void) | null,
): void {
  const ellipse = () => {
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2);
  };
  ellipse();
  ctx.fillStyle = style.soft;
  ctx.fill();
  ctx.save();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = style.color;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  if (clipAbove) clipAbove(ctx);
  ctx.translate(cx, cy);
  ctx.scale(1, Math.max(ry, 0.5) / Math.max(rx, 0.5));
  litDisc(ctx, 0, 0, Math.max(rx, 0.5), style, 1);
  ctx.restore();

  if (rx < 5) {
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.strokeStyle = style.color;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawInset(
  ctx: CanvasRenderingContext2D,
  h: HorizonProfile,
  p: { az_deg: number; el_deg: number; ang_radius_deg: number },
  style: BodyStyle,
  pairs: readonly InsetPair[],
  x: number,
  y: number,
  c: ThemeColors,
  lit = 1,
): void {
  const W = INSET_W;
  const H = INSET_H;
  const R = DISC_R;
  const s = R / p.ang_radius_deg;
  const cx = x + W / 2;
  const cy = y + 46;
  ctx.save();
  roundRect(ctx, x, y, W, H, 6);
  ctx.fillStyle = c.get("panel");
  ctx.fill();
  ctx.strokeStyle = c.get("border-strong");
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.clip();

  const hz = (px: number, elev: ArrayLike<number>) => {
    const dx = (px - cx) / s;
    const cosE = Math.max(0.05, Math.cos((p.el_deg * Math.PI) / 180));
    return cy - (horizonAt(elev, p.az_deg + dx / cosE) - p.el_deg) * s;
  };
  const poly = (elev: ArrayLike<number>) => {
    const pts: Array<[number, number]> = [];
    for (let px = x; px <= x + W; px += 3) pts.push([px, hz(px, elev)]);
    return pts;
  };
  const best = poly(h.elev_deg);

  ctx.beginPath();
  tracePath(ctx, best);
  ctx.lineTo(x + W, y + H);
  ctx.lineTo(x, y + H);
  ctx.closePath();
  ctx.fillStyle = c.get("c-terrain-fill");
  ctx.fill();

  const ghost = () => {
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
  };
  ghost();
  ctx.fillStyle = style.soft;
  ctx.fill();
  ctx.save();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = style.color;
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  tracePath(ctx, best);
  ctx.lineTo(x + W, y - 4);
  ctx.lineTo(x, y - 4);
  ctx.closePath();
  ctx.clip();
  litDisc(ctx, cx, cy, R, style, lit);
  ctx.restore();

  for (const elev of [h.elev_lo_deg, h.elev_hi_deg]) {
    ctx.beginPath();
    tracePath(ctx, poly(elev));
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = c.get("c-uncertainty");
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.beginPath();
  tracePath(ctx, best);
  ctx.strokeStyle = c.get("c-terrain-line");
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const fy = y + H - INSET_FOOT;
  ctx.fillStyle = c.get("panel");
  ctx.fillRect(x, fy, W, INSET_FOOT);
  ctx.fillStyle = c.get("border");
  ctx.fillRect(x, fy, W, 1);

  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.font = `500 11px ${SANS}`;
  ctx.fillStyle = c.get("text-2");
  ctx.fillText(style.name, x + 8, y + 7);
  pairs.forEach(([label, value], i) => {
    const ty = fy + 8 + i * 14;
    ctx.font = `11px ${SANS}`;
    ctx.fillStyle = c.get("text-3");
    ctx.textAlign = "left";
    ctx.fillText(label, x + 8, ty);
    ctx.font = `11px ${MONO}`;
    ctx.fillStyle = c.get("text");
    ctx.textAlign = "right";
    ctx.fillText(value, x + W - 8, ty);
  });
  ctx.restore();
}

function stationXY(L: Layout, st: StationMarker): { x: number; y: number } {
  return { x: toX(L, st.az_deg + Math.round((L.azCenter - st.az_deg) / 360) * 360), y: toY(L, st.el_deg) };
}

function stationAt(L: Layout, stations: readonly PanoramaStation[], x: number, y: number): PanoramaStation | null {
  let best: PanoramaStation | null = null;
  let bestD = STATION_HIT_PX;
  for (const st of stations) {
    const p = stationXY(L, st);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= bestD) {
      best = st;
      bestD = d;
    }
  }
  return best;
}

export function HorizonPanorama({
  horizon,
  sun,
  earth,
  sunlight,
  stations = [],
  timeMs,
  onBlockerRequest,
  markedAz_deg = null,
  title = "Horizon panorama",
  elevationFit,
  discInset = true,
  compact = false,
}: HorizonPanoramaProps) {
  const colors = useColors();
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ azCenter: 180, azSpan: 360, manual: null });
  const [seenHorizon, setSeenHorizon] = useState(horizon);
  if (seenHorizon !== horizon) {
    setSeenHorizon(horizon);
    setView((v) => (v.manual === null ? v : { ...v, manual: null }));
  }
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [insetOn, setInset] = useState(discInset);
  const inset = insetOn && !compact;
  const marked = compact ? null : markedAz_deg;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const tracks = useMemo(() => [sun, earth].filter((t): t is TargetTrack => !!t), [sun, earth]);
  const extent = useMemo(() => elevationFit ?? elevationExtent(horizon, tracks), [elevationFit, horizon, tracks]);
  const gutter = inset && size.w >= 640 && size.h >= PLOT.top + PLOT.bottom + INSET_H ? INSET_GUTTER : 0;
  const L = useMemo(() => makeLayout(size, view, extent, gutter), [size, view, extent, gutter]);

  const n = horizon.elev_deg.length;
  const nearestIndex = useCallback((az: number) => Math.round((wrap360(az) / 360) * n) % n, [n]);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, sz: Size) => {
      const c = colors;
      const best = horizonPath(L, horizon.elev_deg);
      const lo = compact ? [] : horizonPath(L, horizon.elev_lo_deg);
      const hi = compact ? [] : horizonPath(L, horizon.elev_hi_deg);

      ctx.save();
      ctx.beginPath();
      ctx.rect(L.x0, L.y0, L.x1 - L.x0, L.y1 - L.y0);
      ctx.clip();

      const sky = ctx.createLinearGradient(0, L.y0, 0, L.y1);
      sky.addColorStop(0, c.get("sky"));
      sky.addColorStop(1, c.get("sky-low"));
      ctx.fillStyle = sky;
      ctx.fillRect(L.x0, L.y0, L.x1 - L.x0, L.y1 - L.y0);

      const elLo = L.elCenter - (L.y1 - L.y0) / 2 / L.pxY;
      const elHi = L.elCenter + (L.y1 - L.y0) / 2 / L.pxY;
      ctx.lineWidth = 1;
      const elTicks = niceTicks(elLo, elHi, Math.max(3, (L.y1 - L.y0) / 44));
      const elDecimals = tickDecimals(elTicks, 3);
      for (const e of elTicks) {
        const y = Math.round(toY(L, e)) + 0.5;
        ctx.strokeStyle = e === 0 ? c.get("grid-strong") : c.get("grid");
        ctx.beginPath();
        ctx.moveTo(L.x0, y);
        ctx.lineTo(L.x1, y);
        ctx.stroke();
      }
      const azStep = azStepFor(L.pxX);
      const azLo = L.azCenter - L.azSpan / 2;
      const azHi = L.azCenter + L.azSpan / 2;
      for (let a = Math.ceil(azLo / azStep) * azStep; a <= azHi; a += azStep) {
        const x = Math.round(toX(L, a)) + 0.5;
        ctx.strokeStyle = a % 90 === 0 ? c.get("grid-strong") : c.get("grid");
        ctx.beginPath();
        ctx.moveTo(x, L.y0);
        ctx.lineTo(x, L.y1);
        ctx.stroke();
      }

      ctx.beginPath();
      tracePath(ctx, best);
      ctx.lineTo(best[best.length - 1]![0], L.y1 + 2);
      ctx.lineTo(best[0]![0], L.y1 + 2);
      ctx.closePath();
      ctx.fillStyle = c.get("c-terrain-fill");
      ctx.fill();

      if (!compact) {
        ctx.beginPath();
        tracePath(ctx, hi);
        tracePath(ctx, [...lo].reverse(), false);
        ctx.closePath();
        ctx.fillStyle = c.get("c-uncertainty-soft");
        ctx.fill();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = c.get("c-uncertainty");
        ctx.lineWidth = 1;
        for (const p of [lo, hi]) {
          ctx.beginPath();
          tracePath(ctx, p);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      ctx.beginPath();
      tracePath(ctx, best);
      ctx.strokeStyle = c.get("c-terrain-line");
      ctx.lineWidth = 1.6;
      ctx.lineJoin = "round";
      ctx.stroke();

      if (marked !== null) {
        let a = marked;
        a += Math.round((L.azCenter - a) / 360) * 360;
        const x = toX(L, a);
        const idx = nearestIndex(marked);
        const y = toY(L, horizon.elev_deg[idx]!);
        ctx.strokeStyle = c.get("text");
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, L.y0);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = c.get("text");
        ctx.fill();
      }

      const drawTrackLine = (t: TargetTrack, color: string) => {
        const m = t.utc_ms.length;
        const stride = Math.max(1, Math.floor(m / 3000));
        const now = lowerBound(t.utc_ms, timeMs);
        const segments: Array<[number, number, boolean]> = compact
          ? [[0, m - 1, false]]
          : [
              [0, Math.min(m - 1, now), true],
              [Math.max(0, now - 1), m - 1, false],
            ];
        for (const [from, to, past] of segments) {
          ctx.beginPath();
          let prevO = Number.NaN;
          for (let i = from; i <= to; i = Math.min(to + (i === to ? 1 : 0), i + stride)) {
            const o = wrap180(t.az_deg[i]! - L.azCenter);
            const x = (L.x0 + L.x1) / 2 + o * L.pxX;
            const y = toY(L, t.el_deg[i]!);
            if (Number.isNaN(prevO) || Math.abs(o - prevO) > 180) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
            prevO = o;
          }
          ctx.strokeStyle = color;
          ctx.lineWidth = past ? 1.2 : 1.8;
          ctx.globalAlpha = past ? 0.55 : 0.95;
          ctx.setLineDash(past ? [4, 3] : []);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      };
      const clipAbove = (g: CanvasRenderingContext2D) => {
        g.beginPath();
        tracePath(g, best);
        g.lineTo(best[best.length - 1]![0], L.y0 - 2000);
        g.lineTo(best[0]![0], L.y0 - 2000);
        g.closePath();
        g.clip();
      };
      if (compact) {
        ctx.save();
        clipAbove(ctx);
        if (sun) drawTrackLine(sun, c.get("c-sun"));
        ctx.restore();
      } else {
        if (sun) drawTrackLine(sun, c.get("c-sun"));
        if (earth) drawTrackLine(earth, c.get("c-earth"));
      }

      const labels: PendingLabel[] = [];
      const place = (t: TargetTrack | undefined, style: BodyStyle) => {
        if (!t) return null;
        const p = interpTrack(t, timeMs);
        if (!p) return null;
        const a = p.az_deg + Math.round((L.azCenter - p.az_deg) / 360) * 360;
        const cx = toX(L, a);
        const cy = toY(L, p.el_deg);
        const rx = compact ? 6 : p.ang_radius_deg * L.pxX;
        drawDisc(ctx, cx, cy, rx, compact ? 6 : p.ang_radius_deg * L.pxY, style, clipAbove);
        if (cy >= L.y0 && cy <= L.y1 && cx >= L.x0 && cx <= L.x1 && p.el_deg >= horizonAt(horizon.elev_deg, p.az_deg)) labels.push({ text: style.name, color: c.get("text"), font: `600 11px ${SANS}`, ax: cx, ay: cy, gap: Math.max(rx, 8) });
        return p;
      };
      const sunStyle: BodyStyle = { color: c.get("c-sun"), soft: c.get("c-sun-soft"), highlight: c.get("on-accent"), name: "Sun" };
      const earthStyle: BodyStyle = { color: c.get("c-earth"), soft: c.get("c-earth-soft"), highlight: c.get("on-accent"), name: "Earth" };
      const sunNow = place(sun, sunStyle);
      const earthNow = place(earth, earthStyle);

      const earthShown = earthNow !== null && toY(L, earthNow.el_deg) <= L.y1 && earthNow.el_deg >= horizonAt(horizon.elev_deg, earthNow.az_deg);
      const sorted = earthShown ? [...stations].sort((a, b) => a.el_deg - b.el_deg) : [];
      sorted.forEach((st) => {
        const { x, y } = stationXY(L, st);
        const col = c.station(stations.indexOf(st));
        ctx.beginPath();
        ctx.moveTo(x, y - 5);
        ctx.lineTo(x + 5, y);
        ctx.lineTo(x, y + 5);
        ctx.lineTo(x - 5, y);
        ctx.closePath();
        if (st.in_contact) {
          ctx.fillStyle = col;
          ctx.fill();
        } else {
          ctx.fillStyle = c.get("panel");
          ctx.fill();
        }
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        labels.push({ text: st.label, color: c.get("text-2"), font: `500 10px ${SANS}`, ax: x, ay: y, gap: 7, side: "left" });
      });

      drawLabels(ctx, labels, { x0: L.x0 + 2, y0: L.y0 + 2, x1: L.x1 - 2, y1: L.y1 - 2 });

      ctx.restore();

      ctx.font = `11px ${MONO}`;
      ctx.fillStyle = c.get("text-3");
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (const e of elTicks) {
        const y = toY(L, e);
        if (y < L.y0 + 4 || y > L.y1 - 4) continue;
        ctx.fillText(`${formatNum(e, elDecimals)}°`, L.x0 - 6, y);
      }

      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      for (let a = Math.ceil(azLo / azStep) * azStep; a <= azHi; a += azStep) {
        const x = toX(L, a);
        if (x < L.x0 + 10 || x > L.x1 - 10) continue;
        const deg = wrap360(a);
        const card = deg % 45 === 0 ? CARDINALS[deg / 45] : undefined;
        if (card) {
          ctx.font = `600 ${deg % 90 === 0 ? 12 : 10}px ${SANS}`;
          ctx.fillStyle = deg % 90 === 0 ? c.get("text") : c.get("text-2");
          ctx.fillText(card, x, L.y0 - 14);
          ctx.font = `10px ${MONO}`;
          ctx.fillStyle = c.get("text-3");
          ctx.fillText(`${deg}°`, x, L.y0 - 4);
        } else {
          ctx.font = `10px ${MONO}`;
          ctx.fillStyle = c.get("text-3");
          ctx.fillText(`${deg}°`, x, L.y0 - 8);
        }
      }

      ctx.strokeStyle = c.get("border-strong");
      ctx.lineWidth = 1;
      ctx.strokeRect(L.x0 + 0.5, L.y0 + 0.5, L.x1 - L.x0 - 1, L.y1 - L.y0 - 1);

      if (inset && gutter > 0) {
        let iy = L.y0;
        const ix = L.x1 + 8;
        const items: Array<[typeof sunNow, BodyStyle, boolean]> = [
          [earthNow, earthStyle, false],
          [sunNow, sunStyle, true],
        ];
        for (const [p, style, isSun] of items) {
          if (!p || iy + INSET_H > L.y1) continue;
          const served = isSun && sunlight ? servedSunlight(sunlight, timeMs) : null;
          const pairs = isSun
            ? sunInsetPairs(served, discFractionAboveHorizon(horizon.elev_deg, p.az_deg, p.el_deg, p.ang_radius_deg))
            : earthInsetPairs((earth ? earthCentre(earth, timeMs) : null) ?? { el_deg: NaN }, p.el_deg - horizonAt(horizon.elev_deg, p.az_deg));
          drawInset(ctx, horizon, p, style, pairs, ix, iy, c, isSun ? sunDiscLit(served) : 1);
          iy += INSET_H + 8;
        }
      }

      const station = hover ? stationAt(L, stations, hover.x, hover.y) : null;
      if (hover && station) {
        const members = station.members ?? [{ label: station.label, in_contact: station.in_contact }];
        drawReadout(
          ctx,
          [...(members.length > 1 ? [[station.label, ""] as [string, string]] : []), ...members.map((m) => [m.label, m.in_contact ? "link" : "no link"] as [string, string])],
          hover.x,
          hover.y,
          sz,
          c,
        );
      } else if (hover && hover.x >= L.x0 && hover.x <= L.x1 && hover.y >= L.y0 && hover.y <= L.y1) {
        const az = fromX(L, hover.x);
        const idx = nearestIndex(az);
        ctx.strokeStyle = c.get("text-2");
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(hover.x + 0.5, L.y0);
        ctx.lineTo(hover.x + 0.5, L.y1);
        ctx.stroke();
        ctx.setLineDash([]);
        const hz = horizonAt(horizon.elev_deg, az);
        const boundLo = horizonAt(horizon.elev_lo_deg, az);
        const boundHi = horizonAt(horizon.elev_hi_deg, az);
        const rows: Array<[string, string]> = [
          ["Azimuth", formatDeg(az, 1, { azimuth: true })],
          ["Horizon", `${formatNum(hz, 1)}°`],
        ];
        if (!compact) {
          if (Math.abs(boundHi - boundLo) >= 0.005) rows.push(["Error range", `${formatNum(boundLo, 1)}…${formatNum(boundHi, 1)}°`]);
          rows.push(["Blocker", formatBlockerDistance(horizon.blocker_dist_m[idx]!)]);
        }
        drawReadout(ctx, rows, hover.x, hover.y, sz, c);
      }
    },
    [colors, L, horizon, sun, earth, sunlight, stations, timeMs, marked, inset, gutter, hover, nearestIndex, compact],
  );

  const drag = useRef<{ x: number; y: number; moved: number; view: View; eff: Layout } | null>(null);

  const requestBlocker = useCallback(
    (az: number) => {
      if (compact) return;
      const idx = nearestIndex(az);
      onBlockerRequest?.({
        az_deg: horizon.az_deg[idx] ?? wrap360(az),
        elev_deg: horizon.elev_deg[idx]!,
        blocker_dist_m: horizon.blocker_dist_m[idx]!,
        index: idx,
      });
    },
    [horizon, nearestIndex, onBlockerRequest, compact],
  );

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = localPoint(e, e.currentTarget);
    drag.current = { x: p.x, y: p.y, moved: 0, view, eff: L };
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = localPoint(e, e.currentTarget);
    setHover(p);
    const d = drag.current;
    if (!d) return;
    const dx = p.x - d.x;
    const dy = p.y - d.y;
    d.moved = Math.max(d.moved, Math.hypot(dx, dy));
    if (d.moved < 4) return;
    setView({
      azCenter: wrap360(d.view.azCenter - dx / d.eff.pxX),
      azSpan: d.view.azSpan,
      manual: compact ? d.view.manual : { vexag: d.eff.vexag, elCenter: d.eff.elCenter + dy / d.eff.pxY },
    });
  };
  const onPointerUp = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved >= 4) return;
    const p = localPoint(e, e.currentTarget);
    if (p.x >= L.x0 && p.x <= L.x1 && p.y >= L.y0 && p.y <= L.y1) requestBlocker(fromX(L, p.x));
  };

  const zoom = useCallback(
    (factor: number, anchorX?: number) => {
      setView((v) => {
        const span = clamp(v.azSpan / factor, 8, 360);
        if (span === 360) return { ...v, azSpan: 360 };
        const ax = anchorX === undefined ? (L.x0 + L.x1) / 2 : anchorX;
        const frac = (ax - (L.x0 + L.x1) / 2) / (L.x1 - L.x0);
        const azAt = v.azCenter + frac * v.azSpan;
        return { ...v, azSpan: span, azCenter: wrap360(azAt - frac * span) };
      });
    },
    [L.x0, L.x1],
  );
  const setVexag = useCallback(
    (vexag: number) => setView((v) => ({ ...v, manual: { vexag: clamp(vexag, 1, MAX_VEXAG), elCenter: v.manual?.elCenter ?? L.elCenter } })),
    [L.elCenter],
  );

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.0016);
      if (e.altKey || e.ctrlKey) {
        if (!compact) setVexag(L.vexag * f);
      }
      else zoom(f, localPoint(e, el).x);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom, setVexag, L.vexag, compact]);

  const onKey = (e: KeyboardEvent) => {
    const k = e.key;
    if (k === "ArrowLeft") setView((v) => ({ ...v, azCenter: wrap360(v.azCenter - v.azSpan / 10) }));
    else if (k === "ArrowRight") setView((v) => ({ ...v, azCenter: wrap360(v.azCenter + v.azSpan / 10) }));
    else if (compact && (k === "ArrowUp" || k === "ArrowDown" || k === "[" || k === "]" || k === "Enter")) return;
    else if (k === "ArrowUp") setView((v) => ({ ...v, manual: { vexag: L.vexag, elCenter: (v.manual?.elCenter ?? L.elCenter) + 20 / L.pxY } }));
    else if (k === "ArrowDown") setView((v) => ({ ...v, manual: { vexag: L.vexag, elCenter: (v.manual?.elCenter ?? L.elCenter) - 20 / L.pxY } }));
    else if (k === "+" || k === "=") zoom(1.4);
    else if (k === "-") zoom(1 / 1.4);
    else if (k === "]") setVexag(L.vexag * 1.3);
    else if (k === "[") setVexag(L.vexag / 1.3);
    else if (k === "0" || k === "f") setView({ azCenter: 180, azSpan: 360, manual: null });
    else if (k === "Enter") requestBlocker(hover ? fromX(L, hover.x) : L.azCenter);
    else return;
    e.preventDefault();
  };

  const summary = compact
    ? "Sun and Earth paths over the terrain horizon."
    : `Terrain horizon from ${formatNum(arrMin(horizon.elev_deg), 1)}° to ${formatNum(arrMax(horizon.elev_deg), 1)}°, with the Sun and Earth paths. Click the horizon to trace what blocks it.`;

  const resetView = () => setView({ azCenter: 180, azSpan: 360, manual: null });

  return (
    <section className="panel viz-panel" aria-label={title}>
      <div className="viz-stack">
        <Canvas
          className="panorama-canvas"
          canvasRef={canvasRef}
          label={summary}
          draw={draw}
          onSize={setSize}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
          onDoubleClick={resetView}
        >
          {!compact && (
          <div className="viz-float toolstrip toolstrip-float" role="group" aria-label="View controls" style={{ top: L.y0 + 6, right: Math.max(6, size.w - L.x1 + 6) }}>
            <IconButton icon="target" label="True-size Sun and Earth discs" size="sm" pressed={inset} onClick={() => setInset((v) => !v)} />
            <span className="toolstrip-sep" aria-hidden="true" />
            <div className="viz-float-slider">
              <Slider
                label="Vertical exaggeration"
                min={0}
                max={100}
                step={1}
                value={(Math.log(L.vexag) / Math.log(MAX_VEXAG)) * 100}
                onChange={(t) => setVexag(Math.pow(MAX_VEXAG, t / 100))}
                format={() => `${L.vexag.toFixed(L.vexag < 10 ? 1 : 0)}×`}
              />
            </div>
            <span className="toolstrip-sep" aria-hidden="true" />
            <IconButton icon="plus" label="Zoom in" size="sm" onClick={() => zoom(1.5)} />
            <IconButton icon="minus" label="Zoom out" size="sm" onClick={() => zoom(1 / 1.5)} />
            <IconButton icon="reset" label="Reset view" size="sm" shortcut="F" onClick={resetView} />
          </div>
          )}
        </Canvas>
        <ul className="legend" aria-label="Legend">
          <li>
            <i className="lg-line" style={{ background: "var(--c-terrain-line)" }} /> Horizon
          </li>
          {!compact && (
            <li>
              <i className="lg-band" /> Terrain error range
            </li>
          )}
          {sun && (
            <li>
              <i className="lg-line" style={{ background: "var(--c-sun)" }} /> Sun
            </li>
          )}
          {earth && (
            <li>
              <i className={compact ? "lg-dot" : "lg-line"} style={{ background: "var(--c-earth)" }} /> Earth
            </li>
          )}
          {!compact && (sun || earth) && (
            <li>
              <i className="lg-dash" /> Past
            </li>
          )}
          {stations.length > 0 && (
            <>
              <li>
                <i className="lg-diamond filled" /> Earth link
              </li>
              <li>
                <i className="lg-diamond" /> No link
              </li>
            </>
          )}
        </ul>
      </div>
    </section>
  );
}
