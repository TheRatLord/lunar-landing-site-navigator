# Terrain-horizon engine validation

Scope: `src/lunarnav/horizon/` — `compute_horizon`, `compute_horizons`, `horizon_arrays`, `horizon_arrays_at`, blocker attribution,
cache, quantiser and the brute-force references. The full validation run took 1 542 s. That is a log figure from a heavily loaded machine and was not re-measured. The terrain data and its own checks are in
`docs/validation/terrain.md`.

## 1. What is computed

The engine returns a terrain horizon with a numerical bracket for each azimuth around a site. The site is given by
planetocentric lat/lon and the observer height (mast height) above the terrain. The azimuths are `az_k = k·360/N`,
clockwise from north, with `N = 720` by default. The Moon is a 1 737.4 km sphere, and heights are added as radii
`R + h`. Elevation is measured from the plane perpendicular to the observer's radial. For each azimuth the engine
returns:

* `elev_lo_deg` — the elevation of the highest terrain **sample found on the exact great-circle ray**. The sample
  is a point of the bilinear DEM (digital elevation model) surface, so `elev_lo_deg` is a true lower bound of the
  ray horizon.
* `elev_hi_deg` — an upper bound of the horizon over the whole azimuth bin `az_k ± 180/N`. It is derived from
  max-pyramids and is rigorous with respect to the bilinear composite surface (see below).
* `elev_deg` — the midpoint of `lo` and the ray's own upper bound. The ray upper bound is within
  `ray_tol_deg = 0.005°` of `lo`, except for sub-pixel leaf nodes.
* `blocker_dist_m` — the distance of the sample that sets `lo`. `blocker_point()` gives its lat/lon/height.

### Algorithm
The engine searches *wedges* `[θ_a, θ_b] × [δ_a, δ_b]` (great-circle distance × azimuth offset) by hierarchical
branch-and-bound. A spherical disc covers each wedge. `terrain._kernels.disc_height` returns the maximum of the
composite pyramid over that disc, plus the bilinear height at the centre. The pyramid uses the finest store with
full coverage of the cell. Where coverage is partial, it uses the union of the stores' maxima, so tile edges and
NaN holes only make the bound looser, never wrong.

The elevation of the highest possible point `r = R + h_max`, at the wedge's clamped tangent angle, bounds every
point in the wedge. This holds because `e(θ, r)` increases with `r` and decreases with `θ` beyond `acos(r/r_o)`.
The engine retires a wedge when that bound is within tolerance of the best sample so far. Otherwise it splits the
wedge along its longer side, down to `1/256` of a pixel. At that size the bound is tight to the DEM's Lipschitz
constant.

Each azimuth gets two passes. The *ray pass* (width 0) gives `lo`, `elev` and `blocker`. The *wedge pass* over
the bin gives `hi`. The search starts 1 m from the observer. It ends at the mutual-visibility range for the
stack's height extremes, about 375–499 km for these sites. `max_range_km` caps it. Numba `prange` runs over
site × azimuth. The stores are memory-mapped, and memory per thread is constant.

*Ray seed* (`n_seed`, default 32): the ray seed prunes far-field wedges against the real horizon from the start,
instead of against the running best. Before the ray pass, `n_seed` log-spaced exact surface samples along the ray
give an initial best lower bound. The seeds are points of the surface, so `lo` stays a true lower bound and `hi`
is untouched. Because pruning differs, `lo`/`elev` can move by at most the ray tolerance (0.005°). The ray result
also seeds the wedge pass.

`horizon_arrays_at(lat, lon, mast, stack,
az_deg (n_sites, k), bin_half_width_deg, ...)` evaluates chosen azimuths for each site with the same kernel and
bounds. Its output is bit-identical to the matching columns of `horizon_arrays`.

The equations are in the `_march.py` module docstring. The brute-force references are in `horizon/reference.py`.

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
All sites are derived from the DEMs, and none come from recalled coordinates. They are:

