"""Landing-ellipse statistics: what fraction of the dispersion still works?

The scenario's `Ellipse` (semi-axes, azimuth of the major axis clockwise from north, gaussian or uniform
dispersion) is sampled with a deterministic low-discrepancy scheme and every sample point is evaluated
with the full verdict pipeline (`multisite.evaluate_points`: one shared ephemeris table, one batched
horizon request per chunk, the three horizon worlds). Reported:

- probability of each verdict state (and the same excluding hazardous samples),
- per-constraint pass probability (PASS, not-FAIL and UNKNOWN shares),
- percentiles, mean and extremes of every constraint's nominal value,
- worst and best sample (location, margin, limiting constraint),
- slope and roughness of each sample (`hazardous` marks samples over the hazard limits),
- a convergence report (probabilities at n/8, n/4, n/2 and n samples and the binomial standard error),
- a gridded verdict map: the verdict evaluated at the nodes of a regular east/north grid inside the ellipse.

Sampling scheme: a 2-D Halton sequence (bases 2 and 3, first `n` points) with a seeded Cranley-Patterson
random shift, mapped to the ellipse by the inverse CDF of the radius (gaussian: Rayleigh truncated at
`sigma_level` sigma when `truncate`, so the sample is the dispersion conditioned on landing inside the
ellipse; uniform: area-uniform) and a uniform angle. The same seed reproduces the same samples bit for
bit; prefixes of the sequence are themselves low-discrepancy, which is what the convergence report uses.
Probabilities are sample fractions, so their error is at most the binomial `sqrt(p (1 - p) / n)` (the
quasi-random error is usually smaller; the report states the binomial value as a conservative bound).
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass, field

import numpy as np

from lunarnav.ephem import et_to_utc

from .engine import (
    FAIL,
    MARGINAL,
    PASS,
    STATE_NAMES,
    UNKNOWN,
    fractions,
    has_no_nominal_margin,
    margin_kind,
    margin_note,
)
from .horizons import HorizonProvider, SmoothSphereProvider
from .models import Ellipse, Scenario
from .multisite import (
    PointResults,
    destination_arrays,
    evaluate_points,
    landing_epochs,
    points_table,
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

HALTON_BASES = (2, 3)
PERCENTILES = (5.0, 25.0, 50.0, 75.0, 95.0)
OUTSIDE = -2
"""State code of map nodes outside the ellipse."""
STATE_KEYS = ("PASS", "MARGINAL", "FAIL", "UNKNOWN")


def radical_inverse(n: int, base: int) -> np.ndarray:
    """Van der Corput radical inverse of 0..n-1 in `base` (the first n Halton coordinates)."""
    i = np.arange(n, dtype=np.int64)
    out = np.zeros(n)
    f = 1.0 / base
    while i.any():
        out += (i % base) * f
        i //= base
        f /= base
    return out


def ellipse_samples(
    ellipse: Ellipse, n: int, *, seed: int = 0, truncate: bool = True,
) -> tuple[np.ndarray, np.ndarray]:
    """`n` deterministic (east_m, north_m) offsets from the ellipse centre (see module doc)."""
    if n < 1:
        raise ValueError("n must be positive")
    shift = np.random.default_rng(seed).random(2)
    u = (np.column_stack([radical_inverse(n, b) for b in HALTON_BASES]) + shift) % 1.0
    u1, u2 = np.clip(u[:, 0], 0.0, 1.0 - 1e-12), u[:, 1]
    theta = 2.0 * math.pi * u2
    if ellipse.dispersion == "uniform":
        r = np.sqrt(u1)
        a, b = ellipse.semi_major_m, ellipse.semi_minor_m
    else:
        k = ellipse.sigma_level
        mass = 1.0 - math.exp(-0.5 * k * k) if truncate else 1.0
        r = np.sqrt(-2.0 * np.log(1.0 - u1 * mass))
        a, b = ellipse.semi_major_m / k, ellipse.semi_minor_m / k
    xa, xb = a * r * np.cos(theta), b * r * np.sin(theta)
    az = math.radians(ellipse.azimuth_deg)
    east = xa * math.sin(az) + xb * math.cos(az)
    north = xa * math.cos(az) - xb * math.sin(az)
    return east, north


def inside_ellipse(ellipse: Ellipse, east_m: np.ndarray, north_m: np.ndarray) -> np.ndarray:
    """Whether offsets lie inside the ellipse (boundary inclusive)."""
    az = math.radians(ellipse.azimuth_deg)
    xa = east_m * math.sin(az) + north_m * math.cos(az)
    xb = east_m * math.cos(az) - north_m * math.sin(az)
    return (xa / ellipse.semi_major_m) ** 2 + (xb / ellipse.semi_minor_m) ** 2 <= 1.0 + 1e-12


@dataclass(frozen=True, slots=True)
class SampleRef:
    """One sample point of the ellipse with its verdict."""

    index: int
    lat_deg: float
    lon_deg: float
    east_m: float
    north_m: float
    state: str
    worst_margin: float
    limiting: str | None
    slope_deg: float | None
    roughness_m: float | None
    margin_kind: str | None = None
    """`worst_case`, `nominal` (a failing sample reports the nominal margin) or `best_case` (a failing sample limited by the minimum
    state of charge with an unknown heading: the margin at the upper bound over headings, which no single heading achieves); see `engine.margin_kind`. `best` and `worst`
    order failing samples by that margin as it is, so a `best_case` margin is compared with the nominal margins of the others."""
    margin_note: str | None = None
    """The sentence that goes with `margin_kind` where it needs one (`engine.BEST_CASE_NOTE`)."""

    def to_dict(self) -> dict:
        return {f: getattr(self, f) for f in self.__slots__}


@dataclass(frozen=True, slots=True)
class EllipseMap:
    """Verdict at nodes of a regular east/north grid. Arrays are `(ny, nx)`; nodes outside the ellipse hold
    `OUTSIDE` in `state` and NaN in `worst_margin`."""

    east_m: np.ndarray
    north_m: np.ndarray
    lat_deg: np.ndarray
    lon_deg: np.ndarray
    state: np.ndarray
    worst_margin: np.ndarray
    spacing_m: float

    def to_dict(self) -> dict:
        return {"spacing_m": self.spacing_m, "east_m": self.east_m.tolist(), "north_m": self.north_m.tolist(),
                "state": self.state.tolist(), "worst_margin": np.where(np.isfinite(self.worst_margin), self.worst_margin, None).tolist()}


@dataclass(frozen=True, slots=True)
class EllipseResult:
    """Result of `ellipse_statistics` (arrays indexed by sample)."""

    scenario_name: str
    n_samples: int
    seed: int
    scheme: str
    truncated: bool
    keys: tuple[str, ...]
    east_m: np.ndarray
    north_m: np.ndarray
    lat_deg: np.ndarray
    lon_deg: np.ndarray
    state: np.ndarray
    worst_margin: np.ndarray
    limiting: np.ndarray
    slope_deg: np.ndarray | None
    roughness_m: np.ndarray | None
    hazardous: np.ndarray
    hazard_limits: dict[str, float | None]
    per_constraint: dict[str, np.ndarray]
    values: dict[str, np.ndarray]
    state_probability: dict[str, float]
    """Share of samples per state name (all samples)."""
    state_probability_non_hazardous: dict[str, float]
    hazard_fraction: float
    constraint_probability: dict[str, dict[str, float]]
    """Per constraint: `pass` (all three horizon worlds), `not_fail` (nominal world holds), `unknown`."""
    percentiles: dict[str, dict[str, float]]
    best: SampleRef
    worst: SampleRef
    centre: SampleRef
    convergence: dict
    map: EllipseMap | None
    provenance: dict = field(default_factory=dict)
    hazard_origins: dict[str, dict] = field(default_factory=dict)
    """Per hazard limit (`slope_deg`, `roughness_m`): `origin` is `request` (the caller gave it), `scenario_constraint` (the active
    slope limit; `label`, `basis` and `source_url` are that limit's own `Origin`, which names a preset or default if it came from one) or
    `none` (no limit, so that criterion marks nothing)."""
    closing_constraints: dict[str, int] = field(default_factory=dict)
    """For failing samples: how many each constraint is the limiting one for (as `OpportunityScan.closing_constraints`)."""
    closing_fraction: dict[str, float | None] = field(default_factory=dict)
    """`closing_constraints` over the number of failing samples (None when none fail)."""

    def margin_kinds(self) -> list[str | None]:
        """`margin_kind` of every sample's `worst_margin` (`best_case` where the failing sample is limited by the minimum state of
        charge with an unknown heading)."""
        unknown = bool(self.provenance.get("heading_unknown_soc"))
        lims = [self.keys[int(k)] if 0 <= int(k) < len(self.keys) else None for k in self.limiting]
        return [margin_kind(STATE_NAMES.get(int(s), "UNKNOWN"), float(m), no_nominal=has_no_nominal_margin(k, unknown))
                for s, m, k in zip(self.state, self.worst_margin, lims)]

    def sample(self, i: int) -> SampleRef:
        return _ref(self, i)

    def to_dict(self, *, with_samples: bool = False) -> dict:
        out = {
            "scenario_name": self.scenario_name, "n_samples": self.n_samples, "seed": self.seed, "scheme": self.scheme,
            "truncated_to_ellipse": self.truncated, "keys": list(self.keys),
            "state_probability": self.state_probability,
            "state_probability_non_hazardous": self.state_probability_non_hazardous,
            "hazard_fraction": self.hazard_fraction, "hazard_limits": self.hazard_limits,
            "hazard_origins": self.hazard_origins, "closing_constraints": self.closing_constraints,
            "closing_fraction": self.closing_fraction,
            "constraint_probability": self.constraint_probability, "percentiles": self.percentiles,
            "best": self.best.to_dict(), "worst": self.worst.to_dict(), "centre": self.centre.to_dict(),
            "convergence": self.convergence, "map": None if self.map is None else self.map.to_dict(),
            "provenance": self.provenance}
        if with_samples:
            kinds = self.margin_kinds()
            out["samples"] = {"east_m": self.east_m.tolist(), "north_m": self.north_m.tolist(),
                              "lat_deg": self.lat_deg.tolist(), "lon_deg": self.lon_deg.tolist(),
                              "state": [STATE_NAMES.get(int(s), "UNKNOWN") for s in self.state],
                              "worst_margin": [None if not math.isfinite(v) else float(v) for v in self.worst_margin],
                              "margin_kind": kinds, "margin_note": [margin_note(k) for k in kinds]}
        return out


def _ref(res: EllipseResult, i: int) -> SampleRef:
    lim = int(res.limiting[i])
    wm = float(res.worst_margin[i])
    key = res.keys[lim] if 0 <= lim < len(res.keys) else None
    kind = margin_kind(STATE_NAMES.get(int(res.state[i]), "UNKNOWN"), wm,
                       no_nominal=has_no_nominal_margin(key, bool(res.provenance.get("heading_unknown_soc"))))
    return SampleRef(
        int(i), float(res.lat_deg[i]), float(res.lon_deg[i]), float(res.east_m[i]), float(res.north_m[i]),
        STATE_NAMES.get(int(res.state[i]), "UNKNOWN"), wm if math.isfinite(wm) else float("nan"),
        res.keys[lim] if 0 <= lim < len(res.keys) else None,
        None if res.slope_deg is None or not math.isfinite(res.slope_deg[i]) else float(res.slope_deg[i]),
        None if res.roughness_m is None or not math.isfinite(res.roughness_m[i]) else float(res.roughness_m[i]),
        kind, margin_note(kind))


def _hazard_origins(slope_limit, slope_request: float | None, roughness_request: float | None) -> dict[str, dict]:
    """Where each hazard limit came from (`EllipseResult.hazard_origins`)."""
    none = {"origin": "none", "label": None, "basis": None, "source_url": None}
    request = {"origin": "request", "label": None, "basis": None, "source_url": None}
    slope = request if slope_request is not None else dict(none)
    if slope_request is None and slope_limit is not None and slope_limit.max is not None:
        o = slope_limit.origin
        slope = {"origin": "scenario_constraint", "label": slope_limit.label, "basis": o.basis, "source_url": o.source_url}
    return {"slope_deg": slope, "roughness_m": request if roughness_request is not None else dict(none)}


def _state_shares(state: np.ndarray, mask: np.ndarray | None = None) -> dict[str, float]:
    s = state if mask is None else state[mask]
    if s.size == 0:
        return {k: float("nan") for k in STATE_KEYS}
    return {"PASS": float((s == PASS).mean()), "MARGINAL": float((s == MARGINAL).mean()),
            "FAIL": float((s == FAIL).mean()), "UNKNOWN": float((s == UNKNOWN).mean())}


def _convergence(state: np.ndarray, tolerance: float) -> dict:
    n = state.size
    sizes = sorted({max(1, n // 8), max(1, n // 4), max(1, n // 2), n})
    rows = [{"n": int(m), **{k.lower(): v for k, v in _state_shares(state[:m]).items()}} for m in sizes]
    last = rows[-1]
    prev = rows[-2] if len(rows) > 1 else rows[-1]
    change = max(abs(last[k] - prev[k]) for k in ("pass", "marginal", "fail"))
    se = {k: math.sqrt(max(last[k] * (1.0 - last[k]), 0.0) / n) for k in ("pass", "marginal", "fail")}
    return {"rows": rows, "max_change_last_halving": change, "tolerance": tolerance,
            "converged": bool(change <= tolerance), "binomial_standard_error": se}


def _map(
    scenario: Scenario, provider: HorizonProvider, table, ellipse: Ellipse, cells: int, epochs: np.ndarray,
    lat0: float, lon0: float, progress: Callable[[float, str], None] | None = None,
) -> EllipseMap:
    ext = max(ellipse.semi_major_m, ellipse.semi_minor_m)
    spacing = 2.0 * ext / cells
    ax = (np.arange(cells) + 0.5) * spacing - ext
    east, north = np.meshgrid(ax, ax)
    lat, lon = destination_arrays(lat0, lon0, east.ravel(), north.ravel())
    ins = inside_ellipse(ellipse, east.ravel(), north.ravel())
    state = np.full(east.size, OUTSIDE, dtype=np.int16)
    margin = np.full(east.size, np.nan)
    if ins.any():
        pr = evaluate_points(scenario, provider, lat[ins], lon[ins], epochs, table=table, with_hazards=False,
                             progress=progress, chunk_points=64)
        state[ins] = pr.state[:, 0]
        margin[ins] = pr.worst_margin[:, 0]
    return EllipseMap(east, north, lat.reshape(east.shape), lon.reshape(east.shape), state.reshape(east.shape),
                      margin.reshape(east.shape), float(spacing))


def ellipse_statistics(
    scenario: Scenario, provider: HorizonProvider | None = None, *, n_samples: int = 512, seed: int = 0,
    truncate: bool = True, hazard_slope_deg: float | None = None, hazard_roughness_m: float | None = None,
    map_cells: int | None = 17, convergence_tolerance: float = 0.02, table=None,
    progress: Callable[[float, str], None] | None = None,
) -> EllipseResult:
    """Verdict statistics over the scenario's landing ellipse (see module doc).

    `hazard_slope_deg` defaults to the active slope limit (when the scenario has one);
    `hazard_roughness_m` has no default. `map_cells=None` skips the gridded map.

    `progress(fraction, stage)` is called between batches of 64 samples (fraction 0..1: ephemeris table 0 to 0.05,
    samples to 0.85, map to 0.99, centre last); an exception it raises propagates unchanged and no result is returned.
    The results are identical with or without it.
    """
    ell = scenario.ellipse
    if ell is None:
        raise ValueError("the scenario has no landing ellipse")
    provider = provider or SmoothSphereProvider()
    check_terrain_stack(scenario, provider)
    lat0 = scenario.site.lat_deg
    lon0 = float(wrap_lon(scenario.site.lon_deg))
    q = landing_epochs(scenario)
    if progress is not None:
        progress(0.0, "ephemeris table")
    if table is None:
        table = points_table(scenario, q)
    east, north = ellipse_samples(ell, n_samples, seed=seed, truncate=truncate)
    lat, lon = destination_arrays(lat0, lon0, east, north)
    pr: PointResults = evaluate_points(
        scenario, provider, lat, lon, q, table=table,
        progress=scaled_progress(progress, 0.05, 0.85, "samples: "), chunk_points=64)

    state = pr.state[:, 0]
    wm = pr.worst_margin[:, 0]
    lim = pr.limiting[:, 0]
    slim = scenario.constraints.max_slope_deg
    hazard_slope_request = hazard_slope_deg
    closing = {k: int((lim[state == FAIL] == i).sum()) for i, k in enumerate(pr.keys)}
    if hazard_slope_deg is None and slim is not None and slim.max is not None:
        hazard_slope_deg = float(slim.max)
    haz = np.zeros(n_samples, dtype=bool)
    if pr.slope_deg is not None:
        if hazard_slope_deg is not None:
            haz |= pr.slope_deg > hazard_slope_deg
        if hazard_roughness_m is not None:
            haz |= pr.roughness_m > hazard_roughness_m
    values = {k: v[:, 0] for k, v in pr.values.items()}
    per = {k: v[:, 0] for k, v in pr.per_constraint.items()}
    cprob = {k: {"pass": float((v == PASS).mean()), "not_fail": float(((v == PASS) | (v == MARGINAL)).mean()),
                 "unknown": float((v == UNKNOWN).mean())} for k, v in per.items()}
    pct: dict[str, dict[str, float]] = {}
    for k, v in values.items():
        f = v[np.isfinite(v)]
        if f.size == 0:
            continue
        pct[k] = {**{f"p{int(p)}": float(np.percentile(f, p)) for p in PERCENTILES},
                  "mean": float(f.mean()), "min": float(f.min()), "max": float(f.max()), "n_finite": int(f.size)}
    key = state.astype(np.float64) * 1.0e6 + np.nan_to_num(wm, nan=-1.0e5, posinf=1.0e5, neginf=-1.0e5)
    mp = None if map_cells is None else _map(
        scenario, provider, table, ell, int(map_cells), q, lat0, lon0,
        scaled_progress(progress, 0.85, 0.99, "map: "))
    ctr = evaluate_points(scenario, provider, np.array([lat0]), np.array([lon0]), q, table=table)
    if progress is not None:
        progress(1.0, "done")

    res = EllipseResult(
        scenario.name, int(n_samples), int(seed),
        f"halton(2,3) with seeded Cranley-Patterson shift; {ell.dispersion} radius inverse CDF"
        + (f" truncated at {ell.sigma_level:g} sigma" if ell.dispersion == "gaussian" and truncate else ""),
        bool(truncate), pr.keys, east, north, lat, lon, state, wm, lim, pr.slope_deg, pr.roughness_m, haz,
        {"slope_deg": hazard_slope_deg, "roughness_m": hazard_roughness_m}, per, values, _state_shares(state),
        _state_shares(state, ~haz), float(haz.mean()), cprob, pct,
        SampleRef(0, 0.0, 0.0, 0.0, 0.0, "", 0.0, None, None, None), SampleRef(0, 0.0, 0.0, 0.0, 0.0, "", 0.0, None, None, None),
        SampleRef(0, 0.0, 0.0, 0.0, 0.0, "", 0.0, None, None, None), _convergence(state, convergence_tolerance), mp,
        {**engine_blocks(), "landing_utc": et_to_utc(float(q[0])), "scenario_hash": scenario_hash(scenario),
         "provider": provider.provenance(), "ellipse": ell.model_dump(mode="json"), "heading_unknown_soc": pr.heading_unknown, "terrain_stack": terrain_stack_record(scenario, provider),
         "our_definitions": {"roughness": OUR_DEFINITIONS["roughness"]}},
        hazard_origins=_hazard_origins(slim, hazard_slope_request, hazard_roughness_m),
        closing_constraints=closing, closing_fraction=fractions(closing))
    object.__setattr__(res, "best", _ref(res, int(np.argmax(key))))
    object.__setattr__(res, "worst", _ref(res, int(np.argmin(key))))
    ctr_state = int(ctr.state[0, 0])
    c_lim = int(ctr.limiting[0, 0])
    c_key = pr.keys[c_lim] if 0 <= c_lim < len(pr.keys) else None
    c_kind = margin_kind(STATE_NAMES.get(ctr_state, "UNKNOWN"), float(ctr.worst_margin[0, 0]),
                         no_nominal=has_no_nominal_margin(c_key, ctr.heading_unknown))
    object.__setattr__(res, "centre", SampleRef(
        -1, lat0, lon0, 0.0, 0.0, STATE_NAMES.get(ctr_state, "UNKNOWN"), float(ctr.worst_margin[0, 0]),
        pr.keys[c_lim] if 0 <= c_lim < len(pr.keys) else None,
        None if ctr.slope_deg is None or not math.isfinite(ctr.slope_deg[0]) else float(ctr.slope_deg[0]),
        None if ctr.roughness_m is None or not math.isfinite(ctr.roughness_m[0]) else float(ctr.roughness_m[0]),
        c_kind, margin_note(c_kind)))
    return res
