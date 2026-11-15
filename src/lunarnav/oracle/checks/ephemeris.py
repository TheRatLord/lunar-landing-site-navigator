from __future__ import annotations

import datetime as dt
import json
import re

import numpy as np
import spiceypy as spice
import yaml

from lunarnav.constants import R_MOON_M
from lunarnav.ephem import (
    BodyFixedEphemeris,
    earth_eclipse_fraction,
    earth_track,
    eclipse_occulting_radius_km,
    subearth_point,
    subsolar_point,
    sun_track,
    utc_to_et,
)
from lunarnav.ephem.geometry import local_basis
from lunarnav.oracle import geometry as G
from lunarnav.oracle.model import REFERENCE, NotRun, Outcome, check
from lunarnav.types import Site

MIN_PHASE_MIN = {"P": 120.0, "U": 70.0, "T": 35.0}
CONTACTS = {"P1": ("P", "min", True), "P4": ("P", "min", False), "U1": ("U", "min", True), "U4": ("U", "min", False),
            "U2": ("T", "max", True), "U3": ("T", "max", False)}  # fmt: skip
MONTHS = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split()


def _tt_et(day: dt.date, hms: str) -> float:
    return float(spice.str2et(f"{day.year} {MONTHS[day.month - 1]} {day.day:02d} {hms} TDT"))


def _site(u: np.ndarray) -> Site:
    lat, lon = G.lat_lon_from_unit(u)
    return Site(float(lat), float(lon), 0.0)


def _margins(points: np.ndarray, tab: BodyFixedEphemeris, radius_km: float) -> tuple[np.ndarray, np.ndarray]:
    pen = np.empty((len(points), len(tab)))
    umb = np.empty_like(pen)
    for i, u in enumerate(points):
        site = _site(u)
        sun = sun_track(site, 0.0, tab)
        earth = earth_track(site, 0.0, tab, earth_radius_km=radius_km)
        sep = G.separation_deg(G.unit_from_az_el(sun.az_deg, sun.el_deg), G.unit_from_az_el(earth.az_deg, earth.el_deg))
        pen[i] = sep - (earth.ang_radius_deg + sun.ang_radius_deg)
        umb[i] = sep - (earth.ang_radius_deg - sun.ang_radius_deg)
    return pen, umb


def _refine(points: np.ndarray, t0: float, name: str, radius_km: float, half_s: float, step_s: float):
    phase, extreme, first = CONTACTS[name]
    et = t0 + np.arange(-half_s, half_s + step_s / 2, step_s)
    tab = BodyFixedEphemeris.build(et, interpolate=False)
    pen, umb = _margins(points, tab, radius_km)
    m = pen if phase == "P" else umb
    g = m.min(axis=0) if extreme == "min" else m.max(axis=0)
    tc = G.crossing(et, g, first)
    k = int(np.argmin(np.abs(et - tc))) if tc == tc else 0
    best = points[int(np.argmin(m[:, k]) if extreme == "min" else np.argmax(m[:, k]))]
    return tc, best


def _contact(name: str, t_guess: float, sphere: np.ndarray, radius_km: float) -> tuple[float, Site]:
    tc, best = _refine(sphere, t_guess, name, radius_km, 900.0, 20.0)
    for cap, step, half, dt_s in ((7.0, 0.5, 90.0, 2.0), (0.7, 0.05, 10.0, 0.5)):
        if tc != tc:
            break
        tc, best = _refine(G.cap_points(best, cap, step), tc, name, radius_km, half, dt_s)
    return tc, _site(best)


def _fraction_flips(name: str, tc: float, site: Site) -> bool:
    phase, _, first = CONTACTS[name]
    f = earth_eclipse_fraction(site, 0.0, np.array([tc - 2.0, tc + 2.0]))
    before, after = (f[0], f[1]) if first else (f[1], f[0])
    if phase == "P":
        return bool(before == 0.0 and after > 0.0)
    return bool(before < 1.0 and after == 1.0)


