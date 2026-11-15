from __future__ import annotations

import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

import numpy as np
import spiceypy as spice

from lunarnav.ephem import BodyFixedEphemeris, utc_to_et
from lunarnav.oracle import geometry as G
from lunarnav.oracle.model import Outcome, check


def _unit(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


@check("inpop.sun_earth_directions", "inpop.ranges", "inpop.lunar_orientation")
def inpop(ctx) -> dict[str, Outcome]:
    ctx.furnish()
    archive = ctx.pinned("inpop21a_spice")
    rng = ctx.rng(2021)
    t0, t1 = utc_to_et("2024-01-01T00:00:00Z"), utc_to_et("2036-01-01T00:00:00Z")
    et = np.sort(rng.uniform(t0, t1, 500))
    with tempfile.TemporaryDirectory() as tmp:
        with tarfile.open(archive) as tar:
            tar.extractall(tmp, filter="data")
        np.save(Path(tmp) / "et.npy", et)
        subprocess.run(
            [sys.executable, "-m", "lunarnav.oracle.inpop_worker", tmp, str(Path(tmp) / "et.npy"), str(Path(tmp) / "out.npz")],
            check=True, capture_output=True, text=True,
        )  # fmt: skip
        other = dict(np.load(Path(tmp) / "out.npz"))
    tab = BodyFixedEphemeris.build(et, interpolate=False)
    to_me = np.array([spice.pxform("J2000", "MOON_ME", float(t)) for t in et])
    to_pa = np.array([spice.pxform("J2000", "MOON_PA", float(t)) for t in et])
    sun_o = np.einsum("nij,nj->ni", to_me, other["sun"])
    earth_o = np.einsum("nij,nj->ni", to_me, other["earth"])
    d_sun = G.separation_deg(_unit(tab.sun_me), _unit(sun_o))
    d_earth = G.separation_deg(_unit(tab.earth_me), _unit(earth_o))
    sep_e = G.separation_deg(_unit(tab.sun_me), _unit(tab.earth_me))
    sep_o = G.separation_deg(_unit(other["sun"]), _unit(other["earth"]))
    r_earth = np.linalg.norm(tab.earth_me, axis=1) - np.linalg.norm(other["earth"], axis=1)
    r_sun = np.linalg.norm(tab.sun_me, axis=1) - np.linalg.norm(other["sun"], axis=1)
    rel = np.einsum("nij,nkj->nik", to_pa, other["rot"])
    angle = np.degrees(np.arccos(np.clip((np.trace(rel, axis1=1, axis2=2) - 1.0) / 2.0, -1.0, 1.0)))
    rows = [
        ("Earth direction from the Moon centre (°)", float(d_earth.mean()), float(d_earth.max())),
        ("Sun direction from the Moon centre (°)", float(d_sun.mean()), float(d_sun.max())),
        ("Sun–Earth separation seen from the Moon (°)", float(np.abs(sep_e - sep_o).mean()), float(np.abs(sep_e - sep_o).max())),
        ("Moon–Earth distance (m)", float(np.abs(r_earth).mean() * 1000.0), float(np.abs(r_earth).max() * 1000.0)),
        ("Moon–Sun distance (m)", float(np.abs(r_sun).mean() * 1000.0), float(np.abs(r_sun).max() * 1000.0)),
        ("Principal-axis frame, INPOP21a against DE440 (°)", float(angle.mean()), float(angle.max())),
    ]
    cols = ("Quantity", "Mean |difference|", "Largest")
    note = ("INPOP21a is fitted by another group with other software, largely to the same ranging and tracking data. Its Sun and "
            "Earth positions (light-time corrected, read in a separate process so its kernels never mix with the engine's) are "
            "turned into the engine's frame with the DE440 orientation, at 500 random epochs 2024–2035.")  # fmt: skip
    return {
        "inpop.sun_earth_directions": Outcome(float(max(d_sun.max(), d_earth.max())), note, cols, rows, 2 * et.size),
        "inpop.ranges": Outcome(float(np.abs(r_earth).max() * 1000.0), "Largest difference of the Moon–Earth distance.", n=int(et.size)),
        "inpop.lunar_orientation": Outcome(
            float(angle.max()), "Angle between the lunar principal-axis frames of the two ephemerides. Each ephemeris defines its own "
            "principal axes from its own gravity field, so a constant offset of a fraction of an arc-second is a difference of "
            "definition, not an error; the engine works in the mean-Earth frame.", n=int(et.size)),
    }  # fmt: skip
