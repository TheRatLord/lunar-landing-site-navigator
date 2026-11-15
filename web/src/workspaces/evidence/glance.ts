export type CheckStatus = "Met" | "Missed" | "Mixed" | "Measured";

export interface Check {
  check: string;
  reference: string;
  result: string;
  status: CheckStatus;
  doc: string;
  section: string;
}

export const CHECKS: readonly Check[] = [
  {
    check: "Sun and Earth positions",
    reference: "JPL Horizons; NASA/GSFC eclipses",
    result: "3.6 × 10⁻⁸° (Sun), 5.8 × 10⁻⁷° (Earth); eclipse contacts within 4.6 s",
    status: "Measured",
    doc: "validation/ephemeris",
    section: "1",
  },
  {
    check: "Terrain horizon",
    reference: "Exact-ray horizon, 57 sites",
    result: "0 of 20,520 azimuth bins above the engine's upper bound",
    status: "Met",
    doc: "validation/horizon",
    section: "2.2",
  },
  {
    check: "Terrain heights",
    reference: "NASA PGDA 5 m site models",
    result: "68 % within 0.95 to 1.07 m on 5 to 60 m grids; 1.54 m at 120 m; 2.86 m at 240 m",
    status: "Measured",
    doc: "validation/terrain",
    section: "3.8",
  },
  {
    check: "Sunlight near the south pole",
    reference: "LOLA published 60 m map",
    result: "Mean error 0.59 points, 95th percentile 2.72 (targets 1 to 2 and ≤ 4)",
    status: "Met",
    doc: "validation/illumination",
    section: "3.1",
  },
  {
    check: "Earth in view near the south pole",
    reference: "LOLA published 60 m map",
    result: "95th percentile 6.27 points, 99th 14.5 (target 5); mean 0.85",
    status: "Missed",
    doc: "validation/illumination",
    section: "3.1",
  },
  {
    check: "Brightest ridge",
    reference: "Published maximum 88.444 %",
    result: "84.38 %, 4.1 points low",
    status: "Missed",
    doc: "validation/illumination",
    section: "3.4",
  },
  {
    check: "Connecting Ridge window",
    reference: "LOLA published 60 m map",
    result: "95th percentile error 15.6 points (target 1 to 2)",
    status: "Missed",
    doc: "validation/illumination",
    section: "3.5",
  },
  {
    check: "Permanently shadowed regions",
    reference: "Barker et al. 2023 shadow map",
    result: "Precision 0.976, recall 0.995; total area about 7 % high",
    status: "Mixed",
    doc: "validation/illumination",
    section: "4",
  },
  {
    check: "Shadows in orbital images",
    reference: "10 LRO NAC images",
    result: "Large shadows within 5.7 to 8.0 m; shadow overlap below 0.2 in 9 of 10 scenes",
    status: "Mixed",
    doc: "validation/imagery",
    section: "What a planner can take from this",
  },
  {
    check: "Regional layers",
    reference: "Exact engine, 960 cells",
    result: "Sunlight mean error 0.11 points; Earth up to 6.47 points; longest shadow up to 8,920 h",
    status: "Mixed",
    doc: "validation/illumination",
    section: "Summary for planners: how far to trust the regional layer",
  },
  {
    check: "Blue Ghost 1 sunset",
    reference: "Firefly's sunset window",
    result: "1.86 h late (target 1 h)",
    status: "Missed",
    doc: "validation/scenario",
    section: "3.1",
  },
  {
    check: "Chandrayaan-3 sunset",
    reference: "ChaSTE event times",
    result: "5.2 h early (target 1 to 3 h); sunrise and noon within the target",
    status: "Missed",
    doc: "validation/scenario",
    section: "3.2",
  },
  {
    check: "SLIM sunsets and recoveries",
    reference: "JAXA operations record",
    result: "Sunsets within the 1-day target; recovery days not predicted",
    status: "Mixed",
    doc: "validation/scenario",
    section: "3.3",
  },
  {
    check: "Gläser 2014, Connecting Ridge",
    reference: "Published sunlight, 4 spots",
    result: "10 m mast within 0.4 points; 2 m mast 2.9 to 3.2 points darker, dark span 2.3 to 2.4 times longer",
    status: "Mixed",
    doc: "validation/scenario",
    section: "11.2",
  },
  {
    check: "Mazarico 2011, Connecting Ridge",
    reference: "Published 89.01 %",
    result: "74.90 % at best, 14.1 points under; cause open",
    status: "Missed",
    doc: "validation/scenario",
    section: "11.4",
  },
  {
    check: "Barker 2021, Site 01",
    reference: "Published percentiles, 7 regions",
    result: "Nominal on the right side in 14 of 14; at 1 m the worst case falls short in 7 of 7 (average), 6 of 7 (longest light)",
    status: "Mixed",
    doc: "validation/scenario",
    section: "11.6",
  },
  {
    check: "Inside the engine's range",
    reference: "26 published values",
    result: "26 of 26 inside; sunlight ranges 1.5 to 99.3 points wide",
    status: "Met",
    doc: "validation/scenario",
    section: "11.9",
  },
];

export const NOT_VALIDATED = {
  text: "Battery and state of charge (lander profiles are estimates, no telemetry), event times on the terrain horizon (no ground truth at that resolution) and communication beyond geometric contact.",
  doc: "validation/scenario",
  section: "5",
};

export const DOC_TITLES: Record<string, string> = {
  "validation/ephemeris": "Sun and Earth positions",
  "validation/horizon": "Terrain horizon",
  "validation/illumination": "Sunlight and Earth maps",
  "validation/imagery": "Orbital images",
  "validation/scenario": "Missions and studies",
  "validation/terrain": "Terrain models",
  "validation/visibility": "Visibility maths",
  "research/literature": "Literature",
  "research/terrain-error": "Terrain data error",
};