@check("eclipse.totality_contacts", "eclipse.umbral_contacts", "eclipse.penumbral_contacts", "eclipse.grazing_contacts")
def eclipses(ctx) -> dict[str, Outcome]:
    ctx.furnish()
    doc = yaml.safe_load((REFERENCE / "eclipses.yaml").read_text(encoding="utf-8"))
    radius = eclipse_occulting_radius_km("danjon")
    sphere = G.fibonacci_sphere(1200)
    groups: dict[str, list[tuple]] = {"T": [], "U": [], "P": [], "grazing": []}
    mismatched = 0
    for e in doc["eclipses"]:
        day = e["date"]
        g0 = _tt_et(day, e["greatest_td"])
        pub: dict[str, float] = {}
        for name in CONTACTS:
            if name in e:
                t = _tt_et(day, e[name]) + e["delta_t_s"]
                t += 86400.0 * round((g0 - t) / 86400.0)
                pub[name] = t
        for name, t_pub in pub.items():
            phase = CONTACTS[name][0]
            pair = {"P": ("P1", "P4"), "U": ("U1", "U4"), "T": ("U2", "U3")}[phase]
            duration_min = (pub[pair[1]] - pub[pair[0]]) / 60.0
            tc, site = _contact(name, t_pub, sphere, radius)
            gated = duration_min >= MIN_PHASE_MIN[phase]
            if tc != tc:
                if gated:
                    raise RuntimeError(f"no {name} contact found within 15 minutes of the published time for {e['id']}")
                groups["grazing"].append((e["id"], name, round(duration_min, 1), float("nan")))
                continue
            mismatched += not _fraction_flips(name, tc, site)
            groups[phase if gated else "grazing"].append((e["id"], name, round(duration_min, 1), round(tc - t_pub, 2)))
    if mismatched:
        raise RuntimeError(f"{mismatched} contacts where earth_eclipse_fraction does not change state at the contact found")
    cols = ("Eclipse", "Contact", "Phase duration (min)", "Engine minus published (s)")

    def outcome(rows: list[tuple], note: str) -> Outcome:
        found = [abs(r[3]) for r in rows if r[3] == r[3]]
        missing = len(rows) - len(found)
        extra = f" {missing} contacts were not found within 15 minutes of the published time." if missing else ""
        return Outcome(max(found), f"{note} Mean |residual| {float(np.mean(found)):.2f} s over {len(found)} contacts.{extra}", cols, rows, len(rows))

    note = ("Contacts are found from the engine's Sun and Earth tracks over the whole lunar sphere, with the engine's "
            "default Danjon occulting radius, and `earth_eclipse_fraction` is confirmed to change state at each one. "
            "Compared in TT (published UT plus the figure's ΔT).")  # fmt: skip
    return {
        "eclipse.totality_contacts": outcome(groups["T"], note),
        "eclipse.umbral_contacts": outcome(groups["U"], note),
        "eclipse.penumbral_contacts": outcome(groups["P"], note),
        "eclipse.grazing_contacts": outcome(
            groups["grazing"], "Phases shorter than the limits in the tolerance basis: the limb crosses the shadow edge at a "
            "shallow angle, so a small position difference becomes a large time difference."),
    }  # fmt: skip


SELF_CONSISTENCY_DEG = 0.03


def _own_direction_gap(r: dict, body: str) -> float:
    east, north, up = local_basis(r["lat"], r["lon"])
    p = G.unit_from_lat_lon(r[f"{body}_lat"], r[f"{body}_lon"])
    implied = np.array([p @ east, p @ north, p @ up])
    return float(G.separation_deg(implied, G.unit_from_az_el(r[f"{body}_az"], r[f"{body}_alt"])))


def _apollo_rows() -> list[dict]:
    text = (REFERENCE / "apollo_scotti_altaz.txt").read_text(encoding="utf-8")
    rows: list[dict] = []
    mission = lon = lat = None
    year = month = day = None
    for line in text.splitlines():
        head = re.match(r"^Apollo (\d+)\s+\(\s*([+-][\d.]+),\s*([+-][\d.]+)\)", line)
        if head:
            mission, lon, lat = int(head.group(1)), float(head.group(2)), float(head.group(3))
            continue
        m = re.search(r"(\d\d:\d\d:\d\d)((?:\s+[+-]?\d+\.\d+){8})\s*$", line)
        if not (m and mission):
            continue
        tokens = line[: m.start()].split()
        if tokens and re.fullmatch(r"\d{1,2}", tokens[-1]):
            day = int(tokens.pop())
            if tokens and tokens[-1].upper() in MONTHS:
                month = MONTHS.index(tokens.pop().upper()) + 1
                if tokens and re.fullmatch(r"(19|20)\d\d", tokens[-1]):
                    year = int(tokens.pop())
        v = [float(x) for x in m.group(2).split()]
        rows.append({
            "mission": mission, "event": " ".join(tokens), "lat": lat, "lon": lon,
            "utc": f"{year:04d}-{month:02d}-{day:02d}T{m.group(1)}Z",
            "e_lon": v[0], "e_lat": v[1], "e_alt": v[2], "e_az": v[3], "s_lon": v[4], "s_lat": v[5], "s_alt": v[6], "s_az": v[7],
        })  # fmt: skip
    return rows


