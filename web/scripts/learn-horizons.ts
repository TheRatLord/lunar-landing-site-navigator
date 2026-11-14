import { writeFileSync } from "node:fs";
import { SITES, type SiteId } from "../src/learn/sites";

const BASE = process.argv[2] ?? "http://127.0.0.1:8000";
const OUT = new URL("../src/learn/horizons.json", import.meta.url).pathname;
const N_AZ = 720;
const EYE_M = 1.7;

interface HorizonResult {
  provider: string;
  az_deg: number[];
  elev_deg: number[];
}

const sites: Partial<Record<SiteId, number[]>> = {};
for (const site of Object.values(SITES)) {
  if (site.id === "custom") continue;
  const res = await fetch(new URL("/api/v1/horizon", BASE), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lat_deg: site.lat, lon_deg: site.lon, height_m: EYE_M, n_az: N_AZ, wait_s: 30 }),
  });
  if (res.status !== 200) throw new Error(`${site.id}: /horizon answered ${res.status}`);
  const h = (await res.json()) as HorizonResult;
  if (h.provider !== "terrain") throw new Error(`${site.id}: no terrain coverage (provider ${h.provider})`);
  if (h.elev_deg.length !== N_AZ || Math.abs(h.az_deg[1]! - 360 / N_AZ) > 1e-9) throw new Error(`${site.id}: unexpected azimuth grid`);
  sites[site.id] = h.elev_deg.map((e) => Math.round(e * 100) / 100);
  console.log(`${site.id}: ${Math.min(...h.elev_deg).toFixed(2)}° .. ${Math.max(...h.elev_deg).toFixed(2)}°`);
}
writeFileSync(OUT, JSON.stringify({ n_az: N_AZ, eye_m: EYE_M, sites }) + "\n");
console.log(`wrote ${OUT}`);
