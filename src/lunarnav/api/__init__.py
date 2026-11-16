"""HTTP service for Moonwalkr (FastAPI).

`create_app` is imported lazily so that pool worker processes importing `lunarnav.api.jobworker` do not
pay for FastAPI.
"""

from __future__ import annotations

from typing import Any

__all__ = ["Settings", "create_app"]


def __getattr__(name: str) -> Any:
    if name == "create_app":
        from lunarnav.api.app import create_app

        return create_app
    if name == "Settings":
        from lunarnav.api.settings import Settings

        return Settings
    raise AttributeError(name)
