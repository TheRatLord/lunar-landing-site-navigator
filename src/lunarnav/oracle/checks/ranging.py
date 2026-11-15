from __future__ import annotations

import math

import numpy as np
import spiceypy as spice
import yaml

from lunarnav.constants import R_MOON_M
from lunarnav.ephem import BodyFixedEphemeris, station_track, utc_to_et
from lunarnav.oracle.model import REFERENCE, Outcome, check
from lunarnav.types import GroundStation, Site

C_KM_S = 299792.458
GM_SUN = 132712440041.279419
GM_EARTH = 398600.435507
WGS84_A_KM = 6378.137
WGS84_F = 1.0 / 298.257223563
SLRF_EPOCH = "2010-01-01T00:00:00Z"
YEAR_S = 365.25 * 86400.0


def _doc() -> dict:
    return yaml.safe_load((REFERENCE / "llr.yaml").read_text(encoding="utf-8"))


def _slrf(path, code: str, solution: str) -> tuple[np.ndarray, np.ndarray]:
    found = {}
    for line in path.read_text(encoding="latin-1").splitlines():
        part = line.split()
        if len(part) >= 9 and part[1] in ("STAX", "STAY", "STAZ", "VELX", "VELY", "VELZ") and part[2] == code and part[4] == solution:
            if part[5] != "10:001:00000":
                raise RuntimeError(f"{path.name}: station {code} is not given at epoch 2010.0")
            found[part[1]] = float(part[8])
    pos = np.array([found["STAX"], found["STAY"], found["STAZ"]]) / 1000.0
    vel = np.array([found["VELX"], found["VELY"], found["VELZ"]]) / 1000.0
    return pos, vel


def _num(text: str, scale: float) -> float:
    text = text.strip()
    return float(text) * scale if text else float("nan")


def _records(path, mini_code: str) -> list[dict]:
    out = []
    for line in path.read_text(encoding="latin-1").splitlines():
        if len(line) < 73 or line[0] != "5" or int(line[38:43]) != int(mini_code):
            continue
        d, t = line[2:10], line[10:23]
        utc = f"{d[:4]}-{d[4:6]}-{d[6:8]}T{t[:2]}:{t[2:4]}:{t[4:6]}.{t[6:]}Z"

        out.append({
            "utc": utc, "year": int(d[:4]), "tau": int(line[23:37]) * 1e-13, "reflector": line[37],
            "pressure": _num(line[56:62], 0.01), "temp_c": _num(line[62:66], 0.1), "humidity": _num(line[66:68], 1.0),
            "wavelength_um": _num(line[68:73], 1e-4),
        })  # fmt: skip
    return out


def _air_delay_m(el_deg, pressure, temp_c, humidity, wavelength_um, lat_deg: float, height_km: float):
    t = temp_c + 273.15
    e = humidity / 100.0 * 6.11 * 10.0 ** (7.5 * temp_c / (237.3 + temp_c))
    k = 1.163 - 0.00968 * math.cos(2.0 * math.radians(lat_deg)) - 0.00104 * t + 0.00001435 * pressure
    a = 0.002357 * pressure + 0.000141 * e
    b = 1.084e-8 * pressure * t * k + 4.734e-8 * pressure**2 / t * 2.0 / (3.0 - 1.0 / k)
    f_colour = 0.9650 + 0.0164 / wavelength_um**2 + 0.000228 / wavelength_um**4
    f_site = 1.0 - 0.0026 * math.cos(2.0 * math.radians(lat_deg)) - 0.00031 * height_km
    s = np.sin(np.radians(el_deg))
    return f_colour / f_site * (a + b) / (s + b / (a + b) / (s + 0.01))


def _shapiro_s(a: np.ndarray, b: np.ndarray, centre: np.ndarray, gm: float) -> float:
    r1, r2, rho = np.linalg.norm(a - centre), np.linalg.norm(b - centre), np.linalg.norm(a - b)
    return 2.0 * gm / C_KM_S**3 * math.log((r1 + r2 + rho) / (r1 + r2 - rho))


