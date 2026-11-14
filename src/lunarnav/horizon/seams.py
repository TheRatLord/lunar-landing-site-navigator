"""Near-field seams: where the terrain stack switches product close to the observer.

Two stores meeting near an observer put a step in the ground (a PGDA tile edge over the PDS grid: median 0.7 to 2.3 m,
95th percentile 3 to 18 m, ``docs/validation/terrain.md`` 3.9).  A step at distance ``d`` moves the horizon by up to
``atan(step / d)``; this module measures the step at the observer's own crossings and applies the rule documented there.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from lunarnav.terrain import TerrainStack
from lunarnav.terrain.stack import destination

NEAR_FIELD_M = 1000.0
N_AZ = 72
STEP_M = 5.0


@dataclass(frozen=True)
class Seam:
    """Nearest boundary between the observer's ground store and another store that also has ground."""

    distance_m: float
    ground_store: str
    other_store: str
    step_median_m: float
    step_p95_m: float
    n_crossings: int


def near_field_seam(stack: TerrainStack, lat_deg: float, lon_deg: float, near_field_m: float = NEAR_FIELD_M) -> Seam | None:
    """Nearest seam within ``near_field_m``, or None (also None if the observer has no ground).

    The stack's store index is sampled every 5 m on 72 azimuths; a crossing is the first sample on an azimuth whose supplying
    store differs from the observer's and has data.  The statistics are of ``|h_ground_store - h_other_store|`` at all
    crossings (at the last sample before the switch, else at the switch sample: the first one where both stores have data).  The nearest crossing sets ``distance_m``; ``other_store`` is the store met there.
    """
    _, g0 = stack.height_and_store(lat_deg, lon_deg)
    g0 = int(g0[0])
    if g0 < 0:
        return None
    d = np.arange(STEP_M, near_field_m + 1e-9, STEP_M)
    az = np.arange(N_AZ) * (360.0 / N_AZ)
    lat, lon = destination(lat_deg, lon_deg, az[:, None], d[None, :])
    _, si = stack.height_and_store(lat, lon)
    diff = (si != g0) & (si >= 0)
    hit = diff.any(axis=1)
    if not hit.any():
        return None
    first = diff.argmax(axis=1)
    rows = np.flatnonzero(hit)
    other = si[rows, first[rows]]
    h_g = np.full(rows.size, np.nan)
    h_o = np.full(rows.size, np.nan)
    for idx in (np.maximum(first[rows] - 1, 0), first[rows]):
        pla, plo = lat[rows, idx], lon[rows, idx]
        g = stack.stores[g0].height(pla, plo)
        o = np.array([stack.stores[int(k)].height(a, b) for k, a, b in zip(other, pla, plo)]).reshape(-1)
        take = ~(np.isfinite(h_g) & np.isfinite(h_o)) & np.isfinite(g) & np.isfinite(o)
        h_g[take], h_o[take] = g[take], o[take]
    ok = np.isfinite(h_g) & np.isfinite(h_o)
    step = np.abs(h_g[ok] - h_o[ok])
    near = int(np.argmin(first[rows]))
    return Seam(
        distance_m=float(d[first[rows[near]]]),
        ground_store=stack.stores[g0].dem_id,
        other_store=stack.stores[int(other[near])].dem_id,
        step_median_m=float(np.median(step)) if step.size else float("nan"),
        step_p95_m=float(np.percentile(step, 95)) if step.size else float("nan"),
        n_crossings=int(rows.size),
    )


def seam_provenance(stack: TerrainStack, lat_deg: float, lon_deg: float, elev_lo_deg, elev_hi_deg) -> dict:
    """Provenance entry ``"near_field_seam"`` of a profile.

    Rule: a seam with 95th-percentile step ``s`` at distance ``d`` can move the horizon by ``shift = atan(s / d)``; the warning
    is True when ``shift`` exceeds the profile's own bracket ``elev_hi - elev_lo`` in any azimuth.  No seam within the near
    field gives ``{"present": False, "warning": False}``.
    """
    seam = near_field_seam(stack, lat_deg, lon_deg)
    if seam is None:
        return {"present": False, "warning": False, "near_field_m": NEAR_FIELD_M}
    shift = float(np.degrees(np.arctan2(seam.step_p95_m, seam.distance_m))) if np.isfinite(seam.step_p95_m) else float("nan")
    bracket = np.asarray(elev_hi_deg, dtype=np.float64) - np.asarray(elev_lo_deg, dtype=np.float64)
    warning = bool(np.isfinite(shift) and np.any(shift > bracket[np.isfinite(bracket)]))
    return {
        "present": True,
        "warning": warning,
        "near_field_m": NEAR_FIELD_M,
        "distance_m": seam.distance_m,
        "ground_store": seam.ground_store,
        "other_store": seam.other_store,
        "step_median_m": seam.step_median_m,
        "step_p95_m": seam.step_p95_m,
        "n_crossings": seam.n_crossings,
        "horizon_shift_deg": shift,
    }
