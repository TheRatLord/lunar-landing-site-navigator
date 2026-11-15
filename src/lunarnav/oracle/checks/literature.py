from __future__ import annotations

import numpy as np
import yaml

from lunarnav.oracle import illum
from lunarnav.oracle.model import REFERENCE, Outcome, check


def _doc() -> dict:
    return yaml.safe_load((REFERENCE / "literature.yaml").read_text(encoding="utf-8"))


def _lon(lon: float) -> float:
    return (lon + 180.0) % 360.0 - 180.0


def _posts(stack, dem_id: str, lat: float, lon: float, radius_m: float) -> tuple[np.ndarray, np.ndarray]:
    g = stack.store(dem_id).geometry
    r0, c0 = (float(v) for v in g.lonlat_to_rc(lat, lon))
    k = int(np.ceil(radius_m / abs(g.dx))) + 1
    rr, cc = np.meshgrid(np.arange(round(r0) - k, round(r0) + k + 1), np.arange(round(c0) - k, round(c0) + k + 1), indexing="ij")
    keep = np.hypot(rr - r0, cc - c0) * abs(g.dx) <= radius_m
    if radius_m <= 0:
        keep = (rr == round(r0)) & (cc == round(c0))
    la, lo = g.rc_to_lonlat(rr[keep].astype(float), cc[keep].astype(float))
    return np.asarray(la, float), np.asarray(lo, float)


def _maximum(stack, dem_id: str, row: dict, period: list[str], radius_m: float, keep: int = 8) -> dict:
    lat, lon = _posts(stack, dem_id, row["lat"], _lon(row["lon"]), radius_m)
    if lat.size > keep:
        coarse = illum.series(stack, lat, lon, row["mast_m"], illum.table(period[0], period[1], 43200.0), earth=False)
        top = np.argsort(np.nan_to_num(coarse.average_illumination, nan=-1.0))[-keep:]
        lat, lon = lat[top], lon[top]
    fine = illum.series(stack, lat, lon, row["mast_m"], illum.table(period[0], period[1], 3600.0), earth=False)
    k = int(np.nanargmax(fine.average_illumination))
    return {"avg": float(fine.average_illumination[k]) * 100.0, "sunlit": float(fine.sunlit_fraction[k]) * 100.0,
            "dark_h": float(fine.longest_dark_h[k]), "posts": int(_posts(stack, dem_id, row["lat"], _lon(row["lon"]), radius_m)[0].size)}  # fmt: skip