@check("apollo.sun_direction", "apollo.subpoints", "apollo.earth_direction")
def apollo(ctx) -> dict[str, Outcome]:
    ctx.furnish()
    rows = _apollo_rows()
    if len(rows) != 43:
        raise RuntimeError(f"expected 43 rows in the Apollo table, parsed {len(rows)}")
    sun_rows, sub_rows, earth_rows, dropped = [], [], [], []
    for r in rows:
        et = np.array([utc_to_et(r["utc"])])
        site = Site(r["lat"], r["lon"], 0.0)
        label = f"Apollo {r['mission']} {r['event']}"
        own = max(
            _own_direction_gap(r, "s"), _own_direction_gap(r, "e")
        )
        if own > SELF_CONSISTENCY_DEG:
            dropped.append(f"{label} ({own:.2f}°)")
            continue
        sun = sun_track(site, 0.0, et)
        earth = earth_track(site, 0.0, et)
        d_sun = float(G.separation_deg(G.unit_from_az_el(sun.az_deg, sun.el_deg), G.unit_from_az_el(r["s_az"], r["s_alt"]))[0])
        d_earth = float(G.separation_deg(G.unit_from_az_el(earth.az_deg, earth.el_deg), G.unit_from_az_el(r["e_az"], r["e_alt"]))[0])
        s_lat, s_lon = subsolar_point(et)
        e_lat, e_lon = subearth_point(et, earth_view=True)
        d_ss = float(G.separation_deg(G.unit_from_lat_lon(s_lat, s_lon), G.unit_from_lat_lon(r["s_lat"], r["s_lon"]))[0])
        d_se = float(G.separation_deg(G.unit_from_lat_lon(e_lat, e_lon), G.unit_from_lat_lon(r["e_lat"], r["e_lon"]))[0])
        sun_rows.append((label, r["utc"], r["s_alt"], round(float(sun.el_deg[0]), 3), r["s_az"], round(float(sun.az_deg[0]), 3), round(d_sun, 4)))
        sub_rows.append((label, r["utc"], round(d_ss, 4), round(d_se, 4)))
        earth_rows.append((label, r["utc"], r["e_alt"], round(float(earth.el_deg[0]), 3), round(d_earth, 4)))
    skipped = (
        f" {len(dropped)} of {len(rows)} rows are left out because the table contradicts itself there: its printed altitude "
        f"and azimuth differ by more than {SELF_CONSISTENCY_DEG}° from the direction of its own sub-point ({'; '.join(dropped)})."
        if dropped else ""
    )
    geocentric = max(
        abs(90.0 - float(G.separation_deg(G.unit_from_lat_lon(r["lat"], r["lon"]), G.unit_from_lat_lon(r["e_lat"], r["e_lon"]))) - r["e_alt"])
        for r in rows
    )  # fmt: skip
    return {
        "apollo.sun_direction": Outcome(
            max(r[-1] for r in sun_rows), "Engine `sun_track` at the table's own site coordinates, ground height 0, against the "
            "table's Sun altitude and azimuth (angle between the two directions)." + skipped,
            ("Event", "UTC", "Table alt (°)", "Engine alt (°)", "Table az (°)", "Engine az (°)", "Separation (°)"), sun_rows, len(sun_rows)),
        "apollo.subpoints": Outcome(
            max(max(r[2], r[3]) for r in sub_rows), "Engine `subsolar_point` and `subearth_point(earth_view=True)` against the "
            "table's sub-solar and sub-Earth points (great-circle distance)." + skipped,
            ("Event", "UTC", "Sub-solar difference (°)", "Sub-Earth difference (°)"), sub_rows, 2 * len(sub_rows)),
        "apollo.earth_direction": Outcome(
            max(r[-1] for r in earth_rows), "The table's Earth altitude equals 90° minus the distance from the site to its own "
            f"sub-Earth point to within {geocentric:.3f}°, so it has no parallax; the engine's `earth_track` is topocentric. The "
            "difference below is therefore mostly lunar parallax (up to 0.26°) and carries no tolerance.",
            ("Event", "UTC", "Table alt (°)", "Engine alt (°)", "Separation (°)"), earth_rows, len(earth_rows)),
    }  # fmt: skip


