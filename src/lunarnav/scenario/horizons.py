"""Horizon seam: analyses ask a `HorizonProvider` for the horizon of a `Site` (observer height in
`site.mast_height_m`) and never touch terrain themselves.

- `SmoothSphereProvider`: analytic horizon dip of an observer at height h above the reference
  sphere, `-acos(R / (R + h))` at every azimuth. This is a legitimate "no terrain" baseline,
  comparable to point-geometry tools such as JPL Horizons; its lo/hi brackets coincide with the
  nominal horizon (the model has no terrain error), and it reports no terrain hashes.
- `TerrainProvider`: delegates to `lunarnav.horizon` (imported lazily, so the scenario layer works
  without terrain data) and caches profiles by site, observer height and parameters.
"""

from __future__ import annotations

import math
from collections import OrderedDict
from collections.abc import Sequence
from dataclasses import replace
from typing import Any, Protocol, runtime_checkable

import numpy as np

from lunarnav.constants import DEFAULT_HORIZON_AZIMUTHS, R_MOON_M
from lunarnav.types import HorizonProfile, Site

MIN_BLOCKER_DIST_M = 1.0
"""Floor for `blocker_dist_m` of the smooth sphere (the terrain-error maths needs d > 0)."""


def observer_sites(lat_deg: float, lon_deg: float, profile, name: str | None = None) -> list[Site]:
    """The observers whose horizons one site needs: array, antenna and, when the profile carries an antenna
    height range, the antenna at its maximum height (the optimistic Earth-link observer).
    `fold_observers` turns the matching horizons into the (array, antenna) pair."""
    sites = [Site(lat_deg, lon_deg, profile.array_height_m, name), Site(lat_deg, lon_deg, profile.antenna_height_m, name)]
    top = profile.antenna_height_max_m
    if top is not None and top > profile.antenna_height_m:
        sites.append(Site(lat_deg, lon_deg, top, name))
    return sites


def observers_per_site(profile) -> int:
    """Number of horizons `observer_sites` returns for this profile (2 or 3)."""
    top = profile.antenna_height_max_m
    return 3 if top is not None and top > profile.antenna_height_m else 2


def fold_observers(group: Sequence[HorizonProfile]) -> tuple[HorizonProfile, HorizonProfile]:
    """(array horizon, antenna horizon) from one site's `observer_sites` horizons.

    With a third horizon (antenna at its maximum height) the antenna horizon's optimistic bracket is the lower of
    its own and the tall antenna's: a higher antenna sees over more terrain and has a larger dip. The nominal and
    pessimistic horizons stay those of the conservative `antenna_height_m`. The range is recorded in provenance.
    """
    if len(group) == 2:
        return group[0], group[1]
    if len(group) != 3:
        raise ValueError("a site has two or three observer horizons")
    ah, nh, tall = group
    lo = np.minimum(nh.elev_lo_deg, tall.elev_lo_deg)
    prov = {**nh.provenance, "antenna_height_range_m": [nh.site.mast_height_m, tall.site.mast_height_m],
            "antenna_height_range_note": "optimistic Earth-link horizon evaluated at the maximum antenna height"}
    return ah, replace(nh, elev_lo_deg=lo, provenance=prov)


@runtime_checkable
class HorizonProvider(Protocol):
    """Source of horizons. `site.mast_height_m` is the observer height above local ground."""

    name: str
    models_terrain: bool
    """True when the horizons come from terrain, so terrain-error widening and slopes apply."""

    def horizon(self, site: Site) -> HorizonProfile: ...

    def horizons(self, sites: Sequence[Site]) -> list[HorizonProfile]:
        """Batch form: same order as `sites`; providers may compute them in parallel."""
        ...

    def provenance(self) -> dict[str, Any]:
        """JSON-serialisable description (model, terrain hashes) for the provenance block."""
        ...

    def slope_deg(self, lat_deg: float, lon_deg: float, baseline_m: float) -> float | None:
        """Terrain slope over `baseline_m` at a point, or None when the provider has no terrain."""
        ...

    def blocker_point(self, profile: HorizonProfile, az_deg: float) -> dict[str, float] | None:
        """Latitude, longitude, height and distance of the terrain sample that sets the horizon at
        `az_deg`, or None when the provider has no terrain."""
        ...


def sphere_horizon_dip_deg(observer_height_m: float) -> float:
    """Depression of the smooth-sphere horizon below the local horizontal, degrees: acos(R / (R + h))."""
    if observer_height_m < 0.0:
        raise ValueError("observer height must be non-negative")
    return math.degrees(math.acos(R_MOON_M / (R_MOON_M + observer_height_m)))


class SmoothSphereProvider:
    """Analytic no-terrain horizon on the reference sphere (see module doc)."""

    name = "smooth_sphere"
    models_terrain = False

    def __init__(self, n_az: int = DEFAULT_HORIZON_AZIMUTHS) -> None:
        if n_az < 4:
            raise ValueError("n_az must be at least 4")
        self.n_az = int(n_az)

    def horizon(self, site: Site) -> HorizonProfile:
        h = site.mast_height_m
        dip = -sphere_horizon_dip_deg(h)
        az = np.arange(self.n_az) * (360.0 / self.n_az)
        elev = np.full(self.n_az, dip)
        dist = max(R_MOON_M * math.acos(R_MOON_M / (R_MOON_M + h)), MIN_BLOCKER_DIST_M)
        return HorizonProfile(
            site=site, ground_height_m=0.0, az_deg=az, elev_deg=elev, elev_lo_deg=elev.copy(),
            elev_hi_deg=elev.copy(), blocker_dist_m=np.full(self.n_az, dist),
            provenance={"model": "smooth_sphere", "radius_m": R_MOON_M, "observer_height_m": h})

    def horizons(self, sites: Sequence[Site]) -> list[HorizonProfile]:
        return [self.horizon(s) for s in sites]

    def provenance(self) -> dict[str, Any]:
        return {"provider": self.name, "model": "analytic horizon dip acos(R/(R+h))",
                "radius_m": R_MOON_M, "n_az": self.n_az, "terrain": None}

    def slope_deg(self, lat_deg: float, lon_deg: float, baseline_m: float) -> float | None:
        return None

    def blocker_point(self, profile: HorizonProfile, az_deg: float) -> dict[str, float] | None:
        return None

    def error_budget(self, profile: HorizonProfile) -> dict[str, np.ndarray] | None:
        return None

    def error_table(self) -> list[dict] | None:
        return None


