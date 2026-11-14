"""Assemble the self-contained HTML report from engine results.

Nothing here computes a result. Each number is read from a result object and formatted by `fmt`; the exact
value sits next to the text in a `data-raw` attribute and the cell's identity in `data-key`, so the document
can be checked against the results it came from.
A result that is needed and absent raises `ReportInputError`.
"""

from __future__ import annotations

import base64
import hashlib
import math
import re
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta

from lunarnav.scenario import canonical_scenario_json, scenario_hash
from lunarnav.scenario.attribution import attribute_event

from . import figures
from .errors import ReportInputError, need, parse_generated_utc
from .fmt import (
    DASH,
    MARGIN_KIND_NOTE,
    NA,
    basis_label,
    case_label,
    esc,
    heading_facts_text,
    kind_notes,
    limit_text,
    num,
    qty,
    raw,
    signed,
    signed_kind,
    unit_label,
    utc,
    values_by_case,
    worst_case_text,
)
from .fonts import font_face_css
from .limits import applicable_limits, evaluate_search_sites, report_limits
from .style import CSS

REPORT_TITLE = "Mission analysis report"
SCENARIO_FILE = "scenario.json"
HOUR_S = 3600.0
CENSORED_LO = "before the analysed span (not a time)"
CENSORED_HI = "after the analysed span (not a time)"
WINDOW_NOTE = (
    "<p class='small'>Candidates are {m} min apart. A window runs from its first to its last open candidate and Duration is the time "
    "between them, so a window of one candidate lasts 0 h; the true edges lie within half a spacing of either end. Norm. margin "
    "is the margin divided by that constraint's margin scale, so constraints compare.</p>")
STATE_LABEL = {"pass": "PASS", "marginal": "MARGINAL", "fail": "FAIL", "unknown": "NOT EVALUATED"}

CONVENTIONS = (
    "Times are UTC with a Z suffix. Angles are degrees; latitude and longitude are planetocentric, east-positive, "
    "in the Moon Mean Earth frame on the 1737.4 km reference sphere; azimuth is clockwise from local north and "
    "elevation is above the local horizontal. Durations are hours. A signed margin is positive inside its limit. "
    "Three cases are evaluated: nominal, optimistic and pessimistic. Each bound combines the terrain-error bound "
    "on the horizon and, for power and state of charge, the lander-heading bound; where a range is shown it is the "
    "smallest to the largest value over the three cases."
)


def display_name(sc) -> str:
    """Scenario name with the lander's display name where the name is the catalogue's `<site> / <lander id>`."""
    prefix = f"{sc.site.name} / "
    lander_id = sc.name[len(prefix):] if sc.site.name and sc.name.startswith(prefix) else ""
    if lander_id and (sc.profile.id == lander_id or sc.profile.id.startswith(lander_id + "-")):
        return f"{sc.site.name} / {sc.profile.name}"
    return sc.name


def _worst_where(c) -> str:
    text = worst_case_text(c)
    return f" ({text})" if text else ""


def explain(c, ev=None) -> str:
    """One sentence per non-pass constraint, from the constraint verdict's own fields."""
    u = unit_label(c.unit)
    if getattr(c, "heading_dependent", False):
        rng = f"{qty(c.value_range[0], c.unit)} {DASH} {qty(c.value_range[1], c.unit)} {u}"
        return (f"{c.label}: {rng} against {limit_text(c.limit_min, c.limit_max, c.unit)}; no nominal value, because the lander "
                f"heading is unknown and the result depends on it. {c.heading_note}")
    head = f"{c.label}: {qty(c.value, c.unit)} {u} against {limit_text(c.limit_min, c.limit_max, c.unit)}"
    if c.state == "marginal":
        body = f"holds in the nominal case only; worst-case margin {qty(c.margin_worst, c.unit, plus=True)} {u}{_worst_where(c)}"
    elif c.state == "fail":
        body = (f"fails in the nominal case (margin {qty(c.margin, c.unit, plus=True)} {u}; "
                f"worst case {qty(c.margin_worst, c.unit, plus=True)} {u}{_worst_where(c)})")
    else:
        body = "not evaluated"
    return f"{head}; {body}" + ("; the value is a bound because the analysed data ends first" if c.censored else "") + "."


INTERVAL_PHRASE = {"dark": "longest dark span", "contact_gap": "longest contact gap", "sunlit": "sunlit interval"}
EDGE_PHRASE = {"sunset": "sunset", "sunrise": "sunrise", "earthset": "Earth set (loss of contact)",
               "earthrise": "Earth rise (contact regained)"}


def _bound_for(attr, key: str):
    return next((x for x in attr.constraints if x.key == key), None) if attr is not None else None


CAUSE_PHRASE = {"heading": "the lander heading", "terrain": "the terrain-error bound on the horizon",
                "both": "both the lander heading and the terrain-error bound", "none": None}


def _pct_range(r) -> str:
    return f"{qty(r[0], 'fraction')} {DASH} {qty(r[1], 'fraction')} %"


def spread_sentence(ev, c, attr=None) -> str:
    """Why the nominal value and its bounds differ, when they do. Every clause is the engine's: its bound attribution for the
    constraint (cause, contributions, edge shares) or, without one, the heading analysis of the evaluation."""
    if c.value_range is None or (c.value is not None and c.value_range[0] == c.value and c.value_range[1] == c.value):
        return ""
    cb = _bound_for(attr, c.key)
    h = getattr(ev, "heading", None)
    cause, contrib = None, None
    if cb is not None:
        cause, contrib = cb.cause, cb.contributions
    elif c.key == "min_state_of_charge" and h is not None and h.soc_min_total is not None:
        cause = h.cause
        contrib = {"total": h.soc_min_total, "heading": h.soc_min_heading_only, "terrain": h.soc_min_horizon_only}
    if cause is None:
        return "The engine gives no account of what moves this constraint between the three cases."
    phrase = CAUSE_PHRASE.get(cause)
    out = ("The three cases give the same value." if phrase is None else f"The engine attributes the spread to {phrase}.")
    if contrib and contrib.get("total") is not None:
        out += (f" Minimum state of charge over the cases {_pct_range(contrib['total'])}; moving only the heading "
                f"{_pct_range(contrib['heading'])}; moving only the horizon {_pct_range(contrib['terrain'])}.")
    if cb is None or cause not in ("terrain", "both"):
        return out
    if cb.explained_quantity.startswith("none"):
        soc = ""
        if cb.world_soc:
            soc = (" Minimum over the cases: " + ", ".join(f"{w} {qty(v, 'fraction')} %" for w, v in cb.world_soc.items() if v is not None) + "."
                   + (f" {cb.world_soc_note}" if cb.world_soc_note else ""))
        return f"{out} The engine's account of the horizon part: {cb.explained_quantity}.{soc}"
    ranked = [e for e in cb.events if e.share is not None and not all(w.clipped for w in e.worlds)]
    if not ranked or cb.spread_h <= 0:
        return out
    top = max(ranked, key=lambda e: abs(e.share))
    nom = top.worlds[0]
    where = ""
    if nom.az_deg is not None:
        where = f" (nominal: {utc(nom.et)}, azimuth {num(nom.az_deg)} deg, horizon {num(nom.horizon_elev_deg)} deg"
        if nom.blocker_dist_m is not None:
            where += f", blocker {num(nom.blocker_dist_m / 1000.0)} km away"
        where += f"; {nom.cause})"
    return (f"{out} The {INTERVAL_PHRASE[cb.interval_kind]} lasts {num(min(cb.interval_hours.values()))} to "
            f"{num(max(cb.interval_hours.values()))} h over the three cases; the {EDGE_PHRASE[top.kind]} edge accounts for "
            f"{num(top.share * 100.0)} % of that {num(cb.spread_h)} h spread{where}.")


def _num_or_none(x):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else x


