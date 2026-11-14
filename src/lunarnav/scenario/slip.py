"""Slip analysis: what still works if the landing (or the launch) moves, and for which other sites.

Landing slips shift the landing epoch directly. Launch slips map through the scenario's `Transfer`:
a fixed transfer lands `duration_days` after launch; a table transfer lands at the landing epoch of
the first row whose launch is at or after the slipped launch-ready time (no row: no opportunity).
Each slip reports the verdict, the margins, the constraint that closes it, and the next open landing
epoch (first non-failing candidate at or after the slipped landing).
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass

import numpy as np

from lunarnav.ephem import et_to_utc, utc_to_et

from .engine import HOUR_S, MARGINAL, STATE_NAMES, has_no_nominal_margin, margin_kind, margin_note
from .horizons import HorizonProvider, SmoothSphereProvider, observer_sites, observers_per_site
from .models import Scenario, SiteSpec, Transfer
from .opportunities import (
    DEFAULT_LOOKBACK_H,
    DEFAULT_SIGNAL_STEP_S,
    DEFAULT_SPACING_S,
    ScanContext,
    build_scan_context,
    scan_table,
    utc_lattice,
)
from .progress import scaled_progress
from .provenance import check_terrain_stack
from .verdicts import Verdict, describe_constraint

DAY_S = 86400.0


@dataclass(frozen=True, slots=True)
class SlipRow:
    """One slip. `state` is pass / marginal / fail, or `no_opportunity` (a table transfer with no later
    launch). `margin` is the **worst-case** normalised margin (pessimistic case, except that a failing epoch reports the nominal one; margin
    divided by `margin_scale`, dimensionless) of the limiting constraint (see `engine.Verdicts`); the nominal margin of each constraint
    is `verdict.constraints[i].margin` and its worst-case margin `margin_worst`, in the constraint's unit."""

    slip_h: float
    launch_utc: str | None
    landing_utc: str | None
    state: str
    limiting: str | None
    margin: float | None
    verdict: Verdict | None
    explanation: str
    next_open_utc: str | None
    next_open_wait_h: float | None
    """Hours from the slipped landing to the next open candidate (0 when the slip itself is open)."""
    next_open_state: str | None
    next_open_candidates: int | None = None
    """Number of consecutive open candidates in the open window that starts at `next_open_utc`."""
    next_open_span_h: float | None = None
    """Hours from the first to the last open candidate of that window (0 for a single candidate)."""
    candidate_spacing_h: float | None = None
    margin_kind: str | None = None
    """`worst_case` (the pessimistic case), `nominal` (a failing row reports the nominal margin) or `best_case` (a failing row limited
    by the minimum state of charge with an unknown heading: the margin at the upper bound over headings, which no single heading achieves); None without a margin
    (`engine.margin_kind`)."""
    margin_note: str | None = None
    """Why the row has no `margin`, in the engine's words: the explanation of a launch with no landing, else the notes of the
    heading-dependent constraints (no nominal heading exists); for a `best_case` margin, what it is (`engine.BEST_CASE_NOTE`); else None."""


def _margin_note(state: str, verdict: Verdict | None, margin: float | None, explanation: str, kind: str | None) -> str | None:
    if margin is not None:
        return margin_note(kind)
    if state == "no_opportunity":
        return explanation or None
    notes = [c.heading_note for c in (verdict.constraints if verdict else ()) if c.heading_dependent and c.heading_note]
    return " ".join(notes) or None


@dataclass(frozen=True, slots=True)
class SlipResult:
    """Slip table of one site."""

    scenario_name: str
    site: SiteSpec
    mode: str
    rows: tuple[SlipRow, ...]
    n_pass: int
    n_open: int
    mean_margin: float
    provenance: dict


def baseline_launch_et(scenario: Scenario) -> float:
    """Launch epoch (ET) that corresponds to the scenario's landing under its transfer."""
    tr = scenario.transfer
    if tr is None:
        raise ValueError("launch slips need a Transfer on the scenario")
    t_land = utc_to_et(scenario.landing_utc)
    if tr.kind == "fixed":
        return t_land - tr.duration_days * DAY_S
    lands = np.array([utc_to_et(r.landing_utc) for r in tr.table])
    k = int(np.argmin(np.abs(lands - t_land)))
    if abs(lands[k] - t_land) > 1.0:
        raise ValueError("the scenario landing is not a landing epoch of its transfer table")
    return float(utc_to_et(tr.table[k].launch_utc))