def _horizons_files(ctx) -> list[dict]:
    folder = ctx.data / "validation" / "horizons"
    files = sorted(folder.glob("*.json"))
    if not files:
        raise NotRun("no cached JPL Horizons responses under validation/horizons")
    out = []
    for f in files:
        o = json.loads(f.read_text(encoding="utf-8"))
        p = o["params"]
        if p.get("CENTER") != "'coord@301'" or p.get("QUANTITIES") != "'4,13,20'":
            continue
        lon, lat, alt = (float(x) for x in p["SITE_COORD"].strip("'").split(","))
        body = o["result"]
        table = body[body.index("$$SOE") + 5 : body.index("$$EOE")]
        jd, az, el = [], [], []
        for line in table.strip().splitlines():
            cells = [c.strip() for c in line.split(",")]
            jd.append(cells[0])
            az.append(float(cells[3]))
            el.append(float(cells[4]))
        out.append({"target": p["COMMAND"].strip("'"), "lat": lat, "lon": lon, "alt": alt, "jd": jd, "az": np.array(az), "el": np.array(el)})
    return out


@check("horizons.sun_direction", "horizons.earth_direction")
def horizons(ctx) -> dict[str, Outcome]:
    ctx.furnish()
    worst = {"10": 0.0, "399": 0.0}
    count = {"10": 0, "399": 0}
    rows = []
    for q in _horizons_files(ctx):
        et = np.array([float(spice.str2et(f"JD {jd} UTC")) for jd in q["jd"]])
        site = Site(q["lat"], q["lon"], 0.0)
        track = (sun_track if q["target"] == "10" else earth_track)(site, q["alt"] * 1000.0, et)
        sep = G.separation_deg(G.unit_from_az_el(track.az_deg, track.el_deg), G.unit_from_az_el(q["az"], q["el"]))
        worst[q["target"]] = max(worst[q["target"]], float(sep.max()))
        count[q["target"]] += sep.size
        rows.append(("Sun" if q["target"] == "10" else "Earth", q["lat"], q["lon"], sep.size, float(sep.mean()), float(sep.max())))
    cols = ("Target", "Lat (°)", "Lon (°)", "Epochs", "Mean (°)", "Max (°)")
    note = ("Cached JPL Horizons observer tables (apparent, airless, `coord@301` on the 1737.4 km sphere). Horizons uses "
            "DE441 and the same lunar frame, so this checks the implementation, not the ephemeris.")  # fmt: skip
    return {
        "horizons.sun_direction": Outcome(worst["10"], note, cols, [r for r in rows if r[0] == "Sun"], count["10"]),
        "horizons.earth_direction": Outcome(worst["399"], note, cols, [r for r in rows if r[0] == "Earth"], count["399"]),
    }


@check("spice.direction")
def spice_direct(ctx) -> dict[str, Outcome]:
    ctx.furnish()
    rng = ctx.rng(20261114)
    sites = [(-89.45, 222.7), (-84.7906, 29.1957), (40.0, -20.0), (0.0, 30.0), (-20.0, 190.0), (89.5, 45.0), (90.0, 0.0), (-90.0, 0.0)]
    t0 = utc_to_et("2024-06-01T00:00:00Z")
    et = np.sort(t0 + rng.uniform(0.0, 11.0 * 365.25 * 86400.0, 200))
    worst = 0.0
    rows = []
    for lat, lon in sites:
        east, north, up = local_basis(lat, lon)
        pos = up * (R_MOON_M / 1000.0)
        site = Site(lat, lon, 0.0)
        for body, fn in (("SUN", sun_track), ("EARTH", earth_track)):
            track = fn(site, 0.0, et)
            ref = np.empty((et.size, 3))
            for i, t in enumerate(et):
                state, _ = spice.spkcpo(body, float(t), "MOON_ME", "OBSERVER", "CN+S", pos, "MOON", "MOON_ME")
                d = np.asarray(state[:3])
                ref[i] = d / np.linalg.norm(d)
            enu = np.stack([ref @ east, ref @ north, ref @ up], axis=-1)
            sep = G.separation_deg(G.unit_from_az_el(track.az_deg, track.el_deg), enu)
            worst = max(worst, float(sep.max()))
            rows.append((body.title(), lat, lon, float(sep.mean()), float(sep.max())))
    return {"spice.direction": Outcome(
        worst, "SPICE `spkcpo` with `CN+S` from a body-fixed observer, 200 random epochs 2024–2035 at 8 sites. Shares the "
        "kernels with the engine but none of its code.", ("Target", "Lat (°)", "Lon (°)", "Mean (°)", "Max (°)"), rows, 2 * len(sites) * et.size)}  # fmt: skip
