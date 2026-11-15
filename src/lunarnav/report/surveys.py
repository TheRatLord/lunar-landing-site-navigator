"""Report sections for the landing-ellipse statistics and the site search.

Like the rest of the report this module computes nothing the engine does not give: every probability, percentile,
margin and count is read from the `EllipseResult` or `SearchResult`. The two products of engine numbers are the
physical margin (normalised margin times the limiting constraint's `margin_scale`, the same product the service
exports) and the display of fractions as percentages. Each section states how its figures were sampled and what they
do not cover.
"""

from __future__ import annotations

from . import figures
from .errors import ReportInputError, need
from .fmt import (
    MARGIN_KIND_NOTE,
    NA,
    basis_label,
    esc,
    kind_notes,
    num,
    qty,
    signed_kind,
    unit_label,
    when_utc,
)
from .html import _figure, site_terrain, state_chip, table, td, th

STATES = ("pass", "marginal", "fail", "unknown")
PERCENTILE_COLUMNS = ("p5", "p25", "p50", "p75", "p95", "mean", "min", "max")
PERCENTILE_HEADS = ("5 %", "25 %", "Median", "75 %", "95 %", "Mean", "Min", "Max")


def _same_run(ev, name: str, prov: dict) -> None:
    """Refuse an ellipse or search result that was not computed for this evaluation's scenario and horizon provider."""
    if prov.get("scenario_hash") != ev.provenance["scenario_sha256"]:
        raise ReportInputError(f"the {name} result was not computed for this evaluation's scenario (scenario hashes differ)")
    if prov.get("provider") != ev.provenance.get("horizon_provider"):
        raise ReportInputError(f"the {name} result was computed with a different horizon provider than the evaluation")


def check_surveys(ev, ellipse, search) -> None:
    if ellipse is not None:
        _same_run(ev, "landing-ellipse", need(ellipse, "provenance", "ellipse result"))
    if search is not None:
        _same_run(ev, "site-search", need(search, "provenance", "search result"))


class Constraints:
    """Label, unit and margin scale of every active constraint, from the evaluation's own verdict and scenario."""

    def __init__(self, ev):
        scales = {k: v.margin_scale for k, v in ev.scenario.constraints.active().items()}
        self.rows = {c.key: (c.label, c.unit, scales.get(c.key, 1.0)) for c in ev.verdict.constraints}
        self.heading_notes = [c.heading_note for c in ev.verdict.constraints if getattr(c, "heading_dependent", False) and c.heading_note]

    def label(self, key: str | None) -> str:
        return NA if key is None else self.rows[key][0] if key in self.rows else key

    def unit(self, key: str) -> str:
        return self.rows[key][1]

    def margin(self, normalised: float | None, key: str | None, kind: str | None = None) -> tuple[str, str]:
        """(normalised margin text, physical margin text with its unit) of the limiting constraint; `kind` is the engine's `margin_kind`."""
        if normalised is None or key is None or key not in self.rows:
            return signed_kind(normalised, kind), NA
        _, unit, scale = self.rows[key]
        u = unit_label(unit)
        return signed_kind(normalised, kind), f"{qty(normalised * scale, unit, plus=True)} {u}".strip()


def _heading_note(cons: Constraints) -> str:
    text = ("The lander heading is unknown, so the minimum state of charge has no nominal value at any point (its cells are blank); "
            "its verdict follows the heading rule.")
    notes = " ".join(esc(n) for n in cons.heading_notes)
    return f"<p><b>Heading.</b> {esc(text)}{(' ' + notes) if notes else ''}</p>"


def _pct(p: float | None, digits: int = 3) -> str:
    return qty(p, "fraction", digits=digits)


