# Validation report: `lunarnav.visibility`

Pure-maths layer (no SPICE, no terrain access).

Figures: `docs/validation/img/visibility_*.png`. All checks used fixed seeds. Quadrature references are
deterministic midpoint rules (no sampling noise); the "Monte Carlo" in the task statement is replaced by
dense quadrature on the same disc, which has a known, much smaller error.

What is checked here is the **mathematics given its inputs**. Accuracy of the inputs (DEM, ephemeris, lander
parameters) is not assessed in this report. Every constant specific to this layer (limb-darkening exponents,
solar radius, DSN station gains and noise, the link-budget example) is tied to a source that was opened, named
where it is used; approximations that are not simply sourced (the single limb-darkening exponent, the tangent
plane) are quantified. Constants owned by `lunarnav.constants` (for example the solar constant) are used as
given. Remaining gaps are listed in section 6.

## 1. Disc visibility (`disc.py`, `limb_darkening.py`)

### 1.1 Method

The solar disc of angular radius r centred at (az0, el0) is treated in the tangent plane at its centre,
x = (az - az0) cos(el0), y = el - el0. The horizon (periodic, piecewise linear in azimuth on a uniform grid,
wrap at 360 deg) is piecewise linear in x. For each linear piece y_h = p + q x the visible area is

    A = integral [ c(x) - clamp(y_h(x), -c(x), c(x)) ] dx,   c(x) = sqrt(r^2 - x^2)

The piece is split at the line-circle intersections (the roots of (1+q^2) x^2 + 2pq x + p^2 - r^2 = 0), and
each sub-interval integrates in closed form (antiderivative of c is (x c + r^2 asin(x/r))/2). The area is
therefore exact for the piecewise-linear horizon; there is no sampling of the disc. Fast paths return 1 or 0
when the whole disc is above the horizon maximum or below its minimum.

**Limb darkening.** Law I(mu)/I(1) = mu^alpha, mu = sqrt(1 - rho^2), rho = d/R (Hestroffer & Magnan 1998 "HM98",
A&A 333, 338-342, Eq. 1 with u = 1; opened at `https://www.physics.hmc.edu/faculty/esin/a101/limbdarkening.pdf`).
HM98 fit alpha at each wavelength to the Pierce & Slaughter (1977, PS), Pierce, Slaughter & Weinberger (1977, PSW)
and Neckel & Labs (1994, NL) polynomial coefficients; their **Table 2** lists alpha(lambda) (PS/PSW 303-2402 nm,
111 values; NL 303-1099 nm, 30 values; transcribed into `limb_spectrum.py` and spot-checked). The
original NL paper (Sol. Phys. 153, 91) was opened only as far as its abstract (paywalled); PS and PSW were not
opened. We therefore rely on HM98's published exponents, not on the polynomial coefficients.

Sunlight is a spectrum-weighted sum of such profiles, which is not itself a power law. The default is the single
exponent whose flat-horizon flux-fraction curve is closest (minimax) to the weighted sum, with weights from the
**ASTM G173-03 extraterrestrial spectrum** (`ASTMG173.csv`, 280-4000 nm, integral 1347.9 W/m2; opened as the copy
in the pvlib repository, `https://raw.githubusercontent.com/pvlib/pvlib-python/main/pvlib/data/ASTMG173.csv`,
sha256 91964ac2...ee7859; I did not open the NREL original, whose host was unreachable from this machine).
Over 303-2402 nm, which holds 96.4 % of the extraterrestrial irradiance, the effective exponent is
**0.3946** (irradiance-weighted mean of alpha(lambda) 0.402), worst misfit of the flux-fraction curve 1.2e-4.
`DEFAULT_ALPHA = 0.39`. This is a bolometric choice. The earlier default 0.56 was the 500 nm value and is
replaced: it overstated limb darkening for the total solar flux (a sunrise-sweep difference of 0.0070 in flux
fraction, section 1.4). No measured solar-cell spectral response was opened, so a silicon or triple-junction
weighting is not applied; its band is bracketed by the 400-1100 nm result below.

