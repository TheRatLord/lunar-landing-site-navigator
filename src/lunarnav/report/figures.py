"""Report figures, drawn only from engine result arrays and interval rows, as inline SVG.

Greyscale rule: no information is carried by hue alone. Series differ by line style, marker shape and
fill lightness; uncertain regions carry a hatch. Text stays real text (`svg.fonttype = none`) set in the
bundled DejaVu Sans, so the figures use the same embedded font as the page. `svg.hashsalt` is fixed so
element ids, and therefore the bytes, repeat.
"""

from __future__ import annotations

import io
import re

import matplotlib as mpl
import numpy as np
from matplotlib.figure import Figure
from matplotlib.lines import Line2D
from matplotlib.patches import Patch

from .errors import ReportInputError, need
from .fmt import when as when_text

INK = "#111111"
GREY_DARK = "#4d4d4d"
GREY_MID = "#9a9a9a"
GREY_LIGHT = "#d9d9d9"
HOUR_S = 3600.0
WIDTH_IN = 7.2

_RC = {
    "svg.fonttype": "none", "svg.hashsalt": "lunarnav-report", "font.family": "DejaVu Sans", "font.size": 7.5,
    "axes.edgecolor": INK, "axes.labelcolor": INK, "axes.titlesize": 8.5, "axes.titleweight": "bold",
    "axes.titlelocation": "left", "xtick.color": INK, "ytick.color": INK, "text.color": INK,
    "axes.linewidth": 0.7, "text.parse_math": False, "lines.solid_capstyle": "butt", "hatch.linewidth": 0.5, "axes.grid": False,
}


def _svg(fig: Figure) -> str:
    """Inline-ready SVG text (no XML prolog, no fixed pixel size)."""
    buf = io.StringIO()
    with mpl.rc_context(_RC):
        fig.savefig(buf, format="svg", metadata={"Date": None, "Creator": "lunarnav.report"})
    text = buf.getvalue()
    text = text[text.index("<svg"):]
    text = re.sub(r'(<svg\b[^>]*?)\swidth="[^"]*"\s+height="[^"]*"', r"\1", text, count=1)
    return text


def _figure(height_in: float) -> Figure:
    with mpl.rc_context(_RC):
        return Figure(figsize=(WIDTH_IN, height_in), dpi=100, layout="constrained")


def _window(ev) -> tuple[np.ndarray, np.ndarray]:
    t = need(need(ev, "signals", "evaluation"), "et", "evaluation.signals")
    mask = (t >= ev.t_land_et) & (t <= ev.t_land_et + ev.mission_s)
    if mask.sum() < 2:
        raise ReportInputError("the evaluation grid holds fewer than two samples inside the mission")
    return mask, (t[mask] - ev.t_land_et) / HOUR_S


def _bars(ax, rows, row_y: float, t0: float, x_lo: float, x_hi: float, height: float = 0.62) -> None:
    """Interval rows as bars on one strip: solid nominal bar, hatched edge ranges, hatched whole bar when the
    interval exists in the optimistic world only."""
    for r in rows:
        a, b = (r.start_et - t0) / HOUR_S, (r.end_et - t0) / HOUR_S
        if r.nominal:
            ax.broken_barh([(max(a, x_lo), min(b, x_hi) - max(a, x_lo))], (row_y - height / 2, height),
                           facecolors=GREY_DARK, edgecolors=INK, linewidth=0.4)
            edges = []
            if not r.start_censored:
                edges.append(r.start_range)
            if not r.end_censored:
                edges.append(r.end_range)
        else:
            edges = [(r.start_range[0], r.end_range[1])]
        for lo, hi in edges:
            lo_h, hi_h = (lo - t0) / HOUR_S, (hi - t0) / HOUR_S
            if hi_h - lo_h <= 0.0 or hi_h < x_lo or lo_h > x_hi:
                continue
            ax.broken_barh([(max(lo_h, x_lo), min(hi_h, x_hi) - max(lo_h, x_lo))], (row_y - height / 2, height),
                           facecolors="white", edgecolors=INK, hatch="/////", linewidth=0.4)


