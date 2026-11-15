from __future__ import annotations

import hashlib
from functools import cache
from pathlib import Path
from typing import Literal

DATA_SUFFIXES = (".yaml", ".yml", ".json", ".csv", ".toml")
"""Packaged data files included in the source hash (the catalogue YAML sets heights, areas and positions)."""


CLIENT_PACKAGES = ("api", "agent")
"""Subpackages that are clients of the engine and produce no numbers; the `results` scope leaves them out."""

SourceScope = Literal["results", "package"]


def _hash_tree(exclude: tuple[str, ...]) -> str:
    root = Path(__file__).resolve().parent
    h = hashlib.sha256()
    files = [f for f in root.rglob("*") if f.is_file() and "__pycache__" not in f.parts and (
        f.suffix == ".py" or f.suffix in DATA_SUFFIXES) and f.relative_to(root).parts[0] not in exclude]
    for f in sorted(files):
        h.update(str(f.relative_to(root)).encode())
        h.update(f.read_bytes())
    return h.hexdigest()


@cache
def _source_hashes() -> dict[str, str]:
    return {"results": _hash_tree(CLIENT_PACKAGES), "package": _hash_tree(())}


def source_sha256(scope: SourceScope = "results") -> str:
    """SHA-256 over `lunarnav` code and packaged data (path-sorted), in one of two named scopes.

    * `"results"` (default): everything except the client packages `api/` and `agent/` (engine packages, catalogue data,
      `report/`). A change here can change a number or a printed sentence. Use it for **freshness of exported reports**
      (this is what `code_version()["source_sha256"]` and every result's provenance carry).
    * `"package"`: the whole package, clients included. Use it for the **service cache key**, so any code change in the
      service also drops cached responses."""
    return _source_hashes()[scope]
