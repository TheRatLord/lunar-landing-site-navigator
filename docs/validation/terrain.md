# Terrain model validation

Scope: `src/lunarnav/terrain/` — LOLA topography ingestion, pyramid stores, `TerrainStack`, projections and
derivatives. The checks ran in 63 s at 4 threads (2026-11-12, Ryzen 7 8845HS, 16 threads, 28 GB, measured alone (every agent job of ours stopped; the user's desktop still ran one browser process of about one core, swap was full)).

**For the planner:** within about 1 km of a point where one terrain product hands over to another (1.5 % of the south-polar area lies within 500 m of
such an edge) the horizon can be wrong by more than its stated bracket, and every such evaluation carries a "near-field seam" warning; isolated
spikes in the 5 m polar product limit a horizon at 8 of 39 960 tested azimuths and change it by at most 0.04° (section 3.10).

**Rerun on the final code** (63 s at 4 threads on 2026-11-12 (Ryzen 7 8845HS, 16 threads, 28 GB, measured alone (every agent job of ours stopped; the user's desktop still ran one browser process of about one core, swap was full); the earlier 131 s was a log figure from a loaded machine), 43 stores = 36 global/polar/PGDA + 7 regional):
The results are now on the current default stack, hash `241d5855d6bea913…` (PGDA 5 m tiles before `lola_875s_5m`, section 3.9). Every number
is identical to 1e-9 to the earlier run (stack `86f1e6146cef…`), which was computed with the old store order. The first rerun on the new order moved 136
numbers, all through two script defects, not through the terrain: (1) the tile-versus-GDR comparison drew its random sample points from one shared random stream
while iterating over the *stack*, so a different store order gave each tile different points (the old order happened to be alphabetical); it now iterates the tiles
sorted by id, so every tile gets the same points whatever the precedence; (2) the Shackleton morphology read heights through the default stack, so the PGDA
`site04` tile now replaced the 5 m GDR in it; it now uses the `lola_875s_5m` store alone (the product the section describes) and also records the default-stack
values (`shackleton_default_stack`: max depth 4 630.47 m, rim diameter 20.75 km, against 4 628.74 m and 20.775 km from the 5 m GDR alone). Sections 3.1–3.5 are unchanged.
The regional-store comparison uses single-store stacks with its own seeded points, so its numbers do not depend on the default order; its recorded
`stack_after_hash` (`86f1e6146cef…`) is the hash of the stack at the time it was run and is kept as a record, not rerun. What moved in the earlier
revision: new stores (1, 3.6), the frame tie (3.7), the file-descriptor design (5) and the on-demand command (6).

## 1. Data actually used

All heights are metres above the 1 737 400 m sphere in the Moon Mean Earth frame.
Downloaded files, sizes and SHA-256 are listed in `data/dem/raw/manifest.json` (written by
`python -m lunarnav.terrain.ingest manifest`).

| dem_id | product | pixel | extent | source |
|---|---|---|---|---|
| `lola_global_64ppd` | LDEM_64 (cylindrical, lon 0–360) | 473.8 m at equator (1/64°) | global | <https://imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG/LDEM_64.IMG> |
| `lola_60s_240m`, `lola_60n_240m` | LDEM_60S/N_240M (polar stereographic) | 240 m | 60°–90° | `.../LOLA_GDR/POLAR/IMG/` |
| `lola_80s_20m`, `lola_80n_20m` | LDEM_80S/N_20M | 20 m | 80°–90° | same |
| `lola_85s_10m`, `lola_85n_10m` | LDEM_85S/N_10M | 10 m | 85°–90° | same |
| `lola_875s_5m` | LDEM_875S_5M | 5 m | 87.5°S–pole | same |
| `pgda78_<tile>_5m` (26 tiles) | PGDA product 78 "LOLA 5 m/pixel DEMs of Artemis candidate sites" (`*_final_adj_5mpp_surf.tif`) | 5 m | 16–30 km square tiles (3200–5960 px) at 26 sites | <https://pgda.gsfc.nasa.gov/products/78>, files under `https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/<Site>/` |
| `lola_75s_60m`, `lola_75s_120m` | LDEM_75S_60M, LDEM_75S_120M (2017 GDR, polar stereographic) | 60 m, 120 m | 75°–90°S | same; added so illumination-map comparisons can use like-for-like resolution |

The 60 m south polar DEM named in the AVGVISIB illumination labels, `LDEM_85S_60M`, is **not** published on the imbrium
POLAR/IMG listing (checked); `LDEM_75S_60M` is the nearest same-resolution product and is a different file. Agreement where they
overlap (83–89.5°S): 60 m − 10 m mean +0.016 m, RMS 1.25 m; 120 m − 60 m mean +0.04 m, RMS 1.64 m. Stores: `lola_75s_60m` 15 248² px
(1.9 GB), `lola_75s_120m` 7 624² px (463 MB); raw 0.58 GB. The 240 m product is `lola_60s_240m`.

The PDS labels of the GDR files state `1737.4 km` reference radius, 16-bit integers with scale 0.5 m, pixel
registration. The PGDA tiles are Barker et al. (2021), Planetary and Space Science 203, 105119
(<https://doi.org/10.1016/j.pss.2020.105119>; cited in the PGDA README). There is no north-polar 5 m tile
product, so the northern cap tops out at 10 m. (`LDEM_128`, 2 GB, was downloaded during discovery and deleted;
it is not used.)

Stated accuracy (from the PGDA product-78 page as read during this work; not independently re-measured here):
median RMS height error about 0.3–0.5 m and RMS slope error about 1.5–2.5° for the 5 m tiles; LOLA track
geolocation about 10–20 cm horizontal and 2–4 cm vertical.

## 2. Store format (`data/dem/store/<dem_id>/`)

Raw rasters are converted once to flat little-endian float32 files that are memory-mapped (`TerrainStore`):
mean pyramid at every 2× level, plus for levels ≥ 1 a **max**, **min** and **coverage** (uint8: 2 = all valid,
0 = none, 1 = partial) array. A level-k max/min cell covers the pixel centres `[2^k i, 2^k (i+1)]` (one extra
pixel on the high side), so it bounds the *bilinear surface* over the cell, not just the pixel values. Level-0
max/min are computed on the fly from the four corners of a cell. `meta.json` records geometry, source URL and SHA-256,
height range and per-array SHA-256; `TerrainStack.stack_hash` hashes all `meta.json` contents and is embedded in
every `HorizonProfile.provenance`. Total, as measured with `du -sb` on this machine: `build --all` makes the 36 stores of the 36 products of `fetch --all` (10 LOLA GDR + 26 PGDA tiles), 49.29 GB (45.9 GiB) including the 1.6 GB PGDA error layers; the 7 regional stores (section 6) add 0.24 GB, so 43 stores and 49.53 GB (46.1 GiB) in all. Raw downloads: 12.3 GB for `fetch --all` (10.57 GB LOLA GDR, about 1.7 GB PGDA heights), plus 1.7 GB of PGDA `*_toterr.tif` from `build-err` and 0.12 GB of regional windows. The first build took about 3.5 minutes (a log figure from build time on a smaller stack and a loaded machine; not re-measured).

Projection: south/north polar stereographic on the sphere, `x = ρ sinλ`, `y = −pole·ρ cosλ`,
`ρ = 2R tan((90° − pole·φ)/2)`; GDR polar rasters are column → +x, row → −y in both hemispheres (determined
empirically, see below because the PDS projection catalogue text is ambiguous for the south).

## 3. Verification

### 3.1 Projection and raster fidelity vs an independent implementation
* For each of the 26 PGDA tiles, 200 random pixel centres were converted to longitude/latitude with our
  `GridGeometry` and with PROJ (through `rasterio.warp.transform` from the GeoTIFF's own CRS): **maximum
  disagreement 1.2×10⁻⁷ m** (26 × 200 points).
* Store level-0 values vs direct reads of the GeoTIFF at the same pixels: **0.0 m maximum difference**
  (bit-identical float32).
* The south projection was also checked against PROJ's `Polar_Stereographic` for
  500 random points (≤ 1 µm), round trips, scale factor and the orientation conventions.

### 3.2 Orientation of the GDR polar rasters (the ambiguous part)
The orientation was fixed by comparing the 240 m south store with the independent global LDEM_64 store over
62°–85°: correlation 0.99998, RMS 12.9 m, mean 0.08 m (north: 0.99987, RMS 17.9 m, mean −0.24 m). Wrong axis
signs give correlations near zero. The PGDA tile Site04 (independent file, own CRS) against the 240 m store
differs by mean +0.25 m, σ 4.2 m (39 693 samples).

### 3.3 Agreement between products where they overlap
Bilinear heights at the same points (40 000 area-uniform random points per row):

| a − b | latitude band | mean (m) | RMS (m) | 5th–95th pct (m) |
|---|---|---|---|---|
| 5 m − 10 m (south) | 88.5–89.9°S | +0.00 | 0.49 | −0.6 … +0.6 |
| 10 m − 20 m (south) | 86–89°S | +0.00 | 0.64 | −0.8 … +0.8 |
| 20 m − 240 m (south) | 62–79°S | −0.21 | 3.61 | −6.0 … +5.4 |
| 240 m − global 64 ppd (south) | 62–80°S | −0.11 | 13.83 | −21.5 … +20.9 |
| 10 m − 20 m (north) | 86–89°N | −0.00 | 0.41 | −0.6 … +0.6 |
| 240 m − global 64 ppd (north) | 62–80°N | −0.15 | 15.87 | −24.3 … +23.8 |

The 14–16 m RMS between the 240 m products and LDEM_64 is a resolution/interpolation difference (a 474 m pixel
interpolated against a 240 m pixel over rough highlands), not a bias (|mean| ≤ 0.15 m). It is the residual to expect
wherever the global product is the only data (non-polar sites).

PGDA 5 m tiles vs the 5 m GDR (the 16 tiles that lie inside 87.5°S; 4 000 random pixels per tile, integer pixel shifts ±2 scanned):

| statistic | value |
|---|---|
| mean difference per tile | −0.30 … +0.25 m |
| RMS difference per tile | 0.87 m (Shoemaker) … 2.17 m (Site04); typical 1.1–1.4 m |
| best registration shift (rows, cols) | (0, 0) pixels for all 16 tiles |

The ~1 m RMS is consistent with two independent griddings of the same LOLA tracks (the PGDA tiles are
re-adjusted tracks, Barker et al. 2021); no registration offset is present.

**These statistics describe the bulk, not the rare pixels.** The committed draw (tiles sorted by id) has maximum differences of a few to 10 m. A second, independent
draw of 4 000 points per tile (the tiles in default-stack precedence order, replaying the random stream of
the committed draw) found **4 points of 57 155 compared with a difference above 25 m**. At each, the 5 m GDR
neighbourhood is far rougher and steeper than that of the PGDA tile (slope = central difference over ±1 px, roughness = standard deviation in a 7 × 7 window):

| tile, point (lat, lon E) | difference PGDA − GDR5 | heights PGDA / GDR 5 m / GDR 10 m (m) | slope PGDA / GDR 5 m | roughness PGDA / GDR 5 m | what it is |
|---|---|---|---|---|---|
| `lm2` (−88.182°, 21.144°) | −36.3 m | −1144.5 / −1108.1 / −1120.0 | 9.7° / 68.7° | 1.7 / 15.3 m | GDR 5 m spike already flagged in 3.10 (the 10 m GDR sits between) |
| `lm6` (−87.679°, 70.960°) | +35.7 m | −532.4 / −568.0 / −569.7 | 3.3° / 44.7° | 0.7 / 8.3 m | both GDRs agree and differ from PGDA; GDR neighbourhood rough, not flagged in 3.10; cause not established |
| `sl3` (−89.125°, 236.392°) | −46.7 m | 221.9 / 268.6 / 275.9 | 17.8° / 54.0° | 3.2 / 11.8 m | as `lm6`; cause not established |
| `lm7` (−87.681°, 94.616°) | +29.0 m | 188.7 / 159.7 / 166.3 | 13.7° / 73.1° | 2.4 / 18.6 m | GDR 5 m spike flagged in 3.10 (the 10 m GDR is 6.6 m above it) |

In all four the GDR 5 m pixel sits in a rough, steep patch (45–73°, 8–19 m roughness) where the PGDA tile is smoother. Two are flagged spikes. In the other two the 10 m GDR
agrees with the 5 m one, so the PGDA tile is the odd product there, and which of the two is right is not established here. None lies within 2 km of a catalogue site or
point of interest (nearest: `poi-glaser-c2` 6.9 km from the `sl3` point, `gaz-faustini` 20.6 and 23.5 km, `gaz-shoemaker` 23.9 km). **For a planner:** the stated per-product height error
describes the bulk of the pixels, not these rare 30–50 m pixels, and the engine's optimistic-to-pessimistic range does not cover them. The report note
`terrain.error_budget_scope` (`report/limits.py`) names interpolated pixels, sub-pixel relief and boulders but does not say that isolated height
outliers of tens of metres occur (4 in 57 155 compared points here; 8.4e-6 of the 5 m store differs from the 10 m store by more than 20 m, section 3.10).

### 3.4 Morphology: Shackleton (published values vs this DEM)
Published figures: Wikipedia, <https://en.wikipedia.org/wiki/Shackleton_(crater)>, read 2026-11-12 (secondary
source; the primary reference there is Zuber et al. 2012, Nature 486, which was not fetched): diameter 21 km,
depth 4.2 km, inner slope about 30° to a 6.6 km diameter floor, "the Moon's south pole passes through
Shackleton's crater rim".

| quantity | this DEM (5 m LDEM_875S) | published |
|---|---|---|
| floor centre (lat, lon) | −89.664°, 123.50° E (10.2 km from the pole) | pole on rim |
| rim-crest diameter (median over azimuth, 2° steps) | 20.8 km (10th–90th pct of radius 9.2–11.4 km) | 21 km |
| depth, rim-median − floor-median | 4.0 km (max crest − floor minimum 4.6 km) | 4.2 km |
| inner wall slope (40–80 % of crest radius) | 30.3° | ~30° |
| floor diameter (profile 15 % of depth above floor) | 8.4 km | 6.6 km (definition differs: slope-break vs 15 % rule) |
| deepest point | −2872.5 m at −89.6246°, 118.6195°E | – |

The orientation, projection and units are therefore consistent with the published crater to a few percent. The
floor-diameter difference is a definition difference and is reported rather than tuned away.
Figure: `docs/validation/img/terrain_shackleton.png`.

### 3.5 Slopes and baseline dependence
`slope_at` (central difference of four great-circle samples; heights converted to the local horizontal plane so
sphere curvature does not contribute) on 300 random points of PGDA Site04, compared with the same calculation on the
coarser GDR stores:

| baseline | median / 95th-pct slope (5 m data) | 10 m GDR − 5 m (RMS, 5–95 %) | 20 m GDR − 5 m (RMS, 5–95 %) |
|---|---|---|---|
| 20 m | 26.4° / 33.6° | 2.91° (−5.5 … +4.4) | 2.66° (−4.9 … +4.7) |
| 100 m | 26.5° / 33.1° | 0.67° (−1.1 … +1.1) | 0.67° (−1.0 … +1.2) |
| 500 m | 25.1° / 32.7° | 0.13° (−0.22 … +0.23) | 0.13° (−0.21 … +0.23) |

Slope is only meaningful at baselines ≳ 2–4 pixels; at 20 m the 5 m, 10 m and 20 m products disagree by about
±3° RMS (comparable to the stated 1.5–2.5° RMS slope error of the 5 m tiles). Use ≥ 100 m baselines for landing
slope statements; the default of `slope_at` is 20 m only to match common lander-footprint conventions and should be
set by the caller.

### 3.6 On-demand regional windows (`lunarnav.terrain.regional`)

`fetch_region(lat, lon, radius_km, product="auto")` downloads only the window around a site, by HTTP range requests
(one per raster row, 8 threads), from the MIT imbrium mirror of the PDS products, and builds an ordinary store
`data/dem/store/<product>_<lat>_<lon>_r<R>km` that `TerrainStack.open()` then picks up with finest-pixel precedence.

| product | tile files | grid | height | where |
|---|---|---|---|---|
| `sldem2015_512` | `https://imbrium.mit.edu/DATA/SLDEM2015/TILES/FLOAT_IMG/SLDEM2015_512_<band>_<lon0>_<lon1>_FLOAT.{IMG,LBL}` (30° x 45°, 1.4 GB each) | 512 ppd (59 m), ±60° | float32 km, `OFFSET` 1737.4 km | LOLA + Kaguya Terrain Camera merge |
| `ldem_512` | `https://imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG/LDEM_512_<band>_<lon0>_<lon1>.{IMG,LBL}` (45° x 90°, 2.1 GB each) | 512 ppd, all latitudes | int16 x 0.5 m, 1737.4 km sphere | LOLA only |

What was verified (from the live PDS3 labels, and enforced in code before anything is built):
the sample type and size (SLDEM2015 `PC_REAL` 32 bit, LDEM_512 16-bit integers), the 1737.4 km reference sphere and
`OFFSET`, 512 pixel/degree map resolution, pixel registration, the file size reported by `HEAD` equal to
lines x samples x bytes, the tile's northern latitude and western longitude, and the coordinate system string
`MEAN EARTH/POLAR AXIS OF DE421`. A mismatch raises (test: a tampered label). Heights therefore need no datum
transformation: both products are radii above the same 1737.4 km sphere as every other store. Pixel `(R, C)` has its
centre at latitude `90 - (R + 0.5)/512` and longitude `(C + 0.5)/512`; the window store is an equirectangular grid
with that lattice (non-periodic; windows crossing 0°/360° are supported).

Integrity: the server publishes no checksum file for these tiles (none found in the directory listings), so the
chain is: label text SHA-256, tile ETag and size, an 8-row repeat fetch over fresh connections that must be
byte-identical (test: a corrupted second read is detected), and a SHA-256 of the assembled window, all recorded in
`data/dem/raw/regional/<id>.json` and copied into the store metadata (hence into every horizon's provenance). This
detects transport corruption and a tile changing between reads; it cannot prove the mirror's tiles equal the PDS
archive's. SLDEM2015 is described in Barker et al. (2016), Icarus 273, 346–355 — recalled, **UNVERIFIED** (the
article was not opened); the datum statements above come from the label itself.

Windows fetched (radius 50 km; seven in all: the five below plus two LDEM_512 windows for the cross-check; 116 MB raw and 25–73 MB per store, about 0.25 GB of stores in total; the 1.4/2.1 GB tiles are never stored):

| site (coordinates) | product | store | heights vs `lola_global_64ppd`, 4000 points within 40 km: mean / RMS / 5–95 % / max abs (m) |
|---|---|---|---|
| Blue Ghost M1 (18.5623, 61.8103) | sldem2015_512 | `sldem2015_512_n18.562_e061.810_r50km` | -0.18 / 6.4 / -8.0 … 7.4 / 100 |
| Chandrayaan-3 (-69.373, 32.319) | ldem_512 | `ldem_512_s69.373_e032.319_r50km` | -0.92 / 11.7 / -20.1 … 17.5 / 81 |
| SLIM (-13.316, 25.251) | sldem2015_512 | `sldem2015_512_s13.316_e025.251_r50km` | +0.19 / 30.1 / -48.6 … 47.5 / 162 |
| Chang'e 4 (-45.4561, 177.5885) | sldem2015_512 | `sldem2015_512_s45.456_e177.589_r50km` | -0.27 / 9.9 / -12.9 … 12.6 / 127 |
| Chang'e 6 (-41.6385, 206.0148) | sldem2015_512 | `sldem2015_512_s41.639_e206.015_r50km` | -0.69 / 12.7 / -17.5 … 15.2 / 176 |

Cross-product agreement in the same window (same 4000 points; SLDEM2015 vs LDEM_512, both fetched here):

| site | SLDEM2015 − LDEM_512 mean / RMS / 5–95 % / max abs (m) | LDEM_512 − LDEM_64 mean / RMS (m) |
|---|---|---|
| Blue Ghost M1 | -0.18 / 5.7 / -6.9 … 6.8 / 98 | -0.01 / 3.3 |
| SLIM | -0.41 / 15.8 / -21.8 … 17.5 / 227 | +0.59 / 25.1 |

The means are 0.0–0.6 m: no datum offset between products. The RMS is terrain-dependent (6 m at Blue Ghost, 16 m at
SLIM's rough slope). Its cause was not isolated: SLDEM2015 merges LOLA with Kaguya Terrain Camera stereo (label), LDEM_512
is LOLA-only, and 59 m pixels cannot hold crater-wall relief, so differences of 100–230 m (`max abs`) occur at single
pixels on steep walls [INFERENCE]. LDEM_512 is LOLA data like `lola_global_64ppd`, so the LDEM_512 − LDEM_64 column is a
resolution test, not an independent one; SLDEM2015 − LDEM_512 is the only comparison with different input data, and
neither is checked against ground truth here.

Horizons before (global stack, 474 m) and after (with the window), 720 azimuths, 2 m mast, full range:

| site | median elevation before → after (°) | max (°) | change: mean / median abs / 95 % abs / max abs (°) | median bracket width (°) |
|---|---|---|---|---|
| Blue Ghost M1 | 0.11 → 0.70 | 1.64 → 2.96 | +0.747 / 0.488 / 2.707 / 3.166 | 0.010 → 0.021 |
| Chandrayaan-3 | 1.27 → 1.28 | 2.46 → 2.48 | +0.031 / 0.008 / 0.198 / 0.286 | 0.019 → 0.018 |
| SLIM | 5.69 → 5.79 | 9.38 → 9.71 | +0.179 / 0.135 / 0.511 / 0.786 | 0.030 → 0.030 |
| Chang'e 4 | 1.10 → 1.38 | 2.97 → 3.00 | +0.192 / 0.025 / 0.956 / 1.277 | 0.021 → 0.020 |
| Chang'e 6 | 0.20 → 0.60 | 3.29 → 3.36 | +0.442 / 0.192 / 1.947 / 2.079 | 0.011 → 0.019 |

Sun azimuth at the sunrise and sunset events, horizon elevation `[lo, hi]` over ±0.2665° (the Sun's mean angular
radius), before → after (`horizon_arrays_at`). Sun azimuth is that of the smooth-sphere event:

| site, event | Sun az (°) | before: elev [lo, hi] | after: elev [lo, hi] |
|---|---|---|---|
| Blue Ghost M1, sunrise | 90.48 | -0.100 [-0.103, -0.089] | 0.279 [0.276, 0.286] |
| Blue Ghost M1, sunset | 269.99 | 0.180 [0.178, 0.187] | 0.496 [0.494, 0.517] |
| Chandrayaan-3, sunrise | 86.14 | 0.842 [0.840, 0.851] | 1.108 [1.106, 1.123] |
| Chandrayaan-3, sunset | 273.02 | 1.828 [1.827, 1.844] | 1.852 [1.850, 1.864] |

Model event times (Sun-centre crossing of the horizon, 2 m mast; the limb column adds the Sun's radius: first/last
light), UTC:

| site, event | smooth sphere | global stack: centre / limb | with window: centre / limb | with window, bracket `hi`…`lo` |
|---|---|---|---|---|
| Blue Ghost M1, sunrise | 03-02 01:27 | 03-02 01:15 / 03-02 00:41 | 03-02 02:02 / 03-02 01:28 | 03-02 02:03 … 03-02 02:02 |
| Blue Ghost M1, sunset | 03-16 20:10 | 03-16 19:48 / 03-16 20:21 | 03-16 19:07 / 03-16 19:41 | 03-16 19:04 … 03-16 19:07 |
| Chandrayaan-3, sunrise | 08-21 10:28 | 08-21 15:00 / 08-21 13:35 | 08-21 16:07 / 08-21 14:46 | 08-21 16:11 … 08-21 16:06 |
| Chandrayaan-3, sunset | 09-04 16:07 | 09-04 06:03 / 09-04 07:26 | 09-04 05:42 / 09-04 07:10 | 09-04 05:38 … 09-04 05:43 |

**Correction (this revision).** The tables above used to show a Blue Ghost and SLIM "with window" column computed on a stack in which the 59 m `ldem_512` window,
not the SLDEM2015 window the text names, supplied the ground (the old stack order put LOLA-only `ldem_512` ahead of `sldem2015_512` at the two sites
that have both windows; the stored `ground_height_m.after` −3 650.488 m is exactly the `ldem_512` height at Blue Ghost). On the current stack (hash `241d5855d6be…`,
`sldem2015_512` first, section 3.9) the SLDEM2015 window does supply it: Blue Ghost's median horizon rises 0.11° → 0.70° (previously shown 0.15°), its maximum change is 3.17° (0.76°),
and SLIM's median elevation 5.69° → 5.79° (5.88°); Chandrayaan-3, Chang'e 4 and Chang'e 6 are unchanged.

Reading: the Blue Ghost window moves the horizon at azimuth 270° (sunset) from 0.18° to 0.50°, and the sunset Sun-centre crossing 41 min earlier (19:48 → 19:07 UTC;
the upper limb 40 min earlier, 20:21 → 19:41);
the published Firefly sunset statement (18:00–18:30 UTC, as quoted in `docs/validation/scenario.md`, not re-checked here)
is still earlier than the model by 0.6 h at the Sun-centre crossing (19:07 UTC; 1.2 h at the upper limb, 19:41) beyond the 18:30 edge. The remainder is **not explained**: candidates are the 59 m pixel
(boulders and sub-pixel relief), the Sun-limb/profile definition behind the statement, and landing-site position error.
At Chandrayaan-3 (69.4°S) the horizon is 1.3° regardless of product and the Sun skims it, so sunrise and sunset move by
5–10 h for 1° of horizon: a published event time there tests the event definition more than the terrain. Chang'e 4 and 6 are
optional extras: the windows exist and change the horizon by up to 1.3° and 2.1° (max) but no event data was compared.
IM-1 (80.13°S, 1.44°E; LROC) lies inside `lola_80s_20m`/`lola_75s_60m`, so no regional window is needed. Chang'e 4/6
coordinates are the NSSDCA/LROC values in the catalog; the Wikipedia/CNSA position of Chang'e 4 differs by about 0.4 km.

### 3.7 Frame tie: DE421 mean-Earth (terrain) versus the engine's `MOON_ME` (DE440)

The terrain products are in the DE421 mean Earth/polar axis frame; the Sun and Earth directions use NAIF's `MOON_ME`
of the DE440 kernels (`moon_de440_250416.tf`), which that kernel defines as an alias of `MOON_ME_DE440_ME421`: the DE440
principal-axes frame rotated by a constant (67.8526″, 78.6944″, 0.2785″) chosen to match DE421's ME. So the two frames
are not identical but are tied by construction; the question is how well. The frame-tie check evaluates
both realisations with SPICE only: `MOON_ME_DE421` from `moon_080317.tf` + `moon_pa_de421_1900-2050.bpc` (fetched
from NAIF `generic_kernels`, SHA-256 pinned) against `MOON_ME` from `moon_pa_de440_200625.bpc` +
`moon_de440_250416.tf` (the engine's pinned kernels), every hour from 2020-01-01 to 2040-01-01 (175 320 epochs):

| quantity | value |
|---|---|
| rotation angle between the two ME frames: max / mean / min | 0.0634″ / 0.0410″ / 0.0097″ (1.76e-5° max) |
| displacement of a surface point (R = 1737.4 km): max / mean / 95 % | **0.534 m** / 0.345 m / 0.473 m |
| NAIF's documented maximum (kernel header, 2000–2040, ~1 M samples) | 3.071e-7 rad = 0.534 m |
| mean rotation vector (x, y, z) | (−0.0156″, −0.0330″, 0.0031″) |

The result reproduces NAIF's documented figure (3.0757e-7 rad here vs 3.0710e-7 documented; the 0.15 % difference is
the sampling and range). **At 5 m it does not matter**: the worst tie error is 0.53 m, one tenth of a 5 m pixel and
a 1.8e-5° tilt of every direction, orders of magnitude below the horizon bracket (0.03–0.05°) and below the terrain
products' own 0.1–0.3 m geolocation. The Sun and Earth directions are in the engine's `MOON_ME`; terrain is placed in
DE421 ME; the 0.5 m is not corrected for and not added to any uncertainty budget. What this does not cover: the
products' absolute registration to DE421 ME (LOLA orbit determination), and that the pre-2020 DE421 pole differs
from DE440 by more (1.0 m over 1900–2050 per the kernel header, not re-run here).

### 3.8 Measured error of the south-polar PDS LDEMs against the PGDA 5 m tiles

No accuracy is published for any PDS `LDEM_*` grid (`docs/research/terrain-error.md` §1), so it is measured where it can be:
every south-polar GDR product is compared with every PGDA tile it overlaps. The GDR bilinear height is sampled at a 100 m grid of each tile's valid pixels; half-widths are
percentiles (68.27 %, 95.45 %) of `|d - median(d)|`, `d = gdr - pgda`; the shift scan moves the GDR sampling position over
±2 pixels in half-pixel steps (east/north) and reports the shift minimising the RMS.

| product | pixel (m) | tiles | samples | mean (m) | RMS (m) | 68 % half-width (m) | 95 % half-width (m) | per-tile 68 % range (m) | shift scan, median / max (m) |
|---|---|---|---|---|---|---|---|---|---|
| `lola_60s_240m` | 240 | 26 | 1,062,904 | +0.04 | 3.71 | 2.86 | 7.33 | 2.26–3.40 | 0.0 / 0.0 |
| `lola_75s_120m` | 120 | 26 | 1,062,904 | +0.02 | 1.95 | 1.54 | 3.91 | 1.11–2.10 | 0.0 / 0.0 |
| `lola_75s_60m` | 60 | 26 | 1,062,904 | +0.00 | 1.38 | 1.07 | 2.77 | 0.73–1.65 | 0.0 / 0.0 |
| `lola_80s_20m` | 20 | 26 | 1,062,904 | -0.01 | 1.36 | 0.95 | 2.73 | 0.57–1.54 | 0.0 / 0.0 |
| `lola_85s_10m` | 10 | 24 | 923,504 | -0.02 | 1.44 | 1.01 | 2.94 | 0.59–1.66 | 0.0 / 0.0 |
| `lola_875s_5m` | 5 | 16 | 514,596 | +0.06 | 1.41 | 1.02 | 2.92 | 0.75–1.72 | 2.5 / 2.5 |

Reading. (1) The pooled 68 % half-width (0.95–1.07 m for the 5–60 m products, 1.54 m at 120 m, 2.86 m at 240 m) is used as
`sigma_z` of that product with basis `measured`; the PGDA tiles' own error (about 0.4 m) is small against it, so this is a
slightly pessimistic estimate. (2) Tiles differ: the per-tile 68 % half-width varies by a factor of 2 to 3 within a product, so
the figure is a footprint average, valid inside the footprint of those tiles (near-pole terrain) and not a bound for rougher
terrain further out, e.g. the 240 m product towards 60°S. (3) **The horizontal offset is not usable.** The scan resolves half a
pixel, finds 0 m for all products except `lola_875s_5m` (2.5 m = one scan step), and a geolocation error common to both
products (same LOLA tracks and orbits) cancels in a difference. `sigma_xy` therefore stays at the assumed global 10 m. (4) The
north products (`lola_85n_10m`, `lola_80n_20m`, `lola_60n_240m`) cannot be checked: the 26 PGDA tiles are all south-polar
(the NP tiles are not at the north pole), so they remain `assumed`. `LDEM_64` and `ldem_512` likewise remain `assumed`; the
3.6 comparison of SLDEM2015 against LDEM_512 (3 to 6 m RMS) is consistent with that.

### 3.9 Stack precedence among equal pixel sizes, and tile seams

`TerrainStack` orders stores by `terrain.stack.precedence_key`: (1) finest pixel size; (2) among equal pixel sizes the better
stated error: basis `published`, then `published-method`, `measured`, `assumed`; (3) smaller `sigma_z` (the per-pixel layer
median where a tile has one); remaining ties keep the input order. The height at a point comes from the first store with
valid data, and `error_at` returns that store's budget. Before this rule, two 5 m stores were ordered by input order, so the
unadjusted PDS `lola_875s_5m` (assumed 4 m / 10 m) won over the track-adjusted PGDA tiles (published 0.37 m) wherever they
overlap; the imagery validation found 3.28 % of cells in shadow at the Shackleton ridge at 1.2° Sun elevation against 0.63 % in
the image, and 0.30 % with the PGDA tiles first. **Consequence:** heights, horizons and every polar result inside the 26 tiles
change relative to earlier runs; `provenance["ground_store"]` of each horizon records which store supplied the observer's
ground and `provenance["store_order"]` the stack order; the horizon cache key contains `stack_hash`, which hashes the store
meta hashes in stack order, so the two stacks never share cache entries.

**Seams.** At a tile edge the height steps by the difference between the tile and the product underneath. Per tile:
the tile sampled 1 pixel inside every edge pixel against the finest
non-PGDA store at that position, `|tile - other|`, with the same statistic over the tile interior (every 20th pixel) for
context. Boundary medians are 0.7 to 2.3 m and 95th percentiles 2.9 to 18 m (steep walls cut by the tile edge); the boundary is
about 2 to 4 times worse than the interior, so a site within a few tens of metres of a tile edge has a near-field artefact of
that size in its horizon. Planners should check `provenance["ground_store"]` and the distance to the tile edge.

**Near-field seam warning (horizon provenance `near_field_seam`).** `horizon.seams.near_field_seam` samples the stack's supplying
store every 5 m on 72 azimuths out to 1 000 m. A *seam* is the nearest sample where another store (with data) supplies the
ground instead of the observer's. The step statistics (median and 95th percentile of `|h_ground_store - h_other_store|`) are
taken over all azimuth crossings, at the last sample before the switch, else at the switch sample (the first with data in both).
Rule: a seam with 95th-percentile step `s` at distance `d` can move the horizon by `shift = atan(s / d)`; **`warning` is True when
`shift` exceeds the profile's own bracket `elev_hi - elev_lo` in any azimuth** (a deliberately cautious test: brackets are
about 0.03 degree, so any seam within a few kilometres at metre-scale steps warns). No seam within 1 000 m gives
`{"present": false, "warning": false}`. Fields: `present`, `warning`, `distance_m`, `ground_store`, `other_store`,
`step_median_m`, `step_p95_m`, `n_crossings`, `horizon_shift_deg`, `near_field_m`. Checked:
a synthetic site 30 m inside a tile edge warns (step 3 m, shift 5 to 8 degree), the same site 30 km from any edge does not, and a
site just outside the tile warns with the roles swapped. Real sites: the Shackleton rim site (`pgda78_site04_5m`) and a random
cap site (`lola_875s_5m`) have no seam within 1 km.
`provenance["ground_error"]` carries the ground store's `sigma_z_m`, `sigma_xy_m`, `basis_z`, `basis_xy`.

| tile | boundary samples | boundary median (m) | boundary p95 (m) | interior median (m) | interior p95 (m) |
|---|---|---|---|---|---|
| `pgda78_site01_5m` | 12,792 | 1.50 | 5.67 | 0.66 | 2.55 |
| `pgda78_site04_5m` | 12,792 | 1.63 | 7.84 | 0.99 | 4.78 |
| `pgda78_site07_5m` | 12,792 | 1.42 | 5.72 | 0.63 | 2.53 |
| `pgda78_site11_5m` | 12,792 | 1.24 | 4.97 | 0.68 | 2.46 |
| `pgda78_site06_5m` | 15,992 | 1.98 | 7.40 | 0.96 | 3.82 |
| `pgda78_site20v2_5m` | 20,792 | 1.42 | 9.14 | 0.74 | 3.04 |
| `pgda78_site23_5m` | 16,792 | 1.79 | 9.16 | 0.82 | 3.16 |
| `pgda78_site42_5m` | 15,992 | 1.78 | 8.13 | 0.85 | 3.28 |
| `pgda78_haworth_5m` | 23,832 | 0.66 | 2.85 | 0.56 | 2.45 |
| `pgda78_shoemaker_5m` | 15,992 | 1.22 | 7.55 | 0.48 | 2.07 |
| `pgda78_dm1_5m` | 15,992 | 2.07 | 13.27 | 0.85 | 3.05 |
| `pgda78_dm2_5m` | 15,992 | 2.25 | 18.34 | 0.71 | 3.10 |
| `pgda78_sl2_5m` | 15,992 | 1.45 | 9.53 | 0.62 | 2.31 |
| `pgda78_sl3_5m` | 15,992 | 1.59 | 7.35 | 0.75 | 2.64 |
| `pgda78_npa_5m` | 15,992 | 0.96 | 5.09 | 0.43 | 1.66 |
| `pgda78_npb_5m` | 15,992 | 2.04 | 12.39 | 0.51 | 2.21 |
| `pgda78_npc_5m` | 15,992 | 1.23 | 6.34 | 0.49 | 1.91 |
| `pgda78_npd_5m` | 15,992 | 1.29 | 8.02 | 0.44 | 1.84 |
| `pgda78_lm1_5m` | 15,992 | 1.25 | 7.60 | 0.57 | 2.83 |
| `pgda78_lm2_5m` | 15,992 | 1.13 | 5.48 | 0.69 | 3.04 |
| `pgda78_lm3_5m` | 15,992 | 1.12 | 6.18 | 0.62 | 2.78 |
| `pgda78_lm4_5m` | 15,992 | 0.81 | 3.65 | 0.52 | 2.22 |
| `pgda78_lm5_5m` | 15,992 | 1.19 | 6.27 | 0.53 | 2.43 |
| `pgda78_lm6_5m` | 15,992 | 1.52 | 8.86 | 0.72 | 3.10 |
| `pgda78_lm7_5m` | 15,992 | 1.27 | 5.58 | 0.59 | 2.57 |
| `pgda78_lm8_5m` | 15,992 | 1.23 | 5.71 | 0.58 | 2.66 |

### 3.10 Spikes in the 5 m store and height steps at store edges

Two questions from the independent review of the regional layer, answered by measurement; neither led to an engine change
(all run at 4 threads; their run times are not claimed).

**Spikes.** All 920 212 224 pixels of `lola_875s_5m` compared with the bilinear `lola_85s_10m` (same projection, located by map coordinates):

| `\|h5 − h10\|` | pixels | fraction of pixels |
|---|---|---|
| > 10 m | 54 384 | 5.9e-5 |
| > 20 m | 7 692 | 8.4e-6 |
| > 50 m | 189 | 2.1e-7 |

Of the 2 861 eight-neighbour groups of > 20 m pixels, 2 469 are isolated (≤ 4 px, 3 900 px), 391 are patches (3 784 px, largest 75 px) and one is a
track. Median size 24.6 m, 99th percentile 58 m, 57 % positive. Only 37 % of the > 20 m pixels (61 % of the > 50 m ones) also differ from their own
four neighbours by more than half the threshold, i.e. look like spikes; the rest are patches or steep walls where 5 m and 10 m sampling legitimately
differ. The median radius is 76 km (75 % beyond 52 km), the outer, sparsely tracked part of the store (map: `img/terrain_spikes.png`); that this
is interpolation is an inference.

Consequence on the default stack, 111 distinct sites (57 horizon-validation sites plus the 54 catalogue sites poleward of 80° that are not also validation sites; `gaz-nobile-crater` and `griffin-1-nobile` are the same point), 360 azimuths, flagged pixels replaced by the 10 m value:
the nominal blocker sits within 1 px of a > 20 m pixel at **8 of 39 960 azimuths at 7 sites**. Largest change of the horizon elevation 0.038°
(`artemis-region-slater-plain`, one azimuth); only that site changes by more than 0.01°. The upper bound never rises by more than 0.005°; its largest drop
is **0.79° at `artemis-region-slater-plain`** (the spike inflated the bound); the lower bound rises by at most 0.039°. So the exact engine can report a
false blocker from a spike, but on this set it is at most 0.04° on 8 azimuths.

**Height steps at store edges.** Area of the south-polar stack (80°S to pole, 290 346 km², 100 m grid) near a store change:

| distance from a store change | share of area |
|---|---|
| within 50 m (half the 100 m figure) | 0.25 % |
| within 100 m | 0.50 % |
| within 500 m | 1.48 % |
| within 1 km | 2.69 % |

Longest edges: `lola_85s_10m | lola_80s_20m` 1 174 km, `lola_875s_5m | lola_85s_10m` 556 km, each PGDA tile about 80 km. The near-field seam warning
fired for **381 of 381** random sites whose true seam distance was ≤ 500 m (34 of 34 within 50 m); median 95th-percentile step 2.3 m within 50 m,
2.9 m within 500 m. It flags any site close to an edge.

Sites within 1 km of a store change (the catalogue and validation sites poleward of 80°S, 96 distinct; all five are warned):

| set | id | distance | stores |
|---|---|---|---|
| catalogue | `poi-glaser-c2` | 35 m | `pgda78_sl3_5m` / `pgda78_site01_5m` |
| catalogue | `poi-derosa-lp2` | 5 m | `pgda78_site06_5m` / `pgda78_site20v2_5m` |
| catalogue | `gaz-shackleton` | 695 m | `lola_875s_5m` / `pgda78_site04_5m` |
| validation | `lm3` | 5 m | `pgda78_lm3_5m` / `pgda78_lm2_5m` (step 0.8 m median, 1.2 m 95th percentile) |
| validation | `shackleton-rim-az180` | 920 m | not printed by the run (step 4.4 m, 95th percentile) |

For the three catalogue sites the evaluation prints (`scenario.evaluate.seam_sentence`), for example for `poi-derosa-lp2`: "The terrain changes source 5 m from the
observer (pgda78_site06_5m under the observer, pgda78_site20v2_5m beyond the seam): the ground steps by 0.4 m at the seam (95th percentile 0.7 m, 36 crossings) and the
horizon can shift by up to 7.48 deg; the near-field horizon (inside 1000 m) is an artefact of the join as much as of the terrain, so treat the illumination and visibility
results near the observer with caution." The `poi-glaser-c2` sentence gives 1.81°, `gaz-shackleton` 0.18° (step 2.2 m at the 95th percentile).

**Not feathered, spikes not replaced (decision).** A blend of the two stores over a width at each edge would cost about 150–250 lines in the lookup and the
max-pyramid bound (the bound stays rigorous by taking the larger of the two stores' bounds in the blend zone), invalidate the horizon cache and move validation
numbers only for sites within the blend width (about 5 of 96 polar sites). It would hide the 1.5–5 m disagreement between the products rather than remove it, producing
a surface that matches neither. The warning is kept as the honest statement.

**Not done:** the published count layer (`LDEC`) was not fetched or compared with the flagged pixels; spikes of 10–20 m were not tested for horizon consequences; sites
outside the 111 tested were not tested; whether the warned sites' horizons are in error was not measured (the warning is a bound, not a residual).

## 4. Deterministic checks
Projection vs PROJ, orientation, round trips, grid registration, periodic wrap; pyramid max/min/mean vs brute force
on synthetic data, NaN-hole coverage codes, reopen/hash stability, composite finest-store selection and footprint
fallback, slope of a known 10° plane and zero slope on a curved zero-height sphere, hillshade; and
memory-map equivalence and descriptor accounting, the DE421-vs-DE440 ME frame tie, the regional fetch against a local
range-capable HTTP server serving synthetic tiles (heights of the built store, the longitude wrap,
a corrupted repeat read, a label mismatch, the latitude limit), and real-data checks (Site04 GeoTIFF fidelity, Shackleton floor/rim, cross-product agreement).

## 5. Known gaps and risks
* **Per-product error budgets (`ProductError`).** `terrain.sources.PRODUCT_ERRORS` / `error_for` record the 1 sigma height and
  horizontal (per axis) error of each product; `TerrainStack.error_at(lat, lon)` returns `(sigma_z_m, sigma_xy_m, store_index)`
  of the store that supplies the height, `error_table()` one row per store, `horizon.blocker_points(profile, stack)` the blocker
  positions to feed it. Each product has a basis for the vertical figure (`basis_z`) and one for the horizontal figure (`basis_xy`), because their support differs; precedence uses `basis_z`. Values: `published` (PGDA Site01/04/07/11: sigma_z 0.37 m, sigma_xy 0.14 m, Barker et al. 2021),
  `published-method` (the other 22 PGDA tiles: same method, per-pixel raster published, no stated scalar; sigma_z = tile median of
  the raster, 0.34 to 0.93 m, computed here; sigma_xy 0.14 m assumed from the documented tile), `measured` (south-polar PDS
  LDEMs, sigma_z only, section 3.8; sigma_xy stays the assumed 10 m), `assumed` (global 4 m / 10 m: all north LDEMs, `LDEM_64`,
  `ldem_512` windows). SLDEM2015: sigma_z 3.5 m (published "typical 3 to 4 m", midpoint is a reading), sigma_xy assumed 10 m;
  its `basis_z` is `published` and its `basis_xy` `assumed`. Figures come from
  `docs/research/terrain-error.md`; the measured ones from section 3.8. PGDA tiles also carry the published per-pixel total
  height uncertainty (`err_toterr.f32` beside the heights, same grid, memory-mapped, outside `meta.json` so no store hash changed):
  `error_at` returns the value of the pixel nearest each point. Download 1.70 GB (`*_toterr.tif`, 26 tiles), layers 1.6 GB.
  The registry is code. This package does not widen `[lo, hi]`; that is the visibility layer's job.
* Outside the 26 PGDA tiles and 87.5°S the default data are 10–20 m (poles) or 474 m (elsewhere). A non-polar site
  gets 59 m (SLDEM2015, within ±60° latitude) or 59 m x 21 m (LOLA LDEM_512 beyond) only after
  `python -m lunarnav.terrain.regional` has fetched its window (section 3.6). There is no 5 m non-polar product.
* The frame tie (3.7) is verified for the NAIF frame definitions only; the products' own geolocation error
  (LOLA orbit and SLDEM2015 Kaguya registration) is not re-measured here.
* No hole filling: NaN pixels stay NaN; coverage codes make bounds conservative, heights there are simply absent.
* The equirectangular kernel skips latitudes above ~86° (the polar stores cover those).
* Opening a store creates private copy-on-write memory maps and keeps no file descriptor (`terrain/mapping.py`:
  `mmap(trackfd=False)` on Python >= 3.13, otherwise libc `mmap`/`munmap` through ctypes). Importing
  `lunarnav.terrain` changes no process limit; opening 60 stores left the
  descriptor count unchanged, and `RLIMIT_NOFILE` is the same before and after an import. The previous
  design raised the hard `RLIMIT_NOFILE` at import; that is removed. Not tested: Windows (the libc path is
  POSIX-only and Python 3.12 on macOS was not run).
* The PGDA numbers in section 1 were read from the product page, not re-derived. The accuracy of the LOLA GDR
  global products is not restated here.

## 6. Terrain data commands
```
.venv/bin/python -m lunarnav.terrain.ingest fetch --all   # download missing raw files (resumable)
.venv/bin/python -m lunarnav.terrain.ingest build --all  # build stores from data/dem/raw
.venv/bin/python -m lunarnav.terrain.ingest manifest     # hash raw files
.venv/bin/python -m lunarnav.terrain.ingest fetch --all && .venv/bin/python -m lunarnav.terrain.ingest build-err --all   # PGDA per-pixel uncertainty layers
# on-demand terrain for any site (picks SLDEM2015 within +-60 deg, else LDEM_512), then it is used automatically:
.venv/bin/python -m lunarnav.terrain.regional --lat 18.5623 --lon 61.8103 --radius-km 50
```
