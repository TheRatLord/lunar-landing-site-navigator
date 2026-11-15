"""Assemble the self-contained HTML report from engine results.

Nothing here computes a result. Each number is read from a result object and formatted by `fmt`; the exact
value sits next to the text in a `data-raw` attribute and the cell's identity in `data-key`, so the document
can be checked against the results it came from.
A result that is needed and absent raises `ReportInputError`.
"""

from __future__ import annotations

import hashlib
import math
import re
from collections.abc import Iterable
from datetime import UTC, datetime

from lunarnav.scenario import canonical_scenario_json, scenario_hash

from . import figures
from .errors import ReportInputError, need, parse_generated_utc
from .fmt import (
    DASH,
    NA,
    amount,
    esc,
    limit_amount,
    raw,
    span,
    when,
    when_utc,
)
from .fonts import font_face_css
from .limits import evaluate_search_sites, report_limits
from .style import CSS

REPORT_TITLE = "Mission report"
STATE_LABEL = {"pass": "PASS", "marginal": "MARGINAL", "fail": "FAIL", "unknown": "UNKNOWN"}


def display_name(sc) -> str:
    prefix = f"{sc.site.name} / "
    lander_id = sc.name[len(prefix):] if sc.site.name and sc.name.startswith(prefix) else ""
    if lander_id and (sc.profile.id == lander_id or sc.profile.id.startswith(lander_id + "-")):
        return f"{sc.site.name} / {sc.profile.name}"
    return sc.name


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


def comparison_table(cmp, labels: dict[str, str]) -> str:
    names = need(cmp, "names", "comparison")
    rows = [td("Verdict") + "".join(f"<td>{state_chip(st, f'compare:state:{j}')}</td>" for j, st in enumerate(cmp.states)),
            td("Limiting requirement") + "".join(td(labels.get(lim, lim) if lim else DASH, f"compare:limiting:{j}", lim) for j, lim in enumerate(cmp.limiting))]
    for key, label in FACTS:
        if key not in cmp.metric_keys:
            continue
        i = cmp.metric_keys.index(key)
        cells = ""
        for j in range(len(names)):
            v = float(cmp.values[i, j])
            cells += td(DASH if math.isnan(v) else amount(v, cmp.metric_units[i]), f"compare:{key}:{j}", None if math.isnan(v) else v, "num")
        rows.append(td(label.format(link="Earth link")) + cells)
    return table([th("")] + [th(n, "num") for n in names], rows)


def _value(c) -> str:
    if c.value is None and c.value_range is not None:
        return span(c.value_range[0], c.value_range[1], lambda x: amount(x, c.unit))
    return amount(c.value, c.unit) + (" (bound)" if c.censored else "")


def _limit(c) -> str:
    return limit_amount(c.limit_min, c.limit_max, c.unit)


def _reason(c) -> str:
    head = f"<b>{esc(c.label)}</b> {esc(_value(c))} against {esc(_limit(c))}"
    if c.state == "marginal":
        return f"{head}: holds nominally, worst-case margin {esc(amount(c.margin_worst, c.unit, plus=True))}"
    if c.state == "fail":
        return f"{head}, margin {esc(amount(c.margin if c.margin is not None else c.margin_worst, c.unit, plus=True))}"
    return f"{head}: unknown"


def _first(rows, attr: str, t0: float, t1: float):
    times = [getattr(r, attr) for r in rows if r.nominal and not getattr(r, attr.replace("_et", "_censored")) and t0 < getattr(r, attr) <= t1]
    return min(times) if times else None


def _up_at(rows, t0: float) -> bool:
    return any(r.nominal and r.start_et <= t0 < r.end_et for r in rows)


def _event_facts(ev) -> list[str]:
    t0, t1 = ev.t_land_et, ev.t_land_et + ev.mission_s
    ivs = need(ev, "intervals", "evaluation")
    stations = bool(ev.scenario.network.stations)
    sun, link = ivs["sunlit"], need(ivs, "contact", "evaluation.intervals")
    begins, ends = ("Earth link begins", "Earth link ends") if stations else ("Earthrise", "Earthset")
    sun_rise, link_start = _first(sun, "start_et", t0, t1), _first(link, "start_et", t0, t1)
    items = [("Sunset", "sunset", _first(sun, "end_et", t0, t1), _up_at(sun, t0) or sun_rise is not None, None),
             ("Sunrise", "sunrise", sun_rise, None, _up_at(sun, t0)),
             (ends, "link_end", _first(link, "end_et", t0, t1), _up_at(link, t0) or link_start is not None, None),
             (begins, "link_start", link_start, None, _up_at(link, t0))]
    rows = []
    for label, key, et, up_for_end, up_for_start in sorted(items, key=lambda x: (x[2] is None, x[2] or 0.0)):
        if et is not None:
            text = when(et)
        elif up_for_start:
            text = "already up at landing"
        elif up_for_end is False:
            continue
        else:
            text = "not during the stay"
        rows.append(f"<tr><th>{esc(label)}</th>{td(text, f'event:{key}', et)}</tr>")
    return rows


