# Validation report: `lunarnav.visibility`

This layer is pure mathematics. It does not use SPICE and does not read terrain data.

Figures: `docs/validation/img/visibility_*.png`. All checks used fixed seeds. The quadrature references are
deterministic midpoint rules, so they have no sampling noise. The task statement asked for "Monte Carlo". This
report uses dense quadrature on the same disc instead, because its error is known and much smaller.

This report checks the **mathematics given its inputs**. It does not assess the accuracy of the inputs (DEM,
ephemeris, lander parameters). Each constant specific to this layer is tied to a source that was opened. The
source is named where the constant is used. These constants are the limb-darkening exponents, the solar radius,
the DSN station gains and noise, and the link-budget example. Two approximations do not have a simple source:
the single limb-darkening exponent and the tangent plane. Both are quantified. Constants owned by
`lunarnav.constants` (for example the solar constant) are used as given. Section 6 lists the remaining gaps.

## 1. Disc visibility (`disc.py`, `limb_darkening.py`)

### 1.1 Method

The visible area of the solar disc is computed exactly for a piecewise-linear horizon. The disc has angular
radius r and centre (az0, el0). The kernel works in the tangent plane at the disc centre, with
x = (az - az0) cos(el0) and y = el - el0. The horizon is periodic and piecewise linear in azimuth on a uniform
grid, and wraps at 360 deg. It is therefore piecewise linear in x. For each linear piece y_h = p + q x, the
visible area is

    A = integral [ c(x) - clamp(y_h(x), -c(x), c(x)) ] dx,   c(x) = sqrt(r^2 - x^2)

The kernel splits each piece at the line-circle intersections. These are the roots of
(1+q^2) x^2 + 2pq x + p^2 - r^2 = 0. Each sub-interval then integrates in closed form. The antiderivative of c
is (x c + r^2 asin(x/r))/2. The disc is not sampled. Two fast paths skip the integral: the result is 1 when the
whole disc is above the horizon maximum, and 0 when it is below the horizon minimum.

**Limb darkening.** The law is I(mu)/I(1) = mu^alpha, with mu = sqrt(1 - rho^2) and rho = d/R. The source is
Hestroffer & Magnan 1998 ("HM98"), A&A 333, 338-342, Eq. 1 with u = 1. It was opened at
`https://www.physics.hmc.edu/faculty/esin/a101/limbdarkening.pdf`.
HM98 fit alpha at each wavelength to three sets of polynomial coefficients: Pierce & Slaughter (1977, PS),
Pierce, Slaughter & Weinberger (1977, PSW) and Neckel & Labs (1994, NL). Their **Table 2** lists alpha(lambda).
The PS/PSW data cover 303-2402 nm with 111 values. The NL data cover 303-1099 nm with 30 values. These values are
transcribed into `limb_spectrum.py` and were spot-checked. Only the abstract of the original NL paper
(Sol. Phys. 153, 91) was opened, because the paper is paywalled. PS and PSW were not opened. This report therefore
relies on HM98's published exponents, not on the polynomial coefficients.

The default exponent is `DEFAULT_ALPHA = 0.39`, a bolometric choice. Sunlight is a spectrum-weighted sum of
power-law profiles, and that sum is not itself a power law. The default is the single exponent whose flat-horizon
flux-fraction curve is closest (minimax) to the weighted sum. The weights come from the
**ASTM G173-03 extraterrestrial spectrum** (`ASTMG173.csv`, 280-4000 nm, integral 1347.9 W/m2). The file opened
was the copy in the pvlib repository,
`https://raw.githubusercontent.com/pvlib/pvlib-python/main/pvlib/data/ASTMG173.csv`, sha256 91964ac2...ee7859.
I did not open the NREL original, because its host was unreachable from this machine.
The band 303-2402 nm holds 96.4 % of the extraterrestrial irradiance. Over that band the effective exponent is
**0.3946**. The irradiance-weighted mean of alpha(lambda) is 0.402. The worst misfit of the flux-fraction curve
is 1.2e-4. The earlier default, 0.56, was the 500 nm value. It overstated limb darkening for the total solar
flux by a sunrise-sweep difference of 0.0070 in flux fraction (section 1.4), so it was replaced. No measured
solar-cell spectral response was opened. A silicon or triple-junction weighting is therefore not applied. The
400-1100 nm result below brackets that band.

