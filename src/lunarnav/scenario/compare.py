"""Comparison matrix of scenarios: headline metrics and verdicts side by side.

Scenarios with the same landing epoch, sampling and station set share one ephemeris table (one SPICE
pass); others get their own table, built sequentially (SPICE is not thread-safe). Horizons of all
scenarios are fetched in one provider batch call.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from lunarnav.ephem import BodyFixedEphemeris, utc_to_et

from .engine import HOUR_S
from .evaluate import SiteEvaluation, build_table, evaluate_scenario, landing_grid
from .horizons import HorizonProvider, SmoothSphereProvider, observer_sites, observers_per_site
from .models import Scenario
from .verdicts import Verdict


@dataclass(frozen=True, slots=True)
class Comparison:
    """Metric matrix: `values[i, j]` is metric `metric_keys[i]` of scenario `names[j]` (NaN: unavailable);
    `low` / `high` span the horizon worlds."""

    names: tuple[str, ...]
    metric_keys: tuple[str, ...]
    metric_labels: tuple[str, ...]
    metric_units: tuple[str, ...]
    values: np.ndarray
    low: np.ndarray
    high: np.ndarray
    states: tuple[str, ...]
    limiting: tuple[str | None, ...]
    verdicts: tuple[Verdict, ...]
    evaluations: tuple[SiteEvaluation, ...]

    def rows(self) -> list[dict]:
        """One dict per metric: key, label, unit and each scenario's value (None if unavailable)."""
        out = []
        for i, key in enumerate(self.metric_keys):
            row = {"metric": key, "label": self.metric_labels[i], "unit": self.metric_units[i]}
            for j, name in enumerate(self.names):
                v = self.values[i, j]
                row[name] = None if np.isnan(v) else float(v)
            out.append(row)
        return out


def _table_key(sc: Scenario) -> tuple:
    return (sc.landing_utc, sc.mission_duration_h, sc.sampling.step_s, sc.sampling.lookback_h,
            tuple(s.id for s in sc.network.stations), sc.network.direction,
            sc.constraints.min_sunlit_hours_after_landing.min if sc.constraints.min_sunlit_hours_after_landing else None)


def compare_scenarios(scenarios: Sequence[Scenario], provider: HorizonProvider | None = None) -> Comparison:
    """Evaluate each scenario and tabulate metrics and verdicts. Scenario names must be unique."""
    names = [s.name for s in scenarios]
    if len(set(names)) != len(names):
        raise ValueError("scenario names must be unique")
    provider = provider or SmoothSphereProvider()
    sites = []
    for s in scenarios:
        lon = s.site.lon_deg if s.site.lon_deg <= 180.0 else s.site.lon_deg - 360.0
        sites += observer_sites(s.site.lat_deg, lon, s.profile, s.site.name)
    profiles = provider.horizons(sites)
    offsets = np.concatenate([[0], np.cumsum([observers_per_site(s.profile) for s in scenarios])]).astype(int)
    tables: dict[tuple, BodyFixedEphemeris] = {}
    evals: list[SiteEvaluation] = []
    for i, sc in enumerate(scenarios):
        key = _table_key(sc)
        if key not in tables:
            cons = sc.constraints
            min_sun = cons.min_sunlit_hours_after_landing
            span = max(sc.mission_duration_h * HOUR_S, (min_sun.min or 0.0) * HOUR_S if min_sun else 0.0)
            grid = landing_grid(utc_to_et(sc.landing_utc), sc.sampling.step_s, sc.sampling.lookback_h * HOUR_S, span)
            tables[key] = build_table(grid, [sc.network])
        evals.append(evaluate_scenario(sc, provider, table=tables[key], horizons=tuple(profiles[offsets[i]:offsets[i + 1]])))
    keys: list[str] = []
    meta: dict[str, tuple[str, str]] = {}
    for ev in evals:
        for m in ev.metrics:
            if m.key not in meta:
                keys.append(m.key)
                meta[m.key] = (m.label, m.unit)
    shape = (len(keys), len(evals))
    val, low, high = (np.full(shape, np.nan) for _ in range(3))
    for j, ev in enumerate(evals):
        for m in ev.metrics:
            i = keys.index(m.key)
            val[i, j] = np.nan if m.value is None else m.value
            low[i, j] = np.nan if m.low is None else m.low
            high[i, j] = np.nan if m.high is None else m.high
    return Comparison(
        tuple(names), tuple(keys), tuple(meta[k][0] for k in keys), tuple(meta[k][1] for k in keys), val, low, high,
        tuple(e.verdict.state for e in evals), tuple(e.verdict.limiting for e in evals),
        tuple(e.verdict for e in evals), tuple(evals))
