import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { Interval, LineMark, LineRow, TimelineRow } from "../../contract/types";
import { bandEnvelope, minMaxEnvelope } from "../../lib/decimate";
import { formatNum, tickDecimals } from "../../lib/format";
import { visibleIntervals } from "../../lib/intervals";
import { clamp, niceTicks, panDomain, zoomDomain, type Range } from "../../lib/scale";
import { formatUtc, timeTicks } from "../../lib/time";
import { IconButton } from "../ui/Button";
import { Panel } from "../ui/Panel";
import { Canvas } from "./canvas";
import { spanText, whenText } from "./units";
import { SANS, drawReadout, fitText, localPoint, type Size, type ThemeColors } from "./draw";
import { useColors } from "./useColors";
import { describeInterval, describeLine, gutterReadout } from "./timelineText";

export interface TimelineProps {
  rows: TimelineRow[];
  extent: Range;
  timeMs: number;
  onTimeChange: (ms: number) => void;
  title?: string;
  extra?: ReactNode;
}

const GUTTER = 190;
const PAD_R = 14;
const AXIS_H = 26;
const INTERVAL_H = 26;
const LINE_H = 74;
const MIN_SPAN = 10 * 60_000;

const rowHeight = (r: TimelineRow) => (r.kind === "intervals" ? INTERVAL_H : LINE_H);

