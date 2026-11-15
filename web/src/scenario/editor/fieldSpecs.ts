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
  { field: "array_height_m", label: "Solar-array height", unit: "m", min: 0, step: 0.1 },
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
  { field: "attitude.yaw_deg", label: "Yaw", unit: "°", step: 1, nullable: true, placeholder: "Unknown" },
  { field: "attitude.yaw_uncertainty_deg", label: "Yaw uncertainty", unit: "°", min: 0, max: 180, step: 1 },
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
  { key: "min_total_sunlit_h", title: "Sunlight during the stay", short: "Sunlight", unit: "h", side: "min", decimals: 1, scale: 24, start: 168, what: "Total hours the solar array is sunlit during the surface mission. The hours need not be continuous." },
  { key: "min_total_contact_h", title: "Earth link during the stay", short: "Earth link", unit: "h", side: "min", decimals: 1, scale: 24, start: 168, what: "Total hours with a direct link to Earth during the surface mission: a ground station in contact, or Earth above the antenna horizon when the plan has no ground stations." },
  { key: "min_total_sunlit_contact_h", title: "Sunlight and Earth link together", short: "Sun and Earth", unit: "h", side: "min", decimals: 1, scale: 24, start: 168, what: "Total hours during the surface mission that are sunlit with an Earth link at the same time." },
  { key: "landing_sun_elevation_deg", title: "Sun elevation at landing", short: "Sun elevation", unit: "°", side: "min", decimals: 1, start: 2, what: "Apparent Sun-centre elevation above the local horizontal at landing." },
  { key: "landing_hours_after_sunrise", title: "Time after local sunrise at landing", short: "After sunrise", unit: "h", side: "min", decimals: 1, start: 24, what: "Hours since the array last rose above the sunlit flux fraction." },
  { key: "dte_at_landing_deg", title: "Earth elevation at landing", short: "Earth elevation", unit: "°", side: "min", decimals: 1, start: 5, what: "Direct-to-Earth clearance at landing above the antenna horizon plus the antenna terrain margin (best station, or Earth centre without ground stations)." },
  { key: "min_sunlit_hours_after_landing", title: "Continuous sunlight after landing", short: "Sunlight after landing", unit: "h", side: "min", decimals: 1, start: 48, what: "Continuous sunlit hours from landing." },
  { key: "max_dark_span_h", title: "Longest dark span", short: "Dark span", unit: "h", side: "max", decimals: 1, start: 50, what: "Longest dark span of the array during the surface mission." },
  { key: "min_state_of_charge", title: "Battery charge", short: "Battery", unit: "", side: "min", decimals: 2, start: 0.2, what: "Minimum battery state of charge (fraction) during the mission." },
  { key: "min_contact_fraction", title: "Share of the stay with an Earth link", short: "Link share", unit: "", side: "min", decimals: 2, start: 0.5, what: "Fraction of the mission with a ground station in contact." },
  { key: "max_contact_gap_h", title: "Longest Earth-link gap", short: "Link gap", unit: "h", side: "max", decimals: 1, start: 50, what: "Longest span with no ground station in contact." },
  { key: "min_link_margin_db", title: "Link margin", short: "Link margin", unit: "dB", side: "min", decimals: 1, start: 3, what: "Lowest downlink margin while in contact." },
  { key: "max_slope_deg", title: "Slope", short: "Slope", unit: "°", side: "max", decimals: 1, start: 15, what: "Terrain slope over the slope baseline; needs terrain data.", needsTerrain: true },
];

export const PARAMETER_META: Array<{ key: ParameterKey; title: string; unit: string; min?: number; max?: number; step: number}> = [
  { key: "sunlit_flux_fraction", title: "Sunlit flux fraction", unit: "", min: 0, max: 1, step: 0.01 },
  { key: "antenna_terrain_margin_deg", title: "Antenna terrain margin", unit: "°", min: 0, step: 0.1 },
  { key: "slope_baseline_m", title: "Slope baseline", unit: "m", min: 0, step: 0.5 },
];
