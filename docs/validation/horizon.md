# Terrain-horizon engine validation

Scope: `src/lunarnav/horizon/` — `compute_horizon`, `compute_horizons`, `horizon_arrays`, `horizon_arrays_at`, blocker attribution,
cache, quantiser, brute-force references. The full validation run took 1 542 s (a log figure from a heavily loaded machine; not re-measured). Terrain data and its own checks:
`docs/validation/terrain.md`.

## 1. What is computed

For a site (planetocentric lat/lon, mast height above the terrain) and each azimuth `az_k = k·360/N`
(clockwise from north, `N = 720` by default) the engine returns, on the 1 737.4 km sphere with heights as radii
`R + h` and elevation measured from the plane perpendicular to the observer's radial:

* `elev_lo_deg` — elevation of the highest terrain **sample found on the exact great-circle ray** (a point of
  the bilinear DEM surface), hence a true lower bound of the ray horizon;
* `elev_hi_deg` — an upper bound of the horizon over the whole azimuth bin `az_k ± 180/N`, derived from max-pyramids
  (rigorous with respect to the bilinear composite surface; see below);
* `elev_deg` — the midpoint of `lo` and the ray's own upper bound (within `ray_tol_deg = 0.005°` of `lo` except
  for sub-pixel leaf nodes);
* `blocker_dist_m` — distance of the sample that sets `lo`; `blocker_point()` gives its lat/lon/height.

### Algorithm
Hierarchical branch-and-bound over *wedges* `[θ_a, θ_b] × [δ_a, δ_b]` (great-circle distance × azimuth offset).
A wedge is covered by a spherical disc; `terrain._kernels.disc_height` returns the maximum of the composite
pyramid over that disc (finest store with full coverage of the cell; the union of stores' maxima while coverage is
partial, so tile edges and NaN holes only make the bound looser, never wrong) plus the bilinear height at the centre.
The elevation of the best case `r = R + h_max` at the wedge's clamped tangent angle bounds every point in it
(`e(θ, r)` is increasing in `r` and decreasing in `θ` beyond `acos(r/r_o)`). A wedge is retired when that bound is
within tolerance of the best sample so far, otherwise split along its longer side until it is `1/256` of a pixel
(then the bound is tight to the DEM's Lipschitz constant). Per azimuth: one *ray pass* (width 0; gives `lo`,
`elev`, `blocker`), one *wedge pass* over the bin (gives `hi`). Search starts 1 m from the observer and ends
at the mutual-visibility range for the stack's height extremes (about 375–499 km for these sites;
`max_range_km` caps it). Numba `prange` over site × azimuth; memory-mapped stores, constant memory per thread.

*Ray seed* (`n_seed`, default 32): before the ray pass, `n_seed` log-spaced exact surface samples along the ray give an initial
best lower bound, so far-field wedges are pruned against the real horizon from the start instead of the running best. Seeds are
points of the surface, so `lo` stays a true lower bound and `hi` is untouched; `lo`/`elev` can move by at most the ray
tolerance (0.005°) because pruning differs. The ray result also seeds the wedge pass. `horizon_arrays_at(lat, lon, mast, stack,
az_deg (n_sites, k), bin_half_width_deg, ...)` evaluates chosen per-site azimuths with the same kernel and bounds (output
bit-identical to the matching columns of `horizon_arrays`).

Equations are in the `_march.py` module docstring; the brute-force references are in `horizon/reference.py`.

## 2. Verification

