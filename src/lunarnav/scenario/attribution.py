"""Event attribution: what sets a sunset, sunrise, loss of contact or acquisition of contact.

Sunlight events: the last (sunset) or first (sunrise) limb point of the solar disc to cross the
horizon. At each epoch the disc's highest point at azimuth a is `el + sqrt(r^2 - (da cos el)^2)` (small
angles, r = 0.27 deg); the *disc clearance* is the maximum over a of that elevation minus the horizon
elevation at a. The last/first limb event is the zero crossing of this clearance; the azimuth where
the maximum is attained at that instant is the blocking azimuth. The horizon elevation, blocker
distance and (with a terrain provider) blocker coordinates are read there. Because the signal in
`SiteEvaluation` uses the half-flux criterion, the attributed time follows a sunset (precedes a sunrise)
by the time the Sun takes to move through half its disc relative to the horizon: about 15 minutes at
low latitude and hours at high latitude, where the Sun's path meets the horizon at a shallow angle.
Events caused by the Earth's shadow carry the Sun's azimuth, no blocker, and cause "Earth eclipse".

Contact events: the station whose window ends (starts) at the event is identified; the report gives the
station azimuth, the lander-side horizon elevation there and the station-side margin, and names the
limiting side (lander horizon plus margin, or the station elevation mask).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from lunarnav.ephem import et_to_utc
from lunarnav.visibility import horizon_elevation_at, horizon_grid

from .edge_cause import contact_edge, disc_clearance, sun_direction
from .evaluate import SiteEvaluation
from .horizons import HorizonProvider, SmoothSphereProvider, sphere_horizon_dip_deg

SEARCH_STEP_S = 60.0


@dataclass(frozen=True, slots=True)
class EventAttribution:
    """Attribution of one event (see module doc)."""

    kind: str
    et: float
    utc: str
    az_deg: float
    """Blocking azimuth (limb point for Sun events, station direction for contact events)."""
    horizon_elev_deg: float
    object_elev_deg: float
    """Elevation of the limb point or of the station direction at the event."""
    blocker_dist_m: float | None
    blocker: dict[str, float] | None
    """Latitude, longitude and height of the blocking terrain sample (terrain provider only)."""
    cause: str
    station: str | None = None
    limiting_side: str | None = None
    detail: str = ""
    time_basis: str = "limb crossing"
    """What `et`/`utc` is: `limb crossing` (the Sun's disc crossing the horizon) or `half-flux event` (no limb
    crossing near the event: the Earth eclipse, or the flux threshold, set it; the instant is the verdict's half-flux time,
    not a limb crossing)."""
    eclipse_fraction: float = 0.0
    """Fraction of the Sun's disc covered by the Earth at the event instant (0 = none)."""
    limb_crossing: bool = True
    """The event is a terrain-limb crossing. False: do not print `utc` as a crossing; see `time_basis` and `cause`."""