**Flux.** The visible flux is a smooth one-dimensional integral. Let S(rho) be the exact visible area of the
concentric disc of radius rho r. Integration by parts and the substitution t = mu^alpha turn the weighted
integral into

    F_vis = integral_0^1 S(rho(t)) dt,   rho(t) = sqrt(1 - t^(2/alpha))

The default evaluates it by 24-node Gauss-Legendre quadrature of the exact S. The normalisation is the full-disc
flux pi r^2 * 2 / (alpha + 2). Two checks hold: a uniform disc (alpha = 0) reduces to the area, and a fully
visible disc gives exactly 1.

**Bounds.** `disc_visibility` evaluates three horizons: nominal, optimistic (`elev_lo_deg`) and pessimistic
(`elev_hi_deg`). For antennas, `point_clearance` returns the smooth elevation clearance
`el - h(az) - margin` in degrees. `point_clearance_bounds` evaluates it for the same three horizons.

### 1.2 Measured errors

| Check | Reference | Result |
|---|---|---|
| Flat horizon, 2001 offsets from -r to +r | exact circular segment | max error 9.0e-15 |
| Step (1.5 deg, az 40-60), spike, V notch, seam step at az 359-359.5 (13 disc positions, default alpha) | polar midpoint quadrature, 2000 x 4000 | area <= 2.6e-6, flux <= 1.2e-5 (target 1e-3) |
| 20 random rough horizons (+-1.5 deg) | same quadrature | area <= 1.5e-5, flux <= 1.8e-5 |
| Flux, flat horizon, alpha = 0.3..1.0, 11 offsets each | 2-D numerical integral of the law, 3000 x 3000 | max error 2.2e-5 |
| Wrap-around | horizon rotated by 180 deg (identical result to 1e-12) and quadrature across the seam | pass (tests) |
| Flux quadrature convergence (400 rough-horizon epochs) | n = 400 nodes | n = 8: 5.0e-4; 12: 1.8e-4; 16: 1.1e-4; 24: 2.7e-5; 32: 1.6e-5; 48: 4.4e-6 |

At the default 24 nodes, the flux quadrature error stays below 1e-4 (figure `visibility_disc_nodes.png`). The
error is highest when horizon vertices cross the disc edge. There, S is only piecewise smooth.

### 1.3 Tangent-plane approximation (the one real approximation)

The tangent-plane error stays below 1e-3 for horizons up to 60 deg, and below 2e-4 up to 20 deg. The kernel
uses cos(el0) as the azimuth scale for the whole disc. The reference is an **exact spherical-cap quadrature**:
points are laid out uniformly in solid angle over the cap, and azimuth and elevation are computed exactly, on a
1500 x 3000 grid. The disc radius is r = 0.26645 deg (derived, see 1.6). The horizons are random and rough, with
the mean elevation listed in the table. Two 0 deg cases were run, with the disc centre 0 and 0.15 deg above the
horizon. They gave 1.6e-5 / 1.8e-5 and 8.5e-6 / 1.8e-5. The table shows the larger values.

| Horizon elevation near the Sun | max abs area error | max abs flux error |
|---|---|---|
| 0 deg | 1.6e-5 | 1.8e-5 |
| 10 deg | 1.0e-4 | 9.9e-5 |
| 20 deg | 1.7e-4 | 1.5e-4 |
| 40 deg | 3.7e-4 | 3.4e-4 |
| 60 deg | 9.2e-4 | 8.7e-4 |

The error grows with elevation, because it scales with r tan(el0). It stays under 1e-3 up to 60 deg. Lunar
horizons at landing sites are mostly below 20 deg, where the error is below 2e-4. One caveat works against this
result. For the spherical cases, the quadrature references may themselves carry errors of order 1e-4 at these
grid sizes, because the visibility indicator is discontinuous. The smallest numbers above are therefore partly
reference noise.

### 1.4 Sensitivity to the limb-darkening law

