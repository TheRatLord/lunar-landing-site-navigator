from __future__ import annotations

import math
import tempfile
from pathlib import Path

import numpy as np

from lunarnav.constants import R_MOON_M
from lunarnav.ephem import subsolar_point, utc_to_et
from lunarnav.horizon import compute_horizon, horizon_arrays_at
from lunarnav.horizon.reference import ray_reference
from lunarnav.oracle.model import Outcome, check
from lunarnav.terrain import TerrainStack
from lunarnav.terrain.projection import GridGeometry, polar_forward, polar_inverse
from lunarnav.terrain.stack import destination
from lunarnav.terrain.store import SourceInfo, build_store
from lunarnav.types import Site
from lunarnav.visibility.disc import disc_fraction
from lunarnav.visibility.limb_darkening import LimbDarkening

PX = 600.0
N = 512
MAST = 10.0
PLATEAU_M = 800.0
EDGE_Y = 20100.0


def _synthetic(root: Path, dem_id: str, height) -> TerrainStack:
    geom = GridGeometry("polar_stereographic", -1, R_MOON_M, -N / 2 * PX + PX / 2, N / 2 * PX - PX / 2, PX, -PX, N, N)
    y = geom.y0 + np.arange(N) * geom.dy

    def rows(r0: int, r1: int) -> np.ndarray:
        return np.repeat(height(y[r0:r1])[:, None], N, axis=1).astype(np.float32)

    info = SourceInfo("synthetic terrain for the oracle suite", "", "", {}, pixel_size_m=PX)
    build_store(root, dem_id, geom, rows, info)
    return TerrainStack.open([dem_id], root)


def _elevation(dist_m, height_m: float, observer_m: float):
    th = np.asarray(dist_m) / R_MOON_M
    return np.degrees(np.arctan2((R_MOON_M + height_m) * np.cos(th) - (R_MOON_M + observer_m), (R_MOON_M + height_m) * np.sin(th)))


@check("closed_form.sphere_dip", "closed_form.plateau_edge")
def synthetic_terrain(ctx) -> dict[str, Outcome]:
    lat, lon = (float(v) for v in polar_inverse(300.0, 300.0, -1))
    site = Site(lat, lon, MAST)
    with tempfile.TemporaryDirectory() as tmp:
        flat = _synthetic(Path(tmp), "flat", lambda y: np.zeros_like(y))
        prof = compute_horizon(site, flat, n_az=360, use_cache=False)
        dip = -math.degrees(math.acos(R_MOON_M / (R_MOON_M + MAST)))
        gap = np.maximum(np.maximum(prof.elev_lo_deg - dip, dip - prof.elev_hi_deg), 0.0)
        sphere = Outcome(
            float(max(gap.max(), np.abs(prof.elev_deg - dip).max())),
            f"Flat synthetic store ({PX:g} m pixels), observer {MAST:g} m up: the horizon must be −acos(R/(R+h)) = {dip:.4f}° at "
            "every azimuth. The value is the larger of the distance from that to the engine's bracket and to its best estimate.",
            n=360)  # fmt: skip

        plateau = _synthetic(Path(tmp), "plateau", lambda y: np.where(y >= EDGE_Y - 1e-6, PLATEAU_M, 0.0))
        toward = float(np.degrees(np.arctan2(*[b - a for a, b in zip(polar_forward(lat, lon, -1), polar_forward(*destination(lat, lon, 0.0, 100.0), -1), strict=True)])))
        az = (-toward + np.arange(-50.0, 50.1, 2.5)) % 360.0
        dist = np.empty(az.size)
        for i, a in enumerate(az):
            lo_d, hi_d = 1000.0, 60000.0
            for _ in range(60):
                mid = 0.5 * (lo_d + hi_d)
                yy = float(polar_forward(*destination(lat, lon, a, mid), -1)[1])
                lo_d, hi_d = (mid, hi_d) if yy < EDGE_Y else (lo_d, mid)
            dist[i] = hi_d
        out = horizon_arrays_at([lat], [lon], MAST, plateau, az[None, :], 0.0)
        want = _elevation(dist, PLATEAU_M, MAST)
        lo, hi = out["elev_lo_deg"][0], out["elev_hi_deg"][0]
        miss = np.maximum(np.maximum(lo - want, want - hi), 0.0)
        edge = Outcome(
            float(miss.max()),
            f"Synthetic plateau {PLATEAU_M:g} m high whose edge is {dist.min() / 1000:.1f} km away: along {az.size} rays the horizon is "
            "the elevation of the plateau edge, from the spherical closed form. The value is the largest distance from that to "
            "the engine's bracket.", n=int(az.size))  # fmt: skip
    return {"closed_form.sphere_dip": sphere, "closed_form.plateau_edge": edge}


