"""Starting lander profiles, constraint presets with their sources, and network converters.

Catalogue lander entries (`lunarnav.catalog`) carry few of the numbers a power and link analysis
needs (no battery capacities, no array geometry in numbers). `profile_from_catalog` therefore starts
from a generic template for the array layout, overrides what the catalogue publishes or derives
(heights, array area from published array power) and records, per field in `LanderProfile.origins`,
whether the value is published, derived or an estimate. Every template value is an *estimate* and is
flagged as such: the planner is expected to edit them.
"""

from __future__ import annotations

from collections.abc import Sequence

from lunarnav.catalog import load_landers, load_sites, load_stations
from lunarnav.catalog.models import LanderEntry, Quantity
from lunarnav.constants import SOLAR_CONSTANT_W_M2

from .models import (
    AttitudeSpec,
    BatterySpec,
    Constraints,
    LanderProfile,
    Limit,
    LinkSpec,
    LoadSpec,
    Network,
    NetworkStation,
    Origin,
    PanelSpec,
    Parameter,
    Scenario,
    SiteSpec,
)

_ESTIMATE = "Generic template value, not from the catalogue; replace with the mission's number."
CELL_EFFICIENCY = 0.28
"""Assumed end-to-end array efficiency of the templates (estimate; triple-junction cell class)."""


_Z = (0.0, 0.0, 1.0)
_PLUS_Y = (0.0, 1.0, 0.0)
_MINUS_Y = (0.0, -1.0, 0.0)


def _est(label: str) -> Origin:
    return Origin(basis="estimate", label=label, note=_ESTIMATE)


def _panels_top(area_m2: float) -> tuple[PanelSpec, ...]:
    return (PanelSpec(name="top deck", normal_body=_Z, area_m2=area_m2, efficiency=CELL_EFFICIENCY),)


def _panels_three(area_m2: float) -> tuple[PanelSpec, ...]:
    each = area_m2 / 3.0
    return (
        PanelSpec(name="top deck", normal_body=_Z, area_m2=each, efficiency=CELL_EFFICIENCY),
        PanelSpec(name="side +y", normal_body=_PLUS_Y, area_m2=each, efficiency=CELL_EFFICIENCY),
        PanelSpec(name="side -y", normal_body=_MINUS_Y, area_m2=each, efficiency=CELL_EFFICIENCY),
    )


def _panels_side(area_m2: float) -> tuple[PanelSpec, ...]:
    each = area_m2 / 2.0
    return (
        PanelSpec(name="side +y", normal_body=_PLUS_Y, area_m2=each, efficiency=CELL_EFFICIENCY),
        PanelSpec(name="side -y", normal_body=_MINUS_Y, area_m2=each, efficiency=CELL_EFFICIENCY),
    )


def _panels_tracker(area_m2: float) -> tuple[PanelSpec, ...]:
    return (PanelSpec(name="vertical sun-tracking array", normal_body=(1.0, 0.0, 0.0), area_m2=area_m2,
                      efficiency=CELL_EFFICIENCY, tracking=True),)


_LAYOUTS = {"top_deck": _panels_top, "three_panel": _panels_three, "side_panels": _panels_side,
            "tracker": _panels_tracker}
_LAYOUT_TEXT = {
    "top_deck": "single top-deck array (mid-latitude / equatorial sites); heading-independent",
    "three_panel": "top deck plus two opposed side panels; heading unknown (all headings evaluated)",
    "side_panels": "two opposed vertical side panels (polar sites); heading unknown (all headings evaluated)",
    "tracker": "vertical single-axis Sun-tracking array (polar sites)",
}

_GENERIC_AREA_M2 = {"top_deck": 3.0, "three_panel": 3.6, "side_panels": 3.0, "tracker": 3.0}
_GENERIC_HEIGHTS_M = {"top_deck": (2.0, 2.0), "three_panel": (2.0, 2.0), "side_panels": (1.5, 2.0),
                      "tracker": (3.0, 3.0)}
_GENERIC_BATTERY_WH = 1000.0
_GENERIC_LOADS_W = (150.0, 50.0)


