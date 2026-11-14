"""Gated ingestion of a user-supplied GeoTIFF digital elevation model.

The file is untrusted. `inspect_geotiff` reads metadata first and refuses *before any pixel is read*
when the file is not a readable single-band GeoTIFF, declares more than `max_pixels` pixels (decompression
bomb guard), has a non-finite/absurd geotransform, has no CRS, or the CRS is not a lunar sphere
(`MOON_RADIUS_MISMATCH`, `EARTH_CRS`, `OTHER_BODY_CRS`, `CRS_BODY_UNRECOGNISED`, ...). Only then are pixels
streamed in row strips (bounded memory) to collect nodata statistics, a regular sample grid, the footprint
boundary ring and the edges of nodata holes, which are compared with the terrain the engine already has
(`TerrainStack`, LOLA/PGDA stores). The report never guesses: every refusal is a `Reason` with a stable code.

Datum assumptions (stated again in every `DemReport.datum_statement`)
    The engine works in the Moon mean-Earth/polar-axis frame `MOON_ME`, planetocentric longitude
    east-positive, and heights in metres above the 1 737 400 m sphere (`lunarnav.constants`; see
    `docs/validation/terrain.md`). A GeoTIFF can declare a sphere radius and a prime
    meridian, but not whether it is tied to the mean-Earth or the principal-axis frame, nor how its heights
    were referenced; those are only *tested* statistically by the overlap check, and always carried as an
    unverified assumption (`FRAME_UNVERIFIED` warning).

Acceptance thresholds (`DemThresholds`) were calibrated on real data and scale with the reference pixel size
(limit = floor + per_px * px). The measured good-tile ranges and the method are in `CALIBRATION`; numbers:
PGDA 5 m tiles vs LOLA 5-20 m: RMS 1.0-1.7 m, median within +-0.3 m; vs 120 m: RMS 1.7-2.4; vs 240 m: RMS 3.2-5.0,
median within +-1 m; vs the 474 m global 64 ppd grid: RMS 8.3-14.7 m, median -1.3..+7.9 m. Defects that the limits
must catch, observed on 9 tiles x 4 reference sets (full LOLA stack; 120 m; 240 m; 474 m) with these limits:
x1.1 / x2 height scale, wrong pixel size (x10) and rot90: refused 9/9 on every reference; flips and transpose: 9/9
against the full stack and the 120 m reference, 8/9 against 240 m and 474 m (the flat NPB tile, relief sd 13-17 m, is
indistinguishable from its flip); vertical offset: 5 m accepted (a `VERTICAL_OFFSET_SMALL` warning), 10 m refused 9/9
against the full stack and 120 m but accepted against 240 m and 474 m, 20 m refused 9/9 (240 m) / 5 of 9 (474 m); the
smallest offset caught is thus resolution dependent (6 + 0.03 px). 500 m horizontal shift: refused 9/9 (full stack),
8/9 (120 m, 240 m), 6/9 (474 m). Horizontal shifts up to ~80 m give RMS inside the limits (80 m: accepted 5/9 against
the full stack, 8/9 and 9/9 against 120 and 240 m); `ShiftDiagnostic` reports the best-fit shift (with `HORIZONTAL_SHIFT`
when it is significant), but small shifts remain a known gap of an overlap statistic.

Missing data
    NaN holes stay NaN in the overlay store. `TerrainStack` takes, at every point, the first store whose four
    surrounding pixel centres are all valid, so a hole (and the outside of the footprint) falls through to the
    stores beneath, and the horizon engine counts march nodes without data in `provenance["nodes_without_data"]`.
    There is no fake void, but the *seam* between user DEM and the stores beneath is a step of whatever the two
    disagree by; `BoundaryStats` measures it on the footprint ring and on hole edges and `BOUNDARY_STEP`
    warns when it is large (a refusal `BOUNDARY_CLIFF` when the disagreement is systematic).
"""

from __future__ import annotations

import math
import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.errors import CRSError, RasterioError
from rasterio.warp import transform as warp_transform
from rasterio.windows import Window

from lunarnav.agent.ingest.common import (
    MAX_FILE_BYTES,
    IngestRefusal,
    Reason,
    check_regular_file,
    refuse,
    sha256_file,
)
from lunarnav.constants import BODY_FIXED_FRAME, R_MOON_M
from lunarnav.terrain import bounding_circle
from lunarnav.terrain.projection import EQUIRECT, POLAR, GridGeometry, polar_forward
from lunarnav.terrain.stack import TerrainStack
from lunarnav.terrain.store import RowReader, SourceInfo, TerrainStore, build_store

MAX_PIXELS = 100_000_000
"""Decompression-bomb guard: refuse rasters declaring more pixels than this."""
MAX_FOOTPRINT_KM = 200.0
"""Refuse footprints larger than this on a side (this is a local-area product)."""
MIN_PIXEL_M, MAX_PIXEL_M = 0.05, 5000.0
"""Plausible ground pixel size range (the supported products are 1 to 20 m)."""
HEIGHT_ABS_MAX_M = 25_000.0
"""Heights beyond +-25 km from the sphere are not lunar relief (extremes are -9.1 and +10.8 km)."""
RADIUS_TOL_M = 1.0
"""A declared sphere radius must equal 1 737 400 m within this tolerance, else heights would be shifted."""

_GEOG_WKT = (
    'GEOGCS["Moon",DATUM["Moon",SPHEROID["Moon",1737400,0]],PRIMEM["Reference meridian",0],'
    'UNIT["degree",0.0174532925199433]]'
)

_BODY_RADII_M: dict[str, tuple[float, float]] = {
    "Earth": (6_350_000.0, 6_400_000.0),
    "Mars": (3_380_000.0, 3_400_000.0),
    "Mercury": (2_430_000.0, 2_450_000.0),
    "Venus": (6_040_000.0, 6_070_000.0),
    "Jupiter": (69_000_000.0, 72_000_000.0),
    "Ceres": (460_000.0, 480_000.0),
}
_MOON_BAND_M = (1_700_000.0, 1_780_000.0)

CALIBRATION: dict = {
    "method": (
        "9 PGDA 5 m tiles (DM1, LM1, LM4, LM7, NPB, SL2, Site01, Site07, Site23; central 1600x1600 px crops, 8 km) "
        "were compared with LOLA-only reference stacks that exclude PGDA, then re-written with deliberate defects "
        "(horizontal shift 5-500 m, vertical offset 5-600 m, row/column flip, transpose, rot90, x2/x0.5/x1.1 height "
        "scale, wrong pixel size, +2 m / +10 m noise). 225 inspections per reference."
    ),
    "good_tiles": {
        "reference_5_to_20m": {"rms_m": (1.04, 1.66), "median_m": (-0.29, 0.25), "corr_min": 0.998, "slope": (0.98, 1.0)},
        "reference_120m": {"rms_m": (1.72, 2.35), "median_m": (-0.28, 0.51), "corr_min": 0.995, "slope": (1.0, 1.02)},
        "reference_240m": {"rms_m": (3.2, 4.98), "median_m": (-0.34, 0.96), "corr_min": 0.976, "slope": (1.0, 1.1)},
        "reference_474m_global_64ppd": {"rms_m": (8.29, 14.7), "median_m": (-1.28, 7.92), "corr_min": 0.87,
                                        "slope": (1.0, 1.21), "note": "corr/slope only on the flat NPB tile (relief sd 12.7 m)"},
        "boundary_ring": {"max_step_m_5_to_20m": (5.1, 42.8), "max_step_m_240m": (7.5, 47.9), "max_step_m_474m": (27.6, 96.3),
                          "median_step_m_max_abs": 7.5},
    },
    "limits": (
        "limit = floor + per_px * reference_pixel_m: median 6 + 0.03 px; RMS 12 + 0.07 px; boundary median 20 + 0.1 px; "
        "boundary max warn 20 + 0.2 px; correlation >= 0.97 and slope 0.95..1.05 judged only when relief sd >= 4 x RMS limit. "
        "Each limit is at least 2.5x the worst good-tile value at that reference resolution."
    ),
}


