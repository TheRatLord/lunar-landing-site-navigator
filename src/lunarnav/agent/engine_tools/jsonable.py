"""Conversion of engine results (dataclasses, numpy, pydantic) to compact JSON-safe structures."""

from __future__ import annotations

import dataclasses
import enum
import math
from collections.abc import Mapping
from typing import Any

import numpy as np
from pydantic import BaseModel

from lunarnav.ephem import et_to_utc

SIG_DIGITS = 8
MAX_ARRAY = 200_000


_SECONDS_PER_UNIT = (("_hours", 3600.0), ("_days", 86400.0), ("_min", 60.0), ("_h", 3600.0), ("_d", 86400.0), ("_s", 1.0))
"""Unit suffixes of a duration key and the seconds in that unit."""


def _round(x: float) -> float | None:
    if not math.isfinite(x):
        return None
    if x == 0.0:
        return 0.0
    return float(f"{x:.{SIG_DIGITS}g}")


def _seconds_per_unit(key: str) -> float | None:
    """Seconds in the unit of a time-like key: ``et`` (ET seconds) or a duration suffix (``hold_s``, ``..._h``)."""
    if key == "et":
        return 1.0
    low = key.lower()
    return next((f for suffix, f in _SECONDS_PER_UNIT if low.endswith(suffix)), None)


def _round_time(x: float, per_unit_s: float) -> float | None:
    """A time or duration to whichever is finer: 8 significant digits or one millisecond. Eight digits alone put an ET
    (9 digits before the point) 3 s off and a 1.2-million-second hold 13 ms off."""
    coarse = _round(x)
    if coarse is None or coarse == 0.0:
        return coarse
    fine = round(x, math.ceil(math.log10(per_unit_s / 0.001)))
    return fine if abs(fine - x) < abs(coarse - x) else coarse


def _time_value(v: Any, per_unit_s: float) -> Any:
    if isinstance(v, (float, np.floating)):
        return _round_time(float(v), per_unit_s)
    if isinstance(v, (list, tuple)):
        return [_time_value(x, per_unit_s) for x in v]
    return None if v is None else jsonable(v)


def jsonable(obj: Any, *, skip: frozenset[str] = frozenset()) -> Any:
    """JSON-safe copy of ``obj``.

    Floats are rounded to 8 significant digits (non-finite values become null; the value of a time-like key, ``et`` or a
    duration suffix such as ``hold_s``, ``..._h``, keeps at least a millisecond), arrays become lists,
    dataclass fields named in ``skip`` are dropped, and every ``<name>_et`` field (ET seconds) is replaced
    by ``<name>_utc`` so the model never has to convert epochs.
    """
    if obj is None or isinstance(obj, (bool, str)):
        return obj
    if isinstance(obj, enum.Enum):
        return obj.name
    if isinstance(obj, (int, np.integer)):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        return _round(float(obj))
    if isinstance(obj, np.ndarray):
        if obj.size > MAX_ARRAY:
            raise ValueError(f"array of {obj.size} elements is too large to inline; write it to a file")
        return jsonable(obj.tolist(), skip=skip)
    if isinstance(obj, BaseModel):
        return jsonable(obj.model_dump(mode="json"), skip=skip)
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return jsonable({f.name: getattr(obj, f.name) for f in dataclasses.fields(obj) if f.name not in skip},
                        skip=skip)
    if isinstance(obj, Mapping):
        out: dict[str, Any] = {}
        for k, v in obj.items():
            key = str(k)
            if key.endswith("_et") and (utc := _utc_of(v)) is not None:
                out[key[:-3] + "_utc"] = utc
            elif (per_s := _seconds_per_unit(key)) is not None and isinstance(v, (float, np.floating, list, tuple)):
                out[key] = _time_value(v, per_s)
            else:
                out[key] = jsonable(v, skip=skip)
        return out
    if isinstance(obj, (list, tuple)):
        return [jsonable(v, skip=skip) for v in obj]
    return str(obj)


def _utc_of(v: Any) -> Any:
    if isinstance(v, (float, int, np.floating, np.integer)) and not isinstance(v, bool):
        return et_to_utc(float(v), 0) if math.isfinite(float(v)) else None
    if isinstance(v, (list, tuple)) and v and all(isinstance(x, (float, int, np.floating, np.integer)) for x in v):
        return [et_to_utc(float(x), 0) if math.isfinite(float(x)) else None for x in v]
    return None


def head(rows: list[Any], n: int) -> dict[str, Any]:
    """``{"n_total": N, "rows": first n}`` plus a ``truncated`` flag, for compact listings."""
    return {"n_total": len(rows), "truncated": len(rows) > n, "rows": rows[:n]}