Ignoring limb darkening changes the flux fraction by up to 0.0169. Within the plausible range of the exponent the
change is at most about 0.014. On a flat horizon with the default
alpha 0.39, the largest difference between flux fraction and area fraction is **0.0169**. Flux exceeds area while
the dim rim is hidden. The table shows how the exponent choice changes the flux fraction during a partial-disc
phase. In this test a flat horizon sweeps across the disc at 401 offsets, using the production `disc_fraction`.
The reference is the default (figure `visibility_limb_choice.png`).

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

The same method gives other effective exponents. NL data over 303-1099 nm give 0.470, which covers 74 % of the
extraterrestrial irradiance (ETR). NL data over 400-1100 nm give 0.440. PS+PSW data over 400-700 nm give 0.523.
The NL and PS/PSW exponents agree to within 0.015 at the wavelengths compared (400 to 1000 nm).

The whole plausible range of the exponent moves the flux fraction by at most about 0.014. This range runs from
the visible band edges to the bolometric value. Taking the UV end of the data would raise this to 0.021. The
change between the default and a silicon-band or 550 nm choice is 0.0017 to 0.0046.

A window edge defined by a flux fraction moves by that fraction of the disc-crossing time. The Sun moves 360 deg
per synodic month (29.53 d), about 0.51 deg/h. The 0.533 deg disc therefore takes about 63 min to cross, so a
change of 0.014 is roughly one minute (`visibility_disc_sunrise.png`). At polar sites the Sun grazes the horizon,
so the crossing is slower.

### 1.5 Speed

Area plus flux for 100 000 epochs takes a median of 31.6 ms on 16 threads. The test uses a 720-azimuth horizon,
with **every** epoch within +-1 deg of the horizon, which is the slow case. It was measured 2026-11-13 on a
Ryzen 7 8845HS (16 threads, 28 GB). The user's desktop and service processes were running. The load average was
about 2 to 3, swap was full and about 12 GB was available. No other project jobs ran. Each process made a warm-up
call and then 25 timed calls. The JIT is cached on disk and is excluded from the timing. Each configuration ran
in three processes. The table gives the median of the three medians, and the range of all calls.

| Case | threads | median of 3 runs | range over all calls |
|---|---|---|---|
| area plus flux | 16 (Numba default) | 31.6 ms | 26.8 to 40.4 ms |
| area plus flux | 1 (`NUMBA_NUM_THREADS=1`) | 127.8 ms | 126.9 to 135.8 ms |
| area only | 16 | 12.0 ms | 4.8 to 17.4 ms |
| area only | 1 | 11.2 ms | 11.1 to 11.7 ms |

The flux path scales with threads: it is 4.0x faster on 16 threads. The area-only path does not scale, and one
thread is as fast. Its threading overhead is comparable to the work, and 16-thread calls vary from 4.8 to
17.4 ms. A best-of-5 timing, run three times, gave 29.3, 28.9, 28.4 ms for area plus flux. It gave 10.0, 11.0,
1.6 ms for area only. The 1.6 ms value is the same fast tail of the 16-thread area-only distribution and is not
representative. An earlier claim of 33 to 38 ms / 7 to 11 ms was measured under load and is superseded.

### 1.6 Solar angular radius

The checks in this report derive the solar angular radius and do not use a recalled constant. The engine takes
the Sun's angular radius from `TargetTrack.ang_radius_deg`. `lunarnav.ephem` computes it from
`R_SUN_KM = 695,700 km` and the actual range. `data/kernels/pck00011.tpc` carries `BODY10_RADII = (695700 695700
695700)` km. That assignment was read and
checked to equal `R_SUN_KM`. The active value is the IAU 2015 Resolution B3 nominal solar radius. The file's "Old values" note shows the superseded 696,000 km of the 2009 IAU
report.

The checks derive r = asin(R_SUN_KM / AU_KM), with AU_KM = 149,597,870.7 km (`lunarnav.constants`). This gives
**0.26645 deg = 959.23 arcsec** at 1 au, 0.27098 deg at 0.9833 au and 0.26208 deg at 1.0167 au. The distances
0.9833 and 1.0167 au stand for perihelion and aphelion. They are round values used only to show the range and
are not taken from a source.

## 2. Intervals and events (`intervals.py`)

Edges are threshold crossings between samples. A sample is visible where `signal > threshold`. Each edge is
refined by one of three methods:

- (a) linear interpolation;
- (b) cubic Hermite with central-difference slopes and a bisection root;
- (c) a user callback, solved with Brent's method.

Windows that touch the ends of the data are flagged `*_censored`. They are never reported as rise or set events.
`time_to_next_transition` returns NaN if no real event follows.

The test signal is s(t) = sin(2 pi t / 100 s) + 0.3 over six cycles. The table gives the worst edge-time error
over all sampling phases:

| dt (s) | linear | hermite | callback | nearest sample (no refinement) |
|---|---|---|---|---|
| 16 | 0.836 | 0.446 | 3.4e-9 | 15.85 |
| 4 | 0.0405 | 0.0220 | 7.7e-10 | 3.97 |
| 1 | 2.47e-3 | 6.4e-5 | 1.3e-11 | 0.994 |
| 0.5 | 6.2e-4 | 7.9e-6 | 1.9e-10 | 0.494 |

The fitted error order between dt = 16 s and 1 s is 2.09 for linear and 3.30 for Hermite. Hermite is
O(dt^3) because its central-difference slopes are O(dt^2). At 16 s, a sixth of the period, the Hermite error is
large because the step is outside the asymptotic range. The linear method is the safe default for geometry
sampled finely enough (minutes). A callback that recomputes the geometry reaches the solver tolerance.

The window statistics match the analytic values (dt = 1 s, 1000 s span):

- Longest dark span: 40.3014 s against 40.3013 s analytic.
- Longest interior visible window: 59.6986 s against 59.6987 s.
- Visible fraction: 0.59658 against 0.59699 analytic. The finite span cuts whole cycles, so a 0.07 percent
  difference is expected.
- Time to next transition from t = 10, 70, 95 s: 44.8493, 25.1507, 0.1507 s, identical to the analytic values
  at four decimals.

Edge-time ranges from the optimistic and pessimistic signals match the analytic crossings to 6.4e-5 s over
12 edges. This test uses `bounded_windows`, with a bias of 0.4 / 0.3 / 0.2 around the nominal. A window whose
pessimistic signal never rises is returned with `certain = False`.

The windows of the three signals are matched **by overlap**. An earlier containment match dropped real nominal
windows with `method="hermite"`, because there the three interpolants need not be ordered between samples. The
review repro was `nom=[-1,-1,-.5,.5,1,1,1,1]`, `opt[4]=6`. It now returns the nominal window from 2.5, with
`certain=True`. Ranges are clamped so that
`start_range[0] <= nominal.start <= start_range[1]` and `end_range[0] <= nominal.end <= end_range[1]` always
hold. 20 random Hermite cases tested this.

`UncertainWindow.start_range_censored` / `end_range_censored` are new fields, default False. They mark a range
bound that is the first or last data sample of an optimistic or pessimistic window. Such a bound is only a
one-sided estimate. `window_stats` and `dark_windows` raise an error if a window lies outside `[t0, t1]`. A dark
span that abuts a censored window edge is itself censored. This also holds for a span wider than the data.

## 3. Terrain-error widening (`uncertainty.py`)

The model widens the horizon at each azimuth by the angular error that the terrain error produces. The blocker
is at ground distance d (`blocker_dist_m`). The horizon elevation is h, and the height difference is
dz = d tan h. All quantities are per sigma:

    sigma_h^2 = (sigma_z cos^2 h / d)^2 + (g sigma_xy / d)^2 + (sigma_xy sin h cos h / d)^2

Here g = d(elev)/d(az) is the local horizon gradient, in deg per deg, from a centred difference on the azimuth
grid. The three terms are:

- vertical error;
- horizontal error across the line of sight (the blocker slides along the horizon);
- horizontal error along the line of sight.

The vertical term follows from h = atan(dz / d), so dh/ddz = cos^2 h / d. An earlier version used cos h / d,
which treats d as the slant range. That version was conservative by 1/cos h: 6 % at 20 deg and 0.8 % at 7 deg.
It was corrected after review and checked against a finite difference of atan. The along-line term is unchanged
(dh/dd = -sin h cos h / d).
`widen_horizon` brackets the horizon by `lo - k sigma_h` and
`hi + k sigma_h`. The time uncertainty of a window edge is `sigma_h / |d clearance / dt|`
(`edge_time_uncertainty`, `disc_window_edge_ranges`).