@dataclass(frozen=True, slots=True)
class DemThresholds:
    """Acceptance thresholds, calibrated on real data (see `CALIBRATION`).

    Every limit grows linearly with the pixel size ``px`` of the reference terrain that was compared
    (median over the overlap): a coarse reference disagrees with a correct fine DEM by more, not because
    the DEM is wrong. Limit = floor + per_px * px.
    """

    min_overlap_samples: int = 500
    """Fewer valid user/reference pairs than this cannot judge a DEM (`OVERLAP_TOO_SMALL`)."""
    median_floor_m: float = 6.0
    median_per_px: float = 0.03
    """|median(user - ref)| above floor + per_px*px refuses (`VERTICAL_OFFSET`)."""
    median_warn_floor_m: float = 1.0
    median_warn_per_px: float = 0.015
    rms_floor_m: float = 12.0
    rms_per_px: float = 0.07
    """RMS(user - ref) above floor + per_px*px refuses (`RMS_TOO_LARGE`); above `rms_warn_fraction` of it warns."""
    rms_warn_fraction: float = 0.5
    min_correlation: float = 0.97
    """Pearson correlation below this refuses (`LOW_CORRELATION`) when the relief is large enough to judge."""
    relief_over_rms_limit: float = 4.0
    """Correlation and scale are judged only if the height sd in the overlap is at least this multiple of the RMS limit."""
    scale_range: tuple[float, float] = (0.95, 1.05)
    """Regression slope of user on reference heights outside this range refuses (`VERTICAL_SCALE`)."""
    boundary_warn_floor_m: float = 20.0
    boundary_warn_per_px: float = 0.2
    """Largest |user - ref| step on the footprint ring / hole edges above floor + per_px*px warns (`BOUNDARY_STEP`)."""
    boundary_median_floor_m: float = 20.0
    boundary_median_per_px: float = 0.1
    """|median ring step| above floor + per_px*px refuses (`BOUNDARY_CLIFF`): a systematic wall at the seam."""
    max_nodata_fraction: float = 0.5
    warn_nodata_fraction: float = 0.01

    def median_limit_m(self, px: float) -> float:
        return self.median_floor_m + self.median_per_px * px

    def median_warn_m(self, px: float) -> float:
        return self.median_warn_floor_m + self.median_warn_per_px * px

    def rms_limit_m(self, px: float) -> float:
        return self.rms_floor_m + self.rms_per_px * px

    def boundary_warn_m(self, px: float) -> float:
        return self.boundary_warn_floor_m + self.boundary_warn_per_px * px

    def boundary_median_limit_m(self, px: float) -> float:
        return self.boundary_median_floor_m + self.boundary_median_per_px * px


@dataclass(frozen=True, slots=True)
class OverlapStats:
    """user - stack height statistics at pixel centres where both have data."""

    n: int
    n_sampled: int
    covered_fraction: float
    area_km2: float
    """Footprint area times the covered fraction of the sample grid."""
    median_m: float
    mean_m: float
    rms_m: float
    p05_m: float
    p50_m: float
    p95_m: float
    correlation: float | None
    scale_slope: float | None
    relief_sd_m: float
    stores_used: dict
    base_pixel_m_median: float

    def to_dict(self) -> dict:
        return {k: getattr(self, k) for k in self.__slots__}


@dataclass(frozen=True, slots=True)
class BoundaryStats:
    """Seam between the user DEM and the stack beneath."""

    ring_n: int
    ring_covered_fraction: float
    ring_median_step_m: float | None
    ring_p95_abs_step_m: float | None
    ring_max_abs_step_m: float | None
    hole_edge_n: int
    hole_edge_max_abs_step_m: float | None

    def to_dict(self) -> dict:
        return {k: getattr(self, k) for k in self.__slots__}


@dataclass(frozen=True, slots=True)
class ShiftDiagnostic:
    """Best integer horizontal shift of the user DEM against the stack (diagnostic only).

    `row_px, col_px` say that `user[r + row_px, c + col_px]` matches the stack at pixel `(r, c)` best.
    """

    row_px: int
    col_px: int
    metres_row: float
    metres_col: float
    rms_at_zero_m: float
    rms_at_best_m: float

    def to_dict(self) -> dict:
        return {k: getattr(self, k) for k in self.__slots__}


@dataclass
class DemReport:
    """Everything `inspect_geotiff` established about a user DEM. `accepted` iff no refusals."""

    path: str
    name: str = ""
    sha256: str = ""
    size_bytes: int = 0
    refusals: list[Reason] = field(default_factory=list)
    warnings: list[Reason] = field(default_factory=list)
    width: int = 0
    height: int = 0
    band: int | None = None
    pixel_m: float | None = None
    crs_name: str | None = None
    crs_wkt: str | None = None
    crs_summary: dict = field(default_factory=dict)
    body: str | None = None
    footprint: dict = field(default_factory=dict)
    vertical: dict = field(default_factory=dict)
    nodata: dict = field(default_factory=dict)
    height_range_m: tuple[float, float] | None = None
    overlap: OverlapStats | None = None
    boundary: BoundaryStats | None = None
    shift: ShiftDiagnostic | None = None
    no_overlap_override: bool = False
    datum_statement: str = ""
    missing_data_handling: str = ""
    thresholds: DemThresholds = field(default_factory=DemThresholds)
    grid_plan: dict = field(default_factory=dict)
    _ring_latlon: np.ndarray | None = field(default=None, repr=False)
    _read: dict = field(default_factory=dict, repr=False)

    @property
    def accepted(self) -> bool:
        return not self.refusals

    @property
    def refusal_codes(self) -> list[str]:
        return [r.code for r in self.refusals]

    @property
    def warning_codes(self) -> list[str]:
        return [r.code for r in self.warnings]

    def raise_if_refused(self) -> None:
        """Raise `IngestRefusal` with the refusal reasons, if any."""
        if self.refusals:
            raise IngestRefusal(self.refusals)

    def to_dict(self) -> dict:
        """JSON-serialisable summary for the model context and the provenance ledger."""
        return {
            "accepted": self.accepted,
            "path": self.path,
            "name": self.name,
            "sha256": self.sha256,
            "size_bytes": self.size_bytes,
            "refusals": [r.to_dict() for r in self.refusals],
            "warnings": [r.to_dict() for r in self.warnings],
            "width": self.width,
            "height": self.height,
            "band": self.band,
            "pixel_m": self.pixel_m,
            "crs_name": self.crs_name,
            "crs_summary": self.crs_summary,
            "body": self.body,
            "footprint": self.footprint,
            "vertical": self.vertical,
            "nodata": self.nodata,
            "height_range_m": list(self.height_range_m) if self.height_range_m else None,
            "overlap": self.overlap.to_dict() if self.overlap else None,
            "boundary": self.boundary.to_dict() if self.boundary else None,
            "best_shift": self.shift.to_dict() if self.shift else None,
            "no_overlap_override": self.no_overlap_override,
            "datum_statement": self.datum_statement,
            "missing_data_handling": self.missing_data_handling,
            "grid_plan": self.grid_plan,
        }


DATUM_STATEMENT = (
    f"The engine assumes the Moon mean-Earth/polar-axis frame {BODY_FIXED_FRAME}, planetocentric latitude and "
    f"east-positive longitude, and heights in metres above the {R_MOON_M:.0f} m sphere (see docs/validation/"
    "terrain.md). The file can only declare a sphere radius and prime meridian; its tie to "
    "MOON_ME (rather than the principal-axis frame) and its height reference are taken on trust and checked "
    "only statistically against the existing LOLA/PGDA stores."
)

MISSING_DATA_STATEMENT = (
    "NaN/nodata pixels stay NaN in the overlay. TerrainStack uses, at each point, the first store whose four "
    "surrounding pixel centres are all valid, so holes and everything outside the footprint fall through to the "
    "stores beneath (LOLA/PGDA); horizon provenance counts nodes without data (nodes_without_data). The seam "
    "between the user DEM and the stores beneath is a step equal to their disagreement there (see boundary)."
)


def _warn(rep: DemReport, code: str, message: str, **detail) -> None:
    rep.warnings.append(Reason(code, message, detail))


def _ref(rep: DemReport, code: str, message: str, **detail) -> None:
    rep.refusals.append(Reason(code, message, detail))


def _find_ellipsoid(pj: dict) -> dict | None:
    node = pj.get("base_crs", pj)
    datum = node.get("datum")
    if datum is None:
        ens = node.get("datum_ensemble")
        if ens is not None:
            return ens.get("ellipsoid") or {"ensemble": ens.get("name", "ensemble")}
        return None
    return datum.get("ellipsoid") if isinstance(datum, dict) else None


def _find_prime_meridian_deg(pj: dict) -> float:
    node = pj.get("base_crs", pj)
    datum = node.get("datum") or node.get("datum_ensemble") or {}
    pm = datum.get("prime_meridian") if isinstance(datum, dict) else None
    if not pm:
        return 0.0
    lon = pm.get("longitude", 0.0)
    if isinstance(lon, dict):
        lon = lon.get("value", 0.0)
    return float(lon)