def _ellipse_sampling(res, ev) -> str:
    ell = need(res.provenance, "ellipse", "ellipse result provenance")
    conv = res.convergence
    sizes = [r["n"] for r in conv["rows"]]
    shape = res.map.state.shape if res.map is not None else None
    disp = ell["dispersion"] + (f", {num(ell['sigma_level'])} sigma at the semi-axes" if ell["dispersion"] == "gaussian" else "")
    parts = [
        f"<p><b>Sampling.</b> {esc(str(res.n_samples))} samples, seed {esc(str(res.seed))}; scheme: {esc(res.scheme)}. "
        f"Ellipse: semi-major {esc(num(ell['semi_major_m']))} m, semi-minor {esc(num(ell['semi_minor_m']))} m, major axis at azimuth "
        f"{esc(num(ell['azimuth_deg']))}\u00b0 clockwise from north, {esc(disp)}. "
        f"Every sample is evaluated at the landing {esc(when_utc(res.provenance['landing_utc']))} in the nominal, optimistic and pessimistic cases. "
        + (f"The verdict map has {esc(str(shape[1]))} x {esc(str(shape[0]))} nodes spaced {esc(num(res.map.spacing_m))} m. " if shape else "")
        + f"Convergence is checked at {esc(', '.join(str(n) for n in sizes))} samples.</p>"]
    return "".join(parts)


def _ellipse_not_covered(res) -> str:
    items = [
        "Probabilities are sample fractions, not exact: the standard error in the first table is the binomial value "
        "sqrt(p(1 - p) / n), a conservative figure for a low-discrepancy sample.",
        "The ellipse is the planner's input (its origin is recorded in the plan table); the engine does not derive the dispersion.",
        "Only the landing epoch above is evaluated; another landing time needs another run.",
    ]
    if res.truncated:
        items.append("The sample is the dispersion conditioned on landing inside the ellipse, so every probability is conditional on that: "
                     "the chance of landing outside it is not in these figures.")
    else:
        items.append("The full dispersion is sampled, including points outside the ellipse.")
    hz = res.hazard_limits
    if hz["slope_deg"] is None and hz["roughness_m"] is None:
        items.append("No slope or roughness limit was set for the hazard flag, so no sample is marked hazardous.")
    return "<h3>What these statistics do not cover</h3><ul class='limits'>" + "".join(f"<li>{esc(t)}</li>" for t in items) + "</ul>"


def _state_table(res) -> str:
    se = res.convergence["binomial_standard_error"]
    rows = []
    for s in STATES:
        p, q = res.state_probability[s.upper()], res.state_probability_non_hazardous[s.upper()]
        rows.append(f"<td>{state_chip(s)}</td>" + td(_pct(p), f"ellipse:p:{s}", p, "num") + td(_pct(q), f"ellipse:p_nonhazardous:{s}", q, "num")
                    + (td(qty(se[s], "fraction", digits=2), f"ellipse:se:{s}", se[s], "num") if s in se else td(NA, cls="num")))
    return table([th("Verdict"), th("All samples (%)", "num"), th("Non-hazardous samples (%)", "num"), th("Binomial std. error (percentage points)", "num")],
                 rows, caption="Probability of each overall verdict")


def _origin_phrase(o: dict) -> str:
    """Where a hazard limit came from, from the engine's `EllipseResult.hazard_origins`."""
    if o["origin"] == "request":
        return "set in the request"
    if o["origin"] == "scenario_constraint":
        return f"the plan's {o['label']} limit, origin: {basis_label(o['basis'])}" + (f", {o['source_url']}" if o["source_url"] else "")
    return "no limit"


def _hazard_sentence(res, ev) -> str:
    hz = res.hazard_limits
    org = res.hazard_origins
    lim = ", ".join(x for x in (f"slope above {num(hz['slope_deg'])}\u00b0 ({_origin_phrase(org['slope_deg'])})" if hz["slope_deg"] is not None else "",
                                f"roughness above {num(hz['roughness_m'])} m ({_origin_phrase(org['roughness_m'])})" if hz["roughness_m"] is not None else "") if x)
    if site_terrain(ev.provenance) is None:
        return "<p>No terrain was used, so slope and roughness are not evaluated and no sample is marked hazardous.</p>"
    return (f"<p>Hazardous samples ({esc(lim or 'no limit set')}): "
            f"<span data-key=\"ellipse:hazard_fraction\" data-raw=\"{res.hazard_fraction!r}\">{esc(_pct(res.hazard_fraction))} %</span> of all samples.</p>")


