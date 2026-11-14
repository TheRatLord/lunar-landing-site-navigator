"""The service's request limits: one registry, used by the request models and published in `GET /meta` (`limits`).

A limit exists to keep one request from allocating or running for an unbounded time. Each is a named constant here,
with the reason it has that value; the models quote the number and say what would fit when they refuse. Limits that
come from the engine (for example the 1.5 million signal epochs of `scan_table`) are not repeated: the service's own
bound is lower, so the engine's refusal is never what a client sees first.
"""

from __future__ import annotations

import math
from datetime import datetime
from typing import Any

MAX_SCAN_CANDIDATES = 100_000
"""Landing candidates in one scan: about eleven years at the 3600 s default spacing."""

MAX_SCAN_SIGNAL_EPOCHS = 400_000
"""Signal samples a scan builds (span plus lookback, at the signal step): 23 years at the 1800 s default. The engine's
own ceiling is 1.5 million (about 100 MB of arrays); this leaves room for several scans in one worker."""

MAX_SPACING_S = 7 * 86_400.0
"""Candidate or signal spacing: a week. Wider is not a scan of the opportunity pattern."""

MAX_LOOKBACK_H = 8_760.0
"""Hours of signal before the first landing candidate that a scan or slip analysis may ask for: one year."""

MAX_SLIP_H = 8_760.0
"""Largest slip magnitude in hours: one year of schedule movement."""

MAX_SLIP_CANDIDATE_SITES = 500_000
"""Candidate landings times sites in one slip analysis (the default 60 days at 3600 s is 1,440 per site)."""

MAX_HEIGHT_M = 500.0
"""Observer height above ground in a height sensitivity, the same bound as the horizon endpoint."""

MAX_SHIFT_M = 25_000.0
"""Largest shift in a position sensitivity. The method moves the touchdown point over the terrain around the site
with the site's own ephemeris table and evaluates the horizon at each shifted point, so it describes landing
dispersion and site refinement: a shift of tens of kilometres is a different site, for which `slip` with
`alternative_coordinates` or `search` is the tool. This bound is the service's choice; it is not a published figure."""

MAX_SEARCH_EPOCHS = 10_000
"""Landing epochs a site search may evaluate (`first_utc` to `last_utc` at `epoch_spacing_h`)."""

MAX_REGIONAL_EPOCHS = 20_000
"""Time steps of a regional layer computation: 2.3 years hourly, or 14 days at the 60 s minimum."""

MAX_SEARCH_LATTICE = 250_000
"""Largest final lattice (points) a search request may imply; larger regions are refused with advice."""

MAX_REGIONAL_CELLS = 250_000
"""Cells of a regional grid."""


def request_limits(inline_max_points: int, job_max_points: int) -> dict[str, int | float]:
    """Every request limit by name, as published in `GET /meta`."""
    return {
        "inline_max_points": inline_max_points,
        "job_max_points": job_max_points,
        "scan_max_candidates": MAX_SCAN_CANDIDATES,
        "scan_max_signal_epochs": MAX_SCAN_SIGNAL_EPOCHS,
        "max_spacing_s": MAX_SPACING_S,
        "max_lookback_h": MAX_LOOKBACK_H,
        "slip_max_abs_h": MAX_SLIP_H,
        "slip_max_candidate_sites": MAX_SLIP_CANDIDATE_SITES,
        "sensitivity_max_height_m": MAX_HEIGHT_M,
        "sensitivity_max_shift_m": MAX_SHIFT_M,
        "search_max_epochs": MAX_SEARCH_EPOCHS,
        "search_max_lattice_points": MAX_SEARCH_LATTICE,
        "regional_max_epochs": MAX_REGIONAL_EPOCHS,
        "regional_max_cells": MAX_REGIONAL_CELLS,
    }


def parse_utc(value: str) -> datetime:
    """Instant of a boundary UTC string (`YYYY-MM-DDTHH:MM:SS[.fff]Z`, leap second read as :59); naive UTC."""
    return datetime.fromisoformat(value[:-1].replace(":60", ":59")).replace(tzinfo=None)


def span_s(start_utc: str, end_utc: str) -> float:
    """Seconds from `start_utc` to `end_utc` (negative when reversed)."""
    return (parse_utc(end_utc) - parse_utc(start_utc)).total_seconds()


def ceil_2sf(x: float) -> float:
    """`x` rounded up to two significant figures (a value that is safe to suggest)."""
    step = 10.0 ** (math.floor(math.log10(x)) - 1)
    return math.ceil(x / step - 1e-9) * step


def finite_tree(value: Any) -> bool:
    """True when no float anywhere inside a JSON-like value is NaN or infinite."""
    if isinstance(value, float):
        return math.isfinite(value)
    if isinstance(value, dict):
        return all(finite_tree(v) for v in value.values())
    if isinstance(value, list | tuple):
        return all(finite_tree(v) for v in value)
    return True