def map_launch(transfer: Transfer, ready_et: float) -> tuple[float, float] | None:
    """(launch, landing) ET reached by a launch that is ready at `ready_et`; None if the table has no
    later launch."""
    if transfer.kind == "fixed":
        return ready_et, ready_et + transfer.duration_days * DAY_S
    for r in transfer.table:
        launch = utc_to_et(r.launch_utc)
        if launch >= ready_et:
            return float(launch), float(utc_to_et(r.landing_utc))
    return None


def slip_epochs(scenario: Scenario, slips_h: Sequence[float], mode: str) -> list[tuple[float | None, float | None]]:
    """(launch_et, landing_et) per slip (None entries where a table transfer has no opportunity)."""
    t_land = utc_to_et(scenario.landing_utc)
    if mode == "landing":
        return [(None, t_land + s * HOUR_S) for s in slips_h]
    if mode != "launch":
        raise ValueError("mode must be 'landing' or 'launch'")
    base = baseline_launch_et(scenario)
    out: list[tuple[float | None, float | None]] = []
    for s in slips_h:
        mapped = map_launch(scenario.transfer, base + s * HOUR_S)
        out.append(mapped if mapped is not None else (None, None))
    return out


def _epoch_range(epochs: list[tuple[float | None, float | None]], search_days: float) -> tuple[float, float]:
    if not search_days >= 0.0:
        raise ValueError(f"search_days must be at least 0, got {search_days:g}")
    lands = [e[1] for e in epochs if e[1] is not None]
    if not lands:
        raise ValueError("no slip leads to a landing opportunity")
    return min(lands), max(lands) + search_days * DAY_S


def _open_run(open_mask: np.ndarray, i: int | None, q: np.ndarray, spacing_s: float) -> tuple:
    """(candidate count, first-to-last span in hours, spacing in hours) of the open run holding candidate `i`."""
    if i is None:
        return None, None, spacing_s / HOUR_S
    a = b = i
    while b + 1 < open_mask.size and open_mask[b + 1]:
        b += 1
    return b - a + 1, float(q[b] - q[a]) / HOUR_S, spacing_s / HOUR_S


def slip_analysis(
    scenario: Scenario, provider: HorizonProvider | None = None, *, slips_h: Sequence[float],
    mode: str = "landing", search_days: float = 60.0, spacing_s: float = DEFAULT_SPACING_S,
    signal_step_s: float = DEFAULT_SIGNAL_STEP_S, lookback_h: float = DEFAULT_LOOKBACK_H, table=None,
    horizons: tuple | None = None, context: ScanContext | None = None,
    epochs: list[tuple[float | None, float | None]] | None = None,
    progress: Callable[[float, str], None] | None = None, display_name: str | None = None,
) -> SlipResult:
    """Verdict, margins, closing constraint and next open window for each slip in `slips_h` (hours).

    `mode` is `"landing"` or `"launch"` (through `scenario.transfer`). The next open landing is searched on
    candidates every `spacing_s` up to `search_days` after the last slipped landing. `table`, `horizons`,
    `context` and `epochs` let `rank_sites` share one ephemeris table, batch-fetched horizons and the
    slip epochs across sites. `progress(fraction, stage)` is called at every stage, every `EVAL_CHUNK` candidates
    and per slip (a raising callback cancels). `display_name` replaces `SlipResult.scenario_name` for display;
    it never enters the scenario hash."""
    provider = provider or SmoothSphereProvider()
    check_terrain_stack(scenario, provider)
    epochs = epochs if epochs is not None else slip_epochs(scenario, slips_h, mode)
    first, last = _epoch_range(epochs, search_days)
    ctx = context or build_scan_context(
        scenario, provider, first, last, signal_step_s=signal_step_s, lookback_h=lookback_h, table=table,
        horizons=horizons, progress=scaled_progress(progress, 0.0, 0.5))
    q = utc_lattice(first, int(math.floor((last - first) / spacing_s)) + 1, spacing_s)
    q = q[(q >= ctx.analysis.t0) & (q + ctx.mission_s <= ctx.analysis.t1 + 1e-6)]
    _, vd = ctx.evaluate_chunked(q, progress, 0.5, 0.9)
    open_idx = np.flatnonzero(vd.state >= MARGINAL)
    rows: list[SlipRow] = []
    t_land0 = utc_to_et(scenario.landing_utc)
    for i_slip, (s, (launch, landing)) in enumerate(zip(slips_h, epochs)):
        if progress is not None:
            progress(0.9 + 0.1 * i_slip / max(len(epochs), 1), f"slip {i_slip + 1} of {len(epochs)}")
        if landing is None:
            rows.append(SlipRow(float(s), None, None, "no_opportunity", None, None, None,
                                "the transfer table has no launch at or after this launch-ready time",
                                None, None, None,
                                margin_note="the transfer table has no launch at or after this launch-ready time"))
            continue
        verdict, worst_margin = ctx.verdict_and_margin_at(landing)
        lim = verdict.limiting
        pos = int(np.searchsorted(q[open_idx], landing - 1e-6))
        nxt = int(open_idx[pos]) if pos < open_idx.size else None
        expl = ""
        if verdict.state != "pass" and lim is not None:
            expl = describe_constraint(verdict.get(lim))
        kind = margin_kind(verdict.state, worst_margin, no_nominal=has_no_nominal_margin(lim, ctx.heading_unknown))
        rows.append(SlipRow(
            float(s), None if launch is None else et_to_utc(launch, 0), et_to_utc(landing, 0), verdict.state, lim,
            worst_margin, verdict, expl,
            None if nxt is None else et_to_utc(float(q[nxt]), 0),
            None if nxt is None else max(0.0, (float(q[nxt]) - landing) / HOUR_S),
            None if nxt is None else STATE_NAMES[int(vd.state[nxt])],
            *_open_run(vd.state >= MARGINAL, nxt, q, spacing_s),
            margin_kind=kind, margin_note=_margin_note(verdict.state, verdict, worst_margin, expl, kind)))
    margins = [r.margin for r in rows if r.margin is not None]
    prov = dict(ctx.provenance)
    prov["analysis"] = {**prov["analysis"], "kind": "slip", "mode": mode, "slips_h": [float(x) for x in slips_h],
                        "search_days": search_days, "spacing_s": spacing_s, "baseline_landing_utc": scenario.landing_utc,
                        "t_land0_et": t_land0}
    return SlipResult(
        display_name or scenario.name, scenario.site, mode, tuple(rows), sum(r.state == "pass" for r in rows),
        sum(r.state in ("pass", "marginal") for r in rows), float(np.mean(margins)) if margins else -math.inf, prov)