**Per-azimuth budgets.** Each terrain error term can be a single value or one value per azimuth.
`TerrainErrorModel.sigma_z_m` and `sigma_xy_m` are each either a float (used at every azimuth) or a 1-D array.
The array has one value per azimuth of the horizon being widened. It holds a terrain product's own published
error for the azimuths that product supplies.

Both terms are validated at construction. They must be finite, non-negative and at most 1-D. Arrays are copied
and made read-only. `horizon_sigma_deg` / `widen_horizon` check the length against the horizon. The error
message names the term and both lengths. The formula is applied element-wise, so each azimuth gets exactly the
scalar result for its own pair of values. Two tests show this. An array of equal entries is bit-identical to
the scalar. A two-valued array equals the scalar model of each value on its half.

The budget at an azimuth is the one given for that azimuth. The model does not look up which product supplied
the blocker. It does not model the observer's own ground-height error, which is common to all azimuths,
separately.

The provenance entry `terrain_error_widening` always holds `sigma_z_m_min/max`, `sigma_xy_m_min/max`,
`per_azimuth` and `k_sigma` (JSON-safe). Scalar models also keep the former `sigma_z_m` and `sigma_xy_m` keys.
Per-azimuth models omit them.

**Approximation and what it ignores.** The model is first order and marginal per azimuth. It ignores three
effects:

- A different blocker can take over where two features have similar elevation.
- DEM errors are spatially correlated. A common tilt moves all edges together. The brackets are then
  conservative for one edge, but not for the joint behaviour of many edges.
- The d/2R curvature derivative.

The distance is the nominal blocker distance. On the shoulders of a feature, where the blocker changes with
azimuth, the model uses the local value of that distance.

**Check**: a brute-force perturbation of a synthetic Gaussian mountain. The mountain is 1500 m high, 2500 m wide
and 12 km away. The horizon is computed by ray marching. Each case uses 400 perturbed DEMs. Each perturbation
shifts the centre by sigma_xy per axis and changes the height by sigma_z. The table gives model sigma divided by
brute-force sigma:

| Case | at the peak azimuth | within +-12 deg of the peak (median, range) |
|---|---|---|
| sigma_z = 30 m only | 1.015 | 1.151 (1.015 to 1.672) |
| sigma_xy = 60 m only | 0.999 | 0.999 (0.979 to 1.023) |
| both | 1.026 | 1.134 (1.024 to 1.381) |

The model agrees to 3 percent at the peak. It never under-estimated in this test. On the mountain flanks it is
conservative (over-estimates), by up to 67 percent for pure vertical error. The reason is that the model uses a
single blocker distance, while the flank horizon is set by points on the mountain that shift.

A separate check covered edge times. A linear clearance with a known rate gives sigma_t = sigma_h / rate
exactly. The window edges of the widened horizon (k = 2) reproduce nominal edge +- 2 sigma_t to within 1 s.

## 4. Power (`power.py`, `battery.py`)

### 4.1 Geometry

Panel power agrees with the closed-form and brute-force references below to 3.6e-9 or better. The frames are local ENU and
a body frame with x forward, y left and z up (when level).

`Attitude(yaw, tilt, tilt_az)` sets the lander attitude. Yaw is the heading of body x, clockwise from north.
Tilt leans body z toward `tilt_az` by the shortest rotation about the horizontal axis. The rotation is
R = R_tilt R_yaw. Tests check that z maps to the lean direction, that R is orthonormal, and that at heading 0
forward is north and left is west.

Panel power = A eta S cos(theta) f (1 - e), with S = 1361 W/m^2 (1/r_au)^2, where f is the limb-darkened
visible flux fraction and e is the optional Earth-eclipse fraction. The Earth-eclipse fraction is treated as an
independent factor. This is only approximate if both occultations are partial and overlap. A tracking panel
rotates about the body z axis, so cos(theta) = n_z s_z + sqrt(1 - n_z^2) sqrt(s_x^2 + s_y^2).
The model does not include albedo, diffuse light or incidence-angle cell losses.