def _constraint_table(res, cons: Constraints) -> str:
    rows = []
    for k in res.keys:
        cp = res.constraint_probability.get(k)
        if cp is None:
            continue
        rows.append(td(cons.label(k)) + td(_pct(cp["pass"]), f"ellipse:cp:{k}:pass", cp["pass"], "num")
                    + td(_pct(cp["not_fail"]), f"ellipse:cp:{k}:not_fail", cp["not_fail"], "num")
                    + td(_pct(cp["unknown"]), f"ellipse:cp:{k}:unknown", cp["unknown"], "num"))
    return table([th("Requirement"), th("Passes in all three cases (%)", "num"), th("Passes or marginal, nominal (%)", "num"), th("Not evaluated (%)", "num")],
                 rows, caption="Probability per requirement")


def _percentile_table(res, cons: Constraints) -> str:
    rows = []
    for k in res.keys:
        pc = res.percentiles.get(k)
        if pc is None:
            why = ("no nominal value: the lander heading is unknown" if res.provenance.get("heading_unknown_soc") and k == "min_state_of_charge"
                   else "no finite value at any sample")
            rows.append(td(cons.label(k)) + td(unit_label(cons.unit(k))) + f"<td colspan='{len(PERCENTILE_COLUMNS) + 1}' class='small'>{esc(why)}</td>")
            continue
        u = cons.unit(k)
        rows.append(td(cons.label(k)) + td(unit_label(u))
                    + "".join(td(qty(pc[c], u), f"ellipse:pct:{k}:{c}", pc[c], "num") for c in PERCENTILE_COLUMNS)
                    + td(str(pc["n_finite"]), f"ellipse:pct:{k}:n_finite", pc["n_finite"], "num"))
    return table([th("Requirement value (nominal case)"), th("Unit"), *(th(h, "num") for h in PERCENTILE_HEADS), th("Samples with a value", "num")],
                 rows, caption="Percentiles over the samples", cls="dense")


def _reference_table(res, cons: Constraints) -> str:
    verdicts, places = [], []
    for name, ref in (("Best sample", res.best), ("Worst sample", res.worst), ("Site (centre)", res.centre)):
        norm, phys = cons.margin(ref.worst_margin, ref.limiting, ref.margin_kind)
        k = name.split()[0].lower()
        verdicts.append(td(name) + f"<td>{state_chip(ref.state)}</td>" + td(cons.label(ref.limiting), cls="small")
                        + td(norm, f"ellipse:{k}:margin", ref.worst_margin, "num") + td(phys, cls="num"))
        places.append(td(name) + td(num(ref.lat_deg, 6), f"ellipse:{k}:lat", ref.lat_deg, "num") + td(num(ref.lon_deg, 6), f"ellipse:{k}:lon", ref.lon_deg, "num")
                      + td(num(ref.east_m), f"ellipse:{k}:east", ref.east_m, "num") + td(num(ref.north_m), f"ellipse:{k}:north", ref.north_m, "num")
                      + td(num(ref.slope_deg), f"ellipse:{k}:slope", ref.slope_deg, "num") + td(num(ref.roughness_m), f"ellipse:{k}:roughness", ref.roughness_m, "num"))
    return (table([th("Sample"), th("Verdict"), th("Limiting requirement"), th("Norm. margin", "num"), th("Margin in the requirement's unit", "num")], verdicts,
                  caption="Best, worst and central points (margin of the limiting requirement). " + MARGIN_KIND_NOTE)
            + "".join(f"<p class='small'>Margin note (engine): {esc(n)}.</p>"
                      for n in kind_notes((r.margin_kind, r.margin_note) for r in (res.best, res.worst, res.centre)))
            + table([th("Sample"), th("Latitude (\u00b0)", "num"), th("Longitude (\u00b0)", "num"), th("East (m)", "num"), th("North (m)", "num"),
                     th("Slope (\u00b0)", "num"), th("Roughness (m)", "num")], places, cls="dense"))


def _convergence(res) -> str:
    c = res.convergence
    rows = [td(str(r["n"]), f"ellipse:conv:{i}:n", r["n"], "num") + "".join(td(_pct(r[s]), f"ellipse:conv:{i}:{s}", r[s], "num") for s in STATES)
            for i, r in enumerate(c["rows"])]
    verdict = "converged" if c["converged"] else "not converged"
    return ("<h3>Convergence</h3>" + table([th("Samples", "num"), *(th(f"{s.capitalize() if s != 'unknown' else 'Not evaluated'} (%)", "num") for s in STATES)], rows)
            + f"<p class='small'>The largest change in a pass, marginal or fail probability over the last halving of the sample is "
              f"<span data-key=\"ellipse:conv:change\" data-raw=\"{c['max_change_last_halving']!r}\">{esc(_pct(c['max_change_last_halving']))} %</span> against a tolerance of "
              f"{esc(_pct(c['tolerance']))} %: {esc(verdict)}.</p>")