def attribution_html(attr) -> str:
    """Per constraint that one interval sets: the interval in each world and the edge events behind the spread."""
    if attr is None or not attr.constraints:
        return ""
    blocks = []
    for cb in attr.constraints:
        k = cb.key
        hours = "".join(td(f"{w}: {num(h)} h", f"attr:{k}:hours:{w}", h) for w, h in cb.interval_hours.items())
        facts = [
            f"<tr><th>Interval</th><td>{esc(INTERVAL_PHRASE[cb.interval_kind])}; "
            f"{'the same night' if cb.same_interval and cb.interval_kind == 'dark' else 'overlapping in time' if cb.same_interval else 'not the same in all three cases'}</td></tr>",
            f"<tr><th>Duration per world</th><td><table class='inline'><tr>{hours}</tr></table></td></tr>",
            f"<tr><th>Spread</th>{td(num(cb.spread_h) + ' h', f'attr:{k}:spread_h', cb.spread_h)}</tr>",
            f"<tr><th>What the shares explain</th><td>{esc(cb.explained_quantity)}</td></tr>",
        ]
        if not cb.decomposable:
            facts.append(f"<tr><th>Edge decomposition</th><td>not given: {esc(cb.decomposition_note)}</td></tr>")
        if cb.world_soc:
            facts.append("<tr><th>Minimum state of charge per world</th><td><table class='inline'><tr>"
                         + "".join(td(f"{w}: {qty(v, 'fraction')} %", f"attr:{k}:soc:{w}", v) for w, v in cb.world_soc.items() if v is not None)
                         + "</tr></table>" + (f"<span class='small'>{esc(cb.world_soc_note)}</span>" if cb.world_soc_note else "") + "</td></tr>")
        rows = []
        for e in cb.events:
            for j, w in enumerate(e.worlds):
                share = (td(f"{num(e.share * 100.0)} %", f"attr:{k}:{e.role}:share", e.share, "num") if e.share is not None else td("n/a", cls="num")) if j == 0 else td("")
                if j > 0:
                    contrib = td("")
                elif e.contribution_h is None:
                    contrib = td("n/a", cls="num")
                else:
                    contrib = td(signed(e.contribution_h) + " h", f"attr:{k}:{e.role}:contribution_h", e.contribution_h, "num")
                if w.clipped:
                    when = td(utc(_num_or_none(w.et)) + " (outside the window or at the data edge)", f"attr:{k}:{e.role}:{w.world}:et", _num_or_none(w.et))
                else:
                    when = td(utc(_num_or_none(w.et)), f"attr:{k}:{e.role}:{w.world}:et", _num_or_none(w.et), "nw")
                rows.append(
                    td(f"{EDGE_PHRASE[e.kind]} ({e.role})" if j == 0 else "") + td(w.world) + when
                    + td(num(w.az_deg) if w.az_deg is not None else NA, f"attr:{k}:{e.role}:{w.world}:az", w.az_deg, "num")
                    + td(num(w.horizon_elev_deg) if w.horizon_elev_deg is not None else NA, f"attr:{k}:{e.role}:{w.world}:horizon", w.horizon_elev_deg, "num")
                    + td(num(w.blocker_dist_m / 1000.0) if w.blocker_dist_m is not None else NA, f"attr:{k}:{e.role}:{w.world}:blocker_m", w.blocker_dist_m, "num")
                    + td(w.cause, cls="small") + contrib + share)
        blocks.append(
            f"<h4>{esc(cb.label)}</h4><table class='kv'>{''.join(facts)}</table>"
            + table([th("Edge"), th("World"), th("Time (UTC)"), th("Azimuth (deg)", "num"), th("Horizon (deg)", "num"),
                     th("Blocker range (km)", "num"), th("Cause"), th("Contribution", "num"), th("Share", "num")], rows, cls="dense"))
    return ("<h3>Why the bounds differ</h3>"
            f"<p class='small'>{esc(attr.note)}. Where the engine decomposes a spread, shares are each edge's part of the spread of the interval's duration "
            "(mission-clipped), the two shares add to 1, and an edge outside the mission window explains nothing; where it does not, "
            "the row says why and prints no contribution or share. The blocker range is read from the "
            "nominal terrain profile at each world's limiting azimuth; the optimistic and pessimistic cases are brackets of the "
            "same terrain and carry no blocker of their own.</p>" + "".join(blocks))


def site_terrain(prov: dict) -> dict | None:
    """The site's terrain store entry; None is a result (smooth sphere), a missing key is not."""
    if "site_terrain" not in prov:
        raise ReportInputError("required result is absent: evaluation.provenance.site_terrain")
    return prov["site_terrain"]


def td(text: str, key: str | None = None, value: float | str | None = None, cls: str = "", extra: str = "") -> str:
    attrs = ""
    if key:
        attrs += f' data-key="{esc(key)}" data-raw="{esc(raw(value))}"'
    if cls:
        attrs += f' class="{cls}"'
    return f"<td{attrs}{extra}>{esc(text)}</td>"


def th(text: str, cls: str = "") -> str:
    return f'<th{f" class={chr(34)}{cls}{chr(34)}" if cls else ""}>{esc(text)}</th>'


def table(head: Iterable[str], rows: Iterable[str], caption: str = "", cls: str = "") -> str:
    cap = f"<caption>{esc(caption)}</caption>" if caption else ""
    return (f'<table{f" class={chr(34)}{cls}{chr(34)}" if cls else ""}>{cap}<thead><tr>{"".join(head)}</tr></thead>'
            f'<tbody>{"".join(f"<tr>{r}</tr>" for r in rows)}</tbody></table>')


def state_chip(state: str, key: str | None = None) -> str:
    k = f' data-key="{esc(key)}" data-raw="{esc(state)}"' if key else ""
    return f'<span class="state {esc(state)}"{k}>{esc(STATE_LABEL.get(state, state.upper()))}</span>'


def origin_text(origin) -> str:
    parts = [basis_label(origin.basis)]
    if origin.label:
        parts.append(origin.label)
    if origin.source_url:
        parts.append(origin.source_url)
    if origin.note:
        parts.append(origin.note)
    return " \u2014 ".join(parts)


def _constraint_by_key(ev, key: str):
    for c in ev.verdict.constraints:
        if c.key == key:
            return c
    raise ReportInputError(f"limiting constraint {key!r} is not among the verdict's constraints")


def terrain_stack_sentence(prov: dict) -> str | None:
    """The engine's record of which stores produced the horizons and who chose them; None on the smooth sphere (no stack)."""
    rec = need(prov, "terrain_stack", "evaluation.provenance")
    ids = rec["dem_ids"]
    if not ids:
        return None
    n = f"{len(ids)} store{'s' if len(ids) != 1 else ''} ({', '.join(ids)})"
    by = rec["chosen_by"]
    if by == "default":
        return f"Terrain stack: the engine's default stack, {n}."
    if by == "scenario":
        tail = "this is also the engine's default stack" if rec["is_default"] else "not the default stack"
        return (f"Terrain stack: restricted to {n}, {tail}; the scenario names its stores. "
                "Another choice of stores can give other horizons.")
    if by == "caller":
        return (f"Terrain stack: {n}, chosen by whoever ran the engine, not by the scenario and not the engine's default stack. "
                "Another choice of stores can give other horizons.")
    raise ReportInputError(f"unknown terrain_stack.chosen_by {by!r} in the evaluation provenance")


def section_answer(ev, attr=None) -> str:
    v = need(ev, "verdict", "evaluation")
    if not v.constraints:
        raise ReportInputError("the scenario has no active constraints: there is no verdict to report")
    if v.limiting is None:
        raise ReportInputError("the verdict names no limiting constraint")
    c = _constraint_by_key(ev, v.limiting)
    counts = {s: sum(x.state == s for x in v.constraints) for s in ("pass", "marginal", "fail", "unknown")}
    no_nominal = "no nominal value (lander heading unknown)"
    value_rows = [
        f"<tr><th>Limiting constraint</th>{td(c.label, 'answer:limiting', c.key)}</tr>",
        f"<tr><th>Value (nominal)</th>{td(no_nominal if c.value is None else f'{qty(c.value, c.unit)} {unit_label(c.unit)}', 'answer:value', c.value)}</tr>",
    ]
    if c.value_range is not None:
        value_rows.append(
            "<tr><th>Value over the bounds</th><td>"
            f'<span data-key="answer:range_lo" data-raw="{esc(raw(c.value_range[0]))}">{esc(qty(c.value_range[0], c.unit))}</span> {DASH} '
            f'<span data-key="answer:range_hi" data-raw="{esc(raw(c.value_range[1]))}">{esc(qty(c.value_range[1], c.unit))}</span> '
            f"{esc(unit_label(c.unit))} (smallest to largest; the cases are named in \"Value by case\")</td></tr>")
    if values_by_case(c, str):
        value_rows.append(f"<tr><th>Value by case</th>{td(values_by_case(c, lambda v: qty(v, c.unit) + ' ' + unit_label(c.unit)), 'answer:by_case')}</tr>")
    when_m = min_soc_when(ev) if c.key == "min_state_of_charge" else None
    if when_m is not None:
        value_rows.append(f"<tr><th>Minimum occurs (UTC)</th>{td(when_text(when_m, c), 'answer:when')}</tr>")
    facts = heading_facts_text(c)
    if facts:
        value_rows.append(f"<tr><th>Single headings</th>{td(facts, 'answer:heading_facts')}</tr>")
    value_rows += [
        f"<tr><th>Limit</th>{td(limit_text(c.limit_min, c.limit_max, c.unit), 'answer:limit', c.limit_min)}</tr>",
        f"<tr><th>Signed margin (nominal)</th>{td(no_nominal if c.margin is None else f'{qty(c.margin, c.unit, plus=True)} {unit_label(c.unit)}', 'answer:margin', c.margin)}</tr>",
        f"<tr><th>Worst-case margin over the bounds</th>"
        f"{td(f'{qty(c.margin_worst, c.unit, plus=True)} {unit_label(c.unit)}', 'answer:margin_worst', c.margin_worst)}</tr>",
        f"<tr><th>Constraint verdict</th><td>{state_chip(c.state, 'answer:state')}</td></tr>",
    ]
    if worst_case_text(c):
        value_rows.insert(-1, f"<tr><th>Where the worst-case margin is</th><td>{esc(worst_case_text(c))}</td></tr>")
    if c.censored:
        value_rows.append("<tr><th>Note</th><td>The nominal value is a bound: the analysed data ends before the quantity does.</td></tr>")
    others = [x for x in v.constraints if x.state != "pass"]
    why = "".join(f"<li>{esc(explain(x, ev))}"
                  + (f" {esc(spread_sentence(ev, x, attr))}" if x is not c else "")
                  + "</li>" for x in others)
    spread = spread_sentence(ev, c, attr)
    spread_html = f'<p class="spread"><b>Spread.</b> {esc(spread)}</p>' if spread else ""
    warn = "".join(f"<li>{esc(w)}</li>" for w in ev.warnings)
    if ev.provenance["terrain_stack"]["chosen_by"] != "default" and (sentence := terrain_stack_sentence(ev.provenance)):
        warn = f"<li>{esc(sentence)}</li>" + warn
    if warn:
        spread_html += f'<h3>Warnings from the engine</h3><ul class="limits">{warn}</ul>'
    hd = [x for x in v.constraints if getattr(x, "heading_dependent", False)]
    if hd:
        spread_html += ('<p class="spread"><b>Lander heading.</b> The heading is unknown, as for any lander before it lands, so there is '
                        "no nominal state of charge: the result is a range over all headings and the verdict follows the heading rule. "
                        + esc(" ".join(x.heading_note for x in hd)) + "</p>")
    why_html = f'<h3>What is not a clean pass</h3><ul class="limits">{why}</ul>' if why else ""
    overview = table(
        [th("Constraint"), th("Margin", "num"), th("Worst margin", "num"), th("Unit"), th("Verdict")],
        [td(x.label) + td(qty(x.margin, x.unit, plus=True), cls="num") + td(qty(x.margin_worst, x.unit, plus=True), cls="num") + td(unit_label(x.unit))
         + f"<td>{state_chip(x.state)}</td>" for x in v.constraints], caption="Every active constraint", cls="dense")
    word = STATE_LABEL[v.state]
    return (
        '<section id="answer"><h2>1. Answer</h2><div class="answer">'
        f'<div class="verdict {esc(v.state)}" data-key="verdict:state" data-raw="{esc(v.state)}">{esc(word)}</div>'
        f'<p class="lead">Overall verdict for <b>{esc(display_name(ev.scenario))}</b>, landing {esc(ev.scenario.landing_utc)}. '
        f'Constraints: {counts["pass"]} pass, {counts["marginal"]} marginal, {counts["fail"]} fail'
        f'{f", {counts["unknown"]} not evaluated" if counts["unknown"] else ""}.</p>'
        f'<table class="kv">{"".join(value_rows)}</table>{spread_html}{why_html}{overview}</div></section>')


