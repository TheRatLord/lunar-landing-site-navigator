import type { SiteEntry } from "../api";
import { schemaDefaults } from "../normalize";
import type { Constraints, LanderProfile, Network, Scenario } from "../types";

interface NewScenarioInput {
  name: string;
  site: Pick<SiteEntry, "id" | "name" | "lat_deg" | "lon_deg">;
  landing_utc: string;
  mission_duration_h: number;
  profile: LanderProfile;
  constraints?: Constraints;
  network?: Network;
}

export function buildScenario(input: NewScenarioInput): Scenario {
  return {
    ...(schemaDefaults("Scenario") as Partial<Scenario>),
    name: input.name,
    site: { lat_deg: input.site.lat_deg, lon_deg: input.site.lon_deg, name: input.site.name, catalog_id: input.site.id },
    landing_utc: input.landing_utc,
    mission_duration_h: input.mission_duration_h,
    profile: input.profile,
    ...(input.constraints ? { constraints: input.constraints } : {}),
    ...(input.network ? { network: input.network } : {}),
  } as Scenario;
}