FACTS = (("sunlit_hours", "Sunlight"), ("contact_hours", "{link}"), ("contact_sunlit_hours", "Sunlight with {link}"),
         ("longest_dark_span_h", "Longest dark span"))


def fact_rows(ev) -> list[str]:
    link = "Earth link" if ev.scenario.network.stations else "Earth in view"
    stay = amount(ev.scenario.mission_duration_h, "h")
    rows = []
    for key, label in FACTS:
        m = next((x for x in ev.metrics if x.key == key), None)
        if m is None:
            continue
        if m.value is None and m.low is not None and m.high is not None:
            text = f"{amount(m.low, 'h')} {DASH} {amount(m.high, 'h')}"
        else:
            text = amount(m.value, "h")
        if key != "longest_dark_span_h" and m.value is not None:
            text += f" of {stay}"
        if m.censored:
            text += " (bound)"
        rows.append(f"<tr><th>{esc(label.format(link=link))}</th>{td(text, f'fact:{key}', m.value)}</tr>")
    return rows


def next_pass(ev, scan, slip) -> tuple[str, str] | None:
    if ev.verdict.state == "pass":
        return None
    if slip is not None and slip.rows:
        r = min(slip.rows, key=lambda x: abs(x.slip_h))
        if r.next_open_utc and r.next_open_state == "pass":
            return "Next landing that passes", when_utc(r.next_open_utc)
        if r.next_open_utc and r.next_open_state == "marginal" and (r.next_open_wait_h or 0) > 0:
            return "Next marginal landing", when_utc(r.next_open_utc)
    if scan is not None:
        w = next((w for w in scan.windows if w.best_state == "pass" and w.best_et > ev.t_land_et), None)
        if w is not None:
            return "Next landing that passes", when(w.best_et)
    if slip is not None and slip.rows and min(slip.rows, key=lambda x: abs(x.slip_h)).next_open_utc is None:
        return "Next landing that does not fail", "none found in the search"
    return None


def section_answer(ev, scan=None, slip=None) -> str:
    v = need(ev, "verdict", "evaluation")
    if not v.constraints:
        raise ReportInputError("the plan has no active requirements: there is no verdict to report")
    if v.limiting is None:
        raise ReportInputError("the verdict names no limiting requirement")
    bad = [c for c in v.constraints if c.state != "pass"]
    if bad:
        lead = "<ul class='limits'>" + "".join(f"<li>{_reason(c)}</li>" for c in bad) + "</ul>"
    else:
        lead = f"<p class='lead'>All {len(v.constraints)} requirements hold in every case.</p>"
    facts = fact_rows(ev) + _event_facts(ev)
    nxt = next_pass(ev, scan, slip)
    if nxt is not None:
        facts.append(f"<tr><th>{esc(nxt[0])}</th>{td(nxt[1], 'answer:next_pass')}</tr>")
    rows = [td(c.label) + td(_value(c), f"constraint:{c.key}:value", c.value, "num") + td(_limit(c), f"constraint:{c.key}:limit", c.limit_min, "num")
            + td(amount(c.margin_worst, c.unit, plus=True), f"constraint:{c.key}:margin_worst", c.margin_worst, "num")
            + f"<td>{state_chip(c.state, f'constraint:{c.key}:state')}</td>" for c in v.constraints]
    reqs = table([th("Requirement"), th("Value", "num"), th("Limit", "num"), th("Worst margin", "num"), th("Verdict")], rows)
    hd = [c for c in v.constraints if getattr(c, "heading_dependent", False)]
    note = "<p class='small'>The lander heading is unknown, so state of charge is a range over every heading.</p>" if hd else ""
    return (
        '<section id="answer"><div class="answer">'
        f'<div class="verdict {esc(v.state)}" data-key="verdict:state" data-raw="{esc(v.state)}">{esc(STATE_LABEL[v.state])}</div>'
        f'<span hidden data-key="answer:limiting" data-raw="{esc(v.limiting)}"></span>'
        f'{lead}<table class="kv facts">{"".join(facts)}</table></div>{reqs}{note}</section>')


def _coord(lat: float, lon: float) -> str:
    return f"{abs(lat):.2f}\u00b0{'S' if lat < 0 else 'N'} {abs(lon):.2f}\u00b0{'W' if lon < 0 else 'E'}"


