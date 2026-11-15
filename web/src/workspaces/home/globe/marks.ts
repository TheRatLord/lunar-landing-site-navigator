import { siteLabel } from "../../../lib/siteName";
import type { SiteEntry } from "../../../scenario/api";
import { placeLabels, type LabelBox } from "../../map/declutter";
import type { Rect } from "../../map/rect";
import { KIND_STYLE, type SiteKind } from "../../map/sites";
import type { Marker, MarkerShape } from "./MoonScene";

export const KIND_MARK: Record<SiteKind, { shape: MarkerShape; color: string; size: number; prio: number }> = {
  planned: { shape: "diamond", color: "#ffb340", size: 16, prio: 6 },
  landed: { shape: "triangle", color: "#4da3ff", size: 16, prio: 5 },
  impact: { shape: "cross", color: "#ff7a70", size: 14, prio: 4 },
  not_landed: { shape: "square", color: "#a3a7b0", size: 13, prio: 3 },
  region: { shape: "ring", color: "#b992ff", size: 15, prio: 2 },
  poi: { shape: "dot", color: "#e5e5ea", size: 9, prio: 1 },
};

export const PLAN_COLOR = "#ffffff";
export const PIN_COLOR = "#d08cff";
export const EARTH_COLOR = "#64d2ff";

export function bySalience(sites: readonly SiteEntry[]): SiteEntry[] {
  return [...sites].sort((a, b) => KIND_MARK[a.kind].prio - KIND_MARK[b.kind].prio);
}

export function siteMarkers(sites: readonly SiteEntry[]): Marker[] {
  return sites.map((s) => {
    const k = KIND_MARK[s.kind];
    return { lat_deg: s.lat_deg, lon_deg: s.lon_deg, color: k.color, size: k.size, shape: k.shape };
  });
}

function year(s: SiteEntry): string | null {
  const d = [s.landing_date, s.landing_utc, s.planned_date].find((v): v is string => typeof v === "string" && /^\d{4}/.test(v));
  return d ? d.slice(0, 4) : null;
}

export function siteSummary(s: SiteEntry): string {
  const y = year(s);
  return [KIND_STYLE[s.kind].label, y].filter(Boolean).join(" · ");
}

export function siteLines(s: SiteEntry): string[] {
  const out = [siteSummary(s)];
  const who = [s.mission, s.operator].filter((v): v is string => typeof v === "string" && v.trim() !== "" && v !== s.name);
  if (who.length) out.push(who.join(" · "));
  return out;
}

const MAX_CHARS = 26;
const short = (t: string): string => (t.length > MAX_CHARS ? `${t.slice(0, MAX_CHARS - 1).trimEnd()}…` : t);

export interface LabelCand {
  id: string;
  text: string;
  lat_deg: number;
  lon_deg: number;
  r: number;
  prio: number;
  must: boolean;
  tone: string;
}

let measureCtx: CanvasRenderingContext2D | null = null;
const widths = new Map<string, number>();

function textWidth(text: string, plan: boolean): number {
  const key = `${plan ? 1 : 0}${text}`;
  const hit = widths.get(key);
  if (hit !== undefined) return hit;
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * 6.5;
  measureCtx.font = `600 ${plan ? 12 : 11}px "Inter Variable", Inter, system-ui, sans-serif`;
  const w = Math.ceil(measureCtx.measureText(text).width);
  widths.set(key, w);
  return w;
}

export function labelCandidates(sites: readonly SiteEntry[], pins: ReadonlyArray<{ id: string; name: string; lat_deg: number; lon_deg: number }>, plan: { lat_deg: number; lon_deg: number; name: string }): LabelCand[] {
  const out: LabelCand[] = [{ id: "plan", text: siteLabel(plan.name) || "Plan site", lat_deg: plan.lat_deg, lon_deg: plan.lon_deg, r: 11, prio: 100, must: true, tone: "plan" }];
  for (const p of pins) out.push({ id: `pin:${p.id}`, text: short(siteLabel(p.name)), lat_deg: p.lat_deg, lon_deg: p.lon_deg, r: 8, prio: 50, must: false, tone: "pin" });
  for (const s of sites) {
    const k = KIND_MARK[s.kind];
    if (Math.abs(s.lat_deg - plan.lat_deg) < 1e-4 && Math.abs(s.lon_deg - plan.lon_deg) < 1e-4) continue;
    out.push({ id: `site:${s.id}`, text: short(siteLabel(s.name)), lat_deg: s.lat_deg, lon_deg: s.lon_deg, r: k.size / 2, prio: k.prio * 2, must: false, tone: s.kind });
  }
  return out.sort((a, b) => b.prio - a.prio);
}

export function layoutLabels(
  host: HTMLElement,
  cands: readonly LabelCand[],
  screenOf: (lat: number, lon: number) => [number, number] | null,
  obstacles: readonly Rect[],
  w: number,
  h: number,
): void {
  const seen = new Map<string, LabelCand>();
  const boxes: LabelBox[] = [];
  for (const c of cands) {
    const s = screenOf(c.lat_deg, c.lon_deg);
    if (!s || s[0] < -20 || s[1] < -20 || s[0] > w + 20 || s[1] > h + 20) continue;
    seen.set(c.id, c);
    boxes.push({ id: c.id, x: s[0], y: s[1], r: c.r, w: textWidth(c.text, c.tone === "plan"), must: c.must });
  }
  const { spots } = placeLabels(boxes, obstacles, w, h, 11);
  while (host.childElementCount < spots.length) {
    const el = document.createElement("span");
    el.className = "globe-mark-label";
    host.appendChild(el);
  }
  spots.forEach((spot, i) => {
    const el = host.children[i] as HTMLElement;
    const c = seen.get(spot.id)!;
    if (el.textContent !== c.text) el.textContent = c.text;
    el.dataset["tone"] = c.tone;
    el.style.display = "";
    const shift = spot.align === "left" ? "0" : spot.align === "right" ? "-100%" : "-50%";
    el.style.transform = `translate(${Math.round(spot.x)}px, ${Math.round(spot.y - 12)}px) translateX(${shift})`;
  });
  for (let i = spots.length; i < host.childElementCount; i++) (host.children[i] as HTMLElement).style.display = "none";
}
