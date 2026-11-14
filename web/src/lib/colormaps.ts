import { clamp } from "./scale";

export type Colormap = (t: number) => string;

type RGB = [number, number, number];

const hex = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

function makeMap(stops: string[]): Colormap {
  const rgb = stops.map(hex);
  return (t) => {
    if (Number.isNaN(t)) return "rgba(0,0,0,0)";
    const f = clamp(t, 0, 1) * (rgb.length - 1);
    const i = Math.min(rgb.length - 2, Math.floor(f));
    const u = f - i;
    const a = rgb[i]!;
    const b = rgb[i + 1]!;
    return `rgb(${a.map((v, k) => Math.round(v + (b[k]! - v) * u)).join(",")})`;
  };
}

const VIRIDIS = ["#440154", "#472d7b", "#3b528b", "#2c728e", "#21918c", "#28ae80", "#5ec962", "#addc30", "#fde725"];
const CIVIDIS = [
  "#00224e",
  "#123570",
  "#3b496c",
  "#575d6d",
  "#707173",
  "#8a8678",
  "#a59c74",
  "#c3b369",
  "#e1cc55",
  "#fee838",
];
const PUOR = [
  "#b35806",
  "#e08214",
  "#fdb863",
  "#fee0b6",
  "#f7f7f7",
  "#d8daeb",
  "#b2abd2",
  "#8073ac",
  "#542788",
];

export const viridis: Colormap = makeMap(VIRIDIS);
export const cividis: Colormap = makeMap(CIVIDIS);
export const diverging: Colormap = makeMap(PUOR);

export function cssGradient(cm: Colormap, n: number): string {
  return `linear-gradient(90deg, ${Array.from({ length: n }, (_, i) => cm(i / (n - 1))).join(", ")})`;
}