def section_plan(ev) -> str:
    sc = ev.scenario
    stations = ", ".join(s.name or s.id for s in sc.network.stations) or "none (Earth in view only)"
    rows = [
        f"<tr><th>Site</th><td>{esc(sc.site.name or NA)}</td></tr>",
        f'<tr><th>Coordinates</th><td data-key="site:lat_deg" data-raw="{esc(raw(sc.site.lat_deg))}">{esc(_coord(sc.site.lat_deg, sc.site.lon_deg))}</td></tr>',
        f"<tr><th>Landing</th>{td(when_utc(sc.landing_utc), 'scenario:landing_utc', sc.landing_utc)}</tr>",
        f"<tr><th>Stay</th>{td(amount(sc.mission_duration_h, 'h'), 'scenario:duration_h', sc.mission_duration_h)}</tr>",
        f"<tr><th>Lander</th><td>{esc(sc.profile.name)}</td></tr>",
        f"<tr><th>Ground stations</th><td>{esc(stations)}</td></tr>",
    ]
    return f'<section id="scenario"><h2>Plan</h2><table class="kv">{"".join(rows)}</table></section>'


def windows_table(scan) -> str:
    rows = [td(when(w.start_et), f"window:{i}:start", w.start_et, "nw") + td(when(w.end_et), f"window:{i}:end", w.end_et, "nw")
            + td(when(w.best_et), f"window:{i}:best", w.best_et, "nw") + f"<td>{state_chip(w.best_state)}</td>"
            for i, w in enumerate(scan.windows)]
    return table([th("Opens"), th("Closes"), th("Best landing"), th("Verdict")], rows)


def section_figures(ev, scan, cmp) -> str:
    out = ['<section id="figures"><h2>Sun, Earth and power</h2>']
    out.append(_figure(figures.timeline(ev), "Sun and Earth elevation, sunlight, Earth link and battery from landing. "
                       "Hatching shows the range from worst to best case.", 1))
    out.append(_figure(figures.panorama(ev), "Horizon from the lander with the Sun and Earth paths over the stay.", 2))
    if scan is not None:
        c = scan.counts()
        out.append(_figure(figures.calendar(scan), f"Landing dates by lunar day: {c.get('pass', 0)} pass, {c.get('marginal', 0)} marginal, "
                           f"{c.get('fail', 0)} fail.", 3))
        out.append("<h3>Landing windows</h3>" + (windows_table(scan) if scan.windows else "<p>No landing window in the scanned dates.</p>"))
    if cmp is not None:
        out.append("<h3>Comparison</h3>" + comparison_table(cmp, {k: c.label for k, c in ev.scenario.constraints.active().items()}))
    out.append("</section>")
    return "".join(out)


def _events(ev) -> list[tuple[float, str]]:
    t0, t1 = ev.t_land_et, ev.t_land_et + ev.mission_s
    ivs = need(ev, "intervals", "evaluation")
    stations = bool(ev.scenario.network.stations)
    begins, ends = ("Earth link begins", "Earth link ends") if stations else ("Earthrise", "Earthset")
    out = []
    for kind, (rise, fall) in (("sunlit", ("Sunrise", "Sunset")), ("contact", (begins, ends)), ("eclipse", ("Earth eclipse begins", "Earth eclipse ends"))):
        for r in need(ivs, kind, "evaluation.intervals"):
            if not getattr(r, "nominal", True):
                continue
            if not r.start_censored and t0 < r.start_et <= t1:
                out.append((r.start_et, rise))
            if not r.end_censored and t0 <= r.end_et <= t1:
                out.append((r.end_et, fall))
    return sorted(out)


def section_events(ev) -> str:
    rows = [td(name) + td(when(et), f"event:{i}", et, "nw") for i, (et, name) in enumerate(_events(ev))]
    return ('<section id="events"><h2>Events during the stay</h2>'
            + table([th("Event"), th("Date")], rows or [td("none during the stay") + td("")]) + "</section>")


_WORDS = ((re.compile(r"\bscenario\b"), "plan"), (re.compile(r"\bScenario\b"), "Plan"), (re.compile(r"\bconstraint\b"), "requirement"),
          (re.compile(r" \([^()]*_[^()]*\)"), ""), (re.compile(r"(\d) deg\b"), "\\1\u00b0"), (re.compile(r"\blunation\b"), "lunar day"))


def _plain(text: str) -> str:
    first = re.split(r"(?<=[a-z0-9)%])\. (?=[A-Z])", text, maxsplit=1)[0].rstrip(".") + "."
    for pat, rep in _WORDS:
        first = pat.sub(rep, first)
    return first


def section_limits(ev, number: int, base) -> str:
    groups: dict[str, list[str]] = {}
    if ev.warnings:
        groups["Engine warnings"] = [_plain(w) for w in ev.warnings]
    for note in base:
        text = _plain(note.text)
        if "section" in text:
            continue
        bucket = groups.setdefault(note.category, [])
        if text not in bucket:
            bucket.append(text)
    out = ['<section id="limits"><h2>Assumptions</h2>']
    for cat, notes in groups.items():
        out.append(f"<h3>{esc(_plain(cat).rstrip('.'))}</h3><ul class='limits'>" + "".join(f"<li>{esc(n)}</li>" for n in notes) + "</ul>")
    out.append("</section>")
    return "".join(out)