@check("glaeser2014.average_illumination", "glaeser2014.longest_dark_10m", "glaeser2014.longest_dark_2m", "glaeser2014.earth_cycle")
def glaeser2014(ctx) -> dict[str, Outcome]:
    ctx.furnish()
    g = _doc()["glaeser2014"]
    stack = ctx.stack(g["stores"])
    tab = illum.table(g["period"][0], g["period"][1], 3600.0)
    rows, dark, best_rows = [], {}, []
    cycle = None
    for sp in g["spots"]:
        lat, lon = _posts(stack, g["stores"][0], sp["lat"], _lon(sp["lon"]), 0.0)
        s = illum.series(stack, lat, lon, sp["mast_m"], tab)
        avg, dark_d = float(s.average_illumination[0]) * 100.0, float(s.longest_dark_h[0]) / 24.0
        rows.append((sp["name"], sp["mast_m"], sp["avg_illum"], round(avg, 2), round(avg - sp["avg_illum"], 2), sp["longest_dark_d"],
                     round(dark_d, 2), round((dark_d - sp["longest_dark_d"]) * 24.0, 1)))  # fmt: skip
        if sp["mast_m"] == 2:
            best = _maximum(stack, g["stores"][0], sp, g["period"], float(g["best_post_radius_m"]))
            best_rows.append((sp["name"], sp["longest_dark_d"], round(best["dark_h"] / 24.0, 2), round(best["avg"], 2), best["posts"]))
            dark.setdefault(2, []).append(abs(best["dark_h"] / 24.0 - sp["longest_dark_d"]) * 24.0)
        else:
            dark.setdefault(sp["mast_m"], []).append(abs(dark_d - sp["longest_dark_d"]) * 24.0)
        if sp["name"] == g["earth_cycle"]["spot"]:
            cycle = (float(s.earth_window_mean_d[0]), float(s.earth_outage_mean_d[0]), float(s.earth_fraction[0]) * 100.0)
    cols = ("Spot", "Observer (m)", "Paper avg (%)", "Engine avg (%)", "Difference (points)", "Paper longest dark (d)",
            "Engine longest dark (d)", "Difference (h)")  # fmt: skip
    note = (f"Engine at the 20 m post nearest each printed point, terrain {' + '.join(f'`{i}`' for i in g['stores'])}, hourly "
            f"{g['period'][0][:10]} to {g['period'][1][:10]}. Average illumination is the time-mean visible fraction of the Sun's disc.")  # fmt: skip
    ec = g["earth_cycle"]
    return {
        "glaeser2014.average_illumination": Outcome(max(abs(r[4]) for r in rows), note, cols, rows, len(rows)),
        "glaeser2014.longest_dark_10m": Outcome(max(dark[10]), "Longest unbroken darkness at the two 10 m spots; table under `glaeser2014.average_illumination`.", n=2),
        "glaeser2014.longest_dark_2m": Outcome(
            max(dark[2]), f"The two 2 m spots are the best-lit points of the paper's own 20 m DEM. The engine value is taken at its "
            f"best-lit 20 m post within {g['best_post_radius_m']} m of each (the rule of the Gläser 2018 case), not at the post nearest the "
            "printed point, where it gives 10.7 and 11.3 days.",
            ("Spot", "Paper longest dark (d)", "Engine longest dark at its best post (d)", "Engine average there (%)", "Posts searched"),
            best_rows, 2),
        "glaeser2014.earth_cycle": Outcome(
            max(abs(cycle[0] - ec["window_d"]), abs(cycle[1] - ec["silence_d"])),
            f"Engine at spot 4 (10 m): the Earth is in view for {cycle[0]:.2f} d on average, then out of view for {cycle[1]:.2f} d "
            f"({cycle[2]:.1f} % of the time in view), against {ec['window_d']} d and {ec['silence_d']} d. " + ec["note"], n=2),
    }  # fmt: skip


@check("glaeser2018.maximum_illumination")
def glaeser2018(ctx) -> dict[str, Outcome]:
    ctx.furnish()
    g = _doc()["glaeser2018"]
    stack = ctx.stack(g["stores"])
    radius = 100.0 if ctx.quick else float(g["radius_m"])
    rows = []
    for row in g["rows"]:
        m = _maximum(stack, g["stores"][0], row, g["period"], radius)
        rows.append((row["name"], row["max_avg_illum"], round(m["avg"], 2), round(m["avg"] - row["max_avg_illum"], 2), m["posts"]))
    return {"glaeser2018.maximum_illumination": Outcome(
        max(abs(r[3]) for r in rows), f"The paper gives the highest average illumination its 20 m DEM reaches at each site. The engine "
        f"value is the highest over every 20 m post within {radius:g} m of the printed point (a maximum against a maximum), terrain "
        f"{' + '.join(f'`{i}`' for i in g['stores'])}, hourly {g['period'][0][:10]} to {g['period'][1][:10]}.",
        ("Site", "Paper maximum (%)", "Engine maximum (%)", "Difference (points)", "Posts searched"), rows, len(rows))}  # fmt: skip


@check("mazarico2011.connecting_ridge_surface", "mazarico2011.shackleton_rim_surface", "mazarico2011.connecting_ridge_10m")
def mazarico2011(ctx) -> dict[str, Outcome]:
    ctx.furnish()
    g = _doc()["mazarico2011"]
    stack = ctx.stack(g["stores"])
    out = {}
    for row in g["rows"]:
        m = _maximum(stack, g["stores"][0], row, g["period"], float(row["radius_m"]))
        also = (f" For information, the share of time with any part of the Sun up: paper {row['sunlit']} % at its site, "
                f"engine {m['sunlit']:.2f} % at that post.") if "sunlit" in row else ""  # fmt: skip
        out[f"mazarico2011.{row['id']}"] = Outcome(
            abs(m["avg"] - row["max_avg_illum"]), f"{row['name']}: paper {row['max_avg_illum']} %, engine {m['avg']:.2f} % at its best post of "
            f"`{g['stores'][0]}` within {row['radius_m']} m of the printed point ({m['posts']} posts; the paper prints the point to 0.01°). "
            "Both are the time-mean visible fraction of the Sun's disc. The paper's value is the best pixel of its own 240 m DEM, built "
            "from the first months of LOLA data; the engine's store is the later GDR release." + also, n=m["posts"])  # fmt: skip
    return out


