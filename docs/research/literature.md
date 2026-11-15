# Literature for validating lunar polar illumination and Earth-visibility models

Scope: peer-reviewed and agency sources against which `lunarnav` can be checked. The engine computes Sun, Earth and horizon geometry from a terrain model.
Every number was read in the source named, and its location (table, figure, section) is given. Anything not opened is marked **UNVERIFIED**.

**Abbreviations.** DEM: digital elevation model, a grid of surface heights. LOLA: Lunar Orbiter Laser Altimeter, the instrument behind most height maps. LRO: Lunar Reconnaissance Orbiter. LROC NAC / WAC: the Narrow Angle and Wide Angle cameras of LRO. LDEM: the file-name prefix of LOLA DEMs. PGDA: NASA Goddard Planetary Geodesy Data Archive. PDS: NASA Planetary Data System. PSR: permanently shadowed region, an area that never receives direct sunlight. RoI: region of interest. SfS: shape-from-shading. SPICE: NASA software and data for planet and spacecraft positions. DTE: direct-to-Earth communication. GSSR: Goldstone Solar System Radar. MADb: the scaled median absolute deviation, which equals the standard deviation for normal data. LCIP, LCSP and LQCIP are the papers' terms for the longest continuous illuminated period, the longest continuous shadow period and the longest quasi-continuous illuminated period.

Conventions that matter when comparing numbers. These are the traps:

- **Frame.** LOLA-team products (Mazarico, Barker, Smith) use the mean-Earth/polar-axis (ME/PA) frame of **DE421**. Their maps are polar stereographic on a **1737.4 km sphere**. The engine uses MOON_ME of DE440. Barker 2023 (Sec. 5) states that the ME/PA-DE421 realisation has an uncertainty of a few metres relative to the principal-axis frame [Barker 2023, PSJ 4:183, Sec. 5]. The effect on a 5-20 m grid is below a pixel, but it is not negligible at 5 m. Report it as a known systematic.
- **Illumination definition.** "Average illumination" and "Sunlit %" are different quantities. Always compare like with like. "Average illumination" is the time-averaged visible fraction of the solar disc (extended Sun). "Sunlit %" counts any visible fraction. At the best south-pole sites the two differ by about 4-5 percentage points (Gläser 2018 Table 1: 76.0 % vs 81.3 %).
- **Height.** Values at "surface level" use the DEM pixel height. Values "at 2 m" place the observer 2 m above it. Results at the surface are dominated by 5-20 m terrain noise (see section 4).
- **Time scale.** Papers say "year" or give a date range. They rarely state whether they use UTC or TDB. The difference (about 69 s) does not matter for percentages. It matters only for event times given to the minute.
- **Longitude.** Conventions differ. Gläser uses 0-360 °E. De Rosa and Bryant use -180..180 with east positive. Bussey prints E/W. LROC mission pages use 0-360 °E.

---

## 1. Mazarico et al. 2011 (the reference method and the PDS rasters)

- **Citation:** Mazarico, E., Neumann, G.A., Smith, D.E., Zuber, M.T., Torrence, M.H. (2011). *Illumination conditions of the lunar polar regions using LOLA topography.* Icarus 211(2), 1066-1081.
- **DOI:** 10.1016/j.icarus.2010.10.030. The paper is closed access (Elsevier). Unpaywall and OpenAlex report no open copy, and NTRS 20120010094 has no PDF. Only the abstract, the first pages (docslib mirror) and the LOLA team's own LEAG 2013 slides were read.
- **Method (abstract and first pages; LEAG 2013 slides, "Horizon method" slide):**
  - 240 m LOLA DEMs down to 75° latitude. They were built from 48,382,470 (north) and 91,698,177 (south) measurements in 2636 orbits, Jul 2009 - Jan 2010.
  - Horizon method: for each pixel, the horizon elevation at 0.5° azimuth steps (720 azimuths). The Sun is an extended disc without limb darkening. The Earth is treated the same way.
  - Time steps: 6 h over several 18.6-yr cycles in the paper. The later PDS rasters use 1 h steps over 18.6 yr, starting 2020, according to LEAG 2013 slides 9-11 and the PGDA page 69 captions ("averaged over hourly timesteps spanning 18.6 years").
  - Orbit errors at the time: 10 m radial, below 200 m total.
  - Validated against LROC WAC images (abstract).
- **Headline results (abstract):**
  - PSR area poleward of 80°: 12,866 km² (north), 16,055 km² (south), 240 m DEM.
  - A site on the Shackleton rim is sunlit continuously for 240 days of the year. Its longest continuous darkness is about 1.5 days.
  - Heights of 10 m above ground can raise illumination dramatically.
- **PSR area table (LEAG 2013 slide 13, 240 m, south, km²):** whole region 30,484 (65-90°S); > 80°: 19,119; > 82.5°: 13,372; > 85°: 7,406; > 87.5°: 3,762. The column for 80-90°S only gives 16,055 for > 80°. This is the paper's number.
- **Site table (paper Table 3, site coordinates and percentages): UNVERIFIED.** It could not be opened. The two values below come from other papers that quote Mazarico:
  - CR1 (Connecting Ridge), -89.45°, 222.69 °E, surface level: 89.01 % average illumination, longest darkness 141.12 h; at 10 m: 93.10 %. [Gläser thesis Table 7 rows 7 and 12; Gläser 2018 Table 1].
  - Shackleton rim ("S"), -89.78°, 204.27 °E: 86.7 % average, 90.5 % sunlit [Gläser 2018 Table 1].
