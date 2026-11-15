import { requirementName } from "../../lib/requirements";
import type { ConstraintKey, ParameterKey } from "../types";

export interface NumSpec {
  field: string;
  label: string;
  unit?: string;
  min?: number;
  max?: number;
  exclusiveMin?: boolean;
  step?: number;
  nullable?: boolean;
  placeholder?: string;
}

export const PROFILE_HEIGHTS: NumSpec[] = [
  { field: "array_height_m", label: "Solar array height", unit: "m", min: 0, step: 0.1 },
  { field: "antenna_height_m", label: "Antenna height", unit: "m", min: 0, step: 0.1 },
  { field: "antenna_height_max_m", label: "Maximum antenna height", unit: "m", min: 0, step: 0.1, nullable: true },
];

export const PROFILE_BATTERY: NumSpec[] = [
  { field: "battery.capacity_wh", label: "Capacity", unit: "Wh", min: 0, exclusiveMin: true, step: 10 },
  { field: "battery.charge_efficiency", label: "Charge efficiency", min: 0, exclusiveMin: true, max: 1, step: 0.01 },
  { field: "battery.discharge_efficiency", label: "Discharge efficiency", min: 0, exclusiveMin: true, max: 1, step: 0.01 },
  { field: "battery.max_dod", label: "Maximum depth of discharge", min: 0, exclusiveMin: true, max: 1, step: 0.01 },
  { field: "battery.initial_soc", label: "Initial state of charge", min: 0, max: 1, step: 0.01 },
];

export const PROFILE_LOADS: NumSpec[] = [
  { field: "loads.sunlit_w", label: "Load, sunlit", unit: "W", min: 0, step: 1 },
  { field: "loads.dark_w", label: "Load, dark", unit: "W", min: 0, step: 1 },
];

export const PROFILE_ATTITUDE: NumSpec[] = [
  { field: "attitude.yaw_deg", label: "Heading", unit: "°", step: 1, nullable: true, placeholder: "Unknown" },
  { field: "attitude.yaw_uncertainty_deg", label: "Heading uncertainty", unit: "°", min: 0, max: 180, step: 1 },
  { field: "attitude.tilt_deg", label: "Tilt", unit: "°", min: 0, max: 180, step: 1 },
  { field: "attitude.tilt_az_deg", label: "Tilt azimuth", unit: "°", step: 1 },
];

export const PROFILE_LINK: NumSpec[] = [
  { field: "link.eirp_dbw", label: "EIRP", unit: "dBW", step: 0.5 },
  { field: "link.frequency_hz", label: "Frequency", unit: "Hz", min: 0, exclusiveMin: true, step: 1e6 },
  { field: "link.data_rate_bps", label: "Data rate", unit: "bit/s", min: 0, exclusiveMin: true, step: 1000 },
  { field: "link.required_ebn0_db", label: "Required Eb/N0", unit: "dB", step: 0.1 },
  { field: "link.implementation_loss_db", label: "Implementation loss", unit: "dB", step: 0.1 },
  { field: "link.required_margin_db", label: "Required margin", unit: "dB", step: 0.1 },
  { field: "link.default_g_over_t_dbk", label: "Default station G/T", unit: "dB/K", step: 0.1, nullable: true },
];

export const ELLIPSE_FIELDS: NumSpec[] = [
  { field: "semi_major_m", label: "Semi-major axis", unit: "m", min: 0, exclusiveMin: true, step: 10 },
  { field: "semi_minor_m", label: "Semi-minor axis", unit: "m", min: 0, exclusiveMin: true, step: 10 },
  { field: "azimuth_deg", label: "Major-axis azimuth", unit: "°", step: 1 },
  { field: "sigma_level", label: "Axes at", unit: "σ", min: 0, exclusiveMin: true, step: 0.5 },
];

export const TERRAIN_ERROR_FIELDS: NumSpec[] = [
  { field: "sigma_z_m", label: "Vertical error, 1σ", unit: "m", min: 0, step: 0.5 },
  { field: "sigma_xy_m", label: "Horizontal error, 1σ", unit: "m", min: 0, step: 1 },
];

export const ECLIPSE_FIELDS: NumSpec[] = [
  { field: "atmosphere_km", label: "Atmosphere allowance", unit: "km", min: 0, step: 1 },
];

export const STATION_FIELDS: NumSpec[] = [
  { field: "rx_mask_deg", label: "Receive mask", unit: "°", min: 0, max: 45, step: 0.5 },
  { field: "tx_mask_deg", label: "Transmit mask", unit: "°", min: 0, max: 45, step: 0.5 },
  { field: "g_over_t_dbk", label: "G/T", unit: "dB/K", step: 0.1, nullable: true, placeholder: "Default" },
];