def _is_model_default(profile, path: str) -> bool | None:
    """Whether the profile's value at `path` equals the model's declared default (None when the model has none)."""
    obj = profile
    parts = path.split(".")
    for part in parts[:-1]:
        obj = obj[int(part)] if part.isdigit() else getattr(obj, part)
    info = type(obj).model_fields.get(parts[-1])
    if info is None or info.is_required() or info.default_factory is not None:
        return None
    return getattr(obj, parts[-1]) == info.default


def _origin_for(profile, path: str):
    """Origin of a profile field: the entry for the path, else for its nearest ancestor path, else None (user input)."""
    parts = path.split(".")
    while parts:
        o = profile.origins.get(".".join(parts))
        if o is not None:
            return o
        parts.pop()
    return None


def _to_second(text: str) -> str:
    """An engine UTC string (with milliseconds) rounded to the nearest second, in the report's `...Z` form."""
    d = datetime.fromisoformat(text.replace("Z", "+00:00")) + timedelta(milliseconds=500)
    return d.replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def n10(v):
    return num(v, 10)


def _profile_rows(p) -> list[tuple[str, str, float | str | None, str]]:
    """(path, label with unit, value, text) per parameter."""
    rows: list[tuple[str, str, float | str | None, str]] = [
        ("array_height_m", "Array height above ground (m)", p.array_height_m, n10(p.array_height_m)),
        ("antenna_height_m", "Antenna height above ground (m)", p.antenna_height_m, n10(p.antenna_height_m)),
    ]
    if p.antenna_height_max_m is not None:
        rows.append(("antenna_height_max_m", "Antenna height upper bound (m)", p.antenna_height_max_m,
                     n10(p.antenna_height_max_m)))
    for i, panel in enumerate(p.panels):
        rows.append((f"panels.{i}.area_m2", f"Panel {i + 1} area (m\u00b2), {panel.name}", panel.area_m2, n10(panel.area_m2)))
        rows.append((f"panels.{i}.efficiency", f"Panel {i + 1} efficiency", panel.efficiency, n10(panel.efficiency)))
        rows.append((f"panels.{i}.normal", f"Panel {i + 1} normal (body x, y, z)", None,
                     ", ".join(n10(c) for c in panel.normal_body) + (" (sun-tracking)" if panel.tracking else "")))
    a = p.attitude
    rows += [("attitude.yaw_deg", "Heading, clockwise from north (deg)", a.yaw_deg,
              f"unknown: all {len(a.yaws())} headings are evaluated" if a.yaw_deg is None else n10(a.yaw_deg)),
             ("attitude.yaw_uncertainty_deg", "Heading uncertainty (deg)", a.yaw_uncertainty_deg,
              "not used (heading unknown)" if a.yaw_deg is None else n10(a.yaw_uncertainty_deg)),
             ("attitude.tilt_deg", "Tilt (deg)", a.tilt_deg, n10(a.tilt_deg))]
    b = p.battery
    rows += [("battery.capacity_wh", "Battery capacity (Wh)", b.capacity_wh, n10(b.capacity_wh)),
             ("battery.charge_efficiency", "Charge efficiency", b.charge_efficiency, n10(b.charge_efficiency)),
             ("battery.discharge_efficiency", "Discharge efficiency", b.discharge_efficiency, n10(b.discharge_efficiency)),
             ("battery.max_dod", "Maximum depth of discharge", b.max_dod, n10(b.max_dod)),
             ("battery.initial_soc", "State of charge at landing", b.initial_soc, n10(b.initial_soc)),
             ("loads.sunlit_w", "Sunlit load (W)", p.loads.sunlit_w, n10(p.loads.sunlit_w)),
             ("loads.dark_w", "Dark (survival) load (W)", p.loads.dark_w, n10(p.loads.dark_w))]
    if p.link is not None:
        k = p.link
        rows += [("link.eirp_dbw", "Link EIRP (dBW)", k.eirp_dbw, n10(k.eirp_dbw)),
                 ("link.frequency_hz", "Link frequency (Hz)", k.frequency_hz, n10(k.frequency_hz)),
                 ("link.data_rate_bps", "Data rate (bit/s)", k.data_rate_bps, n10(k.data_rate_bps)),
                 ("link.required_ebn0_db", "Required Eb/N0 (dB)", k.required_ebn0_db, n10(k.required_ebn0_db)),
                 ("link.required_margin_db", "Required link margin (dB)", k.required_margin_db, n10(k.required_margin_db))]
    return rows


def terrain_error_html(ev, ter) -> str:
    """The terrain-error model as the engine applied it: mode, sigma multiplier, the sigma ranges used on each horizon and the
    per-store budget with its basis and source. The scenario's scalar sigmas appear only in custom mode, where they are used."""
    prov = ev.provenance
    te = need(prov, "terrain_error", "evaluation.provenance")
    hz = need(prov, "horizons", "evaluation.provenance")
    applied = [k for k in ("array", "antenna") if (hz.get(k) or {}).get("widened")]
    if not te.get("enabled") or ter is None or not applied:
        why = ("the scenario turns it off" if not te.get("enabled") else "no terrain is used, so there is nothing to widen")
        return f"<p><b>Terrain error model:</b> not applied ({why}); the three cases share one horizon.</p>"
    out = [f"<p><b>Terrain error model:</b> applied in <b>{esc(te['mode'])}</b> mode at "
           f'<span data-key="terr:k_sigma" data-raw="{esc(raw(te["k_sigma"]))}">{esc(num(te["k_sigma"]))}</span> sigma.</p>']
    rows, used = [], set()
    for k, name in (("array", "Array horizon"), ("antenna", "Antenna horizon")):
        b = (hz.get(k) or {}).get("budget")
        if not b:
            continue
        used.update(b.get("store_index") or [])
        zr, xr = b["sigma_z_m"], b["sigma_xy_m"]
        rows.append(td(name) + td(f"{num(zr[0])} {DASH} {num(zr[1])}", f"terr:{k}:sigma_z_lo", zr[0], "num", f' data-raw-hi="{esc(raw(zr[1]))}"')
                    + td(f"{num(xr[0])} {DASH} {num(xr[1])}", f"terr:{k}:sigma_xy_lo", xr[0], "num", f' data-raw-hi="{esc(raw(xr[1]))}"'))
    out.append(table([th("Horizon"), th("Vertical sigma used (m)", "num"), th("Horizontal sigma used (m)", "num")], rows,
                     caption="Sigma applied to the horizon at the sampled azimuths (smallest to largest over the terrain stores the horizon crossed)"))
    if te["mode"] == "custom":
        out.append(f"<p>Planner-set sigma: vertical {esc(num(te['sigma_z_m']))} m, horizontal {esc(num(te['sigma_xy_m']))} m "
                   f"(origin: {esc(origin_text(ev.scenario.terrain_error.origin))}).</p>")
    else:
        stores = te.get("stores") or []
        srows = [td(st["dem_id"], cls="mono") + td(num(st["sigma_z_m"]), f"terr:{st['dem_id']}:sigma_z", st["sigma_z_m"], "num")
                 + td(num(st["sigma_xy_m"]), f"terr:{st['dem_id']}:sigma_xy", st["sigma_xy_m"], "num") + td(st["basis_z"]) + td(st["basis_xy"])
                 + td(st["source"] + ". " + st["note"], cls="small")
                 for i, st in enumerate(stores) if i in used]
        out.append(table([th("Terrain store"), th("Vertical (m)", "num"), th("Horizontal (m)", "num"), th("Vertical basis"), th("Horizontal basis"), th("Source and note")], srows,
                         caption="Per-store sigma of the stores the horizons used. A basis of \"assumed\" means no measurement exists for that figure"))
        out.append(seam_html(hz))
    return "".join(out)