| Check | Result |
|---|---|
| Horizontal panel vs sin(el), 20 000 random Sun directions | max error 0 |
| Vertical panel at heading 73 deg vs cos(el) cos(az - 73) | 7.4e-16 |
| Vertical tracking panel vs cos(el), any yaw | 2.2e-16 |
| Tracking canted panel on a 4 deg tilted lander vs brute-force maximum over 36 000 rotations | 3.6e-9 (grid resolution 0.01 deg) |
| Normal incidence at 1 au, 1 m^2, eta = 1 | 1361.000 W; ratio at 0.98 au 1.04123 = 1/0.98^2 |

`power_over_yaws` evaluates a set of headings and returns the worst, best and mean power per epoch. It uses no
Monte Carlo.

### 4.2 Battery (`simulate_battery`)

The battery model integrates in closed form, so it has no step error. The stored energy E follows
dE/dt = eta_c net for net > 0, or net / eta_d for net < 0, and E is clamped to [0, capacity]. Net power is
generation (piecewise linear between samples) minus load (piecewise constant). The model merges the breakpoints
of both. It splits each sub-interval at net = 0 and at clamp and threshold crossings, and integrates each piece
in closed form.

Depth of discharge defines a soft floor at (1 - max_dod) x capacity. The battery may run below it, down to 0, so
that violations are quantified. The outputs are `min_soc`, `time_below_threshold_s`, `energy_margin_wh`
(minimum stored energy minus floor; negative means violated), `spilled_wh` and `unserved_wh`.
`dark_span_survival(battery, load, duration, start_soc)` answers whether the battery survives a given dark span.
It reports the time to reach the floor and the time to empty.

| Check | Result |
|---|---|
| Closed forms (constant charge, constant discharge, triangular net power with two sign changes, spill, brown-out, load edges as breakpoints, dark-span times 4 h to floor and 8 h to empty) | exact |
| Energy closure on a random 400-sample profile with both clamps active | battery and bus closure below 1e-9 relative in tests |
| 3-day diurnal case (600 Wh, eta_c 0.93, eta_d 0.90, DoD 0.6): closure | battery 2.0e-13 Wh, bus 0.0 Wh (relative <= 4e-17) |
| Same case vs 0.5 s Euler brute force on the same model | min SOC 0.3248 (difference 6e-11); final energy difference 0.000 Wh; time below floor 3.109 h (difference 0.3 s) |

(Figure `visibility_power_battery.png`.) SOC is the state of charge.

Four behaviours were fixed after review:

- `LoadProfile.outside_w` has no default. It was 0 W, which silently drew no load outside the profile. If it is
  None, any simulation or lookup that leaves `[edges[0], edges[-1]]` raises an error. `LoadProfile.constant`
  sets it.
- `t_min_soc` is the time the minimum is first reached. It used to be the end of the piece. A battery emptied at
  3600 s inside a 7200 s sample interval therefore reported 7200 s.
- `soc_threshold` must lie in [0, 1].
- `dark_span_survival` keeps `battery.initial_soc` as the default start, and documents this. That default is
  never more optimistic than a full battery. Pass `start_soc=1.0` for the full case.

### 4.3 Many start epochs (`simulate_battery_scan`)

The scan gives the same results as a loop of single-start simulations and runs 19x to 22x faster.
`simulate_battery_scan(t, generation_w, battery, load, starts, window_s)` runs the `simulate_battery` physics over
`[q, q + window_s]` for each start `q`, in parallel. It uses the same segment integrator, `_advance`. All starts
share one generation series and one absolute-time load.

It is equivalent to calling `simulate_battery` with sample times `[q, t strictly inside the window, q + window_s]`
and generation interpolated at those times. It returns only summaries: min SOC, time of minimum, time below
threshold, energy margin, final SOC, charged, discharged, spilled and unserved. It does not return the energy
series or the closure residuals.

Test: six random cases. Each case has random generation with zero stretches, random load steps with an edge on a
sample time and a near-coincident edge, and a random battery and window. Each case has 33 starts, including
starts on samples. The scan matched the loop at 1e-10 (SOC) to 1e-5 s (times).

