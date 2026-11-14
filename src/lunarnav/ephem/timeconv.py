"""UTC <-> ephemeris time (TDB seconds past J2000) conversion.

Boundary format is ISO-8601 UTC with a `Z` suffix. Leap seconds follow the pinned LSK
(`naif0012.tls`); instants after the last tabulated leap second assume no further leap seconds.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import overload

import numpy as np
import spiceypy as spice

from lunarnav.ephem.kernels import SPICE_LOCK, load_kernels

_ISO = re.compile(r"^\s*(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|\+00:?00)?\s*$")

UtcLike = str | datetime | np.datetime64


def _to_spice_string(value: UtcLike) -> str:
    """Normalise one UTC instant to a string SPICE parses as UTC (never a foreign time system)."""
    if isinstance(value, np.datetime64):
        value = str(np.datetime_as_string(value, unit="ns"))
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            value = value.astimezone(UTC)
        return value.strftime("%Y-%m-%dT%H:%M:%S.%f")
    if not isinstance(value, str):
        raise TypeError(f"unsupported UTC value type: {type(value).__name__}")
    m = _ISO.match(value)
    if m is None:
        raise ValueError(f"not an ISO-8601 UTC instant (YYYY-MM-DDTHH:MM[:SS[.fff]][Z]): {value!r}")
    return f"{m.group(1)}T{m.group(2)}"


@overload
def utc_to_et(utc: UtcLike) -> float: ...
@overload
def utc_to_et(utc: Iterable[UtcLike]) -> np.ndarray: ...
def utc_to_et(utc: UtcLike | Iterable[UtcLike]) -> float | np.ndarray:
    """Convert ISO-8601 UTC (`2025-03-14T06:58:41.7Z`) to ET (TDB s past J2000), `float64`.

    Accepts a string, `datetime` (naive = UTC) or `numpy.datetime64`, or an iterable/array of
    them. Offsets other than UTC are rejected. A scalar input returns a Python `float`.
    """
    load_kernels()
    if isinstance(utc, (str, datetime, np.datetime64)):
        text = _to_spice_string(utc)
        with SPICE_LOCK:
            return float(spice.str2et(text))
    if isinstance(utc, np.ndarray) and utc.dtype.kind == "M":
        items: list[UtcLike] = list(utc.ravel())
    else:
        items = list(np.asarray(utc, dtype=object).ravel()) if isinstance(utc, np.ndarray) else list(utc)
    texts = [_to_spice_string(v) for v in items]
    with SPICE_LOCK:
        out = np.fromiter((spice.str2et(t) for t in texts), dtype=np.float64, count=len(texts))
    return out.reshape(np.shape(utc)) if isinstance(utc, np.ndarray) else out


@overload
def et_to_utc(et: float, digits: int = 3) -> str: ...
@overload
def et_to_utc(et: Iterable[float], digits: int = 3) -> np.ndarray: ...
def et_to_utc(et: float | Iterable[float], digits: int = 3) -> str | np.ndarray:
    """Convert ET to ISO-8601 UTC with `Z` suffix and `digits` fractional-second digits.

    A scalar returns `str`; an array returns an object array of `str` with the same shape.
    Leap-second instants are rendered as `23:59:60`. The result is rounded (not truncated) by SPICE.
    Non-finite input (NaN is the engine's "no event" value) raises `ValueError`; handle missing events before calling.
    """
    load_kernels()
    arr = np.asarray(et, dtype=np.float64)
    if not np.isfinite(arr).all():
        raise ValueError("et_to_utc requires finite epochs; NaN/inf (e.g. 'no event') has no UTC date")
    with SPICE_LOCK:
        if arr.ndim == 0:
            return str(spice.et2utc(float(arr), "ISOC", digits)) + "Z"
        flat = arr.ravel()
        out = np.empty(flat.shape, dtype=object)
        for i, v in enumerate(flat):
            out[i] = str(spice.et2utc(float(v), "ISOC", digits)) + "Z"
    return out.reshape(arr.shape)