* the 26 PGDA (NASA Goddard Planetary Geodesy Data Archive) tile centres;
* the Shackleton floor and 8 rim crest points (the highest ground 8–14 km from the floor centre, every 45°);
* the highest and lowest points of the 10 m south and north caps;
* 8 seeded non-polar sites (lat ±75°);
* 5 south-cap and 5 north-cap seeded sites.

Mast 2 m.

**R1 — dense exact-ray reference.** R1 uses no pyramid and no pruning. It steps `max(1.25 m, 2×10⁻⁴·d)` out to
the same range. Every sample is a surface point, so R1 ≤ the true horizon.

| check | result |
|---|---|
| R1 > `elev_hi_deg` (rigorous bound violated) | **0 of 20 520 bins** |
| `elev_lo > elev` or `elev > elev_hi` | 0 |
| R1 − `elev_deg`: mean of per-site means | −0.004° |
| R1 − `elev_deg`: per-site RMS, median / max | 0.0039° / 0.053° (Site04); 46 of 57 sites below 0.01° |
| R1 − `elev_deg`: extreme values | min −0.227° (Site04), max +0.002° |
| R1 − `elev_lo`: max over all sites | +0.0045° (the ray tolerance is 0.005°) |

R1 never exceeds the engine's `lo` by more than the 0.005° ray tolerance. On average R1 is 0.004° below the
engine, because stepping can miss narrow peaks. R1 is the weaker estimator.

**R2 — pixel-centre reference.** R2 takes every native pixel centre of every store within 10 km and bins it by
azimuth ±½ bin. It ran at 12 polar sites. It does not depend on ray tracing or pyramids. Only bins where
`blocker_dist·Δaz ≥ 4 px` are compared, because otherwise pixel centres cannot populate the bin.

| check | result |
|---|---|
| R2 > `elev_hi` (any bin, 12 sites) | **0** |
| compared bins | 1 854 |
| R2 − `elev`: mean / min / max | +0.039° / −0.002° / +0.795° |
| R2 within `[lo − 0.02°, hi]` | 100 % (min over sites 100 %) |

R2 never exceeds `hi`. Its mean is above the ray estimate, because R2 is a supremum over a ±0.25° bin, whereas
`elev` is on the ray. `hi` is the matching bound over the whole bin.

**Bracket width** `elev_hi − elev_lo` is the engine's own statement of its resolution. The median over sites of the
per-site median is 0.042°. The largest per-site median is 0.096°. The median per-site 95th percentile is 0.119°
(max 0.361°). The worst single bin is 1.95°, at site `sl3`, in a bin that contains near-field relief of the order
of the pixel size. No category differs materially. The per-site median widths are: PGDA tiles 0.042°, Shackleton
0.050°, caps 0.033°, non-polar 0.042°, south cap 0.041°, north cap 0.045°.

**Convergence of the pruning tolerance.** The result has converged: `elev_deg` changes by at most 0.003° when the
tolerances are 10× tighter and the leaf size is 16× finer (12 sites). The node count rises ×3.4. The median
bracket width goes from 0.043° to 0.036°. The remainder is real relief inside the ±0.25° bin.

**Two stacks.** The rigorous bound held on both terrain stacks, with 0 violations. The default stack changed its
precedence (terrain.md §3.9): among equal pixel sizes the better stated error wins, so the
PGDA 5 m tiles now come before the PDS `lola_875s_5m`. The whole validation was therefore run on both stacks.
The numbers quoted in §2.2 and §2.4 above are from the *old-order* stack. The table below adds the
**new default stack** (43 stores, same 57 sites, 360 azimuths, same code, 4 threads):

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

27 of 57 sites change their median bracket width by more than 1e-4°. So, as expected, horizons on the PGDA tiles do change with the stack. The wall times recorded in that run were measured under heavy load and are not results. Section 2.4 gives the measured timing.