def _station(key: str, ctx) -> dict[str, Outcome]:
    ctx.furnish()
    doc = _doc()
    spec = doc["stations"][key]
    data = ctx.pinned(spec["file"])
    pos0, vel = _slrf(ctx.pinned("slrf2014"), spec["slrf_code"], spec["solution"])
    et0 = utc_to_et(SLRF_EPOCH)
    recs = _records(data, spec["mini_code"])
    if ctx.quick:
        recs = recs[:: max(1, len(recs) // 300)]
    for r in recs:
        r["et"] = utc_to_et(r["utc"])
    lo, hi = ctx.furnish().valid_et
    recs = [r for r in recs if lo + 10.0 < r["et"] < hi - 10.0]
    to_me = spice.pxform("MOON_PA", "MOON_ME", 0.0)
    reflectors = {}
    for code, item in doc["reflectors_de440_pa_m"].items():
        pa_km = np.array(item["xyz"]) / 1000.0
        me = to_me @ pa_km
        radius = float(np.linalg.norm(me))
        lat, lon = math.degrees(math.asin(me[2] / radius)), math.degrees(math.atan2(me[1], me[0]))
        reflectors[code] = {"name": item["name"], "pa": pa_km, "site": Site(lat, lon, 0.0), "ground": radius * 1000.0 - R_MOON_M}

    groups: dict[tuple[int, str], list[dict]] = {}
    for r in recs:
        if r["reflector"] in reflectors:
            groups.setdefault((r["year"], r["reflector"]), []).append(r)

    rows_out = []
    for (year, code), group in sorted(groups.items()):
        mid = utc_to_et(f"{year}-07-01T00:00:00Z")
        xyz = pos0 + vel * (mid - et0) / YEAR_S
        lon, lat, alt = spice.recgeo(xyz, WGS84_A_KM, WGS84_F)
        station = GroundStation(spec["name"], math.degrees(lat), math.degrees(lon), alt * 1000.0, 0.0)
        refl = reflectors[code]
        fire = np.array([r["et"] for r in group])
        tau = np.array([r["tau"] for r in group])
        bounce = fire + tau / 2.0
        for _ in range(2):
            track = station_track(refl["site"], refl["ground"], BodyFixedEphemeris.build(bounce, (station,)), station)
            bounce = fire + track.range_km / C_KM_S
        track = station_track(refl["site"], refl["ground"], BodyFixedEphemeris.build(bounce, (station,)), station)
        for i, r in enumerate(group):
            t_f, t_b = float(fire[i]), float(bounce[i])
            x_itrf = pos0 + vel * (t_f - et0) / YEAR_S

            def ground(t: float, x=x_itrf) -> np.ndarray:
                return np.asarray(spice.spkpos("EARTH", t, "J2000", "NONE", "SSB")[0]) + spice.pxform("ITRF93", "J2000", t) @ x

            moon = np.asarray(spice.spkpos("MOON", t_b, "J2000", "NONE", "SSB")[0])
            mirror = moon + spice.pxform("MOON_PA", "J2000", t_b) @ refl["pa"]
            p_fire = ground(t_f)
            up = float(np.linalg.norm(mirror - p_fire))
            t_rx = t_b + up / C_KM_S
            for _ in range(3):
                p_rx = ground(t_rx)
                down = float(np.linalg.norm(p_rx - mirror))
                t_rx = t_b + down / C_KM_S
            sun = np.asarray(spice.spkpos("SUN", t_b, "J2000", "NONE", "SSB")[0])
            earth = np.asarray(spice.spkpos("EARTH", t_b, "J2000", "NONE", "SSB")[0])
            delay = sum(_shapiro_s(p, mirror, c, gm) for p in (p_fire, p_rx) for c, gm in ((sun, GM_SUN), (earth, GM_EARTH)))
            el = float(track.station_el_deg[i])
            p_hpa = r["pressure"] if 500.0 < r["pressure"] < 1100.0 else 1013.25 * math.exp(-alt / 8.434)
            temp = r["temp_c"] if -40.0 < r["temp_c"] < 50.0 else 10.0
            hum = r["humidity"] if 0.0 <= r["humidity"] <= 100.0 else 50.0
            wave = r["wavelength_um"] if 0.3 < r["wavelength_um"] < 1.2 else 0.532
            air = float(_air_delay_m(max(el, 5.0), p_hpa, temp, hum, wave, math.degrees(lat), alt)) / 1000.0
            measured = r["tau"] * C_KM_S / 2.0
            rest = (down - up) / 2.0 + delay * C_KM_S / 2.0 + air
            rows_out.append((code, el, (measured - float(track.range_km[i]) - rest) * 1000.0, (measured - up - rest) * 1000.0, air * 1000.0))

    arr = np.array([(r[1], r[2], r[3], r[4]) for r in rows_out])
    codes = np.array([r[0] for r in rows_out])
    high = arr[:, 0] >= float(doc["min_elevation_deg"])
    res, direct = arr[high, 1], arr[high, 2]
    table = []
    for code, refl in reflectors.items():
        sel = high & (codes == code)
        if sel.any():
            v = arr[sel, 1]
            table.append((refl["name"], int(sel.sum()), round(float(np.median(v)), 2), round(float(np.percentile(np.abs(v), 95)), 2),
                          round(float(np.abs(v).max()), 2)))  # fmt: skip
    table.append(("All", int(high.sum()), round(float(np.median(res)), 2), round(float(np.percentile(np.abs(res), 95)), 2),
                  round(float(np.abs(res).max()), 2)))  # fmt: skip
    years = sorted({r["year"] for r in recs})
    note = (f"{int(high.sum())} normal points from {spec['name']}, {years[0]}–{years[-1]} ({int((~high).sum())} below "
            f"{doc['min_elevation_deg']}° left out). Each is a measured round-trip time of a laser pulse. The engine supplies the "
            "outward leg: the distance from the station, at its SLRF2014 position for that year, to the reflector at its DE440 "
            "coordinates, at the moment the pulse arrives. The check adds what the engine does not compute: the difference "
            f"between the return and outward legs (from the kernels directly), the light-time delay in the gravity of the Sun and "
            f"the Earth, and the delay in air (Marini–Murray, mean {arr[high, 3].mean():.2f} m). Median residual "
            f"{np.median(res):+.2f} m, root mean square {np.sqrt((res**2).mean()):.2f} m. With the outward leg taken from the "
            f"kernels directly instead of the engine the 95th percentile is {np.percentile(np.abs(direct), 95):.2f} m.")  # fmt: skip
    cols = ("Reflector", "Normal points", "Median residual (m)", "95th percentile |residual| (m)", "Largest (m)")
    return {f"llr.{key}": Outcome(float(np.percentile(np.abs(res), 95)), note, cols, table, int(high.sum()))}


@check("llr.grasse")
def grasse(ctx) -> dict[str, Outcome]:
    return _station("grasse", ctx)


@check("llr.matera")
def matera(ctx) -> dict[str, Outcome]:
    return _station("matera", ctx)