def seam_html(hz: dict) -> str:
    """The engine's near-field store-seam finding for the array horizon (empty when no seam is within the near field)."""
    seam = ((hz.get("array") or {}).get("provenance") or {}).get("near_field_seam")
    if not seam or not seam.get("present"):
        return ""
    return (f"<p><b>Near-field store seam.</b> The {esc(seam['ground_store'])} and {esc(seam['other_store'])} stores meet "
            f"{esc(num(seam['distance_m']))} m from the lander. Their heights differ by a median {esc(num(seam['step_median_m']))} m "
            f"(95th percentile {esc(num(seam['step_p95_m']))} m) over {esc(str(seam['n_crossings']))} crossings, which can move the "
            f"horizon by {esc(num(seam['horizon_shift_deg']))} deg.</p>")


def section_scenario(ev) -> str:
    sc = ev.scenario
    prov = ev.provenance
    ter = site_terrain(prov)
    analysis = need(prov, "analysis", "evaluation.provenance")
    site_rows = [
        f"<tr><th>Name</th><td>{esc(sc.site.name or NA)}"
        f"{f' (catalogue id {esc(sc.site.catalog_id)})' if sc.site.catalog_id else ''}</td></tr>",
        f"<tr><th>Latitude (deg)</th>{td(n10(sc.site.lat_deg), 'site:lat_deg', sc.site.lat_deg, 'num')}</tr>",
        f"<tr><th>Longitude (deg east)</th>{td(n10(sc.site.lon_deg), 'site:lon_deg', sc.site.lon_deg, 'num')}</tr>",
    ]
    if ter is None:
        site_rows.append("<tr><th>Terrain used</th><td>None: smooth sphere at the observer heights "
                         f"(provider {esc(ev.provider_name)}). No topography enters the horizon.</td></tr>")
    else:
        site_rows.append(
            f"<tr><th>Terrain store at the site</th><td><span class='mono'>{esc(ter['dem_id'])}</span>, pixel "
            f'<span data-key="site:pixel_m" data-raw="{esc(raw(ter["pixel_m"]))}">{esc(num(ter["pixel_m"]))}</span> m '
            f"(finest store with valid data at the site; provider {esc(ev.provider_name)})</td></tr>")
    if (stack_text := terrain_stack_sentence(prov)) is not None:
        site_rows.append(f"<tr><th>Terrain stack</th><td>{esc(stack_text.removeprefix('Terrain stack: '))}</td></tr>")
    site_rows.append(
        f"<tr><th>Observer heights</th><td>array {esc(num(sc.profile.array_height_m))} m, "
        f"antenna {esc(num(sc.profile.antenna_height_m))} m above local ground</td></tr>")
    epoch_rows = [
        f"<tr><th>Landing epoch (UTC)</th>{td(sc.landing_utc, 'scenario:landing_utc', sc.landing_utc)}</tr>",
        f"<tr><th>Surface mission duration (h)</th>{td(num(sc.mission_duration_h), 'scenario:duration_h', sc.mission_duration_h, 'num')}</tr>",
        f"<tr><th>Analysed span (UTC)</th><td>{esc(_to_second(analysis['t_first_utc']))} {DASH} {esc(_to_second(analysis['t_last_utc']))} "
        f"({esc(num(sc.sampling.lookback_h))} h before landing to find the last sunrise)</td></tr>",
        f"<tr><th>Sampling step (s)</th>{td(num(sc.sampling.step_s), 'scenario:step_s', sc.sampling.step_s, 'num')}</tr>",
    ]
    if sc.transfer is not None:
        t = sc.transfer
        epoch_rows.append(f"<tr><th>Transfer</th><td>{esc(t.kind)}"
                          f"{f', {num(t.duration_days)} days' if t.kind == 'fixed' else f', {len(t.table)} launch opportunities'}; "
                          f"{esc(origin_text(t.origin))}</td></tr>")
    prof_rows = []
    for path, label, value, text in _profile_rows(sc.profile):
        o = _origin_for(sc.profile, path)
        if o is not None:
            basis, src = o.basis, origin_text(o)
        elif _is_model_default(sc.profile, path):
            basis, src = "default", "No origin recorded: the model's default value, not data about this lander."
        else:
            basis, src = "unrecorded", "No origin recorded: the value differs from the model default and nothing says where it came from."
        flag = basis_label(basis)
        prof_rows.append(td(label) + td(text, f"profile:{path}", value, "num") + td(flag) + td(src, cls="small"))
    cons = sc.constraints
    cons_rows = []
    for key, lim in cons.active().items():
        cons_rows.append(
            td(lim.label) + td(limit_text(lim.min, lim.max, lim.unit), f"limit:{key}", lim.min if lim.min is not None else lim.max)
            + td(basis_label(lim.origin.basis)) + td(origin_text(lim.origin), cls="small"))
    for p in (cons.sunlit_flux_fraction, cons.antenna_terrain_margin_deg, cons.slope_baseline_m):
        cons_rows.append(td(p.label) + td(f"{qty(p.value, p.unit, digits=10)} {unit_label(p.unit)}") + td(basis_label(p.origin.basis)) + td(origin_text(p.origin), cls="small"))
    net = sc.network
    if net.stations:
        net_rows = [td(s.id) + td(s.name or NA) + td(s.network or NA)
                    + td(n10(s.lat_deg), f"station:{s.id}:lat", s.lat_deg, "num") + td(n10(s.lon_deg), f"station:{s.id}:lon", s.lon_deg, "num")
                    + td(n10(s.rx_mask_deg), f"station:{s.id}:rx", s.rx_mask_deg, "num") + td(n10(s.tx_mask_deg), f"station:{s.id}:tx", s.tx_mask_deg, "num")
                    + td(NA + " (unknown; 0 is a placeholder)" if s.alt_basis == "unknown" else n10(s.alt_m), f"station:{s.id}:alt", s.alt_m, "num")
                    + td(s.alt_basis) + td(basis_label(s.origin.basis)) for s in net.stations]
        net_html = table([th("Station"), th("Name"), th("Network"), th("Lat (deg)", "num"), th("Lon (deg E)", "num"),
                          th("Rx mask (deg)", "num"), th("Tx mask (deg)", "num"), th("Altitude (m)", "num"), th("Altitude basis"), th("Basis")], net_rows,
                         caption=f"Ground network: {net.label or 'unnamed'}; contact uses the {net.direction} mask", cls="dense")
    else:
        net_html = ("<p><b>Ground network:</b> none. Contact is geometric direct-to-Earth: the Earth centre above the "
                    "antenna horizon plus the clearance margin, with no Earth-side mask.</p>")
    ecl = need(prov, "eclipse", "evaluation.provenance")
    eclipse_html = (
        f"<p><b>Eclipse convention:</b> {esc(ecl['shadow'])} shadow, occulting radius "
        f'<span data-key="eclipse:radius_km" data-raw="{esc(raw(ecl["occulting_radius_km"]))}">{esc(num(ecl["occulting_radius_km"]))}</span> km '
        f"(atmosphere {esc(num(ecl['atmosphere_km']))} km); {esc(origin_text(sc.eclipse.origin))}.</p>")
    terr_html = terrain_error_html(ev, ter)
    return (
        '<section id="scenario"><h2>2. Scenario</h2>'
        f'<div class="conv"><b>Conventions.</b> {esc(CONVENTIONS)}</div>'
        f'<h3>Site</h3><table class="kv">{"".join(site_rows)}</table>'
        f'<h3>Landing epoch and duration</h3><table class="kv">{"".join(epoch_rows)}</table>'
        f'<h3>Lander profile: {esc(sc.profile.name)}</h3>'
        + (f"<p class='small'>{esc(sc.profile.description.replace(chr(96), ''))}</p>" if sc.profile.description else "")
        + table([th("Parameter"), th("Value", "num"), th("Basis"), th("Source")], [r for r in prof_rows])
        + '<h3>Constraints and where each limit came from</h3>'
        + table([th("Constraint"), th("Limit"), th("Basis"), th("Source")], cons_rows)
        + f"<h3>Ground network</h3>{net_html}<h3>Eclipse and terrain conventions</h3>{eclipse_html}{terr_html}"
        + (f"<p><b>Notes:</b> {esc(sc.notes)}</p>" if sc.notes else "") + "</section>")