@check("closed_form.disc_fraction")
def disc(ctx) -> dict[str, Outcome]:
    r = 0.2666
    x = np.linspace(-1.2, 1.2, 241)
    grid = np.zeros(720)
    area, _ = disc_fraction(137.3, x * r, r, grid, LimbDarkening(0.0), flux=False)
    xc = np.clip(x, -1.0, 1.0)
    want = 1.0 - (np.arccos(xc) - xc * np.sqrt(1.0 - xc * xc)) / np.pi
    return {"closed_form.disc_fraction": Outcome(
        float(np.abs(area - want).max()),
        "Visible area fraction of a disc of the Sun's size cut by a flat horizon, at 241 heights of the disc centre, against "
        "the circular-segment formula.", n=int(x.size))}  # fmt: skip


@check("closed_form.brute_force_horizon")
def brute_force(ctx) -> dict[str, Outcome]:
    stack = ctx.default_stack
    sites = [("Shackleton rim", -89.45, 222.7), ("Connecting ridge", -89.4395, -137.1934), ("Malapert", -85.99, 2.93),
             ("Blue Ghost", 18.5623, 61.8103), ("SLIM", -13.316, 25.251), ("Chandrayaan-3", -69.3741, 32.32),
             ("North pole", 89.6, 110.0), ("Far side", -45.4561, 177.5885)]  # fmt: skip
    az = np.arange(0.0, 360.0, 15.0)
    rows = []
    worst = -np.inf
    for name, lat, lon in sites:
        out = horizon_arrays_at([lat], [lon], 2.0, stack, az[None, :], 0.0)
        ref, _ = ray_reference(stack, lat, lon, 2.0, az, float(out["max_range_m"][0]))
        over_hi = ref - out["elev_hi_deg"][0]
        over_lo = ref - out["elev_lo_deg"][0] - 0.02
        v = float(np.nanmax(np.maximum(over_hi, over_lo)))
        worst = max(worst, v)
        rows.append((name, lat, lon, float(np.nanmax(over_hi)), float(np.nanmax(ref - out["elev_lo_deg"][0])), float(np.nanmax(np.abs(out["elev_deg"][0] - ref)))))
    return {"closed_form.brute_force_horizon": Outcome(
        worst, "Dense sampling along each exact ray of the same terrain surface, with no pyramid and no pruning "
        "(`horizon/reference.py`). Every sample is a point of the surface, so it can never be above the engine's upper bracket, "
        "and it must reach the lower bracket to within the 0.02° ray tolerance. The value is the largest excess over either; "
        "it must not be positive.",
        ("Site", "Lat (°)", "Lon (°)", "Reference − upper bracket, max (°)", "Reference − lower bracket, max (°)", "|estimate − reference|, max (°)"),
        rows, len(sites) * az.size)}  # fmt: skip


@check("closed_form.synodic_month")
def synodic_month(ctx) -> dict[str, Outcome]:
    ctx.furnish()
    t0, t1 = utc_to_et("2024-01-01T00:00:00Z"), utc_to_et("2043-01-01T00:00:00Z")
    et = np.arange(t0, t1, 1800.0)
    _, lon = subsolar_point(et)
    x = np.sin(np.radians(lon))
    up = np.flatnonzero((x[:-1] > 0) & (x[1:] <= 0) & (np.cos(np.radians(lon[:-1])) > 0))
    t = et[up] + 1800.0 * x[up] / (x[up] - x[up + 1])
    mean = (t[-1] - t[0]) / (t.size - 1) / 86400.0
    return {"closed_form.synodic_month": Outcome(
        abs(mean - 29.530589),
        f"Mean time between successive passages of the sub-solar point over the prime meridian, {t.size - 1} lunations from 2024 "
        f"to 2043: {mean:.5f} d against the mean synodic month of 29.530589 d.", n=int(t.size - 1))}  # fmt: skip
