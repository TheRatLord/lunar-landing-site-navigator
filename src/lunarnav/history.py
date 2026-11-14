"""Mission and launch history with blind filtering for backtests.

In blind mode one mission is under test: it and every mission dated at or after it are hidden, their sites are
removed from the catalogue, launch records after it are dropped, and text that would name it is redacted from
tool outputs. Landers are shown under anonymous aliases; `unalias` maps an alias back to the real id on input.
"""

from __future__ import annotations

import re
import string
from dataclasses import dataclass
from typing import Any

from lunarnav.catalog import (
    LaunchVehicleEntry,
    MissionEntry,
    load_landers,
    load_launch_vehicles,
    load_missions,
    set_hidden_sites,
)
from lunarnav.catalog import _all_sites as all_sites

HIDDEN = "[hidden]"
GENERIC_OPERATORS = frozenset({"NASA"})


@dataclass(frozen=True)
class Blind:
    """What a blind backtest of one mission hides."""

    exclude_mission_id: str
    cutoff_utc: str
    hidden_mission_ids: frozenset[str]
    hidden_site_ids: frozenset[str]
    lander_alias: dict[str, str]
    redactions: tuple[tuple[re.Pattern[str], str], ...]


_BLIND: Blind | None = None


def blind() -> Blind | None:
    """The active blind setting, if any."""
    return _BLIND


def _phrases(m: MissionEntry) -> list[str]:
    out = [m.id, m.name]
    for sid in (m.site_id, m.target_site_id):
        if sid is None:
            continue
        out.append(sid)
        site = next((s for s in all_sites() if s.id == sid), None)
        if site is not None:
            out += [site.name, site.mission]
    return [p for p in out if p and len(p) > 2]


def set_blind(mission_id: str | None) -> Blind | None:
    """Start a blind backtest of ``mission_id`` (``None`` ends it) and return the setting."""
    global _BLIND
    if mission_id is None:
        _BLIND = None
        set_hidden_sites(frozenset())
        return None
    missions = {m.id: m for m in load_missions()}
    if mission_id not in missions:
        raise KeyError(f"unknown mission {mission_id!r}")
    tested = missions[mission_id]
    cutoff = tested.event_utc
    if cutoff is None:
        raise ValueError(f"mission {mission_id!r} has no launch or landing time")
    hidden = [m for m in missions.values() if m.id == mission_id or (m.event_utc or "") >= cutoff]
    site_ids = frozenset(s for m in hidden for s in (m.site_id, m.target_site_id) if s)
    landers = load_landers()
    alias = {e.id: f"lander-{string.ascii_lowercase[i]}" for i, e in enumerate(landers)}
    phrases: list[tuple[str, str]] = []
    for e in landers:
        phrases += [(e.id, alias[e.id]), (e.name, alias[e.id])]
        phrases += [(e.operator, HIDDEN)] if e.operator not in GENERIC_OPERATORS else []
        phrases += [(name, HIDDEN) for name in e.missions]
    for m in hidden:
        phrases += [(p, HIDDEN) for p in _phrases(m)]
    phrases = sorted({p for p in phrases if p[0] and len(p[0]) > 2}, key=lambda p: -len(p[0]))
    redactions = tuple((re.compile(r"(?<![\w-])" + re.escape(p) + r"(?![\w-])", re.IGNORECASE), r)
                       for p, r in phrases)
    _BLIND = Blind(mission_id, cutoff, frozenset(m.id for m in hidden), site_ids, alias, redactions)
    set_hidden_sites(site_ids)
    return _BLIND


def visible_missions() -> list[MissionEntry]:
    """Missions a tool may show: all of them, or in blind mode only those before the tested one."""
    b = _BLIND
    return [m for m in load_missions() if b is None or m.id not in b.hidden_mission_ids]


def mission(mission_id: str) -> MissionEntry | None:
    """A visible mission by id."""
    return next((m for m in visible_missions() if m.id == mission_id), None)


