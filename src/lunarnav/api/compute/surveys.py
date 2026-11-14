"""Long surveys as jobs: landing-ellipse statistics, site search and regional illumination layers.

* `ellipse_job` and `search_job` wrap `lunarnav.scenario.ellipse_statistics` / `search_sites` and hand them
  `ctx.progress` as the engine's progress callback (after every 64-sample batch, at every search level and after every
  256-point chunk); a cancel request raises out of that callback and stops the call without a result.
* `regional_job` wraps `lunarnav.regional.compute_layers`, reports tile progress and is cancellable between tiles.
  It writes GeoTIFFs (one per layer, polar stereographic like the LOLA products) and `header.json` into the export
  directory ``<service_dir>/exports/<digest>/`` and returns a manifest with download URLs, per-layer statistics and,
  on request, small layers inline. Tiles of an interrupted run stay in ``work/`` and are reused by the same request.
"""

from __future__ import annotations

import hashlib
import os
import shutil
from pathlib import Path
from typing import Any

import numpy as np

from lunarnav.api.compute.analyses import (
    _envelope,
    _fin,
    _guard,
    _scenario,
    data_dir,
    get_provider,
    limit_notes,
    run_ellipse,
    run_search,
)
from lunarnav.api.compute.ephem import RequestError
from lunarnav.api.compute.exports import export_digest, export_root
from lunarnav.api.jobworker import JobContext
from lunarnav.api.versions import code_version, source_sha256
from lunarnav.report.limits import ellipse_limits, evaluate_search_sites, search_limits
from lunarnav.scenario import evaluate_scenario


def _ellipse_limits(scenario: Any, provider: Any, res: Any) -> list[dict[str, Any]]:
    """The notes of an ellipse, from the report's own rule (`lunarnav.report.limits.ellipse_limits`): the scenario's own evaluation's, then the survey's."""
    return limit_notes(ellipse_limits(_guard(lambda: evaluate_scenario(scenario, provider)), res))


def _search_limits(scenario: Any, provider: Any, res: Any) -> list[dict[str, Any]]:
    """The notes of a search, from the report's own rule (`lunarnav.report.limits.search_limits`): they describe the sites it returns."""
    return limit_notes(search_limits(_guard(lambda: evaluate_search_sites(scenario, res, provider)), res))


def ellipse_job(req: dict[str, Any], ctx: JobContext) -> dict[str, Any]:
    scenario = _scenario(req)
    provider = get_provider(req["terrain"], stores=scenario.terrain_stores)
    res = run_ellipse(req, scenario, provider, ctx.progress)
    body = res.to_dict(with_samples=req.get("with_samples", False))
    active = scenario.constraints.active()

    def physical(margin: float | None, key: str | None) -> tuple[float | None, str | None]:
        lim = active.get(key) if key else None
        return (None if lim is None or margin is None else margin * lim.margin_scale), (None if lim is None else lim.unit)

    for ref in ("best", "worst", "centre"):
        body[ref]["worst_margin_physical"], body[ref]["margin_unit"] = physical(_fin(body[ref]["worst_margin"]), body[ref]["limiting"])
    if body.get("samples") is not None:
        limiting = [res.keys[k] if 0 <= k < len(res.keys) else None for k in (int(i) for i in res.limiting)]
        pairs = [physical(m, k) for m, k in zip(body["samples"]["worst_margin"], limiting)]
        body["samples"].update(limiting=limiting, worst_margin_physical=[p[0] for p in pairs], margin_unit=[p[1] for p in pairs])
    prov = body.pop("provenance")
    prov.setdefault("scenario_sha256", prov.get("scenario_hash"))
    return _envelope("ellipse", req, provider.name, prov, limits=_ellipse_limits(scenario, provider, res), **body)


def search_job(req: dict[str, Any], ctx: JobContext) -> dict[str, Any]:
    scenario = _scenario(req)
    provider = get_provider(req["terrain"], stores=scenario.terrain_stores)
    res = run_search(req, scenario, provider, ctx.progress)
    body = res.to_dict(with_grid=req["with_grid"])
    active = scenario.constraints.active()
    for site in body["sites"]:
        lim = active.get(site["limiting"])
        wm = site["worst_margin"]
        site["worst_margin_physical"] = None if lim is None or wm is None else wm * lim.margin_scale
        site["margin_unit"] = None if lim is None else lim.unit
    prov = body.pop("provenance")
    prov.setdefault("scenario_sha256", prov.get("scenario_hash"))
    return _envelope("search", req, provider.name, prov, limits=_search_limits(scenario, provider, res), **body)


def _file_entry(digest: str, path: Path) -> dict[str, Any]:
    blob = path.read_bytes()
    media = "image/tiff" if path.suffix == ".tif" else "application/json"
    return {"name": path.name, "media_type": media, "size_bytes": len(blob), "sha256": hashlib.sha256(blob).hexdigest(),
            "url": f"/api/v1/exports/files/{digest}/{path.name}"}