**Flux.** With S(rho) the exact visible area of the concentric disc of radius rho r, integration by parts and
t = mu^alpha turn the weighted integral into a smooth one,

    F_vis = integral_0^1 S(rho(t)) dt,   rho(t) = sqrt(1 - t^(2/alpha))

evaluated by 24-node Gauss-Legendre quadrature (default) of the exact S. The normalisation is the full-disc
flux pi r^2 * 2 / (alpha + 2). (Checks: uniform alpha = 0 reduces to area; a fully visible disc gives exactly 1.)

**Bounds.** `disc_visibility` evaluates the nominal, optimistic (`elev_lo_deg`) and pessimistic
(`elev_hi_deg`) horizons. `point_clearance` returns the smooth elevation clearance
`el - h(az) - margin` in degrees for antennas, evaluated the same way (`point_clearance_bounds`).

### 1.2 Measured errors

| Check | Reference | Result |
|---|---|---|
| Flat horizon, 2001 offsets from -r to +r | exact circular segment | max error 9.0e-15 |
| Step (1.5 deg, az 40-60), spike, V notch, seam step at az 359-359.5 (13 disc positions, default alpha) | polar midpoint quadrature, 2000 x 4000 | area <= 2.6e-6, flux <= 1.2e-5 (target 1e-3) |
| 20 random rough horizons (+-1.5 deg) | same quadrature | area <= 1.5e-5, flux <= 1.8e-5 |
| Flux, flat horizon, alpha = 0.3..1.0, 11 offsets each | 2-D numerical integral of the law, 3000 x 3000 | max error 2.2e-5 |
| Wrap-around | horizon rotated by 180 deg (identical result to 1e-12) and quadrature across the seam | pass (tests) |
| Flux quadrature convergence (400 rough-horizon epochs) | n = 400 nodes | n = 8: 5.0e-4; 12: 1.8e-4; 16: 1.1e-4; 24: 2.7e-5; 32: 1.6e-5; 48: 4.4e-6 |

(Figure `visibility_disc_nodes.png`.) The quadrature error is highest when horizon vertices cross the disc
edge, which makes S piecewise smooth only; it is still below 1e-4 at the default 24 nodes.

### 1.3 Tangent-plane approximation (the one real approximation)

The kernel uses cos(el0) as the azimuth scale for the whole disc. The error is compared with an **exact
spherical-cap quadrature** (points laid out uniformly in solid angle over the cap, azimuth/elevation computed
exactly, 1500 x 3000), r = 0.26645 deg (derived, see 1.6), random rough horizons whose mean elevation is as
listed (two 0 deg cases were run, disc centre 0 and 0.15 deg above the horizon: 1.6e-5 / 1.8e-5 and
8.5e-6 / 1.8e-5; the table shows the larger):

| Horizon elevation near the Sun | max abs area error | max abs flux error |
|---|---|---|
| 0 deg | 1.6e-5 | 1.8e-5 |
| 10 deg | 1.0e-4 | 9.9e-5 |
| 20 deg | 1.7e-4 | 1.5e-4 |
| 40 deg | 3.7e-4 | 3.4e-4 |
| 60 deg | 9.2e-4 | 8.7e-4 |

The error grows with elevation (it scales with r tan(el0)), but stays under 1e-3 up to 60 deg. Lunar horizons
relevant to landing sites are mostly below 20 deg, where it is below 2e-4. An unfavourable but honest
caveat: the quadrature references themselves may carry errors of order 1e-4 at these grid sizes for the
spherical cases (discontinuity of the visibility indicator), so the smallest numbers above are partly
reference noise.

### 1.4 Sensitivity to the limb-darkening law

Flux fraction against area fraction on a flat horizon (default alpha 0.39): the largest difference is **0.0169**
(flux exceeds area while the dim rim is hidden). Effect of the exponent choice on the flux fraction during a
partial-disc phase (flat horizon sweeping across the disc, 401 offsets, production `disc_fraction`; reference =
default; figure `visibility_limb_choice.png`):