def visible_vehicle(vehicle_id: str) -> LaunchVehicleEntry | None:
    """A launch vehicle's record as it stood before the blind cutoff (unchanged outside blind mode).

    In blind mode later failures are dropped and recounted; ``attempts`` cannot be recounted from the data,
    so it is kept only when the record was counted before the cutoff and is otherwise set to -1 (unknown).
    """
    v = next((x for x in load_launch_vehicles() if x.id == vehicle_id), None)
    b = _BLIND
    if v is None or b is None:
        return v
    day = b.cutoff_utc[:10]
    kept = tuple(f for f in v.failures_detail if f.date < day)
    missions = tuple(m for m in v.lunar_missions if m not in b.hidden_mission_ids)
    if v.counted_through < day:
        return v.model_copy(update={"lunar_missions": missions})
    return v.model_copy(update={
        "failures_detail": kept, "lunar_missions": missions,
        "failures": sum(not f.partial for f in kept), "partial": sum(f.partial for f in kept),
        "attempts": -1, "counted_through": day})


def unalias(obj: Any) -> Any:
    """Replace lander aliases with real lander ids in tool arguments (identity outside blind mode)."""
    b = _BLIND
    if b is None:
        return obj
    back = {v: k for k, v in b.lander_alias.items()}
    if isinstance(obj, str):
        return back.get(obj, obj)
    if isinstance(obj, dict):
        return {k: unalias(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [unalias(v) for v in obj]
    return obj


def redact(obj: Any) -> Any:
    """Remove text naming hidden missions, their sites and real landers from a tool output (identity outside blind mode)."""
    b = _BLIND
    if b is None:
        return obj
    if isinstance(obj, str):
        for pattern, repl in b.redactions:
            obj = pattern.sub(repl, obj)
        return obj
    if isinstance(obj, dict):
        return {redact(k): redact(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [redact(v) for v in obj]
    return obj


SITE_CRITERIA = ("slope_tipover", "illumination_power", "terrain_navigation", "ellipse_hazards")


def backtest_cases() -> list[dict[str, Any]]:
    """One blinded backtest case per mission with a landing point and time.

    ``expected`` maps a review criterion to ``flag`` (a site-related cause of this mission counts against it) or
    ``clear`` (the site criteria of a mission whose failure, if any, was not about the site).
    """
    from lunarnav.catalog import load_criterion_map
    from lunarnav.history_features import load_features

    cm = load_criterion_map()
    feats = load_features()
    sites = {s.id: s for s in all_sites()}
    landers = load_landers()
    alias = {e.id: f"lander-{string.ascii_lowercase[i]}" for i, e in enumerate(landers)}
    cases = []
    for m in load_missions():
        site = sites.get(m.site_id or "") or sites.get(m.target_site_id or "")
        when = m.landing_utc or (site.landing_utc if site else None)
        if site is None or when is None:
            continue
        flagged = {cm[c.category] for c in m.causes if c.site_related and cm[c.category]}
        expected = {c: "flag" for c in sorted(flagged)}
        expected.update({c: "clear" for c in SITE_CRITERIA if c not in flagged})
        res = (feats.get(m.id, {}).get("features") or {}).get("terrain_resolution_m")
        cases.append({
            "mission_id": m.id, "lat": site.lat_deg, "lon": site.lon_deg, "landing_utc": when,
            "lander": alias[m.lander_id] if m.lander_id else "generic:top_deck",
            "launch_vehicle_id": m.launch_vehicle_id or "", "outcome": m.outcome, "expected": expected,
            "terrain_resolution_m": res, "group": "fine" if res is not None and res <= 20 else "coarse",
        })
    return cases


if __name__ == "__main__":
    import json
    import sys

    if sys.argv[1:] == ["export-cases"]:
        print(json.dumps(backtest_cases(), indent=2))
    else:
        sys.exit("usage: python -m lunarnav.history export-cases")