@check("bryant2009.earth_on_massifs", "bryant2009.earth_on_rim_peaks", "bryant2009.earth_height_insensitive", "bryant2009.point_values")
def bryant2009(ctx) -> dict[str, Outcome]:
    ctx.furnish()
    g = _doc()["bryant2009"]
    stack = ctx.stack(g["stores"])
    tab = illum.table(g["period"][0], g["period"][1], float(g["step_s"]))

    def peak(site: dict, radius_m: float) -> tuple[float, float]:
        lat, lon = _posts(stack, g["stores"][0], site["lat"], _lon(site["lon"]), radius_m)
        h = stack.height(lat, lon)
        k = int(np.nanargmax(h))
        return float(lat[k]), float(lon[k])

    rows, earth_peaks, earth_massifs, point_gap = [], [], [], []
    for group, radius in (("rim_peaks", 300.0), ("massifs", 1000.0)):
        for site in g[group]:
            la, lo = peak(site, radius)
            s = illum.series(stack, [la], [lo], g["mast_m"], tab)
            sun, earth = float(s.sunlit_fraction[0]) * 100.0, float(s.earth_fraction[0]) * 100.0
            rows.append((site["name"], site["sun_any"], round(sun, 2), site["earth_any"], round(earth, 2)))
            (earth_peaks if group == "rim_peaks" else earth_massifs).append(earth)
            point_gap += [abs(sun - site["sun_any"]), abs(earth - site["earth_any"])]
    summit = []
    for site in g["massifs"]:
        la, lo = peak(site, 6000.0)
        far = float(illum.series(stack, [la], [lo], g["mast_m"], tab).earth_fraction[0]) * 100.0
        summit.append(f"{site['name']} {far:.1f} % at {la:.3f}°, {lo % 360.0:.3f}°E")
    lo_r, hi_r = g["rim_peaks_earth_range"]
    outside = max(max(lo_r - e, e - hi_r, 0.0) for e in earth_peaks)
    b1 = next(s for s in g["rim_peaks"] if s["name"] == g["height"]["peak"])
    la, lo = peak(b1, 300.0)
    e2 = float(illum.series(stack, [la], [lo], 2.0, tab).earth_fraction[0]) * 100.0
    e32 = float(illum.series(stack, [la], [lo], 32.0, tab).earth_fraction[0]) * 100.0
    cols = ("Site", "Bryant Sun, any part (%)", "Engine Sun (%)", "Bryant Earth, any part (%)", "Engine Earth (%)")
    where = (f"Engine at the highest 20 m post within 300 m of each printed rim point (1 km for the two massifs), {g['mast_m']} m "
             f"observer, terrain {' + '.join(f'`{i}`' for i in g['stores'])}, six-hourly {g['period'][0][:10]} to {g['period'][1][:10]}. "
             "Bryant's terrain is Goldstone radar from before LRO, so his coordinates can be off by more than a pixel.")  # fmt: skip
    return {
        "bryant2009.earth_on_massifs": Outcome(min(earth_massifs), "Bryant: the Earth is always at least partly in view from Malapert α and "
                                               "Leibnitz β. " + where + " At the highest 20 m post within 6 km of each printed massif "
                                               "point instead (rule fixed after the first run, before this number was seen): "
                                               + "; ".join(summit) + ".", n=len(earth_massifs)),
        "bryant2009.earth_on_rim_peaks": Outcome(float(outside), f"Bryant: from the nine rim and ridge peaks the Earth is at least partly in "
                                                 f"view {lo_r:g}–{hi_r:g} % of the time. Engine values {min(earth_peaks):.1f}–{max(earth_peaks):.1f} %. "
                                                 "The value is how far the engine's peaks fall outside that range. " + where, n=len(earth_peaks)),
        "bryant2009.earth_height_insensitive": Outcome(
            abs(e32 - e2), f"Bryant at B1: {g['height']['earth_any_2m']} % at 2 m and {g['height']['earth_any_32m']} % at 32 m. Engine at the "
            f"same peak: {e2:.2f} % and {e32:.2f} %.", n=2),
        "bryant2009.point_values": Outcome(float(max(point_gap)), where, cols, rows, len(rows)),
    }  # fmt: skip
