"""Convert downloaded LOLA products into canonical stores and record a provenance manifest.

Command line::

    python -m lunarnav.terrain.ingest build lola_60s_240m [dem_id ...]
    python -m lunarnav.terrain.ingest build --all
    python -m lunarnav.terrain.ingest build-err --all   # PGDA per-pixel uncertainty layers
    python -m lunarnav.terrain.ingest manifest
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window

from lunarnav.constants import R_MOON_M
from lunarnav.terrain.paths import raw_dir, store_dir
from lunarnav.terrain.pds import label_float, label_int, parse_label
from lunarnav.terrain.projection import EQUIRECT, POLAR, GridGeometry
from lunarnav.terrain.sources import ALL_PRODUCTS, BY_ID, PROJECTION_CATALOGS, Product, fetch
from lunarnav.terrain.store import (
    ERR_LAYER_FILE,
    ERR_LAYER_INFO,
    RowReader,
    SourceInfo,
    TerrainStore,
    build_store,
    sha256_file,
)

GDR_POLAR_SX = +1
GDR_POLAR_SY = -1


def gdr_polar_geometry(label: dict, pole: int) -> GridGeometry:
    """Geometry of a LOLA polar GDR from its label (pixel-centre registration, grid symmetric about the pole)."""
    n_r, n_c = label_int(label, "LINES"), label_int(label, "LINE_SAMPLES")
    s = label_float(label, "MAP_SCALE")
    if label["MAP_PROJECTION_TYPE"] != "POLAR STEREOGRAPHIC":
        raise ValueError("not a polar stereographic product")
    for key in ("A_AXIS_RADIUS", "B_AXIS_RADIUS", "C_AXIS_RADIUS"):
        if abs(label_float(label, key) * 1000.0 - R_MOON_M) > 1e-6:
            raise ValueError(f"{key} is not the LOLA reference radius")
    dx, dy = GDR_POLAR_SX * s, GDR_POLAR_SY * s
    return GridGeometry(POLAR, pole, R_MOON_M, -dx * (n_c - 1) / 2.0, -dy * (n_r - 1) / 2.0, dx, dy, n_c, n_r)


def gdr_cyl_geometry(label: dict) -> GridGeometry:
    """Geometry of a LOLA cylindrical GDR: pixel-centre registration, longitude 0..360 east."""
    n_r, n_c = label_int(label, "LINES"), label_int(label, "LINE_SAMPLES")
    ppd = label_float(label, "MAP_RESOLUTION")
    if label["MAP_PROJECTION_TYPE"] != "SIMPLE CYLINDRICAL":
        raise ValueError("not a cylindrical product")
    clon = label_float(label, "CENTER_LONGITUDE")
    spo = label_float(label, "SAMPLE_PROJECTION_OFFSET")
    lpo = label_float(label, "LINE_PROJECTION_OFFSET")
    lon0 = clon + (1 - spo - 1) / ppd
    lat0 = 0.0 - (1 - lpo - 1) / ppd
    return GridGeometry(EQUIRECT, 0, R_MOON_M, lon0, lat0, 1.0 / ppd, -1.0 / ppd, n_c, n_r, periodic=n_c * (1.0 / ppd) >= 359.999)


def img_reader(path: Path, label: dict) -> RowReader:
    """Row reader for a 16-bit PDS IMG: height = DN * SCALING_FACTOR (metres above the 1737.4 km sphere)."""
    if label.get("SAMPLE_TYPE") != "LSB_INTEGER" or label.get("SAMPLE_BITS") != "16":
        raise ValueError(f"unsupported IMG sample format {label.get('SAMPLE_TYPE')}/{label.get('SAMPLE_BITS')}")
    nr, nc = label_int(label, "LINES"), label_int(label, "LINE_SAMPLES")
    scale = label_float(label, "SCALING_FACTOR")
    dn = np.memmap(path, np.dtype("<i2"), "r", shape=(nr, nc))

    def read_rows(r0: int, r1: int) -> np.ndarray:
        return (np.asarray(dn[r0:r1], dtype=np.float32) * np.float32(scale)).astype(np.float32)

    return read_rows


def tif_geometry(path: Path) -> GridGeometry:
    """Geometry of a PGDA south-polar GeoTIFF (GMT pixel registration: bounds are pixel edges)."""
    with rasterio.open(path) as ds:
        t = ds.transform
        wkt = ds.crs.to_wkt()
        if "Polar_Stereographic" not in wkt or '"latitude_of_origin",-90' not in wkt:
            raise ValueError(f"{path}: not a south polar stereographic GeoTIFF")
        if t.b != 0 or t.d != 0:
            raise ValueError(f"{path}: rotated raster")
        return GridGeometry(POLAR, -1, R_MOON_M, t.c + t.a / 2.0, t.f + t.e / 2.0, t.a, t.e, ds.width, ds.height)


def tif_reader(path: Path) -> RowReader:
    ds = rasterio.open(path)

    def read_rows(r0: int, r1: int) -> np.ndarray:
        return ds.read(1, window=Window(0, r0, ds.width, r1 - r0), masked=False).astype(np.float32)

    return read_rows


def build_product(product: Product, root: Path | None = None) -> TerrainStore:
    """Build the store for one registered product."""
    root = root or store_dir()
    sha = sha256_file(product.path)
    if product.kind == "pgda_tif":
        geom = tif_geometry(product.path)
        reader = tif_reader(product.path)
        with rasterio.open(product.path) as ds:
            label = dict(ds.tags())
            label["crs_wkt"] = ds.crs.to_wkt()
        desc = f"PGDA product 78 (Barker et al. 2021) adjusted LOLA LDEM, {product.dem_id}"
        pixel = abs(geom.dx)
        notes = product.notes + "; GMT node_offset=1 (pixel registration): GeoTIFF bounds are pixel edges"
    else:
        label = parse_label(product.label_path)  # type: ignore[arg-type]
        reader = img_reader(product.path, label)
        geom = gdr_cyl_geometry(label) if product.kind == "gdr_cyl" else gdr_polar_geometry(label, product.pole)
        desc = f"LOLA GDR {label.get('PRODUCT_ID', product.local)} ({label.get('DATA_SET_ID')})"
        pixel = label_float(label, "MAP_SCALE")
        notes = "scaling factor and offset applied: height = DN * SCALING_FACTOR above the 1737.4 km sphere"
    src = SourceInfo(description=desc, url=product.url, sha256=sha, label=label, pixel_size_m=pixel, notes=notes)
    return build_store(root, product.dem_id, geom, reader, src)


def build_error_layer(product: Product, root: Path | None = None) -> dict:
    """Write the PGDA ``*_toterr.tif`` of ``product`` as ``err_toterr.f32`` beside the store's heights.

    The companion must share the height raster's geometry exactly.  A sidecar ``err_toterr.json`` records the URL,
    SHA-256 and the layer's median / 95th percentile / valid fraction (the tile median is the fallback sigma_z when
    the layer is absent).  ``meta.json`` is untouched, so no store hash changes.  Returns the sidecar dict.
    """
    root = root or store_dir()
    if product.err_path is None or not product.err_path.exists():
        raise FileNotFoundError(f"{product.dem_id}: error raster not downloaded (ingest fetch {product.dem_id})")
    geom = tif_geometry(product.err_path)
    if geom != tif_geometry(product.path):
        raise ValueError(f"{product.err_path}: geometry differs from {product.path}")
    out_dir = root / product.dem_id
    arr = np.memmap(out_dir / ERR_LAYER_FILE, dtype="<f4", mode="w+", shape=(geom.nrows, geom.ncols))
    read = tif_reader(product.err_path)
    step = 256
    for r0 in range(0, geom.nrows, step):
        arr[r0 : r0 + step] = read(r0, min(r0 + step, geom.nrows))
    arr.flush()
    valid = np.asarray(arr)[np.isfinite(arr) & (arr > 0)]
    info = {
        "url": product.err_url,
        "file": product.err_local,
        "sha256": sha256_file(product.err_path),
        "median_m": float(np.median(valid)),
        "p95_m": float(np.percentile(valid, 95)),
        "max_m": float(valid.max()),
        "valid_fraction": float(valid.size / arr.size),
        "meaning": "PGDA product 78 *_toterr.tif: total height uncertainty per pixel, formally the RMS error (m)",
    }
    (out_dir / ERR_LAYER_INFO).write_text(json.dumps(info, indent=1))
    del arr
    return info


def write_manifest(path: Path | None = None) -> dict:
    """Write ``data/dem/raw/manifest.json``: URL, size, SHA-256 and label of every downloaded product."""
    path = path or raw_dir() / "manifest.json"
    entries = []
    for p in ALL_PRODUCTS:
        if not p.path.exists():
            continue
        e = {"dem_id": p.dem_id, "url": p.url, "file": p.local, "bytes": p.path.stat().st_size, "sha256": sha256_file(p.path)}
        if p.label_path is not None and p.label_path.exists():
            e["label_url"] = p.label_url
            e["label_sha256"] = sha256_file(p.label_path)
            e["label"] = parse_label(p.label_path)
        if p.err_path is not None and p.err_path.exists():
            e["err_url"] = p.err_url
            e["err_file"] = p.err_local
            e["err_bytes"] = p.err_path.stat().st_size
            e["err_sha256"] = sha256_file(p.err_path)
        entries.append(e)
    extra = []
    for url in PROJECTION_CATALOGS:
        f = raw_dir() / "lola_gdr" / Path(url).name
        if f.exists():
            extra.append({"url": url, "file": f"lola_gdr/{f.name}", "sha256": sha256_file(f)})
    readme = raw_dir() / "pgda78" / "README"
    if readme.exists():
        extra.append({"url": "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/README", "file": "pgda78/README", "sha256": sha256_file(readme)})
    manifest = {"created_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "products": entries, "documents": extra}
    path.write_text(json.dumps(manifest, indent=1))
    return manifest


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("dem_ids", nargs="*")
    b.add_argument("--all", action="store_true")
    f = sub.add_parser("fetch", help="download missing raw files (resumable)")
    f.add_argument("dem_ids", nargs="*")
    f.add_argument("--all", action="store_true")
    e = sub.add_parser("build-err", help="write PGDA per-pixel uncertainty layers beside built stores")
    e.add_argument("dem_ids", nargs="*")
    e.add_argument("--all", action="store_true")
    sub.add_parser("manifest")
    args = ap.parse_args(argv)
    if args.cmd == "fetch":
        for i in [p.dem_id for p in ALL_PRODUCTS] if args.all else args.dem_ids:
            print(f"{i}: {fetch(BY_ID[i])}", flush=True)
        return
    if args.cmd == "manifest":
        write_manifest()
        return
    if args.cmd == "build-err":
        for i in [p.dem_id for p in ALL_PRODUCTS if p.err_url] if args.all else args.dem_ids:
            info = build_error_layer(BY_ID[i])
            print(f"{i}: median {info['median_m']:.3f} m, p95 {info['p95_m']:.3f} m, valid {info['valid_fraction']:.3f}", flush=True)
        return
    ids = [p.dem_id for p in ALL_PRODUCTS if p.path.exists()] if args.all else args.dem_ids
    for i in ids:
        t0 = time.time()
        st = build_product(BY_ID[i])
        print(f"{i}: {st.geometry.nrows}x{st.geometry.ncols}, {st.n_levels} levels, {time.time() - t0:.0f} s", flush=True)


if __name__ == "__main__":
    main()