def soc_has_no_nominal(ev) -> bool:
    """The engine states no nominal state of charge (the heading is unknown and moves the battery): only a range."""
    return "soc" in ev.no_nominal_series


def timeline(ev) -> str:
    """Sun and Earth elevation, state strips (sunlit, eclipse, network and per-station contact, with edge
    ranges) and battery state of charge over the mission, hours after landing."""
    sig = need(ev, "signals", "evaluation")
    mask, x = _window(ev)
    t0 = ev.t_land_et
    x_lo, x_hi = 0.0, ev.mission_s / HOUR_S
    ivs = need(ev, "intervals", "evaluation")
    for k in ("sunlit", "eclipse", "contact"):
        need(ivs, k, "evaluation.intervals")
    strips = [("Sunlit (array)", ivs["sunlit"]), ("Earth eclipse", ivs["eclipse"]),
              ("Earth link", ivs["contact"])]
    strips += [(f"Link {k.split(':', 1)[1]}", v) for k, v in ivs.items() if k.startswith("contact:")]
    soc = need(ev, "soc", "evaluation")
    for w in ("nominal", "pessimistic", "optimistic"):
        need(soc, w, "evaluation.soc")
    n = len(strips)
    fig = _figure(1.5 + 0.2 * n + 1.5 + 1.4)
    gs = fig.add_gridspec(4, 1, height_ratios=[1.3, 1.1, 0.34 * n + 0.2, 1.3], hspace=0.12)
    ax_sun, ax_earth, ax_st, ax_soc = (fig.add_subplot(gs[i]) for i in range(4))

    ax_sun.plot(x, sig.sun_el_deg[mask], color=INK, lw=1.1)
    ax_sun.axhline(0, color=GREY_MID, lw=0.6, ls=":")
    ax_sun.set_ylabel("Sun elev.\n(°)", fontsize=7)
    ax_sun.set_title("Mission timeline")
    ax_earth.plot(x, sig.earth_el_deg[mask], color=INK, lw=1.1, ls="--")
    ax_earth.axhline(0, color=GREY_MID, lw=0.6, ls=":")
    ax_earth.set_ylabel("Earth elev.\n(°)", fontsize=7)

    for i, (_name, rows) in enumerate(strips):
        _bars(ax_st, rows, n - 1 - i, t0, x_lo, x_hi)
    ax_st.set_yticks(range(n))
    ax_st.set_yticklabels([s[0] for s in reversed(strips)], fontsize=6.5)
    ax_st.set_ylim(-0.6, n - 0.4)

    s = {w: soc[w][mask] * 100.0 for w in soc}
    no_nominal = soc_has_no_nominal(ev)
    ax_soc.fill_between(x, s["pessimistic"], s["optimistic"], facecolor=GREY_LIGHT, edgecolor="none")
    ax_soc.plot(x, s["pessimistic"], color=INK, lw=0.8, ls=":")
    ax_soc.plot(x, s["optimistic"], color=INK, lw=0.8, ls="-.")
    if not no_nominal:
        ax_soc.plot(x, s["nominal"], color=INK, lw=1.2)
    lim = ev.scenario.constraints.min_state_of_charge
    if lim is not None and lim.min is not None:
        ax_soc.axhline(lim.min * 100.0, color=INK, lw=0.7, ls=(0, (1, 2)))
        ax_soc.text(x_hi, lim.min * 100.0 + 3.0, "limit ", ha="right", va="bottom", fontsize=6.5)
    when = next((m.when for m in ev.metrics if m.key == "min_state_of_charge" and m.when), {})
    tick_cases = ("nominal",) if when.get("nominal") is not None else ("optimistic", "pessimistic")
    for case in tick_cases:
        inst = when.get(case)
        if inst is None:
            continue
        hx = (inst.et - t0) / HOUR_S
        if x_lo <= hx <= x_hi:
            ax_soc.plot([hx], [float(np.interp(hx, x, s[case]))], marker="v", ms=5.5, mfc="white", mec=INK, mew=0.9, ls="none", zorder=5)
    ax_soc.set_ylim(-2.0, 105.0)
    ax_soc.set_ylabel("State of\ncharge (%)", fontsize=7)
    ax_soc.set_xlabel("Hours after landing")

    for ax in (ax_sun, ax_earth, ax_st, ax_soc):
        ax.set_xlim(x_lo, x_hi)
        ax.margins(y=0.08) if ax in (ax_sun, ax_earth) else None
        ax.tick_params(labelsize=7)
    for ax in (ax_sun, ax_earth, ax_st):
        ax.tick_params(labelbottom=False)
    handles = [Line2D([], [], color=INK, lw=1.1, label="Sun elevation"),
               Line2D([], [], color=INK, lw=1.1, ls="--", label="Earth elevation"),
               Patch(facecolor=GREY_DARK, edgecolor=INK, label="Interval (nominal horizon)"),
               Patch(facecolor="white", edgecolor=INK, hatch="/////", label="Edge range, best to worst case"),
               *([] if no_nominal else [Line2D([], [], color=INK, lw=1.2, label="Battery, nominal")]),
               Line2D([], [], color=INK, lw=0.8, ls=":", label="Battery, worst case"),
               Line2D([], [], color=INK, lw=0.8, ls="-.", label="Battery, best case")]
    if no_nominal:
        handles.append(Patch(facecolor=GREY_LIGHT, edgecolor="none", label="Battery range over headings (no nominal)"))
    if when:
        handles.append(Line2D([], [], marker="v", ms=5.5, mfc="white", mec=INK, mew=0.9, ls="none",
                              label="Lowest battery" + (" (best and worst case)" if no_nominal else " (nominal)")))
    fig.legend(handles=handles, loc="outside lower center", ncol=4, fontsize=6.5, frameon=False)
    return _svg(fig)


