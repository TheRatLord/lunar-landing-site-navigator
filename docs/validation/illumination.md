# Illumination validation and the regional layer

This document checks two things. (1) The exact per-site illumination chain (`lunarnav.ephem` + `terrain` + `horizon` + `visibility`) is compared with
published illumination products. (2) The fast regional layer `lunarnav.regional` is compared with the exact engine.
All numbers below are cached in `data/validation/illumination/`. Unless stated otherwise, differences are **engine minus published**, in percentage points.

Status of the reruns: every number comes from one run of the checks in the order listed in section 9. I did **not** rerun the whole
set a second time from an empty results directory, because of the time budget. One clean pass after the addressing fix produced the registration experiment, the baseline and the uniform sample.
Nothing was edited between a run and its reported output.

## Summary for planners: how far to trust the regional layer

The regional layer (`python -m lunarnav.regional`, `compute_layers`) is a fast estimate over an area. The per-site exact engine is the reference.
The figures below give the accuracy **at the shipped defaults on the default
terrain stack**, as regional minus exact. The defaults are: observer 0 m, Sun and Earth `any_part`, 360 azimuths, hourly 2024-2026, 32 calibration cells. The check used 960 independent cells in five areas (section 7.2).

* Average illumination, sun mean flux and sunlit fraction (`supported`): mean error 0.08 points, 95th percentile 0.22, maximum 0.30-0.37 points. The regional value is always on the optimistic side.
* Earth fraction (`approximate`): mean 0.05, p95 0.15, p99 0.26, **maximum 1.18 points**.
* Longest sunlit run (`approximate`): mean 0.8 h, p95 1 h, maximum 80 h.
* Longest shadow (the longest dark span) and longest Earth outage (`bracket_only`): p95 2 h, but **maximum 8920 h and 647 h**. Show only the estimated bracket. A reliable point value comes from the site search, which uses the exact engine.
* The `_lo`/`_hi` layers are **estimated brackets, not bounds**. They missed the exact value in 0-4 of 960 cells per layer: longest shadow 4, Earth outage 2, Earth fraction 2, sun mean flux 1, longest sunlit 1, the others 0. The bracket is 1.6 points wide (p95 3.2) for the Sun layers and 12 h wide (p95 1408 h) for the longest shadow.
* These figures were re-measured on 2026-11-15 with horizon engine `horizon-bnb/5`. In that version the search starts one pixel of the ground store out, in both kernels (`docs/validation/horizon.md` 2.5). The sections below that quote the earlier measurement (mean 0.11, Earth maximum 6.47 and so on) describe engine `/4`. The bracket widths in the line above were not re-measured.
* **Cells within 2 cells of a change of terrain product are not reliable.** These are 0-2.6 % of cells. Their horizon error is up to 19 deg. They carry flag bit 8, and their verdict is -128.
* Every run measures its own error and bracket widths and prints them in `header.json` and the GeoTIFF tags. The validated figures above are printed beside them, with the configuration they hold for (`applies_to_run`).
* The engine itself against the published `AVGVISIB_85S_060M` (section 3): Sun mean 0.59 points, p95 2.72. **Earth p95 6.27 misses the 5-point target.** At the published maximum pixel the published value is 88.44 % and the engine gives 84.38 %.
* **The shipped default does not reproduce the published 88 % at the published-maximum pixel. Observer height decides it.** At the default observer height of 0 m, the 8 output cells inside that pixel average 47.7 %. The brightest output cell near it (cell row 466, col 536) gives exact 55.8 % and regional 55.9 %. With a 2 m observer height the same cell gives 90.4 % exact and 90.7 % regional. The same crest-cell check computed both pairs: exact 55.822 and 90.425 %, regional 55.891 and 90.744 %. The section 10 run-1 GeoTIFF gives 55.891 % at that cell. These use the default stack hash `241d5855d6be`, 2024-2026 hourly, any-part Sun. The same check gives 84.381 % for the exact engine at the published-maximum pixel on the 60 m store, against 88.444 % published. An earlier run with a 2 m observer height averaged 88.67 % over the 8 cells. A planner who compares with studies that assume an elevated observer (for example 2 m) must set the observer height (`--mast`, `mast_height_m`). The default is ground level. There, 5 m terrain blockers a few metres away shade the crest.

## 1. Like-with-like definitions

The engine settings below match the published product's definitions.

| Item | Published product | Engine setting |
|---|---|---|
| Quantity | fraction of time steps with any part of the Sun disc above the horizon (`AVGVISIB`), Earth likewise (`_EARTH`) | `stats_for_sites` index 2: any-part-of-extended-disc visible |
| Period / step | 18.6 years from 2020 (start year not documented in the label; see 8), hourly | `cycle_period(2020)`, 3600 s |
| Observer | surface, zero height | `mast_m = 0` |
| Terrain | `LDEM_85S_060M` (not published; 404) | `lola_75s_60m` = 2017 GDR `LDEM_75S_60M` (same lattice and convention, different gridding) |
| Horizon | tiled terrain horizon | exact engine `horizon_arrays`, 720 azimuths, full range |

Raster addressing uses 0-based `line` and `sample`, with `O = n/2 - 0.5`: `x = (sample - O) px`, `y = (O - line) px`. The evidence for this is in 2.

## 2. Registration finding (a defect in our earlier addressing, not in the engine)

The first runs used `x = (sample+1-O) px`, `y = (O-(line+1)) px`. This is one pixel off. The engine itself gives the evidence:

* Top-50 published pixels: the mean |engine - published| is 32.3 points at the old position and 4.4 at the corrected one. An offset scan in 30 m steps over ±60 m has its minimum at (0,0). The other 24 offsets give 20-39 points. The best offset per pixel is (0,0) for 33 of 50 pixels. It is (-60,0) for 5 pixels, (0,-60) for 4 pixels and elsewhere for 8.
* 100 random sunlit pixels: the error falls from 1.6 to 0.9 points. The offset scan has its minimum at (0,0).
* Barker et al. 2023 map of permanently shadowed regions (PSR), `LPSR_80S_20MPP_ADJ.TIF`, against the PSR flags of the three LOLA (Lunar Orbiter Laser Altimeter) rasters, 600,000 random pixels each. The values are agreement for the catalogue formula / the old formula / the three other one-pixel shifts: 85S_060M 99.27 / 98.37 / 98.35-98.37 %; 75S_120M 99.37 / 98.55 / 98.57-98.64 %; 65S_240M 99.14 / 98.00 / 98.03-98.11 %.
* The earlier axis-flip check could see only flips, not a one-pixel offset.
* With the corrected addressing, the published maximum 88.444 % is at x=-10770 m, y=-11730 m (lat -89.4749, lon 222.5569 E). It is not at the earlier -89.4747, 222.2519.
* The same fix applies to the LROC WAC image (Lunar Reconnaissance Orbiter Camera, Wide Angle Camera). The PDS3 image starts at byte 9712 (two 4856-byte label records), not at 4856. With this fix the argmax is at (-2800, -7400) m, which matches the published location. There are 1,155,716 valid pixels.