def generic_profile(layout: str, *, profile_id: str | None = None, name: str | None = None) -> LanderProfile:
    """A generic, entirely estimated profile for `layout` (see `generic_layouts`)."""
    if layout not in _LAYOUTS:
        raise ValueError(f"unknown layout {layout!r}; choose from {sorted(_LAYOUTS)}")
    area = _GENERIC_AREA_M2[layout]
    ha, hant = _GENERIC_HEIGHTS_M[layout]
    origins = {
        "array_height_m": _est("Array centre height"),
        "antenna_height_m": _est("Antenna height"),
        "panels": _est("Panel areas and efficiency"),
        "attitude.yaw_deg": Origin(
            basis="unknown", label="Lander heading unknown",
            note="No lander has a heading before it lands. All headings are evaluated; for a heading-independent array "
                 "(single top deck, tracker) the heading does not matter. Set attitude.yaw_deg to state one."),
        **{f"battery.{f}": Origin(basis="default", label=f"Battery {f.replace('_', ' ')}",
                                  note="model default, not a lander value") for f in
           ("charge_efficiency", "discharge_efficiency", "max_dod", "initial_soc")},
        "attitude.tilt_deg": Origin(basis="default", label="Tilt and tilt azimuth", note="model default (level)"),
        "battery.capacity_wh": _est("Battery capacity"),
        "loads": _est("Bus loads"),
    }
    return LanderProfile(
        id=profile_id or f"generic-{layout.replace('_', '-')}",
        name=name or f"Generic {layout.replace('_', ' ')} lander (estimated)",
        description=f"Generic template, every number an estimate: {_LAYOUT_TEXT[layout]}.",
        array_height_m=ha, antenna_height_m=hant, panels=_LAYOUTS[layout](area),
        attitude=AttitudeSpec(),
        battery=BatterySpec(capacity_wh=_GENERIC_BATTERY_WH),
        loads=LoadSpec(sunlit_w=_GENERIC_LOADS_W[0], dark_w=_GENERIC_LOADS_W[1]), origins=origins)


def generic_layouts() -> tuple[str, ...]:
    """Layout names accepted by `generic_profile`."""
    return tuple(_LAYOUTS)


def generic_polar_tracking() -> LanderProfile:
    """Polar vertical Sun-tracking array (generic estimate)."""
    return generic_profile("tracker", profile_id="generic-polar-tracking",
                           name="Generic polar vertical sun-tracking array (estimated)")


def generic_midlat_top_deck() -> LanderProfile:
    """Mid-latitude top-deck array (generic estimate)."""
    return generic_profile("top_deck", profile_id="generic-midlat-top-deck",
                           name="Generic mid-latitude top-deck array (estimated)")


_DEFAULT_LAYOUT = {"peregrine": "top_deck", "griffin": "side_panels", "nova-c": "three_panel",
                   "blue-ghost": "three_panel"}
_POLAR_LAYOUT = {"blue-ghost": "tracker", "peregrine": "side_panels"}


def _origin(entry: LanderEntry, key: str, q: Quantity) -> Origin:
    src = entry.sources[q.source] if q.source is not None else None
    return Origin(basis=q.basis, label=f"catalogue {entry.id}.{key}", source_url=src.url if src else None,
                  note=q.note or (src.title if src else ""))


def _number(q: Quantity | None) -> float | None:
    if q is None or isinstance(q.value, (tuple, bool, str)):
        return None
    return float(q.value)


def profile_from_catalog(lander: str | LanderEntry, *, polar: bool = False, layout: str | None = None) -> LanderProfile:
    """Starting `LanderProfile` for a catalogue lander.

    Layout: `layout` if given, else the catalogue lander's template (`polar=True` selects the polar
    variant where the lander has one), else a top deck. Heights come from the catalogue when it has
    them (published or its flagged estimate); array area is the published array power divided by
    (solar constant x template efficiency), flagged `derived`; everything else is the generic
    estimate. Published/derived/estimate flags are carried into `origins`.
    """
    entry = lander if isinstance(lander, LanderEntry) else next(
        (e for e in load_landers() if e.id == lander), None)
    if entry is None:
        raise KeyError(f"unknown lander {lander!r}")
    chosen = layout or (_POLAR_LAYOUT.get(entry.id, "side_panels") if polar else _DEFAULT_LAYOUT.get(entry.id, "top_deck"))
    base = generic_profile(chosen, profile_id=entry.id + ("-polar" if polar else ""),
                           name=entry.name + (" (polar variant)" if polar else ""))
    origins = dict(base.origins)
    updates: dict = {"description": (f"Catalogue lander {entry.id} ({entry.confidence.value} entry). Layout: "
                                     f"{_LAYOUT_TEXT[chosen]}. Values not flagged published in `origins` are derived or estimates.")}
    ant, arr, height = (entry.params.get(k) for k in ("antenna_height_m", "array_height_m", "height_m"))
    if _number(ant) is not None:
        updates["antenna_height_m"] = _number(ant)
        origins["antenna_height_m"] = _origin(entry, "antenna_height_m", ant)
    elif _number(height) is not None:
        updates["antenna_height_m"] = _number(height)
        origins["antenna_height_m"] = Origin(
            basis="estimate", label="vehicle height as antenna height",
            note="Upper bound: the antenna cannot be higher than the vehicle unless on a mast or deployed.")
    ant_max = entry.params.get("antenna_height_max_m")
    if _number(ant_max) is not None and "antenna_height_m" in updates:
        updates["antenna_height_max_m"] = max(_number(ant_max), updates["antenna_height_m"])
        origins["antenna_height_max_m"] = _origin(entry, "antenna_height_max_m", ant_max)
    if _number(arr) is not None:
        updates["array_height_m"] = _number(arr)
        origins["array_height_m"] = _origin(entry, "array_height_m", arr)
    elif chosen in ("top_deck", "three_panel") and _number(height) is not None:
        updates["array_height_m"] = _number(height)
        origins["array_height_m"] = Origin(basis="estimate", label="top-deck array at vehicle height",
                                           note="Top-deck array placed at the published vehicle height.")
    power = entry.params.get("array_power_w")
    if _number(power) is not None and not polar:
        area = _number(power) / (SOLAR_CONSTANT_W_M2 * CELL_EFFICIENCY)
        updates["panels"] = _LAYOUTS[chosen](area)
        origins["panels"] = Origin(
            basis="derived", label="total area = array power / (solar constant x efficiency)",
            source_url=_origin(entry, "array_power_w", power).source_url,
            note=f"Published {_number(power):g} W ({power.note}); the {CELL_EFFICIENCY} efficiency is an estimate.")
    return base.model_copy(update=updates | {"origins": origins})