function lineExtent(r: LineRow): Range {
  if (r.domain) return r.domain;
  let lo = Infinity;
  let hi = -Infinity;
  const scan = (a: ArrayLike<number> | undefined) => {
    if (!a) return;
    for (let i = 0; i < a.length; i++) {
      const v = a[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  };
  scan(r.value);
  scan(r.lo);
  scan(r.hi);
  if (r.threshold) {
    lo = Math.min(lo, r.threshold.value);
    hi = Math.max(hi, r.threshold.value);
  }
  if (!(hi > lo)) return [lo - 1, hi + 1];
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

const FADE_STEPS = 6;
const FADE_STEP_PX = 3;

function fillOpen(ctx: CanvasRenderingContext2D, xs: number, xe: number, y: number, h: number, startOpen: boolean, endOpen: boolean): void {
  const fade = Math.min(FADE_STEPS * FADE_STEP_PX, (xe - xs) / (startOpen && endOpen ? 2 : 1));
  const n = Math.max(1, Math.round(fade / FADE_STEP_PX));
  const w = fade / n;
  const alpha = ctx.globalAlpha;
  ctx.fillRect(startOpen ? xs + fade : xs, y, Math.max(1, xe - xs - (startOpen ? fade : 0) - (endOpen ? fade : 0)), h);
  for (let k = 0; k < n; k++) {
    ctx.globalAlpha = alpha * (1 - (k + 0.5) / n);
    if (endOpen) ctx.fillRect(xe - fade + k * w, y, w, h);
    if (startOpen) ctx.fillRect(xs + fade - (k + 1) * w, y, w, h);
  }
  ctx.globalAlpha = alpha;
}

const FILL_TOKEN: Record<string, string> = { "c-sun": "c-sun-fill", "c-earth": "c-earth-fill", "c-uncertainty": "c-dark" };
const fillOf = (c: ThemeColors, token: string): string => c.get(FILL_TOKEN[token] ?? token);

function drawIntervals(
  ctx: CanvasRenderingContext2D,
  list: readonly Interval[],
  t0: number,
  t1: number,
  x: (t: number) => number,
  y: number,
  h: number,
): void {
  const [a, b] = visibleIntervals(list, t0, t1);
  for (let i = a; i < b; i++) {
    const iv = list[i]!;
    const xs = x(iv.start_ms);
    const xe = x(iv.end_ms);
    if (iv.start_open || iv.end_open) fillOpen(ctx, xs, xe, y, h, iv.start_open === true, iv.end_open === true);
    else ctx.fillRect(xs, y, Math.max(1, xe - xs), h);
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function pillText(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function drawPill(ctx: CanvasRenderingContext2D, text: string, x: number, minX: number, maxX: number, fill: string, ink: string, weight: number): void {
  ctx.save();
  ctx.font = `${weight} 11px ${SANS}`;
  const w = ctx.measureText(text).width + 14;
  const h = 18;
  const left = clamp(x - w / 2, minX, Math.max(minX, maxX - w));
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(left, 2, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + w / 2, 2 + h / 2 + 0.5);
  ctx.restore();
}

function drawKey(ctx: CanvasRenderingContext2D, token: string, c: ThemeColors, x: number, y: number): void {
  ctx.save();
  if (token === "c-sun") {
    ctx.strokeStyle = c.get("c-sun");
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * 5, y + Math.sin(a) * 5);
      ctx.lineTo(x + Math.cos(a) * 6.5, y + Math.sin(a) * 6.5);
      ctx.stroke();
    }
  } else if (token === "c-earth") {
    ctx.strokeStyle = c.get("c-earth");
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    ctx.moveTo(x - 5.5, y);
    ctx.lineTo(x + 5.5, y);
    ctx.moveTo(x + 2.5, y);
    ctx.ellipse(x, y, 2.5, 5.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.fillStyle = fillOf(c, token);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

const MARK_R = 5;
function markY(world: string, top: number, bottom: number): number {
  return world === "optimistic" ? top + MARK_R + 1 : world === "pessimistic" ? bottom - MARK_R - 1 : (top + bottom) / 2;
}

function drawMark(ctx: CanvasRenderingContext2D, world: string, x: number, y: number, top: number, bottom: number, c: ThemeColors): void {
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = c.get("text-2");
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(Math.round(x) + 0.5, top);
  ctx.lineTo(Math.round(x) + 0.5, bottom);
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  if (world === "optimistic") {
    ctx.moveTo(x, y - MARK_R);
    ctx.lineTo(x + MARK_R, y + MARK_R - 1);
    ctx.lineTo(x - MARK_R, y + MARK_R - 1);
  } else if (world === "pessimistic") {
    ctx.moveTo(x, y + MARK_R);
    ctx.lineTo(x + MARK_R, y - MARK_R + 1);
    ctx.lineTo(x - MARK_R, y - MARK_R + 1);
  } else {
    ctx.moveTo(x, y - MARK_R);
    ctx.lineTo(x + MARK_R, y);
    ctx.lineTo(x, y + MARK_R);
    ctx.lineTo(x - MARK_R, y);
  }
  ctx.closePath();
  ctx.fillStyle = c.get("text");
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = c.get("bg");
  ctx.stroke();
}
export function Timeline({ rows, extent, timeMs, onTimeChange, title = "Timeline", extra }: TimelineProps) {
  const colors = useColors();
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [view, setView] = useState<Range>(extent);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const extentKey = `${extent[0]}:${extent[1]}`;
  const [seenExtent, setSeenExtent] = useState(extentKey);
  if (seenExtent !== extentKey) {
    setSeenExtent(extentKey);
    setView([extent[0], extent[1]]);
  }

  const rowsTop = AXIS_H;
  const rowsH = rows.reduce((s, r) => s + rowHeight(r), 0);
  const totalH = rowsTop + rowsH + 8;
  const plotX0 = GUTTER;
  const plotX1 = Math.max(GUTTER + 50, size.w - PAD_R);
  const plotW = plotX1 - plotX0;

  const lineExtents = useMemo(() => new Map(rows.filter((r): r is LineRow => r.kind === "line").map((r) => [r.id, lineExtent(r)])), [rows]);

  const markAt = (px: number, py: number) => {
    let y = rowsTop;
    for (const row of rows) {
      const h = rowHeight(row);
      if (row.kind === "line" && row.marks && py >= y && py <= y + h) {
        const top = y + 22;
        const bottom = y + h - 6;
        let best: LineMark | null = null;
        let bestD = Infinity;
        for (const mk of row.marks) {
          const dx = Math.abs(px - tx(mk.t_ms));
          const dy = Math.abs(py - markY(mk.world, top, bottom));
          if (dx <= MARK_R + 2 && dy <= MARK_R + 3 && dx + dy < bestD) {
            best = mk;
            bestD = dx + dy;
          }
        }
        if (best) return best;
      }
      y += h;
    }
    return null;
  };

  const tx = useCallback((t: number) => plotX0 + ((t - view[0]) / (view[1] - view[0])) * plotW, [plotX0, plotW, view]);
  const tFromX = useCallback((x: number) => view[0] + ((x - plotX0) / plotW) * (view[1] - view[0]), [plotX0, plotW, view]);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, sz: Size) => {
      const c: ThemeColors = colors;
      const [t0, t1] = view;
      const plotTop = rowsTop;
      const plotBottom = rowsTop + rowsH;
      const hovering = hover !== null && hover.x >= plotX0 && hover.x <= plotX1 && hover.y >= plotTop && hover.y <= plotBottom;

      ctx.font = `500 11px ${SANS}`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      const ticks = timeTicks(t0, t1, Math.max(3, Math.floor(plotW / 100)));
      ctx.lineWidth = 1;
      for (const t of ticks) {
        const x = Math.round(tx(t.ms)) + 0.5;
        ctx.strokeStyle = t.major ? c.get("grid") : c.get("grid-strong");
        ctx.beginPath();
        ctx.moveTo(x, AXIS_H - 6);
        ctx.lineTo(x, t.major ? plotBottom : AXIS_H - 2);
        ctx.stroke();
        ctx.fillStyle = t.major ? c.get("text-2") : c.get("text-3");
        ctx.fillText(t.label, x, 10);
      }
      ctx.textAlign = "left";
      ctx.fillStyle = c.get("text-3");
      ctx.font = `600 10px ${SANS}`;
      ctx.fillText("UTC", 8, 10);

      let y = rowsTop;
      rows.forEach((row) => {
        const h = rowHeight(row);
        ctx.textAlign = "left";
        ctx.textBaseline = row.kind === "line" ? "top" : "middle";
        ctx.font = `500 13px ${SANS}`;
        ctx.fillStyle = c.get("text");
        const labelY = row.kind === "line" ? y + 8 : y + h / 2;
        ctx.fillText(fitText(ctx, row.label, GUTTER - 28 - 8), 28, labelY);
        drawKey(ctx, row.color, c, 16, row.kind === "line" ? y + 15 : y + h / 2);

        ctx.save();
        ctx.beginPath();
        ctx.rect(plotX0, y, plotW, h);
        ctx.clip();

        if (row.kind === "intervals") {
          const color = fillOf(c, row.color);
          const bh = 8;
          const by = y + (h - bh) / 2;
          ctx.fillStyle = c.get("c-neutral-bg");
          ctx.beginPath();
          ctx.roundRect(plotX0, by, plotW, bh, bh / 2);
          ctx.fill();
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(plotX0, by - 5, plotW, bh + 10, 5);
          ctx.clip();
          ctx.fillStyle = color;
          drawIntervals(ctx, row.best, t0, t1, tx, by, bh);
          ctx.globalAlpha = 0.5;
          if (row.optimistic) drawIntervals(ctx, row.optimistic, t0, t1, tx, by - 4, 2);
          if (row.pessimistic) drawIntervals(ctx, row.pessimistic, t0, t1, tx, by + bh + 2, 2);
          ctx.globalAlpha = 1;
          ctx.restore();
        } else {
          const [e0, e1] = lineExtents.get(row.id)!;
          const top = y + 22;
          const bottom = y + h - 6;
          const yv = (v: number) => bottom - ((v - e0) / (e1 - e0)) * (bottom - top);
          ctx.restore();
          ctx.save();
          ctx.font = `500 10px ${SANS}`;
          ctx.fillStyle = c.get("text-3");
          ctx.textAlign = "right";
          ctx.textBaseline = "middle";
          const yTicks = row.domain ? [row.domain[0], row.domain[1]] : niceTicks(e0, e1, 3);
          for (const v of yTicks) {
            const yy = yv(v);
            if (yy < top - 2 || yy > bottom + 2) continue;
            ctx.fillText(formatNum(v, tickDecimals(yTicks, row.decimals ?? 2)), GUTTER - 6, yy);
            ctx.strokeStyle = c.get("grid");
            ctx.beginPath();
            ctx.moveTo(plotX0, Math.round(yy) + 0.5);
            ctx.lineTo(plotX1, Math.round(yy) + 0.5);
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.rect(plotX0, y, plotW, h);
          ctx.clip();

          const buckets = Math.max(1, Math.floor(plotW));
          if (row.lo && row.hi) {
            const env = bandEnvelope(row.utc_ms, row.lo, row.hi, t0, t1, buckets);
            let runStart = 0;
            const fillRun = (a: number, b: number) => {
              if (b - a < 3) return;
              ctx.beginPath();
              for (let i = a; i < b; i += 3) ctx.lineTo(tx(env[i]!), yv(env[i + 2]!));
              for (let i = b - 3; i >= a; i -= 3) ctx.lineTo(tx(env[i]!), yv(env[i + 1]!));
              ctx.closePath();
              ctx.fillStyle = c.get(row.color);
              ctx.globalAlpha = 0.22;
              ctx.fill();
              ctx.globalAlpha = 1;
            };
            for (let i = 0; i < env.length; i += 3) {
              if (Number.isNaN(env[i + 1]!)) {
                fillRun(runStart, i);
                runStart = i + 3;
              }
            }
            fillRun(runStart, env.length);
          }
          if (row.threshold) {
            const ty = yv(row.threshold.value);
            ctx.setLineDash([5, 4]);
            ctx.strokeStyle = c.get("c-fail");
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(plotX0, Math.round(ty) + 0.5);
            ctx.lineTo(plotX1, Math.round(ty) + 0.5);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.font = `500 10px ${SANS}`;
            ctx.fillStyle = c.get("c-fail");
            ctx.textAlign = "right";
            ctx.textBaseline = "bottom";
            ctx.fillText(row.threshold.label, plotX1 - 4, ty - 2);
          }
          const env = row.noNominal ? new Float64Array(0) : minMaxEnvelope(row.utc_ms, row.value, t0, t1, buckets);
          ctx.beginPath();
          let pen = false;
          for (let i = 0; i < env.length; i += 2) {
            if (Number.isNaN(env[i + 1]!)) {
              pen = false;
              continue;
            }
            const px = tx(env[i]!);
            const py = yv(env[i + 1]!);
            if (pen) ctx.lineTo(px, py);
            else ctx.moveTo(px, py);
            pen = true;
          }
          ctx.strokeStyle = c.get(row.color);
          ctx.lineWidth = 1.75;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          ctx.stroke();
          for (const mk of row.marks ?? []) {
            const mx = tx(mk.t_ms);
            if (mx < plotX0 - MARK_R || mx > plotX1 + MARK_R) continue;
            drawMark(ctx, mk.world, mx, markY(mk.world, top, bottom), top, bottom, c);
          }
          ctx.restore();
          ctx.save();
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          const at = hovering ? tFromX(hover.x) : timeMs;
          const cur = gutterReadout(row, at);
          ctx.font = `600 15px ${SANS}`;
          ctx.fillStyle = hovering ? c.get("text-2") : c.get("text");
          ctx.fillText(cur, 28, y + 28);
          if (row.unit) {
            const nx = 28 + ctx.measureText(cur).width + 4;
            ctx.font = `500 11px ${SANS}`;
            ctx.fillStyle = c.get("text-3");
            ctx.fillText(row.unit, nx, y + 32);
          }
        }
        ctx.restore();
        y += h;
      });

      ctx.save();
      ctx.beginPath();
      ctx.rect(plotX0, plotTop, plotW, rowsH);
      ctx.clip();
      const cx = Math.round(tx(timeMs)) + 0.5;
      ctx.strokeStyle = c.get("text");
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, AXIS_H - 4);
      ctx.lineTo(cx, plotBottom);
      ctx.stroke();
      ctx.restore();

      if (hovering && !scrubbing) {
        const t = tFromX(hover.x);
        ctx.save();
        ctx.strokeStyle = c.get("text-3");
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(hover.x + 0.5, AXIS_H - 4);
        ctx.lineTo(hover.x + 0.5, plotBottom);
        ctx.stroke();
        ctx.restore();
        drawPill(ctx, pillText(t), hover.x, plotX0 - 30, plotX1 + PAD_R, c.get("panel-2"), c.get("text-2"), 500);
      }
      if (cx >= plotX0 - 5 && cx <= plotX1 + 5) drawPill(ctx, pillText(timeMs), cx, plotX0 - 30, plotX1 + PAD_R, c.get("text"), c.get("bg"), 600);

      if (hovering && !scrubbing) {
        const t = tFromX(hover.x);
        const lines: Array<[string, string]> = [["Time", whenText(t)]];
        for (const r of rows) {
          if (r.kind === "intervals") lines.push([r.label, describeInterval(r, t)]);
          else describeLine(r, t).forEach((v, i) => lines.push([i === 0 ? r.label : "", v]));
        }
        drawReadout(ctx, lines, hover.x, hover.y, sz, c);
      }
    },
    [colors, view, rows, rowsH, plotW, plotX0, plotX1, tx, tFromX, timeMs, hover, lineExtents, rowsTop, scrubbing],
  );

  type Drag = { kind: "pan" | "scrub"; x: number; view: Range; moved: number };
  const drag = useRef<Drag | null>(null);
  const timeAt = (x: number) => clamp(tFromX(clamp(x, plotX0, plotX1)), extent[0], extent[1]);

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = localPoint(e, e.currentTarget);
    if (p.x < plotX0 - 6 || p.x > plotX1 + 6) return;
    if (e.button !== 0 && e.button !== 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pan = e.shiftKey || e.button === 1;
    drag.current = { kind: pan ? "pan" : "scrub", x: p.x, view, moved: 0 };
    if (!pan) {
      setScrubbing(true);
      const hit = markAt(p.x, p.y);
      onTimeChange(hit ? hit.t_ms : timeAt(p.x));
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = localPoint(e, e.currentTarget);
    setHover(p);
    const d = drag.current;
    if (!d) return;
    d.moved = Math.max(d.moved, Math.abs(p.x - d.x));
    if (d.kind === "pan") {
      if (d.moved >= 4) setView(panDomain(d.view, -((p.x - d.x) / plotW) * (d.view[1] - d.view[0]), extent));
    } else if (d.moved >= 2) onTimeChange(timeAt(p.x));
  };

  const onPointerUp = () => {
    drag.current = null;
    setScrubbing(false);
  };

  const zoom = useCallback(
    (factor: number, anchor = 0.5) => setView((v) => zoomDomain(v, anchor, factor, extent, MIN_SPAN)),
    [extent],
  );

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const p = localPoint(e, el);
      if (p.x < plotX0 || p.x > plotX1) return;
      const sideways = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (!sideways && !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      if (sideways) {
        const d = (e.shiftKey ? e.deltaY : e.deltaX) / plotW;
        setView((v) => panDomain(v, d * (v[1] - v[0]), extent));
      } else zoom(Math.exp(-e.deltaY * 0.0018), (p.x - plotX0) / plotW);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom, plotX0, plotX1, plotW, extent]);

  const onKey = (e: KeyboardEvent) => {
    const span = view[1] - view[0];
    const step = e.shiftKey ? 3_600_000 : Math.max(60_000, span / 100);
    if (e.key === "ArrowLeft") onTimeChange(clamp(timeMs - step, extent[0], extent[1]));
    else if (e.key === "ArrowRight") onTimeChange(clamp(timeMs + step, extent[0], extent[1]));
    else if (e.key === "PageUp") setView((v) => panDomain(v, -span * 0.1, extent));
    else if (e.key === "PageDown") setView((v) => panDomain(v, span * 0.1, extent));
    else if (e.key === "+" || e.key === "=") zoom(1.5);
    else if (e.key === "-") zoom(1 / 1.5);
    else if (e.key === "Home") setView([extent[0], extent[1]]);
    else return;
    e.preventDefault();
  };

  const summary = `Timeline of ${rows.map((r) => r.label).join(", ")} from ${formatUtc(view[0], { seconds: false })} to ${formatUtc(view[1], { seconds: false })}. Click or drag to move the time; arrow keys step the time, Page Up and Page Down pan, Shift-drag or the wheel with Shift pans, plus and minus zoom, Home shows everything.`;

  return (
    <Panel
      title={title}
      subtitle={spanText(view[1] - view[0])}
      flush
      className="viz-panel timeline-panel"
      actions={
        <>
          {extra}
          <div className="toolstrip">
            <IconButton icon="plus" size="sm" label="Zoom in" onClick={() => zoom(1.5)} />
            <IconButton icon="minus" size="sm" label="Zoom out" onClick={() => zoom(1 / 1.5)} />
            <IconButton icon="reset" size="sm" label="Show all" onClick={() => setView([extent[0], extent[1]])} />
          </div>
        </>
      }
    >
      <div className="viz-stack">
        <Canvas
          className="timeline-canvas"
          wrapStyle={{ height: totalH }}
          canvasRef={canvasRef}
          label={summary}
          draw={draw}
          onSize={setSize}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
          onDoubleClick={() => setView([extent[0], extent[1]])}
        />
      </div>
    </Panel>
  );
}
