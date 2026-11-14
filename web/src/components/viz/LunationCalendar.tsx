import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { OpportunitySlot, Verdict } from "../../contract/types";
import { MS_LUNATION, formatUtc, lunationCell } from "../../lib/time";
import { VERDICT_LABEL } from "../../lib/verdict";
import { Panel } from "../ui/Panel";
import { Canvas } from "./canvas";
import { MONO, drawReadout, localPoint, type Size } from "./draw";
import { useColors } from "./useColors";

export interface LunationCalendarProps {
  slots: OpportunitySlot[];
  epochMs: number;
  lunations?: ReadonlyArray<{ number: number; start_ms: number }>;
  slotMs?: number;
  selectedMs?: number | null;
  onSelect: (utc_ms: number) => void;
  title?: string;
}

const GUTTER = 36;
const TOP = 30;
const BOTTOM = 8;
const RIGHT = 10;
const MIN_CELL_W = 11;

interface Grid {
  first: number;
  cols: number;
  rows: number;
  slotMs: number;
  cell: Map<number, OpportunitySlot>;
}

function inferSlot(slots: OpportunitySlot[]): number {
  let m = Infinity;
  const sorted = slots.map((s) => s.utc_ms).sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i]! - sorted[i - 1]!;
    if (d > 0 && d < m) m = d;
  }
  return Number.isFinite(m) ? m : MS_LUNATION / 30;
}