### 2.3 Sensitivity (all 57 sites; 360 azimuths)
| perturbation | effect on `elev_deg` |
|---|---|
| mast 2 m → 10 m | always lower (plane moves up): median per-site RMS 0.74°, worst azimuth −9.5° (sites with relief within tens of metres) |
| observer moved by **one pixel** (E and N; 5 m for 5 m stores) | per-site RMS: median 0.10° (5 m store: median 0.077°, worst 2.7°); 10 m: 0.091° (worst 0.36°); 20 m: 0.11°; 240 m: 2.2°; 474 m: 0.49° (worst 2.5°) |
| maximum range 10 / 25 / 50 / 100 / 200 km instead of full (375–499 km) | worst azimuth underestimate, per-site median: 4.2° / 2.7° / 0.88° / 0.0008° / 0°; per-site maximum 20.7° / 9.6° / 5.3° / **2.8°** / **0.9°**; sites with an underestimate > 0.1°: 57 / 52 / 40 / 25 / 1 of 57 |

The last row is why the engine does not cap the range at 100 km by default. For 25 of 57 sites, a 100 km cap
loses more than 0.1° in at least one azimuth. The cause is distant high terrain. At the Shackleton rim site the
blocker is up to 170 km away, at azimuth 180°, 2.5° below horizontal. A smaller `max_range_km` is available, but
the accuracy decision is the caller's.

The one-pixel shift row shows that the horizon depends strongly on position near steep relief. Planners should
treat positions closer than about one pixel of the local DEM as indistinguishable. The practical uncertainty is
the bracket and the sensitivity above, not the nominal 0.01° tolerance.

### 2.4 Throughput: node counts (load-independent) and timings
The ray seed cuts the node count per azimuth by 44 % to 54 %. The node count (ray seed + wedge) does not depend on
machine load. The table compares before (`n_seed = 0`, `horizon-bnb/2`) and after (`n_seed = 32` default,
`horizon-bnb/3`), on the same sites with 4 threads:

| set | before | after | change |
|---|---|---|---|
| 57 validation sites, 360 az | 2 516 | 1 405 | −44 % (per-site −21 % to −61 %) |
| random south polar cap (80–89.9°S), 256 sites, 720 az | 2 840 | 1 296 | −54 % |
| random mid-latitude (±60°), 256 sites | 1 514 | 805 | −47 % |
| 500 clustered sites (base `/tmp` run) | 2 357 | 1 129 | −52 % |

The seed does not change accuracy beyond the ray tolerance. On the 500-cluster set, compared with the unseeded
run, the maximum |Δ`elev_deg`| is 0.0018° and the maximum |Δ`lo`| is 0.0030°. The maximum
(`hi`_before − `hi`_after) is 0.0008°. The median bracket width is identical (0.0357°). On the rerun of all
57 sites the bracket-width statistics are identical (median 0.042°, max 1.95°). R1 > `hi` is still 0 of 20 520
bins, and R2 > `hi` is 0 of 1 854. The R1 RMS residuals differ from the first run by ≤ 1.4e-6°.

**Wall times.** These were measured on 2026-11-12 on a Ryzen 7 8845HS (16 threads, 28 GB). The run was alone:
every agent job of ours was stopped. The user's desktop still ran one browser process of about one core, and swap
was full. The run used the default thread count (16 Numba threads), 720 azimuths, mast 2 m and the current
default stack. Each figure is the wall time of one `horizon_arrays` call after a JIT warm-up. The three runs of
each set are listed in order. The first is cold (store pages not yet in the page cache), and the others are warm.
The load average was 4.2 at the start, because the machine was not idle: a browser process and a Python service
of the user's were running. It was 12–18 during the run, mostly from the benchmark's own 16 threads.