export const PANEL_FIELDS: NumSpec[] = [
  { field: "area_m2", label: "Area", unit: "m²", min: 0, step: 0.1 },
  { field: "efficiency", label: "Efficiency", min: 0, max: 1, step: 0.01 },
];

export interface ConstraintMeta {
  key: ConstraintKey;
  title: string;
  short: string;
  unit: string;
  side: "min" | "max";
  decimals: number;
  start: number;
  what: string;
  needsTerrain?: boolean;
  scale?: number;
}

export const CONSTRAINT_META: ConstraintMeta[] = [
  { key: "min_total_sunlit_h", title: requirementName("min_total_sunlit_h"), short: requirementName("min_total_sunlit_h"), unit: "h", side: "min", decimals: 1, scale: 24, start: 168, what: "Total hours the solar array is sunlit during the stay. The hours need not be continuous." },
  { key: "min_total_contact_h", title: requirementName("min_total_contact_h"), short: requirementName("min_total_contact_h"), unit: "h", side: "min", decimals: 1, scale: 24, start: 168, what: "Total hours with an Earth link during the stay. When the plan has no ground stations, the Earth above the terrain horizon seen from the antenna counts as a link." },
  { key: "min_total_sunlit_contact_h", title: requirementName("min_total_sunlit_contact_h"), short: requirementName("min_total_sunlit_contact_h"), unit: "h", side: "min", decimals: 1, scale: 24, start: 168, what: "Total hours during the stay when the solar array is sunlit and there is an Earth link at the same time." },
  { key: "landing_sun_elevation_deg", title: requirementName("landing_sun_elevation_deg"), short: requirementName("landing_sun_elevation_deg"), unit: "°", side: "min", decimals: 1, start: 2, what: "Apparent Sun-centre elevation above the local horizontal at landing." },
  { key: "landing_hours_after_sunrise", title: requirementName("landing_hours_after_sunrise"), short: requirementName("landing_hours_after_sunrise"), unit: "h", side: "min", decimals: 1, start: 24, what: "Hours since the solar array last became sunlit before landing." },
  { key: "dte_at_landing_deg", title: requirementName("dte_at_landing_deg"), short: requirementName("dte_at_landing_deg"), unit: "°", side: "min", decimals: 1, start: 5, what: "Direct-to-Earth (DTE) clearance at landing: how far the direction to the best ground station is above the terrain horizon seen from the antenna, plus the antenna terrain margin. When the plan has no ground stations, the Earth's centre is used." },
  { key: "min_sunlit_hours_after_landing", title: requirementName("min_sunlit_hours_after_landing"), short: requirementName("min_sunlit_hours_after_landing"), unit: "h", side: "min", decimals: 1, start: 48, what: "Hours the solar array stays sunlit without a break from landing." },
  { key: "max_dark_span_h", title: requirementName("max_dark_span_h"), short: requirementName("max_dark_span_h"), unit: "h", side: "max", decimals: 1, start: 50, what: "Longest time the solar array is not sunlit during the stay." },
  { key: "min_state_of_charge", title: requirementName("min_state_of_charge"), short: requirementName("min_state_of_charge"), unit: "", side: "min", decimals: 2, start: 0.2, what: "Lowest battery state of charge during the stay, as a fraction of capacity." },
  { key: "min_contact_fraction", title: requirementName("min_contact_fraction"), short: requirementName("min_contact_fraction"), unit: "", side: "min", decimals: 2, start: 0.5, what: "Fraction of the stay with an Earth link." },
  { key: "max_contact_gap_h", title: requirementName("max_contact_gap_h"), short: requirementName("max_contact_gap_h"), unit: "h", side: "max", decimals: 1, start: 50, what: "Longest span with no Earth link." },
  { key: "min_link_margin_db", title: requirementName("min_link_margin_db"), short: requirementName("min_link_margin_db"), unit: "dB", side: "min", decimals: 1, start: 3, what: "Lowest downlink margin while there is an Earth link." },
  { key: "max_slope_deg", title: requirementName("max_slope_deg"), short: requirementName("max_slope_deg"), unit: "°", side: "max", decimals: 1, start: 15, what: "Terrain slope measured over the slope baseline. Needs terrain data.", needsTerrain: true },
];

export const PARAMETER_META: Array<{ key: ParameterKey; title: string; unit: string; min?: number; max?: number; step: number}> = [
  { key: "sunlit_flux_fraction", title: "Sunlit flux fraction", unit: "", min: 0, max: 1, step: 0.01 },
  { key: "antenna_terrain_margin_deg", title: "Antenna terrain margin", unit: "°", min: 0, step: 0.1 },
  { key: "slope_baseline_m", title: "Slope baseline", unit: "m", min: 0, step: 0.5 },
];
