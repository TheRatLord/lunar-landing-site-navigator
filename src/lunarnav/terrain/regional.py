"""On-demand regional terrain: cut a window out of the public 512 pixel/degree LOLA-based tiles.

Products (all heights above the 1737.4 km sphere, MEAN EARTH/POLAR AXIS OF DE421 frame, planetocentric,
east-positive, pixel registered, 512 pixel/degree = 59.2 m at the equator; verified against the PDS3 labels):

``sldem2015_512``
    SLDEM2015, the LOLA + Kaguya Terrain Camera merge (Barker et al. 2016, Icarus 273, 346-355,
    doi:10.1016/j.icarus.2016.02.052 [UNVERIFIED: recalled, not fetched]); latitudes within +-60 deg;
    float32 kilometres; 8 x 4 tiles of 30 x 45 deg (1.4 GB each) under
    https://imbrium.mit.edu/DATA/SLDEM2015/TILES/FLOAT_IMG/.
``ldem_512``
    LOLA-only GDR LDEM_512 (global); int16, 0.5 m per count; 4 x 4 tiles of 45 x 90 deg (2.1 GB each) under
    https://imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG/.

The tiles are far too large to keep, so only the window needed is fetched with HTTP range requests (one per
tile row), written to ``data/dem/raw/regional/<id>.f32`` with a JSON sidecar (URLs, ETags, label hashes, SHA-256
of the window, retrieval time), re-verified by re-fetching a sample of rows over fresh connections, and then
built into an ordinary store in ``data/dem/store/<id>`` that :meth:`TerrainStack.open` picks up.  The servers
publish no checksum files, so the SHA-256 recorded is of our window; the integrity checks are the byte-count
match against the label, the range-response length checks, and the repeat-fetch comparison.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import httpx
import numpy as np

from lunarnav.constants import R_MOON_M
from lunarnav.terrain.paths import raw_dir, store_dir
from lunarnav.terrain.pds import label_float, label_int, parse_label
from lunarnav.terrain.projection import EQUIRECT, GridGeometry
from lunarnav.terrain.store import SourceInfo, TerrainStore, build_store

PPD = 512
VERIFY_ROWS = 8
M_PER_DEG = R_MOON_M * math.pi / 180.0


@dataclass(frozen=True, slots=True)
class TiledProduct:
    """A cylindrical product published as a grid of tiles."""

    key: str
    description: str
    base_url: str
    lat_limit: float
    tile_lat: float
    tile_lon: float
    dtype: str
    scale_m: float
    sample_type: str

    def tile_names(self, lat_band: int, lon0: int) -> str:
        """File stem (no extension) of the tile whose south-west corner is ``(lat_band, lon0)`` degrees."""
        lat_lo, lat_hi = lat_band, lat_band + int(self.tile_lat)

        def lat_s(v: int, south: bool) -> str:
            return f"{abs(v):02d}{'S' if south else 'N'}"

        if self.key == "sldem2015_512":
            a, b = (lat_s(lat_lo, lat_lo < 0), lat_s(lat_hi, lat_hi <= 0))
            if lat_lo < 0:
                a, b = lat_s(lat_lo, True), lat_s(lat_hi, True if lat_hi < 0 else False)
                b = "00S" if lat_hi == 0 else b
            return f"SLDEM2015_512_{a}_{b}_{lon0:03d}_{lon0 + int(self.tile_lon):03d}_FLOAT"
        a, b = lat_s(lat_lo, lat_lo < 0), lat_s(lat_hi, lat_hi <= 0)
        b = "00S" if (lat_hi == 0) else b
        return f"LDEM_512_{a}_{b}_{lon0:03d}_{lon0 + int(self.tile_lon):03d}"


PRODUCTS: dict[str, TiledProduct] = {
    "sldem2015_512": TiledProduct(
        "sldem2015_512", "SLDEM2015 (LOLA + Kaguya TC) 512 ppd", "https://imbrium.mit.edu/DATA/SLDEM2015/TILES/FLOAT_IMG",
        60.0, 30.0, 45.0, "<f4", 1000.0, "PC_REAL",
    ),
    "ldem_512": TiledProduct(
        "ldem_512", "LOLA GDR LDEM_512", "https://imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG",
        90.0, 45.0, 90.0, "<i2", 0.5, "LSB_INTEGER",
    ),
}  # fmt: skip


def regional_raw_dir() -> Path:
    return raw_dir() / "regional"


def region_id(product: str, lat_deg: float, lon_deg: float, radius_km: float) -> str:
    """Directory name of a region's store, e.g. ``sldem2015_512_n18.562_e061.810_r50km``."""
    return f"{product}_{'n' if lat_deg >= 0 else 's'}{abs(lat_deg):06.3f}_e{lon_deg % 360.0:07.3f}_r{radius_km:g}km"