| set | old (`n_seed = 0`) | current (`n_seed = 32`) | nodes/az old → current |
|---|---|---|---|
| mid-latitude 256 sites (±60°) | 12.4, 10.3, 10.0 s (median 10.3 s, 24.9 sites/s) | 5.9, 5.8, 5.8 s (median 5.8 s, 44.2 sites/s) | 1 591 → 851 |
| south polar cap 256 sites (80–89.9°S) | not measured | 88.6, 152.4, 261.1 s (3 runs, range 89–261 s; median 152 s) | – → 1 407 |
| 500 clustered sites (300 m about a Shackleton rim point) | not measured | 47.1 (cold), 13.5, 13.7 s (warm median 13.6 s, 36.7 sites/s) | – → 1 535 |
| single site, 720 az | not measured | 1.87 s (cold), 0.02 s, 0.03 s | – → 761 |

The speed-up from seeding is measured only on the mid-latitude set. It is 1.8x at a node reduction of 47 %, which
is consistent with the node counts above.

No polar throughput is claimed. The polar run slowed from run to run (89 → 152 → 261 s) without any change of
input. I did not find the cause. Free RAM was about 0.4 GB and swap was full. 10 GB of the process's resident
memory was file-backed memory-mapped store pages, and `RssAnon` was 0.11 GB. The range is therefore the statement.

The old polar and cluster timings and further repeats were dropped to stay inside the 15-minute budget of the
quiet window. Earlier figures are withdrawn. These were 182 s polar, 14 s mid-latitude and 1.6 s single site,
measured under load, and 61 s / 4.2 sites/s and 17 s for the old code on an earlier quiet machine.

### 2.5 `min_range_m`: excluding the immediate footprint

`horizon_arrays(..., min_range_m=0.0)`, `compute_horizons(..., min_range_m=0.0)` and `compute_horizon(..., min_range_m=...)`
ignore terrain closer than `min_range_m` to the observer.

Since engine `horizon-bnb/5`, the search never starts closer than one pixel of the store that supplies the
observer's ground (`near_field_start_m`, recorded as `provenance["near_field_start_m"]`). A store holds one height
per pixel, so the surface inside the observer's own pixel is interpolation, not data. Before that change the
search started 1 m out, and the interpolated surface of its own cell shadowed a ground-level observer. The oracle
suite measured the effect against the published LOLA (Lunar Orbiter Laser Altimeter) illumination maps
(`docs/validation/oracle.md`, the `avgvisib` cases). The 95th percentile error was 7.8 percentage points at 240 m
before the change and under 2 after it. `min_range_m` is part of the cache key and of
`provenance["min_range_m"]`.

The table below was measured with the 1 m start. On 5 m data its rows for 0 and 5 m are now the same
computation. Use `min_range_m` to ask "what does the horizon look
like if the lander footprint (its own pad, plume-disturbed ground) is ignored". Check:
a 300 m cone 30 m from the observer is a 20°+ horizon at 0 and a
few degrees at 50 m.

The sensitivity was measured at the nine Shackleton sites of section 2.2 (rim, floor), with 360 azimuths and a
2 m mast. The data are the 5 m data of the current default stack: the PGDA `site04` tile where it covers the
sites, and `lola_875s_5m` elsewhere (stack `241d5855d6be…`). Changes are relative to `min_range_m = 0`:

| min_range_m | median change (°) | 95 % abs (°) | max abs (°) | bins changed > 0.05° (%) | median elevation (°) | mean blocker distance (km) |
|---|---|---|---|---|---|---|
| 0 | +0.00000 | 0.0000 | 0.000 | 0.00 | 0.0485 | 30.86 |
| 5 | +0.00002 | 0.0009 | 0.003 | 0.00 | 0.0482 | 30.84 |
| 10 | +0.00002 | 0.0009 | 0.003 | 0.00 | 0.0482 | 30.84 |
| 20 | +0.00002 | 0.0009 | 0.003 | 0.00 | 0.0482 | 30.84 |
| 50 | -0.00000 | 0.0013 | 1.737 | 2.47 | 0.0335 | 30.88 |