- **Earth visibility (LEAG 2013 slide 25):** the longest period with any Earth visibility inside PSRs is 13.25 d (north) and 11.75 d (south). Earth visibility is no better than average in high-illumination or PSR areas (slide 23).
- **Rasters released by the author** (https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/; GeoTIFF copies at https://pgda.gsfc.nasa.gov/data/MoonIllumination/). Our reading of the 85S_060M product: maximum solar visibility is **88.44 %** at lat -89.4749°, lon 222.557 °E (x = -10,770 m, y = -11,730 m). This uses corrected pixel addressing; earlier versions of this file gave -89.4747°, 222.25 °E. The maximum is consistent with Mazarico's 89.01 % at CR1 for the 240 m DEM (Gläser Table 7), given the different DEM resolution.
- **Known criticisms from later papers (read):** Gläser 2018 §3: the 240 m DEM overestimates illumination (Table 1: 89.0 % vs 76.0 % at CR1 with a 20 m DEM). Speyerer & Robinson 2013 underestimates it (64.2 %).

---

## 2. Barker et al. 2021 (5 m south-pole site DEMs and the error budget)

- **Citation:** Barker, M.K., Mazarico, E., Neumann, G.A., Smith, D.E., Zuber, M.T., Head, J.W. (2021). *Improved LOLA elevation maps for south pole landing sites: Error estimates and their impact on illumination conditions.* Planetary and Space Science 203, 105119.
- **DOI:** 10.1016/j.pss.2020.105119. Open copy: https://ntrs.nasa.gov/api/citations/20205009660/downloads/Mike%20Barker_%20Paper_%20Improved%20Lola.pdf
- **Method:**
  - LOLA tracks are re-adjusted by an iterative track alignment (Sec. 3).
  - The paper builds 5 m LDEMs for 16 × 16 km regions.
  - It makes 100 Monte-Carlo clones per site from a measured error model.
  - Illumination uses a horizon method with 720 azimuths at 0.5°, a nested 5 m (to 5 km) / 80 m (to 100 km) / 240 m DEM, and 1 h steps. The Sun is extended, with 550 nm limb darkening. The visible fraction is approximated by cutting the disc at the horizon elevation at the disc-centre azimuth (illumination section; the number was not recorded).
  - Period for Table 2: 2024-01-01 to 2026-01-01.
- **Site correspondences (Sec. 2):** Sites 1, 4, 7, 11 = De Rosa 2012 CR1, SR1, SV1, GR1. Sites 1 and 4 = Gläser 2018 C1 and S. Site 4 contains Mazarico Site 8 (De Rosa SR2). Site numbers follow Mazarico 2011.

**Error budget (all from this paper unless stated):**

| Quantity | Value | Where |
|---|---|---|
| LRO orbit error before adjustment (along / cross / radial) | about 7 / 7 / 0.5 m (median offsets below are the adjustments) | Sec. 2-3 |
| Range precision | about 10 cm | Sec. 2 |
| Track spacing at 80°S+: cross-track / along-track, spot size | 12 m / 57 m, 5 m | Sec. 2 |
| Fill factor (pixels with at least one LOLA return) | 7-10 % at 5 m, 69-78 % at 20 m, 96-98 % at 40 m | text after Fig. 11, section number not confirmed |
| Median track offsets applied | 1.58 / -0.51 / -0.10 m (MADb 7.01 / 6.59 / 0.27 m) | Sec. 3 |
| Residual track geolocation error | about 12-14 cm horizontal, about 2 cm vertical (68 % of tracks) | Sec. 3 |
| Total Z uncertainty, median RMS | 0.37 m (MADb 0.15 m); 1 % of pixels above 1 m; max 5.65 m | Fig. 12 |
| Slope uncertainty, median | 1.90° (MADb 0.37°) | Fig. 12 |
| Interpolation error model | ε = a·R + b·S + c (R roughness, S slope); Site 1: a 0.0210, b 0.0051, c 0.022; interpolation method itself adds about 30 % | Table 1 |

The README of the PGDA 5 m product quotes a median RMS Z error of about 0.30-0.50 m and a slope error of about 1.5-2.5° across sites. It also states that about 90 % of 5 m pixels are interpolated. Page: https://pgda.gsfc.nasa.gov/products/78.

**Table 2: Site 1 RoIs, illumination uncertainty (100 clones; 2024-01-01 to 2026-01-01).**

RoI centroids (km, polar stereographic) as printed: RoI1 (11.5825, 12.4625), RoI2 (11.4875, 12.5575), RoI3 (11.3525, 12.5025), RoI4 (11.2875, 12.1675), RoI5 (11.1025, 11.9425), RoI6 (10.8025, 11.7375), RoI7 (10.2275, 11.5525).
**Sign note [INFERENCE, checked numerically].** Use negative X and Y. The extracted text carries no minus signs. Taking both coordinates as negative puts RoI1 at -89.4389° lat, 222.904 °E. This matches Gläser's CR1 (-89.44°, 222.8 °E). We checked that point on the downloaded 5 m Site01 DEM: its height is 1958.3 m, and it is inside the DEM extent (X -19..-3 km, Y -20..-4 km). The positive-sign point is outside that file.

| RoI | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| Area (m²) | 8625 | 7550 | 3825 | 13300 | 10075 | 10000 | 7075 |
| Δz = 1 m, case A: AvgIll 1st pct (%) | 68.03 | 70.32 | 67.51 | 69.61 | 70.38 | 71.15 | 67.36 |
| Δz = 1 m, A: LCIP-1 (d) | 63.35 | 113.80 | 117.86 | 136.49 | 142.17 | 81.01 | 100.23 |
| Δz = 1 m, A: LCSP-99 (d) | 16.55 | 17.84 | 22.23 | 13.27 | 15.24 | 12.74 | 14.54 |
| Δz = 5 m, A: AvgIll 1st pct (%) | 89.26 | 88.51 | 84.53 | 88.12 | 85.71 | 87.35 | 82.79 |
| Δz = 5 m, A: LCIP-1 (d) | 215.79 | 216.28 | 216.89 | 231.20 | 218.98 | 220.98 | 119.07 |
| Δz = 5 m, A: LCSP-99 (d) | 5.29 | 7.31 | 8.41 | 4.00 | 4.52 | 4.16 | 5.42 |

Case A = percentiles after averaging each RoI per clone. Case B (per pixel) and case C (best pixel each hour) are also in Table 2, for example at Δz = 1 m for RoI1: AvgIll B 49.30 %, C 85.84 %; LCIP-1 B 25.55 d, C 205.38 d.
LCIP = longest continuous illumination period (any part of the Sun visible). LCSP = longest continuous shadow period. The paper's text says that at 5 m height LCIP exceeds 200 d for RoIs 1-6, against about 150-175 d at the other sites. It also says that errors are almost negligible at 5 m (text near Table 2 and Conclusions).
**Use:** a 1 m observer on the 5 m LDEM of Site01 is a test whose answer is a distribution. The engine's value should lie inside the clone spread, not equal its median.

**Image comparison (Fig. 8):** a simulated image is compared with NAC M139811097 L/R. The comparison is qualitative.

---

## 3. Barker et al. 2023 (20 m / 10 m LOLA mosaics, PSR map)

- **Citation:** Barker, M.K., Mazarico, E., Neumann, G.A., Smith, D.E., Zuber, M.T., Head, J.W., Sun, X. (2023). *A new view of the lunar south pole from the Lunar Orbiter Laser Altimeter.* Planetary Science Journal 4, 183. Licence CC-BY 4.0.
- **DOI:** 10.3847/PSJ/acf3e1. Data: doi:10.60903/gsfcpgda-lola-spole (PGDA page https://pgda.gsfc.nasa.gov/products/90).
- **Method (Sec. 3-5):**
  - Tiles of 64 × 80 km with 2 km overlap, aligned with an iterative track adjustment. The adjustment is a translation: mean horizontal 0.76 ± 0.29 m, radial 0.32 ± 0.08 m. Overlap differences are 0.00 ± 0.70 m, median absolute 0.12 m.
  - Conservative final geolocation error (Sec. 3, Fig. 6): 1.00 m along, 1.00 m cross, 0.15 m radial.
  - The fill factor at 20 m is about 15-75 %, depending on region.
  - PSR map (Sec. 5): horizons come from nested maps: 20 m out to 7 km, and coarser maps up to 480 m out to 310 km. A fake SPICE kernel sets the Sun at its 18.6-yr minimum declination. There are 720 azimuth steps.
- **Results:**
  - 506,349 PSRs globally in the study region, 466,204 poleward of 80°S.
  - Total PSR area poleward of 80°S is **20,800 km²** (20,600 km² for PSRs of at least 5 px). O'Brien & Byrne 2022 give 20,900 km².
  - PSRs under 1 km hold 15 ± 5 % of the area. The size-frequency power-law exponent is -0.77 ± 0.07.
  - Completeness is about 70 % at 1 px near the pole. For the smallest PSRs, the false-positive fraction and the area error reach about 50 %.
  - "The Artemis zone (poleward of 84°S) effective resolution is about 20 m."
- **Our independent check of the downloaded map (this work):** `LPSR_80S_20MPP_ADJ.TIF` (value 1 = PSR) integrates to **20,710 km²** poleward of 80°S. The paper gives 20,800 km², a difference of 0.4 %. The integration uses the true area of each 20 m stereographic pixel. Poleward of 85°S the map gives 8,195 km².
- **Image simulations (Figs. 3-4, A12-A18):** a Lambertian rendering with albedo 0.1 on the 20 m LDEM is compared with NAC I/F images M139729686 and M151364517. The RMS error is about 30 %. Three such pairs (M139729686, M1188426614, M184288222) are in `data/validation/reference/pgda_barker2023_nac_sim/`.

---

## 4. LOLA accuracy and the dependence of illumination on height

### 4.1 LOLA accuracy

- **Smith et al. 2017.** Smith, D.E., Zuber, M.T., Neumann, G.A., Mazarico, E., Lemoine, F.G., Head, J.W., Lucey, P.G., Aharonson, O., Robinson, M.S., Sun, X., Torrence, M.H., Barker, M.K., Oberst, J., Duxbury, T.C., Mao, D., Barnouin, O.S., Jha, K., Rowlands, D.D., Goossens, S., Baker, D., Bauer, S., Gläser, P., Lemelin, M., Rosenburg, M., Sori, M.M., Whitten, J., McClanahan, T. (2017). *Summary of the results from the Lunar Orbiter Laser Altimeter after seven years in lunar orbit.* Icarus 283, 70-91. DOI 10.1016/j.icarus.2016.06.006. Open: https://ntrs.nasa.gov/api/citations/20160008718/downloads/20160008718.pdf
  - About 7 billion measurements. Geolocation accurate to under 10 m globally. Range precision about 10 cm. Crossover RMS improved from 1.67 m to 0.48 m. Orbit accuracy about 10 m total, under 1 m radial (GRGM900C).
  - Appendix table: SLDEM2015 has about 3-4 m accuracy at about 60 m resolution. GLD100 has about 10-20 m vertical accuracy with about 1 km effective resolution.
- **Polar tracks (Barker 2021, 2023):** see the tables in sections 2 and 3. For polar illumination, the limiting error is **gaps**, not registration.
  - Horizontal registration of 12-14 cm (5 m product) to 1 m (20 m product) and vertical 2-15 cm are not the limiting error.
  - 90 % of 5 m pixels and 25-85 % of 20 m pixels carry no direct measurement and are interpolated (fill factors in section 2).
  - De Rosa 2012 Table 3 gives the LOLA shot density at the time. At 20 m pixel size, only 33-73 % of pixels at CR1, SR1, SV1 and GR1 have a shot. At 10 m it is 10-28 %.
- **Reproducing horizons:** interpolation smooths terrain. High-resolution horizons are therefore generally above lower-resolution ones (Gläser thesis Fig. 68), and a coarser DEM gives *higher* illumination (Gläser 2018 §3).

### 4.2 How illumination changes with height above ground

| Case | Height 0 | Height 2 m | Height 10 m | Source |
|---|---|---|---|---|
| CR1 max average illumination, 20 m DEM, 20 yr | 76.0 % (Table 1) | 88.0 % (Table 2) | 92.55 % (thesis Table 7 row 13, 19-yr run) | Gläser 2018; Gläser thesis 2014 |
| CR1 longest shadow | 268 h | 112 h | 3.08 d = 74 h | Gläser 2018 Tables 1-2; thesis Table 7 spot 3 |
| CR1 longest light | not given | 233.87 d | 262.42 d | Gläser thesis §7.2.2, Table 7 |
| Site01 RoI1, 5 m DEM, 1st pct average | not given | 68.03 % at 1 m | 89.26 % at 5 m | Barker 2021 Table 2 |
| Site01 RoI1 LCIP-1 | not given | 63.35 d at 1 m | 215.79 d at 5 m | Barker 2021 Table 2 |
| B1 peak, radar DEM: Sun any part | not given | 97.08 % | 97.71 % at 32 m, 99.48 % at 1000 m | Bryant 2009 Table 5 |
| B1 peak, Earth any part | not given | 63.47 % | 63.54 % at 32 m | Bryant 2009 Table 6 |

- The Sun is strongly height-sensitive. Average illumination at CR1 changes by +12 percentage points from 0 to 2 m and by +4.5 points more to 10 m.
- **Earth visibility is nearly height-independent** (+0.07 points from 2 to 32 m). The reason is that Earth's ±6.68° monthly elevation swing crosses the horizon steeply (Bryant 2009 §IV; Gläser thesis §6.3).
- DEM resolution matters at the surface but not at 10 m. At the surface, going from 40 m to 20 m changes the maximum by more than 10 points and moves it by km. At 10 m height, the 20 m and 240 m maxima differ by 0.55 points and sit 52 m apart (Gläser thesis §7.2.3, Table 7 rows 4-6 and 12-13).
- Gaps in the lit area caused by 60-120 m degraded craters disappear at 5 m height (De Rosa 2012 Fig. 11).
- The Sun at height: the Mazarico 2011 abstract says "small height gains (10 m) can dramatically improve" illumination.

---

## 5. Literature results by paper (full extraction)

The sections below were extracted from the sources named in each header: De Rosa 2012, Bussey 2010, Gläser 2014 and thesis, Gläser 2018, Bryant 2009, and supporting abstracts. The last two sections hold cross-study test assertions. Section numbering restarts inside the fragment.

## Literature validation cases: south-pole illumination and Earth visibility (peer-reviewed / agency reports)

Scope: quantitative values from published modelling studies that an illumination and Earth-visibility engine can be checked against. Mazarico et al. 2011 and Barker et al. 2021/2023 are covered in the sections above and left out here, except where another paper quotes them for comparison.
Every value below was read in this session from the source named, and its location in that source is given. Anything not opened is marked **UNVERIFIED**.

Conventions used in this fragment:
- "lat/lon": as printed in the source. Longitude conventions differ between papers, and each paper's convention is stated.
- "avg illum %": time-averaged fraction of the solar disc visible. Papers that use an extended Sun weight partial visibility.
- "sunlit %": fraction of time with any part of the Sun visible. Gläser calls this "solar visibility" or "accumulated percentage in light".
- Height h is the observer height above the local DEM surface.

---

### 1. De Rosa et al. 2012 (ESA Lunar Lander site characterisation)

- **Citation:** De Rosa, D., Bussey, B., Cahill, J.T., Lutz, T., Crawford, I.A., Hackwill, T., van Gasselt, S., Neukum, G., Witte, L., et al. (2012). *Characterisation of potential landing sites for the European Space Agency's Lunar Lander project.* Planetary and Space Science 74, 224–246.
- **DOI:** 10.1016/j.pss.2012.08.002 (checked via Crossref/Unpaywall).
- **Open-access copy used:** https://arxiv.org/pdf/1208.5587
- **Method:**
  - DEM: LOLA LDEM at 40 m (sites within 2° of the pole) and 80 m (others). The DEM extends to −75°.
  - Horizons: ESA "Coverage" tool, 720 azimuth lines (0.5°) out to 150 km. Sampling is 20 m within 3 km and 2 km beyond 75 km.
  - Sun: extended disc, 0.533°, vertical-fraction method. Ephemeris from JPL HORIZONS. Time step 1 h; main runs over the year 2019.
  - Cross-checks:
    - Astrium ICAT uses a 50 % disc threshold.
    - STK models the Sun as a point source and needs a 30 cm height.
    - ASP LunarShader was used for the Table 4 comparison.
  - LQCIP ("Longest Quasi-Continuous Illumination Period") is computed at 2 m. Darkness under 60 h and illumination under 10 h are filtered out.

**Table 2: Region-of-Interest (RoI) centres.**
- Source frame: "ME/PA (DE421)". Latitude is labelled "geodetic"; for a sphere this equals planetocentric.
- Longitude: −180…180, east-positive.
- X/Y: polar stereographic km.

| ID | Site | Lat (°) | Lon (°E) | X km | Y km |
|---|---|---|---|---|---|
| CR1 | Connecting Ridge | −89.4679 | −137.411 | −10.92 | −11.88 |
| GR1 | de Gerlache Rim | −88.6952 | −68.2846 | −36.76 | 14.64 |
| GR2 | de Gerlache Rim | −89.0073 | −94.7636 | −30 | −2.48 |
| LP1 | Leibnitz β Plateau | −85.4596 | 31.78053 | 72.55 | 117.1 |
| LP2 | Leibnitz β Plateau | −85.2934 | 37.0304 | 86 | 114 |
| LP3 | Leibnitz β Plateau | −85.5566 | 37.4649 | 82 | 107 |
| MP1 | Malapert Peak | −85.9756 | −2.11241 | −4.48 | 121.8 |
| MP2 | Malapert Peak | −86.0265 | 2.757964 | 5.8 | 120.4 |
| SR1 | Shackleton Rim | −89.7755 | −156.448 | −2.72 | −6.24 |
| SR2 | Shackleton Rim | −89.689 | −162.351 | −2.84 | −9 |
| SR3 | Shackleton Rim | −89.812 | 52.125 | 4.48 | 3.48 |
| SV1 | Shackleton Vicinity | −88.8247 | 124.1359 | 29.48 | −20 |

**Table 4: top-5 points, surface level.**
- Area: −88° to −90°. DEM: 240 m.
- Period: 2010-03-31 12:00 to 2010-09-24 00:00. Time scale not stated; treat as UTC.
- Columns give avg illum % from the ESA tool and from ASP LunarShader.

| X, Y (km) | ESA % | ASP % |
|---|---|---|
| (−2.64, −9.12) | 84.1263 | 81.355 |
| (30.24, −20.16) | 83.16 | 80.5085 |
| (−39.60, 16.08)* | 78.64 | 76.2712 |
| (−18.96, −8.64)* | 77.34 | 74.5763 |
| (−10.80, −12.00) [ASP: (−11.52, −12.24)] | 76.25 | 78.8136 |

\*ASP lists X without the minus sign.
§2.4 says the two tools differ by "always less than 4%". The location of point 5 differs by 690 m between the tools.

**§2.3 results (text):**
- LQCIP is 4–9 months inside the best areas (2 m, 60 h filter) and drops below 1 month outside them.
- The best areas are a few hundred metres across.
- Changing the disc threshold changes LQCIP by about 3 %.
- Gaps inside the lit areas are degraded craters 60–120 m across. They disappear at 5 m height (Fig. 11).
- DTE (direct-to-Earth) windows last about 14 days, and up to about 19 days at LP1.
- A 2° minimum Earth-elevation mask reduces communication availability by at most 5 %.

**Table 1: southern winter solstice dates (Method 1 / Method 2).**

| Year | Method 1 | Method 2 |
|---|---|---|
| 2018 | 22/10/2018 | 23/10/2018 |
| 2019 | 12/10/2019 | 03/10/2019 |
| 2020 | 30/09/2020 | 15/09/2020 |
| 2021 | 27/08/2021 | 26/08/2021 |
| 2022 | 14/08/2022 | 10/08/2022 |

These dates can be used to check the date of minimum Sun elevation in an engine.

**Table 3: LOLA shot density.** Percentage of pixels with at least one shot, at 60 / 40 / 20 / 10 m pixel size:
- CR1: 99.8 / 97.8 / 72.5 / 27.6
- SR1: 99.9 / 97.2 / 73.0 / 28.3
- GR1: 79.3 / 65.4 / 33.0 / 9.6
- SV1: 99.4 / 96.1 / 70.3 / 25.8
- MP1: 56.0 / 41.6 / NA / NA
- MP2: 61.2 / 46.2 / NA / NA
- LP1: 63.5 / 46.5 / NA / NA
- LP2: 56.6 / 41.7 / NA / NA

Meaning: below about 40 m pixel size in this DEM, most pixels are interpolated.

**§2.4 validation:**
- ESA vs Astrium LQCIP: RMS error about 44.7 days (CR1 sub-area, 2 m, 60 h filter, 40 m grid).
- Rendered snapshots vs LROC NAC images M112490681RE and M118429312LE: registration error about 5 m RMS.

---

### 2. Bussey et al. 2010 (Kaguya LALT, year 2020)

- **Citation:** Bussey, D.B.J., McGovern, J.A., Spudis, P.D., Neish, C.D., Noda, H., Ishihara, Y., Sørensen, S.-A. (2010). *Illumination conditions of the south pole of the Moon derived using Kaguya topography.* Icarus 208, 558–564.
- **DOI:** 10.1016/j.icarus.2010.03.028
- **Copy used:** https://spudislunarresources.nss.org/Bibliography/p/98.pdf
- **Method:**
  - DEM: Kaguya LALT, 64 px/° (474 m/px), 85–90°S.
  - Software: LunarShader with NAIF SPICE.
  - Sun: extended, with a sigmoid for partial blocking.
  - Time step 12 h over calendar year 2020; surface level.
- **Coordinates:** °S with E/W longitude as printed. Frame not stated.

**§5 and Table 2: sites, with 2020 mean illumination and per-lunar-day % for Day 1 to Day 7.**

| Pt | Location | 2020 mean | D1 | D2 | D3 | D4 | D5 | D6 | D7 |
|---|---|---|---|---|---|---|---|---|---|
| A (Shackleton rim) | 89.68°S 166.0°W | 81 % | 98 | 97 | 97 | 92 | 73 | 51 | 44 |
| B (ridge) | 89.44°S 141.8°W | 82 % | 100 | 100 | 95 | 90 | 64 | 56 | 56 |
| C (de Gerlache rim) | 88.71°S 68.7°W | 85 % | 98 | 98 | 97 | 86 | 71 | 66 | 64 |
| D | 88.79°S 124.5°E (Table 2)† | 86 % | 100 | 100 | 100 | 93 | 80 | 63 | 58 |
| M1 (Malapert) | 86.04°S 2.7°E | 74 % | 95 | 92 | 88 | 69 | 64 | 54 | 54 |
| M2 (Malapert) | 86.00°S 2.9°W | 74 % | 90 | 83 | 83 | 75 | 66 | 58 | 58 |

†The text has a typo, "99.79°S". The abstract gives 88.74°S.

Further results from the text:
- Point B is lit for more than 4.5 continuous months, with eclipses of 12–24 h.
- Point C has the shortest maximum eclipse, 6 days.
- Point D is lit for more than 5 continuous months. Its longest eclipse is about 11.5 days, at mid-winter.
- Points A and B together are lit for more than 94 % of the time, including more than 8 continuous months.

**Table 1: shadowed areas within 4° of the pole.**
- Sun-shadowed: 5058 km².
- Sun- and Earth-shadowed: 2653 km².
- Earth-shadowed: 10,520 km².

**Other values:**
- Maximum sub-solar latitude over 1000 yr: 1.59° (§4.2).
- Validation against Clementine 750 nm images (lub0040a.317, lub0032a.245; Figs 1–2) is qualitative only ("amazingly accurate"). No numeric agreement is given.

---

### 3. Gläser et al. 2014 (Icarus) and Gläser PhD thesis 2014 (same work, full numbers)

- **Paper:** Gläser, P., Scholten, F., De Rosa, D., Marco Figuera, R., Oberst, J., Mazarico, E., Neumann, G.A., Robinson, M.S. (2014). *Illumination conditions at the lunar south pole using high resolution Digital Terrain Models from LOLA.* Icarus 243, 78–90.
  - DOI: 10.1016/j.icarus.2014.08.013. Closed access; only the abstract was used, from https://elib.dlr.de/94240/.
  - The EPSC 2014 abstract was also used: https://elib.dlr.de/94242/1/EPSC2014-136-1.pdf
- **Thesis (full text used):** Gläser, P.A. (2014). *Evaluation of Topography, Slopes, Illumination and Surface Roughness of Landing Sites near the Lunar South Pole using Laser Altimetry from the Lunar Reconnaissance Orbiter.* Dr.-Ing. dissertation, TU Berlin (D83).
  - DOI: 10.14279/depositonce-4306
  - §7.2 states that "the results provided … are taken from Gläser et al. [2014]".
- **Method** (thesis §6.2.2, §7.1–7.2):
  - DEM: LOLA, geometrically adjusted against NAC, 20 m/px. Study region 20×20 km within a 400×400 km DTM, gnomonic projection.
  - Horizon method with 720 azimuths (0.5° steps, chosen to fit the 0.53° solar disc).
  - Sun and Earth positions from the DE421 ephemeris with SPICE.
  - Extended Sun: the visible disc fraction is computed against a straight-line horizon between the two bracketing azimuths.
  - Time step 1 h.
  - 1-yr run (2018-10-22 to 2019-10-22, 8,783 steps) at h = 0 and 2 m.
  - 19-yr run (2015-12-24 to 2034-12-24) for CR1 at h = 0, 2 and 10 m.
- **Coordinates:** °S and 0–360 °E, as printed. The paper does not state a separate frame for the coordinates; the ephemeris is DE421.

**Table 6: landing sites.**
- SR1: 89.7742°S, 203.4952°E
- SR2: 89.6871°S, 197.0983°E
- CR1: 89.4555°S, 222.6192°E

**One-year run, 2018-10-22 to 2019-10-22 (§7.2.1).**
- Surface level:
  - The 100 most-illuminated spots range from 63.83 % to 73.70 %.
  - The maximum, 73.70 %, is at SR1.
  - CR1 has only 1 pixel (400 m²) above 70 %. SR1 and SR2 each have 1,200 m² above 70 %.
  - No location receives constant sunlight.
- 2 m:
  - The top pixels lie only at SR1, SR2 and CR1, with 80.62 % to 86.62 %. The maximum, 86.62 %, is at CR1.
  - Area above 70 %: CR1 about 120,000 m² (297 px), SR1 about 70,000 m² (173 px), SR2 about 12,000 m² (49 px).

**19-year run at CR1, 2015-12-24 to 2034-12-24 (§7.2.2, Table 7).**

| Spot | Lat, Lon (°S, °E) | h | Avg illum % | Sunlit % | Longest dark (d) | Longest light (d) |
|---|---|---|---|---|---|---|
| 1 | 89.4395, 222.8066 | 2 m | 88.12 | 92.00 | 4.58 | 233.87 |
| 2 | 89.4399, 222.8524 | 2 m | 87.93 | 92.27 | 4.62 | 233.87 |
| 3 | 89.4516, 222.7581 | 10 m | 92.55 | 95.61 | 3.08 | 262.42 |
| 4 | 89.4544, 222.8445 | 10 m | 91.94 | 95.65 | 3.17 | 262.42 |

- Spots 3 and 4 are 90 m apart.
- Pixels above the "high" threshold: 297 (1 yr) and 358 (19 yr) at 2 m above 70 %; 1,724 px (about 0.7 km²) at 10 m above 90 %.
- EPSC 2014 rounds spot 4's sunlit fraction to 95.66 %; the thesis gives 95.65 %.

**Table 7 (thesis): sensitivity to DEM resolution and cross-study comparison.**
Coordinates are lat/lon in ° (lon in °E as printed). "lpc" means the full 18.6-yr cycle.

| # | Study | Res (m) | Illum % | Lat, Lon | h | Period |
|---|---|---|---|---|---|---|
| 1 | Noda 2008 | 474 | 86 | −88.8, 124.1 | 0 | lpc |
| 2 | Bussey 2010 | 474 | 86 | −88.74, 124.5 | 0 | lpc |
| 3 | Speyerer & Robinson 2013 | 100 | 71.7 | −89.74, 201.20 | 0 | 1.0 yr |
| 4 | De Rosa 2012 (SR2) | 40 | 84.13 | −89.687, 196.144 | 0 | 0.5 yr* |
| 5 | This study, 40 m | 40 | 81.30 | −89.6871, 197.2887 | 0 | 0.5 yr* |
| 6 | This study, 20 m (SR1) | 20 | 73.84 | −89.7846, 203.9358 | 0 | 0.5 yr* |
| 7 | Mazarico 2011 (CR1) | 240 | 89.01 | −89.45, 222.69 | 0 | lpc |
| 8 | This study, 240 m | 240 | 86.84 | −89.44, 222.52 | 0 | lpc |
| 9 | This study, 20 m (SR2) | 20 | 76.23 | −89.6856, 196.7626 | 0 | lpc |
| 12 | Mazarico 2011 (CR1) | 240 | 93.10 | −89.45, 222.69 | 10 | lpc |
| 13 | This study (spot 3) | 20 | 92.55 | −89.4516, 222.7581 | 10 | lpc |

\*0.5 yr = 2010-03-31 to 2010-09-24, the same window as De Rosa Table 4.

Conclusions from §7.2.3:
- At h = 0, near-field topography dominates. Going from 20 m to 40 m changes the maximum by more than 10 percentage points and moves it by km (rows 4–6).
- At 10 m, the 20 m and 240 m maxima are only 52 m apart and within 0.55 percentage points (rows 12–13). DEM resolution is "of minor significance" there.
- Higher-resolution horizons generally sit above lower-resolution ones (Fig. 68), so they give less illumination.

**Earth visibility to the ten ESA Estrack stations (§7.3).**
- Station coordinates are in Table 8, WGS-84 heights.
- Time step 1 h; lunar horizon included; Earth's topography ignored.
- Theory (§6.3): seen from the south pole, the Earth elevation swings ±6.68° per month (latitude libration). A single Earth station can therefore be seen at most about 55 % of the time. Once Earth's rotation is included, this drops to about 27.5 %.
- 1-yr map for station Malargüe (spelled "Malagüe" in the source): maximum about 98 days, about 26.8 %, at CR1 (Fig. 71).
- 19 yr, all 10 stations: spot 4 has visibility windows of about 14.45 d, each followed by about 12.8 d of radio silence. This is 53 % visibility (Fig. 72).
- Longest radio-silent periods over 19 yr: 15.42 d (spot 1), 13.92 d (spot 2), 13.95 d (spot 3), 13.04 d (spot 4).
- At most 9 stations are visible at once.

---

### 4. Gläser et al. 2018 (20-yr, both poles)

- **Citation:** Gläser, P., Oberst, J., Neumann, G.A., Mazarico, E., Speyerer, E.J., Robinson, M.S. (2018). *Illumination conditions at the lunar poles: Implications for future exploration.* Planetary and Space Science 162, 170–178.
- **DOI:** 10.1016/j.pss.2017.07.006
- **Copy used:** https://ntrs.nasa.gov/api/citations/20170007365/downloads/20170007365.pdf
- **Method:**
  - DTM: LOLA, 20 m/px, 400×400 km; analysis area 50×50 km.
  - Horizon method with solar-disc fraction (extended Sun).
  - Time step 1 h from 2017-01-01 to 2037-01-01, which covers the 18.6-yr cycle. Heights 0 and 2 m.
  - Robustness was checked with 10 m and 40 m DTMs; the 40 m DTM gives higher illumination.
- **Coordinates:** lat and 0–360 °E. Frame not stated.

**Table 1: h = 0, south pole.**

| Site | Source | Lat | Lon °E | Max avg illum % | Sunlit % | Max shadow (h) |
|---|---|---|---|---|---|---|
| C1 | this study | −89.4505 | 222.84 | 76.0 | 81.3 | 268 |
| C1 | Mazarico 2011 | −89.45 | 222.69 | 89.0 | 92.7 | 141.12 |
| C1 | Speyerer & Robinson 2013 | −89.418 | 221.3 | 64.2 | – | 308 |
| C2 | this study | −89.3157 | 245.94 | 75.6 | 80.6 | 166 |
| S | this study | −89.7849 | 203.97 | 81.0 | 85.5 | 221 |
| S | Mazarico 2011 | −89.78 | 204.27 | 86.7 | 90.5 | – |
| S | Speyerer & Robinson 2013 | −89.740 | 201.2 | 71.6 | – | 145 |

North-pole rows from the same table: Whipple 89.3766, 126.48: 82.9 / 88.5 / 101 h (Mazarico 84.6 / 89.4; Speyerer & Robinson 63.3 % / 303 h). Hinshelwood: 72.6 / 81.2 / 392 h. Peary: 69.5 / 78.3 / 334 h.

**Table 2: h = 2 m.**

| Site | Lat | Lon °E | Max avg illum % | Sunlit % | Max shadow (h) |
|---|---|---|---|---|---|
| C1 | −89.4398 | 222.83 | 88.0 | 92.1 | 112 |
| C2 | −89.3130 | 245.98 | 78.1 | 82.0 | 165 |
| S | −89.6866 | 197.19 | 85.5 | 89.4 | 66 |
| S | −89.7815 | 204.70 | 82.1 | 89.8 | 65 |

**Table 3: clusters at 2 m.**

| Cluster | Max avg % | Sunlit % | Area m² | Nearest PSR m² | Dist m | Max slope ° |
|---|---|---|---|---|---|---|
| C1-0 | 88.0 | 92.1 | 135,200 | 5,200 | 100 | 12.8 |
| C1-1 | 81.3 | 86.0 | 26,800 | 9,600 | 70 | 13.7 |
| C2-0 | 71.6 | 75.1 | 4,400 | 5,600 | 60 | 11.5 |
| C2-1 | 78.1 | 82.0 | 11,600 | 22,800 | 80 | 17.1 |
| S0 | 85.5 | 89.4 | 21,600 | 58,400 | 370 | 17.0 |
| S1 | 84.3 | 89.8 | 120,400 | 4,400 | 30 | 11.1 |
| S2 | 73.9 | 78.8 | 31,200 | 1,200 | 80 | 6.0 |

**§3 text:**
- Maximum time in shadow at 2 m is up to 70 % shorter than at the surface.
- Mazarico 2011 (240 m DEM) overestimates illumination. Speyerer & Robinson 2013 (100 m WAC, 1 yr) underestimates it.
- The paper quotes Speyerer et al. 2016: a mobile rover at C1 is illuminated 94.4 % of the year, with a longest eclipse of 101 h.

---

### 5. Bryant 2009, JPL IPN Progress Report (GSSR radar DEM; Sun and Earth visibility with tower-height sensitivity)

- **Citation:** Bryant, S. (2009). *Lunar Pole Illumination and Communications Maps Computed from Goldstone Solar System Radar Elevation Data.* IPN Progress Report 42-176, 15 Feb 2009.
  - This is a JPL agency report, not a journal paper.
- **URL used:** https://ipnpr.jpl.nasa.gov/progress_report/42-176/176C.pdf
- **Method:**
  - DEM: GSSR 2006 radar, 40 m horizontal, about 5 m relative vertical accuracy.
  - Topocentric horizon masks at 2 m height, 1° azimuth steps in the fine analysis.
  - Main metrics integrate the horizon mask over a *uniform* Sun/Earth distribution inside the libration box.
  - Cross-check uses actual HORIZONS ephemeris, 2009-01-01 to 2028-01-01, 24 h steps.
  - Metrics are reported at 0 %, 50 % and 100 % of the disc visible: "any part", "half" and "full disc".
- **Coordinates:**
  - Polar stereographic X/Y with "X-axis pointed east (90 deg lunar east longitude), and Y-axis pointed nearside (0 deg lunar east longitude)" (p. 2).
  - Table 2 also gives lat/lon in degrees, east-positive, −180…180 (e.g. Malapert α at 1.704°).
  - Selenographic frame; ME/PA not stated.

**Table 2 / Table 3 / Table 4: fine-resolution site metrics (h = 2 m, uniform-distribution model).**
- Avg illum is the multiyear average, any part / 50 % / full disc visible.
- "Longest dark" is the longest continuous darkness, any part / 50 % / full disc.
- DTE is the Earth visibility %, any part / 50 % / full disc.

| Site | Lat | Lon °E | Avg illum % (0/50/100) | Longest dark (d) (0/50/100) | DTE % (0/50/100) |
|---|---|---|---|---|---|
| A1 | −89.633 | −160.388 | 93.46 / 90.36 / 86.31 | 2.46 / 2.71 / 5.50 | 62.20 / 55.29 / 48.37 |
| A2 | −89.723 | −153.925 | 92.98 / 89.47 / 84.83 | 2.63 / 2.79 / 3.04 | 63.90 / 56.98 / 50.07 |
| A3 | −89.861 | −148.285 | 85.36 / 80.75 / 75.22 | 4.92 / 8.86 / 9.19 | 63.41 / 56.50 / 49.58 |
| A4 | −89.861 | 62.700 | 87.83 / 83.66 / 78.51 | 6.23 / 7.63 / 9.92 | 63.97 / 57.06 / 50.14 |
| B1 | −89.388 | −137.810 | 97.01 / 94.79 / 91.67 | 2.79 / 4.10 / 7.54 | 65.16 / 58.24 / 51.33 |
| B3 | −89.260 | −116.703 | 83.84 / 80.50 / 76.55 | 6.89 / 7.05 / 10.09 | 65.60 / 58.69 / 51.77 |
| H | −89.302 | 128.371 | 77.53 / 72.20 / 66.57 | 10.42 / 10.74 / 13.78 | 62.02 / 55.11 / 48.20 |
| C1 | −88.657 | −70.688 | 90.01 / 86.95 / 83.12 | 5.33 / 5.90 / 11.31 | 70.97 / 64.05 / 57.14 |
| F | −88.813 | 126.601 | 89.28 / 85.97 / 81.77 | 5.90 / 6.39 / 8.94 | 67.30 / 60.38 / 53.47 |
| MA (Malapert α) | −86.037 | 1.704 | 82.08 / 78.36 / 74.49 | 12.62 / 12.86 / 13.18 | 100 / 100 / 94.68 |
| LB (Leibnitz β) | −84.722 | 39.470 | 79.06 / 77.43 / 75.82 | 9.15 / 9.48 / 9.72 | 100 / 100 / 100 |

Notes:
- The "medium" 40 m values in Table 2 differ slightly from the fine-resolution values in Table 3. For example, B1 has solar 97.52 % and Earth 65.10 % in Table 2, against 97.01 % and 65.16 % in Tables 3–4.
- The text says that from these rim peaks "the entire Earth is visible about 50 percent of the sidereal month".
- **Uniform model vs real ephemeris (§IV.D):** "the same solar illumination metric agrees within 1 percent and the same Earth visibility metric agrees within 5 percent".

**Tables 5 and 6: height sensitivity at B1, 2009–2028 ephemeris columns.**

| Tower h (m) | Sun any / 50 % / full (%) | Earth any / 50 % / full (%) |
|---|---|---|
| 2 | 97.08 / 94.89 / 91.99 | 63.47 / 58.61 / 53.95 |
| 8 | 97.36 / 95.21 / 92.30 | 63.49 / 58.62 / 53.97 |
| 32 | 97.71 / 95.79 / 93.03 | 63.54 / 58.67 / 54.01 |
| 128 | 98.25 / 96.90 / 94.91 | 63.75 / 58.88 / 54.21 |
| 1000 | 99.48 / 98.70 / 97.89 | 65.74 / 60.73 / 56.00 |
| 3000 | 100.00 / 100.00 / 99.88 | 70.58 / 65.14 / 60.17 |

Key behaviour: Earth visibility barely depends on height (+0.07 percentage points from 2 m to 32 m). Solar illumination changes far more. The reason given is that Earth's ±6.68° monthly elevation swing crosses the horizon steeply. Gläser's thesis §6.3 gives the same physical argument.

---

### 6. Abstract-level / supporting sources

**Speyerer & Robinson 2013**
- Citation: *Persistently illuminated regions at the lunar poles: Ideal sites for future exploration.* Icarus 222(1), 122–136. DOI 10.1016/j.icarus.2012.10.010.
- Only the abstract was used: https://asu.elsevierpure.com/en/publications/persistently-illuminated-regions-at-the-lunar-poles-ideal-sites-f/
- Method: an *observational* map built from LROC WAC images taken about every 2 h at 100 m GSD over one year, not a model.
- Result: the best south-pole spots are lit "nearly 94% of the year", with a longest eclipse of 43 h.
- Per-site values from their table are known here only as reproduced in Gläser 2018 Table 1 and Gläser thesis Table 7:
  - CR1: 64.2 %, 308 h.
  - Shackleton: 71.6–71.7 % at −89.74, 201.2°E.
  - Station 1 is at 89.685°S, 196.7°E (thesis §7.2.3).
- LROC news 991 (12 Jan 2018), https://lroc.im-ldi.com/news/991: the PDS percentage and time-weighted illumination maps were built from 3,807 south-pole WAC images.
  - Product IDs: WAC_POLE_ILL_PCT_SOUTH and WAC_POLE_ILL_TWI_SOUTH, 100 m.
  - This is an image-derived reference raster that an engine can be compared against.

**Noda et al. 2008**
- Citation: *Illumination conditions at the lunar polar regions by KAGUYA (SELENE) laser altimeter.* GRL 35, L24203. DOI 10.1029/2008GL035692.
- Only the Crossref abstract was used.
- Results: no peaks of eternal light; the most continuously lit points are at 89 % (north) and 86 % (south).
- The point location −88.8, 124.1 comes from Gläser thesis Table 7, not from Noda directly.

**Bertone et al. 2026 (PSJ)**
- Citation: Bertone, McKenna, Barker, Mazarico, Beyer, Petro. *Enhanced Topography Models for Selected Lunar South Pole Regions with Shape-from-Shading.* Planet. Sci. J. 7(5), 118 (Crossref issue date 2026-05).
- DOI 10.3847/PSJ/ae5b70. Page used: https://iopscience.iop.org/article/10.3847/PSJ/ae5b70
- They built 5 m/px SfS DEMs for the 13 Artemis III (2022) regions.
- **Model-vs-image agreement** (§4, Fig. 14B): about 380 LROC NAC images were simulated with ray tracing (ShadowSpy).
  - SSIM 0.83 ± 0.07 with the LOLA LDEM terrain.
  - SSIM 0.91 ± 0.05 with the SfS DEM.
  - Pixel RMSE was also reported, but its values were not captured here.
- Fig. 15 shows average-illumination differences between LDEM and SDEM over Connecting Ridge. Numbers are given only as a figure.

**Bertone et al. LPSC 2025 #2155**
- States qualitatively that SfS-based illumination differs strongly from 20 m LDEM-based illumination at ground level, and that the difference is smaller a few metres above ground. No numbers.

**VIPER site analysis**
- Citation: Beyer et al. 2025, PSJ 6, 236. DOI 10.3847/PSJ/ae061a. URL: https://iopscience.iop.org/article/10.3847/PSJ/ae061a
- Mission area about 5×4 km, centred at 85.42088°S, 31.6218°E (Mons Mouton, formerly Leibnitz β).
- Method:
  - Horizon method, 0.25° azimuth.
  - Merged 1 m SfS + LOLA DEM.
  - 2 h steps, 4,128 maps covering southern summer.
  - Extended Sun. NASA Deep Space Network (DSN) stations are treated as point targets. The communications requirement is "station >2° above horizon".
  - LOLA gridding note: 90 % of 5 m pixels are interpolated.
- Gives no site percentages, so it is not usable as a numeric test case.

**Meier et al. LPSC 2022 #1621**
- Leibnitz β average illumination is above 50 %, with line of sight to Earth.

**Peña-Asensio et al. 2024**
- arXiv 2406.19863 (MCDM ranking of Artemis III sites).
- Best site DM2 in Nobile Rim 2 at −84.20156°, 60.69989°E.
- Its illumination scores are derived from PGDA maps and are not percentages.

**NASA Artemis III regions**
- 13 regions, release 22-089, 2022-08-19.
  - Each region is about 15×15 km; a site has about 100 m radius; all lie within 6° of the pole.
- 9 regions, release 24-136, 2024-10-28.
- LPSC 2026 update (NTRS 20250011660):
  - Surface stay about 5.75–6.25 d.
  - Illumination windows shift by about 2–3 weeks per year.
  - Regions with more Earth visibility are preferred.
- No lat/lon for these regions is published in the releases.

---

### 7. Cross-study test assertions an engine should reproduce

1. **Height sensitivity of the Sun**:
   - CR1 average illumination rises from about 76 % (h = 0) to about 88 % (2 m) to about 92.5 % (10 m) with a 20 m DEM. Sources: Gläser 2018 Tables 1–2; thesis Table 7.
   - Maximum shadow drops from 268 h to 112 h between 0 and 2 m (Gläser 2018).
   - Lit-area gaps from 60–120 m craters vanish by 5 m (De Rosa Fig. 11).
2. **Height sensitivity of the Earth** is very small: 63.47 % → 63.54 % from 2 m to 32 m at B1 (Bryant Table 6).
3. **DEM resolution sensitivity** is large at h = 0: more than 10 percentage points, and the location of the maximum moves by km. It is small at 10 m: less than 0.6 percentage points, with the maxima 52 m apart. Source: thesis §7.2.3, Table 7.
   - Coarser DEMs give higher illumination (Gläser 2018 §3; thesis Fig. 68).
4. **Two independent horizon-method tools** on the same DEM agree within 4 % in average illumination (De Rosa Table 4).
5. **Earth DTE**:
   - Near Shackleton/CR1 the Earth is visible for about 14–14.5 d and then silent for about 12.8–13 d each month (De Rosa §2.3; thesis Fig. 72).
   - Any-part Earth visibility is about 62–71 % for rim and ridge peaks, and 100 % on Malapert α and Leibnitz β (Bryant Table 4).
6. **No point of eternal light** at the south pole in any study. The best values are about 92–97 % sunlit at 2 m.

### 8. UNVERIFIED / not obtained

- **Bussey et al. 2005**, Nature 434, 842, DOI 10.1038/434842a ("Constant illumination at the lunar north pole").
  - Only the Crossref metadata and the Semantic Scholar TLDR were seen. The paper is closed and its content was not opened.
- **Speyerer & Robinson 2013 full text and per-site table**: Elsevier is closed and ADS returned HTTP 405. Only the abstract and the values reproduced by Gläser were used.
- **Gläser et al. 2014 Icarus full text** (closed). The thesis was used in its place; it says its §7.2 results come from that paper.
- **Noda 2008 full text**: the Wiley PDF request returned HTML.
- **Zhang et al. 2023**, Remote Sensing 15, 5691 (Chang'E-7 multi-temporal images): MDPI returned HTTP 403. The Crossref abstract has no agreement numbers.
- **Coordinates of the 13 and 9 Artemis III regions**:
  - Not given in the NASA releases.
  - The USGS ScienceBase item 671a6fa8d34efed5620f89f8 shapefile zip downloaded as HTML.
- **Bertone 2026 RMSE values** (Fig. 14B): not captured. Only the SSIM values were extracted.
- No 2020–2026 paper was found that quantifies agreement between modelled illumination and *landed* observations. Searches for Chandrayaan-3, IM-1, IM-2 and Chang'e-4 gave no usable hits.
- Kokhanov et al. (Malapert illumination) papers were not opened.