def choose_product(lat_deg: float, radius_km: float) -> str:
    """SLDEM2015 when the whole window is inside +-60 deg latitude, otherwise LOLA-only LDEM_512."""
    dlat = radius_km * 1000.0 / M_PER_DEG
    return "sldem2015_512" if abs(lat_deg) + dlat <= PRODUCTS["sldem2015_512"].lat_limit else "ldem_512"


def window_for(lat_deg: float, lon_deg: float, radius_km: float) -> tuple[int, int, int, int]:
    """Global-lattice window ``(row0, row1, col0, col1)`` (end exclusive) covering the disc, with 2 pixels margin.

    Rows count from 90 N; columns count east from longitude 0 and may exceed the 360 deg width (wrap).
    """
    dlat = radius_km * 1000.0 / M_PER_DEG
    cos_lat = math.cos(math.radians(min(abs(lat_deg) + dlat, 89.0)))
    dlon = min(dlat / cos_lat, 180.0)
    r0 = int(math.floor((90.0 - (lat_deg + dlat)) * PPD)) - 2
    r1 = int(math.ceil((90.0 - (lat_deg - dlat)) * PPD)) + 2
    c0 = int(math.floor((lon_deg - dlon) * PPD)) - 2
    c1 = int(math.ceil((lon_deg + dlon) * PPD)) + 2
    return max(r0, 0), min(r1, 180 * PPD), c0, c1


