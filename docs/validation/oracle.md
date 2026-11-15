# Oracle suite report

Run 2026-11-15 06:11 UTC on commit `34c658a-dirty`, terrain stack `241d5855d6be`, kernels as pinned. Written by `lunarnav oracle run`; do not edit by hand.

## Score

**Truth checks: 31 of 46 gates pass (67 %).** These compare the engine with sources outside it: independent computations and real observations.

All gates, including the implementation checks: 38 of 53 (72 %).

A gate is one source and one quantity, held to a tolerance that was written down before the engine was run on it. A miss against a sound reference stays in the score as a failure. Report-only rows have no pass or fail: their reference cannot carry a tolerance.

4 truth cases were gates when first run and are report-only now, because the run showed their reference could not be used as built (listed under "Changed after a first run"). Counted as failures instead, the truth score is 31 of 50 (62 %).

| Class | Pass | Fail | Not run | Report only | Score |
|---|---|---|---|---|---|
| Real observation | 11 | 3 | 0 | 1 | 79 % |
| Independent computation (different ephemeris, terrain or code) | 20 | 12 | 0 | 9 | 62 % |
| Implementation check (closed form, same-ephemeris cross-check or brute force) | 7 | 0 | 0 | 0 | 100 % |

| Engine quantity | Pass | Fail | Not run | Report only | Score |
|---|---|---|---|---|---|
| Sun–Earth–Moon geometry | 12 | 0 | 0 | 4 | 100 % |
| Sunlight and eclipse at a landed site | 9 | 0 | 0 | 0 | 100 % |
| Long-run sunlight and permanent shadow | 10 | 6 | 0 | 1 | 62 % |
| Shadows at one instant, against orbital photographs | 2 | 4 | 0 | 0 | 33 % |
| Earth visibility | 1 | 4 | 0 | 5 | 20 % |
| Horizon and disc mathematics | 4 | 0 | 0 | 0 | 100 % |
| Terrain heights | 0 | 1 | 0 | 0 | 0 % |

## Failing gates

| Case | Source | Result | Limit | Unit |
|---|---|---|---|---|
| `avgvisib.sun.75s_120m` | LOLA team illumination rasters, 2016 release (Mazarico et al. 2011 method), `AVGVISIB_75S_120M_201608` | 4.10 | ≤ 4.00 | points |
| `avgvisib.sun.65s_240m` | LOLA team illumination rasters, 2016 release (Mazarico et al. 2011 method), `AVGVISIB_65S_240M_201608` | 7.76 | ≤ 4.00 | points |
| `avgvisib.sun.65n_240m` | LOLA team illumination rasters, 2016 release (Mazarico et al. 2011 method), `AVGVISIB_65N_240M_201608` | 8.09 | ≤ 4.00 | points |
| `glaeser2014.longest_dark_2m` | Gläser 2014 (thesis Table 7), 20 m DEM | 160.1 | ≤ 24.00 | h |
| `mazarico2011.connecting_ridge_surface` | Mazarico et al. 2011, Icarus 211, Table 3 (as quoted by Gläser 2014 and 2018) | 14.05 | ≤ 4.00 | points |
| `avgvisib.crest_pixels` | LOLA team illumination rasters, 2016 release, `AVGVISIB_85S_060M_201608` | 4.40 | ≤ 2.00 | points |
| `nac.simulated.m1188426614` | Barker et al. 2023, simulated NAC frame `M1188426614_20MPP_MODEL.TIF` (PGDA product 90) | 2.10 | ≤ 2.00 | percent |
| `nac.photo.m1188426614` | LROC NAC photograph `M1188426614LE/RE`, 20 m mosaic distributed with Barker et al. 2023 (PGDA product 90) | 0.011 | ≤ 0.010 | probability |
| `nac.simulated.m139729686` | Barker et al. 2023, simulated NAC frame `M139729686_20MPP_MODEL.TIF` (PGDA product 90) | 2.64 | ≤ 2.00 | percent |
| `nac.photo.m139729686` | LROC NAC photograph `M139729686LE/RE`, 20 m mosaic distributed with Barker et al. 2023 (PGDA product 90) | 0.026 | ≤ 0.010 | probability |
| `avgvisib.earth.85s_060m` | LOLA team illumination rasters, 2016 release (Mazarico et al. 2011 method), `AVGVISIB_85S_060M_201608_EARTH` | 5.14 | ≤ 5.00 | points |
| `avgvisib.earth.75s_120m` | LOLA team illumination rasters, 2016 release (Mazarico et al. 2011 method), `AVGVISIB_75S_120M_201608_EARTH` | 5.54 | ≤ 5.00 | points |
| `avgvisib.earth.65s_240m` | LOLA team illumination rasters, 2016 release (Mazarico et al. 2011 method), `AVGVISIB_65S_240M_201608_EARTH` | 14.96 | ≤ 5.00 | points |
| `avgvisib.earth.65n_240m` | LOLA team illumination rasters, 2016 release (Mazarico et al. 2011 method), `AVGVISIB_65N_240M_201608_EARTH` | 12.91 | ≤ 5.00 | points |
| `terrain.retroreflector_heights` | Retroreflector coordinates from lunar laser ranging, Park et al. 2021 (DE440), Table 1 | 7.15 | ≤ 3.00 | stated σ |

## Every case

### Sun–Earth–Moon geometry

