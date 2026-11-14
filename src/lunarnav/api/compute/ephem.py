"""Ephemeris computations for the API: tracks, sub-points, time conversion."""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import numpy as np

from lunarnav.api.versions import code_version
from lunarnav.catalog import load_sites, load_stations
from lunarnav.constants import BODY_FIXED_FRAME
from lunarnav.ephem import (
    BodyFixedEphemeris,
    earth_eclipse_fraction,
    earth_track,
    et_to_utc,
    load_kernels,
    station_track,
    subearth_point,
    subsolar_point,
    sun_track,
    utc_to_et,
)
from lunarnav.types import Site

Progress = Callable[[float, str], None]

CONVENTIONS = (
    "Smooth reference sphere R=1737.4 km, no terrain. Planetocentric lat/lon, east-positive, ME frame. "
    "Azimuth clockwise from local north; elevation above the plane perpendicular to the Moon-centre radial. "
    "Apparent directions (light time + stellar aberration), reception epoch at the site. "
    "UTC at the boundary, ET = TDB seconds past J2000."
)


class RequestError(ValueError):
    """The request is well-formed but cannot be served (out of kernel coverage, unknown id, ...)."""


def _noop(_fraction: float, _stage: str) -> None: ...


END_TOLERANCE_S = 0.05
"""Sampling is uniform in ET (TDB); a whole number of UTC days differs from the same number of ET seconds by
up to ~2 ms (TDB-UTC periodic term), so the end instant counts as on the grid within 50 ms."""


def plan_epochs(
    start_utc: str, end_utc: str, step_s: float, max_points: int | None
) -> tuple[float, float, int, int]:
    """Sampling plan without allocating: ``(et_start, effective_step_s, n_samples, n_full)``.

    The step is enlarged by an integer stride so at most `max_points` samples remain; the last epoch is
    included when it falls on the grid.
    """
    et0, et1 = utc_to_et(start_utc), utc_to_et(end_utc)
    n_full = int(math.floor((et1 - et0 + END_TOLERANCE_S) / step_s)) + 1
    stride = 1 if max_points is None or n_full <= max_points else math.ceil((n_full - 1) / (max_points - 1))
    step = step_s * stride
    return et0, step, int(math.floor((et1 - et0 + END_TOLERANCE_S) / step)) + 1, n_full


def sample_epochs(
    start_utc: str, end_utc: str, step_s: float, max_points: int | None
) -> tuple[np.ndarray, float, int]:
    """Epochs (ET) of the `plan_epochs` plan: ``(et, effective_step_s, n_full)``."""
    et0, step, n, n_full = plan_epochs(start_utc, end_utc, step_s, max_points)
    return et0 + step * np.arange(n, dtype=np.float64), step, n_full


def _provenance(tab: BodyFixedEphemeris | None) -> dict[str, Any]:
    kernels = load_kernels().provenance()
    grid = None if tab is None else tab.provenance.get("grid_step_s")
    return {"kernels": kernels, "code_version": code_version(), "frame": BODY_FIXED_FRAME, "table_grid_step_s": grid}


def _utc_list(et: np.ndarray, digits: int = 3) -> list[str]:
    return [str(s) for s in et_to_utc(et, digits)]


def _target(tr) -> dict[str, np.ndarray]:
    return {
        "az_deg": tr.az_deg,
        "el_deg": tr.el_deg,
        "range_km": tr.range_km,
        "ang_radius_deg": tr.ang_radius_deg,
    }


def resolve_site(req: dict[str, Any]) -> tuple[Site, float, str | None]:
    """Engine `Site`, ground height and catalogue id from a request's `site` / `site_id`."""
    if req.get("site") is not None:
        s = req["site"]
        return Site(s["lat_deg"], s["lon_deg"], s["mast_height_m"], s.get("name", "")), s["ground_height_m"], None
    sid = req["site_id"]
    entry = next((e for e in load_sites() if e.id == sid), None)
    if entry is None:
        raise RequestError(f"unknown site_id {sid!r}")
    return entry.to_site(), 0.0, sid