def _ellipsoid_radii(ell: dict) -> tuple[float, float] | None:
    """(semi-major, semi-minor) metres from a PROJJSON ellipsoid."""

    def val(v):
        return float(v["value"]) if isinstance(v, dict) else float(v)

    try:
        if "radius" in ell:
            r = val(ell["radius"])
            return r, r
        if "semi_major_axis" in ell:
            a = val(ell["semi_major_axis"])
            if "semi_minor_axis" in ell:
                return a, val(ell["semi_minor_axis"])
            if "inverse_flattening" in ell:
                inv = val(ell["inverse_flattening"])
                return a, (a if inv == 0 else a * (1.0 - 1.0 / inv))
    except (TypeError, ValueError, KeyError):
        return None
    return None


def classify_crs(crs: CRS | None) -> tuple[dict, list[Reason]]:
    """Describe a CRS and return refusal reasons if it is not a lunar sphere.

    The summary carries ``kind`` (``geographic``/``projected``), ``name``, ``radius_m``, ``prime_meridian_deg``,
    ``proj`` (the PROJ parameter dict), ``body`` and ``direct`` (a grid kind the engine can adopt without
    resampling: ``polar_south``, ``polar_north``, ``equirect_deg``, ``equirect_eqc`` or None).
    Refusal codes: ``NO_CRS``, ``EARTH_CRS``, ``OTHER_BODY_CRS``, ``MOON_RADIUS_MISMATCH``,
    ``ELLIPSOID_NOT_SPHERE``, ``CRS_BODY_UNRECOGNISED``, ``PRIME_MERIDIAN_OFFSET``, ``CRS_UNSUPPORTED``.
    """
    if crs is None:
        return {}, [Reason("NO_CRS", "the GeoTIFF declares no coordinate reference system; a lunar CRS is required")]
    try:
        name = crs.to_dict(projjson=True).get("name") or ""
        pj = crs.to_dict(projjson=True)
        proj = crs.to_dict()
        epsg = crs.to_epsg()
        auth = crs.to_authority()
    except (CRSError, ValueError, KeyError, TypeError) as e:
        return {}, [Reason("CRS_UNSUPPORTED", f"the CRS could not be interpreted: {type(e).__name__}", {})]
    kind = "geographic" if crs.is_geographic else "projected" if crs.is_projected else "other"
    summary: dict = {"kind": kind, "name": name, "proj": proj, "authority": list(auth) if auth else None, "body": None}
    reasons: list[Reason] = []
    if epsg is not None or (auth and auth[0] == "EPSG"):
        summary["body"] = "Earth"
        return summary, [Reason("EARTH_CRS", f"EPSG CRS {epsg or auth[1]} ({name}) is an Earth CRS; a lunar CRS is required",
                                {"crs_name": name, "epsg": epsg})]
    ell = _find_ellipsoid(pj)
    radii = _ellipsoid_radii(ell) if ell else None
    if kind == "other" or radii is None:
        low = name.lower()
        if "wgs" in low or "earth" in low or "nad" in low or "itrf" in low:
            summary["body"] = "Earth"
            return summary, [Reason("EARTH_CRS", f"CRS {name!r} looks like an Earth CRS", {"crs_name": name})]
        return summary, [Reason("CRS_BODY_UNRECOGNISED",
                                "the CRS has no recognisable body: no sphere/ellipsoid radius could be read from it",
                                {"crs_name": name})]
    a, b = radii
    summary["radius_m"] = a
    summary["semi_minor_m"] = b
    for body, (lo, hi) in _BODY_RADII_M.items():
        if lo <= a <= hi:
            summary["body"] = body
            code = "EARTH_CRS" if body == "Earth" else "OTHER_BODY_CRS"
            return summary, [Reason(code, f"the CRS describes {body} (radius {a:.0f} m), not the Moon",
                                    {"radius_m": a, "body": body, "crs_name": name})]
    if not (_MOON_BAND_M[0] <= a <= _MOON_BAND_M[1]):
        return summary, [Reason("CRS_BODY_UNRECOGNISED", f"sphere radius {a:.0f} m matches no known body",
                                {"radius_m": a, "crs_name": name})]
    summary["body"] = "Moon"
    if abs(a - b) > 1e-3:
        reasons.append(Reason("ELLIPSOID_NOT_SPHERE",
                              f"the lunar ellipsoid ({a:.1f} x {b:.1f} m) is not a sphere; the engine is spherical, "
                              "latitudes would not be planetocentric", {"semi_major_m": a, "semi_minor_m": b}))
    if abs(a - R_MOON_M) > RADIUS_TOL_M:
        reasons.append(Reason("MOON_RADIUS_MISMATCH",
                              f"the CRS sphere radius is {a:.1f} m, the engine's heights are above {R_MOON_M:.1f} m: "
                              f"heights would be wrong by about {a - R_MOON_M:+.1f} m",
                              {"radius_m": a, "engine_radius_m": R_MOON_M, "delta_m": a - R_MOON_M}))
    pm = _find_prime_meridian_deg(pj)
    summary["prime_meridian_deg"] = pm
    if abs(pm) > 1e-9:
        reasons.append(Reason("PRIME_MERIDIAN_OFFSET", f"the CRS prime meridian is {pm} deg, not the lunar reference "
                              "meridian", {"prime_meridian_deg": pm}))
    summary["direct"] = _direct_kind(kind, proj, crs) if not reasons else None
    return summary, reasons


def _num(proj: dict, key: str, default: float) -> float:
    v = proj.get(key, default)
    try:
        return float(v)
    except (TypeError, ValueError):
        return float("nan")


def _direct_kind(kind: str, proj: dict, crs: CRS) -> str | None:
    """Grid kind that needs no resampling, or None (then the generic resampling path is used)."""
    p = proj.get("proj")
    if kind == "geographic" and p == "longlat":
        return "equirect_deg"
    if kind != "projected" or proj.get("units", "m") != "m":
        return None
    if _num(proj, "x_0", 0) != 0 or _num(proj, "y_0", 0) != 0:
        return None
    if p == "stere" and _num(proj, "lon_0", 0) == 0 and _num(proj, "k", 1.0) == 1.0 and _num(proj, "k_0", 1.0) == 1.0:
        lat0 = _num(proj, "lat_0", 0)
        lat_ts = _num(proj, "lat_ts", lat0)
        if lat0 in (-90.0, 90.0) and lat_ts == lat0:
            return "polar_south" if lat0 < 0 else "polar_north"
    if p == "eqc" and _num(proj, "lat_ts", 0) == 0 and _num(proj, "lat_0", 0) == 0:
        return "equirect_eqc"
    return None


_UNIT_FACTORS: dict[str, float] = {
    "m": 1.0, "meter": 1.0, "meters": 1.0, "metre": 1.0, "metres": 1.0,
    "km": 1000.0, "kilometer": 1000.0, "kilometers": 1000.0, "kilometre": 1000.0, "kilometres": 1000.0,
    "cm": 0.01, "mm": 0.001,
    "ft": 0.3048, "foot": 0.3048, "feet": 0.3048, "international foot": 0.3048,
}
_UNIT_KEYS = ("units", "unit", "vertical_units", "vertical_unit", "zunit", "z_units", "z#units",
              "elevation_units", "band_units", "height_units")


def _declared_units(ds, band: int) -> dict[str, str]:
    found: dict[str, str] = {}
    try:
        u = ds.units[band - 1]
        if u:
            found["band_units"] = str(u)
    except (IndexError, ValueError, AttributeError) as e:
        found["band_units_unreadable"] = type(e).__name__
    for scope, tags in (("band", ds.tags(band)), ("dataset", ds.tags())):
        for k, v in tags.items():
            kl = k.lower().split("#")[-1] if k.lower().startswith("z#") else k.lower()
            if (k.lower() in _UNIT_KEYS or kl in _UNIT_KEYS) and not k.lower().startswith(("x#", "y#", "lon", "lat")):
                found[f"{scope}:{k}"] = str(v)
    return found


def _valid_rows(ds, band: int, r0: int, r1: int, factor: float, scale: float, offset: float, nodata) -> np.ndarray:
    """Heights (m, float32, NaN = no data) for rows ``[r0, r1)`` of the selected band."""
    win = Window(0, r0, ds.width, r1 - r0)
    raw = ds.read(band, window=win, masked=False)
    mask = ds.read_masks(band, window=win) == 0
    h = raw.astype(np.float64)
    bad = mask | ~np.isfinite(h)
    if nodata is not None and np.isfinite(nodata):
        bad |= raw == raw.dtype.type(nodata)
    h = (h * scale + offset) * factor
    bad |= np.abs(h) > HEIGHT_ABS_MAX_M
    h[bad] = np.nan
    return h.astype(np.float32)