| Choice | alpha | max abs change in flux fraction |
|---|---|---|
| uniform disc (area fraction) | 0 | 0.0169 |
| 500 nm, PS+PSW | 0.567 | 0.0070 |
| 550 nm, PS+PSW (Barker et al. 2021 used 550 nm; that paper was not opened here) | 0.505 | 0.0046 |
| 400-1100 nm band effective (silicon-like window, no response curve; 67 % of the ETR) | 0.432 | 0.0017 |
| 700 nm, red edge of the visible band | 0.383 | 0.0003 |
| 400 nm, blue edge of the visible band | 0.743 | 0.0136 |
| 303 nm, UV end of the data | 0.967 | 0.0214 |
| 2402 nm, IR end of the data | 0.123 | 0.0113 |

Other effective exponents (same method): NL data 303-1099 nm 0.470 (74 % of the ETR); 400-1100 nm NL 0.440;
400-700 nm PS+PSW 0.523. The NL and PS/PSW exponents agree to within 0.015 at the wavelengths compared
(400 to 1000 nm). So the whole plausible range of the exponent (visible band edges and
bolometric) moves the flux fraction by at most about 0.014 (0.021 if the UV end of the data were taken), and
by 0.0017 to 0.0046 between the default and a silicon-band or 550 nm choice. A window edge defined by a flux
fraction moves by that fraction of the disc-crossing time: for the Sun moving 360 deg per synodic month (29.53
d, about 0.51 deg/h) the 0.533 deg disc takes about 63 min to cross, so 0.014 is roughly one minute
(`visibility_disc_sunrise.png`; slower at polar sites, where the Sun grazes the horizon).

### 1.5 Speed

100 000 epochs against a 720-azimuth horizon, with **every** epoch within +-1 deg of the horizon (the slow
case). Measured 2026-11-13 on a Ryzen 7 8845HS (16 threads, 28 GB) with the user's desktop and service
processes running (load average about 2 to 3, swap full, about 12 GB available; no other project jobs).
25 timed calls per process after a warm-up call (JIT is cached on disk and
excluded), three processes per configuration; median of the three medians, with the range of all calls:

| Case | threads | median of 3 runs | range over all calls |
|---|---|---|---|
| area plus flux | 16 (Numba default) | 31.6 ms | 26.8 to 40.4 ms |
| area plus flux | 1 (`NUMBA_NUM_THREADS=1`) | 127.8 ms | 126.9 to 135.8 ms |
| area only | 16 | 12.0 ms | 4.8 to 17.4 ms |
| area only | 1 | 11.2 ms | 11.1 to 11.7 ms |

The flux path scales with threads (4.0x on 16); the area-only path does not (one thread is as fast; the
threading overhead is comparable to the work, and 16-thread calls vary from 4.8 to 17.4 ms). A
best-of-5 timing (three runs) gave 29.3, 28.9, 28.4 ms for area
plus flux and 10.0, 11.0, 1.6 ms for area only; the 1.6 ms is the same fast tail of the 16-thread area-only
distribution and is not a representative figure. The earlier claim of 33 to 38 ms / 7 to 11 ms was measured
under load and is superseded.

### 1.6 Solar angular radius

The engine takes the Sun's angular radius from `TargetTrack.ang_radius_deg`, computed by `lunarnav.ephem` from
`R_SUN_KM = 695,700 km` and the actual range. `data/kernels/pck00011.tpc` carries `BODY10_RADII = (695700 695700
695700)` km (the file's "Old values" note shows the superseded 696,000 km of the 2009 IAU report; the active
value is the IAU 2015 Resolution B3 nominal solar radius). That assignment was read and
checked to equal `R_SUN_KM`. The checks in this report do not use a recalled constant: they derive
r = asin(R_SUN_KM / AU_KM), AU_KM = 149,597,870.7 km (`lunarnav.constants`), giving **0.26645 deg = 959.23
arcsec** at 1 au, 0.27098 deg at 0.9833 au and 0.26208 deg at 1.0167 au (the perihelion/aphelion distances
0.9833 and 1.0167 au are round values used only to show the range; they are not taken from a source).

