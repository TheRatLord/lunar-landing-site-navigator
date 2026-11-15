"""Export files for download: STK `.aem`, CSV/JSON tables and a zip bundle (job entry point).

The job writes into ``<data_dir>/service/exports/<digest>/`` (the digest is a hash of the request) and returns a
manifest; the route streams the files from there. Writers come from `lunarnav.scenario.export`, so a file is
byte-for-byte what the engine's own export produces, provenance included.
"""

from __future__ import annotations

import hashlib
import re
import zipfile
from dataclasses import replace
from pathlib import Path
from typing import Any

from lunarnav.api.compute.analyses import (
    _guard,
    _scaled,
    _scenario,
    data_dir,
    get_provider,
    run_ellipse,
    run_search,
    slip_results,
)
from lunarnav.api.compute.ephem import RequestError
from lunarnav.api.jobworker import JobContext
from lunarnav.api.json import dumps
from lunarnav.api.versions import source_sha256, terrain_signature
from lunarnav.scenario import (
    compare_scenarios,
    evaluate_scenario,
    export_evaluation,
    scan_opportunities,
    write_aem,
    write_calendar_csv,
    write_comparison_csv,
    write_intervals_csv,
    write_metrics_csv,
    write_opportunities_csv,
    write_scenario_json,
    write_slip_csv,
    write_timeseries_csv,
    write_timeseries_json,
)
from lunarnav.scenario.models import Scenario

MEDIA_TYPES = {".aem": "text/plain", ".csv": "text/csv", ".json": "application/json", ".zip": "application/zip",
               ".html": "text/html", ".pdf": "application/pdf"}
ZIP_TIME = (2020, 1, 1, 0, 0, 0)
"""Fixed member timestamp so that identical inputs give identical bundles."""


def export_root() -> Path:
    return data_dir() / "service" / "exports"


def export_digest(req: dict[str, Any]) -> str:
    """Directory name of a request's files: the request, the source this worker runs and the terrain stores, so
    files produced by other code or data never share a directory with these."""
    keyed = {"request": req, "source": source_sha256(), "terrain": terrain_signature(data_dir())}
    return hashlib.sha256(dumps(keyed, canonical=True)).hexdigest()[:24]


def _prefix(scenario: Scenario) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", scenario.name).strip("-.")[:60] or "scenario"


def _scan(req: dict[str, Any], scenario: Scenario, provider: Any) -> Any:
    p = req.get("scan")
    if p is None:
        raise RequestError("this export needs `scan` parameters")
    return _guard(lambda: scan_opportunities(
        scenario, provider, start_utc=p["start_utc"], end_utc=p["end_utc"], spacing_s=p["spacing_s"],
        signal_step_s=p["signal_step_s"], lookback_h=p["lookback_h"], calendar_bin_h=p["calendar_bin_h"],
        rank_by=p.get("rank_by", "margin")))


SCAN_STAMP_NOTE = ("scenario_sha256 is the hash of the submitted scenario; each row is one candidate landing time of the scan "
                   "evaluated for that scenario")
"""Stated in the header of a scan table (opportunities, calendar), as the slip and comparison tables state whose hash they carry."""


def _stamped(scan: Any) -> Any:
    """The scan with `SCAN_STAMP_NOTE` among its provenance's `series_notes`, which the engine's CSV writers print as `# note:` lines."""
    notes = [*scan.provenance.get("series_notes", []), SCAN_STAMP_NOTE]
    return replace(scan, provenance={**scan.provenance, "series_notes": notes})


def _slips(req: dict[str, Any], scenario: Scenario, provider: Any) -> list[Any]:
    p = req.get("slip")
    if p is None:
        raise RequestError("this export needs `slip` parameters")
    return slip_results(p, scenario, provider)


def _comparison(req: dict[str, Any], scenario: Scenario, provider: Any) -> Any:
    others = req.get("compare_with") or []
    if not others:
        raise RequestError("this export needs `compare_with` (at least one more scenario)")
    scenarios = [scenario] + [_scenario({"s": d}, "s") for d in others]
    return _guard(lambda: compare_scenarios(scenarios, provider))


