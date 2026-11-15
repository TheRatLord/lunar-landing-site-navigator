from __future__ import annotations

import math

import numpy as np
import spiceypy as spice
import yaml

from lunarnav.constants import R_MOON_M
from lunarnav.oracle.model import REFERENCE, Outcome, check


@check("terrain.retroreflector_heights")
def retroreflector_heights(ctx) -> dict[str, Outcome]:
    ctx.furnish()
    doc = yaml.safe_load((REFERENCE / "llr.yaml").read_text(encoding="utf-8"))
    stack = ctx.default_stack
    to_me = spice.pxform("MOON_PA", "MOON_ME", 0.0)
    rows, worst = [], 0.0
    for item in doc["reflectors_de440_pa_m"].values():
        me = to_me @ np.array(item["xyz"])
        radius = float(np.linalg.norm(me))
        lat, lon = math.degrees(math.asin(me[2] / radius)), math.degrees(math.atan2(me[1], me[0]))
        height, store = stack.height_and_store(lat, lon)
        sigma = float(stack.error_at(lat, lon)[0][0])
        diff = float(height[0]) - (radius - R_MOON_M)
        worst = max(worst, abs(diff) / sigma)
        rows.append((item["name"], round(lat, 4), round(lon, 4), round(radius - R_MOON_M, 1), round(float(height[0]), 1), round(diff, 1),
                     stack.stores[int(store[0])].dem_id, sigma, round(abs(diff) / sigma, 2)))  # fmt: skip
    cols = ("Reflector", "Lat (°)", "Lon (°)", "Laser-ranging height (m)", "Engine terrain (m)", "Difference (m)", "Store",
            "Stated 1σ of that store (m)", "Difference in stated σ")  # fmt: skip
    return {"terrain.retroreflector_heights": Outcome(
        worst, "Heights are above the 1737.4 km sphere. The laser-ranging radii are good to decimetres; the arrays sit on the ground "
        "(Apollo) or about a metre above it (Lunokhod), which is inside every store's stated error.", cols, rows, len(rows))}  # fmt: skip
