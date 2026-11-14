"""Layer output: GeoTIFFs (polar stereographic CRS), raw little-endian arrays and a JSON header."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.transform import Affine

from lunarnav.regional.grid import PROJ4, RegionSpec
from lunarnav.regional.support import layer_support

RAW_DTYPES = {"float32": "<f4", "uint8": "u1", "int8": "i1"}


def _dtype_name(a: np.ndarray) -> str:
    return {np.dtype(np.float32): "float32", np.dtype(np.uint8): "uint8", np.dtype(np.int8): "int8"}[a.dtype]


def _tags(sup: dict) -> dict[str, str]:
    """GeoTIFF band tags of a support record (``support.layer_support`` / ``support_table``)."""
    tags = {"POINT_VALUE": sup["point_value"], "UNIT": sup["unit"], "NOTE": sup["note"]}
    if sup.get("error_unit"):
        tags["ERROR_UNIT"] = sup["error_unit"]
    if sup["bracket_layers"]:
        tags["BRACKET_LAYERS"] = ",".join(sup["bracket_layers"])
    run = sup.get("run_measured_error")
    if run:
        tags.update({f"MEASURED_ERROR_{k.upper()}": f"{v:g}" for k, v in run.items() if k in ("mean_abs", "p95_abs", "max_abs", "mean_signed")})
        tags["MEASURED_ERROR_CELLS"] = str(run["n_cells"])
        tags["MEASURED_ON"] = sup["run_measured_on"]
    elif sup["point_value"] != "exact_input":
        tags["MEASURED_ON"] = "not measured in this run (calibration cells: 0)"
    val = sup.get("validation")
    if val:
        cov = val["bracket_coverage"]
        tags.update({
            "VALIDATION_CONFIGURATION": val["configuration"], "VALIDATION_APPLIES": {None: "unknown", True: "true", False: "false"}[val["applies_to_run"]],
            "VALIDATION_BRACKET_COVERAGE": f"{cov['coverage']:.4f}", "VALIDATION_BRACKET_MISSES": str(cov["misses"]),
            "VALIDATION_CELLS": str(cov["cells"]),
        })
        if val.get("measured_error"):
            tags.update({f"VALIDATION_ERROR_{k.upper()}": f"{v:g}" for k, v in val["measured_error"].items() if k in ("mean_abs", "p95_abs", "max_abs")})
    return tags


def write_geotiff(path: str | Path, arr: np.ndarray, spec: RegionSpec, description: str = "", support: dict | None = None) -> None:
    """Single-band north-up GeoTIFF in the polar stereographic CRS of the LOLA products (NaN no-data for floats).

    ``support``: the layer's support record of the run (``header["layer_support"][name]``); default: the static record of
    ``support.layer_support`` (no run measurement, validation record of the reference configuration)."""
    gt = spec.geotransform()
    nodata = float("nan") if arr.dtype.kind == "f" else (-128 if arr.dtype == np.int8 else None)
    with rasterio.open(
        path, "w", driver="GTiff", height=arr.shape[0], width=arr.shape[1], count=1, dtype=arr.dtype,
        crs=CRS.from_string(PROJ4[spec.pole]), transform=Affine(gt[1], gt[2], gt[0], gt[4], gt[5], gt[3]), nodata=nodata,
        compress="deflate", tiled=True, blockxsize=256, blockysize=256,
    ) as dst:
        dst.write(arr, 1)
        if description:
            dst.update_tags(1, DESCRIPTION=description)
            sup = support if support is not None else layer_support(description)
            if sup is not None:
                dst.update_tags(1, **_tags(sup))


def write_all(result, out_dir: str | Path) -> None:
    """``out_dir/geotiff/<layer>.tif``, ``out_dir/raw/<layer>.<dtype>`` and ``out_dir/header.json``.

    Files of an earlier run in the same directory that are not layers of this result are removed, so the directory always
    matches its header."""
    out_dir = Path(out_dir)
    (out_dir / "geotiff").mkdir(parents=True, exist_ok=True)
    (out_dir / "raw").mkdir(parents=True, exist_ok=True)
    files = {}
    keep = set()
    for name, arr in result.layers.items():
        write_geotiff(out_dir / "geotiff" / f"{name}.tif", arr, result.spec, name, result.header.get("layer_support", {}).get(name))
        dn = _dtype_name(arr)
        raw = out_dir / "raw" / f"{name}.{dn}"
        np.ascontiguousarray(arr).astype(RAW_DTYPES[dn]).tofile(raw)
        keep |= {out_dir / "geotiff" / f"{name}.tif", raw}
        files[name] = {"raw": f"raw/{name}.{dn}", "geotiff": f"geotiff/{name}.tif", "dtype": RAW_DTYPES[dn],
                       "shape": list(arr.shape), "order": "C, row 0 = north"}
    for sub in ("geotiff", "raw"):
        for f in (out_dir / sub).iterdir():
            if f.is_file() and f not in keep:
                f.unlink()
    result.header["files"] = files
    (out_dir / "header.json").write_text(json.dumps(result.header, indent=1, default=str))


def read_raw(out_dir: str | Path, name: str) -> np.ndarray:
    """Load a layer written by ``write_all`` through its JSON header."""
    out_dir = Path(out_dir)
    h = json.loads((out_dir / "header.json").read_text())["files"][name]
    return np.fromfile(out_dir / h["raw"], dtype=h["dtype"]).reshape(h["shape"])