Benchmark: 7920 starts, 5 d window, 8640 samples, 240 load steps. Three runs were made on 2026-11-13, with the
machine and conditions as in section 1.5 and the default Numba threads. The scan took 0.038, 0.038, 0.041 s
(median 0.038 s, 0.005 ms/start). A Python loop of `simulate_battery` took 0.10, 0.11, 0.10 ms/start. That
figure is extrapolated from 60 sampled starts to 0.8 s. The speed-up is therefore 19x to 22x. The min SOC
difference was 0.0 over the 60 checked starts. The speed-up is modest because `simulate_battery` is already
compiled. The saving is the Python grid construction for each start.

## 5. Communication (`comms.py`, `link_budget.py`)

### 5.1 Contact windows

A station is usable iff two conditions hold. Its direction at the lander clears the terrain horizon by
`horizon_margin_deg`, **and** the lander is above the station elevation mask. The signal is the minimum of the
two clearances, in degrees. The station is usable where the signal is > 0. Edges are refined like any other
crossing. Network windows are the union of the station windows.

`handovers` counts station switches inside continuous coverage. It uses a greedy latest-end schedule, which gives
the minimum number of switches for a union of intervals. `acquisitions` counts continuous coverage stretches.
Horizon brackets give the window edge ranges (`station_window_edge_ranges`).

The verification covered these cases:

- A truth table over {station above/below horizon + margin} x {lander above/below mask}. Only one of the four
  combinations is usable.
- Boundary equality is not usable.
- Edges set by both requirements, at the known times 300 s and 750 s.
- On constructed pulses: union, gap (200 s), fraction (0.6), schedule A -> B -> C, handovers 1 and
  acquisitions 2.
- Azimuth dependence of the horizon.
- Duplicate station names are rejected.

On a synthetic 3-station, 30-day network (**not real geometry**), the union fraction was 0.8803 at 300 s
sampling. A 10 s resample gave 0.8803 (difference 1.4e-5).

### 5.2 Link budget

    FSPL = 20 log10(4 pi d f / c);  Pt/N0 = EIRP + G/T - FSPL - losses - 10 log10 k;  Eb/N0 = Pt/N0 - 10 log10 R_b

The Boltzmann constant is k = 1.380649e-23 J/K (SI-exact). `evaluate_link` returns FSPL, Pt/N0, Eb/N0, the
margin, the maximum data rate at a required margin, and whether the link closes. It accepts a scalar or array
range.

**Worked example (independent source).** The engine reproduces a published link budget to within 0.07 dB. The
source is Kobayashi, Shihabi and Taylor, *Mars Cube One Telecommunications Subsystem Design*, JPL DESCANSO Design
and Performance Summary Series, Article 18, Sept 2021, Table 5-4. It is an X-band downlink at 8414 MHz. It was
fetched from `https://descanso.jpl.nasa.gov/DPSummary/DESCANSO18_MarCO.pdf`. The table takes station gains "per
DSN 810-005", which is checked below. G/T is built from the printed antenna gain and system temperature.
Command-modulation and implementation losses enter the requirement as printed.

| Column | FSPL (ours / printed) | Pt/N0 (ours / printed) | Required Pt/N0 | Margin (ours / printed) |
|---|---|---|---|---|
| LGA, 34 m, 15e6 km | 254.47 / 254.4 | 25.94 / 26.0 | 20.12 / 20.12 | 5.82 / 5.8 |
| MGA, 34 m, 74.8e6 km | 268.43 / 268.4 | 26.27 / 26.3 | 20.12 / 20.12 | 6.15 / 6.1 |
| HGA, 34 m, 160e6 km | 275.03 / 275.0 | 38.27 / 38.2 | 30.97 / 30.97 | 7.30 / 7.3 |
| HGA, 70 m, 160e6 km | 275.03 / 275.0 | 45.16 / 45.2 | 39.79 / 39.79 | 5.37 / 5.4 |

The largest differences are 0.07 dB (FSPL and Pt/N0) and 0.05 dB (margin). The printed values are rounded to
0.1 dB, and the table gives ranges to two or three digits. The table is for a deep-space link. The lunar case
differs only in range (about 3.8e5 km), frequency and equipment, not in the equations.