## 2. Intervals and events (`intervals.py`)

Edges are threshold crossings between samples (`signal > threshold` is visible) refined by (a) linear
interpolation, (b) cubic Hermite with central-difference slopes and a bisection root, or (c) a user callback
solved with Brent's method. Windows touching the ends of the data are flagged `*_censored` and are never
reported as rise or set events (`time_to_next_transition` returns NaN if no real event follows).

Test signal s(t) = sin(2 pi t / 100 s) + 0.3, six cycles; worst edge-time error over all sampling phases:

| dt (s) | linear | hermite | callback | nearest sample (no refinement) |
|---|---|---|---|---|
| 16 | 0.836 | 0.446 | 3.4e-9 | 15.85 |
| 4 | 0.0405 | 0.0220 | 7.7e-10 | 3.97 |
| 1 | 2.47e-3 | 6.4e-5 | 1.3e-11 | 0.994 |
| 0.5 | 6.2e-4 | 7.9e-6 | 1.9e-10 | 0.494 |

Fitted error order between dt = 16 s and 1 s: 2.09 (linear), 3.30 (Hermite: central-difference slopes are
O(dt^2), giving O(dt^3)). The Hermite error at 16 s (a sixth of the period) is large because it is outside
the asymptotic range; the linear method is the safe default for geometry sampled finely enough
(minutes). A callback that recomputes geometry reaches the solver tolerance.

Statistics (dt = 1 s, 1000 s span): longest dark span 40.3014 s vs analytic 40.3013 s; longest interior
visible window 59.6986 s vs 59.6987 s; visible fraction 0.59658 vs 0.59699 analytic (the finite span cuts
whole cycles, so a 0.07 percent difference is expected); time to next transition from t = 10, 70, 95 s:
44.8493, 25.1507, 0.1507 s, identical to the analytic values at four decimals.

Edge-time ranges from the optimistic/pessimistic signals (`bounded_windows`, bias 0.4 / 0.3 / 0.2 around
the nominal): max error against analytic crossings 6.4e-5 s over 12 edges. Windows whose pessimistic signal
never rises are returned with `certain = False`. Windows of the three signals are matched **by overlap**
(an earlier containment match dropped real nominal windows with `method="hermite"`, where the three
interpolants need not be ordered between samples: review repro `nom=[-1,-1,-.5,.5,1,1,1,1]`, `opt[4]=6`
now returns the nominal window from 2.5, `certain=True`); ranges are clamped so that
`start_range[0] <= nominal.start <= start_range[1]` and `end_range[0] <= nominal.end <= end_range[1]` always
hold (20 random Hermite cases tested). `UncertainWindow.start_range_censored` / `end_range_censored` (new
fields, default False) mark a range bound that is a first/last data sample of an optimistic or pessimistic
window, i.e. only a one-sided estimate. `window_stats` and `dark_windows` raise if a window lies outside
`[t0, t1]`, and a dark span that abuts a censored window edge is itself censored (also for a span wider than
the data).

## 3. Terrain-error widening (`uncertainty.py`)

Model, per azimuth, for the blocker at ground distance d (`blocker_dist_m`), horizon elevation h, height
difference dz = d tan h (all quantities per sigma):

    sigma_h^2 = (sigma_z cos^2 h / d)^2 + (g sigma_xy / d)^2 + (sigma_xy sin h cos h / d)^2

