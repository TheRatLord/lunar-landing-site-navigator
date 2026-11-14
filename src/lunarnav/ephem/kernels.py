"""SPICE kernel management: download, SHA-256 pinning, loading and coverage reporting.

The kernel set is fixed by `MANIFEST`. Every file is fetched from the NAIF generic-kernel
server, verified against its pinned SHA-256 and size, and furnished once per process.
NAIF moves superseded files into an `a_old_versions/` sub-directory, so that location is
tried when the primary URL no longer serves the pinned file.

Earth orientation: the pinned pair is the high-accuracy historical PCK
(`earth_620120_260806.bpc`, EOP data to 2026-08-06) and the long-term predict PCK
(`earth_2026_260806_2126_predict.bpc`, to 2126). NAIF's daily `earth_latest_high_prec.bpc`
cannot be hash-pinned because it changes every day; for lunar-site geometry the difference
(UT1 prediction error of order 0.1 s, i.e. under 0.002 deg of Earth rotation) is far below the
accuracy claims of this module (see docs/validation/ephemeris.md).
"""

from __future__ import annotations

import hashlib
import os
import threading
from dataclasses import dataclass
from pathlib import Path

import httpx
import spiceypy as spice

NAIF_BASE_URL = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/"


@dataclass(frozen=True, slots=True)
class KernelSpec:
    """One pinned kernel: path relative to `NAIF_BASE_URL`, expected size and SHA-256."""

    relpath: str
    size_bytes: int
    sha256: str
    role: str
    coverage_id: int | None = None
    """NAIF body ID (SPK) or frame class ID (binary PCK) whose coverage is reported."""

    @property
    def name(self) -> str:
        """File name without directory."""
        return self.relpath.rsplit("/", 1)[-1]


MANIFEST: tuple[KernelSpec, ...] = (
    KernelSpec(
        "lsk/naif0012.tls",
        5257,
        "678e32bdb5a744117a467cd9601cd6b373f0e9bc9bbde1371d5eee39600a039b",
        "leap seconds",
    ),
    KernelSpec(
        "pck/pck00011.tpc",
        131226,
        "3dff7b1dbeceaa01f25467767d3fa25816051c85d162d1edf04acb310ee28bb1",
        "planetary constants (IAU 2015 radii, WGS84 Earth via BODY399_RADII)",
    ),
    KernelSpec(
        "spk/planets/de440.bsp",
        119799808,
        "a4ce9bf9b3282becc9f4b2ac3cebe03a2ae7599981aabd7265fd8482fff7c4b5",
        "DE440 planetary and lunar ephemeris (1550-2650)",
        301,
    ),
    KernelSpec(
        "pck/moon_pa_de440_200625.bpc",
        12863488,
        "60cd55aa401ea2ea97360636f567554bfe4e37bb829f901b4460a455dfaf783f",
        "DE440 lunar principal-axis orientation",
        31008,
    ),
    KernelSpec(
        "fk/satellites/moon_de440_250416.tf",
        19478,
        "a47c71e9c9f33796bdafb2c9d69a7ee447b6016ecad80f71cd6f3e479f9cf768",
        "lunar frames: MOON_PA, MOON_ME (DE440 PA rotated to the DE421-aligned ME)",
    ),
    KernelSpec(
        "pck/earth_2026_260806_2126_predict.bpc",
        19169280,
        "9f565ab5aaccd33afe54f3a1b20cb8b136636c31a0bd4c0986fac722b931c280",
        "Earth orientation, long-term predict (loaded first, lower priority)",
        3000,
    ),
    KernelSpec(
        "pck/earth_620120_260806.bpc",
        12274688,
        "652b02c0b3a5a283d393497f7f96e1fe4aa47ee6dcc035a089eb9e6b5df86643",
        "Earth orientation, high-accuracy historical (overrides predict where both cover)",
        3000,
    ),
    KernelSpec(
        "spk/stations/earthstns_itrf93_260814.bsp",
        26624,
        "007eb0aad5dd022c6d61bdbfb2395680bd1eb31c49a8637d0b0a1cfbea737c6b",
        "DSN station positions, ITRF93 (DSN 810-005 301 Rev. P)",
        399014,
    ),
    KernelSpec(
        "fk/stations/earth_topo_260814.tf",
        69400,
        "4f40cd1e86718047bc8ea6ff6bd063c9fbf36102b63f0dca370c8e94fd282490",
        "DSN station topocentric frames",
    ),
)
"""Kernels in furnish order. Later files take precedence where coverage overlaps."""


@dataclass(frozen=True, slots=True)
class KernelFile:
    """A verified, loaded kernel file."""

    name: str
    path: str
    url: str
    size_bytes: int
    sha256: str
    role: str
    coverage_utc: tuple[str, str] | None
    """First and last covered instant (ISO-8601 UTC) for binary kernels, else None."""


@dataclass(frozen=True, slots=True)
class KernelSet:
    """The loaded kernel set and the epoch range over which all time-dependent kernels are valid."""

    files: tuple[KernelFile, ...]
    valid_et: tuple[float, float]
    """Intersection of ephemeris, lunar-orientation and Earth-orientation coverage (TDB s past J2000)."""

    def provenance(self) -> dict[str, str]:
        """Mapping of kernel file name to SHA-256, for result provenance records."""
        return {f.name: f.sha256 for f in self.files}