| Case | Source | Class | Metric | Result | Limit | Unit | Status |
|---|---|---|---|---|---|---|---|
| `eclipse.totality_contacts` | [NASA GSFC lunar eclipse figures (Espenak), VSOP87/ELP2000-85](https://eclipse.gsfc.nasa.gov/LEcat5/LE2001-2100.html) | computation | largest \|engine − published\| (n = 20) | 4.88 | ≤ 10.00 | s | pass |
| `eclipse.umbral_contacts` | [NASA GSFC lunar eclipse figures (Espenak), VSOP87/ELP2000-85](https://eclipse.gsfc.nasa.gov/LEcat5/LE2001-2100.html) | computation | largest \|engine − published\| (n = 28) | 3.30 | ≤ 10.00 | s | pass |
| `eclipse.penumbral_contacts` | [NASA GSFC lunar eclipse figures (Espenak), VSOP87/ELP2000-85](https://eclipse.gsfc.nasa.gov/LEcat5/LE2001-2100.html) | computation | largest \|engine − published\| (n = 50) | 4.78 | ≤ 10.00 | s | pass |
| `eclipse.grazing_contacts` | [NASA GSFC lunar eclipse figures (Espenak), VSOP87/ELP2000-85](https://eclipse.gsfc.nasa.gov/LEcat5/LE2001-2100.html) | computation | largest \|engine − published\| (n = 10) | 66.78 |  | s | report only |
| `apollo.sun_direction` | [Apollo Lunar Surface Journal, Sun and Earth altitude table (J. Scotti), from the Nautical Almanac](https://www.nasa.gov/wp-content/uploads/static/history/alsj/Scotti_AltAz.txt) | computation | largest angle between engine and table direction (n = 41) | 0.029 | ≤ 0.100 | deg | pass |
| `apollo.subpoints` | [Apollo Lunar Surface Journal, Sun and Earth altitude table (J. Scotti), from the Nautical Almanac](https://www.nasa.gov/wp-content/uploads/static/history/alsj/Scotti_AltAz.txt) | computation | largest great-circle distance between engine and table point (n = 82) | 0.072 | ≤ 0.100 | deg | pass |
| `apollo.earth_direction` | [Apollo Lunar Surface Journal, Sun and Earth altitude table (J. Scotti), from the Nautical Almanac](https://www.nasa.gov/wp-content/uploads/static/history/alsj/Scotti_AltAz.txt) | computation | largest angle between engine and table direction (n = 41) | 0.262 |  | deg | report only |
| `inpop.sun_earth_directions` | [INPOP21a planetary and lunar ephemeris (Paris Observatory, IMCCE)](https://www.imcce.fr/recherche/equipes/asd/inpop/download21a) | computation | largest angle between engine (DE440) and INPOP21a direction (n = 1000) | 5.17e-07 | ≤ 1.00e-05 | deg | pass |
| `inpop.ranges` | [INPOP21a planetary and lunar ephemeris (Paris Observatory, IMCCE)](https://www.imcce.fr/recherche/equipes/asd/inpop/download21a) | computation | largest \|engine − INPOP21a\| (n = 500) | 0.235 |  | m | report only |
| `inpop.lunar_orientation` | [INPOP21a lunar libration (Paris Observatory, IMCCE)](https://www.imcce.fr/recherche/equipes/asd/inpop/download21a) | computation | largest angle between the DE440 and INPOP21a principal-axis frames (n = 500) | 4.66e-05 |  | deg | report only |
| `closed_form.synodic_month` | [mean synodic month, 29.530589 d (Explanatory Supplement to the Astronomical Almanac)](https://aa.usno.navy.mil/publications/exp_supp) | computation | \|engine mean − 29.530589 d\| (n = 234) | 3.40e-04 | ≤ 5.00e-03 | d | pass |
| `horizons.sun_direction` | [JPL Horizons observer tables (cached responses)](https://ssd.jpl.nasa.gov/horizons/) | implementation | largest angle between engine and Horizons direction (n = 800) | 3.36e-08 | ≤ 1.00e-05 | deg | pass |
| `horizons.earth_direction` | [JPL Horizons observer tables (cached responses)](https://ssd.jpl.nasa.gov/horizons/) | implementation | largest angle between engine and Horizons direction (n = 800) | 5.74e-07 | ≤ 1.00e-05 | deg | pass |
| `spice.direction` | [SPICE `spkcpo` with converged light time and stellar aberration](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/spkcpo_c.html) | implementation | largest angle between engine and SPICE direction (n = 3200) | 1.97e-07 | ≤ 1.00e-05 | deg | pass |
| `llr.grasse` | [Lunar laser ranging normal points 2009–2024, as collected by the Paris Observatory Lunar Analysis Center](http://polac.obspm.fr/llrdatae.html) | observation | 95th percentile of \|measured − engine\| one-way distance, Moon at least 20° above the station's horizon (n = 11457) | 0.531 | ≤ 2.00 | m | pass |
| `llr.matera` | [Lunar laser ranging normal points 2003–2024, as collected by the Paris Observatory Lunar Analysis Center](http://polac.obspm.fr/llrdatae.html) | observation | 95th percentile of \|measured − engine\| one-way distance, Moon at least 20° above the station's horizon (n = 439) | 0.689 | ≤ 2.00 | m | pass |

### Sunlight and eclipse at a landed site

| Case | Source | Class | Metric | Result | Limit | Unit | Status |
|---|---|---|---|---|---|---|---|
| `blueghost.eclipse_predicted` | [Firefly Aerospace, Blue Ghost Mission 1 live updates (operator's prediction, 13 March 2025)](https://fireflyspace.com/news/blue-ghost-mission-1-live-updates) | computation | largest \|engine − Firefly\| (n = 4) | 118.0 | ≤ 120.0 | s | pass |
| `blueghost.eclipse_observed_states` | [Firefly Aerospace, Blue Ghost Mission 1 live updates (images of 14 March 2025)](https://fireflyspace.com/news/blue-ghost-mission-1-live-updates) | observation | observed states the engine contradicts (n = 2) | 0 | ≤ 0 | states | pass |
| `blueghost.totality_end_observed` | [Firefly Aerospace, Blue Ghost Mission 1 live updates (image of 14 March 2025)](https://fireflyspace.com/news/blue-ghost-mission-1-live-updates) | observation | \|engine − observed\| (n = 1) | 5.88 | ≤ 15.00 | min | pass |
| `blueghost.sunset` | [Firefly Aerospace, Blue Ghost Mission 1 live updates (346 hours of daylight; five hours into the night at last data)](https://fireflyspace.com/news/blue-ghost-mission-1-live-updates) | observation | time between the engine's sunset and Firefly's 18:00–18:30 UTC window (n = 1) | 0.621 | ≤ 1.00 | h | pass |
| `slim.sunset_dates` | [ISAS/JAXA, SLIM operation status (last date of each period of operations)](https://www.isas.jaxa.jp/home/slim/SLIM/operation_status/index.html) | observation | largest time between the engine's sunset and the published date (n = 4) | 0 | ≤ 24.00 | h | pass |
| `slim.sun_up_in_operations` | [ISAS/JAXA, SLIM operation status](https://www.isas.jaxa.jp/home/slim/SLIM/operation_status/index.html) | observation | operating dates on which the engine has the Sun down (n = 17) | 0 | ≤ 0 | dates | pass |
| `chandrayaan3.local_time` | ChaSTE event table, as recorded in `docs/validation/scenario.md` §3.2 (not reopened) | computation | largest \|engine − label\| (n = 4) | 8.00e-03 | ≤ 1.00 | h | pass |
| `chandrayaan3.sun_up_before_sleep` | [ISRO statement of 4 September 2023; landing time from the ChaSTE table](https://www.isro.gov.in/Chandrayaan3_Details.html) | observation | instants at which the engine has the Sun down (n = 2) | 0 | ≤ 0 | instants | pass |
| `landings.sun_up` | [touchdown times and positions in `catalog/sites.yaml` (NSSDCA, LROC and agency reports)](https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_artifact_impacts.html) | observation | lowest engine Sun elevation at touchdown (n = 20) | 2.47 | ≥ 0 | deg | pass |

### Long-run sunlight and permanent shadow

| Case | Source | Class | Metric | Result | Limit | Unit | Status |
|---|---|---|---|---|---|---|---|
| `avgvisib.sun.85s_060m` | [LOLA team illumination rasters, 2016 release (Mazarico et al. 2011 method), `AVGVISIB_85S_060M_201608`](https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/) | computation | 95th percentile of \|engine − published\| (n = 1000) | 2.99 | ≤ 4.00 | points | pass |
| `avgvisib.sun.75s_120m` | [LOLA team illumination rasters, 2016 release (Mazarico et al. 2011 method), `AVGVISIB_75S_120M_201608`](https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/) | computation | 95th percentile of \|engine − published\| (n = 1000) | 4.10 | ≤ 4.00 | points | FAIL |
| `avgvisib.sun.65s_240m` | [LOLA team illumination rasters, 2016 release (Mazarico et al. 2011 method), `AVGVISIB_65S_240M_201608`](https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/) | computation | 95th percentile of \|engine − published\| (n = 1000) | 7.76 | ≤ 4.00 | points | FAIL |
| `avgvisib.sun.65n_240m` | [LOLA team illumination rasters, 2016 release (Mazarico et al. 2011 method), `AVGVISIB_65N_240M_201608`](https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/) | computation | 95th percentile of \|engine − published\| (n = 1000) | 8.09 | ≤ 4.00 | points | FAIL |
| `glaeser2014.average_illumination` | [Gläser 2014 (thesis Table 7; Gläser et al. 2014, Icarus 243), 20 m DEM](https://doi.org/10.1016/j.icarus.2014.08.013) | computation | largest \|engine − paper\| (n = 4) | 3.18 | ≤ 4.00 | points | pass |
| `glaeser2014.longest_dark_10m` | [Gläser 2014 (thesis Table 7), 20 m DEM](https://doi.org/10.1016/j.icarus.2014.08.013) | computation | largest \|engine − paper\| (n = 2) | 1.08 | ≤ 24.00 | h | pass |
| `glaeser2014.longest_dark_2m` | [Gläser 2014 (thesis Table 7), 20 m DEM](https://doi.org/10.1016/j.icarus.2014.08.013) | computation | largest \|engine − paper\| (n = 2) | 160.1 | ≤ 24.00 | h | FAIL |
| `glaeser2018.maximum_illumination` | [Gläser et al. 2018, Planetary and Space Science 162, Tables 1 and 2, 20 m DEM](https://ntrs.nasa.gov/api/citations/20170007365/downloads/20170007365.pdf) | computation | largest \|engine maximum − paper maximum\| (n = 7) | 3.60 | ≤ 4.00 | points | pass |
| `mazarico2011.connecting_ridge_surface` | [Mazarico et al. 2011, Icarus 211, Table 3 (as quoted by Gläser 2014 and 2018)](https://doi.org/10.1016/j.icarus.2010.10.030) | computation | \|engine maximum − paper maximum\| (n = 491) | 14.05 | ≤ 4.00 | points | FAIL |
| `mazarico2011.shackleton_rim_surface` | [Mazarico et al. 2011, Icarus 211, Table 3 (as quoted by Gläser et al. 2018)](https://doi.org/10.1016/j.icarus.2010.10.030) | computation | \|engine maximum − paper maximum\| (n = 491) | 2.75 | ≤ 4.00 | points | pass |
| `mazarico2011.connecting_ridge_10m` | [Mazarico et al. 2011, Icarus 211, Table 3 (as quoted by Gläser 2014)](https://doi.org/10.1016/j.icarus.2010.10.030) | computation | \|engine maximum − paper maximum\| (n = 4) | 0.348 | ≤ 4.00 | points | pass |
| `avgvisib.crest_pixels` | [LOLA team illumination rasters, 2016 release, `AVGVISIB_85S_060M_201608`](https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/) | computation | mean \|engine − published\| (n = 50) | 4.40 | ≤ 2.00 | points | FAIL |
| `literature.no_eternal_light` | [Mazarico et al. 2011, Gläser et al. 2014 and 2018, De Rosa et al. 2012, Bryant 2009 (all find none)](https://doi.org/10.1016/j.pss.2017.07.006) | computation | highest engine average Sun visibility among the brightest published pixels (n = 50) | 86.64 | ≤ 99.00 | percent | pass |
| `psr.lola2016.south` | [LOLA team illumination rasters, 2016 release (pixels with value 0)](https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/) | computation | share of sampled pixels where engine and raster disagree on permanent shadow (n = 3000) | 0.833 | ≤ 2.00 | percent | pass |
| `psr.lola2016.north` | [LOLA team illumination rasters, 2016 release (pixels with value 0)](https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/) | computation | share of sampled pixels where engine and raster disagree on permanent shadow (n = 1000) | 1.20 | ≤ 2.00 | percent | pass |
| `psr.barker2023` | [Barker et al. 2023, `LPSR_80S_20MPP_ADJ.TIF` (PGDA product 90)](https://pgda.gsfc.nasa.gov/products/90) | computation | share of sampled pixels where engine and map disagree on permanent shadow (n = 600) | 1.17 | ≤ 2.00 | percent | pass |
| `wac.observed_illumination` | [LROC WAC polar illumination map, `WAC_POLE_ILL_PCT_SOUTH_100M` (Speyerer & Robinson 2013)](https://data.lroc.im-ldi.com/lroc/view_rdr/WAC_POLE_ILL_PCT_SOUTH) | observation | rank correlation between engine and observed share (n = 600) | 0.980 |  | Spearman | report only |

### Shadows at one instant, against orbital photographs

| Case | Source | Class | Metric | Result | Limit | Unit | Status |
|---|---|---|---|---|---|---|---|
| `nac.simulated.m1188426614` | [Barker et al. 2023, simulated NAC frame `M1188426614_20MPP_MODEL.TIF` (PGDA product 90)](https://pgda.gsfc.nasa.gov/products/90) | computation | share of sampled pixels, more than one pixel from the published shadow edge, where engine and frame disagree (n = 998) | 2.10 | ≤ 2.00 | percent | FAIL |
| `nac.photo.m1188426614` | [LROC NAC photograph `M1188426614LE/RE`, 20 m mosaic distributed with Barker et al. 2023 (PGDA product 90)](https://pgda.gsfc.nasa.gov/products/90) | observation | how much worse the engine separates dark from bright pixels in the photo than Barker's published simulation does (n = 1000) | 0.011 | ≤ 0.010 | probability | FAIL |
| `nac.simulated.m139729686` | [Barker et al. 2023, simulated NAC frame `M139729686_20MPP_MODEL.TIF` (PGDA product 90)](https://pgda.gsfc.nasa.gov/products/90) | computation | share of sampled pixels, more than one pixel from the published shadow edge, where engine and frame disagree (n = 946) | 2.64 | ≤ 2.00 | percent | FAIL |
| `nac.photo.m139729686` | [LROC NAC photograph `M139729686LE/RE`, 20 m mosaic distributed with Barker et al. 2023 (PGDA product 90)](https://pgda.gsfc.nasa.gov/products/90) | observation | how much worse the engine separates dark from bright pixels in the photo than Barker's published simulation does (n = 1000) | 0.026 | ≤ 0.010 | probability | FAIL |
| `nac.simulated.m184288222` | [Barker et al. 2023, simulated NAC frame `M184288222_20MPP_MODEL.TIF` (PGDA product 90)](https://pgda.gsfc.nasa.gov/products/90) | computation | share of sampled pixels, more than one pixel from the published shadow edge, where engine and frame disagree (n = 977) | 1.43 | ≤ 2.00 | percent | pass |
| `nac.photo.m184288222` | [LROC NAC photograph `M184288222LE/RE`, 20 m mosaic distributed with Barker et al. 2023 (PGDA product 90)](https://pgda.gsfc.nasa.gov/products/90) | observation | how much worse the engine separates dark from bright pixels in the photo than Barker's published simulation does (n = 1000) | 3.97e-05 | ≤ 0.010 | probability | pass |

### Earth visibility

| Case | Source | Class | Metric | Result | Limit | Unit | Status |
|---|---|---|---|---|---|---|---|
| `avgvisib.earth.85s_060m` | [LOLA team illumination rasters, 2016 release (Mazarico et al. 2011 method), `AVGVISIB_85S_060M_201608_EARTH`](https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/) | computation | 95th percentile of \|engine − published\| (n = 1000) | 5.14 | ≤ 5.00 | points | FAIL |
| `avgvisib.earth.75s_120m` | [LOLA team illumination rasters, 2016 release (Mazarico et al. 2011 method), `AVGVISIB_75S_120M_201608_EARTH`](https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/) | computation | 95th percentile of \|engine − published\| (n = 1000) | 5.54 | ≤ 5.00 | points | FAIL |
| `avgvisib.earth.65s_240m` | [LOLA team illumination rasters, 2016 release (Mazarico et al. 2011 method), `AVGVISIB_65S_240M_201608_EARTH`](https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/) | computation | 95th percentile of \|engine − published\| (n = 1000) | 14.96 | ≤ 5.00 | points | FAIL |
| `avgvisib.earth.65n_240m` | [LOLA team illumination rasters, 2016 release (Mazarico et al. 2011 method), `AVGVISIB_65N_240M_201608_EARTH`](https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/) | computation | 95th percentile of \|engine − published\| (n = 1000) | 12.91 | ≤ 5.00 | points | FAIL |
| `glaeser2014.earth_cycle` | [Gläser 2014 (thesis §7.3, Fig. 72)](https://doi.org/10.1016/j.icarus.2014.08.013) | computation | largest \|engine mean − paper\| of the two lengths (n = 2) | 1.46 |  | d | report only |
| `bryant2009.earth_on_massifs` | [Bryant 2009, JPL IPN Progress Report 42-176, Table 4 (Goldstone radar DEM)](https://ipnpr.jpl.nasa.gov/progress_report/42-176/176C.pdf) | computation | lowest engine share of time with any part of the Earth in view, of the two peaks (n = 2) | 45.18 |  | percent | report only |
| `bryant2009.earth_on_rim_peaks` | [Bryant 2009, JPL IPN Progress Report 42-176, Table 4 (Goldstone radar DEM)](https://ipnpr.jpl.nasa.gov/progress_report/42-176/176C.pdf) | computation | how far the engine's peak values fall outside 62–71 % (n = 9) | 62.00 |  | points | report only |
| `bryant2009.earth_height_insensitive` | [Bryant 2009, JPL IPN Progress Report 42-176, Table 6](https://ipnpr.jpl.nasa.gov/progress_report/42-176/176C.pdf) | computation | \|engine change from 2 m to 32 m\| (n = 2) | 18.78 |  | points | report only |
| `bryant2009.point_values` | [Bryant 2009, JPL IPN Progress Report 42-176, Tables 3 and 4](https://ipnpr.jpl.nasa.gov/progress_report/42-176/176C.pdf) | computation | largest \|engine − Bryant\| over both quantities (n = 11) | 70.97 |  | points | report only |
| `farside.earth_never_visible` | [CNSA mission reports (both landers communicated only through the Queqiao relay satellites)](https://www.cnsa.gov.cn/english/n6465652/n6465653/c6805049/content.html) | observation | highest elevation of the Earth's upper limb over 62 days (n = 2) | -36.25 | ≤ 0 | deg | pass |

### Horizon and disc mathematics

| Case | Source | Class | Metric | Result | Limit | Unit | Status |
|---|---|---|---|---|---|---|---|
| `closed_form.sphere_dip` | closed form, −acos(R / (R + h)) | implementation | largest distance from the closed form to the engine's bracket or estimate (n = 360) | 4.76e-13 | ≤ 0.010 | deg | pass |
| `closed_form.plateau_edge` | closed form on the sphere, elevation of a point at a given distance and height | implementation | largest distance from the closed form to the engine's bracket (n = 41) | 0 | ≤ 0.010 | deg | pass |
| `closed_form.brute_force_horizon` | dense sampling along the exact ray (`lunarnav.horizon.reference.ray_reference`) | implementation | largest excess of the reference over the engine's upper bracket, or over the lower bracket plus 0.02° (n = 192) | -1.94e-03 | ≤ 0 | deg | pass |
| `closed_form.disc_fraction` | closed form, area of a circular segment | implementation | largest \|engine − closed form\| of the area fraction (n = 241) | 9.99e-16 | ≤ 1.00e-04 | fraction | pass |

### Terrain heights

| Case | Source | Class | Metric | Result | Limit | Unit | Status |
|---|---|---|---|---|---|---|---|
| `terrain.retroreflector_heights` | [Retroreflector coordinates from lunar laser ranging, Park et al. 2021 (DE440), Table 1](https://doi.org/10.3847/1538-3881/abd414) | observation | largest \|engine terrain − laser-ranging height\|, in units of the vertical error the engine states for that store (n = 5) | 7.15 | ≤ 3.00 | stated σ | FAIL |

## Tolerances and where they come from

| Case | Basis of the tolerance |
|---|---|
| `eclipse.totality_contacts` | Set before the run. Published contacts and ΔT are each rounded to 1 s, and the ELP2000-85 lunar series is good to about an arc-second while the Moon moves 0.5 arc-seconds per second against the shadow. Gated only where totality lasts at least 35 minutes, so the limb does not graze the umbra. |
| `eclipse.umbral_contacts` | Same as the totality contacts. Gated where the umbral phase lasts at least 70 minutes. |
| `eclipse.penumbral_contacts` | Same as the totality contacts. Gated where the penumbral phase lasts at least 120 minutes. |
| `eclipse.grazing_contacts` | No tolerance. At a grazing contact the timing error of the reference grows without bound. |
| `apollo.sun_direction` | Set before the run. The table is printed to 0.01°, is interpolated from almanac values tabulated to 0.01°, and the almanacs of 1969–72 may leave out the physical libration (up to about 0.04°). A row is left out when the table contradicts itself there: its printed altitude and azimuth differ by more than 0.03° from the direction of its own sub-point. That rule looks only at the table (added after one row with a mistyped azimuth failed the first run). |
| `apollo.subpoints` | Same as the Apollo Sun direction. |
| `apollo.earth_direction` | No tolerance. The table's Earth altitude leaves out lunar parallax, which the engine includes. |
| `inpop.sun_earth_directions` | The accuracy the engine claims for Sun and Earth directions, "dominated by ephemeris uncertainty" (`docs/validation/ephemeris.md` §1). |
| `inpop.ranges` | No tolerance. The engine states no accuracy for distances. |
| `inpop.lunar_orientation` | No tolerance. The two ephemerides define their principal axes from different gravity fields. |
| `closed_form.synodic_month` | Set before the run. Single lunations differ from the mean by up to 0.3 d and libration moves the meridian passage by up to 0.65 d; over the 234 lunations averaged that leaves at most 0.004 d. |
| `horizons.sun_direction` | The accuracy the engine claims for Sun and Earth directions (`docs/validation/ephemeris.md` §1). |
| `horizons.earth_direction` | The accuracy the engine claims for Sun and Earth directions (`docs/validation/ephemeris.md` §1). |
| `spice.direction` | The accuracy the engine claims for Sun and Earth directions (`docs/validation/ephemeris.md` §1). |
| `llr.grasse` | The measurement is good to centimetres; the limit is what the comparison leaves out. One way, in metres: the engine's own stated range residual 0.4; air delay after a pressure-scaled Marini–Murray correction 0.3; Earth body tide at the station 0.3; lunar body tide 0.5; relativity beyond the Sun and Earth light-time delay 0.2; Earth orientation and frame 0.1; coordinates 0.1. Sum 1.9. Written before any residual was computed. The DE440 ephemeris was itself fitted to laser ranging, including these stations, so this tests the engine's station, light-time and frame handling against measurement, not the ephemeris independently. |
| `llr.matera` | The measurement is good to centimetres; the limit is what the comparison leaves out. One way, in metres: the engine's own stated range residual 0.4; air delay after a pressure-scaled Marini–Murray correction 0.3; Earth body tide at the station 0.3; lunar body tide 0.5; relativity beyond the Sun and Earth light-time delay 0.2; Earth orientation and frame 0.1; coordinates 0.1. Sum 1.9. Written before any residual was computed. The DE440 ephemeris was itself fitted to laser ranging, including these stations, so this tests the engine's station, light-time and frame handling against measurement, not the ephemeris independently. |
| `blueghost.eclipse_predicted` | The ±2 minute target of `docs/validation/ephemeris.md` §6.1; Firefly's times are rounded to the minute and its shadow convention is not stated. |
| `blueghost.eclipse_observed_states` | One-sided. A photograph of the partial eclipse or of totality cannot be taken when there is none. |
| `blueghost.totality_end_observed` | Set before the run. Firefly gives the image time as "around 3:30 am", that is to the half hour. |
| `blueghost.sunset` | The 1 hour target of `docs/validation/scenario.md` §3.1, on the default terrain stack as the product runs. |
| `slim.sunset_dates` | The 1 day target of `docs/validation/scenario.md` §3.3; JAXA gives dates only. |
| `slim.sun_up_in_operations` | One-sided. A lander without a working battery cannot operate with the Sun below the horizon. |
| `chandrayaan3.local_time` | The lower end of the 1–3 hour target of `docs/validation/scenario.md` §3.2. |
| `chandrayaan3.sun_up_before_sleep` | One-sided. The lander was operating on solar power at both instants. A sleep time is an operating decision, so it says nothing about when the Sun set. |
| `landings.sun_up` | One-sided. These landers touched down in daylight: the Surveyors and Apollo crews imaged a sunlit surface at once and the later landers ran on solar power. The battery-powered Luna landers are left out (decided after the first run showed Luna 13 at −3.5°: nothing opened says it landed in daylight, and its panoramas came on the following days). |
| `avgvisib.sun.85s_060m` | The target of `docs/validation/illumination.md` §3.1 for the Sun (95th percentile at most 4 points, mean 1–2 points), applied to every raster. |
| `avgvisib.sun.75s_120m` | The target of `docs/validation/illumination.md` §3.1 for the Sun (95th percentile at most 4 points, mean 1–2 points), applied to every raster. |
| `avgvisib.sun.65s_240m` | The target of `docs/validation/illumination.md` §3.1 for the Sun (95th percentile at most 4 points, mean 1–2 points), applied to every raster. |
| `avgvisib.sun.65n_240m` | The target of `docs/validation/illumination.md` §3.1 for the Sun (95th percentile at most 4 points, mean 1–2 points), applied to every raster. |
| `glaeser2014.average_illumination` | Set before the run. De Rosa et al. 2012 (Table 4) found two independent horizon-method tools on the same DEM agree within 4 % in average illumination; the same allowance is used for every published point value. |
| `glaeser2014.longest_dark_10m` | Set before the run at one day, the resolution a planner works to for a dark period; the paper prints 0.01 d. |
| `glaeser2014.longest_dark_2m` | Same as the 10 m spots. |
| `glaeser2018.maximum_illumination` | Same allowance as the Gläser 2014 average illumination. The search radius of 300 m is the one `docs/validation/scenario.md` §11 used. |
| `mazarico2011.connecting_ridge_surface` | Same allowance as the Gläser 2014 average illumination. The 3 km search radius is the one `docs/validation/scenario.md` §11.4 used. |
| `mazarico2011.shackleton_rim_surface` | Same as the Connecting Ridge surface case. |
| `mazarico2011.connecting_ridge_10m` | Same allowance as the Gläser 2014 average illumination, within 300 m (the precision of the printed point). |
| `avgvisib.crest_pixels` | The 1–2 point target of `docs/validation/illumination.md` §3 for the Sun, at the pixels a planner cares most about. |
| `literature.no_eternal_light` | Set before the run. Every study's best surface value is below 100 %; the published maximum of the 60 m raster is 88.4 %. |
| `psr.lola2016.south` | Set before the run. The two published maps of permanent shadow (these rasters and Barker et al. 2023) disagree with each other on 0.6–0.9 % of pixels (`docs/validation/illumination.md` §2); the engine is allowed twice that. |
| `psr.lola2016.north` | Same as the south case. |
| `psr.barker2023` | Same as the LOLA 2016 south case. |
| `wac.observed_illumination` | No tolerance. The map counts a pixel lit from its brightness in an image at 100 m, which is not the engine's quantity, and no source says how close the two should be. The rank correlation is reported. |
| `nac.simulated.m1188426614` | Same 2 % allowance as the permanent-shadow maps. Pixels touching the published shadow edge are left out because a 20 m pixel on the edge is partly lit; the share with them included is reported in the detail. Set before the engine was run on the frame. |
| `nac.photo.m1188426614` | Barker's simulation separates the photo's dark and bright pixels with probability 0.986 to 0.998 (measured from the published files alone). The engine must match the photo as well as that simulation to within 0.01. Set before the engine was run on the frame. |
| `nac.simulated.m139729686` | Same 2 % allowance as the permanent-shadow maps. Pixels touching the published shadow edge are left out because a 20 m pixel on the edge is partly lit; the share with them included is reported in the detail. Set before the engine was run on the frame. |
| `nac.photo.m139729686` | Barker's simulation separates the photo's dark and bright pixels with probability 0.986 to 0.998 (measured from the published files alone). The engine must match the photo as well as that simulation to within 0.01. Set before the engine was run on the frame. |
| `nac.simulated.m184288222` | Same 2 % allowance as the permanent-shadow maps. Pixels touching the published shadow edge are left out because a 20 m pixel on the edge is partly lit; the share with them included is reported in the detail. Set before the engine was run on the frame. |
| `nac.photo.m184288222` | Barker's simulation separates the photo's dark and bright pixels with probability 0.986 to 0.998 (measured from the published files alone). The engine must match the photo as well as that simulation to within 0.01. Set before the engine was run on the frame. |
| `avgvisib.earth.85s_060m` | The 5 point target of `docs/validation/illumination.md` §3.1 for the Earth, read on the 95th percentile as that report does, applied to every raster. |
| `avgvisib.earth.75s_120m` | The 5 point target of `docs/validation/illumination.md` §3.1 for the Earth, read on the 95th percentile as that report does, applied to every raster. |
| `avgvisib.earth.65s_240m` | The 5 point target of `docs/validation/illumination.md` §3.1 for the Earth, read on the 95th percentile as that report does, applied to every raster. |
| `avgvisib.earth.65n_240m` | The 5 point target of `docs/validation/illumination.md` §3.1 for the Earth, read on the 95th percentile as that report does, applied to every raster. |
| `glaeser2014.earth_cycle` | Was a gate at one day; made report-only after the first run. The paper's windows are contact with ten ESA ground stations, the engine's are any part of the Earth's disc above the horizon. The disc takes over a day to rise, so the two differ by definition: engine 15.9 d and 11.3 d against 14.45 d and 12.8 d, the same 27.2-day cycle. |
| `bryant2009.earth_on_massifs` | Was a gate; made report-only after the first run. Bryant's coordinates are on Goldstone radar terrain from before LRO: his peak B1 is the Connecting Ridge crest, which the LOLA-based papers place 1.9 km away, so the engine was not standing on his peaks (it found the Sun up 25–57 % of the time where he has 85–97 %; at Gläser's spot 4 on that crest it gives 92 % Sun and 58 % Earth, close to his B1). For the massifs, the published LOLA Earth raster reads 6 % at his printed Malapert point and 88 % at the highest post within 6 km, where the engine gives 94 %, so his 100 % cannot be placed either. The reference cannot be located, so it does not test the engine. |
| `bryant2009.earth_on_rim_peaks` | Same as the massifs case, made report-only after the first run for the same reason. |
| `bryant2009.earth_height_insensitive` | Same as the massifs case, made report-only after the first run for the same reason. |
| `bryant2009.point_values` | No tolerance. The coordinates come from radar terrain made before LRO and cannot be tied to a post of today's DEM. |
| `farside.earth_never_visible` | One-sided. A direct link was never available at either site. |
| `closed_form.sphere_dip` | The 0.01° the closed-form cases of `docs/validation/horizon.md` §2.1 were held to. |
| `closed_form.plateau_edge` | The 0.01° the closed-form cases of `docs/validation/horizon.md` §2.1 were held to. |
| `closed_form.brute_force_horizon` | The property the bracket promises (`docs/validation/horizon.md` §2.2). It shares the terrain surface with the engine but not the search. |
| `closed_form.disc_fraction` | Set before the run at 0.01 points of illumination, a hundred times below the tolerances of the illumination cases. |
| `terrain.retroreflector_heights` | The engine attaches a 1σ vertical error to every terrain store and uses it in its error brackets. A height that is off by more than three of those is a wrong claim. Written before the heights were compared. |

## Details

### `eclipse.totality_contacts`

Contacts are found from the engine's Sun and Earth tracks over the whole lunar sphere, with the engine's default Danjon occulting radius, and `earth_eclipse_fraction` is confirmed to change state at each one. Compared in TT (published UT plus the figure's ΔT). Mean |residual| 2.14 s over 20 contacts.

| Eclipse | Contact | Phase duration (min) | Engine minus published (s) |
|---|---|---|---|
| 2025Mar14T | U2 | 65.40 | -4.53 |
| 2025Mar14T | U3 | 65.40 | 0.240 |
| 2025Sep07T | U2 | 82.10 | -3.01 |
| 2025Sep07T | U3 | 82.10 | -0.210 |
| 2026Mar03T | U2 | 58.30 | -3.77 |
| 2026Mar03T | U3 | 58.30 | 1.23 |
| 2028Dec31T | U2 | 71.40 | -3.17 |
| 2028Dec31T | U3 | 71.40 | -0.170 |
| 2029Jun26T | U2 | 101.9 | -2.43 |
| 2029Jun26T | U3 | 101.9 | 0.420 |
| 2029Dec20T | U2 | 53.70 | -4.66 |
| 2029Dec20T | U3 | 53.70 | 1.29 |
| 2032Apr25T | U2 | 65.50 | -3.83 |
| 2032Apr25T | U3 | 65.50 | 0.590 |
| 2032Oct18T | U2 | 47.10 | -3.22 |
| 2032Oct18T | U3 | 47.10 | 1.55 |
| 2033Apr14T | U2 | 49.20 | -4.88 |
| 2033Apr14T | U3 | 49.20 | 0.990 |
| 2033Oct08T | U2 | 78.80 | -2.53 |
| 2033Oct08T | U3 | 78.80 | 0.100 |

### `eclipse.umbral_contacts`

Contacts are found from the engine's Sun and Earth tracks over the whole lunar sphere, with the engine's default Danjon occulting radius, and `earth_eclipse_fraction` is confirmed to change state at each one. Compared in TT (published UT plus the figure's ΔT). Mean |residual| 1.48 s over 28 contacts.

| Eclipse | Contact | Phase duration (min) | Engine minus published (s) |
|---|---|---|---|
| 2025Mar14T | U1 | 218.3 | -3.04 |
| 2025Mar14T | U4 | 218.3 | -0.800 |
| 2025Sep07T | U1 | 209.4 | -2.44 |
| 2025Sep07T | U4 | 209.4 | -0.030 |
| 2026Mar03T | U1 | 207.2 | -2.32 |
| 2026Mar03T | U4 | 207.2 | -0.120 |
| 2026Aug28P | U1 | 198.1 | -2.84 |
| 2026Aug28P | U4 | 198.1 | -0.020 |
| 2028Jul06P | U1 | 141.5 | -2.36 |
| 2028Jul06P | U4 | 141.5 | -0.530 |
| 2028Dec31T | U1 | 208.8 | -2.71 |
| 2028Dec31T | U4 | 208.8 | 0.280 |
| 2029Jun26T | U1 | 219.5 | -2.11 |
| 2029Jun26T | U4 | 219.5 | 0.260 |
| 2029Dec20T | U1 | 213.3 | -3.10 |
| 2029Dec20T | U4 | 213.3 | -0.550 |
| 2030Jun15P | U1 | 144.4 | -2.26 |
| 2030Jun15P | U4 | 144.4 | -0.430 |
| 2032Apr25T | U1 | 211.2 | -3.01 |
| 2032Apr25T | U4 | 211.2 | -0.290 |
| 2032Oct18T | U1 | 195.9 | -2.78 |
| 2032Oct18T | U4 | 195.9 | 0.450 |
| 2033Apr14T | U1 | 215.0 | -3.30 |
| 2033Apr14T | U4 | 215.0 | -0.090 |
| 2033Oct08T | U1 | 202.4 | -2.16 |
| 2033Oct08T | U4 | 202.4 | -0.260 |
| 2035Aug19P | U1 | 76.50 | -2.65 |
| 2035Aug19P | U4 | 76.50 | -0.300 |

### `eclipse.penumbral_contacts`

Contacts are found from the engine's Sun and Earth tracks over the whole lunar sphere, with the engine's default Danjon occulting radius, and `earth_eclipse_fraction` is confirmed to change state at each one. Compared in TT (published UT plus the figure's ΔT). Mean |residual| 1.68 s over 50 contacts.

| Eclipse | Contact | Phase duration (min) | Engine minus published (s) |
|---|---|---|---|
| 2024Mar25N | P1 | 279.1 | 1.05 |
| 2024Mar25N | P4 | 279.1 | 0.290 |
| 2024Sep18P | P1 | 246.3 | 0.410 |
| 2024Sep18P | P4 | 246.3 | 0.980 |
| 2025Mar14T | P1 | 362.6 | -1.75 |
| 2025Mar14T | P4 | 362.6 | -0.650 |
| 2025Sep07T | P1 | 326.6 | -2.27 |
| 2025Sep07T | P4 | 326.6 | -0.160 |
| 2026Mar03T | P1 | 338.6 | -3.13 |
| 2026Mar03T | P4 | 338.6 | -1.67 |
| 2026Aug28P | P1 | 337.8 | -2.43 |
| 2026Aug28P | P4 | 337.8 | -1.68 |
| 2027Feb20N | P1 | 241.0 | -3.82 |
| 2027Feb20N | P4 | 241.0 | -3.54 |
| 2027Aug17N | P1 | 218.6 | -2.90 |
| 2027Aug17N | P4 | 218.6 | -4.78 |
| 2028Jan12P | P1 | 250.7 | -0.630 |
| 2028Jan12P | P4 | 250.7 | 0 |
| 2028Jul06P | P1 | 310.6 | -2.04 |
| 2028Jul06P | P4 | 310.6 | -0.920 |
| 2028Dec31T | P1 | 336.2 | -3.04 |
| 2028Dec31T | P4 | 336.2 | -0.050 |
| 2029Jun26T | P1 | 335.1 | -2.41 |
| 2029Jun26T | P4 | 335.1 | 0.260 |
| 2029Dec20T | P1 | 358.0 | -3.05 |
| 2029Dec20T | P4 | 358.0 | -0.770 |
| 2030Jun15P | P1 | 278.2 | -2.70 |
| 2030Jun15P | P4 | 278.2 | -1.29 |
| 2030Dec09N | P1 | 279.2 | -1.13 |
| 2030Dec09N | P4 | 279.2 | -1.37 |
| 2031May07N | P1 | 237.3 | -1.96 |
| 2031May07N | P4 | 237.3 | -2.29 |
| 2031Oct30N | P1 | 231.8 | -1.71 |
| 2031Oct30N | P4 | 231.8 | -3.86 |
| 2032Apr25T | P1 | 342.4 | -2.57 |
| 2032Apr25T | P4 | 342.4 | -0.770 |
| 2032Oct18T | P1 | 315.4 | -3.16 |
| 2032Oct18T | P4 | 315.4 | -0.070 |
| 2033Apr14T | P1 | 361.2 | -2.17 |
| 2033Apr14T | P4 | 361.2 | -0.140 |
| 2033Oct08T | P1 | 312.6 | -2.62 |
| 2033Oct08T | P4 | 312.6 | 0.180 |
| 2034Apr03N | P1 | 265.4 | 0.950 |
| 2034Apr03N | P4 | 265.4 | -0.500 |
| 2034Sep28P | P1 | 248.7 | -0.430 |
| 2034Sep28P | P4 | 248.7 | -0.610 |
| 2035Feb22N | P1 | 255.7 | -2.73 |
| 2035Feb22N | P4 | 255.7 | -2.90 |
| 2035Aug19P | P1 | 289.9 | -1.71 |
| 2035Aug19P | P4 | 289.9 | -1.68 |

### `eclipse.grazing_contacts`

Phases shorter than the limits in the tolerance basis: the limb crosses the shadow edge at a shallow angle, so a small position difference becomes a large time difference. Mean |residual| 15.75 s over 10 contacts.

| Eclipse | Contact | Phase duration (min) | Engine minus published (s) |
|---|---|---|---|
| 2024Sep18P | U1 | 62.80 | -1.83 |
| 2024Sep18P | U4 | 62.80 | 1.69 |
| 2027Jul18N | P1 | 11.80 | 66.78 |
| 2027Jul18N | P4 | 11.80 | -66.22 |
| 2028Jan12P | U1 | 56.00 | -2.32 |
| 2028Jan12P | U4 | 56.00 | 0.910 |
| 2031Jun05N | P1 | 95.50 | 4.73 |
| 2031Jun05N | P4 | 95.50 | -5.68 |
| 2034Sep28P | U1 | 26.70 | -4.71 |
| 2034Sep28P | U4 | 26.70 | 2.64 |

### `apollo.sun_direction`

Engine `sun_track` at the table's own site coordinates, ground height 0, against the table's Sun altitude and azimuth (angle between the two directions). 2 of 43 rows are left out because the table contradicts itself there: its printed altitude and azimuth differ by more than 0.03° from the direction of its own sub-point (Apollo 11 EVA st (0.05°); Apollo 12 EVA1 end (0.39°)).

| Event | UTC | Table alt (°) | Engine alt (°) | Table az (°) | Engine az (°) | Separation (°) |
|---|---|---|---|---|---|---|
| Apollo 11 Landing | 1969-07-20T20:17:39Z | 10.65 | 10.66 | 88.81 | 88.81 | 0.014 |
| Apollo 11 1SSfM1GLfM | 1969-07-21T02:56:15Z | 14.03 | 14.05 | 88.84 | 88.84 | 0.018 |
| Apollo 11 EVA end | 1969-07-21T05:11:13Z | 15.17 | 15.19 | 88.85 | 88.85 | 0.024 |
| Apollo 11 Liftoff | 1969-07-21T17:54:00Z | 21.65 | 21.67 | 88.91 | 88.89 | 0.024 |
| Apollo 12 Landing | 1969-11-19T06:54:36Z | 5.19 | 5.19 | 91.16 | 91.16 | 3.60e-03 |
| Apollo 12 EVA1 st | 1969-11-19T11:32:35Z | 7.52 | 7.53 | 91.03 | 91.04 | 0.015 |
| Apollo 12 EVA2 st | 1969-11-20T03:54:45Z | 15.79 | 15.80 | 90.60 | 90.62 | 0.021 |
| Apollo 12 EVA2 end | 1969-11-20T07:44:00Z | 17.72 | 17.73 | 90.51 | 90.52 | 0.015 |
| Apollo 12 Liftoff | 1969-11-20T14:25:47Z | 21.11 | 21.12 | 90.33 | 90.34 | 0.015 |
| Apollo 14 Landing | 1971-02-05T09:18:13Z | 10.36 | 10.36 | 89.54 | 89.55 | 0.011 |
| Apollo 14 EVA1 st | 1971-02-05T14:42:13Z | 13.08 | 13.08 | 89.35 | 89.36 | 0.013 |
| Apollo 14 EVA1 end | 1971-02-05T19:30:03Z | 15.51 | 15.50 | 89.19 | 89.19 | 6.30e-03 |
| Apollo 14 EVA2 st | 1971-02-06T08:11:15Z | 21.91 | 21.91 | 88.71 | 88.72 | 0.014 |
| Apollo 14 EVA2 end | 1971-02-06T12:45:56Z | 24.22 | 24.22 | 88.53 | 88.55 | 0.015 |
| Apollo 14 Liftoff | 1971-02-06T18:48:42Z | 27.28 | 27.27 | 88.29 | 88.30 | 0.014 |
| Apollo 15 Landing | 1971-07-30T22:16:29Z | 12.05 | 12.04 | 95.73 | 95.72 | 9.80e-03 |
| Apollo 15 SEVA st | 1971-07-31T00:16:49Z | 12.96 | 12.96 | 96.20 | 96.19 | 7.70e-03 |
| Apollo 15 SEVA end | 1971-07-31T00:49:56Z | 13.21 | 13.21 | 96.33 | 96.32 | 7.00e-03 |
| Apollo 15 EVA1 st | 1971-07-31T13:13:17Z | 18.82 | 18.81 | 99.34 | 99.33 | 0.012 |
| Apollo 15 EVA1 end | 1971-07-31T19:45:59Z | 21.76 | 21.75 | 101.0 | 101.0 | 0.014 |
| Apollo 15 EVA2 st | 1971-08-01T11:48:49Z | 28.89 | 28.88 | 105.4 | 105.4 | 0.012 |
| Apollo 15 EVA2 end | 1971-08-01T19:01:02Z | 32.05 | 32.03 | 107.6 | 107.6 | 0.018 |
| Apollo 15 EVA3 st | 1971-08-02T08:52:14Z | 37.98 | 37.97 | 112.2 | 112.2 | 7.50e-03 |
| Apollo 15 EVA3 end | 1971-08-02T13:42:04Z | 40.00 | 40.00 | 114.0 | 114.0 | 6.40e-03 |
| Apollo 15 Liftoff | 1971-08-02T17:11:23Z | 41.45 | 41.44 | 115.3 | 115.3 | 5.90e-03 |
| Apollo 16 Landing | 1972-04-21T02:23:35Z | 14.76 | 14.77 | 86.01 | 86.00 | 0.018 |
| Apollo 16 EVA1 st | 1972-04-21T16:47:38Z | 21.96 | 21.98 | 84.65 | 84.65 | 0.016 |
| Apollo 16 EVA1 end | 1972-04-21T23:58:40Z | 25.55 | 25.56 | 83.93 | 83.92 | 0.018 |
| Apollo 16 EVA2 st | 1972-04-22T16:33:35Z | 33.80 | 33.82 | 82.02 | 82.01 | 0.022 |
| Apollo 16 EVA2 end | 1972-04-22T23:56:44Z | 37.47 | 37.48 | 81.04 | 81.03 | 0.018 |
| Apollo 16 EVA3 st | 1972-04-23T15:25:28Z | 45.11 | 45.12 | 78.59 | 78.58 | 0.016 |
| Apollo 16 EVA3 end | 1972-04-23T21:05:31Z | 47.89 | 47.90 | 77.52 | 77.50 | 0.018 |
| Apollo 16 Liftoff | 1972-04-24T01:25:47Z | 50.02 | 50.02 | 76.61 | 76.60 | 8.90e-03 |
| Apollo 17 Landing | 1972-12-11T19:54:58Z | 13.33 | 13.35 | 95.83 | 95.84 | 0.022 |
| Apollo 17 EVA1 st | 1972-12-11T23:54:49Z | 15.22 | 15.24 | 96.58 | 96.59 | 0.023 |
| Apollo 17 EVA1 end | 1972-12-12T07:06:42Z | 18.63 | 18.64 | 97.96 | 97.97 | 0.018 |
| Apollo 17 EVA2 st | 1972-12-12T23:28:06Z | 26.30 | 26.32 | 101.3 | 101.4 | 0.027 |
| Apollo 17 EVA2 end | 1972-12-13T07:05:02Z | 29.85 | 29.86 | 103.1 | 103.1 | 0.024 |
| Apollo 17 EVA3 st | 1972-12-13T22:25:48Z | 36.90 | 36.92 | 107.0 | 107.0 | 0.029 |
| Apollo 17 EVA3 end | 1972-12-14T05:40:56Z | 40.19 | 40.20 | 109.1 | 109.1 | 0.022 |
| Apollo 17 Liftoff | 1972-12-14T22:54:37Z | 47.79 | 47.80 | 115.0 | 115.1 | 0.024 |

### `apollo.subpoints`

Engine `subsolar_point` and `subearth_point(earth_view=True)` against the table's sub-solar and sub-Earth points (great-circle distance). 2 of 43 rows are left out because the table contradicts itself there: its printed altitude and azimuth differ by more than 0.03° from the direction of its own sub-point (Apollo 11 EVA st (0.05°); Apollo 12 EVA1 end (0.39°)).

| Event | UTC | Sub-solar difference (°) | Sub-Earth difference (°) |
|---|---|---|---|
| Apollo 11 Landing | 1969-07-20T20:17:39Z | 0.019 | 0.031 |
| Apollo 11 1SSfM1GLfM | 1969-07-21T02:56:15Z | 0.014 | 0.033 |
| Apollo 11 EVA end | 1969-07-21T05:11:13Z | 0.020 | 0.048 |
| Apollo 11 Liftoff | 1969-07-21T17:54:00Z | 0.020 | 0.050 |
| Apollo 12 Landing | 1969-11-19T06:54:36Z | 6.80e-03 | 9.80e-03 |
| Apollo 12 EVA1 st | 1969-11-19T11:32:35Z | 0.013 | 0.014 |
| Apollo 12 EVA2 st | 1969-11-20T03:54:45Z | 0.019 | 0.012 |
| Apollo 12 EVA2 end | 1969-11-20T07:44:00Z | 0.019 | 0.028 |
| Apollo 12 Liftoff | 1969-11-20T14:25:47Z | 0.013 | 0.027 |
| Apollo 14 Landing | 1971-02-05T09:18:13Z | 8.30e-03 | 0.056 |
| Apollo 14 EVA1 st | 1971-02-05T14:42:13Z | 0.011 | 0.053 |
| Apollo 14 EVA1 end | 1971-02-05T19:30:03Z | 5.40e-03 | 0.039 |
| Apollo 14 EVA2 st | 1971-02-06T08:11:15Z | 9.30e-03 | 0.045 |
| Apollo 14 EVA2 end | 1971-02-06T12:45:56Z | 0.014 | 0.052 |
| Apollo 14 Liftoff | 1971-02-06T18:48:42Z | 7.90e-03 | 0.032 |
| Apollo 15 Landing | 1971-07-30T22:16:29Z | 8.80e-03 | 6.20e-03 |
| Apollo 15 SEVA st | 1971-07-31T00:16:49Z | 7.40e-03 | 9.50e-03 |
| Apollo 15 SEVA end | 1971-07-31T00:49:56Z | 6.40e-03 | 6.90e-03 |
| Apollo 15 EVA1 st | 1971-07-31T13:13:17Z | 0.011 | 0.047 |
| Apollo 15 EVA1 end | 1971-07-31T19:45:59Z | 0.012 | 0.025 |
| Apollo 15 EVA2 st | 1971-08-01T11:48:49Z | 7.20e-03 | 0.051 |
| Apollo 15 EVA2 end | 1971-08-01T19:01:02Z | 0.015 | 0.034 |
| Apollo 15 EVA3 st | 1971-08-02T08:52:14Z | 9.60e-03 | 0.051 |
| Apollo 15 EVA3 end | 1971-08-02T13:42:04Z | 4.60e-03 | 0.052 |
| Apollo 15 Liftoff | 1971-08-02T17:11:23Z | 0.010 | 0.039 |
| Apollo 16 Landing | 1972-04-21T02:23:35Z | 0.016 | 3.90e-03 |
| Apollo 16 EVA1 st | 1972-04-21T16:47:38Z | 0.013 | 0.013 |
| Apollo 16 EVA1 end | 1972-04-21T23:58:40Z | 0.015 | 0.018 |
| Apollo 16 EVA2 st | 1972-04-22T16:33:35Z | 0.017 | 0.015 |
| Apollo 16 EVA2 end | 1972-04-22T23:56:44Z | 0.019 | 0.014 |
| Apollo 16 EVA3 st | 1972-04-23T15:25:28Z | 0.019 | 0.020 |
| Apollo 16 EVA3 end | 1972-04-23T21:05:31Z | 0.017 | 0.011 |
| Apollo 16 Liftoff | 1972-04-24T01:25:47Z | 0.010 | 0.018 |
| Apollo 17 Landing | 1972-12-11T19:54:58Z | 0.026 | 0.038 |
| Apollo 17 EVA1 st | 1972-12-11T23:54:49Z | 0.022 | 7.50e-03 |
| Apollo 17 EVA1 end | 1972-12-12T07:06:42Z | 0.022 | 0.052 |
| Apollo 17 EVA2 st | 1972-12-12T23:28:06Z | 0.023 | 0.018 |
| Apollo 17 EVA2 end | 1972-12-13T07:05:02Z | 0.023 | 0.071 |
| Apollo 17 EVA3 st | 1972-12-13T22:25:48Z | 0.028 | 0.034 |
| Apollo 17 EVA3 end | 1972-12-14T05:40:56Z | 0.022 | 0.072 |
| Apollo 17 Liftoff | 1972-12-14T22:54:37Z | 0.024 | 0.030 |

### `apollo.earth_direction`

The table's Earth altitude equals 90° minus the distance from the site to its own sub-Earth point to within 0.005°, so it has no parallax; the engine's `earth_track` is topocentric. The difference below is therefore mostly lunar parallax (up to 0.26°) and carries no tolerance.

| Event | UTC | Table alt (°) | Engine alt (°) | Separation (°) |
|---|---|---|---|---|
| Apollo 11 Landing | 1969-07-20T20:17:39Z | 59.43 | 59.27 | 0.166 |
| Apollo 11 1SSfM1GLfM | 1969-07-21T02:56:15Z | 59.30 | 59.13 | 0.170 |
| Apollo 11 EVA end | 1969-07-21T05:11:13Z | 59.27 | 59.09 | 0.180 |
| Apollo 11 Liftoff | 1969-07-21T17:54:00Z | 59.09 | 58.91 | 0.179 |
| Apollo 12 Landing | 1969-11-19T06:54:36Z | 61.56 | 61.42 | 0.138 |
| Apollo 12 EVA1 st | 1969-11-19T11:32:35Z | 61.54 | 61.40 | 0.141 |
| Apollo 12 EVA2 st | 1969-11-20T03:54:45Z | 61.48 | 61.34 | 0.135 |
| Apollo 12 EVA2 end | 1969-11-20T07:44:00Z | 61.48 | 61.34 | 0.143 |
| Apollo 12 Liftoff | 1969-11-20T14:25:47Z | 61.48 | 61.34 | 0.147 |
| Apollo 14 Landing | 1971-02-05T09:18:13Z | 66.10 | 65.96 | 0.146 |
| Apollo 14 EVA1 st | 1971-02-05T14:42:13Z | 66.19 | 66.05 | 0.146 |
| Apollo 14 EVA1 end | 1971-02-05T19:30:03Z | 66.26 | 66.14 | 0.128 |
| Apollo 14 EVA2 st | 1971-02-06T08:11:15Z | 66.55 | 66.42 | 0.138 |
| Apollo 14 EVA2 end | 1971-02-06T12:45:56Z | 66.67 | 66.53 | 0.143 |
| Apollo 14 Liftoff | 1971-02-06T18:48:42Z | 66.82 | 66.70 | 0.124 |
| Apollo 15 Landing | 1971-07-30T22:16:29Z | 69.28 | 69.20 | 0.078 |
| Apollo 15 SEVA st | 1971-07-31T00:16:49Z | 69.26 | 69.18 | 0.084 |
| Apollo 15 SEVA end | 1971-07-31T00:49:56Z | 69.25 | 69.17 | 0.081 |
| Apollo 15 EVA1 st | 1971-07-31T13:13:17Z | 69.03 | 68.97 | 0.067 |
| Apollo 15 EVA1 end | 1971-07-31T19:45:59Z | 68.91 | 68.84 | 0.070 |
| Apollo 15 EVA2 st | 1971-08-01T11:48:49Z | 68.52 | 68.46 | 0.070 |
| Apollo 15 EVA2 end | 1971-08-01T19:01:02Z | 68.33 | 68.26 | 0.071 |
| Apollo 15 EVA3 st | 1971-08-02T08:52:14Z | 67.91 | 67.84 | 0.085 |
| Apollo 15 EVA3 end | 1971-08-02T13:42:04Z | 67.75 | 67.68 | 0.085 |
| Apollo 15 Liftoff | 1971-08-02T17:11:23Z | 67.63 | 67.56 | 0.079 |
| Apollo 16 Landing | 1972-04-21T02:23:35Z | 77.16 | 77.11 | 0.055 |
| Apollo 16 EVA1 st | 1972-04-21T16:47:38Z | 76.32 | 76.27 | 0.053 |
| Apollo 16 EVA1 end | 1972-04-21T23:58:40Z | 75.90 | 75.83 | 0.067 |
| Apollo 16 EVA2 st | 1972-04-22T16:33:35Z | 74.89 | 74.81 | 0.076 |
| Apollo 16 EVA2 end | 1972-04-22T23:56:44Z | 74.43 | 74.36 | 0.072 |
| Apollo 16 EVA3 st | 1972-04-23T15:25:28Z | 73.49 | 73.41 | 0.079 |
| Apollo 16 EVA3 end | 1972-04-23T21:05:31Z | 73.15 | 73.07 | 0.077 |
| Apollo 16 Liftoff | 1972-04-24T01:25:47Z | 72.90 | 72.82 | 0.085 |
| Apollo 17 Landing | 1972-12-11T19:54:58Z | 45.52 | 45.30 | 0.221 |
| Apollo 17 EVA1 st | 1972-12-11T23:54:49Z | 45.32 | 45.13 | 0.190 |
| Apollo 17 EVA1 end | 1972-12-12T07:06:42Z | 45.09 | 44.85 | 0.238 |
| Apollo 17 EVA2 st | 1972-12-12T23:28:06Z | 44.56 | 44.36 | 0.202 |
| Apollo 17 EVA2 end | 1972-12-13T07:05:02Z | 44.46 | 44.20 | 0.262 |
| Apollo 17 EVA3 st | 1972-12-13T22:25:48Z | 44.25 | 44.03 | 0.223 |
| Apollo 17 EVA3 end | 1972-12-14T05:40:56Z | 44.28 | 44.02 | 0.260 |
| Apollo 17 Liftoff | 1972-12-14T22:54:37Z | 44.42 | 44.20 | 0.216 |

### `inpop.sun_earth_directions`

INPOP21a is fitted by another group with other software, largely to the same ranging and tracking data. Its Sun and Earth positions (light-time corrected, read in a separate process so its kernels never mix with the engine's) are turned into the engine's frame with the DE440 orientation, at 500 random epochs 2024–2035.

| Quantity | Mean |difference| | Largest |
|---|---|---|
| Earth direction from the Moon centre (°) | 3.87e-07 | 5.17e-07 |
| Sun direction from the Moon centre (°) | 1.05e-07 | 1.39e-07 |
| Sun–Earth separation seen from the Moon (°) | 2.96e-07 | 4.43e-07 |
| Moon–Earth distance (m) | 0.091 | 0.235 |
| Moon–Sun distance (m) | 1.87 | 6.37 |
| Principal-axis frame, INPOP21a against DE440 (°) | 3.88e-05 | 4.66e-05 |

### `inpop.ranges`

Largest difference of the Moon–Earth distance.

### `inpop.lunar_orientation`

Angle between the lunar principal-axis frames of the two ephemerides. Each ephemeris defines its own principal axes from its own gravity field, so a constant offset of a fraction of an arc-second is a difference of definition, not an error; the engine works in the mean-Earth frame.

### `closed_form.synodic_month`

Mean time between successive passages of the sub-solar point over the prime meridian, 234 lunations from 2024 to 2043: 29.53025 d against the mean synodic month of 29.530589 d.

### `horizons.sun_direction`

Cached JPL Horizons observer tables (apparent, airless, `coord@301` on the 1737.4 km sphere). Horizons uses DE441 and the same lunar frame, so this checks the implementation, not the ephemeris.

| Target | Lat (°) | Lon (°) | Epochs | Mean (°) | Max (°) |
|---|---|---|---|---|---|
| Sun | -20.00 | 190.0 | 50 | 4.34e-09 | 2.67e-08 |
| Sun | -84.79 | 29.20 | 50 | 4.42e-09 | 2.66e-08 |
| Sun | 40.00 | -20.00 | 50 | 4.61e-09 | 3.30e-08 |
| Sun | 89.50 | 45.00 | 50 | 4.39e-09 | 2.79e-08 |
| Sun | -84.79 | 29.20 | 50 | 4.50e-09 | 3.05e-08 |
| Sun | -90.00 | 0 | 50 | 4.43e-09 | 3.07e-08 |
| Sun | -90.00 | 0 | 50 | 4.40e-09 | 2.67e-08 |
| Sun | 0 | 30.00 | 50 | 4.40e-09 | 2.61e-08 |
| Sun | 40.00 | -20.00 | 50 | 4.38e-09 | 2.78e-08 |
| Sun | -89.45 | 222.7 | 50 | 4.43e-09 | 3.06e-08 |
| Sun | 0 | 30.00 | 50 | 4.57e-09 | 3.23e-08 |
| Sun | 90.00 | 0 | 50 | 4.43e-09 | 2.77e-08 |
| Sun | 90.00 | 0 | 50 | 4.52e-09 | 3.32e-08 |
| Sun | 89.50 | 45.00 | 50 | 4.57e-09 | 3.36e-08 |
| Sun | -20.00 | 190.0 | 50 | 4.46e-09 | 3.09e-08 |
| Sun | -89.45 | 222.7 | 50 | 4.42e-09 | 2.69e-08 |

### `horizons.earth_direction`

Cached JPL Horizons observer tables (apparent, airless, `coord@301` on the 1737.4 km sphere). Horizons uses DE441 and the same lunar frame, so this checks the implementation, not the ephemeris.

| Target | Lat (°) | Lon (°) | Epochs | Mean (°) | Max (°) |
|---|---|---|---|---|---|
| Earth | -84.79 | 29.20 | 50 | 4.32e-07 | 5.74e-07 |
| Earth | 90.00 | 0 | 50 | 3.48e-07 | 4.89e-07 |
| Earth | 0 | 30.00 | 50 | 4.35e-07 | 5.32e-07 |
| Earth | 89.50 | 45.00 | 50 | 4.31e-07 | 5.74e-07 |
| Earth | -20.00 | 190.0 | 50 | 4.32e-07 | 5.15e-07 |
| Earth | -89.45 | 222.7 | 50 | 3.48e-07 | 4.89e-07 |
| Earth | -20.00 | 190.0 | 50 | 3.45e-07 | 4.30e-07 |
| Earth | 40.00 | -20.00 | 50 | 3.48e-07 | 4.54e-07 |
| Earth | 40.00 | -20.00 | 50 | 4.34e-07 | 5.39e-07 |
| Earth | 0 | 30.00 | 50 | 3.49e-07 | 4.41e-07 |
| Earth | 89.50 | 45.00 | 50 | 3.48e-07 | 4.90e-07 |
| Earth | -89.45 | 222.7 | 50 | 4.31e-07 | 5.74e-07 |
| Earth | -84.79 | 29.20 | 50 | 3.48e-07 | 4.89e-07 |
| Earth | 90.00 | 0 | 50 | 4.31e-07 | 5.74e-07 |
| Earth | -90.00 | 0 | 50 | 3.48e-07 | 4.89e-07 |
| Earth | -90.00 | 0 | 50 | 4.31e-07 | 5.73e-07 |

### `spice.direction`

SPICE `spkcpo` with `CN+S` from a body-fixed observer, 200 random epochs 2024–2035 at 8 sites. Shares the kernels with the engine but none of its code.

| Target | Lat (°) | Lon (°) | Mean (°) | Max (°) |
|---|---|---|---|---|
| Sun | -89.45 | 222.7 | 5.92e-09 | 1.38e-08 |
| Earth | -89.45 | 222.7 | 8.80e-08 | 1.97e-07 |
| Sun | -84.79 | 29.20 | 5.92e-09 | 1.38e-08 |
| Earth | -84.79 | 29.20 | 8.79e-08 | 1.97e-07 |
| Sun | 40.00 | -20.00 | 5.91e-09 | 1.37e-08 |
| Earth | 40.00 | -20.00 | 8.88e-08 | 1.71e-07 |
| Sun | 0 | 30.00 | 5.90e-09 | 1.37e-08 |
| Earth | 0 | 30.00 | 9.00e-08 | 1.61e-07 |
| Sun | -20.00 | 190.0 | 5.95e-09 | 1.38e-08 |
| Earth | -20.00 | 190.0 | 9.22e-08 | 1.58e-07 |
| Sun | 89.50 | 45.00 | 5.92e-09 | 1.38e-08 |
| Earth | 89.50 | 45.00 | 8.79e-08 | 1.96e-07 |
| Sun | 90.00 | 0 | 5.92e-09 | 1.38e-08 |
| Earth | 90.00 | 0 | 8.79e-08 | 1.97e-07 |
| Sun | -90.00 | 0 | 5.92e-09 | 1.38e-08 |
| Earth | -90.00 | 0 | 8.79e-08 | 1.97e-07 |

### `llr.grasse`

11457 normal points from Grasse MeO, 2009–2024 (464 below 20° left out). Each is a measured round-trip time of a laser pulse. The engine supplies the outward leg: the distance from the station, at its SLRF2014 position for that year, to the reflector at its DE440 coordinates, at the moment the pulse arrives. The check adds what the engine does not compute: the difference between the return and outward legs (from the kernels directly), the light-time delay in the gravity of the Sun and the Earth, and the delay in air (Marini–Murray, mean 3.26 m). Median residual -0.20 m, root mean square 0.30 m. With the outward leg taken from the kernels directly instead of the engine the 95th percentile is 0.53 m.

| Reflector | Normal points | Median residual (m) | 95th percentile |residual| (m) | Largest (m) |
|---|---|---|---|---|
| Apollo 11 | 1797 | -0.260 | 0.580 | 0.820 |
| Lunokhod 1 | 1753 | 0 | 0.430 | 0.880 |
| Apollo 14 | 1581 | -0.280 | 0.570 | 1.09 |
| Apollo 15 | 4770 | -0.230 | 0.550 | 3.36 |
| Lunokhod 2 | 1556 | -0.040 | 0.430 | 0.600 |
| All | 11457 | -0.200 | 0.530 | 3.36 |

### `llr.matera`

439 normal points from Matera MLRO, 2003–2024 (0 below 20° left out). Each is a measured round-trip time of a laser pulse. The engine supplies the outward leg: the distance from the station, at its SLRF2014 position for that year, to the reflector at its DE440 coordinates, at the moment the pulse arrives. The check adds what the engine does not compute: the difference between the return and outward legs (from the kernels directly), the light-time delay in the gravity of the Sun and the Earth, and the delay in air (Marini–Murray, mean 4.07 m). Median residual -0.26 m, root mean square 0.85 m. With the outward leg taken from the kernels directly instead of the engine the 95th percentile is 0.63 m.

| Reflector | Normal points | Median residual (m) | 95th percentile |residual| (m) | Largest (m) |
|---|---|---|---|---|
| Apollo 11 | 63 | -0.240 | 0.480 | 2.25 |
| Lunokhod 1 | 9 | -0.260 | 0.320 | 0.320 |
| Apollo 14 | 29 | -0.300 | 1.36 | 3.02 |
| Apollo 15 | 316 | -0.270 | 0.830 | 7.16 |
| Lunokhod 2 | 22 | 0.170 | 0.290 | 0.350 |
| All | 439 | -0.260 | 0.690 | 7.16 |

### `blueghost.eclipse_predicted`

Engine `earth_eclipse_fraction` at the site on a 1 s grid, default Danjon shadow. Post of 13 March 2025: "The eclipse will last nearly 5 hours starting at 12 am CST through 4:52 am CST" and "approximately 2 hours and 16 minutes of totality, starting at 1:18 am CST". Daylight time began on 9 March, so the labels are read as CDT (UTC−5); read as CST the eclipse would end after the last penumbral contact.

| Phase | Firefly (UTC) | Engine (UTC) | Engine minus Firefly (s) |
|---|---|---|---|
| partial start | 2025-03-14T05:00:00Z | 2025-03-14T04:59:32Z | -28.00 |
| total start | 2025-03-14T06:18:00Z | 2025-03-14T06:16:02Z | -118.0 |
| total end | 2025-03-14T08:34:00Z | 2025-03-14T08:35:53Z | 113.0 |
| partial end | 2025-03-14T09:52:00Z | 2025-03-14T09:52:27Z | 27.00 |

### `blueghost.eclipse_observed_states`

Engine eclipse fraction 0.361 at 2025-03-14T05:30:00Z (Firefly: eclipse under way) and 1.000 at 2025-03-14T07:30:00Z (Firefly: totality). Posts of 14 March 2025: first look at the eclipse "around 12:30 am CDT"; red-surface image "captured around 2:30 am CDT during the totality"; diamond ring as the Sun emerged "around 3:30 am CDT".

### `blueghost.totality_end_observed`

Engine end of totality at the site 2025-03-14T08:35:53Z against the diamond ring photographed around 2025-03-14T08:30:00Z.

### `blueghost.sunset`

Engine sunset (half of the Sun's flux, default terrain stack, 2 m observer) 2025-03-16T19:07:16Z; on a flat horizon it would be 2025-03-16T20:10:38Z. Firefly's window is 2025-03-16T18:00:00Z to 2025-03-16T18:30:00Z. "more than 14 days of surface operations (346 hours of daylight)" and "just over 5 hours into the lunar night with the final data received around 6:15 pm CDT on March 16". 346 h after landing is 18:34 UTC; five to five and a quarter hours before 23:15 UTC is 18:00 to 18:15 UTC. The window below is the one `docs/validation/scenario.md` §3.1 fixed.

### `slim.sunset_dates`

Engine sunset (half flux, default terrain stack) against the last date of each period of operations. The gap is zero when the engine's sunset falls on that Japan-time date. The page gives each period of surface operations as a range of dates (Japan time), with no time of day. The lander ran on solar power with its panels facing west, so it worked from local afternoon to sunset and each range ends at the lunar sunset.

| Operations (Japan time) | Engine sunset | Hours outside the last date |
|---|---|---|
| 2024-01-28 to 2024-01-31 | 2024-01-31 13:03 JST | 0 |
| 2024-02-25 to 2024-03-01 | 2024-03-01 02:58 JST | 0 |
| 2024-03-27 to 2024-03-30 | 2024-03-30 16:01 JST | 0 |
| 2024-04-23 to 2024-04-29 | 2024-04-29 04:08 JST | 0 |

### `slim.sun_up_in_operations`

The Sun must be above the terrain horizon at the end (23:00 Japan time) of each of the 17 operating dates before the last one of each period.

### `chandrayaan3.local_time`

Engine local solar time (from the sub-solar longitude) at the four labelled instants. The table's sunrise and sunset are local-time labels, not horizon crossings, so they are not compared with engine sunrise or sunset. Source: ChaSTE (Chandra's Surface Thermophysical Experiment) event table, as recorded in docs/validation/scenario.md §3.2.

| Event | UTC | Label | Engine local solar time | Engine minus label (h) |
|---|---|---|---|---|
| sunrise | 2023-08-21T10:26:00Z | 06:14 | 06:14 | 6.00e-03 |
| landing | 2023-08-23T12:34:00Z | 07:56 | 07:56 | 8.00e-03 |
| noon | 2023-08-28T12:30:00Z | 12:00 | 12:00 | 5.00e-03 |
| sunset | 2023-09-04T21:42:00Z | 18:00 | 18:00 | 0 |

### `chandrayaan3.sun_up_before_sleep`

Visible fraction of the Sun's disc above the terrain horizon: 1.00 at landing (2023-08-23T12:34:00Z) and 1.00 when the lander was put to sleep (2023-09-04T02:30:00Z). ISRO statement of 4 September 2023: Vikram lander set into sleep mode around 08:00 IST.

### `landings.sun_up`

Engine Sun elevation above the smooth sphere at the catalogue's touchdown time and position, for the Surveyor, Apollo and solar-powered landers, all of which touched down in daylight. Left out: Luna 13 (1966-12-24T18:01Z, engine -3.5°). The Luna landers ran on batteries and no source opened says they touched down in daylight; Luna 13 sent its panoramas on the two days after landing.

| Lander | Touchdown (UTC) | Engine Sun elevation (°) |
|---|---|---|
| Surveyor 1 | 1966-06-02T06:17:36Z | 28.90 |
| Surveyor 3 | 1967-04-20T00:04:53Z | 10.40 |
| Surveyor 5 | 1967-09-11T00:46:44Z | 16.39 |
| Surveyor 6 | 1967-11-10T01:01:06Z | 3.16 |
| Surveyor 7 | 1968-01-10T01:05:36Z | 12.30 |
| Apollo 11 Eagle LM | 1969-07-20T20:17:40Z | 10.70 |
| Apollo 12 Intrepid LM | 1969-11-19T06:54:35Z | 5.15 |
| Apollo 14 Antares LM | 1971-02-05T09:18:11Z | 10.35 |
| Apollo 15 Falcon LM | 1971-07-30T22:16:29Z | 12.02 |
| Apollo 16 Orion LM | 1972-04-21T02:23:35Z | 14.76 |
| Apollo 17 Challenger LM | 1972-12-11T19:54:57Z | 13.35 |
| Chang'e 3 lander | 2013-12-14T13:11Z | 24.39 |
| Chang'e 4 lander | 2019-01-03T02:26Z | 31.50 |
| Chang'e 5 lander | 2020-12-01T15:11Z | 37.49 |
| Chandrayaan-3 Vikram (Statio Shiv Shakti) | 2023-08-23T12:34Z | 8.61 |
| SLIM | 2024-01-19T15:20Z | 37.21 |
| IM-1 Odysseus | 2024-02-22T23:23:53Z | 10.47 |
| Chang'e 6 lander | 2024-06-01T22:23Z | 36.72 |
| Blue Ghost Mission 1 | 2025-03-02T08:34Z | 3.43 |
| IM-2 Athena | 2025-03-06T17:30Z | 2.47 |

### `avgvisib.sun.85s_060m`

Share of hourly steps over 18.6 years from 2020 with any part of the Sun's disc above the horizon, observer on the surface, at 1000 pixels drawn uniformly from the raster (latitude 85.1° to 89.8°). Engine terrain: `lola_75s_60m` alone, the store on the raster's own grid; 720 azimuths, full range, horizons computed afresh.

| Statistic | Value (points) |
|---|---|
| bias (engine − published) | -0.244 |
| mean \|difference\| | 0.656 |
| median \|difference\| | 0.076 |
| 95th percentile | 2.99 |
| 99th percentile | 6.26 |
| largest | 26.56 |
| Pearson correlation | 0.993 |
| For information, first 200 pixels as gated (ground level): bias | 0.163 |
| For information, same pixels as gated: 95th percentile | 2.79 |
| For information, same pixels, terrain within one pixel of the observer ignored: bias | 0.411 |
| For information, same pixels, terrain within one pixel ignored: 95th percentile | 1.71 |
| For information, same pixels, observer raised 2 m: bias | 1.14 |
| For information, same pixels, observer raised 2 m: 95th percentile | 4.73 |

### `avgvisib.sun.75s_120m`

Share of hourly steps over 18.6 years from 2020 with any part of the Sun's disc above the horizon, observer on the surface, at 1000 pixels drawn uniformly from the raster (latitude 80.1° to 89.8°). Engine terrain: `lola_75s_120m` alone, the store on the raster's own grid; 720 azimuths, full range, horizons computed afresh.

| Statistic | Value (points) |
|---|---|
| bias (engine − published) | -0.864 |
| mean \|difference\| | 0.995 |
| median \|difference\| | 0.264 |
| 95th percentile | 4.10 |
| 99th percentile | 9.16 |
| largest | 27.97 |
| Pearson correlation | 0.991 |
| For information, first 200 pixels as gated (ground level): bias | -0.986 |
| For information, same pixels as gated: 95th percentile | 4.66 |
| For information, same pixels, terrain within one pixel of the observer ignored: bias | -0.109 |
| For information, same pixels, terrain within one pixel ignored: 95th percentile | 2.17 |
| For information, same pixels, observer raised 2 m: bias | 0.512 |
| For information, same pixels, observer raised 2 m: 95th percentile | 2.78 |

### `avgvisib.sun.65s_240m`

Share of hourly steps over 18.6 years from 2020 with any part of the Sun's disc above the horizon, observer on the surface, at 1000 pixels drawn uniformly from the raster (latitude 70.4° to 89.7°). Engine terrain: `lola_60s_240m` alone, the store on the raster's own grid; 720 azimuths, full range, horizons computed afresh.

| Statistic | Value (points) |
|---|---|
| bias (engine − published) | -2.08 |
| mean \|difference\| | 2.16 |
| median \|difference\| | 0.986 |
| 95th percentile | 7.76 |
| 99th percentile | 21.78 |
| largest | 32.94 |
| Pearson correlation | 0.955 |
| For information, first 200 pixels as gated (ground level): bias | -1.63 |
| For information, same pixels as gated: 95th percentile | 7.03 |
| For information, same pixels, terrain within one pixel of the observer ignored: bias | 7.91e-03 |
| For information, same pixels, terrain within one pixel ignored: 95th percentile | 1.75 |
| For information, same pixels, observer raised 2 m: bias | 0.235 |
| For information, same pixels, observer raised 2 m: 95th percentile | 1.48 |

### `avgvisib.sun.65n_240m`

Share of hourly steps over 18.6 years from 2020 with any part of the Sun's disc above the horizon, observer on the surface, at 1000 pixels drawn uniformly from the raster (latitude 70.4° to 89.7°). Engine terrain: `lola_60n_240m` alone, the store on the raster's own grid; 720 azimuths, full range, horizons computed afresh.

| Statistic | Value (points) |
|---|---|
| bias (engine − published) | -2.18 |
| mean \|difference\| | 2.22 |
| median \|difference\| | 1.11 |
| 95th percentile | 8.09 |
| 99th percentile | 16.95 |
| largest | 34.80 |
| Pearson correlation | 0.956 |
| For information, first 200 pixels as gated (ground level): bias | -2.46 |
| For information, same pixels as gated: 95th percentile | 8.70 |
| For information, same pixels, terrain within one pixel of the observer ignored: bias | -0.165 |
| For information, same pixels, terrain within one pixel ignored: 95th percentile | 1.79 |
| For information, same pixels, observer raised 2 m: bias | 0.099 |
| For information, same pixels, observer raised 2 m: 95th percentile | 1.58 |

### `glaeser2014.average_illumination`

Engine at the 20 m post nearest each printed point, terrain `lola_80s_20m` + `lola_60s_240m`, hourly 2015-12-24 to 2034-12-24. Average illumination is the time-mean visible fraction of the Sun's disc.

| Spot | Observer (m) | Paper avg (%) | Engine avg (%) | Difference (points) | Paper longest dark (d) | Engine longest dark (d) | Difference (h) |
|---|---|---|---|---|---|---|---|
| CR1 spot 1 | 2 | 88.12 | 85.23 | -2.89 | 4.58 | 10.71 | 147.1 |
| CR1 spot 2 | 2 | 87.93 | 84.75 | -3.18 | 4.62 | 11.29 | 160.1 |
| CR1 spot 3 | 10 | 92.55 | 92.43 | -0.120 | 3.08 | 3.12 | 1.10 |
| CR1 spot 4 | 10 | 91.94 | 91.54 | -0.400 | 3.17 | 3.21 | 0.900 |

### `glaeser2014.longest_dark_10m`

Longest unbroken darkness at the two 10 m spots; table under `glaeser2014.average_illumination`.

### `glaeser2014.longest_dark_2m`

Longest unbroken darkness at the two 2 m spots; table under `glaeser2014.average_illumination`.

### `glaeser2018.maximum_illumination`

The paper gives the highest average illumination its 20 m DEM reaches at each site. The engine value is the highest over every 20 m post within 300 m of the printed point (a maximum against a maximum), terrain `lola_80s_20m` + `lola_60s_240m`, hourly 2017-01-01 to 2037-01-01.

| Site | Paper maximum (%) | Engine maximum (%) | Difference (points) | Posts searched |
|---|---|---|---|---|
| C1, surface | 76.00 | 77.69 | 1.69 | 702 |
| C2, surface | 75.60 | 75.23 | -0.370 | 706 |
| S, surface | 81.00 | 79.28 | -1.72 | 698 |
| C1, 2 m | 88.00 | 87.78 | -0.220 | 706 |
| C2, 2 m | 78.10 | 78.01 | -0.090 | 706 |
| S (S0), 2 m | 85.50 | 85.39 | -0.110 | 705 |
| S (S1), 2 m | 82.10 | 85.70 | 3.60 | 705 |

### `mazarico2011.connecting_ridge_surface`

Connecting Ridge (CR1), surface: paper 89.01 %, engine 74.96 % at its best post of `lola_60s_240m` within 3000 m of the printed point (491 posts; the paper prints the point to 0.01°). The paper's value is the best pixel of its own 240 m DEM, built from the first months of LOLA data; the engine's store is the later GDR release.

### `mazarico2011.shackleton_rim_surface`

Shackleton rim (S), surface: paper 86.7 %, engine 83.95 % at its best post of `lola_60s_240m` within 3000 m of the printed point (491 posts; the paper prints the point to 0.01°). The paper's value is the best pixel of its own 240 m DEM, built from the first months of LOLA data; the engine's store is the later GDR release.

### `mazarico2011.connecting_ridge_10m`

Connecting Ridge (CR1), 10 m: paper 93.1 %, engine 92.75 % at its best post of `lola_60s_240m` within 300 m of the printed point (4 posts; the paper prints the point to 0.01°). The paper's value is the best pixel of its own 240 m DEM, built from the first months of LOLA data; the engine's store is the later GDR release.

### `avgvisib.crest_pixels`

The 50 brightest pixels of the published 60 m raster (published 76.7 to 88.4 %). Engine minus published: bias -4.01, median |difference| 2.06, largest 75.8 points. At the published maximum (88.44 % at x = -10770 m, y = -11730 m) the engine gives 84.38 %.

### `literature.no_eternal_light`

Highest engine value among the same 50 crest pixels, surface level, 18.6 years. No published study finds a place near the south pole that is lit all the time.

### `psr.lola2016.south`

A pixel is in permanent shadow when no hourly step in 18.6 years has any part of the Sun's disc above the horizon; in the published rasters it is a value of 0. Same pixels as the average-visibility cases. Pooled: 209 pixels in permanent shadow in both, 23 only in the engine, 2 only in the published map, 2766 in neither; precision 0.901, recall 0.991.

| Raster | Both | Engine only | Published only | Neither | Disagree (%) |
|---|---|---|---|---|---|
| 85s_060m | 109 | 5 | 1 | 885 | 0.600 |
| 75s_120m | 67 | 9 | 0 | 924 | 0.900 |
| 65s_240m | 33 | 9 | 1 | 957 | 1.00 |

### `psr.lola2016.north`

Same definition as the south case, on the north raster's sample. Pooled: 19 pixels in permanent shadow in both, 12 only in the engine, 0 only in the published map, 969 in neither; precision 0.613, recall 1.000.

| Raster | Both | Engine only | Published only | Neither | Disagree (%) |
|---|---|---|---|---|---|
| 65n_240m | 19 | 12 | 0 | 969 | 1.20 |

### `psr.barker2023`

600 pixels of the 20 m map drawn uniformly within 300 km of the pole. Engine terrain: `lola_80s_20m`, `lola_75s_120m`, `lola_60s_240m`; surface observer, hourly for 18.6 years from 2020. Pooled: 41 pixels in permanent shadow in both, 7 only in the engine, 0 only in the published map, 552 in neither; precision 0.854, recall 1.000.

| Raster | Both | Engine only | Published only | Neither | Disagree (%) |
|---|---|---|---|---|---|
| LPSR_80S_20MPP_ADJ | 41 | 7 | 0 | 552 | 1.17 |

### `wac.observed_illumination`

Share of 3,807 LROC wide-angle images from 15 February 2010 to 5 February 2011 in which each 100 m pixel was lit, against the engine's share of hourly steps in the same period with any part of the Sun up, at 600 pixels drawn uniformly. The value is the rank correlation. Engine minus observed: bias +1.6, mean |difference| 2.2 points; the observed map counts a pixel lit by its brightness in an image, so it reads lower by construction. The image's brightest pixel is at x = -2850 m, y = -7350 m.

### `nac.simulated.m1188426614`

LROC NAC frame M1188426614 (2015-06-08T18:15:48.050 UTC, Sun about 0.6° up at azimuth 259°), 1000 random 20 m pixels inside the photographed strip, engine on the default stack with the observer on the ground. A pixel is in shadow for the engine when no part of the Sun's disc clears the horizon. Barker's frame is in shadow where its value is exactly zero.

| Quantity | Value |
|---|---|
| Pixels in shadow, Barker's simulated frame (%) | 47.10 |
| Pixels in shadow, engine (%) | 49.30 |
| Pixels within one pixel of Barker's shadow edge (%) | 0.200 |
| Engine differs from Barker's frame, away from the edge (%) | 2.10 |
| Engine differs from Barker's frame, all pixels (%) | 2.20 |
| Engine says shadow, Barker lit (pixels) | 22 |
| Engine says lit, Barker shadow (pixels) | 0 |
| Photo: chance an engine-shadow pixel is darker than an engine-lit one | 0.988 |
| Photo: the same for Barker's frame | 0.999 |
| For information, 400 of the pixels with the engine on 20 m LOLA terrain only: differs from Barker, away from the edge (%) | 1.01 |
| For information, the same pixels on the default stack: differs from Barker, away from the edge (%) | 1.76 |
| For information, 20 m LOLA terrain only: the photo measure | 0.989 |
| For information, the same pixels on the default stack: the photo measure | 0.988 |

### `nac.photo.m1188426614`

LROC NAC frame M1188426614 (2015-06-08T18:15:48.050 UTC, Sun about 0.6° up at azimuth 259°), 1000 random 20 m pixels inside the photographed strip, engine on the default stack with the observer on the ground. A pixel is in shadow for the engine when no part of the Sun's disc clears the horizon. The photo is not thresholded: the measure is the chance that a pixel the model calls shadowed is darker in the photo than one it calls lit. Engine 0.9882, Barker's simulation 0.9991 on the same pixels; the value is Barker's minus the engine's. Table under the matching `nac.simulated` case.

### `nac.simulated.m139729686`

LROC NAC frame M139729686 (2010-09-21T17:33:39.822 UTC, Sun about 2.0° up at azimuth 349°), 1000 random 20 m pixels inside the photographed strip, engine on the default stack with the observer on the ground. A pixel is in shadow for the engine when no part of the Sun's disc clears the horizon. Barker's frame is in shadow where its value is exactly zero.

| Quantity | Value |
|---|---|
| Pixels in shadow, Barker's simulated frame (%) | 38.90 |
| Pixels in shadow, engine (%) | 41.60 |
| Pixels within one pixel of Barker's shadow edge (%) | 5.40 |
| Engine differs from Barker's frame, away from the edge (%) | 2.64 |
| Engine differs from Barker's frame, all pixels (%) | 3.70 |
| Engine says shadow, Barker lit (pixels) | 32 |
| Engine says lit, Barker shadow (pixels) | 5 |
| Photo: chance an engine-shadow pixel is darker than an engine-lit one | 0.964 |
| Photo: the same for Barker's frame | 0.990 |
| For information, 400 of the pixels with the engine on 20 m LOLA terrain only: differs from Barker, away from the edge (%) | 2.87 |
| For information, the same pixels on the default stack: differs from Barker, away from the edge (%) | 2.87 |
| For information, 20 m LOLA terrain only: the photo measure | 0.974 |
| For information, the same pixels on the default stack: the photo measure | 0.967 |

### `nac.photo.m139729686`

LROC NAC frame M139729686 (2010-09-21T17:33:39.822 UTC, Sun about 2.0° up at azimuth 349°), 1000 random 20 m pixels inside the photographed strip, engine on the default stack with the observer on the ground. A pixel is in shadow for the engine when no part of the Sun's disc clears the horizon. The photo is not thresholded: the measure is the chance that a pixel the model calls shadowed is darker in the photo than one it calls lit. Engine 0.9635, Barker's simulation 0.9897 on the same pixels; the value is Barker's minus the engine's. Table under the matching `nac.simulated` case.

### `nac.simulated.m184288222`

LROC NAC frame M184288222 (2012-02-19T10:55:55.532 UTC, Sun about 3.5° up at azimuth 351°), 1000 random 20 m pixels inside the photographed strip, engine on the default stack with the observer on the ground. A pixel is in shadow for the engine when no part of the Sun's disc clears the horizon. Barker's frame is in shadow where its value is exactly zero.

| Quantity | Value |
|---|---|
| Pixels in shadow, Barker's simulated frame (%) | 51.80 |
| Pixels in shadow, engine (%) | 53.30 |
| Pixels within one pixel of Barker's shadow edge (%) | 2.30 |
| Engine differs from Barker's frame, away from the edge (%) | 1.43 |
| Engine differs from Barker's frame, all pixels (%) | 2.10 |
| Engine says shadow, Barker lit (pixels) | 18 |
| Engine says lit, Barker shadow (pixels) | 3 |
| Photo: chance an engine-shadow pixel is darker than an engine-lit one | 0.988 |
| Photo: the same for Barker's frame | 0.988 |
| For information, 400 of the pixels with the engine on 20 m LOLA terrain only: differs from Barker, away from the edge (%) | 0.510 |
| For information, the same pixels on the default stack: differs from Barker, away from the edge (%) | 1.28 |
| For information, 20 m LOLA terrain only: the photo measure | 0.989 |
| For information, the same pixels on the default stack: the photo measure | 0.990 |

### `nac.photo.m184288222`

LROC NAC frame M184288222 (2012-02-19T10:55:55.532 UTC, Sun about 3.5° up at azimuth 351°), 1000 random 20 m pixels inside the photographed strip, engine on the default stack with the observer on the ground. A pixel is in shadow for the engine when no part of the Sun's disc clears the horizon. The photo is not thresholded: the measure is the chance that a pixel the model calls shadowed is darker in the photo than one it calls lit. Engine 0.9883, Barker's simulation 0.9884 on the same pixels; the value is Barker's minus the engine's. Table under the matching `nac.simulated` case.

### `avgvisib.earth.85s_060m`

Share of hourly steps over 18.6 years from 2020 with any part of the Earth's disc above the horizon, observer on the surface, at 1000 pixels drawn uniformly from the raster (latitude 85.1° to 89.8°). Engine terrain: `lola_75s_60m` alone, the store on the raster's own grid; 720 azimuths, full range, horizons computed afresh.

| Statistic | Value (points) |
|---|---|
| bias (engine − published) | -0.524 |
| mean \|difference\| | 0.915 |
| median \|difference\| | 0.053 |
| 95th percentile | 5.14 |
| 99th percentile | 16.81 |
| largest | 48.24 |
| Pearson correlation | 0.988 |
| For information, first 200 pixels as gated (ground level): bias | -0.473 |
| For information, same pixels as gated: 95th percentile | 4.01 |
| For information, same pixels, terrain within one pixel of the observer ignored: bias | -0.228 |
| For information, same pixels, terrain within one pixel ignored: 95th percentile | 2.24 |
| For information, same pixels, observer raised 2 m: bias | 0.729 |
| For information, same pixels, observer raised 2 m: 95th percentile | 4.95 |

### `avgvisib.earth.75s_120m`

Share of hourly steps over 18.6 years from 2020 with any part of the Earth's disc above the horizon, observer on the surface, at 1000 pixels drawn uniformly from the raster (latitude 80.1° to 89.8°). Engine terrain: `lola_75s_120m` alone, the store on the raster's own grid; 720 azimuths, full range, horizons computed afresh.

| Statistic | Value (points) |
|---|---|
| bias (engine − published) | -0.820 |
| mean \|difference\| | 0.955 |
| median \|difference\| | 0.065 |
| 95th percentile | 5.54 |
| 99th percentile | 14.02 |
| largest | 27.45 |
| Pearson correlation | 0.995 |
| For information, first 200 pixels as gated (ground level): bias | -0.639 |
| For information, same pixels as gated: 95th percentile | 4.82 |
| For information, same pixels, terrain within one pixel of the observer ignored: bias | -0.043 |
| For information, same pixels, terrain within one pixel ignored: 95th percentile | 1.33 |
| For information, same pixels, observer raised 2 m: bias | 0.371 |
| For information, same pixels, observer raised 2 m: 95th percentile | 1.47 |

### `avgvisib.earth.65s_240m`

Share of hourly steps over 18.6 years from 2020 with any part of the Earth's disc above the horizon, observer on the surface, at 1000 pixels drawn uniformly from the raster (latitude 70.4° to 89.7°). Engine terrain: `lola_60s_240m` alone, the store on the raster's own grid; 720 azimuths, full range, horizons computed afresh.

| Statistic | Value (points) |
|---|---|
| bias (engine − published) | -1.95 |
| mean \|difference\| | 2.07 |
| median \|difference\| | 0 |
| 95th percentile | 14.96 |
| 99th percentile | 28.17 |
| largest | 45.26 |
| Pearson correlation | 0.989 |
| For information, first 200 pixels as gated (ground level): bias | -1.51 |
| For information, same pixels as gated: 95th percentile | 12.15 |
| For information, same pixels, terrain within one pixel of the observer ignored: bias | -0.049 |
| For information, same pixels, terrain within one pixel ignored: 95th percentile | 1.89 |
| For information, same pixels, observer raised 2 m: bias | 0.162 |
| For information, same pixels, observer raised 2 m: 95th percentile | 1.82 |

### `avgvisib.earth.65n_240m`

Share of hourly steps over 18.6 years from 2020 with any part of the Earth's disc above the horizon, observer on the surface, at 1000 pixels drawn uniformly from the raster (latitude 70.4° to 89.7°). Engine terrain: `lola_60n_240m` alone, the store on the raster's own grid; 720 azimuths, full range, horizons computed afresh.

| Statistic | Value (points) |
|---|---|
| bias (engine − published) | -1.73 |
| mean \|difference\| | 1.83 |
| median \|difference\| | 0 |
| 95th percentile | 12.91 |
| 99th percentile | 26.97 |
| largest | 38.17 |
| Pearson correlation | 0.991 |
| For information, first 200 pixels as gated (ground level): bias | -1.88 |
| For information, same pixels as gated: 95th percentile | 13.89 |
| For information, same pixels, terrain within one pixel of the observer ignored: bias | -0.276 |
| For information, same pixels, terrain within one pixel ignored: 95th percentile | 3.94 |
| For information, same pixels, observer raised 2 m: bias | 0.015 |
| For information, same pixels, observer raised 2 m: 95th percentile | 2.33 |

### `glaeser2014.earth_cycle`

Engine at spot 4 (10 m): the Earth is in view for 15.88 d on average, then out of view for 11.34 d (58.3 % of the time in view), against 14.45 d and 12.8 d. Thesis §7.3, Fig. 72: at spot 4, visibility windows of about 14.45 d followed by about 12.8 d of radio silence (19 years, ten ESA stations).

### `bryant2009.earth_on_massifs`

Bryant: the Earth is always at least partly in view from Malapert α and Leibnitz β. Engine at the highest 20 m post within 300 m of each printed rim point (1 km for the two massifs), 2 m observer, terrain `lola_80s_20m` + `lola_60s_240m`, six-hourly 2009-01-01 to 2028-01-01. Bryant's terrain is Goldstone radar from before LRO, so his coordinates can be off by more than a pixel. At the highest 20 m post within 6 km of each printed massif point instead (rule fixed after the first run, before this number was seen): Malapert α 93.7 % at -85.988°, 2.067°E; Leibnitz β 100.0 % at -84.671°, 39.404°E.

### `bryant2009.earth_on_rim_peaks`

Bryant: from the nine rim and ridge peaks the Earth is at least partly in view 62–71 % of the time. Engine values 0.0–57.0 %. The value is how far the engine's peaks fall outside that range. Engine at the highest 20 m post within 300 m of each printed rim point (1 km for the two massifs), 2 m observer, terrain `lola_80s_20m` + `lola_60s_240m`, six-hourly 2009-01-01 to 2028-01-01. Bryant's terrain is Goldstone radar from before LRO, so his coordinates can be off by more than a pixel.

### `bryant2009.earth_height_insensitive`

Bryant at B1: 63.47 % at 2 m and 63.54 % at 32 m. Engine at the same peak: 6.03 % and 24.82 %.

### `bryant2009.point_values`

Engine at the highest 20 m post within 300 m of each printed rim point (1 km for the two massifs), 2 m observer, terrain `lola_80s_20m` + `lola_60s_240m`, six-hourly 2009-01-01 to 2028-01-01. Bryant's terrain is Goldstone radar from before LRO, so his coordinates can be off by more than a pixel.

| Site | Bryant Sun, any part (%) | Engine Sun (%) | Bryant Earth, any part (%) | Engine Earth (%) |
|---|---|---|---|---|
| A1 | 93.46 | 27.64 | 62.20 | 0 |
| A2 | 92.98 | 32.04 | 63.90 | 38.01 |
| A3 | 85.36 | 56.94 | 63.41 | 56.36 |
| A4 | 87.83 | 24.58 | 63.97 | 0 |
| B1 | 97.01 | 40.90 | 65.16 | 6.03 |
| B3 | 83.84 | 37.85 | 65.60 | 0 |
| H | 77.53 | 70.80 | 62.02 | 56.99 |
| C1 | 90.01 | 43.16 | 70.97 | 0 |
| F | 89.28 | 46.97 | 67.30 | 21.83 |
| Malapert α | 82.08 | 43.64 | 100.0 | 45.18 |
| Leibnitz β | 79.06 | 72.57 | 100.0 | 53.55 |

### `farside.earth_never_visible`

Highest elevation of the Earth's upper limb above the smooth sphere over the days after landing. Chang'e 4 and Chang'e 6 landed on the far side and talked to Earth only through the Queqiao relay satellites, because the Earth is never above their horizon.

| Lander | Landing (UTC) | Days | Highest Earth limb elevation (°) |
|---|---|---|---|
| Chang'e 4 lander | 2019-01-03T02:26Z | 62 | -36.25 |
| Chang'e 6 lander | 2024-06-01T22:23Z | 62 | -37.36 |

### `closed_form.sphere_dip`

Flat synthetic store (600 m pixels), observer 10 m up: the horizon must be −acos(R/(R+h)) = -0.1944° at every azimuth. The value is the larger of the distance from that to the engine's bracket and to its best estimate.

### `closed_form.plateau_edge`

Synthetic plateau 800 m high whose edge is 19.8 km away: along 41 rays the horizon is the elevation of the plateau edge, from the spherical closed form. The value is the largest distance from that to the engine's bracket.

### `closed_form.brute_force_horizon`

Dense sampling along each exact ray of the same terrain surface, with no pyramid and no pruning (`horizon/reference.py`). Every sample is a point of the surface, so it can never be above the engine's upper bracket, and it must reach the lower bracket to within the 0.02° ray tolerance. The value is the largest excess over either; it must not be positive.

| Site | Lat (°) | Lon (°) | Reference − upper bracket, max (°) | Reference − lower bracket, max (°) | |estimate − reference|, max (°) |
|---|---|---|---|---|---|
| Shackleton rim | -89.45 | 222.7 | -3.80e-03 | 0 | 0.089 |
| Connecting ridge | -89.44 | -137.2 | -2.52e-03 | 2.80e-04 | 0.021 |
| Malapert | -85.99 | 2.93 | -1.94e-03 | 1.25e-04 | 6.71e-03 |
| Blue Ghost | 18.56 | 61.81 | -2.89e-03 | 0 | 0.037 |
| SLIM | -13.32 | 25.25 | -3.59e-03 | 6.91e-05 | 3.11e-03 |
| Chandrayaan-3 | -69.37 | 32.32 | -3.70e-03 | 8.67e-05 | 3.55e-03 |
| North pole | 89.60 | 110.0 | -3.28e-03 | 2.36e-04 | 0.044 |
| Far side | -45.46 | 177.6 | -3.20e-03 | 1.09e-06 | 5.81e-03 |

### `closed_form.disc_fraction`

Visible area fraction of a disc of the Sun's size cut by a flat horizon, at 241 heights of the disc centre, against the circular-segment formula.

### `terrain.retroreflector_heights`

Heights are above the 1737.4 km sphere. The laser-ranging radii are good to decimetres; the arrays sit on the ground (Apollo) or about a metre above it (Lunokhod), which is inside every store's stated error.

| Reflector | Lat (°) | Lon (°) | Laser-ranging height (m) | Engine terrain (m) | Difference (m) | Store | Stated 1σ of that store (m) | Difference in stated σ |
|---|---|---|---|---|---|---|---|---|
| Apollo 11 | 0.673 | 23.47 | -1928 | -1925 | 2.10 | lola_global_64ppd | 4.00 | 0.530 |
| Lunokhod 1 | 38.32 | -35.01 | -2472 | -2475 | -3.40 | lola_global_64ppd | 4.00 | 0.840 |
| Apollo 14 | -3.64 | -17.48 | -1064 | -1063 | 1.00 | lola_global_64ppd | 4.00 | 0.260 |
| Apollo 15 | 26.13 | 3.63 | -1923 | -1922 | 0.400 | lola_global_64ppd | 4.00 | 0.110 |
| Lunokhod 2 | 25.83 | 30.92 | -2761 | -2733 | 28.60 | lola_global_64ppd | 4.00 | 7.15 |

## Changed after a first run

Everything that was altered after the engine had been run on a case. Tolerances were never changed.

| Case | What changed | Why |
|---|---|---|
| `apollo.sun_direction` | Two of the 43 table rows are left out by a rule that uses the table alone. | The first run failed at 0.40° on one row. That row's printed azimuth disagrees with the table's own sub-solar point by 0.4° (a misprint). Rows whose printed angles differ from the table's own sub-point by more than 0.03° are now dropped before the engine is consulted. |
| `landings.sun_up` | Luna 9 and Luna 13 are left out; the case covers Surveyor, Apollo and solar-powered landers. | The first run failed on Luna 13 (Sun 3.5° below a flat horizon). The premise that every lander touched down in daylight was mine and does not hold for battery-powered landers. |
| `bryant2009.earth_on_massifs` | Gate (Earth in view at least 95 % of the time) made report-only. | The printed coordinates are on pre-LRO radar terrain. The published LOLA Earth raster reads 6 % at the printed Malapert point, so the paper's 100 % cannot be placed on today's terrain. |
| `bryant2009.earth_on_rim_peaks` | Gate (within 5 points of 62–71 %) made report-only. | Same. His peak B1 is 1.9 km from where the LOLA-based papers put the same crest; the engine was not standing on his peaks. |
| `bryant2009.earth_height_insensitive` | Gate (0.5 points) made report-only. | Same peak B1, same reason. |
| `glaeser2014.earth_cycle` | Gate (1 day) made report-only. | The paper's windows are contact with ten ground stations; the case compared them with the Earth's disc clearing the horizon, which differs by definition. |
| `avgvisib.* and nac.*` | Rows marked "for information" were added (observer raised 2 m, nearest pixel ignored, 20 m terrain only). The gated numbers and limits are unchanged. | To locate the cause of the misses. Moving a gate to one of these settings after seeing that it passes would be tuning. |

## Sources not in the suite

| Source | Quantity | Why it is not built |
|---|---|---|
| Bryant 2009, JPL IPN Progress Report 42-176 | Earth and Sun visibility from named peaks near the south pole | Built, then made report-only. His coordinates are on pre-LRO radar terrain and miss the LOLA peaks by kilometres. A usable case needs each peak found as a terrain feature, with the search rule fixed beforehand. |
| Gläser 2014, Earth contact windows with ten ESA ground stations | length of contact and silence at Connecting Ridge | Built against the Earth's disc, then made report-only. A like-for-like case needs the paper's ten stations and elevation masks run through the engine's station contact path. |
| Bussey et al. 2010, Icarus 208, 558–564 (Kaguya terrain) | most-illuminated points near the south pole | The paper's table was not obtained. Its terrain is the Kaguya altimeter grid, so point values would need the best-post rule used for Gläser 2018. |
| Mazarico et al. 2011, Table 3, read from the paper itself | best-lit points at both poles | The paper could not be opened. The three values in the suite are the ones Gläser quotes; the north-pole rows are missing. |
| Apache Point (APOLLO) laser ranging normal points | station-to-reflector distance at millimetre precision | The station has no entry in the ILRS SLRF2014 coordinate file, and no other coordinates with a stated epoch and velocity were found. The data file is public. |
| McDonald, Haleakala and Wettzell laser ranging normal points | station-to-reflector distance | Not ported. McDonald has several coordinate solutions over its history and needs the right one per period. |
| LOLA illumination rasters for the north pole at 60 m and 120 m | average Sun and Earth visibility | The stack has no north store at 60 m or 120 m, so the engine cannot be run on the same grid. The 240 m north raster is in the suite. |
| LROC NAC photographs at other Sun directions (seven scenes on Arizona State University terrain models) | shadow outlines in real photographs | The earlier comparison in docs/validation/imagery.md used a brightness threshold in small hand-placed windows, which its own text shows is unreliable. Not ported. The three frames in the suite cover three Sun azimuths. |
| ShadowCam images (Korea Pathfinder Lunar Orbiter) | inside of permanently shadowed craters | They show secondary light inside shadow, which the engine does not model. No direct-shadow reference can be drawn from them. |
| Barker et al. 2021 regions of interest (PGDA Site 01 polygons) | illumination percentiles inside published polygons | Compared once in docs/validation/scenario.md §11.6 (14 of 14 on the right side); not ported to the suite. |
| Chandrayaan-3, Chang'e 3 and 4, SLIM wake-up attempts | date of sunrise or sunset at the lander | Sleep and wake dates are operator decisions, so they bound sunrise and sunset from one side only. The suite uses them only that way. |
| Lander power telemetry (battery state of charge, array current) | sunlight on the solar array through a lunar day | No mission publishes it in a usable form. |
| IMCCE Miriade ephemeris service | Sun and Earth direction from a lunar site | It runs on INPOP, which the suite already compares directly from the INPOP21a files. |
| Luna 9 and Luna 13 landings | Sun above the horizon at touchdown | Battery-powered landers did not need sunlight; Luna 13 touched down with the Sun 3.5° below the engine's flat horizon. Left out of the landing case after the first run showed this; said in that case's text. |