def _tiles_covering(p: TiledProduct, rows: tuple[int, int], cols: tuple[int, int]) -> list[tuple[str, int, int, int, int]]:
    """Tiles overlapping the window: ``(stem, win_row0, win_col0, tile_row0, tile_col0)`` of each overlap origin."""
    out = []
    tile_rows, tile_cols = int(p.tile_lat * PPD), int(p.tile_lon * PPD)
    for r in range(rows[0] // tile_rows, (rows[1] - 1) // tile_rows + 1):
        lat_top = 90 - r * int(p.tile_lat)
        for c in range(math.floor(cols[0] / tile_cols), math.floor((cols[1] - 1) / tile_cols) + 1):
            lon0 = (c * int(p.tile_lon)) % 360
            out.append((p.tile_names(lat_top - int(p.tile_lat), lon0), r, c, r * tile_rows, c * tile_cols))
    return out


def _get(client: httpx.Client, url: str, byte_range: tuple[int, int] | None = None, tries: int = 4) -> httpx.Response:
    headers = {"Range": f"bytes={byte_range[0]}-{byte_range[1]}"} if byte_range else {}
    for k in range(tries):
        try:
            r = client.get(url, headers=headers, timeout=60.0, follow_redirects=True)
            if byte_range:
                expected = byte_range[1] - byte_range[0] + 1
                if r.status_code != 206 or len(r.content) != expected:
                    raise httpx.HTTPError(f"range request {byte_range} returned {r.status_code}, {len(r.content)} B")
            else:
                r.raise_for_status()
            return r
        except httpx.HTTPError:
            if k == tries - 1:
                raise
            time.sleep(1.0 + k)
    raise AssertionError("unreachable")


def _fetch_label(client: httpx.Client, p: TiledProduct, stem: str) -> tuple[dict, str]:
    """Download (once) and parse a tile label; returns ``(label dict, sha256 of the label file)``."""
    path = regional_raw_dir() / "labels" / f"{stem}.LBL"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(_get(client, f"{p.base_url}/{stem}.LBL").content)
    return parse_label(path), hashlib.sha256(path.read_bytes()).hexdigest()


def _check_label(p: TiledProduct, label: dict, stem: str, lat_top: int, lon0: int) -> None:
    ok = (
        label.get("SAMPLE_TYPE") == p.sample_type
        and abs(label_float(label, "MAP_RESOLUTION") - PPD) < 1e-9
        and all(abs(label_float(label, k) * 1000.0 - R_MOON_M) < 1e-6 for k in ("A_AXIS_RADIUS", "B_AXIS_RADIUS", "C_AXIS_RADIUS"))
        and abs(label_float(label, "OFFSET") * (1000.0 if p.dtype == "<f4" else 1.0) - R_MOON_M) < 1e-6
        and abs(label_float(label, "MAXIMUM_LATITUDE") - lat_top) < 1e-9
        and abs(label_float(label, "WESTERNMOST_LONGITUDE") - lon0) < 1e-9
        and "DE421" in label.get("COORDINATE_SYSTEM_NAME", "")
    )
    if not ok:
        raise ValueError(f"{stem}: label does not match the expected product definition")
    if p.dtype == "<i2" and abs(label_float(label, "SCALING_FACTOR") - p.scale_m) > 1e-12:
        raise ValueError(f"{stem}: unexpected scaling factor {label_float(label, 'SCALING_FACTOR')}")


def _read_rows(client_factory, url: str, itemsize: int, row_bytes: int, rows: list[int], c0: int, c1: int, workers: int) -> np.ndarray:
    """Fetch ``rows`` x columns ``[c0, c1)`` of a tile with one range request per row."""
    width = (c1 - c0) * itemsize

    def one(r: int) -> bytes:
        with client_factory() as cl:
            a = r * row_bytes + c0 * itemsize
            return _get(cl, url, (a, a + width - 1)).content

    if workers <= 1:
        blobs = [one(r) for r in rows]
    else:
        with ThreadPoolExecutor(workers) as ex:
            blobs = list(ex.map(one, rows))
    return np.frombuffer(b"".join(blobs), dtype=np.uint8)


def fetch_region(
    lat_deg: float,
    lon_deg: float,
    radius_km: float = 50.0,
    product: str = "auto",
    root: str | Path | None = None,
    client_factory=None,
    workers: int = 8,
) -> TerrainStore:
    """Fetch the window of ``radius_km`` around a point, verify it and build/refresh its store.

    Returns the opened :class:`TerrainStore` (``root`` defaults to ``data/dem/store``).  Idempotent: an existing
    complete store for the same ``(product, point, radius)`` is returned unchanged.  ``client_factory`` returns a
    new ``httpx.Client`` (tests inject a local server; default: plain ``httpx.Client``).
    """
    key = choose_product(lat_deg, radius_km) if product == "auto" else product
    p = PRODUCTS[key]
    rid = region_id(key, lat_deg, lon_deg, radius_km)
    out_root = Path(root) if root else store_dir()
    if (out_root / rid / "meta.json").exists():
        return TerrainStore(out_root / rid)
    dlat = radius_km * 1000.0 / M_PER_DEG
    if abs(lat_deg) + dlat > p.lat_limit:
        raise ValueError(f"{key} covers |latitude| <= {p.lat_limit:g} deg; the window reaches {abs(lat_deg) + dlat:.2f}")
    factory = client_factory or (lambda: httpx.Client())
    r0, r1, c0, c1 = window_for(lat_deg, lon_deg, radius_km)
    nr, nc = r1 - r0, c1 - c0
    tile_rows, tile_cols = int(p.tile_lat * PPD), int(p.tile_lon * PPD)
    itemsize = np.dtype(p.dtype).itemsize
    row_bytes = tile_cols * itemsize
    grid = np.empty((nr, nc), dtype=np.float32)
    tiles_meta = []
    with factory() as client:
        for stem, tr, tc, _, _ in _tiles_covering(p, (r0, r1), (c0, c1)):
            lat_top = 90 - tr * int(p.tile_lat)
            lon0 = (tc * int(p.tile_lon)) % 360
            label, label_sha = _fetch_label(client, p, stem)
            _check_label(p, label, stem, lat_top, lon0)
            url = f"{p.base_url}/{stem}.IMG"
            head = client.head(url, follow_redirects=True, timeout=60.0)
            head.raise_for_status()
            size = int(head.headers["content-length"])
            if size != label_int(label, "LINES") * row_bytes or label_int(label, "LINE_SAMPLES") != tile_cols:
                raise ValueError(f"{stem}: file size {size} B does not match the label")
            rr0, rr1 = max(r0, tr * tile_rows), min(r1, (tr + 1) * tile_rows)
            cc0, cc1 = max(c0, tc * tile_cols), min(c1, (tc + 1) * tile_cols)
            rows = list(range(rr0 - tr * tile_rows, rr1 - tr * tile_rows))
            raw = _read_rows(factory, url, itemsize, row_bytes, rows, cc0 - tc * tile_cols, cc1 - tc * tile_cols, workers)
            block = raw.view(p.dtype).reshape(len(rows), cc1 - cc0)
            grid[rr0 - r0 : rr1 - r0, cc0 - c0 : cc1 - c0] = block.astype(np.float32) * np.float32(p.scale_m)
            rng = np.random.default_rng(0)
            pick = [int(i) for i in rng.choice(len(rows), size=min(VERIFY_ROWS, len(rows)), replace=False)]
            again = _read_rows(factory, url, itemsize, row_bytes, [rows[i] for i in pick], cc0 - tc * tile_cols, cc1 - tc * tile_cols, 1)
            if not np.array_equal(again.reshape(len(pick), -1), raw.reshape(len(rows), -1)[pick]):
                raise ValueError(f"{stem}: repeat fetch of {len(pick)} rows differs from the first fetch")
            tiles_meta.append({
                "tile": stem, "url": url, "bytes": size, "etag": head.headers.get("etag"),
                "last_modified": head.headers.get("last-modified"), "label_sha256": label_sha,
                "window_rows": [rr0, rr1], "window_cols": [cc0, cc1], "verified_rows": len(pick),
            })  # fmt: skip
    if np.any(~np.isfinite(grid)):
        raise ValueError("the window contains non-finite samples")
    cut_dir = regional_raw_dir()
    cut_dir.mkdir(parents=True, exist_ok=True)
    cut = cut_dir / f"{rid}.f32"
    grid.astype("<f4").tofile(cut)
    sha = hashlib.sha256(cut.read_bytes()).hexdigest()
    meta = {
        "id": rid, "product": key, "centre": [lat_deg, lon_deg], "radius_km": radius_km, "window": [r0, r1, c0, c1],
        "shape": [nr, nc], "sha256": sha, "tiles": tiles_meta,
        "retrieved_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }  # fmt: skip
    (cut_dir / f"{rid}.json").write_text(json.dumps(meta, indent=1))
    geom = GridGeometry(
        EQUIRECT, 0, R_MOON_M, (c0 + 0.5) / PPD, 90.0 - (r0 + 0.5) / PPD, 1.0 / PPD, -1.0 / PPD, nc, nr, periodic=False
    )
    src = SourceInfo(
        description=f"{p.description}: {radius_km:g} km window about ({lat_deg:.4f}, {lon_deg:.4f})",
        url=";".join(t["url"] for t in tiles_meta), sha256=sha, label={"tiles": tiles_meta},
        pixel_size_m=M_PER_DEG / PPD,
        notes="window fetched by HTTP range requests; heights in metres above the 1737.4 km sphere (label OFFSET checked)",
    )  # fmt: skip

    def read_rows(a: int, b: int) -> np.ndarray:
        return np.asarray(grid[a:b])

    return build_store(out_root, rid, geom, read_rows, src)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Fetch a regional high-resolution terrain window and build its store.")
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lon", type=float, required=True, help="east longitude, degrees")
    ap.add_argument("--radius-km", type=float, default=50.0)
    ap.add_argument("--product", choices=["auto", *PRODUCTS], default="auto")
    args = ap.parse_args(argv)
    st = fetch_region(args.lat, args.lon, args.radius_km, args.product)
    print(f"{st.dem_id}: {st.geometry.nrows} x {st.geometry.ncols} px, {st.path}")


if __name__ == "__main__":
    main()