## 3. AVGVISIB_85S_060M: Sun and Earth

### 3.1 Headline: uniform random sample (n = 1500 pixels, rho < 150 km, seed 20240611)

| | n | bias | mean abs | median | p95 | p99 | max | Pearson |
|---|---|---|---|---|---|---|---|---|
| Sun | 1500 | -0.26 | **0.59** (95 % CI 0.52-0.66) | 0.06 | **2.72** | 6.11 | 17.0 | 0.995 |
| Sun, lit pixels only | 1337 | -0.30 | 0.66 | 0.12 | 2.89 | 6.75 | 17.0 | 0.993 |
| Earth | 1500 | -0.53 | 0.85 | 0.05 | **6.27** | 14.5 | 24.8 | 0.992 |

The Sun target is **met**: the target is a mean of 1-2 points and p95 <= 4. The engine gives 0.59 / 2.72, better than the target. The Earth target is 5 points. The mean (0.85) is within it, but **p95 is 6.3 and p99 14.5: the Earth tail misses the 5-point target**.

Of 163 published-PSR pixels, 97 % are exactly 0 in the engine (mean 0.03 %). The published value lies inside the engine's rigorous [lo, hi] horizon bracket for only 52 % of pixels. The bracket is 0.6 points wide on average, so the residual is mostly not horizon-integration uncertainty.

Sun residuals by distance to the pole, as bias / mean / p95: 0-30 km +0.21 / 0.96 / 3.9 (n=56); 30-60 km -0.23 / 0.36 / 1.9 (201); 60-100 km -0.27 / 0.53 / 2.4 (398); 100-151 km -0.30 / 0.66 / 2.8 (845). Figure: `img/illumination_avgvisib.png`.

### 3.2 Stratified by published value (diagnostic; n = 883 Sun)

**The engine is systematically low at the brightest pixels (crests).** This misses the 1-2 point target. Over the whole stratified sample the Sun error is: bias -0.93, mean 1.54, median 0.36, p95 6.76, p99 13.4, max 64.7, Pearson 0.988.

The error grows with the published illumination. Bins 0.6-0.7 / 0.7-0.8 / 0.8-0.9 have bias -3.15 / -2.78 / -2.6 and mean 4.3 / 3.6 / 2.8 (n 91 / 91 / 19). Bins below 0.6 have mean 0.2-1.5. For the Earth on the same pixels: bias -0.73, mean 1.11, p95 5.75. Figure: `img/illumination_avgvisib_stratified.png`.

The earlier stratified tail of p95 = 32 was measured with the misregistered addressing and has vanished. The regression-to-the-mean hypothesis was not the cause.

### 3.3 One-factor experiments (first 400 uniform pixels, mean |d| / bias, Sun)

Each experiment changes one factor. The results are mean |d| / bias for the Sun:

* baseline: 0.62 / -0.29
* time step 6 h: 0.62; 24 h: 0.64 (negligible)
* point Sun (no disc): 1.92 / -1.83
* no aberration: identical
* start year 2018-2022: mean 0.62-0.65 (start year is not the issue)
* horizon lower bracket: 0.51 / -0.06; upper bracket: 0.88 / -0.66
* 360 azimuths: 0.62
* **far terrain truncated to 100 / 50 / 20 km: 0.75 / 2.10 / 6.98 (bias -0.06 / +1.53 / +6.59)**
* observer height 2 m: bias +1.11; 5 m: +2.03
* terrain store 120 m: 1.11 / -0.06; 240 m: 1.79 / -0.29; 20 m: 1.68 / -1.43

Figure: `img/illumination_experiments.png`.

What the experiments show:

* The extended-disc model is required. A point Sun costs 1.5 points.
* The time step, the start year and aberration are not systematic errors at this level.
* Cutting the far terrain at 50 km or less would cause a large systematic error. So the published product uses at least ~100 km of terrain. At 100 km the bias is ~0 but the scatter is larger, so we cannot tell the exact range the LOLA team used.
* A move to a 20 m or 10 m terrain changes the result by more than the residual itself. The published raster is a property of its 60 m gridding.

### 3.4 The published maximum and the crest pixels

* **The engine misses the published maximum by 4.1 points.** The published maximum is 88.444 % at x=-10770, y=-11730 m. The engine at that pixel (60 m store, exact) gives **84.38 %** (-4.06 points). A scan on a 15 m grid within ±60 m has its best at the pixel node itself, so the difference is not a registration offset. At the old (misaddressed) location the engine gave 52.97 %. The target was to reproduce 88.444 %.
* Top-50 published pixels: the mean published value is 79.97 % and the engine gives 75.96 %. Bias -4.01, mean |d| 4.40, median 2.06.
* Terrain gridding explains part of this. The data cannot say how much.
  * The engine's 60 m heights at these nodes equal the raw LDEM_75S_60M samples (max difference 4e-11 m). They differ from the 10 m LDEM (LOLA digital elevation model) by RMS 0.80 m (p95 1.19 m) for the top-50 pixels and by 1.06 m (p95 2.1 m) for 100 random sunlit pixels.
  * At 60 m, a 1-2 m height difference between neighbours is ~1-2 degrees of horizon. That decides whether a crest is sunlit.
  * The same 50 pixels on a finer terrain give 53.7 % on the 20 m store and 38.9 % on the 10 m store (mean |d| 26.3 and 41.1). The best of 25 offsets still gives 14.2 and 32.2.
  * So crest illumination depends strongly on resolution. The maxima of a 60 m surface are not the maxima of finer surfaces. The 60 m result (4.4 points, 3.1 with the best offset per pixel) is the closest.
  * The remaining 4 points at crests are **the measured disagreement at crests**. I could not split it between the different 60 m gridding (LDEM_85S_060M is unavailable) and the engine.
* Two pixels are 0 in the published raster, but the engine gives 47 % and 24 %. Neither is an isolated pixel. Each was examined with the 7 x 7 neighbourhood of the published raster, the engine on the same 60 m store, the 60 m height and the Barker 2023 PSR map.
  * Pixel A (x=103470, y=-32130 m, rho 108.3 km, height -821 m): the published raster has a **cluster of six zeros** (rows 2-4, columns 1-3 of the 7 x 7 block) inside a field of 28-50 %. The engine gives 42-50 % over the same block. The terrain there is a smooth slope. Heights fall monotonically from -793 to -860 m across the block, with no crest or depression. The Barker PSR map is 0 (not PSR) at all 49 pixels. No terrain feature explains a six-pixel region of exactly 0 in a 45 % field. I read it as a defect of the published product (a fill or processing artefact), but I have no evidence for the cause.
  * Pixel B (x=106170, y=-33930 m, rho 111.5 km, height -1691 m, crater floor): the published raster has a **2 x 2 block of 0, 0.7, 0, 0** (rows 2-3, columns 3-4) inside a 20-40 % field. The engine shows its low values (6.5, 11.6, 9.4) about two pixels south (rows 4-5, columns 2-3) and gives 24-31 % on the published zeros. Barker PSR is 0 everywhere. This looks like a real shadowed pocket whose position differs by about two 60 m pixels between the product and the engine. That is a small shift of a feature that the terrain model resolves at 60 m by one or two pixels. The engine does not reproduce the zeros, so this stays a miss.