def _check_provenance(ev) -> dict:
    prov = ev.provenance
    code = need(prov, "code", "evaluation.provenance")
    sha = need(prov, "scenario_sha256", "evaluation.provenance")
    if sha != scenario_hash(ev.scenario):
        raise ReportInputError("the provenance scenario hash does not match the evaluation's scenario")
    if need(prov, "scenario", "evaluation.provenance") != ev.scenario.model_dump(mode="json"):
        raise ReportInputError("the provenance scenario document does not match the evaluation's scenario")
    if hashlib.sha256(canonical_scenario_json(ev.scenario).encode()).hexdigest() != sha:
        raise ReportInputError("the scenario document does not hash to the evaluation provenance scenario_sha256")
    return code


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
        raise ReportInputError(f"the {name} result carries no plan in its provenance")
    field = _same_analysis(ev.provenance["scenario"], doc)
    if field is not None:
        raise ReportInputError(f"the {name} result was not computed for this plan ({field} differs)")
    if other_prov.get("horizon_provider") != ev.provenance.get("horizon_provider"):
        raise ReportInputError(f"the {name} result was computed with a different horizon provider than the evaluation")


def _check_comparison(ev, cmp) -> None:
    evals = need(cmp, "evaluations", "comparison")
    if not evals or evals[0].provenance.get("scenario_sha256") != ev.provenance["scenario_sha256"]:
        raise ReportInputError("the comparison must start with the evaluated plan")
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

    `generated_utc` fixes the only time-dependent text; with it two renders are byte-identical."""
    if evaluation is None:
        raise ReportInputError("an evaluation (SiteEvaluation) is required")
    for attr in ("scenario", "verdict", "signals", "intervals", "metrics", "provenance", "soc"):
        need(evaluation, attr, "evaluation")
    if scan is not None:
        _check_matching(evaluation, "year survey", scan.provenance)
    if slip is not None:
        _check_matching(evaluation, "delay", slip.provenance)
    if comparison is not None:
        _check_comparison(evaluation, comparison)
    from . import surveys

    surveys.check_surveys(evaluation, ellipse, search)
    code = _check_provenance(evaluation)
    generated = parse_generated_utc(generated_utc) if generated_utc is not None else datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    sc = evaluation.scenario
    sha = evaluation.provenance["scenario_sha256"]
    number, fig_n, survey_html = 1, 3 + (scan is not None), ""
    if ellipse is not None or search is not None:
        cons = surveys.Constraints(evaluation)
        if ellipse is not None:
            survey_html += surveys.section_ellipse(evaluation, ellipse, number, fig_n, cons)
            number, fig_n = number + 1, fig_n + 1
        if search is not None:
            survey_html += surveys.section_search(evaluation, search, number, fig_n, cons)
            number += 1
    if search is not None and search_site_evaluations is None:
        if provider is None:
            raise ReportInputError("the site-search notes need the horizon provider the search was computed with")
        search_site_evaluations = evaluate_search_sites(sc, search, provider)
    base_notes = report_limits(evaluation, scan=scan, slip=slip, comparison=comparison, ellipse=ellipse, search=search,
                               search_site_evaluations=search_site_evaluations)
    body = (
        f'<header><h1><span class="rt">{esc(display_name(sc))}</span></h1>'
        f'<div class="meta"><span>{esc(REPORT_TITLE)}</span><span>Landing <span class="rh">{esc(when_utc(sc.landing_utc))}</span></span>'
        f'<span>Generated <span class="rg">{esc(when_utc(generated))}</span></span></div></header>'
        + section_answer(evaluation, scan, slip) + section_plan(evaluation) + section_figures(evaluation, scan, comparison)
        + section_events(evaluation) + survey_html + section_limits(evaluation, number, base_notes)
        + f'<footer class="small">Lunar Landing Site Navigator {esc(code["package_version"])}'
        f'<span hidden data-key="prov:source_sha256" data-raw="{esc(code["source_sha256"])}"></span></footer>')
    body = re.sub(r"(\d) \u00b0", "\\1\u00b0", body)
    return (
        '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">'
        f"<title>{esc(REPORT_TITLE)}: {esc(display_name(sc))}</title>"
        f'<meta name="generator" content="lunarnav.report"><meta name="dcterms.created" content="{esc(generated)}">'
        f'<meta name="description" content="Plan {esc(sha)}">'
        f"<style>{font_face_css()}\n{CSS}</style></head><body>{body}</body></html>\n")
