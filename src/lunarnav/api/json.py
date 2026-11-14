"""orjson encoding shared by responses, the job cache and event streams."""

from __future__ import annotations

from pathlib import PurePath
from typing import Any

import orjson
from fastapi.responses import JSONResponse

_OPTIONS = orjson.OPT_SERIALIZE_NUMPY | orjson.OPT_NON_STR_KEYS


def _default(obj: Any) -> Any:
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json")
    if isinstance(obj, PurePath):
        return str(obj)
    raise TypeError(f"not JSON serialisable: {type(obj).__name__}")


def dumps(value: Any, *, canonical: bool = False) -> bytes:
    """Serialise to JSON bytes. NaN/inf become ``null``. `canonical` sorts keys (for hashing)."""
    opts = _OPTIONS | (orjson.OPT_SORT_KEYS if canonical else 0)
    return orjson.dumps(value, default=_default, option=opts)


loads = orjson.loads


class ORJSONResponse(JSONResponse):
    """JSON response encoded with orjson (numpy arrays supported). A JSONResponse subclass so that FastAPI
    publishes the declared response models in the OpenAPI document (a plain Response is documented as a string)."""

    media_type = "application/json"

    def render(self, content: Any) -> bytes:
        return dumps(content)
