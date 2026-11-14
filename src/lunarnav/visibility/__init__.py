"""Pure-maths visibility layer: disc fractions, intervals, terrain uncertainty, power, communication.

No SPICE and no terrain access: inputs are `TargetTrack` / `HorizonProfile` from `lunarnav.types` or
plain arrays. See docs/validation/visibility.md for methods and measured errors.
"""

from lunarnav.visibility._horizon import horizon_elevation_at, horizon_grid
from lunarnav.visibility.battery import (
    Battery,
    BatteryResult,
    LoadProfile,
    simulate_battery,
    simulate_battery_scan,
)
from lunarnav.visibility.comms import StationTrack, station_signal
from lunarnav.visibility.disc import BoundedSignal, disc_fraction, point_clearance_bounds
from lunarnav.visibility.intervals import UncertainWindow, Window, bounded_windows, dark_windows, find_windows
from lunarnav.visibility.limb_darkening import LimbDarkening
from lunarnav.visibility.link_budget import LinkBudget, evaluate_link
from lunarnav.visibility.power import Attitude, Panel, array_power_w, power_over_yaws
from lunarnav.visibility.uncertainty import TerrainErrorModel, widen_horizon

__all__ = [
    "Attitude", "Battery", "BatteryResult", "BoundedSignal", "LimbDarkening", "LinkBudget", "LoadProfile", "Panel",
    "StationTrack", "TerrainErrorModel", "UncertainWindow", "Window", "array_power_w", "bounded_windows",
    "dark_windows", "disc_fraction", "evaluate_link", "find_windows", "horizon_elevation_at", "horizon_grid",
    "point_clearance_bounds", "power_over_yaws", "simulate_battery", "simulate_battery_scan", "station_signal",
    "widen_horizon",
]  # fmt: skip
