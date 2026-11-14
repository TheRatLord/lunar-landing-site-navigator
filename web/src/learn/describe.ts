import { wrap360 } from "../lib/scale";
import type { SkyState } from "./geometry";
import { whereText, type Site } from "./sites";
import { powerWord } from "./timeline";

const SECTORS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

export function compassWord(az: number): string {
  return SECTORS[Math.round(wrap360(az) / 45) % 8]!;
}

export function heightWord(elMinusHorizon: number): string {
  if (elMinusHorizon < -0.5) return "below the horizon";
  if (elMinusHorizon < 2) return "right on the horizon";
  if (elMinusHorizon < 20) return "low";
  if (elMinusHorizon < 60) return "halfway up the sky";
  return "high overhead";
}

function placeWord(az: number, elMinusHorizon: number): string {
  const h = heightWord(elMinusHorizon);
  const c = compassWord(az);
  if (h === "low") return `low in the ${c}`;
  if (h === "high overhead") return "high overhead";
  return `${h} to the ${c}`;
}

export function describe(site: Site, lat: number, day: number, sky: SkyState, battery: number | null): string {
  const parts = [`You are ${whereText(site, lat)}.`, `Day ${day}.`];
  const sunH = sky.sun.el - sky.sun.horizonEl;
  if (sky.sun.status === "eclipse") parts.push("Earth is passing in front of the Sun.");
  else if (sky.sun.status === "behindHill")
    parts.push(`The Sun is hidden behind ${site.id === "floor" ? "the crater wall" : "a hill"}.`);
  else if (sky.sun.status === "night") parts.push("It is night. The Sun is below the horizon.");
  else parts.push(`The Sun is ${placeWord(sky.sun.az, sunH)}.`);
  const earthH = sky.earth.el - sky.earth.horizonEl;
  if (sky.earth.visible) parts.push(`Earth is ${placeWord(sky.earth.az, earthH)}. You can call home.`);
  else if (sky.earth.el < -10) parts.push("Earth is below your feet, behind the Moon. No direct call.");
  else parts.push("Earth is hidden below the horizon. No direct call.");
  if (battery !== null) parts.push(`Battery: ${powerWord(battery).toLowerCase()}.`);
  return parts.join(" ");
}

export function describeShort(sky: SkyState): string {
  const s = sky.sun;
  if (s.status === "night") return "Night: the Sun is down";
  if (s.status === "behindHill") return "The Sun is hidden by the wall";
  if (s.status === "eclipse") return "Earth is blocking the Sun";
  const h = heightWord(s.el - s.horizonEl);
  if (h === "high overhead") return "Sun high overhead";
  if (h === "right on the horizon") return `Sun on the horizon, ${compassWord(s.az)}`;
  return `Sun ${h} in the ${compassWord(s.az)}`;
}
