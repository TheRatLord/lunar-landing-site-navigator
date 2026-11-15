"""Inverse search: which places in a region satisfy the constraints, and with what margin?

Input: a scenario (profile, constraints, network, terrain-error settings), a search region (centre and
radius, or a polygon), a final lattice spacing and one landing epoch or a range of epochs. Output: ranked
sites with their margins and limiting constraint, plus the gridded score layer.

Method (coarse to fine on a nested lattice; the lattice is anchored at the region centre, spacing
`final_spacing_m * 2**k`):

0. Exact filters, applied to every point before any horizon is computed: the terrain slope at the point (and
   the optional roughness limit) against its limit, and terrain coverage. At coarse levels the slope limit is
   relaxed by `slope_prune_factor` because a coarse point's slope is only a sample of its cell.
1. Coarse levels (`coarse_factor`, `coarse_factor / 2`, ... final spacing * 2): the scenario without the
   slope constraint is evaluated with a *cheap horizon* (fewer azimuths, truncated range) and every point is
   scored by its optimistic-world normalised margin (best over the landing epochs; `prune_world="nominal"` uses the nominal world: faster, lower recall). A point is promoted if its
   score is at least `-slack` (default 0.5 margin scales) or it is among the best `min_promote`, capped by
   `max_promoted` (the cap is reported when it bites). Promoted points refine to the 3 x 3 lattice points of
   the next level around them.
2. The final level evaluates the refined points with the full provider (the same horizons, widening and
   verdict rule as `evaluate_scenario`; a ranked site equals the full evaluation of the scenario moved to it,
   tested).

Rigour. Steps 0 (slope, at the final level) and 2 are exact. Step 1 is a heuristic: a truncated-range or
low-azimuth horizon is a lower bound only in range (farther terrain can only raise it), not between
azimuth samples, and the score field is spatially rough at pole-like illumination scales, so promotion is a
statistical guess with a stated slack, not a bound. `exhaustive=True` evaluates every final lattice point with
the full provider and is the reference; `recall` measures what a pruned search found of it. Recall on real
terrain is reported in docs/validation/scenario.md.

Complexity. With A the region area, s the final spacing and K = `coarse_factor`: exhaustive cost is
`(A / s^2) * (t_h + t_v)` with t_h the full horizon time per point (about 40 ms at 20 m / 720 azimuths on the
polar store, measured) and t_v the verdict time (about 2-6 ms). The pruned search costs
`(A / (K s)^2) * t_cheap + sum over refinement levels of (9 * promoted_l) * t_cheap + 9 * promoted_final * (t_h + t_v)`,
independent of A at the final level once the promoted count is bounded by `max_promoted`.
"""

from __future__ import annotations

import math
import time
from collections.abc import Callable
from dataclasses import dataclass, field

import numpy as np

from lunarnav.constants import R_MOON_M
from lunarnav.ephem import et_to_utc

from .engine import (
    FAIL,
    MARGINAL,
    PASS,
    RANK_BY,
    STATE_NAMES,
    has_no_nominal_margin,
    margin_kind,
    margin_note,
    rank_key,
)
from .horizons import HorizonProvider, SmoothSphereProvider, TerrainProvider
from .models import Scenario
from .multisite import (
    PointResults,
    destination_arrays,
    evaluate_points,
    landing_epochs,
    points_table,
    terrain_hazards,
    wrap_lon,
)
from .progress import scaled_progress
from .provenance import (
    OUR_DEFINITIONS,
    check_terrain_stack,
    engine_blocks,
    scenario_hash,
    terrain_stack_record,
)

STATUS_OUTSIDE, STATUS_NOT_EVALUATED, STATUS_SLOPE_PRUNED, STATUS_COARSE, STATUS_FULL = 0, 1, 2, 3, 4
STATUS_TEXT = {0: "outside region", 1: "not evaluated (pruned at a coarse level)", 2: "pruned by the slope/roughness limit",
               3: "evaluated with the cheap horizon only", 4: "evaluated with the full horizon"}
