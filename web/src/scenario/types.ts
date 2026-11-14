import type { components } from "../api/generated/schema";

type S = components["schemas"];

export type Scenario = S["Scenario"];
export type LanderProfile = S["LanderProfile"];
export type PanelSpec = S["PanelSpec"];
export type Constraints = S["Constraints"];
export type Limit = S["Limit"];
export type Origin = S["Origin"];
export type Basis = Origin["basis"];
export type Network = S["Network"];
export type NetworkStation = S["NetworkStation"];
export type Transfer = S["Transfer"];
export type TransferRow = S["TransferRow"];
export type Ellipse = S["Ellipse"];

export const CONSTRAINT_KEYS = [
  "landing_sun_elevation_deg",
  "landing_hours_after_sunrise",
  "dte_at_landing_deg",
  "min_sunlit_hours_after_landing",
  "max_dark_span_h",
  "min_state_of_charge",
  "min_contact_fraction",
  "max_contact_gap_h",
  "min_link_margin_db",
  "max_slope_deg",
] as const;
export type ConstraintKey = (typeof CONSTRAINT_KEYS)[number];

export type ParameterKey = "sunlit_flux_fraction" | "antenna_terrain_margin_deg" | "slope_baseline_m";

export type ScenarioRecord = S["ScenarioRecord"];
export type ScenarioSummary = S["ScenarioSummary"];
export type RevisionInfo = S["RevisionInfo"];

export const BASIS_LABEL: Record<Basis, string> = {
  published: "Published",
  derived: "Derived",
  estimate: "Estimate",
  convention: "Convention",
  historical: "Historical",
  "mission-specific": "Mission-specific",
  user: "Your input",
  default: "Engine default",
  unknown: "Unknown",
  "model-typed": "Typed by the assistant, not confirmed",
};

export const UNPUBLISHED_BASES: ReadonlySet<Basis> = new Set<Basis>(["estimate", "derived", "convention"]);