def _strip_rows(width: int) -> int:
    return max(1, 2_000_000 // max(width, 1))


def _pixel_to_lonlat(ds, crs: CRS, rows: np.ndarray, cols: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Pixel-centre (row, col) -> planetocentric (lat, lon in [0, 360)); non-finite where the CRS fails."""
    t = ds.transform
    c_, r_ = np.asarray(cols, float) + 0.5, np.asarray(rows, float) + 0.5
    xs, ys = t.a * c_ + t.b * r_ + t.c, t.d * c_ + t.e * r_ + t.f
    lon, lat = warp_transform(crs, CRS.from_wkt(_GEOG_WKT), np.asarray(xs).ravel().tolist(), np.asarray(ys).ravel().tolist())
    lon = np.asarray(lon, float)
    lat = np.asarray(lat, float)
    lon = np.where(np.isfinite(lon), np.mod(lon, 360.0), np.nan)
    return lat.reshape(np.shape(xs)), lon.reshape(np.shape(xs))


def _ground_pixel_m(ds, summary: dict, crs: CRS) -> float | None:
    t = ds.transform
    area = abs(t.a * t.e - t.b * t.d)
    if not math.isfinite(area) or area <= 0:
        return None
    side = math.sqrt(area)
    if summary.get("kind") == "geographic":
        return side * math.pi / 180.0 * R_MOON_M
    try:
        factor = float(crs.linear_units_factor[1])
    except (CRSError, ValueError, IndexError):
        factor = 1.0
    return side * factor


def _footprint_checks(rep: DemReport, ds, crs: CRS, summary: dict) -> bool:
    """Geotransform sanity before pixels. Returns False if refused."""
    t = ds.transform
    vals = (t.a, t.b, t.c, t.d, t.e, t.f)
    if not all(math.isfinite(v) for v in vals):
        _ref(rep, "GEOTRANSFORM_NONFINITE", "the geotransform contains non-finite values")
        return False
    if t.a == 0 or t.e == 0 or abs(t.a * t.e - t.b * t.d) == 0:
        _ref(rep, "GEOTRANSFORM_DEGENERATE", "the geotransform has a zero pixel size or is singular")
        return False
    px = _ground_pixel_m(ds, summary, crs)
    rep.pixel_m = px
    if px is None or not (MIN_PIXEL_M <= px <= MAX_PIXEL_M):
        _ref(rep, "PIXEL_SIZE_ABSURD", f"ground pixel size {px} m is outside the plausible {MIN_PIXEL_M}..{MAX_PIXEL_M} m",
             pixel_m=px)
        return False
    if ds.width < 3 or ds.height < 3:
        _ref(rep, "RASTER_TOO_SMALL", f"raster is {ds.width}x{ds.height} pixels; at least 3x3 are needed")
        return False
    if t.b != 0 or t.d != 0:
        _warn(rep, "ROTATED_GRID", "the geotransform has rotation terms; the DEM will be resampled onto an unrotated grid")
    w_km, h_km = ds.width * px / 1000.0, ds.height * px / 1000.0
    rep.footprint.update(width_km=w_km, height_km=h_km, area_km2=w_km * h_km)
    if max(w_km, h_km) > MAX_FOOTPRINT_KM:
        _ref(rep, "FOOTPRINT_TOO_LARGE", f"footprint {w_km:.1f} x {h_km:.1f} km exceeds the {MAX_FOOTPRINT_KM:.0f} km cap",
             width_km=w_km, height_km=h_km, cap_km=MAX_FOOTPRINT_KM)
        return False
    return True


@dataclass
class _Scan:
    n_valid: int = 0
    n_nodata: int = 0
    n_out_of_range: int = 0
    vmin: float = math.inf
    vmax: float = -math.inf
    sample_rows: np.ndarray = field(default_factory=lambda: np.empty(0, int))
    sample_cols: np.ndarray = field(default_factory=lambda: np.empty(0, int))
    sample_vals: np.ndarray = field(default_factory=lambda: np.empty((0, 0), np.float32))
    ring_rc: np.ndarray = field(default_factory=lambda: np.empty((0, 2), int))
    ring_vals: np.ndarray = field(default_factory=lambda: np.empty(0, np.float32))
    hole_rc: np.ndarray = field(default_factory=lambda: np.empty((0, 2), int))
    hole_vals: np.ndarray = field(default_factory=lambda: np.empty(0, np.float32))


def _scan_pixels(ds, band: int, factor: float, scale: float, offset: float, nodata, n_samples: int) -> _Scan:
    """One streaming pass over the pixels: statistics, regular sample grid, boundary ring, hole edges."""
    h, w = ds.height, ds.width
    k = max(2, int(math.sqrt(n_samples)))
    sr = np.unique(np.linspace(0, h - 1, min(k, h)).round().astype(int))
    sc = np.unique(np.linspace(0, w - 1, min(k, w)).round().astype(int))
    sc_ring = np.unique(np.linspace(0, w - 1, min(1500, w)).round().astype(int))
    sr_ring = np.unique(np.linspace(0, h - 1, min(1500, h)).round().astype(int))
    scan = _Scan(sample_rows=sr, sample_cols=sc, sample_vals=np.full((sr.size, sc.size), np.nan, np.float32))
    ring_rc: list[np.ndarray] = []
    ring_vals: list[np.ndarray] = []
    hole_rc: list[np.ndarray] = []
    hole_vals: list[np.ndarray] = []
    step = _strip_rows(w)
    for r0 in range(0, h, step):
        r1 = min(h, r0 + step)
        a, b = max(0, r0 - 1), min(h, r1 + 1)
        strip = _valid_rows(ds, band, a, b, factor, scale, offset, nodata)
        own = strip[r0 - a : r1 - a]
        finite = np.isfinite(own)
        scan.n_valid += int(finite.sum())
        if finite.any():
            scan.vmin = min(scan.vmin, float(own[finite].min()))
            scan.vmax = max(scan.vmax, float(own[finite].max()))
        rows_here = np.nonzero((sr >= r0) & (sr < r1))[0]
        for i in rows_here:
            scan.sample_vals[i] = own[sr[i] - r0, sc]
        fin_all = np.isfinite(strip)
        if fin_all.any() and not fin_all.all():
            edge = np.zeros_like(fin_all)
            edge[1:] |= ~fin_all[:-1]
            edge[:-1] |= ~fin_all[1:]
            edge[:, 1:] |= ~fin_all[:, :-1]
            edge[:, :-1] |= ~fin_all[:, 1:]
            ee = np.argwhere((edge & fin_all)[r0 - a : r1 - a])
            if ee.size:
                ee = ee[:: max(1, len(ee) // 400)]
                hole_rc.append(ee + np.array([r0, 0]))
                hole_vals.append(own[ee[:, 0], ee[:, 1]])
        if r0 == 0:
            ring_rc.append(np.stack([np.zeros_like(sc_ring), sc_ring], 1))
            ring_vals.append(own[0, sc_ring])
        if r1 == h:
            ring_rc.append(np.stack([np.full_like(sc_ring, h - 1), sc_ring], 1))
            ring_vals.append(own[h - 1 - r0, sc_ring])
        inner = sr_ring[(sr_ring >= r0) & (sr_ring < r1)]
        for c in (0, w - 1):
            ring_rc.append(np.stack([inner, np.full_like(inner, c)], 1))
            ring_vals.append(own[inner - r0, c])
    total = h * w
    scan.n_nodata = total - scan.n_valid
    scan.ring_rc = np.concatenate(ring_rc) if ring_rc else scan.ring_rc
    scan.ring_vals = np.concatenate(ring_vals) if ring_vals else scan.ring_vals
    if hole_rc:
        hr = np.concatenate(hole_rc)
        hv = np.concatenate(hole_vals)
        sel = np.linspace(0, len(hr) - 1, min(len(hr), 2000)).round().astype(int)
        scan.hole_rc, scan.hole_vals = hr[sel], hv[sel]
    return scan


def _stack_heights(base: TerrainStack, lat: np.ndarray, lon: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    h, si = base.height_and_store(lat, lon)
    return np.asarray(h, float), np.asarray(si)


def compare_heights(user_h: np.ndarray, lat: np.ndarray, lon: np.ndarray, base: TerrainStack, footprint_area_km2: float,
                    n_sampled: int | None = None) -> OverlapStats | None:
    """User-vs-stack statistics at the given points (flat arrays); None if no point has data in both."""
    user_h = np.asarray(user_h, float).ravel()
    lat, lon = np.asarray(lat, float).ravel(), np.asarray(lon, float).ravel()
    n_all = user_h.size if n_sampled is None else n_sampled
    ok_u = np.isfinite(user_h) & np.isfinite(lat) & np.isfinite(lon)
    bh = np.full(user_h.shape, np.nan)
    si = np.full(user_h.shape, -1)
    if ok_u.any():
        bh[ok_u], si[ok_u] = _stack_heights(base, lat[ok_u], lon[ok_u])
    ok = ok_u & np.isfinite(bh)
    n = int(ok.sum())
    if n == 0:
        return None
    u, b = user_h[ok], bh[ok]
    d = u - b
    sd_b = float(np.std(b))
    corr = scale = None
    if sd_b > 1e-9 and float(np.std(u)) > 1e-9:
        corr = float(np.corrcoef(u, b)[0, 1])
        scale = float(np.cov(u, b)[0, 1] / np.var(b, ddof=1))
    used: dict[str, int] = {}
    for s in np.unique(si[ok]):
        used[base.stores[int(s)].dem_id] = int((si[ok] == s).sum())
    pxs = np.array([base.stores[int(s)].pixel_size_m for s in si[ok]])
    p5, p50, p95 = np.percentile(d, [5, 50, 95])
    return OverlapStats(
        n=n, n_sampled=int(n_all), covered_fraction=n / max(int(ok_u.sum()), 1), area_km2=footprint_area_km2 * n / max(n_all, 1),
        median_m=float(np.median(d)), mean_m=float(d.mean()), rms_m=float(np.sqrt(np.mean(d * d))),
        p05_m=float(p5), p50_m=float(p50), p95_m=float(p95), correlation=corr, scale_slope=scale,
        relief_sd_m=sd_b, stores_used=used, base_pixel_m_median=float(np.median(pxs)),
    )


def _boundary_stats(scan: _Scan, ring_lat, ring_lon, hole_lat, hole_lon, base: TerrainStack) -> BoundaryStats:
    def steps(vals, lat, lon):
        ok = np.isfinite(vals) & np.isfinite(lat) & np.isfinite(lon)
        if not ok.any():
            return np.empty(0), len(vals)
        bh, _ = _stack_heights(base, lat[ok], lon[ok])
        s = np.asarray(vals, float)[ok] - bh
        return s[np.isfinite(s)], len(vals)

    rs, rn = steps(scan.ring_vals, ring_lat, ring_lon)
    hs, _hn = (steps(scan.hole_vals, hole_lat, hole_lon) if scan.hole_vals.size else (np.empty(0), 0))
    return BoundaryStats(
        ring_n=int(rs.size), ring_covered_fraction=rs.size / max(rn, 1),
        ring_median_step_m=float(np.median(rs)) if rs.size else None,
        ring_p95_abs_step_m=float(np.percentile(np.abs(rs), 95)) if rs.size else None,
        ring_max_abs_step_m=float(np.abs(rs).max()) if rs.size else None,
        hole_edge_n=int(hs.size), hole_edge_max_abs_step_m=float(np.abs(hs).max()) if hs.size else None,
    )


def _shift_scan(ds, band, factor, scale, offset, nodata, crs, summary, base: TerrainStack, max_window: int = 600,
                half_range: int = 4, max_lattice: int = 110) -> ShiftDiagnostic | None:
    """Best integer shift of the user DEM against the stack on a lattice in the central window (diagnostic)."""
    w = min(max_window, ds.width, ds.height)
    r0, c0 = (ds.height - w) // 2, (ds.width - w) // 2
    win = Window(c0, r0, w, w)
    raw = ds.read(band, window=win, masked=False).astype(np.float64)
    bad = (ds.read_masks(band, window=win) == 0) | ~np.isfinite(raw)
    if nodata is not None and np.isfinite(nodata):
        bad |= raw == nodata
    arr = (raw * scale + offset) * factor
    arr[bad | (np.abs(arr) > HEIGHT_ABS_MAX_M)] = np.nan
    centre_lat, centre_lon = _pixel_to_lonlat(ds, crs, np.array([r0 + w / 2]), np.array([c0 + w / 2]))
    if not (np.isfinite(centre_lat[0]) and np.isfinite(centre_lon[0])):
        return None
    sel = base.select(float(centre_lat[0]), float(centre_lon[0]))
    base_px = sel.pixel_size_m if sel is not None else float(summary.get("px") or 1.0)
    user_px = float(summary.get("px") or 1.0)
    s = max(1, round(base_px / (2.0 * user_px)), math.ceil(w / max_lattice))
    pad = half_range * s
    idx = np.arange(pad, w - pad, s)
    if idx.size < 16:
        return None
    rr, cc = np.meshgrid(idx + r0, idx + c0, indexing="ij")
    lat, lon = _pixel_to_lonlat(ds, crs, rr.ravel(), cc.ravel())
    bh, _ = _stack_heights(base, lat, lon)
    bh = bh.reshape(rr.shape)
    best = None
    rms0 = None
    for di in range(-half_range, half_range + 1):
        for dj in range(-half_range, half_range + 1):
            u = arr[np.ix_(idx + di * s, idx + dj * s)]
            ok = np.isfinite(u) & np.isfinite(bh)
            if ok.sum() < 16:
                continue
            rms = float(np.sqrt(np.mean((u[ok] - bh[ok]) ** 2)))
            if di == 0 and dj == 0:
                rms0 = rms
            if best is None or rms < best[0]:
                best = (rms, di * s, dj * s)
    if best is None or rms0 is None:
        return None
    return ShiftDiagnostic(best[1], best[2], best[1] * user_px, best[2] * user_px, rms0, best[0])


TIFF_MAGICS = frozenset({b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+"})
"""First four bytes of classic and BigTIFF files (both byte orders)."""


def gtiff_env() -> rasterio.Env:
    """GDAL environment for untrusted rasters: no ``.aux.xml`` sidecar (it could change scale, offset or CRS
    under an unchanged file hash) and no sibling-directory scan (``GDAL_DISABLE_READDIR_ON_OPEN``)."""
    return rasterio.Env(GDAL_PAM_ENABLED="NO", GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR")


def inspect_geotiff(
    path: str | Path,
    *,
    base: TerrainStack | None = None,
    thresholds: DemThresholds | None = None,
    max_bytes: int | None = None,
    max_pixels: int = MAX_PIXELS,
    band: int | None = None,
    assume_metres: bool = False,
    allow_no_overlap: bool = False,
    n_samples: int = 20_000,
) -> DemReport:
    """Inspect an untrusted GeoTIFF and decide whether it may be used as a terrain overlay.

    Returns a `DemReport`; the DEM is usable only if ``report.accepted``. Never raises on malformed input
    (every problem becomes a refusal `Reason`). Pixels are not read unless all metadata checks pass.

    ``base`` is the stack the DEM is compared with (default `TerrainStack.open()`; none available means the
    overlap check cannot run, `OVERLAP_TOO_SMALL`). ``allow_no_overlap`` overrides only that refusal and only
    where the stack does not cover the DEM; it is recorded as ``report.no_overlap_override`` and a warning.
    ``band`` selects the band of a multi-band file (else `MULTI_BAND`). ``assume_metres`` accepts a DEM that
    declares no vertical unit (`VERTICAL_UNIT_UNDECLARED` otherwise).
    """
    th = thresholds or DemThresholds()
    p = Path(path)
    rep = DemReport(path=str(p), name=p.name, thresholds=th, datum_statement=DATUM_STATEMENT, missing_data_handling=MISSING_DATA_STATEMENT)
    try:
        rep.size_bytes = check_regular_file(p, max_bytes if max_bytes is not None else MAX_FILE_BYTES["raster"], kind="raster")
        rep.sha256 = sha256_file(p)
    except IngestRefusal as e:
        rep.refusals.extend(e.reasons)
        return rep
    try:
        with p.open("rb") as fh:
            magic = fh.read(4)
    except OSError as e:
        _ref(rep, "NOT_GEOTIFF", f"cannot read the file: {type(e).__name__}", error=str(e)[:200])
        return rep
    if magic not in TIFF_MAGICS:
        _ref(rep, "NOT_GEOTIFF", "the file does not start with a TIFF header (a VRT or other GDAL dataset "
             "that merely carries a .tif name is refused, because it can point at other files)")
        return rep
    with gtiff_env():
        try:
            ds = rasterio.open(p, driver="GTiff")
        except (RasterioError, OSError, ValueError) as e:
            _ref(rep, "NOT_GEOTIFF", f"cannot open the file as a GeoTIFF: {type(e).__name__}", error=str(e)[:200])
            return rep
        try:
            return _inspect_open(rep, ds, th, base, band, assume_metres, allow_no_overlap, max_pixels, n_samples)
        except (RasterioError, OSError, ValueError, IndexError, ArithmeticError) as e:
            _ref(rep, "RASTER_UNREADABLE", f"reading the raster failed: {type(e).__name__}", error=str(e)[:200])
            return rep
        finally:
            ds.close()


def _inspect_open(rep, ds, th: DemThresholds, base, band, assume_metres, allow_no_overlap, max_pixels, n_samples) -> DemReport:
    if ds.driver != "GTiff":
        _ref(rep, "NOT_GEOTIFF", f"the file is a {ds.driver} raster, a GeoTIFF is required", driver=ds.driver)
        return rep
    rep.width, rep.height = int(ds.width), int(ds.height)
    n_px = rep.width * rep.height
    if n_px > max_pixels:
        _ref(rep, "TOO_MANY_PIXELS", f"declared {rep.width}x{rep.height} = {n_px} pixels exceeds the {max_pixels}-pixel cap",
             pixels=n_px, cap=max_pixels)
        return rep
    if ds.count != 1:
        if band is None:
            _ref(rep, "MULTI_BAND", f"the file has {ds.count} bands; pass band=<n> to choose the elevation band",
                 bands=[(i + 1, d) for i, d in enumerate(ds.descriptions)] if ds.count else [])
            return rep
        if not 1 <= band <= ds.count:
            _ref(rep, "BAND_OUT_OF_RANGE", f"band {band} does not exist (file has {ds.count})")
            return rep
        _warn(rep, "BAND_SELECTED", f"multi-band file: band {band} of {ds.count} is used as elevation")
    rep.band = band or 1
    if ds.count == 0:
        _ref(rep, "MULTI_BAND", "the file has no bands")
        return rep
    dt = np.dtype(ds.dtypes[rep.band - 1])
    if dt.kind not in "iuf":
        _ref(rep, "BAD_DTYPE", f"band data type {dt} is not a real number type", dtype=str(dt))
        return rep
    crs = ds.crs
    summary, reasons = classify_crs(crs)
    rep.crs_summary = {k: v for k, v in summary.items()}
    rep.body = summary.get("body")
    rep.crs_name = summary.get("name")
    if crs is not None:
        try:
            rep.crs_wkt = crs.to_wkt()
        except (CRSError, ValueError):
            rep.crs_wkt = None
            _warn(rep, "CRS_WKT_UNAVAILABLE", "the CRS could not be written as WKT; the summary fields are used")
    if reasons:
        rep.refusals.extend(reasons)
        return rep
    summary["px"] = None
    if not _footprint_checks(rep, ds, crs, summary):
        return rep
    summary["px"] = rep.pixel_m or 1.0
    declared = _declared_units(ds, rep.band)
    factor, unit_label = 1.0, "m (assumed)"
    parsed = {k: _UNIT_FACTORS.get(v.strip().lower()) for k, v in declared.items()}
    if declared:
        unknown = {k: declared[k] for k, f in parsed.items() if f is None}
        if unknown:
            _ref(rep, "VERTICAL_UNIT_UNSUPPORTED", "the file declares a vertical unit that is not understood: "
                 + ", ".join(f"{k}={v!r}" for k, v in unknown.items()), declared=declared)
            return rep
        facs = set(parsed.values())
        if len(facs) > 1:
            _ref(rep, "VERTICAL_UNIT_CONFLICT", "the file declares conflicting vertical units", declared=declared)
            return rep
        factor = facs.pop()
        unit_label = next(iter(declared.values()))
        if factor != 1.0:
            _warn(rep, "VERTICAL_UNIT_CONVERTED", f"vertical unit {unit_label!r} converted to metres (x{factor})", factor=factor)
    else:
        if not assume_metres:
            _ref(rep, "VERTICAL_UNIT_UNDECLARED", "the file declares no vertical unit; metres are required "
                 "(pass assume_metres=True to proceed on the planner's word)")
            return rep
        _warn(rep, "METRES_ASSUMED", "no vertical unit is declared; metres assumed on the caller's say-so")
    scale = float(ds.scales[rep.band - 1] or 1.0)
    offset = float(ds.offsets[rep.band - 1] or 0.0)
    nodata = ds.nodata
    rep.vertical = {"declared_units": declared, "unit_used": unit_label, "factor_to_metres": factor, "scale": scale,
                    "offset": offset, "assumed_metres": not declared}
    rep._read = {"band": rep.band, "factor": factor, "scale": scale, "offset": offset, "nodata": nodata}
    scan = _scan_pixels(ds, rep.band, factor, scale, offset, nodata, n_samples)
    n_nodata = scan.n_nodata
    frac = n_nodata / n_px
    rep.nodata = {"declared_nodata": None if nodata is None else float(nodata), "count": n_nodata, "fraction": frac,
                  "valid_count": scan.n_valid}
    if scan.n_valid == 0:
        _ref(rep, "NO_VALID_DATA", "the raster contains no valid height")
        return rep
    rep.height_range_m = (scan.vmin, scan.vmax)
    if frac > th.max_nodata_fraction:
        _ref(rep, "NODATA_FRACTION_HIGH", f"{frac:.1%} of pixels have no data (limit {th.max_nodata_fraction:.0%})", fraction=frac)
    elif frac > th.warn_nodata_fraction:
        _warn(rep, "NODATA_HOLES", f"{frac:.1%} of pixels have no data; they fall through to the stores beneath", fraction=frac)
    sr, sc = np.meshgrid(scan.sample_rows, scan.sample_cols, indexing="ij")
    lat, lon = _pixel_to_lonlat(ds, crs, sr.ravel(), sc.ravel())
    rlat, rlon = _pixel_to_lonlat(ds, crs, scan.ring_rc[:, 0], scan.ring_rc[:, 1])
    allfin = np.concatenate([lat, rlat])
    if not np.all(np.isfinite(allfin)) or not np.all(np.isfinite(np.concatenate([lon, rlon]))):
        _ref(rep, "CRS_TRANSFORM_FAILED", "some pixel centres cannot be converted to lunar latitude/longitude with the declared CRS")
        return rep
    if np.any(np.abs(allfin) > 90.0 + 1e-6):
        _ref(rep, "OUTSIDE_MOON", "pixel centres map outside latitude +-90 degrees")
        return rep
    rep._ring_latlon = np.stack([rlat, rlon], 1)
    clat, clon = float(np.mean(lat)), float(np.angle(np.mean(np.exp(1j * np.radians(lon))), deg=True) % 360.0)
    dl = (np.concatenate([lon, rlon]) - clon + 180.0) % 360.0 - 180.0
    rep.footprint.update(lat_min=float(allfin.min()), lat_max=float(allfin.max()), lon_min=float((clon + dl.min()) % 360.0),
                         lon_max=float((clon + dl.max()) % 360.0), centre_lat=clat, centre_lon=clon)
    if base is None:
        base = _default_base()
    if base is None:
        ov = None
    else:
        vals = scan.sample_vals.ravel().astype(float)
        ov = compare_heights(vals, lat, lon, base, rep.footprint["area_km2"], n_sampled=vals.size)
    rep.overlap = ov
    if ov is None or ov.n < th.min_overlap_samples:
        n = 0 if ov is None else ov.n
        area = 0.0 if ov is None else ov.area_km2
        if allow_no_overlap and (ov is None or ov.covered_fraction < 0.5):
            rep.no_overlap_override = True
            _warn(rep, "UNVALIDATED_NO_OVERLAP", f"only {n} samples overlap the existing terrain: the DEM could not be "
                  "checked and is used on the caller's explicit override", n=n, area_km2=area)
        else:
            _ref(rep, "OVERLAP_TOO_SMALL", f"only {n} valid samples ({area:.2f} km2) overlap the existing terrain stores; "
                 f"at least {th.min_overlap_samples} are needed to judge the DEM",
                 n=n, area_km2=area, needed=th.min_overlap_samples, base_available=base is not None)
    if ov is not None and ov.n >= th.min_overlap_samples:
        _judge_overlap(rep, ov, th)
    if base is not None:
        hole_rc = scan.hole_rc
        hl, hlo = _pixel_to_lonlat(ds, crs, hole_rc[:, 0], hole_rc[:, 1]) if len(hole_rc) else (np.empty(0), np.empty(0))
        rep.boundary = _boundary_stats(scan, rlat, rlon, hl, hlo, base)
        _judge_boundary(rep, rep.boundary, th, ov.base_pixel_m_median if ov is not None else 20.0)
        if ov is not None and ov.n >= th.min_overlap_samples:
            sd = dict(summary)
            sd["px"] = rep.pixel_m
            rep.shift = _shift_scan(ds, rep.band, factor, scale, offset, nodata, crs, sd, base)
            if rep.shift and (rep.shift.row_px or rep.shift.col_px) and rep.shift.rms_at_best_m < 0.7 * rep.shift.rms_at_zero_m:
                _warn(rep, "HORIZONTAL_SHIFT", f"the DEM matches the stack better when shifted by ({rep.shift.row_px}, "
                      f"{rep.shift.col_px}) pixels ({rep.shift.metres_row:.0f}, {rep.shift.metres_col:.0f} m)",
                      **rep.shift.to_dict())
    _warn(rep, "FRAME_UNVERIFIED", "the tie of the DEM to the mean-Earth/polar-axis frame and its height reference "
          "are unverified assumptions of the engine; the planner must sign them off")
    _plan_grid(rep, summary)
    return rep


def _default_base() -> TerrainStack | None:
    try:
        return TerrainStack.open()
    except (OSError, ValueError):
        return None


def _judge_overlap(rep: DemReport, ov: OverlapStats, th: DemThresholds) -> None:
    d = dict(ov.to_dict())
    px = ov.base_pixel_m_median
    lim_med, lim_rms = th.median_limit_m(px), th.rms_limit_m(px)
    if abs(ov.median_m) > lim_med:
        _ref(rep, "VERTICAL_OFFSET", f"median(user - reference) = {ov.median_m:+.1f} m exceeds +-{lim_med:.1f} m "
             f"(reference pixel {px:.0f} m): a vertical datum offset", limit_m=lim_med, **d)
    elif abs(ov.median_m) > th.median_warn_m(px):
        _warn(rep, "VERTICAL_OFFSET_SMALL", f"median(user - reference) = {ov.median_m:+.1f} m (warn above "
              f"{th.median_warn_m(px):.1f} m)", **d)
    if ov.rms_m > lim_rms:
        _ref(rep, "RMS_TOO_LARGE", f"RMS(user - reference) = {ov.rms_m:.1f} m exceeds {lim_rms:.1f} m (reference pixel "
             f"{px:.0f} m)", limit_m=lim_rms, **d)
    elif ov.rms_m > th.rms_warn_fraction * lim_rms:
        _warn(rep, "RMS_ELEVATED", f"RMS(user - reference) = {ov.rms_m:.1f} m (limit {lim_rms:.1f} m)", **d)
    if ov.relief_sd_m >= th.relief_over_rms_limit * lim_rms and ov.correlation is not None:
        if ov.correlation < th.min_correlation:
            _ref(rep, "LOW_CORRELATION", f"correlation with the reference is {ov.correlation:.3f} (< {th.min_correlation}): "
                 "axes flipped/rotated, wrong georeferencing or not the same terrain", **d)
        if ov.scale_slope is not None and not (th.scale_range[0] <= ov.scale_slope <= th.scale_range[1]):
            _ref(rep, "VERTICAL_SCALE", f"regression slope of user on reference heights is {ov.scale_slope:.3f} (allowed "
                 f"{th.scale_range[0]}..{th.scale_range[1]}): wrong vertical scale", **d)
    else:
        _warn(rep, "CORRELATION_NOT_JUDGED", f"terrain relief in the overlap (sd {ov.relief_sd_m:.1f} m) is under "
              f"{th.relief_over_rms_limit:g}x the RMS limit, too small to test correlation and scale; only offset and RMS "
              "were checked", **d)
    if ov.covered_fraction < 0.5:
        _warn(rep, "PARTIAL_OVERLAP", f"only {ov.covered_fraction:.0%} of the DEM overlaps the existing stores; the rest is unchecked",
              **d)
    if px > 20 * (rep.pixel_m or 1.0):
        _warn(rep, "COARSE_REFERENCE", f"the reference terrain ({px:.0f} m pixels) is much coarser than "
              f"the DEM ({rep.pixel_m:.1f} m): small-scale agreement cannot be tested", **d)


def _judge_boundary(rep: DemReport, bd: BoundaryStats, th: DemThresholds, ref_px: float) -> None:
    if bd.ring_median_step_m is not None and abs(bd.ring_median_step_m) > th.boundary_median_limit_m(ref_px):
        _ref(rep, "BOUNDARY_CLIFF", f"the DEM differs from the terrain beneath by a median {bd.ring_median_step_m:+.1f} m "
             f"(limit {th.boundary_median_limit_m(ref_px):.1f} m) along its footprint edge: the seam would be a wall in "
             "horizon calculations", **bd.to_dict())
    mx = max([v for v in (bd.ring_max_abs_step_m, bd.hole_edge_max_abs_step_m) if v is not None], default=None)
    if mx is not None and mx > th.boundary_warn_m(ref_px):
        _warn(rep, "BOUNDARY_STEP", f"the largest step between the DEM and the terrain beneath is {mx:.1f} m "
              f"(footprint ring {bd.ring_max_abs_step_m}, hole edges {bd.hole_edge_max_abs_step_m}); seams can act as "
              "cliffs on horizons near the edge", **bd.to_dict())
    if bd.ring_covered_fraction < 0.5:
        _warn(rep, "BOUNDARY_UNCHECKED", "less than half of the footprint ring lies over existing terrain; the seam is "
              "unchecked there", ring_covered_fraction=bd.ring_covered_fraction)


def _plan_grid(rep: DemReport, summary: dict) -> None:
    """Decide how the overlay grid is laid out (stored in ``rep.grid_plan``)."""
    direct = summary.get("direct")
    t_unrot = True
    with gtiff_env(), rasterio.open(rep.path, driver="GTiff") as ds:
        t = ds.transform
        t_unrot = t.b == 0 and t.d == 0 and t.a > 0 and t.e < 0
    if direct and t_unrot:
        rep.grid_plan = {"mode": "direct", "kind": direct}
    else:
        rep.grid_plan = {"mode": "resample", "reason": "rotated/flipped grid" if direct else "projection not adopted directly"}


def _generic_geometry(rep: DemReport) -> GridGeometry:
    """Target grid for the resampling path: polar patch near a pole, else equirectangular."""
    ring = rep._ring_latlon
    if ring is None:
        raise ValueError("report carries no footprint ring")
    px = float(rep.pixel_m)
    clat, clon = rep.footprint["centre_lat"], rep.footprint["centre_lon"]
    if abs(clat) >= 80.0:
        pole = 1 if clat > 0 else -1
        x, y = polar_forward(ring[:, 0], ring[:, 1], pole)
        x0, x1, y0, y1 = float(x.min()) - px, float(x.max()) + px, float(y.min()) - px, float(y.max()) + px
        nc, nr = math.ceil((x1 - x0) / px), math.ceil((y1 - y0) / px)
        geom = GridGeometry(POLAR, pole, R_MOON_M, x0 + px / 2, y1 - px / 2, px, -px, nc, nr)
    else:
        dy = px / R_MOON_M * 180.0 / math.pi
        dx = dy / max(math.cos(math.radians(clat)), 1e-3)
        dl = (ring[:, 1] - clon + 180.0) % 360.0 - 180.0
        lon0, lon1 = clon + float(dl.min()) - dx, clon + float(dl.max()) + dx
        lat0, lat1 = float(ring[:, 0].min()) - dy, float(ring[:, 0].max()) + dy
        nc, nr = math.ceil((lon1 - lon0) / dx), math.ceil((lat1 - lat0) / dy)
        geom = GridGeometry(EQUIRECT, 0, R_MOON_M, lon0 + dx / 2, lat1 - dy / 2, dx, -dy, nc, nr)
    if geom.nrows * geom.ncols > MAX_PIXELS:
        raise IngestRefusal([Reason("TARGET_GRID_TOO_LARGE", f"the overlay grid would be {geom.nrows}x{geom.ncols} pixels", {})])
    return geom


def _direct_geometry(ds, kind: str) -> GridGeometry:
    t = ds.transform
    cx, cy = t.c + t.a / 2.0, t.f + t.e / 2.0
    if kind == "polar_south":
        return GridGeometry(POLAR, -1, R_MOON_M, cx, cy, t.a, t.e, ds.width, ds.height)
    if kind == "polar_north":
        return GridGeometry(POLAR, +1, R_MOON_M, cx, cy, t.a, t.e, ds.width, ds.height)
    if kind == "equirect_deg":
        return GridGeometry(EQUIRECT, 0, R_MOON_M, cx, cy, t.a, t.e, ds.width, ds.height)
    if kind == "equirect_eqc":
        k = 180.0 / (math.pi * R_MOON_M)
        return GridGeometry(EQUIRECT, 0, R_MOON_M, cx * k, cy * k, t.a * k, t.e * k, ds.width, ds.height)
    raise ValueError(kind)


def _bilinear_nan(src: np.ndarray, row: np.ndarray, col: np.ndarray) -> np.ndarray:
    """Bilinear sample at continuous pixel-centre coordinates; NaN outside or next to NaN (store semantics)."""
    h, w = src.shape
    ok = (row >= 0) & (row <= h - 1) & (col >= 0) & (col <= w - 1) & np.isfinite(row) & np.isfinite(col)
    r = np.where(ok, row, 0.0)
    c = np.where(ok, col, 0.0)
    r0 = np.clip(np.floor(r).astype(np.int64), 0, max(h - 2, 0))
    c0 = np.clip(np.floor(c).astype(np.int64), 0, max(w - 2, 0))
    fr, fc = r - r0, c - c0
    r1, c1 = np.minimum(r0 + 1, h - 1), np.minimum(c0 + 1, w - 1)
    z = src.astype(np.float64)
    v = (1 - fr) * ((1 - fc) * z[r0, c0] + fc * z[r0, c1]) + fr * ((1 - fc) * z[r1, c0] + fc * z[r1, c1])
    return np.where(ok, v, np.nan)


def _resampling_reader(ds, crs: CRS, geom: GridGeometry, rd: dict, chunk_rows: int = 128) -> RowReader:
    """Row reader resampling the source DEM (bilinear, NaN-propagating) onto ``geom`` strip by strip."""
    inv = ~ds.transform
    moon = CRS.from_wkt(_GEOG_WKT)

    def read_rows(r0: int, r1: int) -> np.ndarray:
        out = np.full((r1 - r0, geom.ncols), np.nan, np.float32)
        for a in range(r0, r1, chunk_rows):
            b = min(r1, a + chunk_rows)
            rr, cc = np.meshgrid(np.arange(a, b, dtype=float), np.arange(geom.ncols, dtype=float), indexing="ij")
            lat, lon = geom.rc_to_lonlat(rr, cc)
            x, y = warp_transform(moon, crs, np.asarray(lon).ravel().tolist(), np.asarray(lat).ravel().tolist())
            x, y = np.asarray(x, float), np.asarray(y, float)
            fin = np.isfinite(x) & np.isfinite(y)
            xf, yf = np.where(fin, x, 0.0), np.where(fin, y, 0.0)
            col_e, row_e = inv.a * xf + inv.b * yf + inv.c, inv.d * xf + inv.e * yf + inv.f
            row_c, col_c = np.where(fin, row_e - 0.5, np.nan), np.where(fin, col_e - 0.5, np.nan)
            if not fin.any():
                continue
            ra, rb = int(np.floor(np.nanmin(row_c))) - 1, int(np.ceil(np.nanmax(row_c))) + 2
            ra, rb = max(ra, 0), min(rb, ds.height)
            if rb <= ra:
                continue
            src = _valid_rows(ds, rd["band"], ra, rb, rd["factor"], rd["scale"], rd["offset"], rd["nodata"])
            out[a - r0 : b - r0] = _bilinear_nan(src, row_c - ra, col_c).reshape(b - a, geom.ncols).astype(np.float32)
        return out

    return read_rows


_DEM_ID_RE = re.compile(r"^user_[A-Za-z0-9_]{1,56}$")


def build_overlay_store(path: str | Path, report: DemReport, out_root: str | Path, dem_id: str | None = None) -> TerrainStore:
    """Build a canonical terrain store from an *accepted* user DEM (memory stays at a few row strips).

    Refuses (`IngestRefusal`) with `REPORT_REFUSED` for a refused report, `FILE_CHANGED` if the file's SHA-256 is no
    longer the inspected one, `BAD_DEM_ID` if ``dem_id`` is not of the form ``user_<alnum/_>`` (default
    ``user_<first 8 hex of the SHA-256>``). Heights are metres above the 1 737 400 m sphere; NaN stays NaN.
    """
    p = Path(path)
    if not report.accepted:
        raise IngestRefusal([Reason("REPORT_REFUSED", "the DEM report is a refusal; no store is built from a refused DEM",
                                    {"refusal_codes": report.refusal_codes})])
    if report.name != p.name or not report.sha256 or sha256_file(p) != report.sha256:
        raise refuse("FILE_CHANGED", "the file is not the one that was inspected (name or SHA-256 differ)", path=str(p))
    dem_id = dem_id or f"user_{report.sha256[:8]}"
    if not _DEM_ID_RE.match(dem_id):
        raise refuse("BAD_DEM_ID", "dem_id must match user_[A-Za-z0-9_]+ so it is obviously user-supplied", dem_id=dem_id)
    rd = report._read
    with gtiff_env(), rasterio.open(p, driver="GTiff") as ds:
        crs = ds.crs
        plan = report.grid_plan
        if plan["mode"] == "direct":
            geom = _direct_geometry(ds, plan["kind"])
            reader: RowReader

            def read_rows(r0: int, r1: int) -> np.ndarray:
                return _valid_rows(ds, rd["band"], r0, r1, rd["factor"], rd["scale"], rd["offset"], rd["nodata"])

            reader = read_rows
        else:
            geom = _generic_geometry(report)
            reader = _resampling_reader(ds, crs, geom, rd)
        label = {
            "file_name": p.name,
            "claimed_crs_name": report.crs_name,
            "claimed_crs_wkt": report.crs_wkt,
            "claimed_body": report.body,
            "source_size_px": [report.width, report.height],
            "source_pixel_m": report.pixel_m,
            "vertical": report.vertical,
            "grid_plan": plan,
            "resampling": "none (direct grid adoption)" if plan["mode"] == "direct" else "bilinear, NaN-propagating",
            "accepted_with_warnings": report.warning_codes,
            "overlap_vs_lola": report.overlap.to_dict() if report.overlap else None,
            "no_overlap_override": report.no_overlap_override,
        }
        src = SourceInfo(
            description=f"USER-SUPPLIED DEM {p.name} (unvalidated against ground truth)",
            url=f"user-supplied:{p.name}",
            sha256=report.sha256,
            label=label,
            frame=f"{BODY_FIXED_FRAME} (ASSUMED for a user-supplied DEM; claimed CRS: {report.crs_name})",
            pixel_size_m=float(report.pixel_m or 0.0),
            notes="user-supplied, unvalidated against ground truth; " + ("; ".join(w.code for w in report.warnings) or "no warnings"),
        )
        store = build_store(Path(out_root), dem_id, geom, reader, src)
    return store


class OverlayTerrainStack(TerrainStack):
    """A `TerrainStack` in which one user store has priority over every other store.

    `TerrainStack` sorts finest pixel first, so a coarse user DEM would lose to finer stores; this subclass
    puts the overlay first and keeps the base order after it, then rebuilds ``dem_ids`` and the bounding
    circles. `pack`, `height_and_store`, `select`, `stack_hash` and the horizon kernels all follow
    ``self.stores`` order, so the overlay wins wherever it has valid data and everything else behaves as in
    ``base``. ``stack_hash`` changes because the overlay's ``meta.json`` hash is part of it.
    """

    def __init__(self, base: TerrainStack, overlay: TerrainStore):
        if overlay.dem_id in base.dem_ids:
            raise ValueError(f"dem_id {overlay.dem_id!r} is already in the base stack")
        super().__init__([*base.stores, overlay])
        self.stores = (overlay, *base.stores)
        self.dem_ids = tuple(s.dem_id for s in self.stores)
        self._circles = [bounding_circle(s) for s in self.stores]
        self._packed = {}
        self.base = base
        self.overlay = overlay

    @classmethod
    def open(cls, *a, **k):
        raise TypeError("OverlayTerrainStack is built with overlay_stack(base, overlay)")


def overlay_stack(base: TerrainStack, overlay: TerrainStore) -> TerrainStack:
    """Stack in which ``overlay`` wins inside its valid footprint; identical to ``base`` elsewhere."""
    return OverlayTerrainStack(base, overlay)


__all__: Sequence[str] = [
    "BoundaryStats",
    "DemReport",
    "DemThresholds",
    "OverlapStats",
    "OverlayTerrainStack",
    "ShiftDiagnostic",
    "build_overlay_store",
    "classify_crs",
    "compare_heights",
    "inspect_geotiff",
    "overlay_stack",
]
