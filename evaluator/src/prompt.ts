import { readFileSync } from "node:fs";
import path from "node:path";

export function loadPrompt(name: "review-board" | "baseline"): string {
  return readFileSync(path.join(import.meta.dirname, "..", "prompts", `${name}.md`), "utf8");
}

export function requestText(input: { lat: number; lon: number; landingUtc: string; landerId: string; launchVehicleId: string; missionHours: number }): string {
  return (
    `Review this candidate landing: site lat ${input.lat} deg, lon ${input.lon} deg; landing ${input.landingUtc}; ` +
    `lander ${input.landerId}; launch vehicle ${input.launchVehicleId}; surface mission ${input.missionHours} hours.`
  );
}
