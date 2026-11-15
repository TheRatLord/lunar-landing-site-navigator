import { chapterOf, useLearn } from "./store";
import { setExploreYear } from "./chapters";
import { dayOfIso } from "./geometry";
import { SITES, setPlanPlace, type Site, type SiteId } from "./sites";
import { forgetTerrain } from "./terrain";

export interface PlanPlace {
  lat: number;
  lon: number;
  name: string;
  catalogId: string;
  utc: string | null;
}

const MOON_KM = 1737.4;

function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const s = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * MOON_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function placeFromParams(p: URLSearchParams): PlanPlace | null {
  const lat = Number(p.get("lat"));
  const lon = Number(p.get("lon"));
  if (!p.has("lat") || !p.has("lon") || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) return null;
  const at = p.get("at");
  const utc = at !== null && Number.isFinite(Date.parse(at)) ? at : null;
  return { lat, lon, name: (p.get("name") ?? "").slice(0, 80) || "Your plan site", catalogId: p.get("catalog") ?? "", utc };
}

function landOn(utc: string | null): void {
  if (utc === null) return;
  setExploreYear(new Date(utc).getUTCFullYear());
  const c = chapterOf("explore");
  const t = Math.min(c.spanDays, Math.max(0, dayOfIso(utc) - c.epochD));
  useLearn.setState((s) => ({ t, terrainRev: s.terrainRev + 1 }));
}

export function visitPlanPlace(p: PlanPlace): void {
  const known = (Object.values(SITES) as Site[]).find(
    (s) => s.id !== "plan" && s.id !== "custom" && ((p.catalogId !== "" && s.catalogId === p.catalogId) || km(s, p) < 1),
  );
  if (known) {
    useLearn.getState().setSite(known.id);
    landOn(p.utc);
    return;
  }
  setPlanPlace(p);
  forgetTerrain("plan");
  useLearn.setState((s) => ({ planPlace: true, terrainRev: s.terrainRev + 1 }));
  useLearn.getState().setSite("plan");
  landOn(p.utc);
}

export function explorerHref(p: PlanPlace): string {
  const q = new URLSearchParams({ lat: String(p.lat), lon: String(p.lon), name: p.name });
  if (p.catalogId) q.set("catalog", p.catalogId);
  if (p.utc) q.set("at", p.utc);
  return `/learn?${q.toString()}`;
}

export function plannerHref(id: SiteId): string {
  const s = SITES[id];
  const q = new URLSearchParams({ site_lat: String(s.lat), site_lon: String(s.lon), site_name: s.name });
  if (s.catalogId) q.set("site_catalog", s.catalogId);
  return `/site?${q.toString()}`;
}