**DSN 810-005 cross-check of the station inputs**. The MarCO station inputs are close to the DSN handbook
values, and the 34 m columns are slightly conservative. The MarCO table gives station gain "per DSN 810-005" but
does not name a module. The values were therefore checked against the modules themselves. Both modules were
opened from `https://deepspace.jpl.nasa.gov/dsndocs/810-005/`:

- 70 m: module 101, Rev. D (released 2011-04-21), Table 2, which gives the X-band 8420 MHz receive gain at the
  feedhorn aperture, with no atmosphere. X-only: 74.55 (DSS-14), 74.63 (DSS-43), 74.66 (DSS-63) dBi. S/X
  configuration: 74.35, 74.36, 74.19 dBi. MarCO uses 74.3, a difference of -0.36 to +0.11 dB. TAMW (zenith, no
  atmosphere, Table 2/4) is 11.65, 12.10, 11.46 K (X-only) and 12.59, 13.32, 12.64 K (S/X). MarCO's
  vacuum-zenith 11.5 K differs by -1.82 to +0.04 K.
- 34 m: module 104, Rev. P (issue date 2025-10-09), Table 7, which gives the X-band 8425 MHz gain as 68.29 (X-only),
  68.25 (S/X) and 68.21 dBi (X/K), with tolerance +0.1/-0.2 dB. MarCO uses 68.3 (+0.01 to +0.09 dB). Table 9
  gives TAMW at zenith for DSS-34 X-band (diplexed): 15.86 and 16.17 K (X/Ka), 17.54 and 17.67 K (S/X). MarCO's
  18.3 K is 0.6 to 2.4 K higher. Replacing 18.3 K by those values in the 34 m system noise (30.5 K) would raise
  G/T by 0.09 to 0.36 dB. The MarCO 34 m columns are therefore slightly conservative against the current
  handbook revision.

Some table values not printed by MarCO were not cross-checked. These are the elevation noise, the sky noise
at 21 deg and the 90 % weather attenuation of 0.15 dB. Table 9 gives only zenith sky noise (5.04 to 5.39 K at
X-band, CD = 25 %). `link_budget.py` does not hard-code any DSN gain or noise temperature. `LinkBudget` takes G/T
from the caller, so no default holds an unverified station value.

## 6. Limitations and residual risks

- The Sun is a disc in a tangent plane (section 1.3). The error is below 2e-4 for horizons up to 20 deg and
  below 1e-3 up to 60 deg.
- Limb darkening: the default exponent (0.39) is a single power law fitted to HM98 exponents, weighted by the
  ASTM G173-03 spectrum (section 1.1). No solar-cell spectral response curve was opened, so no cell-specific band
  weighting is applied. The 400-1100 nm band gives 0.432, a 0.0017 change in flux fraction. The HM98 data end at
  303 nm and 2402 nm, and the 3.6 % of the spectrum outside them is not weighted. The NL paper and PS/PSW were
  not opened. The exponents are HM98's. All 111 PS/PSW and 30 NL values in `limb_spectrum.py` were compared
  programmatically with a fresh copy of HM98 Table 2 (pdftotext of the PDF, sha256 10fa1d8e...6093). Every
  (wavelength, alpha) pair was exactly equal. The pvlib-hosted copy of ASTM G173-03 was used instead of the NREL
  original.
- Solar radius: derived from the PCK value and `AU_KM` (section 1.6). No unverified recalled constant is used.
- Horizon widening is a first-order marginal model per azimuth (section 3). It does not model correlated DEM
  error or blocker switching. It was conservative in the one synthetic test, which is not a real-DEM validation.
- Power: no albedo, diffuse light, thermal derating or incidence-angle losses. Eclipse and terrain factors
  multiply. Yaw uncertainty is handled by a set of headings, so the envelope is only as fine as that grid.
- Battery: lumped efficiencies. No temperature, ageing, voltage or constant-power-converter effects. The
  discharge floor is soft by design.
- Link budget: the user supplies G/T, losses and the requirement. Atmospheric and weather statistics are not
  modelled. Only the published deep-space example was reproduced, not a lunar one.
- Contact windows use the station elevation mask and a simple lander-side clearance. There is no antenna
  pattern, pointing-limit or scheduling-conflict model.
- The inputs are assumed to be sampled finely enough that no feature (rise, set, notch) falls between two
  samples. Interval extraction cannot detect a feature shorter than the step.