def _sun_event(ev: SiteEvaluation, kind: str, te: float, provider: HorizonProvider, window_h: float) -> EventAttribution:
    sig = ev.signals
    t = sig.et
    t0, t1 = te - window_h * 3600.0, te + window_h * 3600.0
    sun_at = sun_direction(sig, t0, t1)
    r = float(np.interp(te, t, sig.sun_ang_radius_deg))
    grid = horizon_grid(sig.array_horizon, "nominal")
    tt = np.arange(max(t0, t[0]), min(t1, t[-1]), SEARCH_STEP_S)
    c = np.array([disc_clearance(*sun_at(x), r, grid)[0] for x in tt])
    want_down = kind == "sunset"
    cross = np.flatnonzero((c[:-1] > 0) & (c[1:] <= 0)) if want_down else np.flatnonzero((c[:-1] <= 0) & (c[1:] > 0))
    ecl = float(np.interp(te, t, sig.eclipse))
    if not cross.size:
        te_attr = te
        az0, el0 = sun_at(te)
        clr, a_lim, top = disc_clearance(az0, el0, r, grid)
        cause = "Earth eclipse" if ecl > 0.0 else "no horizon limb crossing found near the event"
    else:
        k = cross[int(np.argmin(np.abs(tt[cross] - te)))]
        te_attr = float(tt[k] + SEARCH_STEP_S * c[k] / (c[k] - c[k + 1]))
        az0, el0 = sun_at(te_attr)
        clr, a_lim, top = disc_clearance(az0, el0, r, grid)
        ecl_at = float(np.interp(te_attr, t, sig.eclipse))
        dip = -sphere_horizon_dip_deg(sig.array_horizon.site.mast_height_m)
        h = float(horizon_elevation_at(np.array([a_lim]), grid)[0])
        if ecl_at > 0.05:
            cause = "Earth eclipse"
        elif provider.models_terrain and h > dip + 0.01:
            cause = "terrain horizon"
        else:
            cause = "smooth-sphere horizon" if not provider.models_terrain else "horizon at the sphere dip"
    h_lim = float(horizon_elevation_at(np.array([a_lim]), grid)[0])
    n = len(sig.array_horizon.az_deg)
    k_az = int(round(a_lim / (360.0 / n))) % n
    dist = float(sig.array_horizon.blocker_dist_m[k_az])
    on_horizon = cause != "Earth eclipse"
    blocker = provider.blocker_point(sig.array_horizon, a_lim) if on_horizon else None
    dist = dist if on_horizon else math.nan
    crossing = bool(cross.size)
    ecl_event = float(np.interp(te_attr, t, sig.eclipse))
    if crossing:
        detail = (f"time of the {'last' if want_down else 'first'} limb crossing; the half-flux event used by the "
                  f"verdicts is at {et_to_utc(te)}")
        if cause == "Earth eclipse":
            detail += f"; the Earth covers {ecl_event:.0%} of the Sun's disc at that instant"
    else:
        detail = (f"no terrain-limb crossing near the event: the instant is the half-flux event used by the verdicts, "
                  f"not a limb crossing; Earth eclipse covers {ecl_event:.0%} of the Sun's disc there")
    return EventAttribution(
        kind, te_attr, et_to_utc(te_attr), a_lim, h_lim, top, dist if np.isfinite(dist) else None,
        blocker, cause, detail=detail, time_basis="limb crossing" if crossing else "half-flux event",
        eclipse_fraction=ecl_event, limb_crossing=crossing)


def _contact_event(ev: SiteEvaluation, kind: str, te: float, provider: HorizonProvider) -> EventAttribution:
    sig = ev.signals
    margin = ev.scenario.constraints.antenna_terrain_margin_deg.value
    edge = contact_edge(sig, margin, te, ending=kind == "earthset")
    az, h, el_dir, station, lander_limits = edge.az_deg, edge.horizon_deg, edge.direction_el_deg, edge.station, edge.lander_limits
    if station is not None:
        side = "lander horizon plus margin" if lander_limits else "station elevation mask"
        detail = (f"lander-side clearance {edge.lander_side_deg:.3f} deg, station-side clearance {edge.station_side_deg:.3f} deg "
                  f"(mask {sig.station_mask_deg[station]:g} deg)")
    else:
        side = "lander horizon plus margin"
        detail = f"Earth centre {edge.lander_side_deg:.3f} deg above the antenna horizon plus margin"
    n = len(sig.antenna_horizon.az_deg)
    dist = float(sig.antenna_horizon.blocker_dist_m[int(round(az / (360.0 / n))) % n])
    blocker = provider.blocker_point(sig.antenna_horizon, az) if lander_limits else None
    return EventAttribution(
        kind, te, et_to_utc(te), az, h, el_dir, dist if (lander_limits and np.isfinite(dist)) else None,
        blocker, "contact", station, side, detail)


def attribute_event(
    ev: SiteEvaluation, kind: str, from_et: float | str | None = None, provider: HorizonProvider | None = None,
    *, window_h: float = 12.0,
) -> EventAttribution | None:
    """Attribute the next `kind` event (`sunset`, `sunrise`, `earthset`, `earthrise`) after `from_et`
    (default: the landing). Returns None if the analysed span has no such event.

    Pass the provider that produced the evaluation so that blocker coordinates can be resolved (a
    smooth-sphere provider has none)."""
    provider = provider or SmoothSphereProvider()
    nxt = ev.next_event(kind, from_et)
    if nxt is None:
        return None
    if kind in ("sunset", "sunrise"):
        return _sun_event(ev, kind, nxt.et, provider, window_h)
    return _contact_event(ev, kind, nxt.et, provider)
