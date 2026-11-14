export interface ThemeColors {
  get(token: string): string;
  station(i: number): string;
}

const MONO_FALLBACK = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
const SANS_FALLBACK = 'system-ui, -apple-system, "Segoe UI", sans-serif';

function face(token: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || fallback;
}

export let MONO = face("--font-mono", MONO_FALLBACK);
export let SANS = face("--font-ui", SANS_FALLBACK);

export function syncFonts(): void {
  MONO = face("--font-mono", MONO_FALLBACK);
  SANS = face("--font-ui", SANS_FALLBACK);
}

export function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}…`;
}

export interface Size {
  w: number;
  h: number;
}

export function localPoint(e: { clientX: number; clientY: number }, el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawReadout(
  ctx: CanvasRenderingContext2D,
  lines: Array<[string, string]>,
  x: number,
  y: number,
  bounds: Size,
  c: ThemeColors,
): void {
  ctx.save();
  const labelFont = `11px ${SANS}`;
  const valueFont = `11px ${MONO}`;
  ctx.font = labelFont;
  const labelW = Math.max(...lines.map(([l]) => ctx.measureText(l).width));
  ctx.font = valueFont;
  const valueW = Math.max(...lines.map(([, v]) => ctx.measureText(v).width));
  const pad = 8;
  const lh = 16;
  const w = labelW + valueW + pad * 2 + 14;
  const h = lines.length * lh + pad * 2 - 4;
  let bx = x + 14;
  let by = y + 14;
  if (bx + w > bounds.w - 4) bx = x - 14 - w;
  if (by + h > bounds.h - 4) by = y - 14 - h;
  bx = Math.max(4, bx);
  by = Math.max(4, by);
  roundRect(ctx, bx, by, w, h, 6);
  ctx.fillStyle = c.get("panel-2");
  ctx.globalAlpha = 0.97;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = c.get("border-strong");
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.textBaseline = "top";
  lines.forEach(([l, v], i) => {
    const ty = by + pad - 1 + i * lh;
    ctx.font = labelFont;
    ctx.fillStyle = c.get("text-3");
    ctx.textAlign = "left";
    ctx.fillText(l, bx + pad, ty);
    ctx.font = valueFont;
    ctx.fillStyle = c.get("text");
    ctx.textAlign = "right";
    ctx.fillText(v, bx + w - pad, ty);
  });
  ctx.restore();
}
