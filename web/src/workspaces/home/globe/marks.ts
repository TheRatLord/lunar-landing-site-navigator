import { siteLabel } from "../../../lib/siteName";
import type { SiteEntry } from "../../../scenario/api";
import { placeLabels, type LabelBox } from "../../map/declutter";
import type { Rect } from "../../map/rect";
import { KIND_STYLE, type SiteKind } from "../../map/sites";
import { MOON_R_M } from "../../../lib/projection";
import { surfacePoint, type Marker, type MarkerShape } from "./MoonScene";

export const KIND_MARK: Record<SiteKind, { shape: MarkerShape; color: string; size: number; prio: number }> = {
  planned: { shape: "diamond", color: "#ffb340", size: 22, prio: 6 },
  landed: { shape: "triangle", color: "#4da3ff", size: 22, prio: 5 },
  impact: { shape: "cross", color: "#ff7a70", size: 19, prio: 4 },
  not_landed: { shape: "square", color: "#a3a7b0", size: 18, prio: 3 },
  region: { shape: "ring", color: "#b992ff", size: 20, prio: 2 },
  poi: { shape: "dot", color: "#e5e5ea", size: 13, prio: 1 },
};

export const PLAN_COLOR = "#ffffff";
export const PIN_COLOR = "#d08cff";
export const EARTH_COLOR = "#64d2ff";
export const PICK_COLOR = "#ffd60a";

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

export interface SiteGroup {
  members: number[];
  x: number;
  y: number;
}

export const CLUSTER_PX = 34;

const PLAN_CLEAR_PX = 15;
const SVG_NS = "http://www.w3.org/2000/svg";

function pinSize(n: number): { w: number; h: number; cy: number } {
  const w = n >= 1000 ? 42 : n >= 100 ? 36 : 30;
  return { w, h: Math.round(w * 1.3), cy: w / 2 };
}

function head(g: SiteGroup): { x: number; y: number; r: number } {
  const p = pinSize(g.members.length);
  return { x: g.x, y: g.y - p.h + p.cy, r: p.w / 2 };
}

function pinPath(w: number, h: number): string {
  const e = 1.5;
  const r = w / 2 - e;
  const cx = w / 2;
  const cy = w / 2;
  const tip = h - e;
  return `M${cx} ${tip}C${cx} ${tip} ${e} ${cy + r * 0.8} ${e} ${cy}A${r} ${r} 0 0 1 ${w - e} ${cy}C${w - e} ${cy + r * 0.8} ${cx} ${tip} ${cx} ${tip}Z`;
}

export function clusterSites(
  sites: readonly SiteEntry[],
  screenOf: (lat: number, lon: number) => [number, number] | null,
  w: number,
  h: number,
  avoid: [number, number] | null,
): { groups: SiteGroup[]; clustered: Set<number> } {
  const seeds: Array<{ x: number; y: number; members: number[]; sx: number; sy: number }> = [];
  for (let i = sites.length - 1; i >= 0; i--) {
    const s = sites[i]!;
    const at = screenOf(s.lat_deg, s.lon_deg);
    if (!at || at[0] < -CLUSTER_PX || at[1] < -CLUSTER_PX || at[0] > w + CLUSTER_PX || at[1] > h + CLUSTER_PX) continue;
    const near = seeds.find((g) => Math.hypot(g.x - at[0], g.y - at[1]) < CLUSTER_PX);
    if (near) {
      near.members.push(i);
      near.sx += at[0];
      near.sy += at[1];
    } else seeds.push({ x: at[0], y: at[1], members: [i], sx: at[0], sy: at[1] });
  }
  let groups: SiteGroup[] = seeds.filter((g) => g.members.length > 1).map((g) => ({ members: g.members, x: g.sx / g.members.length, y: g.sy / g.members.length }));
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let a = 0; a < groups.length; a++) {
      for (let b = a + 1; b < groups.length; b++) {
        const A = groups[a]!;
        const B = groups[b]!;
        const ha = head(A);
        const hb = head(B);
        if (Math.hypot(ha.x - hb.x, ha.y - hb.y) >= ha.r + hb.r + 3) continue;
        const n = A.members.length + B.members.length;
        groups[a] = { members: [...A.members, ...B.members], x: (A.x * A.members.length + B.x * B.members.length) / n, y: (A.y * A.members.length + B.y * B.members.length) / n };
        groups = groups.filter((_, i) => i !== b);
        merged = true;
        break outer;
      }
    }
  }
  if (avoid) {
    for (const g of groups) {
      const { w, h } = pinSize(g.members.length);
      const hit = avoid[0] > g.x - w / 2 - PLAN_CLEAR_PX && avoid[0] < g.x + w / 2 + PLAN_CLEAR_PX && avoid[1] > g.y - h - PLAN_CLEAR_PX && avoid[1] < g.y + PLAN_CLEAR_PX;
      if (hit) g.x = g.x >= avoid[0] ? avoid[0] + PLAN_CLEAR_PX + w / 2 : avoid[0] - PLAN_CLEAR_PX - w / 2;
    }
  }
  const clustered = new Set<number>();
  for (const g of groups) for (const i of g.members) clustered.add(i);
  return { groups, clustered };
}