with g = d(elev)/d(az) the local horizon gradient (deg per deg, centred difference on the azimuth grid). The
three terms are vertical error, across-line-of-sight horizontal error (the blocker slides along the horizon),
and along-line-of-sight horizontal error. The vertical term follows from h = atan(dz / d):
dh/ddz = cos^2 h / d (an earlier version used cos h / d, which treats d as the slant range; it was
conservative by 1/cos h, 6 % at 20 deg, 0.8 % at 7 deg; corrected after review and checked against a finite
difference of atan). The along-line term is unchanged (dh/dd = -sin h cos h / d).
`widen_horizon` brackets the horizon by `lo - k sigma_h`,
`hi + k sigma_h`. A window edge's time uncertainty is `sigma_h / |d clearance / dt|`
(`edge_time_uncertainty`, `disc_window_edge_ranges`).

**Per-azimuth budgets.** `TerrainErrorModel.sigma_z_m` and `sigma_xy_m` are each a float (every azimuth) or a
1-D array with one value per azimuth of the horizon being widened (a terrain product's own published error for
the azimuths it supplies). Both are validated at construction (finite, non-negative, at most 1-D; arrays are
copied and made read-only) and the length is checked against the horizon in `horizon_sigma_deg` /
`widen_horizon` with an error naming the term and both lengths. The formula is applied element-wise, so each
azimuth sees exactly the scalar result for its own pair of values (tests: an array of equal entries is
bit-identical to the scalar; a two-valued array equals the scalar model of each value on its half). The
budget at an azimuth is the one given for that azimuth; the model does not look up which product supplied the
blocker, and the observer's own ground-height error (common to all azimuths) is not modelled separately.
Provenance `terrain_error_widening` always holds `sigma_z_m_min/max`, `sigma_xy_m_min/max`, `per_azimuth` and
`k_sigma` (JSON-safe); scalar models additionally keep the former `sigma_z_m` and `sigma_xy_m` keys, which are
omitted for per-azimuth models.

**Approximation and what it ignores.** First order, marginal per azimuth. It does not model the chance
that a different blocker takes over where two features have similar elevation, nor spatial correlation of DEM
errors (a common tilt moves all edges together; the brackets are then conservative for one edge but not for
the joint behaviour of many), nor the d/2R curvature derivative. The distance is the nominal blocker
distance, so shoulders of a feature whose blocker changes with azimuth are approximated by the local value.

**Check**: a brute-force perturbation of a synthetic Gaussian mountain
(height 1500 m, width 2500 m, 12 km away; horizon computed by ray marching; 400 perturbed DEMs per
case, centre shifted by sigma_xy per axis and height changed by sigma_z). Model sigma / brute-force sigma:

| Case | at the peak azimuth | within +-12 deg of the peak (median, range) |
|---|---|---|
| sigma_z = 30 m only | 1.015 | 1.151 (1.015 to 1.672) |
| sigma_xy = 60 m only | 0.999 | 0.999 (0.979 to 1.023) |
| both | 1.026 | 1.134 (1.024 to 1.381) |

The model agrees to 3 percent at the peak and is conservative (over-estimates) on the mountain flanks, by up
to 67 percent for pure vertical error, because a single blocker distance is used where the flank horizon is
set by shifting points on the mountain. It never under-estimated in this test. Edge times: in a separate check,
a linear clearance with a known rate gives sigma_t = sigma_h / rate exactly, and the widened-horizon window
edges (k = 2) reproduce nominal edge +- 2 sigma_t to within 1 s.

## 4. Power (`power.py`, `battery.py`)

### 4.1 Geometry

Frames: local ENU; body x forward, y left, z up (level). `Attitude(yaw, tilt, tilt_az)`: yaw is the heading
of body x (clockwise from north); tilt leans body z toward `tilt_az` by the shortest rotation about the
horizontal axis; R = R_tilt R_yaw (tests check that z maps to the lean direction, orthonormality,
heading 0 -> forward is north, left is west). Panel power = A eta S cos(theta) f (1 - e), with S = 1361 W/m^2
(1/r_au)^2, f the limb-darkened visible flux fraction, e the optional Earth-eclipse fraction (treated as an
independent factor; this is only approximate if both occultations are partial and overlap). A tracking panel
rotates about the body z axis, so cos(theta) = n_z s_z + sqrt(1 - n_z^2) sqrt(s_x^2 + s_y^2).
Albedo, diffuse light and incidence-angle cell losses are not modelled.

