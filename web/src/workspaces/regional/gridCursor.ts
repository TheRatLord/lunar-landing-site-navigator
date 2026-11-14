import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { clamp } from "../../lib/scale";

export const GLYPH = { pass: "check", marginal: "warn", fail: "cross" } as const;
export const VERDICT_WORD = { pass: "Pass", marginal: "Marginal", fail: "Fail" } as const;

const ARROW_STEP: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

export function useGridCursor(rows: number, cols: number, northUp: boolean) {
  const [cursor, setCursor] = useState<{ row: number; col: number } | null>(null);
  const scale = clamp(Math.floor(480 / Math.max(rows, cols)), 1, 12);
  const handlers = {
    onPointerMove: (e: PointerEvent<HTMLCanvasElement>) => {
      const b = e.currentTarget.getBoundingClientRect();
      const r = clamp(Math.floor(((e.clientY - b.top) / b.height) * rows), 0, rows - 1);
      setCursor({ row: northUp ? rows - 1 - r : r, col: clamp(Math.floor(((e.clientX - b.left) / b.width) * cols), 0, cols - 1) });
    },
    onPointerLeave: () => setCursor(null),
    onKeyDown: (e: KeyboardEvent) => {
      const step = ARROW_STEP[e.key];
      if (!step) return;
      e.preventDefault();
      const base = cursor ?? { row: Math.floor(rows / 2), col: Math.floor(cols / 2) };
      const n = e.shiftKey ? 10 : 1;
      setCursor({ row: clamp(base.row + (northUp ? -step[0] : step[0]) * n, 0, rows - 1), col: clamp(base.col + step[1] * n, 0, cols - 1) });
    },
  };
  return { cursor, setCursor, scale, handlers };
}