SPICE_LOCK = threading.RLock()
"""CSPICE keeps global state and is not thread-safe: every SPICE call in this package holds this lock."""
_LOADED: KernelSet | None = None


def kernel_dir() -> Path:
    """Directory holding kernels: `$LUNARNAV_DATA/kernels`, else `<repo>/data/kernels`."""
    root = os.environ.get("LUNARNAV_DATA")
    base = Path(root) if root else Path(__file__).resolve().parents[3] / "data"
    return base / "kernels"


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _candidate_urls(spec: KernelSpec) -> list[str]:
    directory, name = spec.relpath.rsplit("/", 1)
    return [NAIF_BASE_URL + spec.relpath, f"{NAIF_BASE_URL}{directory}/a_old_versions/{name}"]


def _download(spec: KernelSpec, dest: Path) -> str:
    """Fetch `spec` into `dest` atomically; return the URL that served the verified file."""
    tmp = dest.with_suffix(dest.suffix + ".part")
    errors: list[str] = []
    for url in _candidate_urls(spec):
        h = hashlib.sha256()
        try:
            with httpx.stream("GET", url, timeout=120.0, follow_redirects=True) as resp:
                if resp.status_code != 200:
                    errors.append(f"{url}: HTTP {resp.status_code}")
                    continue
                with tmp.open("wb") as fh:
                    for chunk in resp.iter_bytes(1 << 20):
                        h.update(chunk)
                        fh.write(chunk)
        except httpx.HTTPError as exc:
            errors.append(f"{url}: {exc}")
            continue
        if h.hexdigest() == spec.sha256 and tmp.stat().st_size == spec.size_bytes:
            tmp.replace(dest)
            return url
        errors.append(f"{url}: SHA-256 {h.hexdigest()} does not match pinned {spec.sha256}")
    tmp.unlink(missing_ok=True)
    raise RuntimeError(f"cannot obtain pinned kernel {spec.name}: " + "; ".join(errors))


def _file_status(spec: KernelSpec, path: Path) -> str:
    if not path.is_file():
        return "MISSING"
    if path.stat().st_size != spec.size_bytes:
        return "SIZE MISMATCH"
    if _sha256(path) != spec.sha256:
        return "SHA-256 MISMATCH"
    return "ok"


def verify_kernels() -> list[tuple[KernelSpec, str]]:
    directory = kernel_dir()
    return [(spec, _file_status(spec, directory / spec.name)) for spec in MANIFEST]


def missing_kernels() -> list[KernelSpec]:
    directory = kernel_dir()
    return [spec for spec in MANIFEST if not (directory / spec.name).exists()]


def _ensure_file(spec: KernelSpec, directory: Path) -> tuple[Path, str]:
    path = directory / spec.name
    url = _candidate_urls(spec)[0]
    if _file_status(spec, path) == "ok":
        return path, url
    return path, _download(spec, path)


def _coverage(spec: KernelSpec, path: Path) -> tuple[float, float] | None:
    if spec.coverage_id is None:
        return None
    cell = (spice.spkcov if path.suffix == ".bsp" else spice.pckcov)(str(path), spec.coverage_id)
    n = spice.wncard(cell)
    if n == 0:
        raise RuntimeError(f"{spec.name} has no coverage for ID {spec.coverage_id}")
    first, _ = spice.wnfetd(cell, 0)
    _, last = spice.wnfetd(cell, n - 1)
    return first, last


def _et_iso(et: float) -> str:
    return str(spice.et2utc(et, "ISOC", 0)) + "Z"


def load_kernels() -> KernelSet:
    """Download (if needed), verify and furnish the pinned kernel set; return its description.

    Idempotent and thread-safe: the first call does the work, later calls return the same
    `KernelSet`. A file whose size or hash does not match the manifest is re-downloaded; a
    download that does not match raises `RuntimeError`, never loads unverified data.
    """
    global _LOADED
    with SPICE_LOCK:
        if _LOADED is not None:
            return _LOADED
        directory = kernel_dir()
        directory.mkdir(parents=True, exist_ok=True)
        resolved = [(spec, *_ensure_file(spec, directory)) for spec in MANIFEST]
        for _, path, _ in resolved:
            spice.furnsh(str(path))
        files: list[KernelFile] = []
        windows: dict[str, list[tuple[float, float]]] = {}
        for spec, path, url in resolved:
            cov = _coverage(spec, path)
            if cov is not None and spec.coverage_id in (301, 31008, 3000):
                windows.setdefault(str(spec.coverage_id), []).append(cov)
            files.append(
                KernelFile(
                    name=spec.name,
                    path=str(path),
                    url=url,
                    size_bytes=spec.size_bytes,
                    sha256=spec.sha256,
                    role=spec.role,
                    coverage_utc=None if cov is None else (_et_iso(cov[0]), _et_iso(cov[1])),
                )
            )
        spans = [(min(a for a, _ in w), max(b for _, b in w)) for w in windows.values()]
        valid = (max(a for a, _ in spans), min(b for _, b in spans))
        _LOADED = KernelSet(files=tuple(files), valid_et=valid)
        return _LOADED
