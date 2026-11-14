"""``python -m lunarnav.regional``: compute illumination/visibility layers for a region and write them.

Example (20 km x 20 km around Connecting Ridge, 20 m cells, two years hourly, 2 m mast)::

    .venv/bin/python -m lunarnav.regional --lat -89.44 --lon 222.9 --size-km 20 --spacing-m 20 \\
        --start 2024-01-01 --stop 2026-01-01 --mast 2 --out data/runs/regional_cr

Exit status 0: layers written; 2: the request is invalid or cannot be computed (a one-line message, no traceback).
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

from lunarnav.regional.grid import Method, RegionSpec
from lunarnav.regional.layers import RegionalInputError, compute_layers
from lunarnav.terrain import TerrainStack

MAX_SCALE_FACTOR = 1.1
WARN_SCALE_FACTOR = 1.02


def _fail(msg: str) -> int:
    print(f"error: {msg}", file=sys.stderr)
    return 2


def _kernel_notice() -> None:
    """Say so on stderr when the pinned SPICE kernels have to be downloaded (first use)."""
    from lunarnav.ephem.kernels import kernel_dir, missing_kernels

    missing = missing_kernels()
    if missing:
        mb = sum(k.size_bytes for k in missing) / 1e6
        print(f"note: downloading {len(missing)} SPICE kernel file(s), {mb:.0f} MB, to {kernel_dir()} (first use only; each is SHA-256 verified)",
              file=sys.stderr, flush=True)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m lunarnav.regional", description=__doc__.split("\n")[0])
    p.add_argument("--lat", type=float, required=True, help="region centre latitude (planetocentric deg, -90 to 90, poleward of about 55)")
    p.add_argument("--lon", type=float, required=True, help="region centre east longitude (deg)")
    p.add_argument("--size-km", type=float, required=True, help="side of the square region (km)")
    p.add_argument("--spacing-m", type=float, required=True, help="cell spacing (map metres)")
    p.add_argument("--start", required=True, help="first epoch, ISO-8601 UTC")
    p.add_argument("--stop", required=True, help="last epoch limit, ISO-8601 UTC")
    p.add_argument("--step-s", type=float, default=3600.0)
    p.add_argument("--mast", type=float, default=0.0, help="observer height above terrain (m)")
    p.add_argument("--sun-rule", choices=["any_part", "half_flux"], default="any_part")
    p.add_argument("--earth-rule", choices=["centre", "any_part"], default="any_part")
    p.add_argument("--earth-margin-deg", type=float, default=0.0)
    p.add_argument("--dem-ids", nargs="*", default=None, help="restrict the terrain stores (default: all)")
    p.add_argument("--out", required=True, help="output directory (tiles, geotiff/, raw/, header.json); reruns resume; layers of an earlier run "
                                                "that this run does not write are removed")
    p.add_argument("--n-az", type=int, default=360)
    p.add_argument("--tile", type=int, default=128)
    p.add_argument("--calibrate", type=int, default=32, help="cells for the exact-engine calibration: sets the _lo/_hi brackets and gives this run's "
                                                              "own measured error of every layer (0: neither)")
    p.add_argument("--no-brackets", action="store_true", help="do not compute the estimated <layer>_lo / <layer>_hi brackets "
                                                                "(the calibration still runs unless --calibrate 0)")
    p.add_argument("--no-earth", action="store_true")
    p.add_argument("--threads", type=int, default=None)
    p.add_argument("--max-memory-gb", type=float, default=None, help="refuse a region whose layers need more (default: 80 %% of the available memory)")
    a = p.parse_args(argv)

    if not (math.isfinite(a.lat) and -90.0 <= a.lat <= 90.0):
        p.error(f"--lat must be between -90 and 90 degrees (got {a.lat})")
    if not math.isfinite(a.lon):
        p.error(f"--lon must be a finite number (got {a.lon})")
    for flag, v in (("--size-km", a.size_km), ("--spacing-m", a.spacing_m), ("--step-s", a.step_s)):
        if not (math.isfinite(v) and v > 0):
            p.error(f"{flag} must be positive (got {v})")
    if a.size_km * 1000.0 < a.spacing_m:
        p.error(f"--spacing-m ({a.spacing_m:g} m) is larger than the region ({a.size_km:g} km)")
    if not (math.isfinite(a.mast) and a.mast >= 0):
        p.error(f"--mast must be zero or positive (got {a.mast})")
    if a.n_az < 8:
        p.error(f"--n-az must be at least 8 (got {a.n_az})")
    if a.tile < 1:
        p.error(f"--tile must be at least 1 (got {a.tile})")
    if a.calibrate < 0:
        p.error(f"--calibrate must be zero or positive (got {a.calibrate})")
    if a.threads is not None and a.threads < 1:
        p.error(f"--threads must be at least 1 (got {a.threads})")
    if a.max_memory_gb is not None and a.max_memory_gb <= 0:
        p.error(f"--max-memory-gb must be positive (got {a.max_memory_gb})")

    try:
        spec = RegionSpec.centred(
            a.lat, a.lon, a.size_km * 1000.0, a.spacing_m, a.start, a.stop, step_s=a.step_s, mast_height_m=a.mast,
            sun_rule=a.sun_rule, earth_rule=a.earth_rule, earth_margin_deg=a.earth_margin_deg,
            dem_ids=tuple(a.dem_ids) if a.dem_ids else None,
        )
    except ValueError as exc:
        return _fail(f"invalid region or period: {exc}")
    if spec.n_epochs < 1:
        return _fail("--stop is before --start")
    k = spec.scale_factor()
    if k > MAX_SCALE_FACTOR:
        return _fail(f"latitude {a.lat:g} is too far from the pole: the polar stereographic grid of the terrain products has map scale {k:.2f} "
                     f"there (limit {MAX_SCALE_FACTOR}); use a latitude poleward of about 55 degrees")
    if k > WARN_SCALE_FACTOR:
        print(f"warning: map scale factor {k:.3f} at the region centre: the {spec.spacing_m:g} m cell spacing is map metres (ground {spec.spacing_m / k:.1f} m)",
              file=sys.stderr)
    try:
        stack = TerrainStack.open(a.dem_ids)
    except (OSError, ValueError, KeyError) as exc:
        return _fail(f"cannot open the terrain stores {a.dem_ids if a.dem_ids else '(all)'}: {exc}")
    print(f"region {spec.n_rows}x{spec.n_cols} cells at {spec.spacing_m:g} m, {spec.n_epochs} epochs, stores {list(stack.dem_ids)}", file=sys.stderr)
    _kernel_notice()
    t0 = time.time()

    def prog(i: int, n: int) -> None:
        print(f"  tile {i}/{n}  {time.time() - t0:7.1f} s", file=sys.stderr, flush=True)

    try:
        res = compute_layers(spec, stack, Method(n_az=a.n_az, tile=a.tile), out_dir=Path(a.out), bounds=not a.no_brackets, calibrate=a.calibrate,
                             do_earth=not a.no_earth, threads=a.threads, progress=prog,
                             max_memory_bytes=None if a.max_memory_gb is None else int(a.max_memory_gb * 1e9))
    except RegionalInputError as exc:
        return _fail(str(exc))
    h = res.header
    for w in h["warnings"]:
        print(f"warning: {w}", file=sys.stderr)
    print(json.dumps({"out": a.out, "coverage": h["coverage"], "store_changes": h["store_changes"], "timing": h["timing"],
                      "bracket_calibration": None if not h["bracket_calibration"] else {k: h["bracket_calibration"][k] for k in ("shift_lo_deg", "shift_hi_deg")},
                      "layers": sorted(res.layers)}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
