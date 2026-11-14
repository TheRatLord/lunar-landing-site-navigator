"""Time-domain signals of one site on a shared ephemeris table.

`compute_signals` turns two horizons (array height, antenna height) and the table into Sun, Earth and
station geometry, solar flux fractions, eclipse, contact clearances and link margins, each for the
three horizon "worlds": nominal, optimistic (`elev_lo`, best attitude) and pessimistic (`elev_hi`,
worst attitude). Everything is evaluated on the table's epochs, so one table serves any number of
sites (SPICE is called only when the table is built).
"""

from __future__ import annotations

import contextlib
from collections.abc import Callable, Iterator
from dataclasses import dataclass, replace

import numba
import numpy as np

from lunarnav.ephem import (
    BodyFixedEphemeris,
    earth_eclipse_fraction,
    earth_track,
    station_track,
    sun_track,
)
from lunarnav.types import GroundStation, HorizonProfile
from lunarnav.visibility import (
    Attitude,
    BoundedSignal,
    LimbDarkening,
    LinkBudget,
    Panel,
    TerrainErrorModel,
    array_power_w,
    disc_fraction,
    evaluate_link,
    horizon_grid,
    point_clearance_bounds,
    power_over_yaws,
    station_signal,
    widen_horizon,
)
from lunarnav.visibility import StationTrack as CommsTrack

from .horizons import sphere_horizon_dip_deg
from .models import (
    Constraints,
    EclipseSettings,
    LanderProfile,
    LinkSpec,
    Network,
    NetworkStation,
    TerrainErrorSettings,
)

WORLDS: tuple[str, str, str] = ("nominal", "optimistic", "pessimistic")
"""Order of the horizon worlds in every bounded array of this package."""

NODATA_BLOCKER_DIST_M = 1.0e6
"""Blocker distance substituted where the terrain provider has none (makes the widening negligible)."""

MAX_KERNEL_THREADS = 8
"""Upper bound on the threads one parallel numba kernel of this package uses (the machine is shared)."""

DISC_ITEMS_PER_THREAD = 60_000
"""Epochs per thread for `visibility.disc_fraction`: about 45-160 ns per epoch measured on the 16-thread shared
development machine, so this is roughly 3-10 ms of serial work per thread."""