export function clusterRect(g: SiteGroup): Rect {
  const { w, h } = pinSize(g.members.length);
  return [g.x - w / 2, g.y - h, g.x + w / 2, g.y];
}

function newPin(): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "globe-cluster";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.appendChild(document.createElementNS(SVG_NS, "path"));
  const count = document.createElement("span");
  count.className = "globe-cluster-count";
  el.append(svg, count);
  return el;
}

export function layoutClusters(host: HTMLElement, groups: readonly SiteGroup[], sites: readonly SiteEntry[]): void {
  while (host.childElementCount < groups.length) host.appendChild(newPin());
  groups.forEach((g, i) => {
    const el = host.children[i] as HTMLButtonElement;
    const n = g.members.length;
    const { w, h, cy } = pinSize(n);
    const count = el.lastElementChild as HTMLElement;
    if (count.textContent !== String(n)) count.textContent = String(n);
    if (el.dataset["w"] !== String(w)) {
      el.dataset["w"] = String(w);
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      const svg = el.firstElementChild as SVGSVGElement;
      svg.setAttribute("width", String(w));
      svg.setAttribute("height", String(h));
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      svg.firstElementChild!.setAttribute("d", pinPath(w, h));
      count.style.top = `${cy}px`;
      count.style.fontSize = n >= 1000 ? "11px" : "12px";
    }
    const lead = sites[g.members[0]!]!;
    const names = g.members.slice(0, 4).map((m) => siteLabel(sites[m]!.name));
    const label = `${n} sites: ${names.join(", ")}${n > 4 ? ", …" : ""}`;
    if (el.title !== label) {
      el.title = label;
      el.setAttribute("aria-label", label);
    }
    el.dataset["index"] = String(i);
    el.style.display = "";
    el.style.setProperty("--tone", KIND_MARK[lead.kind].color);
    el.style.transform = `translate(${Math.round(g.x - w / 2)}px, ${Math.round(g.y - h)}px)`;
  });
  for (let i = groups.length; i < host.childElementCount; i++) (host.children[i] as HTMLElement).style.display = "none";
}

export function spreadOf(sites: ReadonlyArray<{ lat_deg: number; lon_deg: number }>): { lat_deg: number; lon_deg: number; radius_m: number } {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const s of sites) {
    const p = surfacePoint(s.lat_deg, s.lon_deg);
    x += p[0];
    y += p[1];
    z += p[2];
  }
  const n = Math.hypot(x, y, z) || 1;
  const c: [number, number, number] = [x / n, y / n, z / n];
  let far = 0;
  for (const s of sites) {
    const p = surfacePoint(s.lat_deg, s.lon_deg);
    far = Math.max(far, Math.acos(Math.min(1, p[0] * c[0] + p[1] * c[1] + p[2] * c[2])));
  }
  return { lat_deg: (Math.asin(Math.max(-1, Math.min(1, c[1]))) * 180) / Math.PI, lon_deg: (Math.atan2(-c[2], c[0]) * 180) / Math.PI, radius_m: far * MOON_R_M };
}