CASE_ORDER = ("nominal", "optimistic", "pessimistic")


def when_text(m, c=None) -> str:
    """When an extreme occurs, per case, from the engine's `Metric.when` (empty for a metric that is not an extreme): the UTC instant,
    the extreme's value in that case, and how long the quantity holds it from there when that is not an instant. `c` is the constraint
    verdict of the same quantity, which names the cases (`case_label`)."""
    when = getattr(m, "when", None) or {}
    parts = []
    for case in CASE_ORDER:
        if case not in when:
            continue
        w = when[case]
        name = case_label(c, case, True) if c is not None else case
        parts.append(f"{name}: none (no value in this case)" if w is None else
                     f"{name}: {w.utc}, {qty(w.value, m.unit)} {unit_label(m.unit)}"
                     + (f", held for {num(round(w.hold_s / 3600.0, 3))} h" if w.hold_s > 0 else ""))
    return "; ".join(parts)


def min_soc_when(ev):
    """The `min_state_of_charge` metric when it states when the minimum occurs (`Metric.when`), else None."""
    return next((m for m in getattr(ev, "metrics", ()) if m.key == "min_state_of_charge" and getattr(m, "when", None)), None)


def basis_paragraph(m) -> str:
    """The engine's method-and-accuracy sentence of the instants in `m.when`, with its signal-grid step."""
    step = getattr(m, "when_resolution_s", None)
    return (f"<p class='small'><b>When ({esc(m.label)}).</b> {esc(m.when_basis)}"
            + (f" Signal-grid step {esc(num(step))} s." if step is not None else "") + "</p>")


def section_constraints(ev) -> str:
    rows = []
    for c in ev.verdict.constraints:
        k = c.key
        rng_lo = None if c.value_range is None else c.value_range[0]
        rng_hi = None if c.value_range is None else c.value_range[1]
        rows.append(
            td(c.label)
            + td(("no nominal (heading unknown)" if c.value is None else qty(c.value, c.unit)) + (" (bound)" if c.censored else ""),
                 f"constraint:{k}:value", c.value, "num")
            + td(f"{qty(rng_lo, c.unit)} {DASH} {qty(rng_hi, c.unit)}" if c.value_range else NA, f"constraint:{k}:range", rng_lo, "num",
                 f' data-raw-hi="{esc(raw(rng_hi))}"')
            + td(values_by_case(c, lambda v, u=c.unit: qty(v, u), short=True), f"constraint:{k}:by_case", None, "small bycase")
            + td(unit_label(c.unit))
            + td(limit_text(c.limit_min, c.limit_max, c.unit, with_unit=False), f"constraint:{k}:limit", c.limit_min, "num",
                 f' data-raw-max="{esc(raw(c.limit_max))}"')
            + td(qty(c.margin, c.unit, plus=True), f"constraint:{k}:margin", c.margin, "num")
            + td(qty(c.margin_worst, c.unit, plus=True), f"constraint:{k}:margin_worst", c.margin_worst, "num")
            + td(worst_case_text(c, short=True), f"constraint:{k}:worst_case", c.worst_world, cls="small wholeword")
            + f"<td>{state_chip(c.state, f'constraint:{k}:state')}</td>")
    head = [th("Constraint"), th("Value", "num"), th("Range over bounds", "num"), th("Value by case"), th("Unit"), th("Limit", "num"),
            th("Margin", "num"), th("Worst margin", "num"), th("Worst margin is in"), th("Verdict")]
    mrows = []
    for m in ev.metrics:
        mrows.append(
            td(m.label) + td("no nominal value" if m.value is None and m.low is not None else qty(m.value, m.unit), f"metric:{m.key}:value", m.value, "num")
            + td(qty(m.low, m.unit), f"metric:{m.key}:low", m.low, "num") + td(qty(m.high, m.unit), f"metric:{m.key}:high", m.high, "num")
            + td(unit_label(m.unit)) + td((f"Occurs at: {when_text(m)}. " if when_text(m) else "") + ("bound, data ends first. " if m.censored else "")
                                          + ("one-sided: the range is over the cases that have the event; the others have none in the analysed span. "
                                             if getattr(m, "one_sided", False) else "") + m.note, cls="small"))
    return (
        '<section id="constraints"><h2>3. Constraint table</h2>'
        "<p class='small'>Margin is the nominal signed margin in the constraint's unit, positive inside the limit. Worst margin is the "
        "smallest margin over the nominal, optimistic and pessimistic cases; \"Worst margin is in\" names the case and the limit the engine "
        "reports for it (it is not always the pessimistic case). \"min limit\" and \"max limit\" name the side that binds. Optimistic and pessimistic are the lower and the upper horizon bracket, or, with an "
        "unknown lander heading, the upper and the lower bound over headings. Pass holds in the worst case; Marginal holds "
        "nominally only; Fail does not hold nominally.</p>"
        + table(head, rows)
        + "".join(f"<p class='small'><b>{esc(x.label)}, single headings.</b> {esc(heading_facts_text(x))}</p>"
                  for x in ev.verdict.constraints if heading_facts_text(x))
        + (f"<p class='small'><b>Minimum state of charge occurs at (UTC).</b> {esc(when_text(w, next((x for x in ev.verdict.constraints if x.key == 'min_state_of_charge'), None)))}.</p>"
           + basis_paragraph(w) if (w := min_soc_when(ev)) is not None else "")
        + "<h3>Headline metrics with bounds</h3>"
        + table([th("Metric"), th("Nominal", "num"), th("Low", "num"), th("High", "num"), th("Unit"), th("Note")], mrows)
        + "</section>")


def _unique_ids(svg: str, prefix: str) -> str:
    """Prefix every id in an SVG (and its references) so ids stay unique across the figures in one document."""
    ids = set(re.findall(r'\bid="([^"]+)"', svg))
    if not ids:
        return svg
    pat = "|".join(re.escape(i) for i in sorted(ids, key=len, reverse=True))
    svg = re.sub(rf'\bid="({pat})"', lambda m: f'id="{prefix}{m.group(1)}"', svg)
    svg = re.sub(rf'url\(#({pat})\)', lambda m: f"url(#{prefix}{m.group(1)})", svg)
    return re.sub(rf'href="#({pat})"', lambda m: f'href="#{prefix}{m.group(1)}"', svg)


def _figure(svg: str, caption: str, n: int) -> str:
    svg = _unique_ids(svg, f"f{n}-")
    return f"<figure>{svg}<figcaption><b>Figure {n}.</b> {esc(caption)}</figcaption></figure>"


def slip_table(slip, labels: dict[str, str]) -> str:
    rows = []
    for i, r in enumerate(slip.rows):
        lim = labels.get(r.limiting, r.limiting) if r.limiting else NA
        rows.append(
            td(num(r.slip_h), f"slip:{i}:slip_h", r.slip_h, "num") + td(r.launch_utc or NA) + td(r.landing_utc or NA, f"slip:{i}:landing", r.landing_utc)
            + f"<td>{state_chip(r.state, f'slip:{i}:state')}</td>" + td(lim, f"slip:{i}:limiting", r.limiting)
            + td(signed_kind(r.margin, r.margin_kind), f"slip:{i}:margin", r.margin, "num")
            + td(r.next_open_utc or NA, f"slip:{i}:next_open", r.next_open_utc)
            + (f"<td>{state_chip(r.next_open_state, f'slip:{i}:next_open_state')}</td>" if r.next_open_state else td(NA))
            + td(num(round(r.next_open_wait_h, 6)) if r.next_open_wait_h is not None else NA, f"slip:{i}:wait_h", r.next_open_wait_h, "num"))
    out = table([th("Slip (h)", "num"), th("Launch (UTC)"), th("Landing (UTC)"), th("Verdict"), th("Limiting"),
                 th("Norm. margin", "num"), th("Next open landing (UTC)"), th("State there"), th("Wait (h)", "num")], rows,
                caption=MARGIN_KIND_NOTE, cls="dense")
    why = [f"<li>Slip {esc(num(r.slip_h))} h: {esc(r.margin_note)}</li>" for r in slip.rows if r.margin_note and (r.margin is None or r.margin_kind == "best_case")]
    return out + (f"<p class='small'>Slips with no margin, or a margin that needs explaining, in the engine's words:</p><ul class='limits'>{''.join(why)}</ul>" if why else "")


def notes_paragraph(notes: list[str]) -> str:
    return "".join(f"<p class='small'>Margin note (engine): {esc(n)}.</p>" for n in notes)


