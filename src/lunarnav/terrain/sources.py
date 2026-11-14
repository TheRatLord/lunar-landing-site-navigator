"""Registry of the LOLA products the store is built from, and a resumable downloader.

Every URL below was listed on the live servers (directory index of
https://imbrium.mit.edu/DATA/LOLA_GDR/ and the PGDA product page https://pgda.gsfc.nasa.gov/products/78)
and the labels were read before use; see ``docs/validation/terrain.md``.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import httpx

from lunarnav.terrain.paths import raw_dir

GDR_BASE = "https://imbrium.mit.edu/DATA/LOLA_GDR"
PGDA_BASE = "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp"
CATALOG_BASE = "https://imbrium.mit.edu/CATALOG"

PGDA_SITES = (
    "Site01", "Site04", "Site06", "Site07", "Site11", "Site20v2", "Site23", "Site42", "Haworth", "Shoemaker",
    "DM1", "DM2", "SL2", "SL3", "NPA", "NPB", "NPC", "NPD", "LM1", "LM2", "LM3", "LM4", "LM5", "LM6", "LM7", "LM8",
)  # fmt: skip


@dataclass(frozen=True, slots=True)
class Product:
    """One downloadable source product.

    ``kind``: ``gdr_polar`` (PDS3 IMG + LBL, polar stereographic), ``gdr_cyl`` (PDS3 IMG + LBL,
    cylindrical) or ``pgda_tif`` (GeoTIFF, south polar stereographic).
    """

    dem_id: str
    kind: str
    url: str
    local: str
    label_url: str | None = None
    pole: int = 0
    notes: str = ""
    err_url: str | None = None
    err_local: str | None = None

    @property
    def path(self) -> Path:
        return raw_dir() / self.local

    @property
    def err_path(self) -> Path | None:
        return raw_dir() / self.err_local if self.err_local else None

    @property
    def label_path(self) -> Path | None:
        return self.path.with_suffix(".LBL") if self.label_url else None


def _gdr_polar(name: str, pole: int) -> Product:
    return Product(
        dem_id=f"lola_{name.lower()}",
        kind="gdr_polar",
        url=f"{GDR_BASE}/POLAR/IMG/LDEM_{name}.IMG",
        label_url=f"{GDR_BASE}/POLAR/IMG/LDEM_{name}.LBL",
        local=f"lola_gdr/LDEM_{name}.IMG",
        pole=pole,
    )


def _pgda(site: str) -> Product:
    f = f"{site}_final_adj_5mpp_surf.tif"
    e = f"{site}_final_adj_5mpp_toterr.tif"
    return Product(
        dem_id=f"pgda78_{site.lower()}_5m",
        kind="pgda_tif",
        url=f"{PGDA_BASE}/{site}/{f}",
        local=f"pgda78/{f}",
        pole=-1,
        err_url=f"{PGDA_BASE}/{site}/{e}",
        err_local=f"pgda78/{e}",
        notes="Barker et al. 2021, track-adjusted 5 m/px LDEM",
    )


GLOBAL = Product(
    dem_id="lola_global_64ppd",
    kind="gdr_cyl",
    url=f"{GDR_BASE}/CYLINDRICAL/IMG/LDEM_64.IMG",
    label_url=f"{GDR_BASE}/CYLINDRICAL/IMG/LDEM_64.LBL",
    local="lola_gdr/LDEM_64.IMG",
)

SOUTH = tuple(_gdr_polar(n, -1) for n in ("60S_240M", "75S_120M", "75S_60M", "80S_20M", "85S_10M", "875S_5M"))
NORTH = tuple(_gdr_polar(n, +1) for n in ("60N_240M", "80N_20M", "85N_10M"))
PGDA = tuple(_pgda(s) for s in PGDA_SITES)
ALL_PRODUCTS: tuple[Product, ...] = (GLOBAL, *SOUTH, *NORTH, *PGDA)
BY_ID = {p.dem_id: p for p in ALL_PRODUCTS}

PROJECTION_CATALOGS = (f"{CATALOG_BASE}/DSMAP_POLAR.CAT", f"{CATALOG_BASE}/DSMAP.CAT")


Basis = Literal["published", "published-method", "measured", "assumed"]


@dataclass(frozen=True)
class ProductError:
    """Error budget of a terrain product: 1 sigma per axis, with where the figure comes from.

    ``sigma_z_m`` is the height error and ``sigma_xy_m`` the horizontal (geolocation) error.  ``basis_z`` / ``basis_xy`` (support of the vertical and of the horizontal figure, which can differ):
    ``"published"`` (``source`` quotes a publication about this very product), ``"published-method"`` (the same published
    method produced the product but no document states its figure; the figure of the documented sibling is used),
    ``"measured"`` (derived here by comparison against a better product, see ``docs/validation/terrain.md``) or
    ``"assumed"`` (nothing published or measured: the conservative global budget).
    """

    sigma_z_m: float
    sigma_xy_m: float
    basis_z: Basis
    basis_xy: Basis
    source: str
    note: str = ""


ASSUMED_ERROR = ProductError(
    4.0, 10.0, "assumed", "assumed", "global budget of scenario.models.TerrainErrorSettings (sigma_z 4 m, sigma_xy 10 m)",
    "no published figure for this product is recorded; the pessimistic global budget applies",
)  # fmt: skip

_RESEARCH = "docs/research/terrain-error.md"
_PGDA_PUBLISHED_TILES = ("pgda78_site01_5m", "pgda78_site04_5m", "pgda78_site07_5m", "pgda78_site11_5m")
_BARKER_2021 = (
    "Barker et al. 2021, Planetary and Space Science 203, 105119, doi:10.1016/j.pss.2020.105119 (abstract; Sec. 3.1; Sec. 4); "
    "open copy https://ntrs.nasa.gov/api/citations/20205009660/downloads/Mike%20Barker_%20Paper_%20Improved%20Lola.pdf; "
    "product page https://pgda.gsfc.nasa.gov/products/78; " + _RESEARCH + " Sec. 1"
)
_PGDA_PUBLISHED = ProductError(
    0.37, 0.14, "published", "published", _BARKER_2021,
    "sigma_z: median of the per-pixel total height uncertainty over Site01 (0.37 m; the four published sites have RoI medians "
    "0.30-0.50 m) applied to this tile; sigma_xy: X MADb of the track offsets after the last iteration (Y 0.12 m), a "
    "track-geolocation figure, not a pixel-position error. Excludes rocks and the +-30 % interpolation-method uncertainty; "
    "about 90 % of 5 m pixels carry no direct measurement",
)  # fmt: skip
_PGDA_TILE_MEDIAN_M = {
    "pgda78_site06_5m": 0.644, "pgda78_site20v2_5m": 0.593, "pgda78_site23_5m": 0.465, "pgda78_site42_5m": 0.567,
    "pgda78_haworth_5m": 0.368, "pgda78_shoemaker_5m": 0.336, "pgda78_dm1_5m": 0.769, "pgda78_dm2_5m": 0.560,
    "pgda78_sl2_5m": 0.358, "pgda78_sl3_5m": 0.415, "pgda78_npa_5m": 0.475, "pgda78_npb_5m": 0.927,
    "pgda78_npc_5m": 0.491, "pgda78_npd_5m": 0.454, "pgda78_lm1_5m": 0.336, "pgda78_lm2_5m": 0.350,
    "pgda78_lm3_5m": 0.382, "pgda78_lm4_5m": 0.344, "pgda78_lm5_5m": 0.367, "pgda78_lm6_5m": 0.395,
    "pgda78_lm7_5m": 0.455, "pgda78_lm8_5m": 0.363,
}  # fmt: skip


def _pgda_method(dem_id: str) -> ProductError:
    return ProductError(
        _PGDA_TILE_MEDIAN_M[dem_id], _PGDA_PUBLISHED.sigma_xy_m, "published-method", "published-method",
        "https://pgda.gsfc.nasa.gov/products/78 (per-pixel *_toterr.tif); " + _BARKER_2021,
        "the same published method (Barker et al. 2021) produced this tile and its per-pixel *_toterr.tif is published, but no "
        "document states a scalar uncertainty for it. sigma_z fallback = median of that raster, computed here (error_at returns the "
        "per-pixel value when the layer is on disk); sigma_xy = 0.14 m of the documented Site01, by assumption of the same method",
    )


_GDR_UNSTATED = ProductError(
    ASSUMED_ERROR.sigma_z_m, ASSUMED_ERROR.sigma_xy_m, "assumed", "assumed",
    _RESEARCH + " Sec. 1-2 (PDS labels, ERRATA, Smith et al. 2017 read; none gives a gridded-product accuracy)",
    "no vertical or horizontal accuracy is published for this LDEM release; Barker et al. 2023 (1.00/1.00/0.15 m) describes the "
    "track-adjusted PGDA product 90, not this file; the pessimistic global budget applies",
)  # fmt: skip

_GDR_MEASURED_Z_M = {
    "lola_875s_5m": (1.02, 16, 514_596),
    "lola_85s_10m": (1.01, 24, 923_504),
    "lola_80s_20m": (0.95, 26, 1_062_904),
    "lola_75s_60m": (1.07, 26, 1_062_904),
    "lola_75s_120m": (1.54, 26, 1_062_904),
    "lola_60s_240m": (2.86, 26, 1_062_904),
}


def _gdr_measured(dem_id: str) -> ProductError:
    z, n_tiles, n = _GDR_MEASURED_Z_M[dem_id]
    return ProductError(
        z, ASSUMED_ERROR.sigma_xy_m, "measured", "assumed", "docs/validation/terrain.md 3.8; " + _RESEARCH,
        f"sigma_z measured: pooled 68 % half-width of the difference to the PGDA 5 m tiles ({n_tiles} tiles, {n} samples at 100 m "
        "spacing; PGDA error ~0.4 m, so slightly pessimistic; common-mode LOLA orbit error is NOT visible in such a difference). "
        "Valid inside the footprint of those tiles. sigma_xy is NOT measured (the shift scan resolves only half a pixel and "
        "finds 0 to 2.5 m; a common-mode geolocation error cancels) and stays the ASSUMED global 10 m",
    )


PRODUCT_ERRORS: dict[str, ProductError] = {
    **{p.dem_id: (_PGDA_PUBLISHED if p.dem_id in _PGDA_PUBLISHED_TILES else _pgda_method(p.dem_id)) for p in PGDA},
    **{p.dem_id: (_gdr_measured(p.dem_id) if p.dem_id in _GDR_MEASURED_Z_M else _GDR_UNSTATED) for p in (GLOBAL, *SOUTH, *NORTH)},
    "ldem_512": ProductError(
        ASSUMED_ERROR.sigma_z_m, ASSUMED_ERROR.sigma_xy_m, "assumed", "assumed", _RESEARCH + " Sec. 1 (PDS label, V3.0)",
        "LOLA-only LDEM_512 (V3.0): no accuracy figure published; the pessimistic global budget applies",
    ),
    "sldem2015_512": ProductError(
        3.5, ASSUMED_ERROR.sigma_xy_m, "published", "assumed",
        "Barker et al. 2016, Icarus 273, 346-355, doi:10.1016/j.icarus.2015.07.039 (abstract; Sec. 4.1; Sec. 6); " + _RESEARCH + " Sec. 1",
        "sigma_z published only as 'typical vertical accuracy ~3 to 4 m' (RMS vertical residual of the co-registered Kaguya tiles against "
        "LOLA; 3.5 m is the midpoint, a reading); sigma_xy is NOT published and is ASSUMED at the global 10 m",
    ),
}  # fmt: skip


def product_family(dem_id: str) -> str:
    """Registry key of a store id: on-demand regional windows share one entry per product; every other id is its own key."""
    for prefix, family in (("sldem2015_512_", "sldem2015_512"), ("ldem_512_", "ldem_512")):
        if dem_id.startswith(prefix):
            return family
    return dem_id


def error_for(dem_id: str) -> ProductError:
    """Error budget of store ``dem_id``; an id with no registry entry gets :data:`ASSUMED_ERROR`, and says so."""
    e = PRODUCT_ERRORS.get(product_family(dem_id))
    if e is not None:
        return e
    return ProductError(
        ASSUMED_ERROR.sigma_z_m, ASSUMED_ERROR.sigma_xy_m, "assumed", "assumed", ASSUMED_ERROR.source,
        f"no registry entry for product '{dem_id}'; the pessimistic global budget applies",
    )  # fmt: skip


def register_product_error(dem_id: str, error: ProductError) -> None:
    """State the error of a user-ingested DEM (replaces any entry for that id's family)."""
    PRODUCT_ERRORS[product_family(dem_id)] = error


def known_families() -> tuple[str, ...]:
    """Registry keys that must exist: every ingestible store id and the two regional products."""
    return tuple(p.dem_id for p in ALL_PRODUCTS) + ("sldem2015_512", "ldem_512")


def _download(url: str, dest: Path, client: httpx.Client) -> None:
    """Resumable streaming download."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    have = dest.stat().st_size if dest.exists() else 0
    total = int(client.head(url, follow_redirects=True).headers["content-length"])
    if have == total:
        return
    headers = {"Range": f"bytes={have}-"} if 0 < have < total else {}
    mode = "ab" if headers else "wb"
    with client.stream("GET", url, headers=headers, follow_redirects=True) as r:
        r.raise_for_status()
        with open(dest, mode) as fh:
            for chunk in r.iter_bytes(1 << 20):
                fh.write(chunk)
    if dest.stat().st_size != total:
        raise OSError(f"{dest}: incomplete download ({dest.stat().st_size} of {total} bytes)")


def _check_tiff(path: Path) -> None:
    """PGDA answers HTTP 200 with a small HTML page for a missing file: require a TIFF header and a plausible size."""
    with open(path, "rb") as fh:
        magic = fh.read(4)
    if magic not in (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+") or path.stat().st_size < 1_000_000:
        raise OSError(f"{path}: not a GeoTIFF ({path.stat().st_size} bytes, header {magic!r}); the server sent an error page")


def fetch(product: Product) -> Path:
    """Download ``product`` (and its label) into ``data/dem/raw`` if not already complete."""
    with httpx.Client(timeout=httpx.Timeout(60.0, read=300.0)) as client:
        if product.label_url:
            _download(product.label_url, product.label_path, client)  # type: ignore[arg-type]
        _download(product.url, product.path, client)
        if product.err_url:
            _download(product.err_url, product.err_path, client)  # type: ignore[arg-type]
            _check_tiff(product.err_path)  # type: ignore[arg-type]
    return product.path