class TerrainProvider:
    """Terrain horizons from `lunarnav.horizon.compute_horizon(s)` with an LRU cache.

    `stack` is a `lunarnav.terrain.TerrainStack`, handed to the horizon engine; slopes use
    `lunarnav.terrain.derivatives.slope_at` on it and blocker coordinates `lunarnav.horizon.blocker_point`.
    `horizon_kwargs` (for example `max_range_km`) are forwarded to the horizon engine verbatim.
    """

    name = "terrain"
    models_terrain = True

    def __init__(
        self, stack: Any, *, n_az: int = DEFAULT_HORIZON_AZIMUTHS, cache_size: int = 256,
        **horizon_kwargs: Any,
    ) -> None:
        self.stack = stack
        self.n_az = int(n_az)
        self.horizon_kwargs = dict(horizon_kwargs)
        self._cache: OrderedDict[tuple, HorizonProfile] = OrderedDict()
        self._cache_size = int(cache_size)
        self.hits = 0
        self.misses = 0

    @staticmethod
    def _engine():
        """Import the horizon engine on first use."""
        import importlib

        return importlib.import_module("lunarnav.horizon")

    def _key(self, site: Site) -> tuple:
        return (round(site.lat_deg, 9), round(site.lon_deg, 9), round(site.mast_height_m, 6), self.n_az,
                tuple(sorted(self.horizon_kwargs.items())))

    def _store(self, key: tuple, profile: HorizonProfile) -> None:
        self._cache[key] = profile
        self._cache.move_to_end(key)
        while len(self._cache) > self._cache_size:
            self._cache.popitem(last=False)

    def horizon(self, site: Site) -> HorizonProfile:
        key = self._key(site)
        if key in self._cache:
            self.hits += 1
            self._cache.move_to_end(key)
            return self._cache[key]
        self.misses += 1
        profile = self._engine().compute_horizon(site, self.stack, n_az=self.n_az, **self.horizon_kwargs)
        self._store(key, profile)
        return profile

    def horizons(self, sites: Sequence[Site]) -> list[HorizonProfile]:
        keys = [self._key(s) for s in sites]
        missing: dict[tuple, Site] = {}
        for k, s in zip(keys, sites):
            if k not in self._cache and k not in missing:
                missing[k] = s
        self.hits += sum(1 for k in keys if k in self._cache)
        if missing:
            self.misses += len(missing)
            computed = self._engine().compute_horizons(
                list(missing.values()), self.stack, n_az=self.n_az, **self.horizon_kwargs)
            for k, p in zip(missing, computed):
                self._store(k, p)
        return [self._cache[k] if k in self._cache else self.horizon(s) for k, s in zip(keys, sites)]

    def provenance(self) -> dict[str, Any]:
        stack = self.stack
        return {"provider": self.name, "n_az": self.n_az, "horizon_kwargs": dict(self.horizon_kwargs),
                "terrain": {"stack_hash": getattr(stack, "stack_hash", None),
                            "dem_ids": list(getattr(stack, "dem_ids", ()))}}

    def slope_deg(self, lat_deg: float, lon_deg: float, baseline_m: float) -> float | None:
        """Slope from `lunarnav.terrain.derivatives.slope_at`; None outside the data."""
        import importlib

        value = importlib.import_module("lunarnav.terrain.derivatives").slope_at(
            self.stack, lat_deg, lon_deg, baseline_m)["slope_deg"]
        return None if not math.isfinite(value) else float(value)

    def blocker_point(self, profile: HorizonProfile, az_deg: float) -> dict[str, float] | None:
        return self._engine().blocker_point(profile, self.stack, az_deg)

    def error_budget(self, profile: HorizonProfile) -> dict[str, np.ndarray] | None:
        """Per-azimuth 1-sigma budget (`sigma_z_m`, `sigma_xy_m`, `store_index`) of the store that supplies the height at
        the limiting blocker of each azimuth (`blocker_points` then `TerrainStack.error_at`). Azimuths without a
        blocker take the stack's assumed global budget (`store_index` -1)."""
        pts = self._engine().blocker_points(profile, self.stack)
        ok = np.isfinite(pts["lat_deg"])
        n = len(ok)
        sz, sxy, si = np.empty(n), np.empty(n), np.full(n, -1, dtype=np.int64)
        if ok.any():
            sz[ok], sxy[ok], si[ok] = self.stack.error_at(pts["lat_deg"][ok], pts["lon_deg"][ok])
        if not ok.all():
            sz[~ok], sxy[~ok], _ = self.stack.error_at(np.array([np.nan]), np.array([np.nan]))
        return {"sigma_z_m": sz, "sigma_xy_m": sxy, "store_index": si}

    def error_table(self) -> list[dict] | None:
        """One row per store of the stack: id, sigmas, `basis` (`published` / `assumed`), source."""
        return self.stack.error_table()