### 2.1 Closed-form cases
| case | expectation | result |
|---|---|---|
| smooth sphere, 10 m mast | horizon dip `−acos(R/(R+h))` | bracket contains it; `elev` within 0.01° |
| flat-top plateau 20 km away (800 m high) | elevation of its near edge from the closed formula | `lo ≥` formula at edge +1.5 px, `hi ≤` formula at edge +0.01°, blocker within 2.5 px of the edge |
| same plateau at **150 km** (9 km high) | idem (beyond 100 km) | same |
| observer inside a parabolic bowl | horizon = max over the rim profile | within 0.2° (150 m pixels), azimuth spread < 0.2° |
| 6° ramp, observer 30 m from the centre of a 600 m pixel | 6° eastwards; matches dense rays | < 0.05° |
| single-pixel 300 m spike 30 m from the observer (600 m pixels) | the spike top at ≈23.2° (closed form) | `lo` within 0.5°, `hi` ≥ it; fails if the search starts at 150 m (this test reproduces the bug in §4) |
| random smooth terrain, 3 sites × 72 azimuths | dense-ray reference ≤ `hi`, ≤ `lo + 0.02°`, `|elev − R1| < 0.1°` | pass |
| batch = single, mast, cache hit/miss/corrupt/terrain-change, quantiser keeps bracket, uncovered site raises | | pass |

### 2.2 Real terrain: 57 sites, 360 azimuths, full range
Sites (all derived from the DEMs, none from recalled coordinates): the 26 PGDA tile
centres, Shackleton floor + 8 rim crest points (highest ground 8–14 km from the floor centre every 45°), the highest and
lowest points of the 10 m south and north caps, 8 seeded non-polar sites (lat ±75°), 5 south-cap and 5 north-cap seeded sites.
Mast 2 m.

**R1 — dense exact-ray reference** (no pyramid, no pruning: step `max(1.25 m, 2×10⁻⁴·d)` out to the same range; every
sample is a surface point, so R1 ≤ true horizon):

| check | result |
|---|---|
| R1 > `elev_hi_deg` (rigorous bound violated) | **0 of 20 520 bins** |
| `elev_lo > elev` or `elev > elev_hi` | 0 |
| R1 − `elev_deg`: mean of per-site means | −0.004° |
| R1 − `elev_deg`: per-site RMS, median / max | 0.0039° / 0.053° (Site04); 46 of 57 sites below 0.01° |
| R1 − `elev_deg`: extreme values | min −0.227° (Site04), max +0.002° |
| R1 − `elev_lo`: max over all sites | +0.0045° (the ray tolerance is 0.005°) |

R1 is below the engine by 0.004° on average because stepping can miss narrow peaks (R1 is the weaker estimator); the
engine's `lo` is never exceeded by more than the 0.005° ray tolerance.

**R2 — pixel-centre reference** (every native pixel centre of every store within 10 km, binned by azimuth ±½ bin;
12 polar sites; independent of ray tracing and pyramids; only bins where `blocker_dist·Δaz ≥ 4 px` are compared
because otherwise pixel centres cannot populate the bin):

| check | result |
|---|---|
| R2 > `elev_hi` (any bin, 12 sites) | **0** |
| compared bins | 1 854 |
| R2 − `elev`: mean / min / max | +0.039° / −0.002° / +0.795° |
| R2 within `[lo − 0.02°, hi]` | 100 % (min over sites 100 %) |

R2 exceeds the ray estimate (positive mean) because it is a supremum over a ±0.25° bin, whereas `elev` is on the ray;
`hi` is the matching bin-wide bound, and R2 never exceeds it.

