import { wrap180 } from "../lib/scale";
import type { Place } from "./geometry";

export type SiteId = "apollo11" | "blueghost" | "rim" | "floor" | "change4" | "custom";

export interface Site extends Place {
  id: SiteId;
  catalogId: string;
  name: string;
  short: string;
  where: string;
  blurb: string;
}

const g = (x: number, w: number): number => Math.exp(-0.5 * (wrap180(x) / w) ** 2);

export const SITES: Record<SiteId, Site> = {
  apollo11: {
    id: "apollo11",
    catalogId: "apollo-11",
    name: "Apollo 11",
    short: "Near the equator",
    where: "at the Apollo 11 landing site, near the Moon's equator",
    blurb: "Where people first walked on the Moon, in 1969.",
    lat: 0.67416,
    lon: 23.47314,
    horizon: () => 0,
  },
  blueghost: {
    id: "blueghost",
    catalogId: "blue-ghost-m1",
    name: "Blue Ghost",
    short: "Sea of Crises",
    where: "at Blue Ghost's landing site in the Sea of Crises",
    blurb: "A robot lander that worked for two weeks in 2025.",
    lat: 18.562,
    lon: 61.81,
    horizon: () => 0,
  },
  rim: {
    id: "rim",
    catalogId: "poi-glaser-s",
    name: "Shackleton rim",
    short: "South pole, crater edge",
    where: "on Shackleton crater's rim, near the Moon's south pole",
    blurb: "A high crater edge where the Sun almost never sets.",
    lat: -89.687,
    lon: -162.81,
    horizon: (az) => -1.5 + 2.2 * g(az - 300, 12),
  },
  floor: {
    id: "floor",
    catalogId: "gaz-shackleton",
    name: "Shackleton floor",
    short: "South pole, inside the crater",
    where: "on the floor of Shackleton crater, at the Moon's south pole",
    blurb: "A deep crater floor that has been dark for billions of years.",
    lat: -89.67,
    lon: 129.78,
    horizon: (az) => 20 + 2 * Math.sin((3 * az * Math.PI) / 180),
  },
  change4: {
    id: "change4",
    catalogId: "change-4",
    name: "Chang'e 4",
    short: "Far side",
    where: "at Chang'e 4's landing site on the far side of the Moon",
    blurb: "The first landing on the far side, in 2019.",
    lat: -45.456,
    lon: 177.589,
    horizon: () => 0.3,
  },
  custom: {
    id: "custom",
    catalogId: "",
    name: "Flat ground",
    short: "Walking south",
    where: "on flat ground",
    blurb: "A pretend flat spot, so only the tilt matters.",
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