def windows_table(scan, labels: dict[str, str]) -> str:
    rows = []
    for i, w in enumerate(scan.windows):
        rows.append(
            td(utc(w.start_et), f"window:{i}:start", w.start_et) + td(utc(w.end_et), f"window:{i}:end", w.end_et)
            + td(num(w.duration_h), f"window:{i}:duration_h", w.duration_h, "num") + td(str(w.n_candidates), f"window:{i}:n", w.n_candidates, "num")
            + td(str(w.n_pass), f"window:{i}:n_pass", w.n_pass, "num") + td(utc(w.best_et), f"window:{i}:best", w.best_et)
            + f"<td>{state_chip(w.best_state)}</td>" + td(signed_kind(w.best_margin, w.best_margin_kind), f"window:{i}:best_margin", w.best_margin, "num")
            + td(labels.get(w.best_limiting, w.best_limiting) if w.best_limiting else NA))
    return table([th("Opens (UTC)"), th("Closes (UTC)"), th("Duration (h)", "num"), th("Candidates", "num"), th("Pass", "num"),
                  th("Best candidate (UTC)"), th("Best state"), th("Best norm. margin", "num"), th("Limiting")], rows, caption=MARGIN_KIND_NOTE, cls="dense") + notes_paragraph(
        kind_notes((w.best_margin_kind, w.best_margin_note) for w in scan.windows))


def comparison_table(cmp) -> str:
    names = need(cmp, "names", "comparison")
    head = [th("Metric")] + [th(n, "num") for n in names] + [th("Unit")]
    rows = []
    rows.append(td("Verdict") + "".join(f"<td class='num'>{state_chip(s, f'compare:state:{j}')}</td>" for j, s in enumerate(cmp.states)) + td(""))
    rows.append(td("Limiting constraint") + "".join(td(lim or NA, f"compare:limiting:{j}", lim, "num") for j, lim in enumerate(cmp.limiting)) + td(""))
    for i, key in enumerate(cmp.metric_keys):
        cells = ""
        for j in range(len(names)):
            v, lo, hi = cmp.values[i, j], cmp.low[i, j], cmp.high[i, j]
            isn = math.isnan(v)
            u = cmp.metric_units[i]
            m = next((x for x in cmp.evaluations[j].metrics if x.key == key), None)
            bound = (" (bound)" if m is not None and m.censored else "") + (" (one-sided)" if m is not None and m.one_sided else "")
            no_nominal = isn and not (math.isnan(lo) or math.isnan(hi))
            txt = f"no nominal [{qty(float(lo), u)} {DASH} {qty(float(hi), u)}]" if no_nominal else NA if isn else qty(float(v), u) + bound + ("" if math.isnan(lo) or (lo == v == hi) else f" [{qty(float(lo), u)} {DASH} {qty(float(hi), u)}]")
            cells += td(txt, f"compare:{key}:{j}", None if isn else float(v), "num")
        rows.append(td(cmp.metric_labels[i]) + cells + td(unit_label(cmp.metric_units[i])))
    return table(head, rows, caption="Comparison matrix: nominal value, with the smallest-to-largest range over the three cases in brackets where it is not a point. (bound): the value is only a bound, the data ends before the quantity does. (one-sided): the range is over the cases that have the event")


def section_figures(ev, scan, slip, cmp) -> str:
    out = ['<section id="figures"><h2>4. Figures</h2>']
    labels = {k: v.label for k, v in ev.scenario.constraints.active().items()}
    n = 1
    out.append(_figure(figures.timeline(ev),
                       "Mission timeline from landing. Top: Sun and Earth elevation. Strips: sunlit (array), Earth eclipse, "
                       "network contact and contact per station; solid bars are the nominal case, hatched bars the range of each edge "
                       "between the optimistic and pessimistic cases. Bottom: battery state of charge, "
                       + ("with the lander heading unknown there is no nominal state of charge: the shaded band is the range between "
                          "the pessimistic (dotted) and optimistic (dash-dot) cases over all headings and the terrain bound, and no "
                          "expected-outcome curve is drawn."
                          if figures.soc_has_no_nominal(ev) else
                          "nominal with the pessimistic (dotted) and optimistic (dash-dot) cases."), n))
    n += 1
    out.append(_figure(figures.panorama(ev),
                       "Horizon panorama as seen from the lander (azimuth clockwise from north, elevation in degrees) with the Sun and "
                       "Earth paths over the mission. Bands show the horizon bracket; the antenna horizon is for the antenna height.", n))
    n += 1
    if scan is not None:
        c = scan.counts()
        out.append(_figure(figures.calendar(scan),
                           "Landing opportunity calendar. Each row is one lunation, each column a time after new moon; the cell shows the best "
                           f"verdict among the candidates in it. Candidates: {c.get('pass', 0)} pass, {c.get('marginal', 0)} marginal, "
                           f"{c.get('fail', 0)} fail.", n))
        n += 1
        closing, shares = scan.closing_constraints(), scan.closing_fraction()
        crow = [td(labels.get(k, k)) + td(str(v), f"scan:closing:{k}", v, "num")
                + td("n/a" if shares[k] is None else f"{num(shares[k] * 100.0)} %", f"scan:closing_share:{k}", shares[k], "num") for k, v in closing.items()]
        out.append(table([th("Constraint that closes a failing candidate"), th("Candidates", "num"), th("Share of failing candidates", "num")], crow))
        out.append("<h3>Open landing windows</h3>" + (windows_table(scan, labels) + WINDOW_NOTE.format(m=num(scan.spacing_s / 60.0)) if scan.windows else "<p>No open window in the scanned range.</p>"))
    if slip is not None:
        out.append(_figure(figures.slip_curve(slip),
                           "Slip curve: the normalised margin of the limiting constraint (margin divided by that constraint's "
                           "margin scale) versus slip, and the wait to the next open landing candidate. A margin is the worst case, except at a failing slip, "
                           "which reports the nominal margin (ring) or, where the limiting constraint has no nominal, the margin at the upper bound over "
                           "headings (square). Margins of different kinds are not comparable, so points of different kinds are never joined by a line. A diamond at 0 h marks a slip with no "
                           "open landing found in the searched range (it is not a wait of zero).", n))
        n += 1
        out.append(slip_table(slip, labels))
    if cmp is not None:
        out.append("<h3>Comparison matrix</h3>" + comparison_table(cmp))
    out.append("</section>")
    return "".join(out)


def only_in(worlds) -> str:
    """The case an optimistic-only row exists in, as the engine labels it; unlabelled rows are described without one."""
    return "a case other than the nominal one" if worlds is None else f"the {worlds[0]} case"


def _event_rows(ev, provider) -> list[tuple[float, str]]:
    t0, t1 = ev.t_land_et, ev.t_land_et + ev.mission_s
    ivs = need(ev, "intervals", "evaluation")
    items: list[tuple[float, str]] = []
    first_after_landing: set[str] = set()

    def cause_note(kind: str) -> str:
        """The engine's cause for the first `kind` event after landing, once; later events carry no attribution."""
        if kind in first_after_landing:
            return ""
        first_after_landing.add(kind)
        att = attribute_event(ev, kind, provider=provider)
        if att is None:
            return ""
        if att.cause == "Earth eclipse":
            return f"set by the Earth's shadow (it covers {num(att.eclipse_fraction * 100.0)} % of the Sun's disc), not by the horizon"
        return f"cause: {att.cause}"

    def named(kind: str, et: float, fallback: str) -> str:
        """The engine's name for the event (`NextEvent.name`: sunset, eclipse start, sunlight loss, loss of contact, ...)."""
        nxt = ev.next_event(kind, et - 1.0)
        if nxt is None or abs(nxt.et - et) > 1.0e-3 or nxt.name == kind:
            return fallback
        return nxt.name[:1].upper() + nxt.name[1:]

    def edge(kind: str, name: str, idx: int, nominal: float | None, rng: tuple[float, float], note: str,
             lo_censored: bool = False, hi_censored: bool = False, worlds=None) -> None:
        sort_t = nominal if nominal is not None else rng[0]
        lo = (td(CENSORED_LO, f"event:{kind}:{idx}:earliest", None) if lo_censored
              else td(utc(rng[0]), f"event:{kind}:{idx}:earliest", rng[0], "nw"))
        hi = (td(CENSORED_HI, f"event:{kind}:{idx}:latest", None) if hi_censored
              else td(utc(rng[1]), f"event:{kind}:{idx}:latest", rng[1], "nw"))
        items.append((sort_t, td(name) + td(utc(nominal), f"event:{kind}:{idx}:nominal", nominal, "nw") + lo + hi
                      + td("" if worlds is None else f"{worlds[0]} / {worlds[1]}", f"event:{kind}:{idx}:cases", None if worlds is None else "/".join(worlds), "small")
                      + td(note, cls="small")))

    sunlit = ivs["sunlit"]
    before = [i for i, r in enumerate(sunlit) if r.nominal and not r.start_censored and r.start_et < t0]
    for i, r in enumerate(sunlit):
        if r.nominal and not r.start_censored and (t0 <= r.start_et <= t1 or (before and i == before[-1])):
            edge("sunrise", named("sunrise", r.start_et, "Sunrise (half flux)"), i, r.start_et, r.start_range,
                 "; ".join(x for x in ("before landing" if r.start_et < t0 else cause_note("sunrise"),
                                       "" if r.certain else "the pessimistic case never opens this interval") if x),
                 lo_censored=r.start_range_censored, worlds=r.start_worlds)
        if r.nominal and not r.end_censored and t0 <= r.end_et <= t1:
            edge("sunset", named("sunset", r.end_et, "Sunset (half flux)"), i, r.end_et, r.end_range, cause_note("sunset") if r.end_et > t0 else "",
                 hi_censored=r.end_range_censored, worlds=r.end_worlds)
        if not r.nominal and t0 <= r.start_range[0] <= t1:
            edge("sunlit_optimistic", "Sunlit interval, optimistic case only", i, None, r.start_range, f"opens and closes only in {only_in(r.start_worlds)} (lower horizon)",
                 lo_censored=r.start_range_censored, hi_censored=r.end_range_censored, worlds=r.start_worlds)
    contact = need(ivs, "contact", "evaluation.intervals")
    for i, r in enumerate(contact):
        if r.nominal and not r.start_censored and t0 <= r.start_et <= t1:
            edge("contact_start", named("earthrise", r.start_et, "Network contact acquired"), i, r.start_et, r.start_range,
                 "" if r.certain else "the pessimistic case never opens this interval", lo_censored=r.start_range_censored,
                 worlds=r.start_worlds)
        if r.nominal and not r.end_censored and t0 <= r.end_et <= t1:
            edge("contact_end", named("earthset", r.end_et, "Network contact lost"), i, r.end_et, r.end_range, "", hi_censored=r.end_range_censored,
                 worlds=r.end_worlds)
    for i, r in enumerate(contact):
        if not r.nominal and t0 <= r.start_range[0] <= t1:
            edge("contact_optimistic", "Network contact, optimistic case only", i, None, r.start_range,
                 f"opens and closes only in {only_in(r.start_worlds)}", lo_censored=r.start_range_censored,
                 hi_censored=r.end_range_censored, worlds=r.start_worlds)
    for i, r in enumerate(need(ivs, "eclipse", "evaluation.intervals")):
        if not r.start_censored and t0 <= r.start_et <= t1:
            edge("eclipse_start", "Earth eclipse begins", i, r.start_et, r.start_range, "geometry, no horizon dependence", worlds=r.start_worlds)
        if not r.end_censored and t0 <= r.end_et <= t1:
            edge("eclipse_end", "Earth eclipse ends", i, r.end_et, r.end_range, "geometry, no horizon dependence", worlds=r.end_worlds)
    return items