### 3.5 Contiguous windows (128 x 128 cells at 60 m on the raster lattice, regional method, 3-hourly, 18.6 y)

| Window | cells | published max / engine max | Sun bias | mean | median | p95 | p99 | max | Pearson |
|---|---|---|---|---|---|---|---|---|---|
| Connecting Ridge (centred on the max) | 16,384 | 88.44 / 87.02 (engine max 722 m away) | +1.78 | 2.79 | 0.45 | 15.6 | 37.6 | 65.3 | 0.86 |
| Shackleton rim (-2800, -7000) | 16,384 | 87.06 / 86.11 (engine max 3.1 km away; 85.99 at the published pixel) | +0.63 | 1.00 | 0.18 | 4.10 | 15.4 | 62.2 | 0.976 |

**The Connecting Ridge window misses the 1-2 point target by an order of magnitude.** Inside this very steep ridge window the engine is higher on average, with p95 15.6 points. The sign is opposite to 3.1 (+ here). The large residuals lie on ridge lines one pixel wide (figure `img/illumination_windows.png`).

For the Earth in the same windows: bias +0.78 / +0.96, mean 1.42 / 1.55, p95 7.7 / 8.4.

The disagreement comes from the model against the product, not from the regional method. On 96 random cells of each window, regional minus exact has mean 0.39 / 0.27 and max 1.49 / 1.43 points.

The window evaluation does not reproduce 84.4 % at the maximum pixel. That number comes from the exact engine, and the regional method gives a different value at that pixel.

## 4. PSR: Barker et al. 2023 `LPSR_80S_20MPP_ADJ.TIF`

**The model PSR closely matches the published map in the windows and finds slightly more PSR area.** The totals are: precision **0.976**, recall **0.995**, area ratio (model/published) **1.019**, pixel agreement 0.9916 (TP 72,945, FP 1,817, FN 388, TN 186,994).

The setup is as follows:

* 16 windows of 128 x 128 cells at 20 m, 4 from each stratum of PSR fraction, 262,144 pixels in all.
* The Sun is swept in RA at the minimum ME declination -1.588 deg of the 18.6 y cycle, in 0.1 deg steps.
* PSR means that no part of the Sun is ever visible.
* The regional method runs on the 20/120/240 m stores.

The false positives concentrate in windows with few PSR pixels. For example, one window has 24 model against 10 published pixels, and another has 405 against 270. Windows that are mostly PSR agree to 99.9 %+.

**Total PSR area.** Inside rho <= 300 km the model total is about **22,140 km2** (21,640-22,940 km2) against 20,627 km2 published. The model is about 7 % high.

* The published map is 30,400 x 30,400 pixels of 20 m (+-304 km). Exact counts of the published raster are in `psr_map_counts.json`. There are 55,856,975 PSR pixels = **22,342.8 km2** over the whole raster. Inside rho <= 300 km there are 51,567,403 pixels = **20,626.96 km2**. This disc is the one the windows are drawn from, and it holds 706,858,556 pixels.
* The model cannot be run on every pixel of the disc. Scattered cells do not share far-field nodes. So the model total is a ratio estimate.
* The estimate uses 400 random compact windows of 32 x 32 cells at 20 m, with centres uniform in the disc (seed 11): 409,600 cells. The sweep and the stores are the same as above.
* In the windows, model PSR pixels / published PSR pixels = **1.073**. The 95 % cluster bootstrap over windows (2000 draws) gives 1.049-1.112.
* The excess has the same sign as the 1.9 % of section 4, but it is larger here because these windows are drawn uniformly over a disc, and many contain only a few PSR pixels.
* The window PSR fraction is 6.73 % against 7.30 % for the disc. This is a sampling difference within the interval.
* Pooled over the 400 windows: precision **0.911**, recall **0.977** (TP 26,929, FP 2,641, FN 625).
* The ratio refers to the published product's definition, which was matched in section 1. The published area itself does not validate the true PSR area.

## 5. Barker et al. 2021, Table 2

The comparison with the real RoI polygons is in `docs/validation/scenario.md` section 11.6. It uses `Site01_ROIs.shp`, seven polygons on the 5 m Site 01 tile, observer 1 m and 5 m, 2024-2026. 14 of 14 nominal cases fall on the right side of the published percentile.

An earlier version of this section used equal-area discs, because I had not found the published polygons. That version is withdrawn, together with its script and results file. It contributes nothing to this document.

## 6. LROC WAC observed illumination (`WAC_POLE_ILL_PCT_SOUTH_100M.IMG`)

**The engine ranks bright sites much as the WAC observations do, but it does not reproduce the location of the maximum.**

A caveat from the sources document: the WAC product is an observed, image-derived percentage over a short observation period. It is not the model quantity. The sample is 583 stratified pixels. The engine uses any-part Sun over the observation-year models:

| model year | Spearman | Pearson | bias | mean abs | p95 abs |
|---|---|---|---|---|---|
| 2010 | 0.914 | 0.912 | -2.70 | 5.38 | 23.4 |
| 2011 | **0.928** | 0.925 | -2.59 | 5.05 | 21.8 |
| 2012 | 0.925 | 0.921 | -3.10 | 5.25 | 22.8 |

A one-pixel (100 m) shift scan has its best at (0,0) (Spearman 0.928, mean 5.05).

**Location of the maximum is not reproduced.** The published maximum is 71.58 % at (-2800, -7400) m (lat -89.7391, lon 200.7256). The engine's maximum in the search domain is 87.5 % (2011) at (-11310, -12210) m. That is 9.8 km away, in the Connecting Ridge region. In the stratified sample the engine's maximum is 54.5 %.

WAC percent values are lower than the model's by construction, because of observation times and resolution. The rank correlation of bright sites is the supported comparison. Figure: `img/illumination_wac.png`.

## 7. Regional layer: error against the exact engine at the shipped defaults

All numbers of 7.2-7.4 are for the configuration that `python -m lunarnav.regional` runs by default:

* the default terrain stack (all 43 stores, hash `241d5855...06bd`)
* observer 0 m
* Sun and Earth `any_part`
* 360 azimuths
* hourly 2024-01-01 to 2026-01-01, with brackets calibrated on 32 random cells (seed 0)

The script is `validation/illumination_defaults.py`. The results are in `data/validation/illumination/defaults_validation.json`. The package ships a
copy, `src/lunarnav/regional/validation_reference.json`, and prints it into every output.

The earlier measurements of this section are in 7.5. They used an observer height of 2 m, three LOLA stores, 48 calibration cells and the previous near-field sampling. They are **superseded** for accuracy.

### 7.1 Method, and what the independent review changed

The regional method works in these steps:

* A tiered march computes the horizon profile of each cell. Far-field nodes are shared between cells. A near-field ladder samples close terrain, with a finest step of 0.25 of the finest store pixel.
* Per-cell statistics come from the shared Sun and Earth tracks.
* Calibration compares the horizon with the exact engine on a random sample of cells. It gives `eps_lo` and `eps_hi` as the 0.01 / 0.99 quantile of the regional-minus-exact horizon residual, pooled over (cell x azimuth).
* The layers are evaluated again at horizon -eps_lo / +eps_hi. This gives the estimated `_lo`/`_hi` brackets.

The shifts are two-sided quantiles of the measured residual, not a one-sided construction. The brackets are **estimates, not bounds**: in 7.2 a few cells in 1000 fall outside.

`shift_lo_deg` always lowers the horizon and `shift_hi_deg` always raises it. Which of `_lo` / `_hi` uses which shift depends on the layer. The layer's support record states it in `bracket_low_horizon`. It is `raised` for the illumination, flux, sunlit and Earth fractions and the longest sunlit run. It is `lowered` for the longest shadow and Earth outage.

The independent review of the package (`local://review-regional.md`, tree `05a72ef`) found seven defects. This is what was done:

| # | finding | change | evidence |
|---|---|---|---|
| 1 | one calibration cell 4 m from a store edge set the pooled quantile for the whole area (`shift_hi` 3.37 deg; bracket 25 points wide in 93.5 % of cells) | cells within 2 cells (centre to centre; 40 m at 20 m) of a change of ground store are flagged (`censoring_flags` bit 3, value 8), excluded from the calibration, excluded from the bracket-width statistics, and have verdict -128; the header prints their number, the shifts and the bracket-width distribution | 7.3; shifts in 7.2 are 0.006-0.24 deg except 83S (0.707); section 10 states its own run |
| 2 | the near-field ladder steps over a crest on a post line (regional horizon 0.39-0.63 deg low over the whole Earth window of cell 203, 966) | every ladder sample that is a local maximum of the elevation and within 1 deg of the best is refined by a golden-section search between its two neighbours (14 iterations), in every tier | cell 203, 966: window residual -0.39...-0.63 deg before, -0.021...-0.013 deg after |
| 3 | error tags were constants of another configuration | each run measures its own error on its calibration cells (`run_measured_error`, `run_measured_on`); the validated figures are kept apart in `validation` with their configuration and `applies_to_run` | 7.2 |
| 4 | fraction layers tagged "percentage points" but holding 0 to 1 | `UNIT` is "fraction (0-1)"; `ERROR_UNIT` is "percentage points" | tag checked against the value range |
| 5 | censoring flag ignored the `_lo`/`_hi` layers | bits 4-6 (16, 32, 64) record run censoring in any bracket variant | flag layer checked for bracket censoring |
| 6 | text contradicted the cache | this section rewritten from `defaults_validation.json`; earlier numbers labelled | -- |
| 7 | the command accepted bad requests silently | latitude, positive arguments, tile and azimuth checks; a region without terrain is refused; covered-cell count and warnings in the header; stale layers of an earlier run in the directory are removed; memory estimated before allocating; kernel download announced; exit status 2 and one line instead of a traceback | command checked end to end |

The review also raised terrain questions: height steps at store edges, and spikes about 60 m tall in `lola_875s_5m`. These belong to the terrain owner and are not addressed here.

### 7.2 Acceptance test: error and bracket coverage on independent cells

The test compares the exact engine with the regional layers on 960 cells in all. The areas are 20 km x 20 km at 20 m at Connecting Ridge, Shackleton, 87S and 83S, plus 100 km x 100 km at 240 m. Each area has 192 random cells (seed 1) away from store changes.
The exact engine uses `horizon_arrays` with the same azimuths and range. The regional layers use the brackets of that area's own 32-cell calibration.

| Area | `eps_lo` / `eps_hi` (deg) | cells within 2 cells of a store change | horizon residual: p0.5 / min (deg) | avg. illum. error: mean / p95 / max (points) | Earth fraction error max (points) | bracket misses |
|---|---|---|---|---|---|---|
| Connecting Ridge | 0.018 / 0.193 | 1.45 % | -0.212 / -0.897 | 0.118 / 0.236 / 0.353 | 0.695 | 0 |
| Shackleton | 0.015 / 0.242 | 0.82 % | -0.246 / -1.035 | 0.104 / 0.262 / 0.359 | 0.621 | shadow 1 |
| 87S | 0.023 / 0.169 | 0 | -0.268 / -1.975 | 0.100 / 0.242 / 0.359 | 1.265 | sun flux 1, Earth fraction 1, shadow 1, outage 1 |
| 83S | 0.019 / **0.707** | 0 | -0.710 / -0.769 | 0.128 / 0.427 / 1.032 | **6.475** | 0 |
| 100 km at 240 m | 0.006 / 0.273 | 2.57 % | -0.627 / **-2.465** | 0.103 / 0.270 / 0.832 | 2.217 | shadow 1, outage 1 |

The table below pools the 960 cells. Error is regional minus exact.
For the fraction layers the mean of the signed error equals the mean absolute error, because the
regional value is always on the optimistic side. In 8.5 % of (cell, azimuth) samples the regional horizon is more than 0.1 deg below the exact one. The mean residual is -0.036 deg.

| Layer | support class | bracket misses (coverage) | error mean / p95 / p99 / max | bracket width p50 / p95 |
|---|---|---|---|---|
| average illumination | supported | 0 (100 %) | 0.11 / 0.29 / 0.54 / 1.03 points | 1.63 / 3.22 points |
| sun mean flux | supported | 1 (99.90 %) | 0.11 / 0.28 / 0.47 / 1.18 points | 1.62 / 3.19 points |
| sunlit fraction | supported | 0 (100 %) | 0.11 / 0.29 / 0.54 / 1.03 points | 1.63 / 3.22 points |
| Earth fraction | **approximate** | 1 (99.90 %) | 0.13 / 0.49 / **2.03 / 6.47** points | 1.12 / 5.03 points |
| longest sunlit | approximate | 0 (100 %) | 1.01 / 3 / 11.9 / 80 h | 7 / 42 h |
| longest shadow | bracket_only | **3** (99.69 %) | 30.8 / 3 / 688 / **8920** h | 12 / 1408 h |
| longest Earth outage | bracket_only | **2** (99.79 %) | 28.5 / 4 / 614 / **5788** h | 7 / 654 h |

* **The brackets still miss.** They miss three of 960 cells for longest shadow, two for the Earth outage, and one each for sun mean flux and Earth fraction. The
  calibration target is 0.99 of (cell x azimuth) samples, not of cells. The brackets stay estimates and keep the names `bracket low` / `bracket high`.
* **Earth fraction lost the `supported` class.** Its mean error is 0.13 points, but its tail is not small: p99 2.03, maximum 6.47 points (83S). 83S alone
  has p95 1.97 points. A mast-0 observer is more often shadowed by a blocker 1-5 m away, and the near-field march resolves such blockers less well.
  The review measured 5.8 and 7.1 points at mast 0. This run measures 6.47. Earth fraction is now `approximate`: read the bracket.