def section_ellipse(ev, res, number: int, fig_n: int, cons: Constraints) -> str:
    if res.n_samples < 1:
        raise ReportInputError("the ellipse result has no samples")
    out = ['<section id="ellipse"><h2>Landing ellipse</h2>',
           _ellipse_sampling(res, ev), _state_table(res), _hazard_sentence(res, ev)]
    if res.provenance.get("heading_unknown_soc"):
        out.append(_heading_note(cons))
    out += [_constraint_table(res, cons), _percentile_table(res, cons), _reference_table(res, cons)]
    if res.map is not None:
        out.append(_figure(figures.ellipse_map(res), "Verdict at the nodes of a regular east and north grid inside the ellipse; dots are the "
                           "samples, the plus is the site.", fig_n))
    out += [_convergence(res), _ellipse_not_covered(res), "</section>"]
    return "".join(out)


def _region_text(reg: dict) -> str:
    where = f"centre {num(reg['lat_deg'], 6)}\u00b0, {num(reg['lon_deg'], 6)}\u00b0"
    if reg["polygon"]:
        return f"polygon of {len(reg['polygon'])} vertices anchored at {where}"
    return f"disc of radius {num(reg['radius_m'])} m, {where}"


def _search_sampling(res) -> str:
    s, prov = res.settings, res.provenance
    epochs = (f"{esc(str(s['n_epochs']))} landing epochs from {esc(when_utc(prov['first_landing_utc']))} to {esc(when_utc(prov['last_landing_utc']))}, each site scored at its best epoch"
              if s["n_epochs"] > 1 else f"one landing epoch, {esc(when_utc(prov['first_landing_utc']))}")
    method = ("exhaustive: every lattice point inside the region is evaluated with the full horizon"
              if s["exhaustive"] else
              f"coarse to fine, coarse factor {s['coarse_factor']}: coarse levels use a cheap horizon ({s['cheap_n_az']} azimuths"
              + (f", range {num(s['cheap_range_km'])} km" if s["cheap_range_km"] is not None else "")
              + f"), promote a point scoring at least {num(-s['slack'])} margin scales or among the best {s['min_promote']} (at most {s['max_promoted']}), "
              f"and refine around the promoted points; the final level uses the full horizon")
    return (f"<p><b>Sampling.</b> Region: {esc(_region_text(s['region']))}; final lattice spacing {esc(num(s['final_spacing_m']))} m; "
            f"{epochs}. Method: {esc(method)}. "
            f"Ranking keeps the best {esc(str(s['top_k']))} sites at least {esc(num(s['min_separation_m']))} m apart. The plan's own site is not used: "
            f"the region defines where sites are.</p>")


def _levels_table(res) -> str:
    rows = [td(num(lv.spacing_m), f"search:level:{i}:spacing", lv.spacing_m, "num") + td(str(lv.n_candidates), cls="num") + td(str(lv.n_slope_pruned), cls="num")
            + td(str(lv.n_evaluated), cls="num") + td(str(lv.n_promoted), cls="num") + td(lv.horizon, cls="small") + td("yes" if lv.capped else "no")
            for i, lv in enumerate(res.levels)]
    c = res.counts
    return (table([th("Spacing (m)", "num"), th("Candidates", "num"), th("Pruned by slope or roughness", "num"), th("Evaluated", "num"),
                   th("Promoted", "num"), th("Horizon"), th("Promotion capped")], rows, caption="Refinement levels", cls="dense")
            + f"<p class='small'>{esc(str(c['evaluated_full']))} of {esc(str(res.n_exhaustive_equivalent))} lattice points inside the region were evaluated with the full "
              f"horizon ({esc(str(res.n_full_evaluations))} full evaluations); {esc(str(c['slope_pruned']))} were pruned by the slope or roughness limit. "
              f"Final level: {esc(str(c['PASS']))} pass, {esc(str(c['MARGINAL']))} marginal, {esc(str(c['FAIL']))} fail.</p>")


