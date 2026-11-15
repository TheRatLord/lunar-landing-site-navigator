from __future__ import annotations

import datetime as dt

import numpy as np
import yaml

from lunarnav.catalog import load_sites
from lunarnav.ephem import (
    earth_eclipse_fraction,
    earth_track,
    et_to_utc,
    subsolar_point,
    sun_track,
    utc_to_et,
)
from lunarnav.oracle import site as S
from lunarnav.oracle.model import REFERENCE, Outcome, check
from lunarnav.types import Site

JST = dt.timezone(dt.timedelta(hours=9))


def _doc() -> dict:
    return yaml.safe_load((REFERENCE / "missions.yaml").read_text(encoding="utf-8"))


def _utc(d: dt.datetime) -> str:
    return d.astimezone(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


@check("blueghost.eclipse_predicted", "blueghost.eclipse_observed_states", "blueghost.totality_end_observed")
def blue_ghost_eclipse(ctx) -> dict[str, Outcome]:
    ctx.furnish()
    bg = _doc()["blue_ghost"]
    site = Site(bg["site"]["lat_deg"], bg["site"]["lon_deg"], 0.0)
    et = S.grid("2025-03-14T04:00:00Z", "2025-03-14T11:00:00Z", 1.0)
    f = earth_eclipse_fraction(site, 0.0, et)
    partial = np.flatnonzero(f > 1e-6)
    total = np.flatnonzero(f >= 1.0)
    engine = {"partial_start_utc": et[partial[0]], "total_start_utc": et[total[0]], "total_end_utc": et[total[-1]], "partial_end_utc": et[partial[-1]]}
    rows = []
    for key, t in engine.items():
        pub = utc_to_et(bg["predicted_eclipse"][key])
        rows.append((key.replace("_utc", "").replace("_", " "), bg["predicted_eclipse"][key], et_to_utc(float(t), 0), round(float(t - pub), 1)))
    obs = bg["observed_eclipse"]
    f_partial = float(earth_eclipse_fraction(site, 0.0, np.array([utc_to_et(obs["in_partial_utc"])]))[0])
    f_total = float(earth_eclipse_fraction(site, 0.0, np.array([utc_to_et(obs["in_totality_utc"])]))[0])
    wrong = int(not 0.0 < f_partial < 1.0) + int(f_total < 1.0)
    end_gap_min = abs(float(engine["total_end_utc"]) - utc_to_et(obs["totality_end_utc"])) / 60.0
    return {
        "blueghost.eclipse_predicted": Outcome(
            max(abs(r[3]) for r in rows), "Engine `earth_eclipse_fraction` at the site on a 1 s grid, default Danjon shadow. " + bg["predicted_eclipse"]["note"],
            ("Phase", "Firefly (UTC)", "Engine (UTC)", "Engine minus Firefly (s)"), rows, 4),
        "blueghost.eclipse_observed_states": Outcome(
            float(wrong), f"Engine eclipse fraction {f_partial:.3f} at {obs['in_partial_utc']} (Firefly: eclipse under way) and "
            f"{f_total:.3f} at {obs['in_totality_utc']} (Firefly: totality). " + obs["note"], n=2),
        "blueghost.totality_end_observed": Outcome(
            end_gap_min, f"Engine end of totality at the site {et_to_utc(float(engine['total_end_utc']), 0)} against the diamond ring "
            f"photographed around {obs['totality_end_utc']}.", n=1),
    }  # fmt: skip


@check("blueghost.sunset")
def blue_ghost_sunset(ctx) -> dict[str, Outcome]:
    bg = _doc()["blue_ghost"]
    prof = S.profile(ctx.default_stack, bg["site"]["lat_deg"], bg["site"]["lon_deg"], 2.0)
    et = S.grid("2025-03-15T12:00:00Z", "2025-03-17T12:00:00Z", 600.0)
    t = S.refined_crossings(prof, et, falling=True)
    if t.size != 1:
        raise RuntimeError(f"expected one sunset in the window, found {t.size}")
    w0, w1 = utc_to_et(bg["sunset"]["window_start_utc"]), utc_to_et(bg["sunset"]["window_end_utc"])
    gap_h = max(w0 - t[0], t[0] - w1, 0.0) / 3600.0
    sphere = S.crossings(et, S.sun_signal(prof, et, np.full(720, 0.0))["flux"], 0.5, True)
    return {"blueghost.sunset": Outcome(
        float(gap_h), f"Engine sunset (half of the Sun's flux, default terrain stack, 2 m observer) {et_to_utc(float(t[0]), 0)}; "
        f"on a flat horizon it would be {et_to_utc(float(sphere[0]), 0)}. Firefly's window is {bg['sunset']['window_start_utc']} to "
        f"{bg['sunset']['window_end_utc']}. " + bg["sunset"]["note"], n=1)}  # fmt: skip


@check("slim.sunset_dates", "slim.sun_up_in_operations")
def slim(ctx) -> dict[str, Outcome]:
    sl = _doc()["slim"]
    prof = S.profile(ctx.default_stack, sl["site"]["lat_deg"], sl["site"]["lon_deg"], 2.0)
    rows, gaps, dark_days = [], [], 0
    days_checked = 0
    for op in sl["operations_jst"]:
        d0 = dt.datetime.combine(op["end"], dt.time(0), JST)
        et = S.grid(_utc(d0 - dt.timedelta(days=4)), _utc(d0 + dt.timedelta(days=5)), 600.0)
        t = S.refined_crossings(prof, et, falling=True)
        if t.size != 1:
            raise RuntimeError(f"expected one sunset near {op['end']}, found {t.size}")
        a, b = utc_to_et(_utc(d0)), utc_to_et(_utc(d0 + dt.timedelta(days=1)))
        gap_h = max(a - t[0], t[0] - b, 0.0) / 3600.0
        gaps.append(gap_h)
        engine_jst = dt.datetime.fromisoformat(et_to_utc(float(t[0]), 0).replace("Z", "+00:00")).astimezone(JST)
        rows.append((f"{op['start']} to {op['end']}", engine_jst.strftime("%Y-%m-%d %H:%M JST"), round(gap_h, 2)))
        day = op["start"]
        while day < op["end"]:
            noon = dt.datetime.combine(day, dt.time(23, 0), JST)
            area = S.sun_signal(prof, np.array([utc_to_et(_utc(noon))]))["area"][0]
            dark_days += int(area <= 0.0)
            days_checked += 1
            day += dt.timedelta(days=1)
    return {
        "slim.sunset_dates": Outcome(
            float(max(gaps)), "Engine sunset (half flux, default terrain stack) against the last date of each period of operations. "
            "The gap is zero when the engine's sunset falls on that Japan-time date. " + sl["note"],
            ("Operations (Japan time)", "Engine sunset", "Hours outside the last date"), rows, len(rows)),
        "slim.sun_up_in_operations": Outcome(
            float(dark_days), f"The Sun must be above the terrain horizon at the end (23:00 Japan time) of each of the {days_checked} "
            "operating dates before the last one of each period.", n=days_checked),
    }  # fmt: skip


@check("chandrayaan3.local_time", "chandrayaan3.sun_up_before_sleep")
def chandrayaan3(ctx) -> dict[str, Outcome]:
    c3 = _doc()["chandrayaan_3"]
    lat, lon = c3["site"]["lat_deg"], c3["site"]["lon_deg"]
    ctx.furnish()
    rows = []
    for item in c3["local_time_labels"]:
        _, sub = subsolar_point(np.array([utc_to_et(item["utc"])]))
        engine_h = (12.0 + (lon - float(sub[0])) / 15.0) % 24.0
        hh, mm = (int(v) for v in item["local"].split(":"))
        d = (engine_h - (hh + mm / 60.0) + 12.0) % 24.0 - 12.0
        rows.append((item["event"], item["utc"], item["local"], f"{int(engine_h):02d}:{int(engine_h % 1 * 60):02d}", round(d, 3)))
    prof = S.profile(ctx.default_stack, lat, lon, 2.0)
    landing = next(i["utc"] for i in c3["local_time_labels"] if i["event"] == "landing")
    times = [landing, c3["asleep"]["lander_sleep_utc"]]
    area = S.sun_signal(prof, np.array([utc_to_et(t) for t in times]))["area"]
    return {
        "chandrayaan3.local_time": Outcome(
            max(abs(r[4]) for r in rows), "Engine local solar time (from the sub-solar longitude) at the four labelled instants. "
            "The table's sunrise and sunset are local-time labels, not horizon crossings, so they are not compared with engine "
            "sunrise or sunset. Source: " + c3["source"] + ".",
            ("Event", "UTC", "Label", "Engine local solar time", "Engine minus label (h)"), rows, len(rows)),
        "chandrayaan3.sun_up_before_sleep": Outcome(
            float(np.sum(area <= 0.0)), f"Visible fraction of the Sun's disc above the terrain horizon: {area[0]:.2f} at landing ({times[0]}) "
            f"and {area[1]:.2f} when the lander was put to sleep ({times[1]}). " + c3["asleep"]["source"] + ".", n=2),
    }  # fmt: skip


@check("landings.sun_up")
def landings(ctx) -> dict[str, Outcome]:
    lo, hi = ctx.furnish().valid_et
    rows, left_out = [], []
    for s in load_sites():
        if s.kind != "landed" or not s.landing_utc:
            continue
        t = utc_to_et(s.landing_utc)
        if not lo <= t <= hi:
            continue
        el = float(sun_track(Site(s.lat_deg, s.lon_deg, 0.0), 0.0, np.array([t])).el_deg[0])
        if s.name.startswith("Luna "):
            left_out.append(f"{s.name} ({s.landing_utc}, engine {el:.1f}°)")
            continue
        rows.append((s.name, s.landing_utc, round(el, 2)))
    rows.sort(key=lambda r: r[1])
    note = (
        " Left out: " + "; ".join(left_out) + ". The Luna landers ran on batteries and no source opened says they touched "
        "down in daylight; Luna 13 sent its panoramas on the two days after landing." if left_out else ""
    )
    return {"landings.sun_up": Outcome(
        min(r[2] for r in rows), "Engine Sun elevation above the smooth sphere at the catalogue's touchdown time and position, for "
        "the Surveyor, Apollo and solar-powered landers, all of which touched down in daylight." + note,
        ("Lander", "Touchdown (UTC)", "Engine Sun elevation (°)"), rows, len(rows))}  # fmt: skip


@check("farside.earth_never_visible")
def far_side(ctx) -> dict[str, Outcome]:
    ctx.furnish()
    doc = _doc()["far_side"]
    sites = {s.id: s for s in load_sites()}
    rows = []
    for m in doc["missions"]:
        s = sites[m["id"]]
        t0 = utc_to_et(s.landing_utc)
        et = t0 + np.arange(0.0, m["days"] * 86400.0, 1800.0)
        tr = earth_track(Site(s.lat_deg, s.lon_deg, 0.0), 0.0, et)
        rows.append((s.name, s.landing_utc, m["days"], round(float((tr.el_deg + tr.ang_radius_deg).max()), 2)))
    return {"farside.earth_never_visible": Outcome(
        max(r[3] for r in rows), "Highest elevation of the Earth's upper limb above the smooth sphere over the days after "
        "landing. " + doc["note"], ("Lander", "Landing (UTC)", "Days", "Highest Earth limb elevation (°)"), rows, len(rows))}  # fmt: skip
