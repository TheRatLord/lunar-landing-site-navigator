"""Errors raised by the report module."""

from __future__ import annotations

from typing import Any


class ReportInputError(ValueError):
    """A result the report needs is absent or inconsistent. The report never fills a gap."""


def parse_generated_utc(text: str) -> str:
    """`text` as `YYYY-MM-DDTHH:MM:SSZ` (the form `YYYY-MM-DDTHH:MMZ` is accepted and completed); anything else raises."""
    from datetime import datetime

    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%MZ"):
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m-%dT%H:%M:%SZ")
        except (ValueError, TypeError):
            continue
    raise ReportInputError(f"generation time {text!r} is not an ISO-8601 UTC time with a Z suffix, e.g. 2026-01-01T00:00:00Z")


def need(obj: Any, name: str, where: str) -> Any:
    """`obj.name` (or `obj[name]` for a mapping); raise `ReportInputError` naming `where` when absent or None."""
    if isinstance(obj, dict):
        value = obj.get(name)
    else:
        value = getattr(obj, name, None)
    if value is None:
        raise ReportInputError(f"required result is absent: {where}.{name}")
    return value
