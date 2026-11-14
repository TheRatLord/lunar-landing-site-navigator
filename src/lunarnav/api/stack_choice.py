"""The terrain stack a scenario may choose: the selectable stores and the request-time checks of `terrain_stores`.

The service has no store order of its own. The listing is ordered by the engine's precedence rule (`TerrainStack`: finest
pixel first, then the better stated error), and a restricted stack is built by `TerrainStack.open(dem_ids=...)`, which
applies the same rule to whatever order the client sent. Everything here reads `meta.json` and memory-maps the arrays;
it never calls SPICE, so it is safe in the API process.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

import numpy as np

from lunarnav.api.errors import ApiProblem
from lunarnav.api.versions import terrain_signature, terrain_stores

_lock = threading.Lock()
_listing: dict[tuple[str, tuple], list[dict[str, Any]]] = {}
_stores: dict[tuple[str, int], Any] = {}
_MAX_OPEN_STORES = 128


def _open_store(root: Path, dem_id: str) -> Any:
    """A memory-mapped store, kept while its `meta.json` is unchanged."""
    from lunarnav.terrain.store import TerrainStore

    path = root / dem_id
    key = (str(path), (path / "meta.json").stat().st_mtime_ns)
    with _lock:
        if key not in _stores:
            if len(_stores) >= _MAX_OPEN_STORES:
                _stores.clear()
            _stores[key] = TerrainStore(path)
        return _stores[key]


def selectable_stores(data_dir: Path) -> list[dict[str, Any]]:
    """Every readable store in the engine's precedence order (the order of the default stack), with what a planner
    needs to choose: `precedence` (1 = wins where it has data), `pixel_size_m`, the stated vertical and horizontal
    error (`sigma_z_m`, `sigma_xy_m`, `error_basis_z`, `error_source`) and `coverage`, the bounding circle of the
    footprint (`whole_moon` for a global grid). A store that cannot be read is left out here (`GET /meta` still lists
    it with its error). Cached until the stores change."""
    root = data_dir / "dem" / "store"
    key = (str(data_dir), terrain_signature(data_dir))
    with _lock:
        if key in _listing:
            return _listing[key]
    from lunarnav.terrain import TerrainStack
    from lunarnav.terrain.stack import bounding_circle

    readable = []
    for meta in sorted(root.glob("*/meta.json")):
        try:
            readable.append(_open_store(root, meta.parent.name))
        except (OSError, ValueError, KeyError):
            continue
    rows: list[dict[str, Any]] = []
    if readable:
        stack = TerrainStack(readable)
        for i, (store, err) in enumerate(zip(stack.stores, stack.error_table()), start=1):
            circle = bounding_circle(store)
            rows.append({
                "dem_id": store.dem_id, "precedence": i, "pixel_size_m": store.pixel_size_m,
                "sigma_z_m": err["sigma_z_m"], "sigma_xy_m": err["sigma_xy_m"], "error_basis_z": err["basis_z"],
                "error_source": err["source"],
                "coverage": {"whole_moon": circle is None, "centre_lat_deg": None if circle is None else circle[0],
                             "centre_lon_deg": None if circle is None else circle[1],
                             "radius_deg": None if circle is None else float(np.degrees(circle[2]))},
            })
    with _lock:
        _listing.clear()
        _listing[key] = rows
    return rows


def listed_stores(data_dir: Path) -> list[dict[str, Any]]:
    """`GET /meta` `terrain_stores`: the metadata of every store (an unreadable one with its `error`), the readable ones in
    the engine's precedence order with their selection details, the others after them by name."""
    meta = {m["dem_id"]: m for m in terrain_stores(data_dir)}
    order = selectable_stores(data_dir)
    listed = [{**meta.pop(row["dem_id"], {}), **row} for row in order]
    return listed + [meta[k] for k in sorted(meta)]


def terrain_mode(mode: str, data_dir: Path) -> tuple[str, list[str]]:
    """Resolve `auto|on|off` to `on|off` against the installed stores; returns warnings for the result."""
    if mode == "off":
        return "off", ["terrain disabled by the request: smooth-sphere horizons (no terrain masking)"]
    if terrain_signature(data_dir):
        return "on", []
    if mode == "on":
        raise ApiProblem(422, "No terrain stores", "terrain=on but no stores are installed; use terrain=auto or off.")
    return "off", ["no terrain stores are installed: smooth-sphere horizons (no terrain masking)"]


def _refuse(loc: list[str], message: str, kind: str) -> ApiProblem:
    return ApiProblem(422, "Invalid terrain stack", message, errors=[{"loc": loc, "msg": message, "type": kind}])


def check_terrain_stores(document: dict[str, Any], mode: str, data_dir: Path, loc: list[str] | None = None) -> None:
    """Refuse (422, field-level) a scenario whose `terrain_stores` cannot be used: terrain is off, an id is not an
    installed store, or the chosen stores have no ground at the site. A null field (the default stack) always passes."""
    ids = document.get("terrain_stores")
    if ids is None:
        return
    where = (loc if loc is not None else ["body", "scenario"]) + ["terrain_stores"]
    if mode == "off":
        raise _refuse(where, "`terrain_stores` chooses a terrain stack but terrain is off for this request (`terrain` is `off`, or "
                      "no stores are installed); drop the field or use terrain `on`", "terrain_off")
    known = {row["dem_id"] for row in selectable_stores(data_dir)}
    unknown = [i for i in ids if i not in known]
    if unknown:
        raise _refuse(where, f"unknown terrain store(s) {unknown}; the selectable ids are listed by GET /meta (`terrain_stores`)", "unknown_store")
    site = document["site"]
    root = data_dir / "dem" / "store"
    lat, lon = float(site["lat_deg"]), float(site["lon_deg"])
    if not any(bool(np.isfinite(_open_store(root, i).height(lat, lon)).any()) for i in ids):
        raise _refuse(where, f"the chosen stores {sorted(ids)} have no ground at the site ({lat:g}, {lon:g}); add a store that covers it", "no_ground")


def require_common_stores(documents: list[dict[str, Any]], where: str) -> None:
    """A comparison runs on one provider, so every scenario must choose the same stack (or none)."""
    stacks = {None if d.get("terrain_stores") is None else tuple(sorted(d["terrain_stores"])) for d in documents}
    if len(stacks) > 1:
        raise ApiProblem(422, "Different terrain stacks", f"the scenarios of {where} choose different `terrain_stores`; "
                         "a comparison uses one terrain stack, so give them all the same list (or none)")