NO_DATA = -3
"""State code of lattice points without a final verdict in `SearchGrid.state`."""


@dataclass(frozen=True, slots=True)
class SearchRegion:
    """Search area: a disc (`radius_m` around `lat_deg`, `lon_deg`) or a polygon of (lat, lon) vertices.

    With a polygon the lattice is anchored at `lat_deg`, `lon_deg` (which should lie inside it) and
    `radius_m` is ignored; the polygon is evaluated in the azimuthal-equidistant plane about that anchor.
    """

    lat_deg: float
    lon_deg: float
    radius_m: float = 0.0
    polygon: tuple[tuple[float, float], ...] | None = None

    def extent_m(self) -> float:
        """Half-width of the bounding square about the anchor."""
        if self.polygon is None:
            return float(self.radius_m)
        e, n = offsets_from_anchor(self.lat_deg, self.lon_deg, np.array([p[0] for p in self.polygon]),
                                   np.array([p[1] for p in self.polygon]))
        return float(max(np.abs(e).max(), np.abs(n).max()))


def offsets_from_anchor(lat0: float, lon0: float, lat: np.ndarray, lon: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Azimuthal-equidistant (east, north) offsets in metres of points about an anchor (inverse of `destination_arrays`)."""
    la0, lo0 = math.radians(lat0), math.radians(lon0)
    la, lo = np.radians(lat), np.radians(lon)
    dlo = lo - lo0
    cosc = np.clip(np.sin(la0) * np.sin(la) + np.cos(la0) * np.cos(la) * np.cos(dlo), -1.0, 1.0)
    c = np.arccos(cosc)
    az = np.arctan2(np.sin(dlo) * np.cos(la), np.cos(la0) * np.sin(la) - np.sin(la0) * np.cos(la) * np.cos(dlo))
    return c * R_MOON_M * np.sin(az), c * R_MOON_M * np.cos(az)


def _in_polygon(x: np.ndarray, y: np.ndarray, px: np.ndarray, py: np.ndarray) -> np.ndarray:
    """Even-odd ray casting."""
    inside = np.zeros(x.shape, dtype=bool)
    j = len(px) - 1
    for i in range(len(px)):
        cond = (py[i] > y) != (py[j] > y)
        with np.errstate(divide="ignore", invalid="ignore"):
            xint = (px[j] - px[i]) * (y - py[i]) / (py[j] - py[i]) + px[i]
        inside ^= cond & (x < xint)
        j = i
    return inside


@dataclass(frozen=True, slots=True)
class LevelReport:
    """What one refinement level did."""

    spacing_m: float
    n_candidates: int
    n_slope_pruned: int
    n_evaluated: int
    n_promoted: int
    horizon: str
    seconds: float
    capped: bool


@dataclass(frozen=True, slots=True)
class RankedSite:
    """A final-level site and its verdict at its best landing epoch."""

    rank: int
    lat_deg: float
    lon_deg: float
    east_m: float
    north_m: float
    state: str
    worst_margin: float
    """Normalised margin of the limiting constraint (margin / its `margin_scale`)."""
    limiting: str | None
    landing_utc: str
    n_epochs_pass: int
    n_epochs: int
    slope_deg: float | None
    roughness_m: float | None
    values: dict[str, float | None]
    """Nominal constraint values at the best epoch; None for `min_state_of_charge` when the lander heading is unknown (no outcome at one heading)."""
    constraint_state: dict[str, str]
    margin_kind: str | None = None
    """`worst_case`, `nominal` (a failing site reports the nominal margin) or `best_case` (a failing site limited by the minimum state of
    charge with an unknown heading: the margin at the upper bound over headings, which no single heading achieves); see `engine.margin_kind`. With `rank_by="margin"` sites are ranked by state
    first and then by this margin as it is, so a `best_case` margin is compared with the nominal margins of the others."""
    margin_note: str | None = None
    """The sentence that goes with `margin_kind` where it needs one (`engine.BEST_CASE_NOTE`)."""
    totals: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {f: getattr(self, f) for f in self.__slots__}


@dataclass(frozen=True, slots=True)
class SearchGrid:
    """The final lattice. Arrays are `(ny, nx)`; `score` is the normalised margin at the best epoch (NaN where
    not evaluated with the full horizon), `state` the overall state (`NO_DATA` where not evaluated), `status`
    one of `STATUS_TEXT`, `coarse_score` the optimistic cheap-horizon score where it was computed."""

    east_m: np.ndarray
    north_m: np.ndarray
    lat_deg: np.ndarray
    lon_deg: np.ndarray
    score: np.ndarray
    state: np.ndarray
    status: np.ndarray
    coarse_score: np.ndarray
    slope_deg: np.ndarray
    rank_value: np.ndarray | None = None
    best_epoch: np.ndarray | None = None
    n_epochs_pass: np.ndarray | None = None
    epochs_utc: tuple[str, ...] = ()

    def to_dict(self) -> dict:
        def clean(a):
            return np.where(np.isfinite(a), a, None).tolist()
        return {"east_m": self.east_m.tolist(), "north_m": self.north_m.tolist(), "score": clean(self.score),
                "state": self.state.tolist(), "status": self.status.tolist(), "coarse_score": clean(self.coarse_score),
                "slope_deg": clean(self.slope_deg), "status_text": STATUS_TEXT,
                "rank_value": None if self.rank_value is None else clean(self.rank_value),
                "best_epoch": None if self.best_epoch is None else self.best_epoch.tolist(),
                "n_epochs_pass": None if self.n_epochs_pass is None else self.n_epochs_pass.tolist(),
                "epochs_utc": list(self.epochs_utc)}


@dataclass(frozen=True, slots=True)
class SearchResult:
    """Ranked sites, the score layer and the cost accounting of a search."""

    sites: tuple[RankedSite, ...]
    grid: SearchGrid
    levels: tuple[LevelReport, ...]
    counts: dict[str, int]
    settings: dict
    seconds: float
    n_full_evaluations: int
    n_exhaustive_equivalent: int
    provenance: dict = field(default_factory=dict)

    def to_dict(self, *, with_grid: bool = True) -> dict:
        out = {"sites": [s.to_dict() for s in self.sites], "levels": [{f: getattr(lv, f) for f in lv.__slots__} for lv in self.levels],
               "counts": self.counts, "settings": self.settings, "seconds": self.seconds,
               "n_full_evaluations": self.n_full_evaluations, "n_exhaustive_equivalent": self.n_exhaustive_equivalent,
               "provenance": self.provenance}
        if with_grid:
            out["grid"] = self.grid.to_dict()
        return out


def _cheap_provider(provider: HorizonProvider, n_az: int, max_range_km: float | None) -> HorizonProvider:
    if isinstance(provider, TerrainProvider):
        kwargs = dict(provider.horizon_kwargs)
        if max_range_km is not None:
            kwargs["max_range_km"] = max_range_km
        return TerrainProvider(provider.stack, n_az=n_az, cache_size=2048, **kwargs)
    return provider


def _best_key(pr: PointResults, rank_by: str = "margin") -> tuple[np.ndarray, np.ndarray]:
    """(index of the best epoch per point, ranking key per point)."""
    key = rank_key(pr.state, pr.worst_margin, pr.totals, rank_by)
    k = np.argmax(key, axis=1)
    return k, key[np.arange(key.shape[0]), k]


def _without_slope(scenario: Scenario) -> Scenario:
    if scenario.constraints.max_slope_deg is None:
        return scenario
    return scenario.model_copy(update={"constraints": scenario.constraints.model_copy(update={"max_slope_deg": None})})


def _lattice_mask(region: SearchRegion, ii: np.ndarray, jj: np.ndarray, s: float) -> np.ndarray:
    x, y = ii * s, jj * s
    if region.polygon is None:
        return np.hypot(x, y) <= region.radius_m + 1e-9
    px, py = offsets_from_anchor(region.lat_deg, region.lon_deg, np.array([p[0] for p in region.polygon]),
                                 np.array([p[1] for p in region.polygon]))
    return _in_polygon(x, y, px, py)


def search_sites(
    scenario: Scenario, provider: HorizonProvider | None, region: SearchRegion, *, final_spacing_m: float,
    first_utc: str | None = None, last_utc: str | None = None, epoch_spacing_h: float | None = None,
    coarse_factor: int = 8, slack: float = 0.5, min_promote: int = 8, max_promoted: int = 4000,
    cheap_n_az: int = 72, cheap_range_km: float | None = 20.0, slope_prune_factor: float = 2.0,
    hazard_roughness_m: float | None = None, top_k: int = 20, min_separation_m: float | None = None,
    exhaustive: bool = False, table=None, prune_world: str = "optimistic",
    progress: Callable[[float, str], None] | None = None, rank_by: str = "margin", promote_fraction: float = 0.25,
) -> SearchResult:
    """Search `region` for sites satisfying the scenario's constraints (see module doc).

    Epochs: the scenario's landing epoch, or `first_utc..last_utc` every `epoch_spacing_h` hours; each site is
    scored at its best epoch. `coarse_factor` must be a power of two (1 = no pruning levels, all points full).
    `exhaustive=True` evaluates the whole final lattice with the full provider. `min_separation_m` (default
    3 final spacings) suppresses ranked sites closer than that to a better one. The scenario's own site is
    ignored: the region defines where sites are. `prune_world` chooses the coarse score: `"optimistic"` (default; the margin of the optimistic horizon
    world, which the terrain-error widening makes permissive enough that no good site was lost in the validation
    run) or `"nominal"` (the cheap-horizon verdict itself: about 10x cheaper but measured recall 0.73 to 0.87 of the
    PASS sites, so it is only a fast preview).

    `rank_by` (`engine.RANK_BY`): `"margin"` ranks by state and then the normalised margin; a mission total (`"sunlit_h"`,
    `"contact_h"`, `"sunlit_contact_h"`) ranks by state and then the nominal hours of that total, each site at its best epoch by the
    same key. With a total, a coarse level promotes the `promote_fraction` of its points with the most hours among those within the
    slack (at least `min_promote`), because without a limit on the total every point would otherwise be promoted.

    `progress(fraction, stage)` is called at the start of each level and after every chunk of points evaluated
    (fraction 0..1: table to 0.03, coarse levels share 0.03 to 0.18, the final level 0.18 to 0.98, ranking last;
    the split is a nominal cost estimate, the fraction is monotone). An exception it raises propagates unchanged
    and no result is returned. Results are identical with or without it.
    """
    if prune_world not in ("nominal", "optimistic"):
        raise ValueError("prune_world must be 'nominal' or 'optimistic'")
    if rank_by not in RANK_BY:
        raise ValueError(f"rank_by must be one of {RANK_BY}, got {rank_by!r}")
    t_start = time.perf_counter()
    provider = provider or SmoothSphereProvider()
    check_terrain_stack(scenario, provider)
    if coarse_factor < 1 or coarse_factor & (coarse_factor - 1):
        raise ValueError("coarse_factor must be a power of two")
    s = float(final_spacing_m)
    if s <= 0.0:
        raise ValueError("final_spacing_m must be positive")
    q = landing_epochs(scenario, first_utc, last_utc, epoch_spacing_h)
    if progress is not None:
        progress(0.0, "ephemeris table")
    if table is None:
        table = points_table(scenario, q)
    cons = scenario.constraints
    slope_lim = cons.max_slope_deg.max if cons.max_slope_deg is not None else None
    stack = getattr(provider, "stack", None) if provider.models_terrain else None
    cheap = provider if exhaustive else _cheap_provider(provider, cheap_n_az, cheap_range_km)
    lat0, lon0 = region.lat_deg, float(wrap_lon(region.lon_deg))

    half = int(math.ceil(region.extent_m() / s))
    n = 2 * half + 1
    ii, jj = np.meshgrid(np.arange(-half, half + 1), np.arange(-half, half + 1), indexing="xy")
    inside = _lattice_mask(region, ii, jj, s)
    east = ii * s
    north = jj * s
    lat_g, lon_g = destination_arrays(lat0, lon0, east.ravel(), north.ravel())
    lat_g, lon_g = lat_g.reshape(n, n), lon_g.reshape(n, n)
    status = np.where(inside, STATUS_NOT_EVALUATED, STATUS_OUTSIDE).astype(np.int8)
    score = np.full((n, n), np.nan)
    state = np.full((n, n), NO_DATA, dtype=np.int16)
    coarse_score = np.full((n, n), np.nan)
    slope_g = np.full((n, n), np.nan)
    best_epoch = np.full((n, n), -1, dtype=np.int32)
    n_pass = np.full((n, n), -1, dtype=np.int32)
    rough_g = np.full((n, n), np.nan)
    rank_g = np.full((n, n), np.nan)
    by_total = rank_by != "margin"
    full = {}

    n_levels = 1 if exhaustive else int(math.log2(coarse_factor)) + 1
    steps = [2 ** (n_levels - 1 - lv) for lv in range(n_levels)]
    reports: list[LevelReport] = []
    base = _without_slope(scenario)
    cand = np.zeros((n, n), dtype=bool)
    cand[(inside) & (ii % steps[0] == 0) & (jj % steps[0] == 0)] = True
    n_full = 0
    for level, step in enumerate(steps):
        t0 = time.perf_counter()
        final = level == n_levels - 1
        lvl_lo, lvl_hi = (0.18, 0.98) if final else (0.03 + 0.15 * level / max(n_levels - 1, 1),
                                                      0.03 + 0.15 * (level + 1) / max(n_levels - 1, 1))
        if progress is not None:
            progress(lvl_lo, f"level {level + 1} of {n_levels}: spacing {step * s:g} m")
        idx = np.argwhere(cand)
        rows, cols = idx[:, 0], idx[:, 1]
        la, lo = lat_g[rows, cols], lon_g[rows, cols]
        n_cand = int(rows.size)
        pruned = 0
        keep = np.ones(rows.size, dtype=bool)
        sl = ro = None
        if stack is not None and n_cand:
            sl, ro = terrain_hazards(stack, la, lo, cons.slope_baseline_m.value)
            slope_g[rows, cols] = sl
            rough_g[rows, cols] = ro
            lim_f = 1.0 if final else slope_prune_factor
            if slope_lim is not None:
                keep &= ~(sl > slope_lim * lim_f)
            if hazard_roughness_m is not None:
                keep &= ~(ro > hazard_roughness_m * lim_f)
            pruned = int((~keep).sum())
            status[rows[~keep], cols[~keep]] = STATUS_SLOPE_PRUNED
        kr, kc = rows[keep], cols[keep]
        promoted = 0
        capped = False
        if kr.size:
            sc_eval = scenario if final else base
            pr = evaluate_points(
                sc_eval, provider if final else cheap, lat_g[kr, kc], lon_g[kr, kc], q, table=table,
                with_hazards=False, slope_deg=None if sl is None else sl[keep], roughness_m=None if ro is None else ro[keep],
                progress=scaled_progress(
                    progress, lvl_lo, lvl_hi, f"level {level + 1} of {n_levels} ({step * s:g} m): "))
            be, key = _best_key(pr, rank_by)
            ar = np.arange(kr.size)
            wm = pr.worst_margin[ar, be]
            if final:
                status[kr, kc] = STATUS_FULL
                score[kr, kc] = wm
                if by_total:
                    rank_g[kr, kc] = pr.totals[rank_by][ar, be]
                state[kr, kc] = pr.state[ar, be]
                best_epoch[kr, kc] = be
                n_pass[kr, kc] = (pr.state == PASS).sum(axis=1)
                n_full += int(kr.size)
                for a in range(kr.size):
                    full[(int(kr[a]), int(kc[a]))] = (pr, a, int(be[a]))
            else:
                status[kr, kc] = STATUS_COARSE
                opt = np.max(pr.optimistic_margin if prune_world == "optimistic" else np.where(
                    np.isfinite(pr.worst_margin), pr.worst_margin, 1.0e3), axis=1)
                coarse_score[kr, kc] = opt
                good = opt >= -slack
                if by_total:
                    hours = np.where(good, pr.totals[rank_by].max(axis=1), -1.0)
                    order = np.argsort(-hours, kind="stable")
                    keep_n = max(min_promote, int(math.ceil(promote_fraction * int(good.sum()))))
                    good = np.zeros(opt.size, dtype=bool)
                    good[order[:keep_n]] = True
                else:
                    order = np.argsort(-opt, kind="stable")
                    good[order[:min_promote]] = True
                sel = np.flatnonzero(good)
                if sel.size > max_promoted:
                    sel = order[:max_promoted]
                    capped = True
                promoted = int(sel.size)
                nxt = steps[level + 1]
                cand = np.zeros((n, n), dtype=bool)
                for dr in (-1, 0, 1):
                    for dc in (-1, 0, 1):
                        r2, c2 = kr[sel] + dr * nxt, kc[sel] + dc * nxt
                        ok = (r2 >= 0) & (r2 < n) & (c2 >= 0) & (c2 < n)
                        cand[r2[ok], c2[ok]] = True
                cand &= inside & (ii % nxt == 0) & (jj % nxt == 0)
        elif not final:
            cand = np.zeros((n, n), dtype=bool)
        label = (provider.name if final else cheap.name) + ("" if not isinstance(cheap, TerrainProvider) or final else
                                                              f" n_az={cheap.n_az} range={cheap.horizon_kwargs.get('max_range_km')}")
        reports.append(LevelReport(step * s, n_cand, pruned, int(kr.size), promoted, label, time.perf_counter() - t0, capped))

    if progress is not None:
        progress(0.98, "ranking")
    ev_rows, ev_cols = np.nonzero(status == STATUS_FULL)
    keyv = rank_key(state[ev_rows, ev_cols], score[ev_rows, ev_cols], {rank_by: rank_g[ev_rows, ev_cols]}, rank_by)
    order = np.argsort(-keyv, kind="stable")
    sep = 3.0 * s if min_separation_m is None else float(min_separation_m)
    chosen: list[int] = []
    for o in order:
        if len(chosen) >= top_k:
            break
        x, y = east[ev_rows[o], ev_cols[o]], north[ev_rows[o], ev_cols[o]]
        if all(math.hypot(x - east[ev_rows[c], ev_cols[c]], y - north[ev_rows[c], ev_cols[c]]) >= sep for c in chosen):
            chosen.append(int(o))
    sites = []
    for rank, o in enumerate(chosen, start=1):
        r, c = int(ev_rows[o]), int(ev_cols[o])
        pr, a, e = full[(r, c)]
        lim = int(pr.limiting[a, e])
        kind = margin_kind(STATE_NAMES.get(int(pr.state[a, e]), "UNKNOWN"), float(pr.worst_margin[a, e]),
                           no_nominal=has_no_nominal_margin(pr.keys[lim] if 0 <= lim < len(pr.keys) else None, pr.heading_unknown))
        sites.append(RankedSite(
            rank, float(lat_g[r, c]), float(lon_g[r, c]), float(east[r, c]), float(north[r, c]),
            STATE_NAMES.get(int(pr.state[a, e]), "UNKNOWN"), float(pr.worst_margin[a, e]),
            pr.keys[lim] if 0 <= lim < len(pr.keys) else None, et_to_utc(float(pr.landing_et[e])),
            int((pr.state[a] == PASS).sum()), int(pr.landing_et.size),
            None if pr.slope_deg is None or not math.isfinite(pr.slope_deg[a]) else float(pr.slope_deg[a]),
            None if pr.roughness_m is None or not math.isfinite(pr.roughness_m[a]) else float(pr.roughness_m[a]),
            {k: (float(v[a, e]) if math.isfinite(float(v[a, e])) else None) for k, v in pr.values.items()},
            {k: STATE_NAMES.get(int(v[a, e]), "UNKNOWN") for k, v in pr.per_constraint.items()},
            kind, margin_note(kind), {k: float(v[a, e]) for k, v in pr.totals.items()}))
    full_states = state[status == STATUS_FULL]
    counts = {"inside_region": int(inside.sum()), "evaluated_full": int(full_states.size),
              "slope_pruned": int((status == STATUS_SLOPE_PRUNED).sum()), "coarse_only": int((status == STATUS_COARSE).sum()),
              "PASS": int((full_states == PASS).sum()), "MARGINAL": int((full_states == MARGINAL).sum()),
              "FAIL": int((full_states == FAIL).sum())}
    settings = {"final_spacing_m": s, "coarse_factor": 1 if exhaustive else int(coarse_factor), "slack": slack,
                "min_promote": min_promote, "max_promoted": max_promoted, "cheap_n_az": cheap_n_az,
                "cheap_range_km": cheap_range_km, "slope_prune_factor": slope_prune_factor,
                "hazard_roughness_m": hazard_roughness_m, "exhaustive": bool(exhaustive), "n_epochs": int(q.size),
                "region": {"lat_deg": region.lat_deg, "lon_deg": region.lon_deg, "radius_m": region.radius_m,
                          "polygon": None if region.polygon is None else [list(p) for p in region.polygon]},
                "min_separation_m": sep, "top_k": top_k, "rank_by": rank_by, "promote_fraction": promote_fraction}
    prov = {**engine_blocks(), "scenario_hash": scenario_hash(scenario), "provider": provider.provenance(),
            "our_definitions": {"roughness": OUR_DEFINITIONS["roughness"]},
            "terrain_stack": terrain_stack_record(scenario, provider),
            "heading_unknown_soc": any(p[0].heading_unknown for p in full.values()),
            "first_landing_utc": et_to_utc(float(q[0])), "last_landing_utc": et_to_utc(float(q[-1]))}
    grid = SearchGrid(east[0].copy(), north[:, 0].copy(), lat_g, lon_g, score, state, status, coarse_score, slope_g,
                      rank_g if by_total else None, best_epoch, n_pass, tuple(et_to_utc(float(t)) for t in q))
    if progress is not None:
        progress(1.0, "done")
    return SearchResult(tuple(sites), grid, tuple(reports), counts, settings, time.perf_counter() - t_start, n_full,
                        int(inside.sum()), prov)


def recall(found: SearchResult, reference: SearchResult, *, min_state: int = PASS) -> dict[str, float]:
    """How much of an exhaustive reference a pruned search found, over final-lattice points.

    Both results must share the region and final spacing. Counts the reference points with state at least
    `min_state` (default PASS) that the pruned search evaluated with the full horizon and found at least that
    good (`found_good`) or evaluated at all (`evaluated`), and compares the best margin.
    """
    if found.grid.score.shape != reference.grid.score.shape:
        raise ValueError("results must share the same lattice")
    ref_good = reference.grid.state >= min_state
    n_ref = int(ref_good.sum())
    ev = found.grid.status == STATUS_FULL
    good = found.grid.state >= min_state
    both = ref_good & good
    out = {"reference_good": float(n_ref), "found_good": float(both.sum()), "evaluated": float((ref_good & ev).sum()),
           "recall": float(both.sum() / n_ref) if n_ref else float("nan")}
    ref_best = np.nanmax(np.where(np.isfinite(reference.grid.score), reference.grid.score, -np.inf)) if np.isfinite(reference.grid.score).any() else float("nan")
    fnd_best = np.nanmax(np.where(np.isfinite(found.grid.score), found.grid.score, -np.inf)) if np.isfinite(found.grid.score).any() else float("nan")
    out["best_margin_reference"] = float(ref_best)
    out["best_margin_found"] = float(fnd_best)
    return out
