"""Gridded illumination and visibility layers over an area (regional method; see docs/validation/illumination.md)."""

from lunarnav.regional.grid import Method, RegionSpec
from lunarnav.regional.io import read_raw, write_geotiff
from lunarnav.regional.layers import calibrate_horizon_error, compute_layers, horizon_residuals, verdict_layer

__all__ = [
    "Method", "RegionSpec", "calibrate_horizon_error", "compute_layers", "horizon_residuals", "read_raw",
    "verdict_layer", "write_geotiff",
]  # fmt: skip