| Check | Result |
|---|---|
| Horizontal panel vs sin(el), 20 000 random Sun directions | max error 0 |
| Vertical panel at heading 73 deg vs cos(el) cos(az - 73) | 7.4e-16 |
| Vertical tracking panel vs cos(el), any yaw | 2.2e-16 |
| Tracking canted panel on a 4 deg tilted lander vs brute-force maximum over 36 000 rotations | 3.6e-9 (grid resolution 0.01 deg) |
| Normal incidence at 1 au, 1 m^2, eta = 1 | 1361.000 W; ratio at 0.98 au 1.04123 = 1/0.98^2 |

`power_over_yaws` evaluates a set of headings and returns worst, best and mean power per epoch (no Monte Carlo).

### 4.2 Battery (`simulate_battery`)

Stored energy E: dE/dt = eta_c net for net > 0, net / eta_d for net < 0, clamped to [0, capacity]. Net =
generation (piecewise linear between samples) minus load (piecewise constant). On the merged breakpoints each
sub-interval is split at net = 0 and at clamp and threshold crossings and integrated in closed form, so there
is no step error. Depth of discharge defines a soft floor (1 - max_dod) x capacity; the battery is allowed to
run below it down to 0 so violations are quantified: `min_soc`, `time_below_threshold_s`, `energy_margin_wh`
(minimum stored energy minus floor, negative = violated), `spilled_wh`, `unserved_wh`.
`dark_span_survival(battery, load, duration, start_soc)` answers whether a given dark span is survived and
reports the time to reach the floor and to empty.

| Check | Result |
|---|---|
| Closed forms (constant charge, constant discharge, triangular net power with two sign changes, spill, brown-out, load edges as breakpoints, dark-span times 4 h to floor and 8 h to empty) | exact |
| Energy closure on a random 400-sample profile with both clamps active | battery and bus closure below 1e-9 relative in tests |
| 3-day diurnal case (600 Wh, eta_c 0.93, eta_d 0.90, DoD 0.6): closure | battery 2.0e-13 Wh, bus 0.0 Wh (relative <= 4e-17) |
| Same case vs 0.5 s Euler brute force on the same model | min SOC 0.3248 (difference 6e-11); final energy difference 0.000 Wh; time below floor 3.109 h (difference 0.3 s) |

(Figure `visibility_power_battery.png`.)

Behaviour fixed after review: `LoadProfile.outside_w` has no default (it was 0 W, which
silently drew no load outside the profile): if it is None, any simulation or lookup that leaves
`[edges[0], edges[-1]]` raises, and `LoadProfile.constant` sets it; `t_min_soc` is the time the minimum is first
reached (it was the end of the piece, so a battery emptied at 3600 s inside a 7200 s sample interval reported
7200 s); `soc_threshold` must lie in [0, 1]; `dark_span_survival` documents and keeps `battery.initial_soc` as
the default start (never more optimistic than a full battery; pass `start_soc=1.0` for the full case).

### 4.3 Many start epochs (`simulate_battery_scan`)

`simulate_battery_scan(t, generation_w, battery, load, starts, window_s)` runs the `simulate_battery` physics
(the same segment integrator, `_advance`) over `[q, q + window_s]` for each start `q`, in parallel, over one
shared generation series and one absolute-time load. It is equivalent to calling `simulate_battery` with sample
times `[q, t strictly inside the window, q + window_s]` and generation interpolated at them, and returns only
summaries (min SOC, time of minimum, time below threshold, energy margin, final SOC, charged, discharged,
spilled, unserved), not the energy series or closure residuals. Test: six random cases (random generation with
zero stretches, random load steps with an edge on a sample time and a near-coincident edge, random battery and
window), 33 starts each including starts on samples, compared with the loop at 1e-10 (SOC) to 1e-5 s (times).
Benchmark: 7920 starts, 5 d window, 8640 samples, 240 load steps. Three runs (2026-11-13, machine
and conditions as in section 1.5, default Numba threads): scan 0.038, 0.038, 0.041 s (median 0.038 s, 0.005
ms/start); Python loop of `simulate_battery` 0.10, 0.11, 0.10 ms/start (extrapolated from 60 sampled starts
to 0.8 s), so 19x to 22x; min SOC difference 0.0 over the 60 checked starts. The speed-up is modest because
`simulate_battery` is already compiled; the saving is the per-start Python grid construction.