* **Run-length layers are not sound per cell.** The maximum errors are 8920 h for shadow and 5788 h for outage. The point value is available only through the site search.
* **The calibration is noisy.** With 32 cells, `eps_hi` ranges 0.17-0.27 deg on four areas and is 0.707 deg on 83S, where one calibration cell has a large residual.
  Every run prints its own value and the bracket-width distribution in the header (`bracket_calibration`, `bracket_widths`).
* The horizon error has a heavy lower tail at mast 0 (minimum -2.47 deg, in the 100 km area). The pooled quantile does not bound it.
* Log figures of the run that produced these numbers: 261, 135, 97, 52 and 544 s per area. The machine was shared, with load average 6-12. These figures were not re-measured and are not throughput.

### 7.3 Cells beside a change of terrain product

**These cells are not reliable.** They are written but flagged (bit 8) and marked "near a boundary between terrain products: not reliable".

The cells within 2 cells of a cell whose ground store differs are 0-2.6 % of the cells. In the three areas that contain store changes they are 0.82-2.57 %. This was measured on
100,000 random cells per area.

The same comparison on 144 such cells (48 in each of those three areas) gives:

* horizon residual p0.5 -7.4 deg, minimum -19.3 deg
* average illumination error mean 0.29, p95 1.29, max 3.85 points
* bracket misses: average illumination 6 of 144, sun mean flux 5, sunlit fraction 6, Earth fraction 1, longest sunlit 17, longest shadow 4, Earth outage 3

These cells see a height step of the stack as a wall. The review gives the step as median 1.3-1.5 m, up to 11.5 m. The exact engine and the regional march resolve the wall differently.

### 7.4 The review's cell

**At the shipped defaults, the brackets cover the exact value at the review's cell and at the four cells that missed in the earlier pooled run.**

The review's cell is Connecting Ridge row 203, col 966 (lat -89.77349, lon 198.857). Over azimuths 153-170 deg the regional-minus-exact horizon is -0.021...-0.013 deg. With the old sampling the review measured
-0.39...-0.63 deg. Over all azimuths it is -0.121...+0.104 deg.

At the shipped defaults the exact engine gives:

* Earth fraction 20.14 % (bracket 19.22-20.28)
* longest shadow 419 h (418-423)
* longest Earth outage 561 h (559-570)

All three are covered. The review's numbers (Earth outage 2534 h, Earth fraction 11.52 %) were for a different
observer height, Earth rule and stack. So they are not comparable value by value, but the horizon residual is.

The four cells that missed in the earlier pooled run were taken as the same row and
column of the Connecting Ridge region at the shipped defaults. The quantities differ, because the configuration differs:

* (281, 303): outage 5855 h in [3235, 6508], shadow 2116 h in [2115, 2818]
* (473, 33): shadow 458 h in [457, 461]
* (54, 361): shadow 703 h in [702, 2080]

All are covered. The bracket is wide where the run length is fragile.

### 7.5 Earlier measurements (before the crest sampling fix; mast 2 m, three LOLA stores, 48 calibration cells): superseded for accuracy

**These measurements no longer describe the shipped code; 7.2 does.** They are kept because they motivated the decision on the hybrid rule and the
renaming from "bound" to "bracket".

`regional_accuracy.json`, `regional_runlength.json` and `bracket_coverage.json` were measured with the near-field ladder of the previous code. The settings were observer 2 m, `half_flux` Sun and
`centre` Earth rule, on the 20 m + 120 m + 240 m stores.

**Experiment: can the point value be made sound?** The experiment used 192 random cells per area (seed 1, the same five areas), mast 2 m, 2024-2026 hourly.

The point value of the shadow layer is usually right: the median error is 0-1 h on every area. But 4-5 cells in 192 are wrong by roughly one synodic cycle (maximum 644-710 h). In these cells a short sunlit sliver splits or joins a month-long shadow. The mean error is 4.4-19.5 h and p99 is 28.7-688 h.

A fixed 0.02 deg raise of the horizon does not fix it (mean 0.4-26 h, max 13-720 h).

A **hybrid rule** was then measured with W = 6, 24, 72 h. It uses the exact engine for every cell whose [lo, hi] bracket is wider than W hours, and the regional point value elsewhere:

| layer, W = 24 h | cells needing exact evaluation, per area (CR / Shackleton / 87S / 83S / 100 km) | max error on the rest (h) |
|---|---|---|
| longest shadow | 28 % / 37 % / 43 % / 2.6 % / 13 % | 12 / 6 / 5 / 4 / 5 |
| longest sunlit | 1.6 % / 12 % / 17 % / 0 % / 2.6 % | 8 / 4 / 14 / 4 / 11 |
| longest Earth outage | 4.7 % / 2.6 % / 7.8 % / 1.6 % / 9.9 % | **1935** / 6 / 13 / 25 / 5 |

At W = 6 h the share of shadow cells that need the exact engine rises to 4-66 %, and the maximum error on the rest is 2-12 h.

For shadow and sunlit, the hybrid makes the point value sound to a few hours. The cost is 3-43 % (shadow) of cells evaluated with the exact engine. The exact engine ran 12.0 polar sites per second (median of three runs, range 5.3-15.2), measured in the quiet window of section 9. The hybrid itself was not timed.

For Earth outage the hybrid is **not** sound. One Connecting Ridge cell has a narrow bracket (below 24 h) and is wrong by 1935 h, because the bracket itself missed it (coverage 0.99 on that area).

The hybrid was **not adopted** (decision of the lead). It is unsound for Earth outage. For shadow it needs the exact engine on up to 43 % of the cells, which defeats the purpose of the regional layer. Shadow and Earth outage stay `bracket_only`. Sunlit and Earth fraction are `approximate`. A point value that can be relied on comes from the site search, which evaluates the candidate site with the exact engine. The layer notes say so.
#### 7.5.1 The run-length brackets could miss the exact value (previous code)

**The brackets are estimates, not bounds.** With the previous code, the coverage of the run-length layers was **99.5-99.7 % on 960 independent cells**. The figures at the shipped defaults are in 7.2.

The coverage test used 192 random cells per area (seed 1), the same five areas, mast 2 m, 2024-2026 hourly, half-flux Sun and Earth centre. It compared the exact engine with the shipped `_lo`/`_hi` layers.

Misses in 960 cells: longest sunlit 3 (coverage 99.69 %), longest shadow 5 (99.48 %), longest Earth outage 5 (99.48 %). By area (Connecting Ridge / Shackleton / 87S / 83S / 100 km), shadow misses are 2 / 0 / 1 / 1 / 1 and outage misses are 2 / 0 / 1 / 2 / 0. The calibration target is 0.99, so it predicts a few misses per 1000 cells. The earlier 1.00 was sampling luck.