def section_events(ev, provider, attr=None) -> str:
    items = _event_rows(ev, provider)
    items.sort(key=lambda x: x[0])
    rows = [r for _, r in items]
    limb_rows = []
    for kind, name in (("sunset", "Last limb (sunset)"), ("sunrise", "First limb (sunrise)")):
        att = attribute_event(ev, kind, provider=provider)
        if att is None:
            limb_rows.append(td(name) + td("no such event in the analysed span") + td("") + td("") + td("") + td(""))
            continue
        blk = ""
        if att.blocker_dist_m is not None:
            blk = f", blocker {num(att.blocker_dist_m / 1000.0)} km away"
        if not att.limb_crossing:
            name = f"{'Sunset' if kind == 'sunset' else 'Sunrise'}: no limb crossing"
        limb_rows.append(
            td(name) + td(utc(att.et) + ("" if att.limb_crossing else " (half-flux event, not a limb crossing)"), f"limb:{kind}:time", att.et)
            + td(num(att.az_deg), f"limb:{kind}:az", att.az_deg, "num") + td(num(att.horizon_elev_deg), f"limb:{kind}:horizon", att.horizon_elev_deg, "num")
            + td(att.cause) + td(att.detail + blk, cls="small"))
    return (
        '<section id="events"><h2>5. Key events</h2>'
        "<p class='small'>Half-flux events are the crossings the verdicts use. Earliest and latest are the edge times over the "
        "nominal, optimistic and pessimistic cases. Eclipse edges do not depend on the horizon. Sunrises and sunsets are listed for the "
        "mission and the last sunrise before landing.</p>"
        + table([th("Event"), th("Nominal (UTC)"), th("Earliest (UTC)"), th("Latest (UTC)"), th("Earliest / latest from"), th("Note")],
                rows or [td("none in the mission") + td("") * 5], caption="Earliest / latest from: the horizon case that gives the earliest and the latest edge, as the engine states it")
        + "<h3>Limb events after landing</h3>"
        "<p class='small'>The last (first) limb is the instant the last (first) point of the solar disc crosses the horizon. It is not "
        "the half-flux event the verdicts use, and the two can differ by hours. Where the Earth's shadow ends the sunlight there is "
        "no limb crossing, and the row says so and gives the half-flux time instead.</p>"
        + table([th("Event"), th("Time (UTC)"), th("Azimuth (deg)", "num"), th("Horizon (deg)", "num"), th("Cause"), th("Detail")], limb_rows)
        + attribution_html(attr) + "</section>")


def section_limits(ev, number: int = 6, extra=(), base=None) -> str:
    groups: dict[str, list] = {}
    for note in (*(applicable_limits(ev) if base is None else base), *extra):
        groups.setdefault(note.category, []).append(note)
    out = [f'<section id="limits"><h2>{number}. Assumptions and limits</h2>'
           "<p class='small'>Each statement is selected from this scenario's latitude, terrain resolution, sampling step, shadow convention "
           "and profile, and cites the validation report it comes from.</p>"]
    for cat, notes in groups.items():
        out.append(f"<h3>{esc(cat)}</h3><ul class='limits'>")
        for n in notes:
            out.append(f"<li>{esc(n.text)} <span class='src'>[{esc(n.file)}, {esc(n.source.split(' ', 1)[1])}]</span></li>")
        out.append("</ul>")
    out.append("</section>")
    return "".join(out)


def _kv(rows: Iterable[tuple[str, str]], keyed: dict[str, str] | None = None) -> str:
    return "<table class=\"kv\">" + "".join(f"<tr><th>{esc(k)}</th><td class='{'hash' if (keyed or {}).get(k) else ''}'>{esc(v)}</td></tr>" for k, v in rows) + "</table>"


