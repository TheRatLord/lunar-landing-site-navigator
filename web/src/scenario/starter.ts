import { MS_HOUR, toIsoUtc } from "../lib/time";
import type { Candidate } from "./alternatives";
import { catalogApi } from "./api";
import { buildScenario } from "./editor/newScenario";
import { loadPresets } from "./editor/usePresets";
import type { Constraints, Scenario } from "./types";

export const FEATURED_SITES = [
  { id: "poi-glaser-c1", name: "Shackleton connecting ridge", note: "Near-permanent sunlight, 89.4°S" },
  { id: "artemis-region-mons-mouton", name: "Mons Mouton", note: "Artemis candidate region, 85.4°S" },
  { id: "poi-derosa-mp1", name: "Malapert peak", note: "Long Earth link, 86.0°S" },
  { id: "artemis-region-de-gerlache-rim-2", name: "de Gerlache rim", note: "Artemis candidate region, 88.2°S" },
  { id: "griffin-1-nobile", name: "Nobile crater", note: "Griffin Mission One target, 85.3°S" },
  { id: "im-2-athena", name: "IM-2 Athena", note: "Landed March 2025, 84.8°S" },
  { id: "chandrayaan-3-vikram", name: "Chandrayaan-3 Vikram", note: "Landed August 2023, 69.4°S" },
  { id: "apollo-11", name: "Apollo 11", note: "Equatorial, for contrast" },
] as const;

const SITE = FEATURED_SITES[0];
const LANDING_UTC = "2027-01-12T00:00:00Z";
const PROFILE_ID = "nova-c-polar";
const CONSTRAINTS = "viper-polar";
const NETWORK_ID = "dsn-all";
const SURFACE_HOURS = 336;
const SUN_AND_EARTH_MIN_H = 168;

const COMPARED = [FEATURED_SITES[2], FEATURED_SITES[5]];

export const DEMO_NAME = "Demo plan";

export async function starterAlternatives(): Promise<Candidate[]> {
  const sites = await Promise.all(COMPARED.map((f) => catalogApi.site(f.id)));
  return sites.map((s, i) => ({ id: s.id, name: COMPARED[i]!.name, lat_deg: s.lat_deg, lon_deg: s.lon_deg, catalog_id: s.id }));
}

export async function starterScenario(): Promise<Scenario> {
  const [site, presets] = await Promise.all([catalogApi.site(SITE.id), loadPresets()]);
  const profile = presets.profiles.find((p) => p.id === PROFILE_ID) ?? presets.profiles[0];
  if (!profile) throw new Error("The engine offers no lander presets.");
  const preset = presets.constraints.find((c) => c.name === CONSTRAINTS)?.constraints;
  const constraints: Constraints | undefined = preset && {
    ...preset,
    min_total_sunlit_contact_h: { min: SUN_AND_EARTH_MIN_H, max: null, unit: "h", label: "Sunlight and Earth link together", origin: { basis: "user", label: "", source_url: null, note: "" }, margin_scale: 24 },
  };
  return buildScenario({
    name: DEMO_NAME,
    site: { ...site, name: SITE.name },
    landing_utc: LANDING_UTC,
    mission_duration_h: SURFACE_HOURS,
    profile: profile.profile,
    constraints,
    network: presets.networks.find((n) => n.id === NETWORK_ID)?.network,
  });
}

export async function blankScenario(): Promise<Scenario> {
  const presets = await loadPresets();
  const profile = presets.profiles[0];
  if (!profile) throw new Error("The engine offers no lander presets.");
  const doc = buildScenario({
    name: "",
    site: { id: "", name: "", lat_deg: -90, lon_deg: 0 },
    landing_utc: toIsoUtc(Math.ceil(Date.now() / MS_HOUR) * MS_HOUR),
    mission_duration_h: SURFACE_HOURS,
    profile: profile.profile,
  });
  return { ...doc, site: { ...doc.site, catalog_id: null } };
}