## 5. Communication (`comms.py`, `link_budget.py`)

### 5.1 Contact windows

A station is usable iff its direction at the lander clears the terrain horizon by `horizon_margin_deg` **and**
the lander is above the station elevation mask. The signal is the minimum of the two clearances (degrees),
usable where > 0, edges refined like any other crossing; network windows are the union. `handovers` counts
station switches inside continuous coverage using a greedy latest-end schedule (minimum switches for a union
of intervals); `acquisitions` counts continuous coverage stretches. Horizon brackets give window edge ranges
(`station_window_edge_ranges`).

Verification: truth table over {station above/below horizon + margin} x {lander above/below mask} (only
one of four combinations is usable); boundary equality is not usable; two-constraint edges at the known times
300 s and 750 s; union, gap (200 s), fraction (0.6), schedule A -> B -> C, handovers 1 and acquisitions 2 on
constructed pulses; azimuth dependence of the horizon; duplicate station names rejected. On a synthetic
3-station, 30-day network (**not real geometry**), the union fraction at 300 s sampling
was 0.8803 against 0.8803 from a 10 s resample (difference 1.4e-5).

### 5.2 Link budget

    FSPL = 20 log10(4 pi d f / c);  Pt/N0 = EIRP + G/T - FSPL - losses - 10 log10 k;  Eb/N0 = Pt/N0 - 10 log10 R_b

with the Boltzmann constant k = 1.380649e-23 J/K (SI-exact). `evaluate_link` returns FSPL, Pt/N0, Eb/N0,
margin, maximum data rate at a required margin, and whether the link closes, for scalar or array range.

**Worked example (independent source).** Kobayashi, Shihabi and Taylor, *Mars Cube One Telecommunications
Subsystem Design*, JPL DESCANSO Design and Performance Summary Series, Article 18, Sept 2021, Table 5-4
(X-band downlink, 8414 MHz; fetched from `https://descanso.jpl.nasa.gov/DPSummary/DESCANSO18_MarCO.pdf`; the
table takes station gains "per DSN 810-005", checked below). G/T is built from the printed antenna gain
and system temperature, command-modulation and implementation losses enter the requirement as printed.

| Column | FSPL (ours / printed) | Pt/N0 (ours / printed) | Required Pt/N0 | Margin (ours / printed) |
|---|---|---|---|---|
| LGA, 34 m, 15e6 km | 254.47 / 254.4 | 25.94 / 26.0 | 20.12 / 20.12 | 5.82 / 5.8 |
| MGA, 34 m, 74.8e6 km | 268.43 / 268.4 | 26.27 / 26.3 | 20.12 / 20.12 | 6.15 / 6.1 |
| HGA, 34 m, 160e6 km | 275.03 / 275.0 | 38.27 / 38.2 | 30.97 / 30.97 | 7.30 / 7.3 |
| HGA, 70 m, 160e6 km | 275.03 / 275.0 | 45.16 / 45.2 | 39.79 / 39.79 | 5.37 / 5.4 |

Largest differences: 0.07 dB (FSPL and Pt/N0), 0.05 dB (margin); printed values are rounded to 0.1 dB and
the table ranges are given to two or three digits. The table is a deep-space link; the lunar case differs only
in range (about 3.8e5 km), frequency and equipment, not in the equations.

**DSN 810-005 cross-check of the station inputs**. The MarCO table
gives station gain "per DSN 810-005" without naming a module, so the values were checked against the modules
themselves, both opened from `https://deepspace.jpl.nasa.gov/dsndocs/810-005/`:

