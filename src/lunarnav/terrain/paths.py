"""Locations of terrain data on disk."""

from __future__ import annotations

import os
from pathlib import Path


def data_root() -> Path:
    """Project ``data/`` directory (override with the ``LUNARNAV_DATA`` environment variable)."""
    env = os.environ.get("LUNARNAV_DATA")
    if env:
        return Path(env)
    for parent in Path(__file__).resolve().parents:
        if (parent / "pyproject.toml").exists():
            return parent / "data"
    return Path.cwd() / "data"


def raw_dir() -> Path:
    """Downloaded source products (``data/dem/raw``)."""
    return data_root() / "dem" / "raw"


def store_dir() -> Path:
    """Canonical stores (``data/dem/store``)."""
    return data_root() / "dem" / "store"


def horizon_cache_dir() -> Path:
    """Horizon profile cache (``data/horizon_cache``)."""
    return data_root() / "horizon_cache"