def _write_bundle(path: Path, files: dict[str, Path], provenance: dict[str, Any]) -> Path:
    members = {name: p.read_bytes() for name, p in sorted(files.items())}
    members["provenance.json"] = dumps(provenance, canonical=True)
    manifest = {n: {"sha256": hashlib.sha256(b).hexdigest(), "size_bytes": len(b)} for n, b in sorted(members.items())}
    members["MANIFEST.json"] = dumps({"files": manifest}, canonical=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, blob in members.items():
            info = zipfile.ZipInfo(name, ZIP_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, blob)
    return path


def export_job(req: dict[str, Any], ctx: JobContext) -> dict[str, Any]:
    kind = req["kind"]
    scenario = _scenario(req)
    provider = get_provider(req["terrain"], stores=scenario.terrain_stores)
    digest = export_digest(req)
    out = export_root() / digest
    out.mkdir(parents=True, exist_ok=True)
    prefix = _prefix(scenario)
    mp, window = req.get("max_points"), req.get("window", "mission")
    ctx.progress(0.1, "evaluating")

    def evaluation() -> Any:
        return _guard(lambda: evaluate_scenario(scenario, provider))

    files: dict[str, Path] = {}
    provenance: dict[str, Any]
    if kind == "scenario-json":
        files[f"{prefix}.scenario.json"] = write_scenario_json(scenario, out / f"{prefix}.scenario.json")
        provenance = {"scenario": scenario.model_dump(mode="json")}
        main = f"{prefix}.scenario.json"
    elif kind in ("aem", "timeseries-csv", "timeseries-json", "intervals-csv", "metrics-csv"):
        ev = evaluation()
        provenance = ev.provenance
        main = {
            "aem": f"{prefix}.{req['aem_horizon']}.aem", "timeseries-csv": f"{prefix}.timeseries.csv",
            "timeseries-json": f"{prefix}.timeseries.json", "intervals-csv": f"{prefix}.intervals.csv",
            "metrics-csv": f"{prefix}.metrics.csv"}[kind]
        if kind == "aem":
            write_aem(ev, out / main, horizon=req["aem_horizon"], bound=req["aem_bound"])
        elif kind == "timeseries-csv":
            write_timeseries_csv(ev, out / main, max_points=mp, window=window)
        elif kind == "timeseries-json":
            write_timeseries_json(ev, out / main, max_points=mp, window=window)
        elif kind == "intervals-csv":
            write_intervals_csv(ev, out / main)
        else:
            write_metrics_csv(ev, out / main)
        files[main] = out / main
    elif kind in ("opportunities-csv", "calendar-csv"):
        scan = _scan(req, scenario, provider)
        provenance = scan.provenance
        main = f"{prefix}.{'opportunities' if kind == 'opportunities-csv' else 'calendar'}.csv"
        (write_opportunities_csv if kind == "opportunities-csv" else write_calendar_csv)(_stamped(scan), out / main)
        files[main] = out / main
    elif kind == "slip-csv":
        results = _slips(req, scenario, provider)
        provenance = next((r for r in results if r.site == scenario.site), results[0]).provenance
        main = f"{prefix}.slip.csv"
        write_slip_csv(results, out / main, scenario.site)
        files[main] = out / main
    elif kind == "comparison-csv":
        cmp = _comparison(req, scenario, provider)
        provenance = {"scenarios": {n: e.provenance for n, e in zip(cmp.names, cmp.evaluations)}}
        main = f"{prefix}.comparison.csv"
        write_comparison_csv(cmp, out / main)
        files[main] = out / main
    elif kind == "report":
        from lunarnav.report import write_report

        ev = evaluation()
        provenance = ev.provenance
        ctx.progress(0.3, "analyses for the report")
        scan = _scan(req, scenario, provider) if req.get("scan") else None
        slip = None
        if req.get("slip"):
            slip = next((r for r in _slips(req, scenario, provider) if r.site == scenario.site), None)
        comparison = _comparison(req, scenario, provider) if req.get("compare_with") else None
        ellipse = run_ellipse(req["ellipse"], scenario, provider, _scaled(ctx, 0.3, 0.5)) if req.get("ellipse") else None
        search = run_search(req["search"], scenario, provider, _scaled(ctx, 0.5, 0.7)) if req.get("search") else None
        ctx.progress(0.7, "rendering")
        written = _guard(lambda: write_report(ev, out, stem=f"{prefix}.report", provider=provider, scan=scan, slip=slip,
                                              comparison=comparison, ellipse=ellipse, search=search,
                                              generated_utc=req.get("generated_utc"), formats=(req["format"],)))
        main = written[req["format"]].name
        files[main] = written[req["format"]]
    elif kind == "bundle":
        ev = evaluation()
        provenance = ev.provenance
        bundle: dict[str, Path] = {p.name: p for p in export_evaluation(ev, out / "parts", prefix).values()}
        parts = out / "parts"
        if req.get("scan"):
            ctx.progress(0.5, "scanning opportunities")
            scan = _scan(req, scenario, provider)
            stamped = _stamped(scan)
            bundle[f"{prefix}.opportunities.csv"] = write_opportunities_csv(stamped, parts / f"{prefix}.opportunities.csv")
            bundle[f"{prefix}.calendar.csv"] = write_calendar_csv(stamped, parts / f"{prefix}.calendar.csv")
        if req.get("slip"):
            ctx.progress(0.7, "slip analysis")
            results = _slips(req, scenario, provider)
            bundle[f"{prefix}.slip.csv"] = write_slip_csv(results, parts / f"{prefix}.slip.csv", scenario.site)
        if req.get("compare_with"):
            ctx.progress(0.85, "comparison")
            cmp = _comparison(req, scenario, provider)
            bundle[f"{prefix}.comparison.csv"] = write_comparison_csv(cmp, parts / f"{prefix}.comparison.csv")
        for sidecar in parts.glob("*.provenance.json"):
            bundle[sidecar.name] = sidecar
        main = f"{prefix}.bundle.zip"
        _write_bundle(out / main, bundle, provenance)
        files[main] = out / main
    else:  # pragma: no cover
        raise RequestError(f"unknown export kind {kind!r}")
    ctx.progress(0.95, "finishing")
    listing = []
    for name, path in files.items():
        blob = path.read_bytes()
        listing.append({
            "name": name, "media_type": MEDIA_TYPES.get(path.suffix, "application/octet-stream"),
            "size_bytes": len(blob), "sha256": hashlib.sha256(blob).hexdigest(),
            "url": f"/api/v1/exports/files/{digest}/{name}"})
    return {"kind": kind, "files": listing, "provenance": provenance}