@contextlib.contextmanager
def thread_budget(n_items: int, items_per_thread: int) -> Iterator[None]:
    """Run parallel numba kernels with as many threads as `n_items` justify (at least `items_per_thread` items
    each, at most `MAX_KERNEL_THREADS` and the caller's current thread count), restoring the count after.

    The prange kernels (`visibility.disc_fraction`, `simulate_battery_scan`) cost a few microseconds per item, so on
    the 10^3-10^5 items of a site evaluation or scan the cost of waking all threads (milliseconds, much more on a
    loaded machine) exceeds the work. Items are independent, so results do not depend on the thread count.

    Why it exists: measured on a loaded 16-thread machine, the 5-year SOC-heavy scan went from 15.91 s to 0.95 s
    once small batches stopped waking every thread (docs/validation/scenario.md, performance).
    """
    current = numba.get_num_threads()
    want = max(1, min(current, MAX_KERNEL_THREADS, n_items // max(items_per_thread, 1)))
    if want == current:
        yield
        return
    numba.set_num_threads(want)
    try:
        yield
    finally:
        numba.set_num_threads(current)


def network_ground_stations(network: Network) -> list[GroundStation]:
    """Engine `GroundStation`s for a network; the mask follows `Network.direction`."""
    out = []
    for s in network.stations:
        mask = {"downlink": s.rx_mask_deg, "uplink": s.tx_mask_deg,
                "two_way": max(s.rx_mask_deg, s.tx_mask_deg)}[network.direction]
        out.append(GroundStation(name=s.id, lat_deg=s.lat_deg, lon_deg=s.lon_deg, alt_m=s.alt_m,
                                 min_elevation_deg=mask, network=s.network))
    return out


def terrain_budget(h: HorizonProfile, error: TerrainErrorSettings, provider=None) -> dict:
    """The budget applied to horizon `h`: per-azimuth arrays (`sigma_z_m`, `sigma_xy_m`) plus a JSON-safe record.

    `custom` mode: the settings' scalars at every azimuth. `product` mode: `provider.error_budget(h)` (the store that
    supplies the limiting blocker of each azimuth); a provider without that method, or with no budget (synthetic
    providers), gets the assumed global budget (4 m, 10 m) and the record says `assumed`."""
    n = len(h.az_deg)
    if error.mode == "custom":
        sz, sxy, rec = np.full(n, error.sigma_z_m), np.full(n, error.sigma_xy_m), {"basis": "user"}
    else:
        fn = getattr(provider, "error_budget", None)
        b = fn(h) if fn is not None else None
        if b is None:
            sz, sxy, rec = np.full(n, 4.0), np.full(n, 10.0), {"basis": "assumed", "note": "provider has no per-product budget"}
        else:
            sz, sxy = np.asarray(b["sigma_z_m"], dtype=np.float64), np.asarray(b["sigma_xy_m"], dtype=np.float64)
            rec = {"basis": "product", "store_index": np.unique(np.asarray(b["store_index"])).tolist()}
    rec |= {"mode": error.mode, "k_sigma": error.k_sigma, "sigma_z_m": [float(sz.min()), float(sz.max())],
            "sigma_xy_m": [float(sxy.min()), float(sxy.max())]}
    return {"sigma_z_m": sz, "sigma_xy_m": sxy, "record": rec}


def prepare_horizon(
    h: HorizonProfile, error: TerrainErrorSettings, models_terrain: bool, provider=None
) -> tuple[HorizonProfile, dict]:
    """Make a provider horizon safe for the visibility maths and apply the terrain-error widening.

    Non-finite elevations (azimuths without terrain data) take the smooth-sphere dip for the observer
    height; brackets are clipped to contain the nominal; when the horizon models terrain and the error
    model is enabled, `visibility.widen_horizon` widens the bracket with the budget of `terrain_budget` (per azimuth in
    `product` mode, which needs the `provider` that produced `h`). Returns the horizon and a report
    (`n_nodata_azimuths`, `widened`, and `budget`: the record of the budget applied).
    """
    elev = np.asarray(h.elev_deg, dtype=np.float64)
    dip = -sphere_horizon_dip_deg(h.site.mast_height_m)
    bad = ~np.isfinite(elev)
    elev = np.where(bad, dip, elev)
    lo = np.asarray(h.elev_lo_deg, dtype=np.float64)
    hi = np.asarray(h.elev_hi_deg, dtype=np.float64)
    lo = np.minimum(np.where(np.isfinite(lo), lo, elev), elev)
    hi = np.maximum(np.where(np.isfinite(hi), hi, elev), elev)
    dist = np.asarray(h.blocker_dist_m, dtype=np.float64)
    dist = np.where(np.isfinite(dist) & (dist > 0.0), dist, NODATA_BLOCKER_DIST_M)
    out = replace(h, elev_deg=elev, elev_lo_deg=lo, elev_hi_deg=hi, blocker_dist_m=dist)
    widened = bool(models_terrain and error.enabled)
    report = {"n_nodata_azimuths": int(bad.sum()), "widened": widened}
    if widened:
        b = terrain_budget(h, error, provider)
        out = widen_horizon(out, TerrainErrorModel(b["sigma_z_m"], b["sigma_xy_m"]), error.k_sigma)
        report["budget"] = b["record"]
    return out, report


@dataclass(frozen=True, slots=True)
class SiteSignals:
    """Signals of one site on the table epochs `et` (all arrays share its length)."""

    et: np.ndarray
    array_horizon: HorizonProfile
    antenna_horizon: HorizonProfile
    sun_az_deg: np.ndarray
    sun_el_deg: np.ndarray
    sun_range_km: np.ndarray
    sun_ang_radius_deg: np.ndarray
    eclipse: np.ndarray
    """Fraction of the solar disc hidden by the Earth (0..1; geometric obscuration proxy)."""
    terrain_flux: BoundedSignal
    """Limb-darkened flux fraction of the disc above the terrain (no eclipse)."""
    sunlight: BoundedSignal
    """`terrain_flux * (1 - eclipse)`: the flux fraction that reaches the array."""
    earth_az_deg: np.ndarray
    earth_el_deg: np.ndarray
    earth_range_km: np.ndarray
    contact: BoundedSignal
    """Clearance (deg) of the best usable station, or of the Earth centre without a network."""
    station_clearance: dict[str, BoundedSignal]
    station_range_km: dict[str, np.ndarray]
    station_az_deg: dict[str, np.ndarray]
    station_dir_el_deg: dict[str, np.ndarray]
    """Elevation of each station direction above the lander's local horizontal."""
    station_el_deg: dict[str, np.ndarray]
    """Elevation of the site above each station's horizon (compare with its mask)."""
    station_mask_deg: dict[str, float]
    link_margin_db: np.ndarray | None
    """Best downlink margin over the stations in nominal contact (NaN outside contact), or None."""
    horizon_reports: dict[str, dict]


def _bracket(nom: np.ndarray, opt: np.ndarray, pess: np.ndarray) -> BoundedSignal:
    return BoundedSignal(nom, np.maximum(opt, nom), np.minimum(pess, nom))


def _flux_worlds(sun_az, sun_el, sun_rad, horizon: HorizonProfile, limb: LimbDarkening | None) -> BoundedSignal:
    grids = [horizon_grid(horizon, b) for b in WORLDS]

    def flux(grid: np.ndarray) -> np.ndarray:
        with thread_budget(np.size(sun_az), DISC_ITEMS_PER_THREAD):
            return disc_fraction(sun_az, sun_el, sun_rad, grid, limb)[1]

    nom = flux(grids[0])
    out = [nom]
    for g, prev in ((grids[1], grids[0]), (grids[2], grids[0])):
        out.append(nom if np.array_equal(g, prev) else flux(g))
    return _bracket(*out)


def _link_budget(spec: LinkSpec, g_over_t: float) -> LinkBudget:
    return LinkBudget(
        eirp_dbw=spec.eirp_dbw, frequency_hz=spec.frequency_hz, g_over_t_dbk=g_over_t,
        required_ebn0_db=spec.required_ebn0_db, data_rate_bps=spec.data_rate_bps,
        losses_db=spec.losses_db, implementation_loss_db=spec.implementation_loss_db,
        required_margin_db=spec.required_margin_db)


def _station_gt(spec: LinkSpec, st: NetworkStation | None) -> float:
    gt = st.g_over_t_dbk if st is not None and st.g_over_t_dbk is not None else spec.default_g_over_t_dbk
    if gt is None:
        who = f"station {st.id!r}" if st is not None else "the geometric Earth link"
        raise ValueError(f"no G/T for {who}: set the station's g_over_t_dbk or LinkSpec.default_g_over_t_dbk")
    return float(gt)


def compute_signals(
    table: BodyFixedEphemeris, array_horizon: HorizonProfile, antenna_horizon: HorizonProfile,
    profile: LanderProfile, network: Network, constraints: Constraints, eclipse: EclipseSettings,
    *, limb: LimbDarkening | None = None, horizon_reports: dict[str, dict] | None = None,
) -> SiteSignals:
    """Evaluate every signal on `table.et`. The table must contain the network's stations.

    The horizons must be prepared (`prepare_horizon`). The link margin is computed when the profile has
    a `LinkSpec`.
    """
    ah, nh = array_horizon, antenna_horizon
    sun = sun_track(ah.site, ah.ground_height_m, table)
    flux = _flux_worlds(sun.az_deg, sun.el_deg, sun.ang_radius_deg, ah, limb)
    ecl = np.asarray(earth_eclipse_fraction(
        ah.site, ah.ground_height_m, table, shadow=eclipse.shadow, earth_radius_km=eclipse.earth_radius_km,
        atmosphere_km=eclipse.atmosphere_km), dtype=np.float64)
    sunlight = BoundedSignal(*(f * (1.0 - ecl) for f in (flux.nominal, flux.optimistic, flux.pessimistic)))

    earth = earth_track(nh.site, nh.ground_height_m, table)
    margin = constraints.antenna_terrain_margin_deg.value
    st_clear: dict[str, BoundedSignal] = {}
    st_range: dict[str, np.ndarray] = {}
    st_az: dict[str, np.ndarray] = {}
    st_el: dict[str, np.ndarray] = {}
    st_dir_el: dict[str, np.ndarray] = {}
    st_mask: dict[str, float] = {}
    link_samples: list[np.ndarray] = []
    for gs, spec in zip(network_ground_stations(network), network.stations):
        tr = station_track(nh.site, nh.ground_height_m, table, gs)
        ctr = CommsTrack(gs.name, tr.az_deg, tr.el_deg, tr.station_el_deg, gs.min_elevation_deg)
        sig = _bracket(*(station_signal(ctr, horizon_grid(nh, b), margin) for b in WORLDS))
        st_clear[gs.name], st_range[gs.name], st_az[gs.name] = sig, tr.range_km, tr.az_deg
        st_el[gs.name], st_mask[gs.name] = tr.station_el_deg, gs.min_elevation_deg
        st_dir_el[gs.name] = tr.el_deg
        if profile.link is not None:
            m = evaluate_link(_link_budget(profile.link, _station_gt(profile.link, spec)), tr.range_km).margin_db
            link_samples.append(np.where(sig.nominal > 0.0, m, np.nan))
    if st_clear:
        contact = _bracket(*(np.maximum.reduce([getattr(c, b) for c in st_clear.values()]) for b in WORLDS))
    else:
        pc = point_clearance_bounds(earth.az_deg, earth.el_deg, nh, margin)
        contact = _bracket(pc.nominal, pc.optimistic, pc.pessimistic)
        if profile.link is not None:
            m = evaluate_link(_link_budget(profile.link, _station_gt(profile.link, None)), earth.range_km).margin_db
            link_samples.append(np.where(contact.nominal > 0.0, m, np.nan))
    link = np.fmax.reduce(link_samples) if link_samples else None
    return SiteSignals(
        et=np.asarray(table.et, dtype=np.float64), array_horizon=ah, antenna_horizon=nh,
        sun_az_deg=sun.az_deg, sun_el_deg=sun.el_deg, sun_range_km=sun.range_km,
        sun_ang_radius_deg=sun.ang_radius_deg, eclipse=ecl, terrain_flux=flux, sunlight=sunlight,
        earth_az_deg=earth.az_deg, earth_el_deg=earth.el_deg, earth_range_km=earth.range_km, contact=contact,
        station_clearance=st_clear, station_range_km=st_range, station_az_deg=st_az, station_dir_el_deg=st_dir_el, station_el_deg=st_el, station_mask_deg=st_mask,
        link_margin_db=link,
        horizon_reports=horizon_reports or {})


@dataclass(frozen=True, slots=True)
class PowerSignals:
    """Array power (W) per world and the heading analysis that produced it.

    A *case* (world) combines two independent bounds: the **horizon bound** (terrain-error widening) and the
    **heading bound** (the lander heading is unknown or uncertain). `power_w`: nominal = the stated heading on the nominal
    horizon (heading unknown: the mean over all evaluated headings, which is not an expected outcome);
    optimistic = the best heading at each instant on the lower horizon; pessimistic = the worst heading at each instant on
    the upper horizon (envelopes over headings: no single constant heading achieves either). `heading_only` moves the heading with the horizon fixed at nominal; `horizon_only` moves the horizon with
    the heading fixed at nominal; comparing their results with the full bound says which of the two moved a quantity."""

    power_w: BoundedSignal
    yaw_deg: np.ndarray
    mean_w: np.ndarray
    """Mean over the yaw envelope on the nominal horizon (for reporting)."""
    heading_known: bool
    heading_depends: bool
    """Power differs between headings at some instant (False for a heading-independent array, e.g. a single top deck)."""
    heading_only: BoundedSignal
    horizon_only: BoundedSignal
    yaw_power_w: np.ndarray
    """Power per evaluated heading on the nominal horizon, shape (n_yaw, n_t); each row is one physical constant heading."""
    power_at_yaw: Callable[[float], np.ndarray]
    """Power (W) at any single constant heading (degrees) on the nominal horizon; used to refine heading boundaries."""

    @property
    def verdict_power_w(self) -> BoundedSignal:
        """Power the verdict arithmetic uses. A stated heading (or a heading-independent array): `power_w`. Unknown heading:
        the nominal slot holds the upper bound over headings (an envelope no single heading achieves), so a constraint FAILS only when no heading passes, passes when every
        heading passes (pessimistic = worst heading, upper horizon) and is Marginal ("depends on heading") between. The
        reported nominal series stays the mean over headings and is flagged as not an expected outcome."""
        if self.heading_known or not self.heading_depends:
            return self.power_w
        p = self.power_w
        return BoundedSignal(p.optimistic, p.optimistic, p.pessimistic)


def array_power(sig: SiteSignals, profile: LanderProfile) -> PowerSignals:
    """Electrical array power over the yaw envelope of the profile's attitude (see `PowerSignals`)."""
    panels = [Panel(normal_body=p.normal_body, area_m2=p.area_m2, efficiency=p.efficiency, tracking=p.tracking)
              for p in profile.panels]
    att = profile.attitude
    yaws = att.yaws()

    def env(flux: np.ndarray):
        return power_over_yaws(sig.sun_az_deg, sig.sun_el_deg, sig.sun_range_km, flux, yaws, att.tilt_deg,
                               att.tilt_az_deg, panels, sig.eclipse)

    def at_heading(yaw: float) -> np.ndarray:
        return power_over_yaws(sig.sun_az_deg, sig.sun_el_deg, sig.sun_range_km, sig.terrain_flux.nominal,
                               np.array([yaw], dtype=float), att.tilt_deg, att.tilt_az_deg, panels, sig.eclipse).power_w[0]

    nom_env = env(sig.terrain_flux.nominal)
    same_opt = np.array_equal(sig.terrain_flux.optimistic, sig.terrain_flux.nominal)
    same_pess = np.array_equal(sig.terrain_flux.pessimistic, sig.terrain_flux.nominal)
    env_o = nom_env if same_opt else env(sig.terrain_flux.optimistic)
    env_p = nom_env if same_pess else env(sig.terrain_flux.pessimistic)
    if att.yaw_deg is None:
        nominal, at_o, at_p = nom_env.mean, env_o.mean, env_p.mean
    else:
        def at(flux):
            return array_power_w(sig.sun_az_deg, sig.sun_el_deg, sig.sun_range_km, flux,
                                 Attitude(att.yaw_deg, att.tilt_deg, att.tilt_az_deg), panels, sig.eclipse)
        nominal = at(sig.terrain_flux.nominal)
        at_o = nominal if same_opt else at(sig.terrain_flux.optimistic)
        at_p = nominal if same_pess else at(sig.terrain_flux.pessimistic)
    full = BoundedSignal(nominal, np.maximum(env_o.best, nominal), np.minimum(env_p.worst, nominal))
    heading_only = BoundedSignal(nominal, np.maximum(nom_env.best, nominal), np.minimum(nom_env.worst, nominal))
    horizon_only = BoundedSignal(nominal, np.maximum(at_o, nominal), np.minimum(at_p, nominal))
    spread = nom_env.best - nom_env.worst
    depends = bool(np.max(spread) > 1e-9 * max(float(np.max(nom_env.best)), 1.0))
    return PowerSignals(full, nom_env.yaw_deg, nom_env.mean, att.yaw_deg is not None, depends, heading_only, horizon_only,
                        nom_env.power_w, at_heading)