def catalog_profiles() -> dict[str, LanderProfile]:
    """Starting profile for every catalogue lander (default variant), keyed by lander id."""
    return {e.id: profile_from_catalog(e) for e in load_landers()}


def example_x_band_link() -> LinkSpec:
    """An *illustrative* X-band downlink, not tied to any mission: for demonstrations and tests only.

    EIRP 30 dBW, 8.475 GHz (centre of the DSN X-band downlink allocation 8450-8500 MHz,
    DSN 810-005 Module 301), 100 kb/s, required Eb/N0 2.5 dB, 3 dB margin, G/T 50 dB/K (a 34 m class
    station). All values are assumptions."""
    return LinkSpec(eirp_dbw=30.0, frequency_hz=8.475e9, data_rate_bps=1.0e5, required_ebn0_db=2.5,
                    required_margin_db=3.0, default_g_over_t_dbk=50.0)


_APOLLO = Origin(
    basis="historical", label="Apollo landing-site criterion: Sun 7-20 deg behind the LM",
    source_url="https://www.nasa.gov/history/50-years-ago-lunar-landing-sites-selected/",
    note="Historical Apollo requirement; not a requirement for any new lander.")
_PEREGRINE_HOURS = Origin(
    basis="mission-specific", label="Peregrine: land 55-110 hours after sunrise",
    source_url="https://www.astrobotic.com/wp-content/uploads/2022/01/PUGLanders_011222.pdf",
    note="Astrobotic Lunar Landers Payload User's Guide v5.0; a Peregrine statement, not general.")
_VIPER_DARK = Origin(
    basis="mission-specific", label="VIPER: 50 h maximum continuous darkness (hibernation)",
    source_url="https://science.nasa.gov/mission/viper/lunar-operations/")
_VIPER_MARGIN = Origin(
    basis="mission-specific", label="VIPER: 2 deg safety margin above terrain for the radio link",
    source_url="https://www.hou.usra.edu/meetings/lpsc2022/pdf/2874.pdf",
    note="LPSC 2022 #2874; the degree sign was lost in the source text, unit inferred.")
_VIPER_SLOPE = Origin(
    basis="mission-specific", label="VIPER: 15 deg nominal slope limit",
    source_url="https://www.nasa.gov/wp-content/uploads/2022/05/overview_of_mission_planning_for_the_viper_rover.pdf",
    note="Shirley & Balaban 2022, p. 5; a rover traverse limit, not a lander touchdown limit.")
_SOC_FLOOR = Origin(basis="convention", label="State of charge kept above the default 20% reserve",
                    note="Equal to 1 - default max depth of discharge (0.8); a tool convention.")

PRESET_NAMES: tuple[str, ...] = ("apollo-lighting", "peregrine-lighting", "viper-polar", "power-reserve")


