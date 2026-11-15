import { SANS } from "../../components/viz/draw";
import type { Shape } from "./sites";
import type { ScaleBar } from "./scaleBar";
import { clamp } from "../../lib/scale";

export const PALETTE_TOKENS = {
  bg: "bg",
  bgRaised: "bg-raised",
  panel: "panel",
  text: "text",
  text2: "text-2",
  text3: "text-3",
  borderStrong: "border-strong",
  accent: "accent",
  accentText: "accent-text",
  accentBg: "accent-bg",
  focus: "focus",
  grid: "grid",
  gridStrong: "grid-strong",
  pass: "c-pass",
  fail: "c-fail",
  marginal: "c-marginal",
  network: "c-network",
  dim: "map-dim",
  vignette: "map-vignette",
};

export type Palette = Record<keyof typeof PALETTE_TOKENS, string>;

export const LABEL_FONT = `500 11px ${SANS}`;
export const NAME_FONT = `11px ${SANS}`;
export const NAME_FONT_STRONG = `600 11px ${SANS}`;
export const BADGE_FONT = `600 10px ${SANS}`;
export const PIN_FONT = `700 10px ${SANS}`;
export const CLUSTER_R = 10;
export const BADGE_R = 7;

function shapePath(ctx: CanvasRenderingContext2D, shape: Shape, x: number, y: number, r: number): void {
  ctx.beginPath();
  switch (shape) {
    case "triangle":
      ctx.moveTo(x, y - r * 1.15);
      ctx.lineTo(x + r * 1.05, y + r * 0.8);
      ctx.lineTo(x - r * 1.05, y + r * 0.8);
      ctx.closePath();
      break;
    case "diamond":
      ctx.moveTo(x, y - r * 1.2);
      ctx.lineTo(x + r * 1.2, y);
      ctx.lineTo(x, y + r * 1.2);
      ctx.lineTo(x - r * 1.2, y);
      ctx.closePath();
      break;
    case "square":
      ctx.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
      break;
    case "cross":
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r);
      ctx.lineTo(x - r, y + r);
      break;
    case "ring":
      ctx.arc(x, y, r * 1.1, 0, Math.PI * 2);
      break;
    case "dot":
      ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
      break;
  }
}

export function drawMarker(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  x: number,
  y: number,
  r: number,
  color: string,
  halo: string,
  filled: boolean,
): void {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  shapePath(ctx, shape, x, y, r);
  ctx.strokeStyle = halo;
  ctx.lineWidth = shape === "cross" ? 4.6 : 3.6;
  ctx.globalAlpha = 0.85;
  ctx.stroke();
  ctx.globalAlpha = 1;
  if (filled && shape !== "cross" && shape !== "ring") {
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = shape === "cross" ? 2.2 : 1.6;
  ctx.stroke();
}

export function drawCluster(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, count: number, ring: string, p: Palette): void {
  const text = `+${count}`;
  ctx.font = `600 ${r > 8 ? 10 : 9}px ${SANS}`;
  const half = Math.max(r, ctx.measureText(text).width / 2 + 5);
  ctx.beginPath();
  ctx.roundRect(x - half, y - r * 0.8, half * 2, r * 1.6, r * 0.8);
  ctx.strokeStyle = p.bg;
  ctx.lineWidth = 4.6;
  ctx.globalAlpha = 0.85;
  ctx.stroke();
  ctx.globalAlpha = 0.94;
  ctx.fillStyle = p.bg;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = ring;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.fillStyle = p.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 0.5);
}

export function clipName(name: string, max: number): string {
  if (name.length <= max) return name;
  const cut = name.slice(0, max - 1);
  const space = cut.search(/\s\S*$/);
  return `${space > max / 2 ? cut.slice(0, space) : cut}…`;
}

function lightness(c: string): number {
  const hex = /^#([0-9a-f]{6})/i.exec(c.trim());
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114;
  }
  const rgb = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c);
  return rgb ? Number(rgb[1]) * 0.299 + Number(rgb[2]) * 0.587 + Number(rgb[3]) * 0.114 : 0;
}

export function haloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fill: string,
  halo: string,
  align: CanvasTextAlign = "left",
  baseline: CanvasTextBaseline = "alphabetic",
): void {
  if (lightness(fill) > lightness(halo)) [fill, halo] = [halo, fill];
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.lineJoin = "round";
  ctx.lineWidth = 2.8;
  ctx.strokeStyle = halo;
  ctx.globalAlpha = 0.9;
  ctx.strokeText(text, x, y);
  ctx.globalAlpha = 1;
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

export function plateText(ctx: CanvasRenderingContext2D, lines: string[], x: number, y: number, p: Palette, w: number, h: number, accent: string, avoid?: readonly [number, number, number, number]): void {
  ctx.font = LABEL_FONT;
  const lh = 13;
  const tw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 12;
  const th = lines.length * lh + 6;
  const bx = clamp(x - tw / 2, 4, w - tw - 4);
  let by = clamp(y - th / 2, 4, h - th - 4);
  if (avoid && bx < avoid[2] && bx + tw > avoid[0] && by < avoid[3] && by + th > avoid[1]) by = Math.min(avoid[3] + 4, h - th - 4);
  ctx.fillStyle = p.panel;
  ctx.globalAlpha = 0.94;
  ctx.beginPath();
  ctx.roundRect(bx, by, tw, th, 7);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(bx + 0.5, by + 0.5, tw - 1, th - 1, 6.5);
  ctx.stroke();
  ctx.fillStyle = p.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  lines.forEach((l, i) => ctx.fillText(l, bx + 6, by + 3 + lh * (i + 0.5)));
}

export function drawScaleBar(ctx: CanvasRenderingContext2D, bar: ScaleBar, x: number, y: number, caption: string, p: Palette): void {
  ctx.font = LABEL_FONT;
  const captionW = ctx.measureText(caption).width;
  const plateW = Math.max(bar.px, captionW) + 16;
  ctx.fillStyle = p.panel;
  ctx.globalAlpha = 0.86;
  ctx.beginPath();
  ctx.roundRect(x - 10, y - 34, plateW + 8, 44, 12);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = p.text;
  ctx.fillStyle = p.text;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y - 14);
  ctx.lineTo(x, y - 8);
  ctx.lineTo(x + bar.px, y - 8);
  ctx.lineTo(x + bar.px, y - 14);
  ctx.moveTo(x + bar.px / 2, y - 8);
  ctx.lineTo(x + bar.px / 2, y - 11);
  ctx.stroke();
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillText("0", x, y - 18);
  ctx.textAlign = "right";
  ctx.fillText(bar.label, x + bar.px, y - 18);
  ctx.fillStyle = p.text2;
  ctx.textAlign = "left";
  ctx.fillText(caption, x, y + 2);
}

export function drawNorthArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, nx: number, ny: number, p: Palette): void {
  const r = 19;
  ctx.fillStyle = p.panel;
  ctx.globalAlpha = 0.86;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = p.borderStrong;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = p.accent;
  ctx.beginPath();
  ctx.moveTo(cx + nx * r, cy + ny * r);
  ctx.lineTo(cx - ny * 5 - nx * 4, cy + nx * 5 - ny * 4);
  ctx.lineTo(cx + ny * 5 - nx * 4, cy - nx * 5 - ny * 4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = p.text2;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx - nx * 4, cy - ny * 4);
  ctx.lineTo(cx - nx * (r - 4), cy - ny * (r - 4));
  ctx.stroke();
  ctx.fillStyle = p.text;
  ctx.font = `600 10px ${SANS}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("N", cx + nx * (r + 12), cy + ny * (r + 12));
}