def rank_sites(
    scenario: Scenario, sites: Sequence[SiteSpec], provider: HorizonProvider | None = None, *,
    slips_h: Sequence[float], mode: str = "landing", search_days: float = 60.0,
    spacing_s: float = DEFAULT_SPACING_S, signal_step_s: float = DEFAULT_SIGNAL_STEP_S,
    lookback_h: float = DEFAULT_LOOKBACK_H, progress: Callable[[float, str], None] | None = None,
) -> list[SlipResult]:
    """Slip analysis of `scenario` moved to each site, ranked best first.

    Ranking key (descending): number of passing slips, number of open (pass or marginal) slips, mean
    normalised margin. One ephemeris table is shared and the horizons of all sites are fetched in one
    provider batch call. The row of a site equal to `scenario.site` is evaluated on the submitted scenario itself
    (same hash); the others differ from it in `site` only. Rows are labelled by `SlipResult.scenario_name`
    (`"<name> @ <site>"`), a display name that is not part of any hash. `progress(fraction, stage)` reports per
    site and inside each site's scan."""

    provider = provider or SmoothSphereProvider()
    epochs = slip_epochs(scenario, slips_h, mode)
    first, last = _epoch_range(epochs, search_days)
    if progress is not None:
        progress(0.0, "ephemeris table")
    table = scan_table(scenario, first, last, signal_step_s=signal_step_s, lookback_h=lookback_h)
    prof = scenario.profile
    flat = []
    for s in sites:
        lon = s.lon_deg if s.lon_deg <= 180.0 else s.lon_deg - 360.0
        flat += observer_sites(s.lat_deg, lon, prof, s.name)
    profiles = provider.horizons(flat)
    g = observers_per_site(prof)
    results = []
    for i, s in enumerate(sites):
        sc = scenario if s == scenario.site else scenario.model_copy(update={"site": s})
        results.append(slip_analysis(
            sc, provider, slips_h=slips_h, mode=mode, search_days=search_days, spacing_s=spacing_s,
            signal_step_s=signal_step_s, lookback_h=lookback_h, table=table,
            horizons=tuple(profiles[g * i:g * i + g]), epochs=epochs,
            display_name=f"{scenario.name} @ {s.name or (s.lat_deg, s.lon_deg)}",
            progress=scaled_progress(
                progress, 0.05 + 0.95 * i / len(sites), 0.05 + 0.95 * (i + 1) / len(sites), f"site {i + 1} of {len(sites)}: ")))
    return sorted(results, key=lambda r: (r.n_pass, r.n_open, r.mean_margin), reverse=True)