def _wrap_breaks(az: np.ndarray, el: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Insert NaN where the azimuth wraps through north so the line is not drawn across the panorama."""
    jump = np.flatnonzero(np.abs(np.diff(az)) > 180.0)
    return np.insert(az, jump + 1, np.nan), np.insert(el, jump + 1, np.nan)


def panorama(ev) -> str:
    """Array and antenna horizons (nominal line, bracket band) with the Sun and Earth paths over the mission."""
    sig = need(ev, "signals", "evaluation")
    mask, x = _window(ev)
    fig = _figure(3.6)
    ax = fig.add_subplot(111)
    ah, nh = sig.array_horizon, sig.antenna_horizon
    ax.fill_between(ah.az_deg, ah.elev_lo_deg, ah.elev_hi_deg, facecolor=GREY_LIGHT, edgecolor="none")
    ax.plot(ah.az_deg, ah.elev_deg, color=INK, lw=1.0)
    ax.fill_between(nh.az_deg, nh.elev_lo_deg, nh.elev_hi_deg, facecolor="none", edgecolor=GREY_MID,
                    hatch="\\\\\\\\", linewidth=0)
    ax.plot(nh.az_deg, nh.elev_deg, color=INK, lw=0.9, ls="--")
    for name, az, el, style, marker in (
            ("Sun", sig.sun_az_deg[mask], sig.sun_el_deg[mask], dict(color=INK, lw=1.8), "s"),
            ("Earth", sig.earth_az_deg[mask], sig.earth_el_deg[mask], dict(color=GREY_DARK, lw=1.2, ls=(0, (5, 2))), "o")):
        a, e = _wrap_breaks(az % 360.0, el)
        ax.plot(a, e, **style)
        day = np.arange(0.0, x[-1] + 1e-9, 24.0)
        idx = np.searchsorted(x, day).clip(0, len(x) - 1)
        ax.plot(az[idx] % 360.0, el[idx], ls="none", marker=marker, ms=3.2, mfc="white", mec=INK, mew=0.8)
        ax.plot(az[0] % 360.0, el[0], ls="none", marker="*", ms=9, mfc=INK if name == "Sun" else "white", mec=INK, mew=0.8)
    lows = np.concatenate([ah.elev_lo_deg, nh.elev_lo_deg])
    highs = np.concatenate([ah.elev_hi_deg, nh.elev_hi_deg, sig.sun_el_deg[mask], sig.earth_el_deg[mask]])
    ax.set_ylim(min(lows.min(), -1.0) - 0.5, highs.max() + 1.5)
    ax.set_xlim(0, 360)
    ax.set_xticks(range(0, 361, 45))
    ax.set_xticklabels(["N 0", "NE 45", "E 90", "SE 135", "S 180", "SW 225", "W 270", "NW 315", "N 360"])
    ax.set_xlabel("Azimuth (° clockwise from north)")
    ax.set_ylabel("Elevation (°)")
    ax.set_title("Horizon panorama with Sun and Earth paths")
    handles = [Line2D([], [], color=INK, lw=1.0, label="Array horizon (nominal)"),
               Patch(facecolor=GREY_LIGHT, edgecolor="none", label="Array horizon bracket"),
               Line2D([], [], color=INK, lw=0.9, ls="--", label="Antenna horizon (nominal)"),
               Patch(facecolor="none", edgecolor=GREY_MID, hatch="\\\\\\\\", label="Antenna horizon bracket"),
               Line2D([], [], color=INK, lw=1.8, label="Sun path"),
               Line2D([], [], color=GREY_DARK, lw=1.2, ls=(0, (5, 2)), label="Earth path"),
               Line2D([], [], ls="none", marker="*", ms=8, mfc="white", mec=INK, label="Landing"),
               Line2D([], [], ls="none", marker="s", ms=3.5, mfc="white", mec=INK, label="Sun, every 24 h"),
               Line2D([], [], ls="none", marker="o", ms=3.5, mfc="white", mec=INK, label="Earth, every 24 h")]
    fig.legend(handles=handles, loc="outside lower center", ncol=5, fontsize=6.5, frameon=False)
    return _svg(fig)


def calendar(scan) -> str:
    """Landing-opportunity calendar: lunation rows by hours after new moon, state per cell."""
    cal = need(scan, "calendar", "opportunity_scan")
    state = need(cal, "state", "opportunity_scan.calendar")
    lunas = need(cal, "lunations", "opportunity_scan.calendar")
    n_rows, n_cols = state.shape
    fig = _figure(min(1.5 + 0.105 * n_rows, 7.4))
    ax = fig.add_subplot(111)
    xe = np.arange(n_cols + 1) * cal.bin_h / 24.0
    ye = np.arange(n_rows + 1)
    layers = ((-1, "#ececec", None), (0, GREY_DARK, None), (1, GREY_MID, "/////"), (2, "white", None))
    for value, face, hatch in layers:
        m = np.ma.masked_where(state != value, np.where(state == value, 1.0, np.nan))
        coll = ax.pcolormesh(xe, ye, m, cmap=mpl.colors.ListedColormap([face]), vmin=0, vmax=1, edgecolors="none",
                             linewidth=0, rasterized=False)
        if hatch:
            coll.set_hatch(hatch)
            coll.set_edgecolor(INK)
    ax.add_patch(mpl.patches.Rectangle((0, 0), xe[-1], n_rows, fill=False, edgecolor=INK, lw=0.7))
    ax.set_ylim(n_rows, 0)
    ax.set_xlim(0, xe[-1])
    step = max(1, n_rows // 14)
    ax.set_yticks(np.arange(0, n_rows, step) + 0.5)
    ax.set_yticklabels([when_text(lunas[i].start_et).rsplit(" ", 2)[0] for i in range(0, n_rows, step)], fontsize=6.5)
    ax.set_xlabel("Days after new moon (landing time), bins of "
                  f"{cal.bin_h:g} h")
    ax.set_ylabel("Lunar day\n(new moon, UTC)", fontsize=7)
    ax.set_title("Landing dates")
    handles = [Patch(facecolor="white", edgecolor=INK, label="Pass"),
               Patch(facecolor=GREY_MID, edgecolor=INK, hatch="/////", label="Marginal (best landing time in cell)"),
               Patch(facecolor=GREY_DARK, edgecolor=INK, label="Fail"),
               Patch(facecolor="#ececec", edgecolor=INK, label="No landing time")]
    fig.legend(handles=handles, loc="outside lower center", ncol=4, fontsize=6.5, frameon=False)
    return _svg(fig)


KIND_LABEL = {"worst_case": "worst case", "nominal": "nominal", "best_case": "upper bound over headings"}


def slip_margin_runs(rows) -> list[tuple[str, list[tuple[float, float]]]]:
    """The line segments of the slip margin chart: runs of consecutive rows with a margin and the same `margin_kind`. Margins of
    different kinds are never joined, because one is not better than another by its size."""
    runs: list[tuple[str, list[tuple[float, float]]]] = []
    for r in rows:
        if r.margin is None:
            continue
        kind = r.margin_kind or "worst_case"
        if runs and runs[-1][0] == kind:
            runs[-1][1].append((r.slip_h, r.margin))
        else:
            runs.append((kind, [(r.slip_h, r.margin)]))
    return runs


def slip_curve(slip) -> str:
    """Normalised worst-case margin of the limiting constraint, and the wait to the next open candidate, versus slip."""
    rows = need(slip, "rows", "slip_result")
    if not rows:
        raise ReportInputError("slip result has no rows")
    fig = _figure(3.6)
    gs = fig.add_gridspec(2, 1, height_ratios=[2.2, 1.0], hspace=0.1)
    ax, ax2 = fig.add_subplot(gs[0]), fig.add_subplot(gs[1])
    marks = {"pass": ("o", "white"), "marginal": ("^", GREY_MID), "fail": ("X", INK)}
    for _, run in slip_margin_runs(rows):
        if len(run) > 1:
            ax.plot(*zip(*run), color=INK, lw=0.8, zorder=1)
    rings = {"nominal": ("o", 11.5), "best_case": ("s", 11.5)}
    for r in rows:
        if r.state in marks and r.margin is not None:
            m, face = marks[r.state]
            ax.plot(r.slip_h, r.margin, ls="none", marker=m, ms=6, mfc=face, mec=INK, mew=0.9, zorder=3)
            if r.margin_kind in rings:
                rm, rs = rings[r.margin_kind]
                ax.plot(r.slip_h, r.margin, ls="none", marker=rm, ms=rs, mfc="none", mec=INK, mew=0.7, zorder=2)
        elif r.state == "no_opportunity":
            ax.axvline(r.slip_h, color=INK, lw=0.6, ls=":")
    ax.axhline(0, color=INK, lw=0.7)
    shown = [KIND_LABEL[k] for k in KIND_LABEL if any(kind == k for kind, _ in slip_margin_runs(rows))]
    ax.set_ylabel("Normalised margin\n(" + ", ".join(shown) + ")", fontsize=7)
    ax.set_title(f"Slip analysis ({slip.mode} slip)")
    ax.tick_params(labelbottom=False)
    waits = [(r.slip_h, round(r.next_open_wait_h, 6)) for r in rows if r.next_open_wait_h is not None]
    if waits:
        xs, ys = zip(*waits)
        span = (max(xs) - min(xs)) / max(len(xs), 1) if len(xs) > 1 else 1.0
        ax2.bar(xs, ys, width=0.7 * span if span > 0 else 1.0, facecolor=GREY_MID, edgecolor=INK, linewidth=0.5)
    none_open = [r.slip_h for r in rows if r.next_open_wait_h is None]
    if none_open:
        top = max([y for _, y in waits], default=0.0)
        top = top if top > 0 else 1.0
        ax2.set_ylim(-0.18 * top, 1.1 * top)
        ax2.plot(none_open, [0.0] * len(none_open), ls="none", marker="D", ms=5, mfc="white", mec=INK, mew=0.9, clip_on=False, zorder=3)
    ax2.set_ylabel("Wait (h)", fontsize=7)
    ax2.set_xlabel("Slip (hours; positive = later)")
    for a in (ax, ax2):
        a.tick_params(labelsize=7)
        a.set_xlim(min(r.slip_h for r in rows) - 1, max(r.slip_h for r in rows) + 1)
    handles = [Line2D([], [], ls="none", marker="o", mfc="white", mec=INK, label="Pass"),
               Line2D([], [], ls="none", marker="^", mfc=GREY_MID, mec=INK, label="Marginal"),
               Line2D([], [], ls="none", marker="X", mfc=INK, mec=INK, label="Fail"),
               Line2D([], [], color=INK, lw=0.6, ls=":", label="No launch opportunity")]
    shown_kinds = {kind for kind, _ in slip_margin_runs(rows)}
    if "nominal" in shown_kinds:
        handles.append(Line2D([], [], ls="none", marker="o", ms=9, mfc="none", mec=INK, mew=0.7, label="Ring: nominal margin"))
    if "best_case" in shown_kinds:
        handles.append(Line2D([], [], ls="none", marker="s", ms=9, mfc="none", mec=INK, mew=0.7, label="Square: best-heading margin"))
    if none_open:
        handles.append(Line2D([], [], ls="none", marker="D", mfc="white", mec=INK, label="No open landing found"))
    fig.legend(handles=handles, loc="outside lower center", ncol=4, fontsize=6.5, frameon=False)
    return _svg(fig)


def _state_layers(ax, east_edges, north_edges, state, codes, extra=()) -> None:
    """Draw `state` (ny, nx) as pcolormesh layers: one per `(code, face, hatch)` in `codes` (+ `extra` layers)."""
    for value, face, hatch in (*codes, *extra):
        m = np.ma.masked_where(state != value, np.where(state == value, 1.0, np.nan))
        coll = ax.pcolormesh(east_edges, north_edges, m, cmap=mpl.colors.ListedColormap([face]), vmin=0, vmax=1,
                             edgecolors="none", linewidth=0, rasterized=False, antialiased=False)
        if hatch:
            coll.set_hatch(hatch)
            coll.set_edgecolor(INK)


def _edges(centres: np.ndarray, spacing: float) -> np.ndarray:
    return np.append(centres - spacing / 2.0, centres[-1] + spacing / 2.0)


STATE_LEGEND = (("Pass", "white", None), ("Marginal", GREY_MID, "/////"), ("Fail", GREY_DARK, None))


def ellipse_map(res) -> str:
    """Verdict at the nodes of the ellipse map, the ellipse outline and the sample points (east, north from the site)."""
    from lunarnav.scenario.engine import FAIL, MARGINAL, PASS, UNKNOWN

    mp = need(res, "map", "ellipse result")
    if mp is None:
        raise ReportInputError("the ellipse result has no map")
    ell = need(res.provenance, "ellipse", "ellipse result provenance")
    a, b, az = ell["semi_major_m"], ell["semi_minor_m"], np.radians(ell["azimuth_deg"])
    ax_e = mp.east_m[0]
    ax_n = mp.north_m[:, 0]
    fig = _figure(4.6)
    ax = fig.add_subplot(111)
    _state_layers(ax, _edges(ax_e, mp.spacing_m), _edges(ax_n, mp.spacing_m), mp.state,
                  ((PASS, "white", None), (MARGINAL, GREY_MID, "/////"), (FAIL, GREY_DARK, None), (UNKNOWN, "#ececec", None)))
    th = np.linspace(0.0, 2.0 * np.pi, 361)
    u, v = a * np.cos(th), b * np.sin(th)
    ax.plot(u * np.sin(az) + v * np.cos(az), u * np.cos(az) - v * np.sin(az), color=INK, lw=0.9)
    ax.plot(res.east_m, res.north_m, ls="none", marker=".", ms=1.6, color=INK, alpha=0.55)
    ax.plot(0.0, 0.0, ls="none", marker="+", ms=9, mew=1.2, color=INK)
    ax.set_aspect("equal")
    ax.set_xlabel("East of the site (m)")
    ax.set_ylabel("North of the site (m)")
    ax.set_title(f"Landing ellipse: verdict at {mp.state.shape[1]} x {mp.state.shape[0]} map nodes")
    handles = [Patch(facecolor=f, edgecolor=INK, hatch=h, label=n) for n, f, h in STATE_LEGEND]
    handles += [Patch(facecolor="#ececec", edgecolor=INK, label="Unknown"),
                Line2D([], [], color=INK, lw=0.9, label="Ellipse"),
                Line2D([], [], ls="none", marker=".", ms=3, color=INK, label="Samples"),
                Line2D([], [], ls="none", marker="+", ms=8, color=INK, label="Site")]
    fig.legend(handles=handles, loc="outside lower center", ncol=7, fontsize=6.5, frameon=False)
    return _svg(fig)


def search_map(res, top: int = 10) -> str:
    """Final-level verdict over the search lattice with the best `top` ranked sites numbered."""
    from lunarnav.scenario.engine import FAIL, MARGINAL, PASS
    from lunarnav.scenario.search import STATUS_COARSE, STATUS_NOT_EVALUATED, STATUS_SLOPE_PRUNED

    g = need(res, "grid", "search result")
    s = float(need(res.settings, "final_spacing_m", "search result settings"))
    fig = _figure(4.8)
    ax = fig.add_subplot(111)
    _state_layers(ax, _edges(g.east_m, s), _edges(g.north_m, s), g.state,
                  ((PASS, "white", None), (MARGINAL, GREY_MID, "/////"), (FAIL, GREY_DARK, None)))
    other = np.select([g.status == STATUS_SLOPE_PRUNED, (g.status == STATUS_NOT_EVALUATED) | (g.status == STATUS_COARSE)], [1, 2], 0)
    _state_layers(ax, _edges(g.east_m, s), _edges(g.north_m, s), other, ((1, "#ececec", "xxxx"), (2, "#ececec", None)))
    for site in res.sites[:top]:
        ax.plot(site.east_m, site.north_m, ls="none", marker="o", ms=9, mfc="white", mec=INK, mew=1.0, zorder=4)
        ax.annotate(str(site.rank), (site.east_m, site.north_m), ha="center", va="center", fontsize=5.5, zorder=5)
    ax.set_aspect("equal")
    ax.set_xlabel("East of the region centre (m)")
    ax.set_ylabel("North of the region centre (m)")
    ax.set_title(f"Site search: verdict on the {s:g} m lattice")
    handles = [Patch(facecolor=f, edgecolor=INK, hatch=h, label=n) for n, f, h in STATE_LEGEND]
    handles += [Patch(facecolor="#ececec", edgecolor=INK, hatch="xxxx", label="Pruned by slope or roughness limit"),
                Patch(facecolor="#ececec", edgecolor=INK, label="Not evaluated with the full horizon"),
                Line2D([], [], ls="none", marker="o", mfc="white", mec=INK, label=f"Ranked site (best {min(top, len(res.sites))})")]
    fig.legend(handles=handles, loc="outside lower center", ncol=3, fontsize=6.5, frameon=False)
    return _svg(fig)
