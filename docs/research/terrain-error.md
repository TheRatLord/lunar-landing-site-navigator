# Published error of the terrain products the engine uses

Scope: every terrain file held under `data/dem/raw/` (manifest: `data/dem/raw/manifest.json`; products in `docs/validation/terrain.md` §1, §3.6).
Purpose: replace the single global budget (sigma_z 4 m, sigma_xy 10 m, k = 2) by per-product figures wherever a primary source states one.

**Rules used.** A figure is *published* only if it was read in the primary document (opened 2026-11-12; sources and quotes in §12). Where no document states a figure for the product, the row says *not found*, the global budget stays and the basis is `assumed`. Ranges and statistics are given as printed; any conversion to a 1σ figure is marked **[my reading]**. Nothing here comes from memory.

## 1. The table

σ_z is the vertical 1σ in metres; σ_xy is the horizontal 1σ **per axis** in metres. "Global budget" means 4.0 m / 10.0 m (the current engine default, `assumed`).

| product id | files (our copy) | release | σ_z (1σ, m) | σ_xy (1σ per axis, m) | what the figure is exactly | source (section / table; URL) | status |
|---|---|---|---|---|---|---|---|
| `pgda78_<tile>_5m`, tiles **Site01, Site04, Site07, Site11** | `<Site>_final_adj_5mpp_surf.tif` (16 km square, 5 m); per-pixel companion `<Site>_final_adj_5mpp_toterr.tif` | PGDA product 78, files dated 2020-06; LOLA data through September 2013, tracks re-adjusted (Barker 2021 §2, §3.1) | **per pixel from `toterr`**; Site01 median **0.37 m** (MADb 0.15), 1 % of pixels > 1 m, max 5.65 m. Across the four sites, median in the RoIs 0.30–0.50 m | **0.14 / 0.12** (X / Y, Site01, 5th iteration) ; abstract: "~10–20 cm horizontally" | σ_z: *median over pixels of the per-pixel RMS over 100 clones* (includes interpolation, track orbit, 10 cm range, sub-pixel sampling; excludes rocks and the ±30 % interpolation-method uncertainty). σ_xy: *MADb of the track offsets after the last iteration* (= 68 % of tracks, MADb equals the standard deviation for normal data); a track-geolocation figure, not a DEM-pixel position error | Barker et al. 2021, PSS 203, 105119, doi:10.1016/j.pss.2020.105119: abstract; §3.1 (p. 5); §4 (p. 8, 10–11), Fig. 12. Open copy: <https://ntrs.nasa.gov/api/citations/20205009660/downloads/Mike%20Barker_%20Paper_%20Improved%20Lola.pdf> ; product page <https://pgda.gsfc.nasa.gov/products/78> | **published** |
| `pgda78_<tile>_5m`, the other 22 tiles (Site06, Site20v2, Site23, Site42, Haworth, Shoemaker, DM1, DM2, SL2, SL3, NPA–NPD, LM1–LM8) | same file pattern, same companions | PGDA product 78, added 2021-04 … 2022-08 (product page update log) | per pixel from `toterr` (the raster is published); **no paper statistic** for these tiles | same 0.12–0.14 as the method is the same, but **no document states it for these tiles** | the product page says only "Continuing work involves applying these methods to other areas". Our own median of each tile's `toterr` is in §6 (computed, not published) | <https://pgda.gsfc.nasa.gov/products/78> | per-pixel raster **published**; scalar statistics **not found** |
| `lola_875s_5m` | `LDEM_875S_5M.IMG/.LBL` | PDS GDR V2.0, created 2017-06-15, LOLA through LRO_ES_54 (stop 2017-02-02), GRGM900C-consistent RDRs | not found (global budget, `assumed`) | not found (global budget, `assumed`) | see §2 for the nearest evidence; no PDS or paper figure for this product | PDS labels, `ERRATA.TXT` release 30, Archive SIS, Smith 2017 Sec. 2, §3.1, §3.7 (all opened) | **not found** |
| `lola_85s_10m`, `lola_80s_20m`, `lola_75s_60m`, `lola_75s_120m`, `lola_60s_240m` | `LDEM_85S_10M`, `LDEM_80S_20M`, `LDEM_75S_60M`, `LDEM_75S_120M`, `LDEM_60S_240M` (`.IMG/.LBL`) | PDS GDR V2.0, 2017-06-15, through LRO_ES_54 | not found (assumed) | not found (assumed) | as above | as above | **not found** |
| `lola_85n_10m`, `lola_80n_20m`, `lola_60n_240m` | `LDEM_85N_10M`, `LDEM_80N_20M`, `LDEM_60N_240M` | PDS GDR **V2.1, 2016-09-15, through LRO_ES_45** (stop 2016-04-21). Not re-released in 2017 (ERRATA release 30) | not found (assumed) | not found (assumed) | the V2.1 north files have more interpolated pixels than the south V2.0 files at every resolution (§5); no document states a different accuracy | as above | **not found** |
| `lola_global_64ppd` | `LDEM_64.IMG/.LBL` | PDS GDR V3.1, created 2019-03-15, through LRO_ES_52 (stop 2016-11-29), GRGM900C | not found (assumed) | not found (assumed) | Smith 2017 Sec. 2: "the topographic uncertainty [is] dominated by gaps in cross-track sampling" (qualitative) | PDS label; Smith 2017 Sec. 2 | **not found** |
| `ldem_512_*_r50km` | `ldem_512_{n18.562_e061.810, s13.316_e025.251, s69.373_e032.319}_r50km.f32`, cut from `LDEM_512_{00N_45N, 45S_00S, 90S_45S}_000_090` | PDS GDR V3.0, created 2017-09-15, through LRO_ES_52, GRGM900C | not found (assumed) | not found (assumed) | as `LDEM_64`; the global tiles are gridded in 45° bands with possible edge artifacts (label) | PDS labels | **not found** |
| `sldem2015_512_*_r50km` | `sldem2015_512_{n18.562_e061.810, s13.316_e025.251, s41.639_e206.015, s45.456_e177.589}_r50km.f32`, cut from `SLDEM2015_512_{00N_30N_045_090, 30S_00S_000_045, 60S_30S_135_180, 60S_30S_180_225}_FLOAT` | SLDEM2015 V2.0, created 2015-09-15, LOLA through LRO_ES_09 (2013-07-18), GRGM900B, merged with Kaguya TC | **3–4 m** ("typical vertical accuracy ∼3 to 4 m"); **[my reading]** σ_z ≈ 3.5 m | **not found** as a product figure (global budget 10 m stays, `assumed`) | RMS vertical residual of the co-registered Kaguya Terrain Camera tiles against unbinned LOLA points; "typical" = the bulk of the tiles, not a bound. 50 % of 1° tiles < 3.4 m (median per-tile RMS after co-registration), 90th percentile 5 m (step 1) | Barker et al. 2016, Icarus 273, 346–355, doi:10.1016/j.icarus.2015.07.039: abstract, §4.1, §6 | vertical **published**; horizontal **not found** |

