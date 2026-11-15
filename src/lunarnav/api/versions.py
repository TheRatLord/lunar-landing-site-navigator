"""Data and code versions that enter every result's cache key and provenance record."""

from __future__ import annotations

import hashlib
from importlib import metadata
from pathlib import Path
from typing import Any

from lunarnav.source import source_sha256 as engine_source_sha256


def code_version() -> str:
    """Installed ``lunarnav`` package version (``unknown`` when run from an uninstalled tree)."""
    try:
        return metadata.version("lunarnav")
    except metadata.PackageNotFoundError:
        return "unknown"


def kernel_hashes() -> dict[str, str]:
    """Pinned SHA-256 of every kernel in the ephemeris manifest (no SPICE call, no download)."""
    from lunarnav.ephem.kernels import MANIFEST

    return {spec.name: spec.sha256 for spec in MANIFEST}


def terrain_stores(data_dir: Path) -> list[dict[str, Any]]:
    """Describe the terrain stores under ``<data_dir>/dem/store`` (reads ``meta.json`` only).

    A store with unreadable metadata is listed with an ``error`` instead of being hidden.
    """
    import json

    root = data_dir / "dem" / "store"
    out: list[dict[str, Any]] = []
    if not root.is_dir():
        return out
    for meta_path in sorted(root.glob("*/meta.json")):
        raw = meta_path.read_bytes()
        entry: dict[str, Any] = {"dem_id": meta_path.parent.name, "meta_sha256": hashlib.sha256(raw).hexdigest()}
        try:
            meta = json.loads(raw)
            geom = meta.get("geometry", {})
            entry.update(
                description=meta.get("description", ""),
                projection=geom.get("kind"),
                pixel_size_m=meta.get("pixel_size_m"),
                shape=[geom.get("nrows"), geom.get("ncols")],
                n_levels=len(meta.get("levels", [])),
                source=meta.get("source"),
            )
        except (ValueError, AttributeError) as exc:
            entry["error"] = f"unreadable meta.json: {exc}"
        out.append(entry)
    return out


def terrain_signature(data_dir: Path) -> tuple:
    """Cheap fingerprint of the stores directory (names and `meta.json` mtimes, no reads): changes when a
    store is added, removed or re-ingested."""
    root = data_dir / "dem" / "store"
    if not root.is_dir():
        return ()
    sig = []
    for meta_path in sorted(root.glob("*/meta.json")):
        st = meta_path.stat()
        sig.append((meta_path.parent.name, st.st_mtime_ns, st.st_size))
    return tuple(sig)


def source_sha256() -> str:
    """The engine's `source_sha256("package")`: SHA-256 over every `lunarnav` file, the service and agent included
    (not the narrower `results` scope), because a cached response depends on the service's own code too."""
    return engine_source_sha256("package")


def results_source_sha256() -> str:
    """The engine's `source_sha256("results")`: the hash every result's provenance carries, as this process computed it."""
    return engine_source_sha256("results")


def data_versions(data_dir: Path) -> dict[str, Any]:
    """Everything a cached result depends on besides the request and the endpoint's own version."""
    return {
        "code": code_version(),
        "source": source_sha256(),
        "kernels": kernel_hashes(),
        "terrain": {s["dem_id"]: s["meta_sha256"] for s in terrain_stores(data_dir)},
    }
