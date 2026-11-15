import type { Place } from "./geometry";
import horizons from "./horizons.json";

export type SiteId = "apollo11" | "blueghost" | "rim" | "floor" | "change4" | "custom";

export interface Site extends Place {
  id: SiteId;
  catalogId: string;
  name: string;
  where: string;
}

type RealId = Exclude<SiteId, "custom">;

function realHorizon(id: RealId): (az: number) => number {
  const elev = horizons.sites[id];
  const n = horizons.n_az;
  return (az) => {
    const f = ((((az % 360) + 360) % 360) / 360) * n;
    const i = Math.floor(f) % n;
    const u = f - Math.floor(f);
    return elev[i]! * (1 - u) + elev[(i + 1) % n]! * u;
  };
}

export const SITES: Record<SiteId, Site> = {
  apollo11: {
    id: "apollo11",
    catalogId: "apollo-11",
    name: "Apollo 11",
    where: "at the Apollo 11 landing site, near the Moon's equator",
    lat: 0.67416,
    lon: 23.47314,
    horizon: realHorizon("apollo11"),
  },
  blueghost: {
    id: "blueghost",
    catalogId: "blue-ghost-m1",
    name: "Blue Ghost",
    where: "at Blue Ghost's landing site in the Sea of Crises",
    lat: 18.562,
    lon: 61.81,
    horizon: realHorizon("blueghost"),
  },
  rim: {
    id: "rim",
    catalogId: "poi-glaser-s",
    name: "Shackleton rim",
    where: "on Shackleton crater's rim, near the Moon's south pole",
    lat: -89.687,
    lon: -162.81,
    horizon: realHorizon("rim"),
  },
  floor: {
    id: "floor",
    catalogId: "gaz-shackleton",
    name: "Shackleton floor",
    where: "on the floor of Shackleton crater, at the Moon's south pole",
    lat: -89.67,
    lon: 129.78,
    horizon: realHorizon("floor"),
  },
  change4: {
    id: "change4",
    catalogId: "change-4",
    name: "Chang'e 4",
    where: "at Chang'e 4's landing site on the far side of the Moon",
    lat: -45.456,
    lon: 177.589,
    horizon: realHorizon("change4"),
  },
  custom: {
    id: "custom",
    catalogId: "",
    name: "Flat ground",
    where: "on flat ground",
    lat: 0,
    lon: 0,
    horizon: () => 0,
  },
};

export function walkWords(lat: number): string {
  const a = Math.abs(lat);
  if (a < 5) return "At the equator";
  if (a < 30) return "A little way toward the south pole";
  if (a < 60) return "Halfway to the south pole";
  if (a < 85) return "Near the south pole";
  return "At the south pole";
}

export function whereText(site: Site, lat: number): string {
  if (site.id !== "custom") return site.where;
  const a = Math.abs(lat);
  if (a < 5) return "on flat ground at the Moon's equator";
  if (a < 85) return `on flat ground, ${walkWords(lat).toLowerCase()}`;
  return "on flat ground at the Moon's south pole";
}