def constraints_preset(name: str) -> Constraints:
    """Named starting constraint set. Every value carries its source; none is a general requirement.

    - `apollo-lighting`: Sun elevation 7-20 deg at landing.
    - `peregrine-lighting`: 55-110 h after sunrise at landing.
    - `viper-polar`: at most 50 h dark, 2 deg antenna terrain margin, 15 deg slope.
    - `power-reserve`: state of charge at least 0.2 (convention).
    """
    if name == "apollo-lighting":
        return Constraints(landing_sun_elevation_deg=Limit(
            min=7.0, max=20.0, unit="deg", label="Sun elevation at landing", origin=_APOLLO, margin_scale=5.0))
    if name == "peregrine-lighting":
        return Constraints(landing_hours_after_sunrise=Limit(
            min=55.0, max=110.0, unit="h", label="Hours after sunrise at landing", origin=_PEREGRINE_HOURS,
            margin_scale=12.0))
    if name == "viper-polar":
        return Constraints(
            max_dark_span_h=Limit(max=50.0, unit="h", label="Longest dark span", origin=_VIPER_DARK, margin_scale=10.0),
            max_slope_deg=Limit(max=15.0, unit="deg", label="Terrain slope", origin=_VIPER_SLOPE, margin_scale=3.0),
            antenna_terrain_margin_deg=Parameter(
                value=2.0, unit="deg", label="Antenna clearance required above the terrain horizon",
                origin=_VIPER_MARGIN))
    if name == "power-reserve":
        return Constraints(min_state_of_charge=Limit(
            min=0.2, unit="fraction", label="Minimum state of charge", origin=_SOC_FLOOR, margin_scale=0.1))
    raise ValueError(f"unknown preset {name!r}; choose from {PRESET_NAMES}")


def merge_constraints(*sets: Constraints) -> Constraints:
    """Union of constraint sets; a later set overrides an earlier one on the same key or parameter."""
    merged: dict = {}
    defaults = Constraints()
    for c in sets:
        for key in (*c.model_fields_set,):
            merged[key] = getattr(c, key)
    return defaults.model_copy(update=merged)


DSN_TRANSMIT_MASK_DEG = 10.0
DSN_TRANSMIT_ORIGIN = Origin(
    basis="published", label="DSN low-power transmit elevation mask 10 deg (receive 6 deg)",
    source_url="https://deepspace.jpl.nasa.gov/dsndocs/810-005/301/301P.pdf",
    note="DSN 810-005 Module 301 Rev P section 2.2; high-power transmit needs 13.5 deg.")
DEFAULT_DSN_STATIONS: tuple[str, ...] = ("dss-14", "dss-43", "dss-63")
"""One 70 m class antenna per DSN complex (Goldstone, Canberra, Madrid): the 24 h coverage triad."""


def network_from_catalog(
    station_ids: Sequence[str] = DEFAULT_DSN_STATIONS, *, direction: str = "downlink", label: str = "",
) -> Network:
    """Network of catalogue stations with their published receive masks.

    Transmit mask: the DSN published 10 deg for DSN stations; for others the receive mask is reused
    and the station is flagged `estimate`. G/T is left unset (the lander link's default applies).
    """
    by_id = {s.id: s for s in load_stations()}
    stations = []
    for sid in station_ids:
        if sid not in by_id:
            raise KeyError(f"unknown station {sid!r}")
        s = by_id[sid]
        is_dsn = s.network.upper() == "DSN"
        tx = max(DSN_TRANSMIT_MASK_DEG, s.min_elevation_deg) if is_dsn else s.min_elevation_deg
        origin = DSN_TRANSMIT_ORIGIN if is_dsn else Origin(
            basis="estimate", label="transmit mask taken equal to the receive mask",
            note=f"receive mask source: {s.min_elevation_source}")
        stations.append(NetworkStation(
            id=s.id, name=s.name, network=s.network, lat_deg=s.lat_deg, lon_deg=s.lon_deg, alt_m=s.alt_m, alt_basis=s.alt_basis,
            rx_mask_deg=s.min_elevation_deg, tx_mask_deg=tx, origin=origin))
    return Network(stations=tuple(stations), label=label or "+".join(station_ids), direction=direction)


def scenario_from_catalog(
    site_id: str, lander_id: str, *, mission_duration_h: float, landing_utc: str | None = None,
    constraints: Constraints | None = None, network: Network | None = None, polar: bool = False, name: str | None = None,
) -> Scenario:
    """Scenario for a catalogue site and lander. `landing_utc` defaults to the catalogue site's landing
    time (historic and planned landings); the lander is `profile_from_catalog(lander_id, polar=...)`."""
    site = next((s for s in load_sites() if s.id == site_id), None)
    if site is None:
        raise KeyError(f"unknown site {site_id!r}")
    when = landing_utc or site.landing_utc
    if when is None:
        raise ValueError(f"site {site_id!r} has no catalogue landing time; pass landing_utc")
    return Scenario(
        name=name or f"{site.name} / {lander_id}",
        site=SiteSpec(lat_deg=site.lat_deg, lon_deg=site.lon_deg, name=site.name, catalog_id=site.id),
        landing_utc=when, mission_duration_h=mission_duration_h,
        profile=profile_from_catalog(lander_id, polar=polar), constraints=constraints or Constraints(),
        network=network or Network())