**Bracket width** `elev_hi − elev_lo` (this is the engine's own resolution statement): median over sites of the
per-site median 0.042° (largest per-site median 0.096°), median per-site 95th percentile 0.119° (max 0.361°), worst
single bin 1.95° (site `sl3`, a bin containing near-field relief of the order of the pixel size). No category
differs materially (per-site median widths: PGDA tiles 0.042°, Shackleton 0.050°, caps 0.033°, non-polar 0.042°,
south cap 0.041°, north cap 0.045°).

**Convergence of the pruning tolerance** (12 sites; tolerances 10× tighter, leaf size 16× finer): `elev_deg` changes by at
most 0.003°, node count ×3.4, median bracket width 0.043° → 0.036° (the remainder is real relief inside the ±0.25° bin).

**Two stacks.** The default stack changed its precedence (terrain.md §3.9: among equal pixel sizes the better stated error wins, so the
PGDA 5 m tiles come before the PDS `lola_875s_5m`). The whole validation was therefore run on both; numbers quoted in §2.2 and
§2.4 above are from the *old-order* stack, the table below is the **new default stack**
(43 stores, same 57 sites, 360 azimuths, same code, 4 threads):

| quantity | old-order stack | new default stack |
|---|---|---|
| R1 > `hi` (of 20 520 bins) | 0 | 0 |
| R2 > `hi` (bins compared) | 0 of 1 854 | 0 of 1 674 |
| `lo` > `elev`, `elev` > `hi` | 0, 0 | 0, 0 |
| nodes without data | 0 | 0 |
| bracket width, median of per-site medians | 0.0423° | 0.0406° |
| bracket width, largest per-site 95th percentile / worst bin | 0.361° / 1.95° (`sl3`) | 0.243° / 1.27° (`south-cap-1`) |
| R1 − `elev` RMS, per-site range | 0.0021–0.053° | 0.0021–0.021° |
| range cap 100 km: sites with underestimate > 0.1° (max) | 25 (2.78°) | 24 (2.78°) |
| one-pixel observer shift, median per-site RMS | 0.103° | 0.069° |
| ground height change at 10 sites (> 0.3 m) | – | `site07` +1.5 m, `lm1` −0.91 m, `lm7` +0.84 m, `lm3` −0.75 m, `site04` +0.68 m, others ≤ 0.5 m |
| south-cap random 256 sites: nodes per azimuth | 1 296 | 1 329 |

The rigorous bound held on both stacks (0 violations); 27 of 57 sites change their median bracket width by more than 1e-4°, so horizons on
the PGDA tiles do change with the stack, as expected. The wall times recorded in that run were measured under heavy load and are not results; see the measured timing in section 2.4.

### 2.3 Sensitivity (all 57 sites; 360 azimuths)
| perturbation | effect on `elev_deg` |
|---|---|
| mast 2 m → 10 m | always lower (plane moves up): median per-site RMS 0.74°, worst azimuth −9.5° (sites with relief within tens of metres) |
| observer moved by **one pixel** (E and N; 5 m for 5 m stores) | per-site RMS: median 0.10° (5 m store: median 0.077°, worst 2.7°); 10 m: 0.091° (worst 0.36°); 20 m: 0.11°; 240 m: 2.2°; 474 m: 0.49° (worst 2.5°) |
| maximum range 10 / 25 / 50 / 100 / 200 km instead of full (375–499 km) | worst azimuth underestimate, per-site median: 4.2° / 2.7° / 0.88° / 0.0008° / 0°; per-site maximum 20.7° / 9.6° / 5.3° / **2.8°** / **0.9°**; sites with an underestimate > 0.1°: 57 / 52 / 40 / 25 / 1 of 57 |

The last row is the reason the engine does not cap the range at 100 km by default: for 25 of 57 sites a 100 km cap
loses more than 0.1° in at least one azimuth (distant high terrain, up to 170 km blocker distance at the Shackleton rim
site, 2.5° below horizontal at azimuth 180°). A smaller `max_range_km` is available but is the caller's accuracy decision.
The one-pixel shift row shows that the horizon is strongly position-dependent near steep relief: planners should treat
positions closer than about one pixel of the local DEM as indistinguishable and use the bracket and the sensitivity above,
not the nominal 0.01° tolerance, as the practical uncertainty.

### 2.4 Throughput: node counts (load-independent) and timings
Node count per azimuth (ray seed + wedge) is independent of machine load. Before (`n_seed = 0`, `horizon-bnb/2`) and after
(`n_seed = 32` default, `horizon-bnb/3`), same sites, 4 threads:

| set | before | after | change |
|---|---|---|---|
| 57 validation sites, 360 az | 2 516 | 1 405 | −44 % (per-site −21 % to −61 %) |
| random south polar cap (80–89.9°S), 256 sites, 720 az | 2 840 | 1 296 | −54 % |
| random mid-latitude (±60°), 256 sites | 1 514 | 805 | −47 % |
| 500 clustered sites (base `/tmp` run) | 2 357 | 1 129 | −52 % |

Accuracy of the seeded result against the unseeded run on the 500-cluster set: max |Δ`elev_deg`| 0.0018°, max |Δ`lo`| 0.0030°,
max (`hi`_before − `hi`_after) 0.0008°, median bracket width identical (0.0357°). On the rerun of all 57 sites the
bracket-width statistics are identical (median 0.042°, max 1.95°), R1 > `hi` is still 0 of 20 520 bins, R2 > `hi` 0 of
1 854, and R1 RMS residuals differ from the first run by ≤ 1.4e-6°.

**Wall times** (2026-11-12; Ryzen 7 8845HS, 16 threads, 28 GB, measured alone (every agent job of ours stopped; the user's desktop still ran one browser process of about one core, swap was full).
Default thread count (16 Numba threads), 720 azimuths, mast 2 m, current default stack, wall time of one `horizon_arrays` call after a JIT
warm-up; the three runs of each set are listed in order, the first is cold (store pages not yet in the page cache), the others warm;
load average at start 4.2 (the machine was not idle: a browser process and a Python service of the user's), 12–18 during the run, which is
mostly the benchmark's own 16 threads):

| set | old (`n_seed = 0`) | current (`n_seed = 32`) | nodes/az old → current |
|---|---|---|---|
| mid-latitude 256 sites (±60°) | 12.4, 10.3, 10.0 s (median 10.3 s, 24.9 sites/s) | 5.9, 5.8, 5.8 s (median 5.8 s, 44.2 sites/s) | 1 591 → 851 |
| south polar cap 256 sites (80–89.9°S) | not measured | 88.6, 152.4, 261.1 s (3 runs, range 89–261 s; median 152 s) | – → 1 407 |
| 500 clustered sites (300 m about a Shackleton rim point) | not measured | 47.1 (cold), 13.5, 13.7 s (warm median 13.6 s, 36.7 sites/s) | – → 1 535 |
| single site, 720 az | not measured | 1.87 s (cold), 0.02 s, 0.03 s | – → 761 |

The speed-up of the seeding is therefore measured only on the mid-latitude set (1.8x at a node reduction of 47 %, consistent with the node counts above).
The polar run slowed from run to run (89 → 152 → 261 s) without any change of input; I did not find the cause (free RAM was about 0.4 GB, swap full, 10 GB of
the process's resident memory is file-backed memory-mapped store pages, `RssAnon` 0.11 GB), so no polar throughput is claimed and the range is the
statement. The old polar and cluster timings and further repeats were dropped to stay inside the 15-minute budget of the quiet window.
Earlier figures (182 s polar, 14 s mid-latitude, 1.6 s single site under load; 61 s / 4.2 sites/s and 17 s for the old code on an earlier quiet machine) are withdrawn.

### 2.5 `min_range_m`: excluding the immediate footprint

`horizon_arrays(..., min_range_m=0.0)`, `compute_horizons(..., min_range_m=0.0)` and `compute_horizon(..., min_range_m=...)`
ignore terrain closer than `min_range_m` to the observer (the search starts at `max(min_range_m, 1 m)`); the default 0 leaves
results unchanged. It is part of the cache key and of `provenance["min_range_m"]`. Use it to ask "what does the horizon look
like if the lander footprint (its own pad, plume-disturbed ground) is ignored". Check:
a 300 m cone 30 m from the observer is a 20°+ horizon at 0 and a
few degrees at 50 m. Sensitivity at the nine Shackleton sites of section 2.2 (rim, floor; 360 azimuths, 2 m mast,
5 m data of the current default stack (the PGDA `site04` tile where it covers the sites, `lola_875s_5m` elsewhere; stack `241d5855d6be…`)), change relative to `min_range_m = 0`:

| min_range_m | median change (°) | 95 % abs (°) | max abs (°) | bins changed > 0.05° (%) | median elevation (°) | mean blocker distance (km) |
|---|---|---|---|---|---|---|
| 0 | +0.00000 | 0.0000 | 0.000 | 0.00 | 0.0485 | 30.86 |
| 5 | +0.00002 | 0.0009 | 0.003 | 0.00 | 0.0482 | 30.84 |
| 10 | +0.00002 | 0.0009 | 0.003 | 0.00 | 0.0482 | 30.84 |
| 20 | +0.00002 | 0.0009 | 0.003 | 0.00 | 0.0482 | 30.84 |
| 50 | -0.00000 | 0.0013 | 1.737 | 2.47 | 0.0335 | 30.88 |

Excluding up to 20 m changes the horizon by at most 0.003° (the ray tolerance; 5–20 m rows are identical to within it) at
every site: at 5 m resolution the terrain within 20 m of the observer is not what sets these horizons. At 50 m, 2.5 % of the bins
change, by up to 1.7° at two sites (per-site maxima in the JSON: 0.62° and 1.74°; the other seven sites ≤ 0.07°). The
default therefore only matters where a pad-scale feature is within about 50 m; a caller that wants a footprint exclusion
should choose it from the lander size, not from this table.

## 3. Real horizon example
Shackleton rim, highest ground 8–14 km from the floor centre along azimuth 135° (−89.6840°, 196.4877°E; ground
1 723.8 m; mast 2 m): `elev_deg` ranges −3.33° … +4.57°, median bracket width 0.030°; the horizon at azimuth 180°
is set by terrain 169.8 km away (−84.716°, 16.488°E, 2 723 m); at azimuth 0° by terrain 54.1 km away
(1 003 m). Figure: `docs/validation/img/horizon_panoramas.png` (crater floor, rim and cap-maximum sites);
`horizon_bracket_and_residuals.png` (width and R1 residual histograms).

## 4. Defects found and fixed during validation
* **Near-field start (found by the first 57-site run).** The search originally began at 0.25 pixel from the observer.
  At a non-polar site (global-3) in a 474 m pixel with a ~5° local slope the highest terrain was 58 m away, 118 m
  inside the unsearched range: R1 exceeded `elev_hi` in 21 azimuths by up to 1.4°. The search now starts 1 m from the
  observer; after the fix R1 > `hi` in 0 of 20 520 bins.
* Per-node reference counting of Numba typed lists serialised the 16 threads (4–7× slower); arrays are now rebuilt
  from raw addresses (`numba.carray`).

## 5. Known gaps and residual risks
* **DEM error is not included in the bracket** — `[lo, hi]` is the numerical resolution of the *model*. Per the PGDA
  accuracy statement (terrain.md §1) the 5 m tiles carry ~0.3–0.5 m RMS height error; polar 10–20 m and especially the
  474 m global product are less accurate and coarser, and slope noise of 1.5–2.5° applies to the 5 m tiles. The visibility
  layer must widen brackets accordingly.
* `elev_deg` is the midpoint of `[lo, ray upper bound]`; the ray upper bound is within 0.005° of `lo` except at leaf
  nodes (1/256 pixel) next to steep, pixel-scale relief, where the slack can reach degrees (a single-pixel spike 30 m
  away gives `elev` 1.1° above the true 23.2° peak, inside the bracket; worst real bin: 1.95°). Use `lo`/`hi`, not
  `elev`, for conservative statements.
* Terrain within a few metres of the observer on a slope is the ground the lander stands on; it sets the horizon at
  many azimuths for rim sites (blocker distance of tens of metres). `min_range_m` (2.5) excludes the immediate footprint
  on request; it is off by default.
* Non-polar sites rely on LDEM_64 (474 m): near-field horizon there is pixel-scale smooth (one-pixel shift gives
  0.49° RMS, up to 2.5°).
* Throughput: whole-region precompute at 5–10 m spacing is slow (see 2.4); the engine is designed for the
  batch path (`horizon_arrays`) but a regional product has not been generated. The ray seed (`n_seed`) is done; the remaining
  node cost is at range ≤ 2 km at 5 m store resolution, so further gains need near-field work (vectorised leaf evaluation).
* The terrain model is the bilinear composite; rigour of `hi` is relative to that model and to the Lipschitz tightening
  at leaf nodes (gradient bound from the four cell corners). 20 520 bins (R1) and 1 854 bins (R2) found no violation, which is
  evidence, not proof.
* Cache keys include the engine version string (`horizon-bnb/4`: provenance gained `ground_store`, `ground_error`, `near_field_seam`, `store_order`; the numerics are those of `/3`); change it whenever kernel behaviour changes.