def _layer_stats(arr: np.ndarray) -> dict[str, Any]:
    finite = np.isfinite(arr) if arr.dtype.kind == "f" else np.ones(arr.shape, bool)
    vals = arr[finite]
    out: dict[str, Any] = {"dtype": str(arr.dtype), "n_nodata": int(arr.size - vals.size)}
    if vals.size:
        out.update(min=float(vals.min()), max=float(vals.max()), mean=float(vals.mean()))
    else:
        out.update(min=None, max=None, mean=None)
    return out


def _support_warnings(arrays: dict[str, Any], support: dict[str, dict[str, Any]]) -> list[str]:
    """One warning per bracket-only layer whose bracket layers were not computed (its value must not be shown alone)."""
    return [
        f"layer {name!r} is bracket-only: its point value must not be shown alone; the layers "
        f"{rec['bracket_layers']} were not computed (request bounds=true)"
        for name, rec in support.items()
        if rec["point_value"] == "bracket_only" and not all(b in arrays for b in rec["bracket_layers"])
    ]


def regional_job(req: dict[str, Any], ctx: JobContext) -> dict[str, Any]:
    from lunarnav.regional import RegionSpec, compute_layers, verdict_layer, write_geotiff
    from lunarnav.terrain import TerrainStack

    root = data_dir() / "dem" / "store"
    try:
        stack = TerrainStack.open(dem_ids=req.get("dem_ids"), root=root)
    except (FileNotFoundError, KeyError, ValueError) as exc:
        raise RequestError(f"terrain stores unavailable: {exc}") from exc
    if not stack.stores:
        raise RequestError(f"no terrain stores under {root}; the regional layers need a DEM")
    spec = _guard(lambda: RegionSpec.centred(
        req["lat_deg"], req["lon_deg"], req["size_m"], req["spacing_m"], req["start_utc"], req["stop_utc"],
        mast_height_m=req["mast_height_m"], sun_rule=req["sun_rule"], earth_rule=req["earth_rule"],
        earth_margin_deg=req["earth_margin_deg"], dem_ids=None if req.get("dem_ids") is None else tuple(req["dem_ids"]),
        step_s=req["step_s"], name=req.get("name", "")))
    digest = export_digest(req)
    out = export_root() / digest
    work = out / "work"
    work.mkdir(parents=True, exist_ok=True)

    def progress(done: int, total: int) -> None:
        ctx.progress(0.02 + 0.9 * done / max(total, 1), f"tile {done}/{total}")

    threads = max(1, int(os.environ.get("NUMBA_NUM_THREADS", "2")))
    ctx.progress(0.01, f"{spec.n_cells} cells x {spec.n_epochs} epochs")
    layers = _guard(lambda: compute_layers(
        spec, stack, out_dir=work, bounds=req["bounds"], calibrate=req["calibrate"], do_earth=req["do_earth"],
        threads=threads, progress=progress))
    ctx.progress(0.93, "writing GeoTIFFs")
    arrays = dict(layers.layers)
    limits = {k: (v["op"], v["value"]) for k, v in (req.get("limits") or {}).items()}
    if limits:
        missing = [k for k in limits if k not in arrays]
        if missing:
            raise RequestError(f"limits refer to unknown layers {missing}; available: {sorted(arrays)}")
        arrays["verdict"] = _guard(lambda: verdict_layer(layers, limits))
    header_support = layers.header.get("layer_support", {})
    support = {n: header_support[n] for n in arrays if n in header_support}
    infos: list[dict[str, Any]] = []
    files: list[dict[str, Any]] = []
    for name, arr in arrays.items():
        path = out / f"{name}.tif"
        write_geotiff(path, arr, spec, description=name, support=support.get(name))
        entry = _file_entry(digest, path)
        files.append(entry)
        info = {"name": name, "support": support.get(name), "file": entry, **_layer_stats(arr)}
        infos.append(info)
    from lunarnav.api.json import dumps

    header_path = out / "header.json"
    header_path.write_bytes(dumps(layers.header))
    files.append(_file_entry(digest, header_path))
    inline = {}
    for name in req.get("inline", []):
        if name not in arrays:
            raise RequestError(f"inline refers to unknown layer {name!r}; available: {sorted(arrays)}")
        inline[name] = np.where(np.isfinite(arrays[name]), arrays[name], np.nan).tolist() if arrays[name].dtype.kind == "f" \
            else arrays[name].tolist()
    shutil.rmtree(work, ignore_errors=True)
    ctx.progress(0.99, "finishing")
    return {
        "kind": "regional", "warnings": _support_warnings(arrays, support), "spec": {
            "x0_m": spec.x0_m, "y0_m": spec.y0_m, "n_rows": spec.n_rows, "n_cols": spec.n_cols, "spacing_m": spec.spacing_m,
            "start_utc": spec.start_utc, "stop_utc": spec.stop_utc, "step_s": spec.step_s,
            "mast_height_m": spec.mast_height_m, "pole": spec.pole, "sun_rule": spec.sun_rule,
            "earth_rule": spec.earth_rule, "earth_margin_deg": spec.earth_margin_deg, "n_epochs": spec.n_epochs},
        "geotransform": list(spec.geotransform()), "layers": infos, "files": files, "inline": inline,
        "layer_support": support,
        "header": layers.header, "provenance": {"stack_sha256": stack.stack_hash, "dem_ids": list(stack.dem_ids), "code": code_version(),
                       "package_source_sha256": source_sha256()},
    }