Sources of the labels: `https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/*.LBL`, `…/CYLINDRICAL/IMG/*.LBL`, `https://imbrium.mit.edu/DATA/SLDEM2015/TILES/FLOAT_IMG/*.LBL` (copies in `data/dem/raw/lola_gdr/` and `data/dem/raw/regional/labels/`).

**Not published for any GDR file:** neither the PDS labels, `GDR_DS.CAT`, `ERRATA.TXT`, the Archive SIS (`archsis.pdf`), the RDR SIS, `DSMAP_POLAR.CAT`, `REF.CAT`, `MISSION.CAT`, the LOLA page at the PDS Geosciences Node, nor Smith et al. 2017 gives a vertical or horizontal accuracy for any `LDEM_*` grid. The orbit-level statements are in §2.

### 1.1 The Barker 2023 figures do **not** apply to our GDR files

Barker et al. 2023 (PSJ 4, 183, doi:10.3847/PSJ/acf3e1) state: "Therefore, we consider 1.00/1.00/0.15 m as a conservative estimate of the final track geolocation errors" (along / cross / radial, Sec. 3). That figure describes the **new track-adjusted PGDA products** (`LDEM_80S_20MPP_ADJ.TIF` etc., PGDA product 90, <https://pgda.gsfc.nasa.gov/products/90>; the paper's Table 1 lists `LDEM_80S_20M` as the "old name"). The paper builds them from the RDR tracks by iterative track adjustment and natural-neighbour gridding, and compares them with "the old (PDS) version". Our `LDEM_80S_20M` is the old PDS product (V2.0, GMT `surface`). **Do not apply 1.00 / 1.00 / 0.15 m to it.** We do not hold product 90.

## 2. What is published about the geolocation behind the GDR products

All are general statements about GRGM900C-era orbits, not accuracies of a gridded map.

| statement | value as printed | statistic | source |
|---|---|---|---|
| LRO reconstructed orbit | "around 10 m in total position and better than 1 m radially" | orbit-overlap analysis plus track-to-model offsets | Smith et al. 2017, Icarus 283, 70–91, Sec. 3.7 (NTRS accepted manuscript <https://ntrs.nasa.gov/api/citations/20160008718/downloads/20160008718.pdf>) |
| same, GRAIL-era | "Typical performance is 50 cm radially and <10 m in total position" | orbit-overlap RMS, along / cross / radial | Mazarico et al. 2018, PSS 162, 2–19, Fig. 10 caption (NTRS 20180007208) |
| LOLA geolocation, headline | "accurate (<10m) geolocation globally" | — | Smith et al. 2017, Highlights |
| Range precision | "10 cm" (flat surface) ; "Surface roughness 1.0 m, 5 meter spot" ; "Slopes 0.3 deg, 25 m baseline" | rms | Smith et al. 2017, Sec. 2 and Appendix Table A1 |
| Crossovers | median RMS elevation residual 1.67 m → 0.48 m after boresight adjustment | median RMS, ~800 000 day/night crossovers, 50 km orbit | Smith et al. 2017, Sec. 2 |
| Original south-polar tracks, offset needed to align them | RMS total A/C/R offsets **8.7 / 9.5 / 0.64 m**; central 68 % widths **7.4 / 7.6 / 0.34 m**; median 0.08 / −1.8 / 0.04 m | track-to-DEM offsets, 80–90°S, "consistent with the estimated LRO orbit reconstruction accuracy" | Barker et al. 2023, Sec. 3 (NTRS 20230014419 <https://ntrs.nasa.gov/api/citations/20230014419/downloads/BarkernewviewSTIupdated.pdf>) |
| Original tracks in the Barker 2023 error model | 7.00 / 7.00 / 0.40 m (A / C / R) | model input | Barker et al. 2023, Sec. 3 |
| Mission requirement for 5 m polar maps | "met the mission requirement of 30-m …" (sentence continues beyond what was read) | requirement, not an achieved accuracy | Smith et al. 2017 |
| Independent interpolation test, 20 m GMT `surface` | standard deviation 0.10 m of removed-and-re-interpolated pixels, reaching ~1 m on steep crater walls | std of residuals, 50 × 50 km at each pole | Gläser et al. 2018, PSS 162, 170–178 (NTRS 20170007365) |

**[my reading] How I would use these for `ProductError` of the GDR polar products, if the engine wants something better than the global budget:** the only horizontal statistic that bears on the south cap is the 68 % width of 7.4 / 7.6 m (σ per axis ≈ 7.5 m) for the original tracks, against RMS 8.7 / 9.5 m. That sits below the 10 m global σ_xy; the global figure therefore remains a defensible and slightly pessimistic choice. Vertically, the radial figure is 0.34 m (68 % width) to 0.64 m (RMS) before gridding; the published radial figures say nothing about the gridded product's pixel error, which is dominated by interpolation and by the horizontal error acting on slopes (σ_z ≈ σ_xy · tan(slope), e.g. 7.5 m × tan 10° = 1.3 m). The 4 m global σ_z is therefore a ceiling, not a published figure, for these products. It is not replaced here, because no document states a gridded-map accuracy. Whether the 2017 south V2.0 grids already contain the track adjustment of Barker 2023 is not stated; Barker 2023 treats the PDS grids as the "old" version, and ERRATA release 30 says only that the south maps were "improved and updated with the addition of new data". **[INFERENCE]** that the V2.0 grids carry roughly the original orbit-error level.

## 3. Release facts as printed in the labels

| product | PRODUCT_VERSION_ID | PRODUCT_CREATION_TIME | STOP_TIME | through phase | notes |
|---|---|---|---|---|---|
| LDEM_875S_5M, 85S_10M, 80S_20M, 75S_60M, 75S_120M, 60S_240M | V2.0 | 2017-06-15 | 2017-02-02T22:18:35 | LRO_ES_54 | label: "RDRs … consistent with the GRAIL 900C primary field"; "about 0.004% of the data have been flagged as erroneous"; tracks interpolated with GMT `mapproject`, `blockmedian`, `surface` |
| LDEM_85N_10M, 80N_20M, 60N_240M | V2.1 | 2016-09-15 | 2016-04-21T21:48:37 | LRO_ES_45 | ERRATA release 27: "no additional data were collected in the north pole, the newly released grids reflect improvements in orbits" |
| LDEM_64 | V3.1 | 2019-03-15 | 2016-11-29T05:48:19 | LRO_ES_52 | "previous version … through LRO_ES_21. An additional 505,763,339 data points have been added"; GMT 5.4.2 `surface`, tension 0.5, anisotropy 0.5; 45° band edge artifacts possible |
| LDEM_512 tiles | V3.0 | 2017-09-15 | 2016-11-29T05:48:19 | LRO_ES_52 | same text |
| SLDEM2015_512 tiles | V2.0 | 2015-09-15 | 2013-07-18T00:10:56 | LRO_ES_09 | "coregistered with Kaguya's SELENE terrain camera data"; GRGM900B |
| PGDA 78 (Site01, Site04, Site07, Site11) | n/a | files 2020-06; clones 2020-10-15 | LOLA data to September 2013 | n/a | Barker 2021 §2 |

Oddity worth knowing: the `LDEC_*` count-map labels (all six read) say V2.1 even for south products whose LDEM label says V2.0. No document explains it; it looks like a label inconsistency, not a different data cut.

## 4. Per-pixel and companion uncertainty products that exist

| product | companion published? | what | where |
|---|---|---|---|
| PGDA 78, all 27 sites | **yes** | `*_toterr.tif` (total Z uncertainty in m, "formally the RMS error"), `*_slperr.tif` (slope uncertainty, degrees, "formally the RMS error"), `*_ldec.tif` (LOLA returns per pixel), `*_slp.tif`, `*.xyzi` (X, Y, Z in km and RDR id), 100 clones, ROI shapefiles for Site01/04/06/07/11 | <https://pgda.gsfc.nasa.gov/products/78>, pattern `https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/<Site>/<Site>_final_adj_5mpp_{surf,ldec,slp,toterr,slperr}.tif` ; `…/<Site>/<Site>_final_adj.xyzi` ; `…/<Site>/Clones/<Site>_final_adj_5mpp_NNNN_err.tif`, NNNN = 0001–0100 ; `…/<Site>/<Site>_ROIs.tgz` |
| PDS GDR polar / cylindrical | count maps `LDEC_*` only (counts per pixel, 0 = interpolated, Smith 2017 Sec. 2). No error raster | | `https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEC_*.IMG` |
| SLDEM2015 | one 1° map `SLDEM2015_DATA_QUALITY_FLOAT` = RMS vertical residual of each 1° TC tile against LOLA (step 1; Barker 2016 Fig. 5 bottom); no per-pixel σ, no slope uncertainty | the label says 120 × 360 but the file is 180 × 360 float32 with NaN poleward of ±60° (my inspection; trust the file size, not the label) | `https://imbrium.mit.edu/DATA/SLDEM2015/GLOBAL/FLOAT_IMG/SLDEM2015_DATA_QUALITY_FLOAT.IMG` |
| Barker 2023 (not held) | `_ERR`, `_EFFRES`, `LDEC` companions | | <https://pgda.gsfc.nasa.gov/products/90> |

Operational notes (observed): PGDA returns HTTP 200 with a 3789-byte HTML "404" page for missing files and for directory URLs (`…/Site01/`, `…/Site01/Clones/` have no listing), so a downloader must check size or content type. The `…/LOLA_5mpp/` index page and `README` are stale (they list only 10 sites); the product page is the complete list. **The "clone" files named `*_err.tif` are absolute-height clones (LDEM plus the error realisation), not error maps:** for `Site01 …_0001_err.tif` I measured clone minus `surf`: median −0.003 m, RMS 0.44 m, 1st / 99th percentile −1.10 / +1.18 m (and value range −523 … 1959 m, like `surf`). All 100 clones per tile are 41–142 MB each; 100 clones of Site01 alone are 4.1 GB.

## 5. Interpolated fraction per product

**Published.** All for polar products of other builds; none for our GDR files.

| quantity | value as printed | product / region | source |
|---|---|---|---|
| 5 m pixels with no direct measurement | "~90% of 5 m LDEM pixels in these study areas are empty"; "data in only ~10% of pixels"; fill factor 5 m: 7–10 %, 20 m: 69–78 %, 40 m: 96–98 % | PGDA 78 Site01 region (16 × 16 km near 89°S) | Barker 2021 §1, §3.3, §4 caveats (p. 12) |
| 20 m fill factor | "~15% to ~75%" ; tracks per tile "~1500 to ~12,500" | whole 80–90°S, product 90 | Barker 2023 Sec. 3–4 |
| 20 m, 50 × 50 km at each pole | north 67 % filled / 33 % interpolated; south 77 % / 23 % | Gläser et al. 2018 DTMs (not GDR) | Gläser et al. 2018 |
| Track geometry at 50 km altitude | cross-track spacing 12 m, along-track 57 m, spot 5 m | | Barker 2021 §2 |
| SLDEM2015, TC share of pixels | **not published** (B16 states only that empty LOLA pixels are filled from the geodetically controlled TC tile, and that 443 tiles, ~1 %, with final RMS > 16 m were replaced by LOLA-only interpolation) | | Barker 2016 §5.1, §5.5 |

**Computed by us (not published): share of pixels with zero LOLA count in the LDEC maps** (`/tmp/terr/fill.py`, by the Smith 2017 definition, count 0 = interpolated), over the circle of each product's latitude limit, V2.0 south (ES_54) and V2.1 north (ES_45):

| product | interpolated, whole product | by latitude band (interpolated) |
|---|---|---|
| `LDEM_875S_5M` | 92.7 % | 87.5–88.75°S 93.1 % ; 88.75–89°S 92.6 % ; 89–90°S 90.7 % |
| `LDEM_85S_10M` | 79.5 % | 85–87.5°S 81.3 % ; 87.5–89°S 75.2 % ; 89–90°S 68.1 % |
| `LDEM_85N_10M` | 90.5 % | 85–87.5°N 93.1 % ; 87.5–89°N 85.0 % ; 89–90°N 70.7 % |
| `LDEM_80S_20M` | 63.9 % | 80–85°S 70.7 % ; 85–89°S 44.1 % ; 89–90°S 23.4 % |
| `LDEM_80N_20M` | 82.7 % | 80–85°N 87.2 % ; 85–89°N 70.8 % ; 89–90°N 27.0 % |
| `LDEM_75S_60M` | 29.2 % | 75–82.5°S 35.6 % ; 82.5–89°S 10.0 % ; 89–90°S 0.4 % |
| `LDEM_75S_120M` | 9.4 % | 75–82.5°S 12.1 % ; 82.5–89°S 1.2 % |
| `LDEM_60S_240M` | 6.0 % | 60–75°S 7.5 % ; 75–89°S 1.1 % |
| `LDEM_60N_240M` | 27.9 % | 60–75°N 32.4 % ; 75–89°N 13.9 % |
| `LDEM_64`, `LDEM_512`, `SLDEM2015_512` | not computed (the equatorial gaps are ~500 m wide in a 2013 LOLA-only map at 512 ppd, Barker 2016 §5.2) | |

For the PGDA tiles the fraction computed from each tile's `ldec` is in §6.

**What the publications say about error in interpolated pixels.**
- PGDA 78: "Interpolation error dominates in empty pixels" (Barker 2021 §4). The model ε = a·R + b·S + c, R = effective resolution (m) = 1/√(LOLA point areal density), S = slope (°); Site01: a = 0.0210, b = 0.0051, c = −0.022 (Table 1; Site04 0.0137 / 0.0074 / −0.006; Site07 0.0209 / 0.0042 / −0.0400; Site11 0.0186 / 0.0054 / −0.036). "Fits the central 50 % of the data to within ~30 %". Filled pixels: error is dominated by sub-pixel sampling and is bounded by about 2.5·√2·tan(slope) m; 2 % of filled pixels exceed 1 m, maximum 3.31 m. Interpolation-method uncertainty: "We, therefore, take 30% as the uncertainty due to interpolation method". Rocks and boulders are not included; single-spot RMS height variation is "~0.4–0.6 m over highlands terrain".
- First estimate from leave-track-out residuals: MADb 0.42 m (Barker 2021 §3.1).
- GDR polar files: no published error in interpolated pixels; Gläser 2018 gives 0.10 m std for re-interpolating every third pixel at 20 m (a different product).
- SLDEM2015: LOLA-only gaps are "∼500 m wide near the equator and ∼50/100 m wide at −80°/+80°"; "LOLA interpolation has a typical error of <1 m over the maria … higher over the highlands" (Barker 2016 §5.2, Fig. 10; map only, not tabulated).

## 6. Per-tile statistics of the published `toterr` and `ldec` rasters (computed by us)

These are **our statistics of the rasters that PGDA publishes with each tile**, not figures printed in a paper. Method: each `<Site>_final_adj_5mpp_toterr.tif` and `<Site>_final_adj_5mpp_ldec.tif` was downloaded from `https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/<Site>/`, read with rasterio as float32, finite pixels only; `fill` = pixels with LDEC count > 0; `interpolated` = the rest. Script: throwaway, not in the repository. Site20 (the original, not held) was also read and is omitted. The `toterr` raster is "Total Z uncertainty in meters (formally, the RMS error)" (PGDA page; Barker 2021 §4: RMS over the 100 clones per pixel).

| product id | pixels | toterr median (m) | p90 | p99 | max | % pixels > 1 m | % interpolated (LDEC = 0) |
|---|---|---|---|---|---|---|---|
| `pgda78_site01_5m` | 10,240,000 | 0.37 | 0.63 | 0.99 | 5.6 | 1.0 | 90.5 |
| `pgda78_site04_5m` | 10,240,000 | 0.36 | 0.69 | 1.20 | 7.6 | 2.3 | 90.8 |
| `pgda78_site06_5m` | 16,000,000 | 0.64 | 1.12 | 1.80 | 8.0 | 15.5 | 94.3 |
| `pgda78_site07_5m` | 10,240,000 | 0.39 | 0.67 | 1.06 | 5.2 | 1.4 | 92.8 |
| `pgda78_site11_5m` | 10,240,000 | 0.37 | 0.62 | 0.95 | 6.2 | 0.8 | 91.9 |
| `pgda78_site20v2_5m` | 27,040,000 | 0.59 | 1.03 | 1.57 | 8.5 | 11.2 | 93.3 |
| `pgda78_site23_5m` | 17,640,000 | 0.46 | 0.79 | 1.21 | 15.9 | 2.9 | 89.8 |
| `pgda78_site42_5m` | 16,000,000 | 0.57 | 1.05 | 1.69 | 25.7 | 12.0 | 95.9 |
| `pgda78_haworth_5m` | 35,521,600 | 0.37 | 0.63 | 1.02 | 8.6 | 1.1 | 89.4 |
| `pgda78_shoemaker_5m` | 16,000,000 | 0.34 | 0.58 | 0.92 | 9.6 | 0.6 | 92.2 |
| `pgda78_dm1_5m` | 16,000,000 | 0.77 | 1.60 | 2.63 | 24.4 | 32.7 | 97.7 |
| `pgda78_dm2_5m` | 16,000,000 | 0.56 | 1.11 | 1.82 | 24.3 | 14.0 | 97.4 |
| `pgda78_sl2_5m` | 16,000,000 | 0.36 | 0.60 | 0.93 | 7.0 | 0.7 | 92.4 |
| `pgda78_sl3_5m` | 16,000,000 | 0.41 | 0.71 | 1.12 | 7.8 | 1.9 | 94.2 |
| `pgda78_npa_5m` | 16,000,000 | 0.48 | 0.86 | 1.36 | 5.5 | 5.2 | 94.1 |
| `pgda78_npb_5m` | 16,000,000 | 0.93 | 1.98 | 3.26 | 26.0 | 45.3 | 98.1 |
| `pgda78_npc_5m` | 16,000,000 | 0.49 | 0.99 | 1.63 | 12.8 | 9.8 | 96.6 |
| `pgda78_npd_5m` | 16,000,000 | 0.45 | 0.83 | 1.31 | 5.5 | 4.3 | 94.8 |
| `pgda78_lm1_5m` | 16,000,000 | 0.34 | 0.61 | 1.05 | 5.9 | 1.2 | 90.1 |
| `pgda78_lm2_5m` | 16,000,000 | 0.35 | 0.58 | 0.90 | 7.1 | 0.6 | 92.6 |
| `pgda78_lm3_5m` | 16,000,000 | 0.38 | 0.64 | 0.98 | 6.5 | 0.9 | 92.7 |
| `pgda78_lm4_5m` | 16,000,000 | 0.34 | 0.58 | 0.88 | 5.0 | 0.5 | 91.6 |
| `pgda78_lm5_5m` | 16,000,000 | 0.37 | 0.62 | 0.95 | 5.3 | 0.7 | 94.5 |
| `pgda78_lm6_5m` | 16,000,000 | 0.40 | 0.65 | 1.00 | 5.9 | 1.0 | 94.8 |
| `pgda78_lm7_5m` | 16,000,000 | 0.46 | 0.77 | 1.20 | 8.3 | 2.9 | 94.9 |
| `pgda78_lm8_5m` | 16,000,000 | 0.36 | 0.61 | 0.91 | 7.3 | 0.5 | 91.9 |

Checks against the paper (Site01): median 0.372 m (paper 0.37 m), 0.95 % of pixels above 1 m (paper "~1 %"), maximum 5.58 m (paper 5.65 m; the 0.07 m difference is unexplained, possibly a later reprocessing of the file), 90.5 % interpolated (paper "~90 %"; fill factor 7–10 %). For Site04/07/11 the medians are 0.360 / 0.387 / 0.366 m, inside the paper's "~0.30–0.50 m" for RoIs.

Across the 26 tiles the median `toterr` ranges from 0.34 m to 0.93 m (median of medians 0.40 m). The tiles with the largest errors are `pgda78_npb_5m` (median 0.93 m, 45.3 % of pixels above 1 m, 98.1 % interpolated), `pgda78_dm1_5m` (0.77 m, 32.7 % above 1 m, 97.7 % interpolated), `pgda78_site06_5m` (0.64 m, 15.5 % above 1 m) and `pgda78_site20v2_5m` (0.59 m). **These later tiles have no paper statistic; their error is only the raster.** The interpolated share is 89.4–98.1 % in all 26 tiles, so the paper's "~90 %" holds for the whole product, not just Site01 (sparsest: `pgda78_npb_5m` 98.1 %, `pgda78_dm1_5m` 97.7 %, `pgda78_dm2_5m` 97.4 %).

## 7. Barker et al. 2021 Table 2 (Site 01), how the clones were made, and the check of `docs/validation/scenario.md` §11.6

Source: Barker et al. 2021, §5 and Table 2 (p. 8), read in the NTRS corrected proof; all 21 numeric rows were compared programmatically with the PDF text. The final issue and the supplementary figures S1–S19 (other sites) were not opened (ScienceDirect returned HTTP 403).

### 7.1 What Table 2 lists

- **Statistics per region of interest: only pessimistic percentiles of the 100 clones.** "Avg ill-1" = 1st percentile of average illumination (%); "LCIP-1" = 1st percentile of the longest continuous illumination period (days); "LCSP-99" = 99th percentile of the longest continuous shadow period (days). **No nominal-DEM value, no mean, no σ, no 5th / 95th percentile.** (With 100 clones, 1st / 99th ≈ minimum / maximum; §5: "the min/max values of the box plots (x symbols in Fig. 19) correspond to the 1st/99th percentiles listed in Table 2, A rows".) The nominal LDEM, old LDEM, mean, median, quartiles and 9th / 91st percentiles are shown only graphically in Fig. 19, for Δz = 1 m; per-pixel 1st / 99th percentile and σ maps are Figs. 16–18.
- **Heights: Δz = 1 m and 5 m above the surface.** The caption: "at Δz = 1 m and 5 m above the surface". No 0, 2 or 10 m. (`docs/validation/scenario.md` §11.6 says it "did not establish which mast height" — it is 1 m and 5 m, and §11.6 already evaluates both.)
- **Regions of interest.** Seven RoIs at Site 1, unnamed, defined in §5 as "connected pixels (corners or sides touching) with average illumination > 70% at Δz = 1 m and with total area >2500 m²". **The RoI outlines are published**: `https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site01/Site01_ROIs.tgz` (2934 bytes; I extracted it: ESRI polygon shapefile `Site01_ROIs.shp/.dbf/.shx/.prj`, 7 polygons, south polar stereographic on the 1737.4 km sphere, coordinates in metres). Bounding boxes (m): RoI1 (−11657.5, −12517.5) to (−11522.5, −12407.5); RoI2 (−11537.5, −12637.5) to (−11447.5, −12477.5); RoI3 (−11392.5, −12542.5) to (−11297.5, −12467.5); RoI4 (−11372.5, −12267.5) to (−11212.5, −12052.5); RoI5 (−11177.5, −12052.5) to (−11002.5, −11857.5); RoI6 (−10887.5, −11787.5) to (−10727.5, −11682.5); RoI7 (−10277.5, −11607.5) to (−10167.5, −11492.5). The `.dbf` holds the centroids printed in Table 2. (`scenario.md` §11.6 says "the RoI outline is not published"; it is, for Site01, 04, 06, 07 and 11 on the product page.)
- **Cases.** (A) "percentiles are computed after averaging the RoI for each clone"; (B) "percentiles are computed separately for each pixel and then averaged over the RoI" (pessimistic); (C) "same as (A) but considering only the most illuminated pixel at each hourly time step" (optimistic, a roving lander).
- **Definitions** (§5, Fig. 14 caption). Average illumination: "the average visible fraction of the Sun's disk over the 2 years sampled at 1 h intervals". LCIP: "the longest uninterrupted period when any fraction of the Sun is visible". LCSP: "the longest uninterrupted period when none of the Sun is visible". Case C: "LCIP/LCSP includes time steps when any/no pixel in the RoI sees any part of the Sun".
- **Time span and step.** 2024-01-01 to 2026-01-01; hourly ("The computations are performed in Cartesian coordinates at 1-h intervals").
- **Sun.** A finite disc, "a 2-dimensional extended source with limb darkening at 550 nm"; the visible fraction "is approximated by horizontally dividing the disk at the horizon's elevation measured at the disk center's azimuth" (a different disc integration from a true per-azimuth one).
- **Horizon method.** Mazarico et al. 2011: 720 sight lines 0.5° apart; nested grids: the new 5 m LDEM within 5 km, the original 80 m LDEM from 5 to 100 km, 240 m beyond. Only the 5 m near field is perturbed per clone; "the un-adjusted orbital errors in the lower-resolution far-field LDEMs do not significantly impact the results" (far-field horizon "~3 orders of magnitude farther"). The frame is MOON_ME of DE421 (§2). The Sun ephemeris is not separately named in the paper **[INFERENCE: DE421]**.

Table 2 as printed (Site 1; X, Y = centroids in km, minus signs restored from the PDF glyph, consistent with the Fig. 11 text "(−11, −12) km" and with the shapefile above):

| | | | RoI1 | RoI2 | RoI3 | RoI4 | RoI5 | RoI6 | RoI7 |
|---|---|---|---|---|---|---|---|---|---|
| X (km) | | | −11.5825 | −11.4875 | −11.3525 | −11.2875 | −11.1025 | −10.8025 | −10.2275 |
| Y (km) | | | −12.4625 | −12.5575 | −12.5025 | −12.1675 | −11.9425 | −11.7375 | −11.5525 |
| Area (m²) | | | 8625 | 7550 | 3825 | 13300 | 10075 | 10000 | 7075 |
| Δz = 1 m | Avg Ill-1 (%) | A | 68.03 | 70.32 | 67.51 | 69.61 | 70.38 | 71.15 | 67.36 |
| | | B | 49.30 | 55.57 | 57.60 | 52.19 | 56.25 | 56.56 | 53.72 |
| | | C | 85.84 | 85.75 | 77.31 | 86.81 | 84.47 | 86.74 | 83.44 |
| | LCIP-1 (d) | A | 63.35 | 113.80 | 117.86 | 136.49 | 142.17 | 81.01 | 100.23 |
| | | B | 25.55 | 53.68 | 63.21 | 56.64 | 66.19 | 44.86 | 67.51 |
| | | C | 205.38 | 205.08 | 176.80 | 232.50 | 193.40 | 205.80 | 117.71 |
| | LCSP-99 (d) | A | 16.55 | 17.84 | 22.23 | 13.27 | 15.24 | 12.74 | 14.54 |
| | | B | 28.56 | 28.69 | 28.10 | 26.92 | 28.03 | 19.79 | 28.25 |
| | | C | 10.46 | 10.71 | 15.79 | 4.58 | 4.96 | 4.71 | 5.04 |
| Δz = 5 m | Avg Ill-1 (%) | A | 89.26 | 88.51 | 84.53 | 88.12 | 85.71 | 87.35 | 82.79 |
| | | B | 88.21 | 87.82 | 83.64 | 87.43 | 84.94 | 86.97 | 82.47 |
| | | C | 91.83 | 91.24 | 89.78 | 91.11 | 88.38 | 89.05 | 84.98 |
| | LCIP-1 (d) | A | 215.79 | 216.28 | 216.89 | 231.20 | 218.98 | 220.98 | 119.07 |
| | | B | 210.59 | 211.88 | 211.20 | 230.20 | 215.70 | 220.80 | 118.37 |
| | | C | 232.50 | 233.00 | 233.30 | 233.40 | 221.10 | 221.90 | 174.92 |
| | LCSP-99 (d) | A | 5.29 | 7.31 | 8.41 | 4.00 | 4.52 | 4.16 | 5.42 |
| | | B | 6.14 | 7.95 | 9.56 | 4.30 | 4.90 | 4.41 | 5.52 |
| | | C | 3.67 | 5.29 | 5.54 | 3.71 | 3.79 | 3.12 | 4.58 |

Paper's own reading (§5): "the illumination conditions predicted for the new (non-clone) LDEM … tend to be better than the mean/median of the clones … because the perturbations in the clones are more likely to raise than lower the horizon elevation"; "The LDEM uncertainties have an almost negligible effect on the illumination conditions at Δz = 5 m at all sites". Only 1 m and 5 m were studied; **Earth visibility is not studied at all.**

### 7.2 How the clones were made (§4, Fig. 11)

1. Smooth the LDEM: remove every LOLA point and its 3 × 3 pixel neighbourhood and re-interpolate ("similar to smoothing with a Gaussian with σ ~15 m"; features larger than ~200 m unchanged).
2. Merge it with a high-pass artificial random fractal terrain, Hurst exponent H = 1, at baselines ≲ 200 m (the scale at which a pure fractal loses ~10 % of its power after interpolation).
3. Sample this terrain at the real LOLA point locations, "randomly perturbed by the track geolocation errors, σx/σy/σz, (according to each track's error-covariance matrix) and 10 cm range (Z) precision", then re-interpolate with the same method (GMT `surface`, tension 0.75).
4. The difference between the re-interpolated and the simulated surface is "a random realization of the errors", added back to the LDEM to give the clone. 100 clones per site.

Per-track offset distribution: drawn from each track's formal error covariance (X/Y/Z correlated); typical σ ~10–20 cm horizontal, ~2–4 cm vertical (§4); per-track σ values are not tabulated, and the word "Gaussian" is not printed for this draw (**[INFERENCE]** normal). Noise in gaps: no separate additive noise; the gap error is the difference between the fractal "truth" and its re-interpolation, so it is a property of the fractal surface (H = 1) and the gap geometry. Interpolation is repeated per clone. The ±30 % interpolation-method uncertainty is not in the clones (a separate T = 0 vs T = 0.75 experiment raised the Z and slope errors by a median factor ~1.1, MADb 0.2).

### 7.3 Check of `ScenarioCore`'s assumption (`scenario.md` §11.6)

- "1st percentile of average illumination and of LCIP, 99th percentile of LCSP": **correct** (caption).
- Mast heights: **1 m and 5 m** (above the local surface).
- Case: the table has three cases; §11.6 compares against case **A** (RoI averaged per clone). Case A is the right comparison for an average over the RoI; case B is Barker's pessimistic per-pixel average; case C is the roving optimistic case.
- The comparison is **one-sided**: a published 1st or 99th percentile is a pessimistic bound of a distribution, not its centre. Barker's nominal DEM is better than the clone median, which is better than the 1st percentile. A model run on the nominal DEM should sit **above** the 1st percentile of average illumination and of LCIP and **below** the 99th percentile of LCSP. Any "residual" of the wrong sign (our value below the 1st percentile, or our LCSP above the 99th) is a failure; a residual of the right sign measures only how far the nominal DEM sits from the worst clone.
- §11.6 averages over a disc around each centroid because the RoI outline was thought unpublished; the outlines are published (above), so a like-for-like pixel mask can be built from `Site01_ROIs.shp`.
- Differences of method that Barker's numbers carry: finite-disc approximation by one horizon elevation at the disc-centre azimuth; hourly step; 720 azimuths; horizon only within the nested 5 / 80 / 240 m grids; DE421 frame; LOLA data through September 2013 (our tile is the same file).

## 8. Spatial correlation of height errors and horizon uncertainty

**No numeric correlation length and no horizon-elevation uncertainty in degrees is published in any document I opened** (Barker 2021, 2023, 2016; Smith 2017; Mazarico 2018; Gläser 2018; PDS documents).
What exists, all qualitative or graphical:
- Barker 2021 Fig. 15 plots the near-field horizons of the nominal LDEM and of all 100 clones seen from Δz = 1 m at the seven RoI centroids (graphical only; no degrees are quoted). The near-field horizon is "roughly 100 m away (though sometimes as low as 10s of m, or as high as ~1 km)", the far-field one "roughly 50–200 km away" (§5).
- The full error covariance of an LDEM ("a ~10 million by 10 million non-sparse matrix") was judged "prohibitive" and replaced by the clone ensemble (§4). Errors are injected only at baselines ≲ 200 m. Track errors are correlated along a track through the shared per-track offset (covariance of X/Y/Z per track).
- Barker 2021 §5 on case B: "the chances of all pixels within a RoI having the same percentile error is likely smaller than a single pixel even considering their correlations" — correlation acknowledged, not quantified.
- Barker 2021 Fig. 13 / Table 1: interpolation error scales with the effective resolution (gap size, ~ the distance to the nearest data); in filled pixels it is bounded by pixel size times slope. This implies an error correlation length of the order of the gap size (tens to a few hundred metres at 5–20 m posting), **[INFERENCE]**, not a published length.
- Barker 2016 §5.1: ripples of "characteristic wavelength of ∼1.2° and amplitude ∼1.5 m" in SLDEM2015 over flat terrain (a systematic, long-wavelength error; ∼36 km at the equator).
- Barker 2016 §4: SLDEM2015 TC tile shifts of σ 12.1 / 16.8 / 1.9 m (X / Y / Z), tilts σ 2.4 / 1.9 m per degree; recovery precision of the co-registration in simulation "∼0 ± 2 m horizontally and 0.0 ± 0.2 m vertically" per tile and "∼0 ± 8 m horizontally, 0.0 ± 0.6 m vertically" per profile — the nearest published proxy for SLDEM2015 horizontal registration (not a product accuracy).
- The only way to obtain a horizon-elevation spread from published material is the clone ensemble: for the PGDA tiles, `LDEM + clone` is public (100 files per tile). That is an input for a Monte-Carlo, not a published horizon σ.

## 9. Other statements an engineer should know

- SLDEM2015 vertical figure: "typical vertical accuracy ∼3 to 4 m" is "not an independently measured absolute error" — it is the RMS residual of the co-registered TC tiles against LOLA, combined by the authors with the "∼1 m" LOLA absolute vertical accuracy (Barker 2016 §6, citing Mazarico et al. 2013; not opened). Retroreflector check (§5.1, Table 1, five near-side points): RMS 2.44 m (SLDEM2015), 3.97 m (SLDEM2013), 10.90 m (GLD100), 0.65 m (LOLA-only 512 ppd of that era). Per site (SLDEM2015, m): Apollo 11 −2.81, Apollo 14 −0.13, Apollo 15 −0.59, Lunokhod 1 −4.39, Lunokhod 2 +1.48. The paper: "there is some noise of amplitude ∼2 to 3 m remaining in SLDEM2015".
- SLDEM2015 location dependence: no latitude dependence inside ±60° is published; "areas of high slopes … tend to have larger absolute residuals" (not quantified). My own statistics of the 1° data-quality raster (not published): median 3.44 m, mean 4.07 m, p90 4.95 m, p99 16.2 m; 10° latitude-band medians 3.32–3.62 m, no increase toward ±60°; 9.8 % of 1° cells exceed 5 m. The poorest regions named by the paper: South Pole–Aitken (45–60°S, 140–210°E; "lower-resolution MI DEMs") and the western edge of Orientale (45°S–15°N, 230–260°E; Kaguya orbit problems). **Our tile sldem2015_512_s45.456_e177.589 (45.5°S, 177.6°E) lies inside that SPA box (45–60°S, 140–210°E); tile sldem2015_512_s41.639_e206.015 (41.6°S, 206.0°E) has the longitude of SPA but sits 3.4° north of the stated latitude range.** Barker 2016 gives no pixel mask of MI-filled areas. **[my reading]** Treat the tail of the distribution (p90 5 m, p99 16 m of the data-quality raster) as the relevant figure there rather than 3–4 m.
- Barker 2016 co-registration shifts: tile-averaged TC offsets median absolute 8.3 / 18.2 / 1.6 m (X / Y / Z), σ 12.1 / 16.8 / 1.9 m; "about 3 m eastward, 16 m northward, and 1 m outward" global median shift of the TC frame; LOLA profile corrections median absolute 9.3 / 7.0 / 0.6 m, σ 14.2 / 10.5 / 1.0 m; pseudo-crossover residual σ 6.8 / 6.4 / 0.6 m ("an upper limit on the random error of the individual 3D profile offsets"). SLDEM2015 effective resolution ≈ 512 ppd ("we adopt 512 ppd as the effective resolution"): spectra show a cut-off at ~100–200 m. Mean radius 1737.1512 km ("10 cm smaller than the mean radius derived from the LOLA-only DEM").
- Frame: LOLA-team products are in ME/PA of DE421; "The orientation of this frame in this ephemeris has an overall uncertainty of a few meters with respect to the principal axis frame" (Barker 2021 §2). This is a common-mode shift of the whole DEM relative to the principal-axis frame, not part of the track σ.

## 10. What I recommend the engine reads from this (my reading, for the owners of `terrain/sources.py`)

1. **PGDA 78, Site01/04/07/11:** per-pixel σ_z from `toterr` (median 0.37 m; `published`); σ_xy 0.14 m per axis (`published`, track geolocation). Add the ±30 % interpolation-method uncertainty (Barker 2021 §4) as a factor 1.3 on σ_z if a conservative bound is wanted. The paper's clones are 1st / 99th percentile cases of exactly this error model.
2. **PGDA 78, the other 22 tiles:** the `toterr` raster is the product's own per-pixel RMS, published with the tile; the scalar statistics of the paper do not cover these tiles. §6 shows that some of them are markedly worse than Site01 (e.g. Site06 median 0.64 m, 15.5 % of pixels > 1 m). Use `toterr`; mark the basis `published (product raster, no paper)`.
3. **GDR polar, LDEM_64/512:** no published figure; keep 4 m / 10 m `assumed`. The south polar horizontal evidence (§2) supports 10 m as slightly pessimistic.
4. **SLDEM2015:** σ_z 3.5 m `published (range 3–4 m, "typical")`; σ_xy keep 10 m `assumed`.
5. **Do not use** Barker 2023's 1.00 / 1.00 / 0.15 m on any file we hold.

## 11. Not opened or not found (UNVERIFIED)

| item | what I tried |
|---|---|
| Mazarico et al. 2012, J. Geodesy 86, 193–207, doi:10.1007/s00190-011-0509-4 | Springer (bot check), Unpaywall (not OA), Semantic Scholar (closed), NTRS, Europe PMC, LPSC abstract 2423. Cited only second-hand through Smith 2017 ("Orbit overlaps better than 20m") and Mazarico 2018; these apply to pre-GRAIL orbits |
| Mazarico et al. 2013 (the "∼1 m absolute vertical accuracy of LOLA") | not opened; the figure is quoted from Barker 2016 §6 |
| Barker 2021 final issue version and supplementary Figs. S1–S19 | ScienceDirect 403; the NTRS corrected proof was read |
| Barker 2023 RDR release / data cut of the 20 m product; a single RMS-height figure against the GDR | not in the text read; the `_ERR` rasters carry per-pixel values |
| Any PDS statement of vertical or horizontal accuracy per LDEM | none exists in the labels, `GDR_DS.CAT`, `ERRATA.TXT`, `archsis.pdf`, `rdrsis.pdf`, `DSMAP_POLAR.CAT`, `REF.CAT`, `MISSION.CAT`; `AAREADME.TXT` returned 404 at the imbrium root; no GDR-specific SIS exists in `…/DOCUMENT/` |
| Smith 2017 crossover histogram annotations (radial RMS 1.22 m, cross 8.72 m, along 13.58 m; N = 354 840) | read from the figure text; the figure-to-caption mapping is my inference (probably Fig. 17, 50 km orbit before December 2011); do not use as GDR accuracy |
| Smith 2017 sentence on the "mission requirement of 30-m" for the 5 m polar maps | the rest of the sentence was not read |
| SLDEM2015: TC share of pixels, absolute horizontal accuracy, slope error | not published in Barker 2016, Smith 2017, labels or READMEs |
| Whether V2.1 north grids use the same RDR orbits as V2.0 south | not stated |
| Whether the south V2.0 grids contain a track adjustment like Barker 2023's | not stated |
| Sun ephemeris of the Barker 2021 illumination run; per-axis σ of each track; normal distribution of the offset draw | not printed |

## 12. Sources opened

| key | document | URL | how obtained |
|---|---|---|---|
| B21 | Barker et al. 2021, PSS 203, 105119 | https://ntrs.nasa.gov/api/citations/20205009660/downloads/Mike%20Barker_%20Paper_%20Improved%20Lola.pdf | NTRS corrected proof, 16 pp. |
| B21 page | PGDA product 78 and `README` | https://pgda.gsfc.nasa.gov/products/78 ; https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/README (copy `data/dem/raw/pgda78/README`) | HTML / text |
| B23 | Barker et al. 2023, PSJ 4, 183 | https://ntrs.nasa.gov/api/citations/20230014419/downloads/BarkernewviewSTIupdated.pdf ; https://iopscience.iop.org/article/10.3847/PSJ/acf3e1/pdf | PDF |
| B16 | Barker et al. 2016, Icarus 273, 346–355 | Wayback copy of the MIT DSpace PDF `http://web.archive.org/web/20250614152525id_/https://dspace.mit.edu/bitstream/handle/1721.1/118411/1-s2.0-S0019103515003450-main.pdf` (ScienceDirect 403, DSpace 429, NTRS has the citation only) | PDF |
| S17 | Smith et al. 2017, Icarus 283, 70–91 | https://ntrs.nasa.gov/api/citations/20160008718/downloads/20160008718.pdf | NTRS accepted manuscript (page numbers are manuscript pages) |
| M18 | Mazarico et al. 2018, PSS 162, 2–19 | NTRS 20180007208 | PDF |
| L14 | Lemoine et al. 2014, GRL 41, 3382 | Europe PMC PMC4459205 | text; no LOLA geolocation statement |
| G18 | Gläser et al. 2018, PSS 162, 170–178 | NTRS 20170007365 (preprint) | PDF |
| PDS | labels, `ERRATA.TXT`, `GDR_DS.CAT`, `archsis.pdf`, `rdrsis.pdf`, `sldem2015.txt`, SLDEM2015 READMEs | https://imbrium.mit.edu/ (`DATA/LOLA_GDR/POLAR/IMG/`, `…/CYLINDRICAL/IMG/`, `DATA/SLDEM2015/`, `DOCUMENT/`, `CATALOG/`, `ERRATA.TXT`) | text |