Why the cells miss: the bracket shifts the whole regional horizon by the pooled 0.99/0.01 quantile of the horizon residual over (cell x azimuth). It raises by 0.1045 deg and lowers by 0.0126 deg. A run length is decided by the few azimuths on which the Sun or the Earth skims the horizon. A cell can have one such azimuth with a residual far beyond the pooled quantile. The four Connecting Ridge cells of the diagnostic run show this:

* Earth outage, cell (row 203, col 966): the exact horizon is up to 0.629 deg above the regional one at some azimuths. The exact outage is 2534 h and the bracket is [597, 611] h. With a 0.5 deg raise the upper end becomes 2532 h. The calibration sample had a maximum residual of 0.530 deg.
* Earth outage, cell (281, 303): exact 598 h, bracket upper end 596 h. The largest residual is 0.204 deg.
* Shadow, cell (473, 33): exact 461 h, lower end 462 h. The regional horizon is 0.094 deg above the exact one at some azimuth. The lowering allowance is 0.0126 deg.
* Shadow, cell (54, 361): exact 2112 h, lower end 2739 h. The regional horizon is 0.038 deg above the exact one at some azimuth.

This is a property of the calibration, not an implementation defect. A pooled per-azimuth quantile does not bound the worst azimuth of one cell.

Can the bracket be made sound cheaply? A wider calibration, `cellmax`, was tested. It shifts the horizon to cover the worst azimuth of each of 96 calibration cells (seed 7, independent of the evaluation sample). It was tried at the 0.9 quantile and at the maximum over the 96 cells. Each table entry gives the misses in 960 cells, then the median bracket width in hours per area (Connecting Ridge / Shackleton / 87S / 83S / 100 km):

| layer | shipped pooled 0.99 | cellmax q0.9 | cellmax max |
|---|---|---|---|
| longest sunlit | 3; 2 / 3 / 6.5 / 2 / 7 | 1; 9 / 8.5 / 21 / 5 / 10 | 0; 47.5 / 131.5 / 81 / 20 / 29 |
| longest shadow | 5; 4 / 7 / 12 / 2 / 8 | 1; 57 / 122 / 715 / 5.5 / 13 | 0; 193 / 3680 / 4880 / 23 / 38 |
| longest Earth outage | 5; 0 / 6 / 6 / 4 / 8 | 3; 0 / 16 / 16 / 11 / 12 | 0; 0 / 62 / 77 / 40 / 33 |

The fraction layers, with the shipped brackets on the same 960 cells (`bracket_coverage.json`), give: average illumination 3 misses (99.69 %), sun mean flux 2 (99.79 %), sunlit fraction 2 (99.79 %), Earth fraction 5 (99.48 %). The mean bracket width is 0.3-1.4 points (Earth fraction 0.3-1.1). The earlier 96-cell figures (1.00 on four areas) were the same sampling luck.

**No cheap rule makes the brackets bounds.** Only the maximum-of-96 calibration has no miss on the 960 cells. But it makes the shadow bracket thousands of hours wide at Shackleton and 87S (median 3680 and 4880 h), which is useless. And 0 misses in 960 cells is still not a guarantee.

The layers are therefore documented as estimated brackets. The lead decided these renames:

* class `bounds_only` -> `bracket_only`
* `bound` -> `bracket`, with roles `bracket low` / `bracket high`
* tag `BOUNDS_LAYERS` -> `BRACKET_LAYERS`
* header key `error_bound` -> `bracket_calibration`
* CLI flag `--no-bounds` -> `--no-brackets`

The Python keyword `bounds` of `compute_layers` and the service request field `bounds` are unchanged.

The horizon error is one-sided and optimistic. At a 5 m ladder floor its cause is the near-field blockers within ~200 m. An earlier measurement on 32 cells gave bias -0.07 deg at a 20 m floor and -0.015 deg at a 2.5 m floor.

## 8. What is and is not validated

Validated:

* engine against published AVGVISIB on a uniform sample (Sun mean 0.59, p95 2.7; Earth p95 6.3 miss)
* PSR geometry against Barker 2023 (precision 0.976, recall 0.995 on 16 windows)
* registration
* rank agreement with WAC
* regional layer error and bracket coverage at the shipped defaults on 960 independent cells (section 7.2)

Not validated or missed:

* the brightest pixels (mean 4.4, maximum 4.1 points low)
* the Connecting Ridge window p95 of 15.6
* the Earth tail
* run-length point values (shadow, Earth outage: estimated bracket only, see section 7)
* Earth fraction tail (max 6.47 points)
* cells beside a change of terrain product (not reliable, flagged)
* the brackets miss 0-3 of 960 cells per layer
* the total PSR area is 7 % high (1.049-1.112) against the published map
* the two published-zero pixels are not reproduced
* start year of the published runs (2016 assumed, unverified, with 2018-2022 within 0.03 points)
* DE421 against DE440 offset of the published product
* polar interpolation of the published raster
* the unpublished `LDEM_85S_060M`

## 9. Run order and measured cost

The checks ran in this order, each with `NUMBA_NUM_THREADS=4`:

* registration
* AVGVISIB (all stages)
* crest
* PSR windows (and the 400-window total)
* contiguous windows
* WAC
* odd pixels
* `illumination_regional.py accuracy`, the run-length and bracket experiments. These three measure the previous code (7.5).
* `illumination_defaults.py` (section 7.2-7.4; about 18 min, a log figure from a loaded machine)
* the commands of section 10 followed by the output check against the published rasters and the service-against-command comparison

The wall times of these runs were recorded at the time of each run, while the machine was heavily loaded (load average 5-100). They are log figures. They were not re-measured in the quiet window and are not throughput:

* registration + baseline + uniform + experiments: 1898 s
* crest: 17 min
* PSR 16 windows: 14-30 s each
* window: 340 s and 291 s (16,384 cells, 3-hourly, 18.6 y, 4 threads)
* WAC: 1508 s total
* the 400-window PSR total: 6 min 20 s
* the run-length experiment: 2 min 50 s

**Timings measured in a quiet window** (`data/validation/illumination/timing_quiet.json`).

* Date 2026-11-13 (system clock).
* Ryzen 7 8845HS, 16 threads, 28 GB. About 13 GB was available, with swap full, because of the user's own desktop processes. These were not ours to stop.
* No other job of ours was running. The load average was 1.5-2.3 when each stage started. It was 4.4-5.0 at the start of the later repeats, which is the run's own 4 threads.
* `numba` was set to 4 threads, as in the runs the document describes.
* The anonymous memory of the process was 85-221 MB at the start of every run. Terrain is memory-mapped.
* Unless stated, the runs use the command defaults (default stack, observer 0 m, `any_part`, 360 azimuths, 32 calibration cells) and 2024-01-01 to 2026-01-01 hourly (17,545 epochs).
* A run of under two minutes is repeated three times. A longer one is run once.

