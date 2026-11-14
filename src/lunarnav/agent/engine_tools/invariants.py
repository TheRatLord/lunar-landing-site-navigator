"""Consistency checks on engine results before they are reported.

Each function takes the JSON form of a result (as the tools return it) and lists violated invariants as
human-readable strings; an empty list means consistent. They never repair: a violation marks the ledger
entry invalid and the tool tells the model not to report the result.
"""

from __future__ import annotations

import itertools
import math
import re
from collections.abc import Mapping, Sequence
from typing import Any

from ..numbers import parse_utc

TOL = 1e-6
_RANK = {"pass": 0, "unknown": 0, "marginal": 1, "fail": 2}
FRACTION_KEYS = ("fraction", "soc", "state_of_charge", "probability", "open_fraction")


def _num(x: Any) -> float | None:
    return float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) else None


def _le(a: Any, b: Any, tol: float = TOL) -> bool:
    x, y = _num(a), _num(b)
    return x is None or y is None or x <= y + tol * max(1.0, abs(x), abs(y))


def check_verdict(v: Mapping[str, Any] | None, where: str = "verdict") -> list[str]:
    """State is the worst constraint state; per-constraint state agrees with margin, value and range."""
    if not v:
        return []
    bad: list[str] = []
    cons = list(v.get("constraints") or [])
    states = [c.get("state") for c in cons]
    if cons:
        worst = max((s for s in states if s in _RANK), key=lambda s: _RANK[s], default="pass")
        if _RANK.get(v.get("state"), -1) != _RANK[worst] and not (v.get("state") == "pass" and worst == "unknown"):
            bad.append(f"{where}: overall state {v.get('state')!r} but the worst constraint is {worst!r}")
        lim = v.get("limiting")
        if v.get("state") in ("fail", "marginal") and lim not in [c.get("key") for c in cons if c.get("state") == v["state"]]:
            bad.append(f"{where}: limiting constraint {lim!r} is not a {v.get('state')} constraint")
    for c in cons:
        key, st = c.get("key"), c.get("state")
        m, mw = _num(c.get("margin")), _num(c.get("margin_worst"))
        if st == "pass" and mw is not None and mw < -TOL:
            bad.append(f"{where}.{key}: PASS with negative worst-case margin {mw}")
        if st == "marginal" and ((m is not None and m < -TOL) or (mw is not None and mw >= 0)):
            bad.append(f"{where}.{key}: MARGINAL must have nominal margin >= 0 and worst-case margin < 0 (got {m}, {mw})")
        if st == "fail" and m is not None and m >= 0:
            bad.append(f"{where}.{key}: FAIL with non-negative nominal margin {m}")
        if mw is not None and m is not None and mw > m + TOL * max(1.0, abs(m)):
            bad.append(f"{where}.{key}: worst-case margin {mw} exceeds nominal margin {m}")
        value, rng = _num(c.get("value")), c.get("value_range")
        if rng and len(rng) == 2 and _num(rng[0]) is not None and _num(rng[1]) is not None:
            if not _le(rng[0], rng[1]):
                bad.append(f"{where}.{key}: value range {rng} is not ordered")
            elif value is not None and not (_le(rng[0], value) and _le(value, rng[1])):
                bad.append(f"{where}.{key}: value {value} outside its range {rng}")
        lo, hi = _num(c.get("limit_min")), _num(c.get("limit_max"))
        if value is not None and m is not None and (lo is not None or hi is not None):
            want = min([value - lo] if lo is not None else [math.inf]) if hi is None else min(
                ([value - lo] if lo is not None else []) + [hi - value])
            if abs(want - m) > 1e-5 * max(1.0, abs(want)):
                bad.append(f"{where}.{key}: margin {m} disagrees with value {value} and limits [{lo}, {hi}]")
    return bad


def check_heading(v: Mapping[str, Any] | None, heading: Mapping[str, Any] | None, where: str = "verdict") -> list[str]:
    """A heading-dependent row has no single value and carries the engine's note; an unknown heading has no nominal."""
    bad: list[str] = []
    for c in (v or {}).get("constraints") or []:
        if c.get("heading_dependent"):
            if c.get("value") is not None:
                bad.append(f"{where}.{c.get('key')}: heading-dependent row has a single value {c.get('value')}")
            if not c.get("heading_note"):
                bad.append(f"{where}.{c.get('key')}: heading-dependent row has no heading note")
    if heading and not heading.get("known") and heading.get("nominal_yaw_deg") is not None:
        bad.append(f"{where}: heading is unknown but a nominal heading {heading.get('nominal_yaw_deg')} is reported")
    return bad