def section_provenance(ev, extras: list[tuple[str, dict]], cmp=None, number: int = 7) -> str:
    prov = ev.provenance
    code = need(prov, "code", "evaluation.provenance")
    kernels = need(prov, "kernels", "evaluation.provenance")
    eph = need(prov, "ephemeris", "evaluation.provenance")
    hp = need(prov, "horizon_provider", "evaluation.provenance")
    sha = need(prov, "scenario_sha256", "evaluation.provenance")
    if sha != scenario_hash(ev.scenario):
        raise ReportInputError("the provenance scenario hash does not match the evaluation's scenario")
    if need(prov, "scenario", "evaluation.provenance") != ev.scenario.model_dump(mode="json"):
        raise ReportInputError("the provenance scenario document does not match the evaluation's scenario")
    ter = site_terrain(prov)
    hz = need(prov, "horizons", "evaluation.provenance")
    arr = need(hz, "array", "evaluation.provenance.horizons")
    ant = need(hz, "antenna", "evaluation.provenance.horizons")
    parts = [f'<section id="provenance"><h2>{number}. Provenance appendix</h2><h3>Code and conventions</h3>']
    parts.append(table([th("Item"), th("Value")], [
        td("Scenario SHA-256 (canonical JSON)") + td(sha, "prov:scenario_sha256", sha, "hash"),
        td("Scenario schema version") + td(str(need(prov, "schema_version", "evaluation.provenance"))),
        td("lunarnav package version") + td(code["package_version"], "prov:package_version", code["package_version"]),
        td("lunarnav source SHA-256") + td(code["source_sha256"], "prov:source_sha256", code["source_sha256"], "hash"),
        td("Ephemeris frame") + td(str(eph.get("frame", NA))),
        td("Light time and aberration") + td(str(eph.get("aberration_in_vectors", NA))),
        td("Ephemeris grid step (s), station grid step (s)") + td(f"{num(eph.get('grid_step_s'))}, {num(eph.get('station_grid_step_s'))}"),
        td("Horizon provider") + td(str(hp.get("provider", NA))),
    ]))
    parts.append("<h3>SPICE kernels</h3>" + table([th("Kernel"), th("SHA-256")], [td(k) + td(v, f"kernel:{k}", v, "hash") for k, v in kernels.items()]))
    hrows = []
    for name, rep in (("array", arr), ("antenna", ant)):
        hpv = rep.get("provenance", {})
        hrows.append(td(name) + td(str(hpv.get("engine", hpv.get("model", NA)))) + td(num(hpv.get("n_az", NA) if isinstance(hpv.get("n_az"), (int, float)) else None))
                     + td(num(hpv.get("max_range_used_m", None)) if hpv.get("max_range_used_m") is not None else NA)
                     + td(str(rep.get("n_nodata_azimuths", NA))) + td(str(rep.get("widened", NA))))
    parts.append("<h3>Horizons</h3>" + table([th("Horizon"), th("Engine"), th("Azimuths", "num"), th("Max range used (m)", "num"),
                                              th("No-data azimuths", "num"), th("Bracket widened")], hrows))
    if ter is None:
        parts.append("<p>No terrain store: the horizon is the smooth sphere, so there are no terrain hashes.</p>")
    else:
        terr = need(hp, "terrain", "evaluation.provenance.horizon_provider")
        hashes = arr.get("provenance", {}).get("terrain_hashes", {})
        sources = arr.get("provenance", {}).get("terrain_sources", {})
        parts.append(table([th("Item"), th("Value")], [
            td("Terrain stack hash") + td(str(terr.get("stack_hash")), "prov:stack_hash", terr.get("stack_hash"), "hash"),
            td("Store at the site") + td(f"{ter['dem_id']} ({num(ter['pixel_m'])} m)"),
            td("Store metadata hash at the site") + td(ter["meta_hash"], "prov:site_meta_hash", ter["meta_hash"], "hash"),
            td("Store source SHA-256 at the site") + td(str(sources.get(ter["dem_id"], NA)), cls="hash"),
        ]))
        ids = terr.get("dem_ids", [])
        parts.append(table([th("Terrain store in the stack"), th("Metadata SHA-256")],
                           [td(i) + td(str(hashes.get(i, NA)), f"terrain:{i}", hashes.get(i), "hash") for i in ids],
                           caption="Stores are listed in the stack's priority order; the horizon uses the finest store with valid data at each point"))
    ecl = need(prov, "eclipse", "evaluation.provenance")
    parts.append("<h3>Eclipse convention</h3>" + _kv([(k, "; ".join(f"{a}: {b}" for a, b in v.items() if b) if isinstance(v, dict) else str(v)) for k, v in ecl.items()]))
    parts.append("<h3>Analysis parameters</h3>" + _kv([(k, str(v)) for k, v in need(prov, "analysis", "evaluation.provenance").items()]))
    for title, p in extras:
        parts.append(f"<h3>{esc(title)}</h3>" + _kv([(k, str(v)) for k, v in need(p, "analysis", title).items()]))
    if cmp is not None:
        parts.append("<h3>Comparison members</h3>" + table(
            [th("#"), th("Scenario"), th("Scenario SHA-256")],
            [td(str(j)) + td(n) + td(e.provenance["scenario_sha256"], f"compare:sha:{j}", e.provenance["scenario_sha256"], "hash")
             for j, (n, e) in enumerate(zip(cmp.names, cmp.evaluations))]))
    doc = canonical_scenario_json(ev.scenario)
    if hashlib.sha256(doc.encode()).hexdigest() != sha:
        raise ReportInputError("the scenario document does not hash to the evaluation provenance scenario_sha256")
    b64 = base64.b64encode(doc.encode()).decode()
    parts.append('<h3>Scenario document (rerun with <span class="mono">lunarnav.scenario.Scenario.model_validate_json</span>)</h3>'
                 f'<p class="small"><a class="scenario-file" download="{SCENARIO_FILE}" href="data:application/json;base64,{b64}">'
                 f'{SCENARIO_FILE}</a> is this document as a file (embedded in the PDF as an attachment).</p>'
                 f'<pre id="scenario-document" data-sha256="{esc(sha)}">{esc(doc)}</pre>')
    parts.append("</section>")
    return "".join(parts)


_FREE_FIELDS = ("landing_utc", "name")


def _same_analysis(ev_doc: dict, other_doc: dict) -> str | None:
    """Name of the first scenario field in which the two documents differ (landing time and name aside), else None."""
    for key in sorted(set(ev_doc) | set(other_doc)):
        if key not in _FREE_FIELDS and ev_doc.get(key) != other_doc.get(key):
            return key
    return None


def _check_matching(ev, name: str, other_prov: dict) -> None:
    """Refuse a scan or slip that was not computed for this evaluation's scenario and horizon provider."""
    doc = other_prov.get("scenario")
    if doc is None:
        raise ReportInputError(f"the {name} result carries no scenario document in its provenance")
    field = _same_analysis(ev.provenance["scenario"], doc)
    if field is not None:
        raise ReportInputError(f"the {name} result was not computed for this scenario ({field} differs)")
    if other_prov.get("horizon_provider") != ev.provenance.get("horizon_provider"):
        raise ReportInputError(f"the {name} result was computed with a different horizon provider than the evaluation")


def _check_comparison(ev, cmp) -> None:
    evals = need(cmp, "evaluations", "comparison")
    if not evals or evals[0].provenance.get("scenario_sha256") != ev.provenance["scenario_sha256"]:
        raise ReportInputError("the comparison does not start with this evaluation's scenario (its first member must be the evaluated scenario)")
    for e in evals:
        if e.provenance.get("horizon_provider") != ev.provenance.get("horizon_provider"):
            raise ReportInputError("the comparison members were computed with a different horizon provider than the evaluation")


def render_html(
    evaluation, *, provider=None, scan=None, slip=None, comparison=None, ellipse=None, search=None,
    generated_utc: str | None = None, search_site_evaluations=None,
) -> str:
    """Self-contained HTML report for one evaluation and the optional scan, slip, comparison, ellipse and search results.

    `ellipse` is an `EllipseResult` and `search` a `SearchResult` computed for this evaluation's scenario and provider.

    `search_site_evaluations` are the evaluations of the searched sites (`limits.evaluate_search_sites`) that select the search's
    notes; given, the report evaluates nothing, otherwise it evaluates up to ten sites with `provider`.

    `provider` is the horizon provider that produced the evaluation (blocker coordinates in the limb events).
    `generated_utc` fixes the only time-dependent text; with it two renders are byte-identical."""
    if evaluation is None:
        raise ReportInputError("an evaluation (SiteEvaluation) is required")
    for attr in ("scenario", "verdict", "signals", "intervals", "metrics", "provenance", "soc"):
        need(evaluation, attr, "evaluation")
    if scan is not None:
        _check_matching(evaluation, "opportunity scan", scan.provenance)
    if slip is not None:
        _check_matching(evaluation, "slip", slip.provenance)
    if comparison is not None:
        _check_comparison(evaluation, comparison)
    from . import surveys

    surveys.check_surveys(evaluation, ellipse, search)
    generated = parse_generated_utc(generated_utc) if generated_utc is not None else datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    sc = evaluation.scenario
    sha = evaluation.provenance["scenario_sha256"] if "scenario_sha256" in evaluation.provenance else need(evaluation.provenance, "scenario_sha256", "evaluation.provenance")
    extras: list[tuple[str, dict]] = []
    if scan is not None:
        extras.append(("Opportunity scan", scan.provenance))
    if slip is not None:
        extras.append(("Slip analysis", slip.provenance))
    attr = evaluation.bound_attribution(provider)
    number, fig_n, survey_html, survey_notes = 6, 2 + (scan is not None) + (slip is not None) + 1, "", []
    if ellipse is not None or search is not None:
        cons = surveys.Constraints(evaluation)
        if ellipse is not None:
            survey_html += surveys.section_ellipse(evaluation, ellipse, number, fig_n, cons)
            extras.append(("Landing ellipse statistics", {"analysis": dict(surveys.provenance_rows(ellipse, "ellipse"))}))
            number, fig_n = number + 1, fig_n + 1
        if search is not None:
            survey_html += surveys.section_search(evaluation, search, number, fig_n, cons)
            extras.append(("Site search", {"analysis": dict(surveys.provenance_rows(search, "search"))}))
            number += 1
    if search is not None and search_site_evaluations is None:
        if provider is None:
            raise ReportInputError("the site-search notes need the horizon provider the search was computed with")
        search_site_evaluations = evaluate_search_sites(sc, search, provider)
    base_notes = report_limits(evaluation, scan=scan, slip=slip, comparison=comparison, ellipse=ellipse, search=search,
                               search_site_evaluations=search_site_evaluations)
    body = (
        f'<header><h1><span class="rt">{esc(REPORT_TITLE)}: {esc(display_name(sc))}</span></h1>'
        f'<div class="sub">Lunar Landing Site Navigator, engine-generated. Every number in this document comes from the engine.</div>'
        f'<div class="meta"><span>Generated <span class="rg">{esc(generated)}</span></span>'
        f'<span>Scenario hash <span class="mono rh">{esc(sha[:16])}</span></span>'
        f"<span>Landing {esc(sc.landing_utc)}</span><span>Duration {esc(num(sc.mission_duration_h))} h</span></div></header>"
        + section_answer(evaluation, attr) + section_scenario(evaluation) + section_constraints(evaluation)
        + section_figures(evaluation, scan, slip, comparison) + section_events(evaluation, provider, attr)
        + survey_html + section_limits(evaluation, number, survey_notes, base_notes) + section_provenance(evaluation, extras, comparison, number + 1))
    return (
        '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">'
        f"<title>{esc(REPORT_TITLE)}: {esc(display_name(sc))}</title>"
        f'<meta name="generator" content="lunarnav.report"><meta name="dcterms.created" content="{esc(generated)}">'
        f'<meta name="description" content="Scenario {esc(sha)}">'
        f"<style>{font_face_css()}\n{CSS}</style></head><body>{body}</body></html>\n")