| measurement | result |
|---|---|
| exact engine, polar sites per second (48 random cells of the 20 km area, 360 azimuths, range 457.5 km) | 3 runs 9.11, 4.00, 3.15 s = 5.3 (first run, cold page cache), 12.0, 15.2 sites/s; median 12.0 |
| `compute_layers`, one 128 x 128 tile (16,384 cells) of the 20 km, 20 m area, calibration included | 94.4, 93.5, 91.6 s (median 93.5, range 91.6-94.4); calibration 5.9, 5.1, 3.2 s; horizons 16.3, 16.4, 16.1 s; series statistics 71.1, 71.4, 71.6 s; 5.36 ms per cell without the calibration; `shift_hi_deg` 0.1932 in all three |
| the same for one 128 x 128 tile of the 100 km, 240 m area | one run, 120.6 s; calibration 8.7 s, horizons 56.9 s, statistics 54.1 s; 6.77 ms per cell without the calibration; `shift_hi_deg` 0.2727 |
| whole 5 km x 5 km area at 20 m, 2024-01-01 to 2024-07-01 hourly (62,500 cells, 4,369 epochs), as the service comparison of section 10 | one run, 134.4 s; calibration 6.3 s, horizons 64.8 s, statistics 62.8 s; 2.04 ms per cell without the calibration; `shift_hi_deg` 0.1528 |

On the long period the statistics take the larger share, not the horizons (about 4.3 ms per cell at 20 m).

The two section 10 runs (1,000,000 and 173,889 cells) were **not** repeated. At the tile rates they would take about 90 minutes and 20 minutes, which is beyond the time limit of this measurement. So no whole-run time is quoted beyond the log figures of section 10, and the tile figures are not extrapolated here. The tile rates do not include writing the GeoTIFFs.

The only non-time number the runs report is `shift_hi_deg`. It equals the value of section 10 in all four cases (0.1932, 0.2727, 0.1528).

**Freshness of the stored results (checked 2026-11-13 on the current tree, default stack hash `241d5855d6be...`).**

* **Store order and hashes match.** Checks that name their stores open them in the order the stack sorts them. The recorded or recomputed hashes of the named stacks equal the stored ones: `lola_75s_60m` `f278bc48b682`, the three 20 m/120 m/240 m stores `0dfbd346e654`, the two 120 m/240 m stores `44f913650e70`. Only `illumination_defaults.py` and the two section 10 runs read the default stack, as stated.
* **Rerun to the same numbers** (relative difference 0 on every non-time number):
  * registration
  * odd pixels
  * AVGVISIB baseline (1,400 pixels) and uniform sample (1,500 pixels, Sun mean 0.594, p95 2.72, Earth p95 6.27)
  * the one-factor experiments
  * the crest on the 60 m store
  * the WAC sample of 600 sites for three years with the nine-shift scan
  * the output check on the stored outputs
  * the defaults validation for the Connecting Ridge area (the other four areas were not rerun)
* **Rerun to different numbers**, and replaced in this document and in the stored results: the PSR windows, the PSR total and the two 60 m regional windows of 3.5. The cause: these checks use the regional horizons, and the stored runs of 2026-11-12 (04:57-05:08) were made before the crest refinement of the near field was added to the regional kernel. The exact-engine columns of 3.5 are unchanged to the last digit.
* **Not rerun:** the WAC maximum search (the 20 km window) and the other four areas of the defaults validation.
* **The tiles of the product runs match bit for bit.** One tile of each section 10 run (128 x 128 cells aligned to the tile grid) was recomputed on the current tree. Its layers equal the stored GeoTIFFs bit for bit (7 layers of the 20 m run, 24 of the 240 m run). The same shifts come out: `shift_hi_deg` 0.1932 and 0.2727.
* Sections 7.5 and 7.5.1 (`illumination_regional.py accuracy`, the run-length and bracket experiments) describe the previous code. They are not expected to equal a rerun.

## 10. The product run for real: `python -m lunarnav.regional`

Two commands were run again with the code of this version: crest refinement, store-change flag and per-run calibration. They used 4 threads and the CLI defaults: observer 0 m, Sun and Earth `any_part`, 360 azimuths, 32 calibration cells, default stack hash `241d5855...06bd`. The period was 2024-01-01 to 2026-01-01 hourly.

1. `--lat -89.44 --lon 222.9 --size-km 20 --spacing-m 20` -> 1000 x 1000 cells, 64 tiles of 128 x 128.
2. `--lat -86 --lon 120 --size-km 100 --spacing-m 240` -> 417 x 417 cells, 16 tiles.

Each run states its own calibration and flagged cells in `header.json` (`bracket_calibration`, `store_changes`, `bracket_widths`, `coverage`, `warnings`):

| | run 1 (20 m) | run 2 (240 m) |
|---|---|---|
| cells with terrain / selected | 1,000,000 / 1,000,000 | 173,889 / 173,889 |
| calibration cells drawn / excluded as near a store change | 256 / 7 | 256 / 7 |
| `shift_lo_deg`, `shift_hi_deg` of this run | 0.0177, 0.1932 | 0.0064, 0.2727 |
| cells flagged near a change of terrain product (bit 8) | 14,188 (1.42 %) | 4,432 (2.55 %) |
| the same run before this version | `shift_hi` 3.37 deg (one cell 4 m from a store edge), 7,098 cells with a neighbour on another store (0.71 %, radius 1 cell) | not recorded |
| bracket width, average illumination, over the other cells: mean / p50 / p95 / p99 / max (points) | 1.51 / 1.48 / 2.56 / 2.95 / 8.44; 0 % wider than 5 points | 1.57 / 1.42 / 3.28 / 4.17 / 8.24; 0.17 % wider than 5 points |
| bracket width, Earth fraction: p95 / p99 / max (points) | 1.63 / 3.11 / 5.84 | 3.51 / 5.15 / 6.98; 1 % wider than 5 points |
| bracket width, longest shadow: p50 / p95 / p99 / max (h) | 8 / 710 / 1401 / 9897 | 11 / 839 / 2088 / 10475 |
| `layer_support` average illumination: this run's own error on its 32 cells, mean / p95 / max (points) | 0.133 / 0.238 / 0.291 | 0.111 / 0.229 / 0.348 |
| validation (7.2) `applies_to_run` | true | true |

Run times are log figures from the time of the runs. They are **not throughput** and were not re-measured. The machine was shared with other jobs, with load average 10-12. The quiet-window tile timings are in section 9.

* Run 2 took 1313 s (header `wall_s`; 7.6 ms per cell).
* Run 1 was started twice. My own 3550 s job limit killed the first start, with 41 of 64 tiles on disc. The second start resumed from the tiles (`tiles_resumed` 41), and the 23 remaining tiles took 1896 s, calibration included. So the resume path was exercised for real, and there is no single wall time.

The output check opens the output with rasterio only (no `lunarnav` reader) and compares it with the published rasters:

