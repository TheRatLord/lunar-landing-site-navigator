import { SITES, setPlanPlace, type Site, type SiteId } from "./sites";
import { useLearn } from "./store";
import { forgetTerrain } from "./terrain";

export interface PlanPlace {
  lat: number;
  lon: number;
  name: string;
  catalogId: string;
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
  return { lat, lon, name: (p.get("name") ?? "").slice(0, 80) || "Your plan site", catalogId: p.get("catalog") ?? "" };
}

export function visitPlanPlace(p: PlanPlace): void {
  const known = (Object.values(SITES) as Site[]).find(
    (s) => s.id !== "plan" && s.id !== "custom" && ((p.catalogId !== "" && s.catalogId === p.catalogId) || km(s, p) < 1),
  );
  if (known) {
    useLearn.getState().setSite(known.id);
    return;
  }
  setPlanPlace(p);
  forgetTerrain("plan");
  useLearn.setState((s) => ({ planPlace: true, terrainRev: s.terrainRev + 1 }));
  useLearn.getState().setSite("plan");
}

export function explorerHref(p: PlanPlace): string {
  const q = new URLSearchParams({ lat: String(p.lat), lon: String(p.lon), name: p.name });
  if (p.catalogId) q.set("catalog", p.catalogId);
  return `/learn?${q.toString()}`;
}

export function plannerHref(id: SiteId): string {
  const s = SITES[id];
  const q = new URLSearchParams({ site_lat: String(s.lat), site_lon: String(s.lon), site_name: s.name });
  if (s.catalogId) q.set("site_catalog", s.catalogId);
  return `/site?${q.toString()}`;
}