Excluding up to 20 m changes the horizon by at most 0.003° at every site. That is the ray tolerance, and the
5–20 m rows are identical to within it. At 5 m resolution the terrain within 20 m of the observer does not set
these horizons. At 50 m, 2.5 % of the bins change, by up to 1.7° at two sites. The per-site maxima in the JSON are
0.62° and 1.74°, and the other seven sites are ≤ 0.07°. The default therefore matters only where a pad-scale
feature is within about 50 m. A caller that wants a footprint exclusion should choose it from the lander size,
not from this table.

## 3. Real horizon example
The example site is on the Shackleton rim, at the highest ground 8–14 km from the floor centre along azimuth 135°
(−89.6840°, 196.4877°E; ground 1 723.8 m; mast 2 m). There, `elev_deg` ranges −3.33° … +4.57°, and the median
bracket width is 0.030°. Terrain 169.8 km away sets the horizon at azimuth 180° (−84.716°, 16.488°E, 2 723 m).
Terrain 54.1 km away sets it at azimuth 0° (1 003 m). Figures: `docs/validation/img/horizon_panoramas.png`
(crater floor, rim and cap-maximum sites) and
`horizon_bracket_and_residuals.png` (width and R1 residual histograms).

## 4. Defects found and fixed during validation
* **Near-field start (found by the first 57-site run).** The search originally began 0.25 pixel from the
  observer. At a non-polar site (global-3), in a 474 m pixel with a ~5° local slope, the highest terrain was 58 m
  away. That is 118 m inside the range that was not searched. R1 exceeded `elev_hi` in 21 azimuths by up to 1.4°.
  The search now starts 1 m from the observer. After the fix, R1 > `hi` in 0 of 20 520 bins.
* Per-node reference counting of Numba typed lists serialised the 16 threads, which made them 4–7× slower. Arrays
  are now rebuilt from raw addresses (`numba.carray`).

## 5. Known gaps and residual risks
* **DEM error is not included in the bracket.** `[lo, hi]` is the numerical resolution of the *model*. Per the
  PGDA accuracy statement (terrain.md §1), the 5 m tiles carry ~0.3–0.5 m RMS height error. The polar 10–20 m
  products, and especially the 474 m global product, are less accurate and coarser. Slope noise of 1.5–2.5°
  applies to the 5 m tiles. The visibility layer must widen the brackets accordingly.
* `elev_deg` is the midpoint of `[lo, ray upper bound]`. The ray upper bound is within 0.005° of `lo`, except at
  leaf nodes (1/256 pixel) next to steep, pixel-scale relief. There the slack can reach degrees. A single-pixel
  spike 30 m away gives `elev` 1.1° above the true 23.2° peak, inside the bracket. The worst real bin is 1.95°.
  Use `lo`/`hi`, not `elev`, for conservative statements.
* Terrain within a few metres of the observer on a slope is the ground the lander stands on. It sets the horizon
  at many azimuths for rim sites, with blocker distances of tens of metres. On request, `min_range_m` (2.5)
  excludes the immediate footprint beyond the observer's own pixel.
* Non-polar sites rely on LDEM_64 (474 m). There, the near-field horizon is smooth at pixel scale. A one-pixel
  shift gives 0.49° RMS, up to 2.5°.
* Throughput: a whole-region precompute at 5–10 m spacing is slow (see 2.4). The engine is designed for the
  batch path (`horizon_arrays`), but no regional product has been generated. The ray seed (`n_seed`) is done. The
  remaining node cost is at range ≤ 2 km at 5 m store resolution, so further gains need near-field work
  (vectorised leaf evaluation).
* The terrain model is the bilinear composite. The rigour of `hi` is relative to that model and to the Lipschitz
  tightening at leaf nodes (a gradient bound from the four cell corners). 20 520 bins (R1) and 1 854 bins (R2)
  found no violation. That is evidence, not proof.
* Cache keys include the engine version string. `horizon-bnb/5`: the search starts one pixel of the ground store out (see 2.5). `/4`: provenance gained `ground_store`, `ground_error`, `near_field_seam`, `store_order`, and the numerics are those of `/3`. Change the version string whenever kernel behaviour changes.