| check | run 1 (20 m) | run 2 (240 m) |
|---|---|---|
| shape, transform | 1000 x 1000, (20, 0, -21550, 0, -20, -2430) | 417 x 417, (240, 0, 55080, 0, -240, -10680) |
| CRS (proj4 from GDAL) | `+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +x_0=0 +y_0=0 +R=1737400 +units=m` | same |
| centre of first pixel | (-21540, -2440) = header x0, y0 | (55200, -10800) = header x0, y0 |
| `rasterio.warp.transform` of every pixel centre to lon/lat against the engine's own inverse, max difference | 1.8e-12 deg lat, 0 deg lon | 5.7e-14 deg lat, 2.8e-14 deg lon |
| nodata | NaN | NaN |
| band tags | `POINT_VALUE`, `UNIT`, `ERROR_UNIT`, `NOTE`, `BRACKET_LAYERS`, `MEASURED_ERROR_*`, `MEASURED_ON`, `VALIDATION_*` present | same |
| published 60 m AVGVISIB: mean of the output cells in each published pixel; pixels compared | 83,167 | 168,051 |
| difference (output - published), bias / mean abs / p95 / max (points), Pearson | -0.32 / 3.09 / 12.6 / 56.6, 0.865 | -2.53 / 3.31 / 13.3 / 48.5, 0.924 |
| published maximum pixel (88.444 % at (-10770, -11730) m) | 8 output cells inside it, mean **47.7 %**, max 54.3 % | outside the area (0 cells) |
| average illumination = 0 against Barker 2023 PSR (cells; published PSR cells; output zero cells; agreement; TP / FP / FN) | 1,000,000; 24,324; 27,105; 99.42 %; 22,803 / 4,302 / 1,521 | 168,051; 7,502; 8,826; 98.71 %; 7,081 / 1,745 / 421 |

The point of this table is that the georeferencing (pixel registration, transform and CRS) is correct on both outputs. The CRS is written as a projected CRS that GDAL can read but that has no name. The datum and spheroid are named "unknown", with radius 1737400 m, because the Moon has no EPSG code. This is cosmetic.

The comparison with AVGVISIB is **not** a like-with-like validation. The published product is at 60 m, with a 0 m observer, a different time range and the 60 m terrain. The output uses the 5 m/10 m/20 m default stack and 2024-2026.

**The published-maximum pixel changed from 88.67 % (the earlier run, mast 2 m) to 47.7 % (this run, shipped default mast 0 m) because the observer height changed, not because of the regional layer. The shipped default does not reproduce the published 88 % there; use `--mast 2` to compare with a 2 m observer.**

* At the brightest output cell near it (row 466, col 536), the exact engine gives 55.8 % at observer height 0 m and 90.4 % at 2 m. The regional layer gives 55.9 % and 90.7 %.
* The same holds for six more cells. At 0 m the exact engine gives 41.5-53.3 %, and the regional layer is within 0.4 points. At 2 m the exact engine gives 86.8-90.8 %, and the regional layer is within 0.3 points.
* With the 5 m terrain, blockers a few metres high shade a ground-level observer at this crest for about 35 points of the time that a 2 m observer height clears. The published 60 m product at 0 m (88.4 %) does not resolve these blockers.
* So at the published maximum, the default-configuration output (mean of the 8 cells) is 40.8 points below the published value. The earlier 2 m run gave a mean of 88.67 % for the same cells (+0.2 points).
* The mean bias against the published product went from +2.66 and +1.48 points (mast 2 m) to -0.32 and -2.53 points (mast 0 m). This is the sign and size that the observer height explains (sections 3.3 and 3.4), but I did not separate the terrain-resolution part from it.
* The PSR row defines "PSR" as average illumination 0 over only 2 years at 0 m. So the false positives (4,302 and 1,745 cells) are cells that are dark for two years and sunlit at another declination, or sunlit for a sliver. The 18.6-year PSR validation is section 4.

**Service against command: all 24 GeoTIFFs of the service export are bit-identical to the command's.** The request was 5 km x 5 km at 20 m, 2024-01-01 to 2024-07-01 hourly, at Connecting Ridge (-89.44, 222.9), with the defaults of both: mast 0 m, `any_part`/`any_part`, calibration 32, 62,500 cells, 4,369 epochs. The code was this version.

* The shared service (committed tree, regional kind version 2) was given `POST /api/v1/analyses/regional`. The same arguments were then given to `python -m lunarnav.regional`. The comparison used rasterio only.
* The pixel arrays, transform, CRS and band tags are identical, and no layer exists on one side only.
* The header `config_hash` and `layer_support` (including `run_measured_error` and `validation.applies_to_run`) are equal. So are `shift_hi_deg` 0.1528 and every other calibration value.
* The headers differ only in the wall-time fields. Calibration took 7.9 s in the service against 15.2 s in the command. The job took 277 s with 2 workers on a shared machine against 153 s with 4 threads. These are log figures from a loaded machine, not throughput. The command-equivalent run in a quiet window took 134.4 s (section 9).
* No cell was flagged near a store change in this region.

**CLI/service default mismatch found and fixed:** the CLI defaulted to mast 2 m, `half_flux`, `centre`, while the service and the validation use 0 m, `any_part`, `any_part`. The CLI now defaults to the service values.

## 11. Terrain stores used in each section (store precedence change)

**The store precedence change does not affect the named-store checks.** `TerrainHorizon` changed the default stack order. At equal pixel size, the store with the better stated error now comes first. So the 5 m PGDA (Planetary Geodesy Data Archive) tiles come before `lola_875s_5m`, and polar results inside the 26 PGDA tiles change.

Every check in sections 2-8 names its stores explicitly and is **unaffected**. This was checked by listing every `TerrainStack.open` call of those checks. Only section 7.2-7.4 and the two runs of section 10 use the default stack.

| Section | Stores |
|---|---|
| 2 registration, 3 AVGVISIB (baseline, uniform, experiments, windows), 3.5, 6 WAC, odd pixels | `lola_75s_60m` only (the published 60 m LDEM; the experiments of 3.3 name `lola_75s_120m`, `lola_60s_240m`, `lola_80s_20m` one at a time) |
| 3.4 crest | `lola_75s_60m`; the finer variants `[lola_80s_20m, lola_75s_60m]` and `[lola_85s_10m, ...]` |
| 4 PSR (windows and total) | `lola_80s_20m`, `lola_75s_120m`, `lola_60s_240m` |
| 7.2-7.4 regional accuracy at the shipped defaults | the default stack (43 stores, hash `241d5855...06bd`) in all five areas |
| 7.5 earlier regional accuracy | 20 km areas: `lola_80s_20m`, `lola_75s_120m`, `lola_60s_240m`; 100 km area: `lola_75s_120m`, `lola_60s_240m` |
| 7.5 run-length experiment | same as the earlier accuracy areas |
| 10 command and service runs | the default stack: stack hash `241d5855d6bea91306a85a5855128106e24c662652672b0ad42847c6fe5106bd` in both command runs, with the PGDA 5 m tiles first, then `lola_875s_5m`, `lola_85s_10m`, `lola_80s_20m`, ... (full list in each `header.json["terrain"]["dem_ids"]`) |

The command runs and the defaults validation were made after the precedence change: their `dem_ids` list the PGDA tiles first. The Barker 2021 run that used the default stack was removed (section 5).