export function LunationCalendar({ slots, epochMs, lunations, slotMs, selectedMs = null, onSelect, title = "Landing opportunities" }: LunationCalendarProps) {
  const colors = useColors();
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const step = slotMs ?? inferSlot(slots);
  const locate = useCallback(
    (ms: number): { col: number; row: number } => {
      if (!lunations || lunations.length === 0) return lunationCell(ms, epochMs, step);
      let col = 0;
      while (col + 1 < lunations.length && lunations[col + 1]!.start_ms <= ms) col++;
      return { col, row: Math.floor((ms - lunations[col]!.start_ms) / step) };
    },
    [lunations, epochMs, step],
  );
  const colStart = useCallback((col: number) => lunations?.[col]?.start_ms ?? epochMs + col * MS_LUNATION, [lunations, epochMs]);
  const colLabel = useCallback((col: number) => lunations?.[col]?.number ?? col, [lunations]);
  const grid = useMemo<Grid>(() => {
    const rows = Math.max(1, Math.ceil(MS_LUNATION / step));
    let minCol = Infinity;
    let maxCol = -Infinity;
    const placed: Array<[number, number, OpportunitySlot]> = [];
    for (const s of slots) {
      const { col, row } = locate(s.utc_ms);
      minCol = Math.min(minCol, col);
      maxCol = Math.max(maxCol, col);
      placed.push([col, row, s]);
    }
    const first = Number.isFinite(minCol) ? minCol : 0;
    const cols = Number.isFinite(maxCol) ? maxCol - first + 1 : 1;
    const cell = new Map<number, OpportunitySlot>();
    for (const [col, row, s] of placed) cell.set((col - first) * rows + row, s);
    return { first, cols, rows, slotMs: step, cell };
  }, [slots, locate, step]);
  const firstCol = grid.first;

  const cellW = Math.max(MIN_CELL_W, (size.w - GUTTER - RIGHT) / grid.cols);
  const minWidth = GUTTER + RIGHT + grid.cols * MIN_CELL_W;
  const plotH = Math.max(40, size.h - TOP - BOTTOM);
  const cellH = plotH / grid.rows;

  const hit = useCallback(
    (x: number, y: number): { col: number; row: number } | null => {
      const col = Math.floor((x - GUTTER) / cellW);
      const row = Math.floor((y - TOP) / cellH);
      if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) return null;
      return { col, row };
    },
    [cellW, cellH, grid.cols, grid.rows],
  );

  const selected = selectedMs === null ? null : locate(selectedMs);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, sz: Size) => {
      const c = colors;
      const fill: Record<Verdict, string> = { pass: c.get("c-pass"), marginal: c.get("c-marginal"), fail: c.get("c-fail") };
      ctx.textBaseline = "middle";

      ctx.font = `10px ${MONO}`;
      ctx.fillStyle = c.get("text-3");
      ctx.textAlign = "right";
      const dayStep = 5;
      for (let d = 0; d <= 30; d += dayStep) {
        const y = TOP + ((d * 86_400_000) / MS_LUNATION) * grid.rows * cellH;
        if (y > TOP + plotH) break;
        ctx.fillText(`d${d}`, GUTTER - 8, y + 4);
        ctx.strokeStyle = c.get("grid");
        ctx.beginPath();
        ctx.moveTo(GUTTER - 4, Math.round(y) + 0.5);
        ctx.lineTo(GUTTER, Math.round(y) + 0.5);
        ctx.stroke();
      }
      ctx.textAlign = "left";
      let lastYear = -1;
      for (let i = 0; i < grid.cols; i++) {
        const t = colStart(firstCol + i);
        const year = new Date(t).getUTCFullYear();
        const x = GUTTER + i * cellW;
        if (year !== lastYear) {
          ctx.font = `600 11px ${MONO}`;
          ctx.fillStyle = c.get("text");
          ctx.fillText(String(year), x + 1, 9);
          ctx.strokeStyle = c.get("grid-strong");
          ctx.beginPath();
          ctx.moveTo(Math.round(x) + 0.5, 16);
          ctx.lineTo(Math.round(x) + 0.5, TOP + plotH);
          ctx.stroke();
          lastYear = year;
        }
        const isSel = selected !== null && selected.col - firstCol === i;
        if (cellW >= 22 || i % 3 === 0 || isSel) {
          ctx.font = `${isSel ? 600 : 400} 10px ${MONO}`;
          ctx.fillStyle = isSel ? c.get("accent-text") : c.get("text-3");
          if (cellW >= 22 || year === lastYear || isSel) ctx.fillText(String(colLabel(firstCol + i)), x + 1, 23);
        }
      }

      const gap = cellW > 14 ? 1 : 0;
      for (let col = 0; col < grid.cols; col++) {
        for (let row = 0; row < grid.rows; row++) {
          const s = grid.cell.get(col * grid.rows + row);
          const x = Math.round(GUTTER + col * cellW);
          const y = Math.round(TOP + row * cellH);
          const w = Math.round(GUTTER + (col + 1) * cellW) - x - gap;
          const h = Math.max(1, Math.round(TOP + (row + 1) * cellH) - y - (cellH > 5 ? 1 : 0));
          if (!s) {
            ctx.fillStyle = c.get("panel-2");
            ctx.fillRect(x, y, w, h);
            continue;
          }
          ctx.fillStyle = fill[s.verdict];
          ctx.globalAlpha = s.verdict === "fail" ? 0.78 : 1;
          ctx.fillRect(x, y, w, h);
          ctx.globalAlpha = 1;
          if (s.verdict === "marginal" && w >= 4 && h >= 4) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y, w, h);
            ctx.clip();
            ctx.strokeStyle = c.get("bg");
            ctx.globalAlpha = 0.5;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            for (let k = -h; k < w; k += 5) {
              ctx.moveTo(x + k, y + h);
              ctx.lineTo(x + k + h, y);
            }
            ctx.stroke();
            ctx.restore();
          } else if (s.verdict === "fail" && w >= 9 && h >= 9) {
            ctx.strokeStyle = c.get("bg");
            ctx.globalAlpha = 0.7;
            ctx.lineWidth = 1.3;
            const cx = x + w / 2;
            const cy = y + h / 2;
            const r = Math.min(3, Math.min(w, h) / 4);
            ctx.beginPath();
            ctx.moveTo(cx - r, cy - r);
            ctx.lineTo(cx + r, cy + r);
            ctx.moveTo(cx + r, cy - r);
            ctx.lineTo(cx - r, cy + r);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }
      }

      if (selected) {
        const col = selected.col - firstCol;
        if (col >= 0 && col < grid.cols && selected.row >= 0 && selected.row < grid.rows) {
          const x = GUTTER + col * cellW;
          const y = TOP + selected.row * cellH;
          const h = Math.max(3, cellH);
          ctx.fillStyle = c.get("accent");
          ctx.fillRect(GUTTER - 4, Math.round(y), 3, Math.max(2, Math.round(h)));
          ctx.strokeStyle = c.get("bg");
          ctx.lineWidth = 4;
          ctx.strokeRect(x - 1, y - 1, cellW + 1, h + 1);
          ctx.strokeStyle = c.get("text");
          ctx.lineWidth = 2;
          ctx.strokeRect(x - 1, y - 1, cellW + 1, h + 1);
        }
      }

      if (hover) {
        const h = hit(hover.x, hover.y);
        if (h) {
          const s = grid.cell.get(h.col * grid.rows + h.row);
          const t = colStart(firstCol + h.col) + h.row * grid.slotMs;
          const lines: Array<[string, string]> = [["Landing", formatUtc(s?.utc_ms ?? t, { seconds: false })]];
          if (s) {
            lines.push(["Verdict", VERDICT_LABEL[s.verdict]]);
            if (s.limiting) lines.push(["Limiting", s.limiting]);
            if (s.limiting_margin) lines.push(["Margin", s.limiting_margin]);
            if (s.open_fraction !== undefined) lines.push(["Open", `${Math.round(s.open_fraction * 100)} %`]);
          } else lines.push(["Verdict", "not evaluated"]);
          drawReadout(ctx, lines, hover.x, hover.y, sz, c);
        }
      }
    },
    [colors, grid, firstCol, cellW, cellH, plotH, colStart, colLabel, selected, hover, hit],
  );

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => setHover(localPoint(e, e.currentTarget));
  const onClick = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = localPoint(e, e.currentTarget);
    const h = hit(p.x, p.y);
    const s = h && grid.cell.get(h.col * grid.rows + h.row);
    if (s) onSelect(s.utc_ms);
  };

  const onKey = (e: KeyboardEvent) => {
    const base = selected ?? { col: firstCol, row: 0 };
    let { col, row } = base;
    if (e.key === "ArrowLeft") col -= 1;
    else if (e.key === "ArrowRight") col += 1;
    else if (e.key === "ArrowUp") row -= 1;
    else if (e.key === "ArrowDown") row += 1;
    else return;
    e.preventDefault();
    const s = grid.cell.get((col - firstCol) * grid.rows + row);
    if (s) onSelect(s.utc_ms);
  };

  const counts = useMemo(() => {
    const k: Record<Verdict, number> = { pass: 0, marginal: 0, fail: 0 };
    for (const s of slots) k[s.verdict]++;
    return k;
  }, [slots]);

  return (
    <Panel title={title} subtitle={`${grid.cols} lunations`} flush scroll={false} className="viz-panel">
      <div className="viz-stack">
        <div className="scroll-x">
          <Canvas
            className="calendar-canvas"
            wrapStyle={{ minWidth }}
            canvasRef={canvasRef}
            label={`Landing opportunity calendar: ${counts.pass} slots pass, ${counts.marginal} marginal, ${counts.fail} fail. Arrow keys move the selection.`}
            draw={draw}
            onSize={setSize}
            tabIndex={0}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setHover(null)}
            onClick={onClick}
            onKeyDown={onKey}
          />
        </div>
        <ul className="legend" aria-label="Legend">
          {(["pass", "marginal", "fail"] as const).map((v) => (
            <li key={v}>
              <i className={`lg-cell ${v}`} /> {VERDICT_LABEL[v]} <span className="num dim">{counts[v]}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