def check_metrics(metrics: Sequence[Mapping[str, Any]] | None) -> list[str]:
    """``low <= value <= high``; fraction-valued metrics within [0, 1]; durations non-negative."""
    bad: list[str] = []
    for m in metrics or []:
        key, v, lo, hi = m.get("key"), _num(m.get("value")), _num(m.get("low")), _num(m.get("high"))
        if lo is not None and hi is not None and not _le(lo, hi):
            bad.append(f"metric {key}: low {lo} > high {hi}")
        if v is not None and lo is not None and not _le(lo, v):
            bad.append(f"metric {key}: value {v} below low {lo}")
        if v is not None and hi is not None and not _le(v, hi):
            bad.append(f"metric {key}: value {v} above high {hi}")
        unit = str(m.get("unit") or "")
        if unit == "fraction":
            for x in (v, lo, hi):
                if x is not None and not (-TOL <= x <= 1 + TOL):
                    bad.append(f"metric {key}: fraction {x} outside [0, 1]")
        if unit in ("h", "s", "min", "d") and v is not None and v < -TOL:
            bad.append(f"metric {key}: negative duration {v}")
    return bad


def check_interval(row: Mapping[str, Any], where: str = "interval") -> list[str]:
    """Start before end; edge ranges ordered and containing the nominal edge."""
    bad: list[str] = []
    s, e = _utc(row.get("start_utc")), _utc(row.get("end_utc"))
    if s is not None and e is not None and s > e:
        bad.append(f"{where}: start {row.get('start_utc')} after end {row.get('end_utc')}")
    for edge, t in (("start", s), ("end", e)):
        rng = row.get(f"{edge}_range_utc")
        if rng and len(rng) == 2:
            lo, hi = _utc(rng[0]), _utc(rng[1])
            if lo is not None and hi is not None and lo > hi:
                bad.append(f"{where}: {edge} range is not ordered")
            elif t is not None and lo is not None and hi is not None and not (lo - 1 <= t <= hi + 1):
                bad.append(f"{where}: nominal {edge} lies outside its optimistic/pessimistic range")
    d = _num(row.get("duration_h"))
    if d is not None and d < -TOL:
        bad.append(f"{where}: negative duration")
    return bad


def _utc(x: Any) -> float | None:
    try:
        return float(parse_utc(x)) if isinstance(x, str) else None
    except (ValueError, TypeError):
        return None


def check_intervals(rows: Sequence[Mapping[str, Any]] | None, kind: str = "intervals") -> list[str]:
    """Each interval consistent, and nominal intervals of one kind do not overlap."""
    bad: list[str] = []
    prev_end: float | None = None
    for i, r in enumerate(rows or []):
        bad.extend(check_interval(r, f"{kind}[{i}]"))
        s, e = _utc(r.get("start_utc")), _utc(r.get("end_utc"))
        if r.get("nominal", True) and s is not None and e is not None:
            if prev_end is not None and s < prev_end - 1:
                bad.append(f"{kind}[{i}]: overlaps the previous interval")
            prev_end = e
    return bad


def check_evaluation(out: Mapping[str, Any]) -> list[str]:
    bad = (check_verdict(out.get("verdict")) + check_heading(out.get("verdict"), out.get("heading"))
           + check_metrics(out.get("metrics")))
    for kind, block in (out.get("intervals") or {}).items():
        bad.extend(check_intervals(block.get("rows"), f"intervals.{kind}"))
    return bad