def tracks(req: dict[str, Any], progress: Progress = _noop) -> dict[str, Any]:
    """Sun/Earth/station tracks for a validated `TracksRequest` dict (see `schemas_ephem.TracksResponse`)."""
    stations_by_id = {s.id: s for s in load_stations()}
    missing = [i for i in req["station_ids"] if i not in stations_by_id]
    if missing:
        raise RequestError(f"unknown station ids: {missing}")
    site, ground_m, site_id = resolve_site(req)
    progress(0.02, "epochs")
    try:
        et, step, n_full = sample_epochs(req["start_utc"], req["end_utc"], req["step_s"], req["max_points"])
        stations = tuple(stations_by_id[i].to_ground_station() for i in req["station_ids"])
        progress(0.1, "ephemeris table")
        tab = BodyFixedEphemeris.build(et, stations)
    except ValueError as exc:
        raise RequestError(str(exc)) from exc
    out: dict[str, Any] = {
        "site": {"lat_deg": site.lat_deg, "lon_deg": site.lon_deg, "mast_height_m": site.mast_height_m,
                 "ground_height_m": ground_m, "name": site.name},
        "site_id": site_id,
        "start_utc": req["start_utc"],
        "end_utc": req["end_utc"],
        "step_s_requested": req["step_s"],
        "step_s_effective": step,
        "n_samples_full": n_full,
        "n_samples": len(et),
        "et_tdb_s": et,
        "utc": _utc_list(et),
        "sun": None,
        "earth": None,
        "earth_eclipse_fraction": None,
        "stations": {},
    }
    progress(0.3, "utc strings")
    if "sun" in req["bodies"]:
        out["sun"] = _target(sun_track(site, ground_m, tab))
    progress(0.5, "sun")
    if "earth" in req["bodies"]:
        out["earth"] = _target(earth_track(site, ground_m, tab))
    progress(0.65, "earth")
    if req["include_eclipse_fraction"]:
        out["earth_eclipse_fraction"] = earth_eclipse_fraction(site, ground_m, tab)
    progress(0.8, "eclipse")
    for i, gs in enumerate(stations):
        st = station_track(site, ground_m, tab, gs)
        out["stations"][gs.name] = {
            "network": gs.network,
            "min_elevation_deg": gs.min_elevation_deg,
            "az_deg": st.az_deg,
            "el_deg": st.el_deg,
            "range_km": st.range_km,
            "station_el_deg": st.station_el_deg,
        }
        progress(0.8 + 0.2 * (i + 1) / len(stations), f"station {gs.name}")
    out["conventions"] = CONVENTIONS
    out["provenance"] = _provenance(tab)
    progress(1.0, "done")
    return out


def subpoints(req: dict[str, Any], progress: Progress = _noop) -> dict[str, Any]:
    """Sub-solar and sub-Earth points for a validated `SubpointsRequest` dict."""
    try:
        et, step, n_full = sample_epochs(req["start_utc"], req["end_utc"], req["step_s"], req["max_points"])
        progress(0.1, "ephemeris table")
        tab = BodyFixedEphemeris.build(et)
    except ValueError as exc:
        raise RequestError(str(exc)) from exc
    ss_lat, ss_lon = subsolar_point(tab, stellar_aberration=req["stellar_aberration"])
    se_lat, se_lon = subearth_point(
        tab, earth_view=req["earth_view"], stellar_aberration=req["stellar_aberration"]
    )
    progress(1.0, "done")
    return {
        "start_utc": req["start_utc"],
        "end_utc": req["end_utc"],
        "step_s_requested": req["step_s"],
        "step_s_effective": step,
        "n_samples_full": n_full,
        "n_samples": len(et),
        "et_tdb_s": et,
        "utc": _utc_list(et),
        "subsolar_lat_deg": ss_lat,
        "subsolar_lon_deg": ss_lon,
        "subearth_lat_deg": se_lat,
        "subearth_lon_deg": se_lon,
        "conventions": CONVENTIONS,
        "provenance": _provenance(tab),
    }


def convert_time(req: dict[str, Any]) -> dict[str, Any]:
    """UTC to ET or ET to UTC for a validated `TimeConvertRequest` dict; both forms are returned."""
    kernels = load_kernels()
    try:
        if req["utc"] is not None:
            et = np.asarray(utc_to_et(req["utc"]), dtype=np.float64)
        else:
            et = np.asarray(req["et_tdb_s"], dtype=np.float64)
            lo, hi = kernels.valid_et
            if not (np.isfinite(et).all() and et.min(initial=lo) >= lo and et.max(initial=hi) <= hi):
                raise RequestError(f"et_tdb_s must be finite and within kernel coverage [{lo:.0f}, {hi:.0f}]")
        utc = [str(s) for s in et_to_utc(et, req["digits"])] if et.size else []
    except RequestError:
        raise
    except ValueError as exc:
        raise RequestError(str(exc)) from exc
    lsk = next(f.name for f in kernels.files if f.name.endswith(".tls"))
    return {"utc": utc, "et_tdb_s": et, "leap_seconds_kernel": lsk}


def tracks_job(request: dict[str, Any], ctx: Any) -> dict[str, Any]:
    """Job-kind entry: `tracks` with progress reporting and cancellation."""
    return tracks(request, ctx.progress)


def subpoints_job(request: dict[str, Any], ctx: Any) -> dict[str, Any]:
    """Job-kind entry: `subpoints` with progress reporting and cancellation."""
    return subpoints(request, ctx.progress)
