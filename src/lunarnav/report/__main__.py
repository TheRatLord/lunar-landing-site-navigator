"""`python -m lunarnav.report`: run the engine for a catalogue site or a scenario file and write the report.

Examples::

    python -m lunarnav.report --site blue-ghost-m1 --lander blue-ghost --duration-h 96 --dsn \
        --preset peregrine-lighting --preset power-reserve --scan 2025-03-01T00:00Z 2025-08-01T00:00Z \
        --slips 0,24,48,72 --compare-duration-h 240 --out reports --stem blue-ghost
    python -m lunarnav.report --scenario scenario.json --scan 2026-01-01T00:00Z 2027-01-01T00:00Z --slips 0,24,48

The engine is run here (this is a client of it); the report module itself only formats the results.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np

from lunarnav.scenario import (
    SmoothSphereProvider,
    TerrainProvider,
    compare_scenarios,
    evaluate_scenario,
    merge_constraints,
    network_from_catalog,
    read_scenario_json,
    scan_opportunities,
    scenario_from_catalog,
    slip_analysis,
)
from lunarnav.scenario.ellipse import ellipse_statistics
from lunarnav.scenario.models import Ellipse
from lunarnav.scenario.profiles import PRESET_NAMES, constraints_preset
from lunarnav.scenario.search import SearchRegion, search_sites

from . import write_report
from .errors import ReportInputError, parse_generated_utc


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m lunarnav.report", description=__doc__.split("\n\n")[0])
    src = p.add_argument_group("scenario (one of --scenario or --site)")
    src.add_argument("--scenario", type=Path, help="scenario JSON file (lunarnav.scenario.write_scenario_json)")
    src.add_argument("--site", help="catalogue site id, e.g. im-2-athena")
    src.add_argument("--lander", help="catalogue lander id, e.g. nova-c")
    src.add_argument("--polar", action="store_true", help="polar variant of the catalogue lander profile")
    src.add_argument("--duration-h", type=float, help="surface mission duration in hours")
    src.add_argument("--landing-utc", help="landing epoch (ISO-8601 UTC, Z suffix); default: the catalogue site's")
    src.add_argument("--preset", action="append", default=[], choices=PRESET_NAMES,
                     help="constraint preset (repeatable; later presets override earlier ones)")
    src.add_argument("--dsn", action="store_true", help="use the default DSN triad as ground network")
    p.add_argument("--terrain", action="store_true", help="use the terrain stores under data/dem/store (default: smooth sphere)")
    p.add_argument("--terrain-stores", metavar="ID,ID,...",
                   help="with --terrain: restrict the stack to these store ids (the scenario then records terrain_stores)")
    p.add_argument("--n-az", type=int, default=720, help="horizon azimuth samples with --terrain (default 720)")
    p.add_argument("--scan", nargs=2, metavar=("START_UTC", "END_UTC"), help="add a landing opportunity scan and calendar")
    p.add_argument("--slips", help="comma-separated landing slips in hours, e.g. 0,24,48,72 (adds the slip analysis)")
    p.add_argument("--compare-duration-h", type=float, action="append", default=[], metavar="H",
                   help="add a comparison matrix; repeatable: the same scenario with this surface duration (hours)")
    p.add_argument("--compare-scenario", type=Path, action="append", default=[], metavar="JSON",
                   help="add a comparison matrix; repeatable: another scenario file to compare with the main one")
    ell = p.add_argument_group("landing-ellipse statistics (adds the ellipse section)")
    ell.add_argument("--ellipse", action="store_true", help="add the landing-ellipse statistics (the scenario's ellipse, or --ellipse-axes)")
    ell.add_argument("--ellipse-axes", nargs=2, type=float, metavar=("MAJOR_M", "MINOR_M"), help="semi-axes in metres (sets the scenario's ellipse)")
    ell.add_argument("--ellipse-azimuth", type=float, default=0.0, help="azimuth of the major axis, clockwise from north (default 0)")
    ell.add_argument("--ellipse-dispersion", choices=("gaussian", "uniform"), default="gaussian")
    ell.add_argument("--ellipse-sigma", type=float, default=3.0, help="sigma level of the semi-axes for a gaussian dispersion (default 3)")
    ell.add_argument("--ellipse-samples", type=int, default=512, help="number of samples (default 512)")
    ell.add_argument("--ellipse-seed", type=int, default=0, help="sampling seed (default 0)")
    ell.add_argument("--ellipse-map-cells", type=int, default=17, help="verdict map cells per side (default 17)")
    srch = p.add_argument_group("site search (adds the search section)")
    srch.add_argument("--search-radius-m", type=float, help="search a disc of this radius about --search-centre (default: the site); adds the site search")
    srch.add_argument("--search-centre", nargs=2, type=float, metavar=("LAT", "LON"), help="centre of the search disc (default: the scenario's site)")
    srch.add_argument("--search-spacing-m", type=float, help="final lattice spacing in metres (required with --search-radius-m)")
    srch.add_argument("--search-epochs", nargs=3, metavar=("FIRST_UTC", "LAST_UTC", "SPACING_H"),
                      help="score each site at its best landing epoch in this range (default: the scenario's landing epoch)")
    srch.add_argument("--search-top-k", type=int, default=20, help="number of ranked sites (default 20)")
    srch.add_argument("--search-coarse-factor", type=int, default=8, help="power of two; 1 evaluates every point with the full horizon (default 8)")
    srch.add_argument("--search-exhaustive", action="store_true", help="evaluate every lattice point with the full horizon (the reference)")
    p.add_argument("--out", type=Path, default=Path("."), help="output directory (default: current)")
    p.add_argument("--stem", default="report", help="output file name without extension")
    p.add_argument("--check", nargs="+", type=Path, metavar="HTML",
                   help="do not render: report whether each given HTML report's recorded source hash equals the checked-out "
                        "code and its PDF alongside (if any) belongs to it; exit 1 if not")
    p.add_argument("--timestamp", help="fixed generation time, e.g. 2026-01-01T00:00:00Z, for reproducible bytes")
    p.add_argument("--format", action="append", choices=("html", "pdf"), help="output format (repeatable; default both)")
    return p


def _fail(message: str, code: int = 2) -> int:
    print(f"error: {message}", file=sys.stderr)
    return code


def _positive(name: str, value: float | None) -> str | None:
    if value is not None and not value > 0.0:
        return f"{name} must be greater than 0 (got {value:g})"
    return None


def _slips(text: str) -> list[float]:
    try:
        return [float(x) for x in text.split(",")]
    except ValueError as e:
        raise ReportInputError(f"--slips takes comma-separated hours such as 0,24,48 (got {text!r})") from e


def _check(paths: list[Path]) -> int:
    from .freshness import check_files

    bad = False
    for r in check_files(paths):
        state = "current" if r["current"] else "STALE  "
        pdf = "no PDF alongside" if r["pdf"] is None else ("PDF matches" if r["pdf_matches"] else "PDF does NOT match this HTML")
        print(f"{state} {r['path']} (recorded source hash {r['hash'][:16]}; {pdf})")
        bad |= not r["current"] or r["pdf_matches"] is False
    return 1 if bad else 0


def _scenario(args):
    if args.site:
        if not args.lander:
            raise ReportInputError("--site needs --lander")
        if args.duration_h is None:
            raise ReportInputError("--site needs --duration-h")
        cons = merge_constraints(*(constraints_preset(n) for n in args.preset)) if args.preset else None
        try:
            return scenario_from_catalog(
                args.site, args.lander, mission_duration_h=args.duration_h, landing_utc=args.landing_utc, constraints=cons,
                network=network_from_catalog() if args.dsn else None, polar=args.polar)
        except KeyError as e:
            raise ReportInputError(f"unknown catalogue entry {e.args[0]!r} (--site {args.site}, --lander {args.lander})") from e
    return _read_scenario(args.scenario)


def _read_scenario(path: Path):
    try:
        return read_scenario_json(path)
    except OSError as e:
        raise ReportInputError(f"cannot read scenario file {path}: {e.strerror or e}") from e
    except ValueError as e:
        raise ReportInputError(f"{path} is not a valid scenario document: {e}") from e


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return _run(args)
    except ReportInputError as e:
        return _fail(str(e), 1)


def _run(args) -> int:
    if args.check:
        return _check(args.check)
    if bool(args.scenario) == bool(args.site):
        return _fail("give exactly one of --scenario or --site")
    for name, value in (("--duration-h", args.duration_h), *(("--compare-duration-h", h) for h in args.compare_duration_h),
                        ("--search-radius-m", args.search_radius_m), ("--search-spacing-m", args.search_spacing_m)):
        if (msg := _positive(name, value)) is not None:
            return _fail(msg)
    generated = parse_generated_utc(args.timestamp) if args.timestamp is not None else None
    slips = _slips(args.slips) if args.slips else None
    formats = tuple(args.format or ("html", "pdf"))
    scenario = _scenario(args)
    if args.terrain_stores is not None and not args.terrain:
        return _fail("--terrain-stores needs --terrain")
    if args.terrain:
        from lunarnav.terrain import TerrainStack

        ids = None
        if args.terrain_stores is not None:
            ids = [i.strip() for i in args.terrain_stores.split(",")]
            if not all(ids) or len(set(ids)) != len(ids):
                return _fail("--terrain-stores takes a comma-separated list of distinct store ids")
            from lunarnav.terrain.paths import store_dir

            missing = [i for i in ids if not (store_dir() / i / "meta.json").is_file()]
            if missing:
                return _fail(f"unknown terrain store {', '.join(missing)} (stores are the directories under {store_dir()})")
        stack = TerrainStack.open(dem_ids=ids)
        if ids is not None:
            scenario = scenario.model_copy(update={"terrain_stores": tuple(sorted(ids))})
            if not any(bool(np.isfinite(st.height(scenario.site.lat_deg, scenario.site.lon_deg)).any()) for st in stack.stores):
                return _fail(f"the chosen stores {sorted(ids)} have no ground at the site")
        provider = TerrainProvider(stack, n_az=args.n_az)
    else:
        provider = SmoothSphereProvider()
    if args.ellipse_axes:
        if args.ellipse_axes[1] > args.ellipse_axes[0]:
            return _fail("--ellipse-axes takes the semi-major axis first")
        scenario = scenario.model_copy(update={"ellipse": Ellipse(
            semi_major_m=args.ellipse_axes[0], semi_minor_m=args.ellipse_axes[1], azimuth_deg=args.ellipse_azimuth,
            dispersion=args.ellipse_dispersion, sigma_level=args.ellipse_sigma)})
    if args.ellipse and scenario.ellipse is None:
        return _fail("--ellipse needs a landing ellipse: give --ellipse-axes or a scenario file that has one")
    if args.search_radius_m is not None and args.search_spacing_m is None:
        return _fail("--search-radius-m needs --search-spacing-m")
    t0 = time.perf_counter()
    evaluation = evaluate_scenario(scenario, provider)
    ellipse = ellipse_statistics(scenario, provider, n_samples=args.ellipse_samples, seed=args.ellipse_seed,
                                 map_cells=args.ellipse_map_cells) if args.ellipse else None
    search = None
    if args.search_radius_m is not None:
        lat, lon = args.search_centre or (scenario.site.lat_deg, scenario.site.lon_deg)
        first, last, spacing = args.search_epochs or (None, None, None)
        search = search_sites(scenario, provider, SearchRegion(lat, lon, radius_m=args.search_radius_m),
                              final_spacing_m=args.search_spacing_m, first_utc=first, last_utc=last,
                              epoch_spacing_h=None if spacing is None else float(spacing), coarse_factor=args.search_coarse_factor,
                              top_k=args.search_top_k, exhaustive=args.search_exhaustive)
    scan = scan_opportunities(scenario, provider, start_utc=args.scan[0], end_utc=args.scan[1]) if args.scan else None
    slip = slip_analysis(scenario, provider, slips_h=slips) if slips else None
    comparison = None
    if args.compare_duration_h or args.compare_scenario:
        others = [scenario.model_copy(update={"name": f"{scenario.name} ({h:g} h)", "mission_duration_h": h})
                  for h in args.compare_duration_h]
        others += [_read_scenario(path) for path in args.compare_scenario]
        comparison = compare_scenarios([scenario, *others], provider)
    t1 = time.perf_counter()
    paths = write_report(evaluation, args.out, stem=args.stem, provider=provider, scan=scan, slip=slip,
                         comparison=comparison, ellipse=ellipse, search=search,
                         generated_utc=generated, formats=formats)
    t2 = time.perf_counter()
    for kind, path in paths.items():
        print(f"{kind}: {path} ({path.stat().st_size} bytes)")
    print(f"engine {t1 - t0:.1f} s, report {t2 - t1:.1f} s", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