- 70 m: module 101, Rev. D (released 2011-04-21), Table 2, X-band 8420 MHz receive gain at the feedhorn
  aperture, no atmosphere: X-only 74.55 (DSS-14), 74.63 (DSS-43), 74.66 (DSS-63) dBi; S/X configuration 74.35,
  74.36, 74.19 dBi. MarCO uses 74.3 (difference -0.36 to +0.11 dB). TAMW (zenith, no atmosphere, Table 2/4) is
  11.65, 12.10, 11.46 K (X-only) and 12.59, 13.32, 12.64 K (S/X); MarCO's vacuum-zenith 11.5 K differs by
  -1.82 to +0.04 K.
- 34 m: module 104, Rev. P (issue date 2025-10-09), Table 7, X-band 8425 MHz gain 68.29 (X-only), 68.25 (S/X),
  68.21 dBi (X/K), tolerance +0.1/-0.2 dB; MarCO uses 68.3 (+0.01 to +0.09 dB). Table 9 TAMW at zenith for DSS-34
  X-band (diplexed) 15.86 and 16.17 K (X/Ka), 17.54 and 17.67 K (S/X); MarCO's 18.3 K is 0.6 to 2.4 K higher.
  Replacing 18.3 K by those values in the 34 m system noise (30.5 K) would raise G/T by 0.09 to 0.36 dB, so the
  MarCO 34 m columns are slightly conservative against the current handbook revision.

Table values not printed by MarCO (elevation noise, sky noise at 21 deg, 90 % weather attenuation 0.15 dB) were
not cross-checked; Table 9 gives only zenith sky noise (5.04 to 5.39 K at X-band, CD = 25 %). Nothing in
`link_budget.py` hard-codes a DSN gain or noise temperature: `LinkBudget` takes G/T from the caller, so no
unverified station value is left in a default.

## 6. Limitations and residual risks

- The Sun is a disc in a tangent plane (section 1.3); error below 2e-4 for horizons up to 20 deg and below
  1e-3 up to 60 deg.
- Limb darkening: the default exponent (0.39) is a spectrum-weighted single-power-law fit to HM98 exponents with
  the ASTM G173-03 spectrum (section 1.1); no solar-cell spectral response curve was opened, so cell-specific
  band weighting is not applied (400-1100 nm gives 0.432, a 0.0017 change in flux fraction); HM98 data end at 303
  nm and 2402 nm, and the 3.6 % of the spectrum outside is not weighted. The NL paper and PS/PSW were not
  opened; the exponents are HM98's, and all 111 PS/PSW and 30 NL values in `limb_spectrum.py` were compared
  programmatically with a fresh copy of HM98 Table 2 (pdftotext of the PDF, sha256 10fa1d8e...6093) with
  exact equality of every (wavelength, alpha) pair. The pvlib-hosted copy of ASTM G173-03 was used instead of the NREL original.
- Solar radius: derived from the PCK value and `AU_KM` (section 1.6); there is no unverified recalled constant.
- Horizon widening is a first-order per-azimuth marginal model (section 3); correlated DEM error and
  blocker switching are not modelled; it was conservative in the one synthetic test, which is not a real-DEM
  validation.
- Power: no albedo, diffuse light, thermal derating or incidence-angle losses; eclipse and terrain factors
  multiply. Yaw uncertainty is handled by a yaw set; the envelope is only as fine as the grid.
- Battery: lumped efficiencies; no temperature, ageing, voltage or constant-power-converter effects; the
  discharge floor is soft by design.
- Link budget: the user supplies G/T, losses and requirement; atmospheric and weather statistics are not
  modelled; only the published deep-space example was reproduced, not a lunar one.
- Contact windows use the station elevation mask and a simple lander-side clearance; no antenna pattern,
  pointing-limit, or scheduling-conflict model.
- Inputs are assumed sampled finely enough that a feature (rise, set, notch) is not missed between two
  samples; interval extraction cannot detect a feature shorter than the step.