def _sites_table(res, cons: Constraints) -> str:
    soc = "min_state_of_charge" in (res.sites[0].values if res.sites else {})
    multi = res.settings["n_epochs"] > 1
    rows, detail = [], []
    for s in res.sites:
        norm, phys = cons.margin(s.worst_margin, s.limiting, s.margin_kind)
        k = f"search:site:{s.rank}"
        rows.append(td(str(s.rank), cls="num") + f"<td>{state_chip(s.state, f'{k}:state')}</td>" + td(cons.label(s.limiting), cls="small")
                    + td(norm, f"{k}:margin", s.worst_margin, "num") + td(phys, cls="num"))
        cells = (td(str(s.rank), cls="num") + td(num(s.lat_deg, 6), f"{k}:lat", s.lat_deg, "num") + td(num(s.lon_deg, 6), f"{k}:lon", s.lon_deg, "num")
                 + td(num(s.east_m), f"{k}:east", s.east_m, "num") + td(num(s.north_m), f"{k}:north", s.north_m, "num")
                 + td(num(s.slope_deg), f"{k}:slope", s.slope_deg, "num"))
        if multi:
            cells += td(f"{s.n_epochs_pass} of {s.n_epochs}", cls="num") + td(when_utc(s.landing_utc), f"{k}:landing", s.landing_utc, "nw")
        if soc:
            v = s.values.get("min_state_of_charge")
            cells += td("no nominal value" if v is None else qty(v, "fraction"), f"{k}:soc", v, "small" if v is None else "num")
        detail.append(cells)
    head = [th("Rank", "num"), th("Verdict"), th("Limiting requirement"), th("Norm. margin", "num"), th("Margin in the requirement's unit", "num")]
    dhead = [th("Rank", "num"), th("Latitude (\u00b0)", "num"), th("Longitude (\u00b0)", "num"), th("East (m)", "num"), th("North (m)", "num"), th("Slope (\u00b0)", "num")]
    if multi:
        dhead += [th("Epochs passing", "num"), th("Best landing (UTC)")]
    if soc:
        dhead.append(th("Min. state of charge (%)", "num"))
    notes = "".join(f"<p class='small'>Margin note (engine): {esc(n)}.</p>" for n in kind_notes((s.margin_kind, s.margin_note) for s in res.sites))
    return (table(head, rows, caption="Ranked sites (margin of the limiting requirement" + (", at the site's best landing epoch). " if multi else "). ") + MARGIN_KIND_NOTE)
            + notes + table(dhead, detail, caption="Ranked sites: position and terrain", cls="dense"))


def _search_not_covered(res) -> str:
    s = res.settings
    items = []
    if s["exhaustive"]:
        items.append("The search was exhaustive over the lattice, so no point of the lattice was skipped; sites between lattice points are not examined.")
    else:
        items.append("The coarse levels are a heuristic, not a bound: a good site can be missed if its neighbourhood scores poorly at a coarse level. "
                     "Every returned verdict is exact; the list of sites is not guaranteed complete. An exhaustive search is the reference.")
    items.append("Features smaller than the lattice spacing are not examined.")
    capped = [lv for lv in res.levels if lv.capped]
    if capped:
        items.append("Promotion was capped at " + ", ".join(f"{num(lv.spacing_m)} m" for lv in capped)
                     + ": more points qualified than the cap allowed, so the best by coarse score were kept.")
    return "<h3>What this search does not cover</h3><ul class='limits'>" + "".join(f"<li>{esc(t)}</li>" for t in items) + "</ul>"


def section_search(ev, res, number: int, fig_n: int, cons: Constraints) -> str:
    out = ['<section id="search"><h2>Site search</h2>',
           "<p class='small'>A ranked site's verdict equals a full evaluation of the plan moved to it.</p>", _search_sampling(res), _levels_table(res)]
    if res.provenance.get("heading_unknown_soc"):
        out.append(_heading_note(cons))
    if res.sites:
        out.append(_sites_table(res, cons))
    else:
        out.append("<p>No site was evaluated with the full horizon: none survived the filters.</p>")
    out.append(_figure(figures.search_map(res), "Final-level verdict over the search lattice; numbered circles are the best ranked sites.", fig_n))
    out += [_search_not_covered(res), "</section>"]
    return "".join(out)