def check_slip(rows: Sequence[Mapping[str, Any]], n_pass: int | None = None, n_open: int | None = None) -> list[str]:
    """Counts consistent with the rows; a failing slip's next open landing is later than the slip itself."""
    bad: list[str] = []
    if n_pass is not None and n_pass != sum(r.get("state") == "pass" for r in rows):
        bad.append("slip: n_pass disagrees with the rows")
    if n_open is not None and n_open != sum(r.get("state") in ("pass", "marginal") for r in rows):
        bad.append("slip: n_open disagrees with the rows")
    for r in rows:
        w = _num(r.get("next_open_wait_h"))
        if w is not None and w < -TOL:
            bad.append(f"slip {r.get('slip_h')}: negative wait for the next open landing")
        if r.get("state") == "fail" and r.get("next_open_state") == "fail":
            bad.append(f"slip {r.get('slip_h')}: next open landing is itself failing")
    return bad


def check_scan(counts: Mapping[str, int], n_candidates: int, windows: Sequence[Mapping[str, Any]]) -> list[str]:
    bad: list[str] = []
    if sum(counts.values()) != n_candidates:
        bad.append(f"scan: state counts sum to {sum(counts.values())} but there are {n_candidates} candidates")
    for i, w in enumerate(windows):
        s, e = _utc(w.get("start_utc")), _utc(w.get("end_utc"))
        if s is not None and e is not None and s > e:
            bad.append(f"scan window {i}: start after end")
        if (w.get("n_pass") or 0) > (w.get("n_candidates") or 0):
            bad.append(f"scan window {i}: more passing than candidates")
    return bad


def check_sensitivity(kind: str, baseline: Mapping[str, Any], rows: Sequence[Mapping[str, Any]]) -> list[str]:
    """Raising a mast never reduces illumination or contact (within tolerance)."""
    bad: list[str] = []
    if kind not in ("array_height", "antenna_height"):
        return bad
    metric = "sunlit_fraction" if kind == "array_height" else "contact_fraction"
    pts = sorted(([baseline, *rows]), key=lambda r: r["value"])
    last: float | None = None
    for r in pts:
        v = _num((r.get("metrics") or {}).get(metric))
        if v is None:
            continue
        if last is not None and v < last - 1e-3:
            bad.append(f"sensitivity: {metric} decreases from {last} to {v} when the {kind} increases to {r['value']} m")
        last = v
    return bad


def check_fractions(obj: Any, path: str = "") -> list[str]:
    """Any key containing 'fraction' or 'probability' must lie in [0, 1] (recursively)."""
    bad: list[str] = []
    if isinstance(obj, Mapping):
        for k, v in obj.items():
            p = f"{path}.{k}" if path else str(k)
            if isinstance(v, (int, float)) and not isinstance(v, bool) and any(f in str(k) for f in FRACTION_KEYS):
                if not (-TOL <= v <= 1 + TOL):
                    bad.append(f"{p} = {v} is outside [0, 1]")
            else:
                bad.extend(check_fractions(v, p))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            bad.extend(check_fractions(v, f"{path}[{i}]"))
    return bad


def check_comparison(states: Sequence[str], limiting: Sequence[str | None]) -> list[str]:
    bad: list[str] = []
    for s, lim in zip(states, limiting, strict=False):
        if s == "fail" and lim is None:
            bad.append("comparison: failing scenario without a limiting constraint")
    return bad


def check_ellipse(res: Mapping[str, Any]) -> list[str]:
    """State probabilities sum to one; hazard fraction within bounds; percentiles ordered."""
    bad = check_fractions({k: res.get(k) for k in ("state_probability", "state_probability_non_hazardous",
                                                    "hazard_fraction", "constraint_probability")})
    sp = res.get("state_probability") or {}
    if sp and abs(sum(v for v in sp.values() if isinstance(v, (int, float))) - 1.0) > 1e-6:
        bad.append("ellipse: state probabilities do not sum to 1")
    for key, pct in (res.get("percentiles") or {}).items():
        if not isinstance(pct, Mapping):
            continue
        ordered = sorted((int(k[1:]), _num(v)) for k, v in pct.items() if re.fullmatch(r"p\d+", k))
        vals = [v for _, v in ordered if v is not None]
        lo, hi = _num(pct.get("min")), _num(pct.get("max"))
        chain = ([lo] if lo is not None else []) + vals + ([hi] if hi is not None else [])
        if any(not _le(a, b) for a, b in itertools.pairwise(chain)):
            bad.append(f"ellipse: min/percentiles/max of {key} are not monotone")
    return bad
