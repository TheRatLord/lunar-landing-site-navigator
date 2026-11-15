from __future__ import annotations

import hashlib
from collections.abc import Sequence
from functools import cached_property
from pathlib import Path

import numpy as np
import yaml

from lunarnav.oracle.model import HERE, NotRun
from lunarnav.terrain.paths import data_root


class Context:
    def __init__(self, quick: bool = False) -> None:
        self.quick = quick
        self.pins = yaml.safe_load((HERE / "pins.yaml").read_text(encoding="utf-8"))
        self._stacks: dict[tuple[str, ...], object] = {}

    @cached_property
    def data(self) -> Path:
        return data_root()

    @cached_property
    def reference(self) -> Path:
        return self.data / "validation" / "reference"

    def furnish(self):
        from lunarnav.ephem import load_kernels

        try:
            return load_kernels()
        except Exception as exc:
            raise NotRun(f"SPICE kernels not available: {exc}") from exc

    def need(self, *relative: str) -> list[Path]:
        paths = [self.reference / r for r in relative]
        missing = [str(p.relative_to(self.data)) for p in paths if not p.exists()]
        if missing:
            raise NotRun("reference files missing under the data directory: " + ", ".join(missing))
        return paths

    def pinned(self, name: str) -> Path:
        spec = self.pins["downloads"][name]
        path = self.reference / spec["path"]
        if not path.exists():
            raise NotRun(f"{spec['path']} not downloaded; run `lunarnav oracle fetch`")
        if sha256(path) != spec["sha256"]:
            raise RuntimeError(f"{path} does not match its pinned SHA-256")
        return path

    @cached_property
    def default_stack(self):
        from lunarnav.terrain import TerrainStack

        root = self.data / "dem" / "store"
        if not any(root.glob("*/meta.json")):
            raise NotRun("no terrain stores under the data directory")
        stack = TerrainStack.open()
        if stack.stack_hash != self.pins["stack_hash"]:
            raise RuntimeError(
                f"default terrain stack hash {stack.stack_hash[:12]} is not the pinned {self.pins['stack_hash'][:12]}; "
                "the tolerances were set for the pinned stack"
            )
        return stack

    def stack(self, dem_ids: Sequence[str]):
        from lunarnav.terrain import TerrainStack

        key = tuple(dem_ids)
        if key not in self._stacks:
            root = self.data / "dem" / "store"
            missing = [i for i in key if not (root / i / "meta.json").exists()]
            if missing:
                raise NotRun("terrain stores missing: " + ", ".join(missing))
            stack = TerrainStack.open(key)
            want = self.pins["store_meta_sha256"]
            for store in stack.stores:
                if store.dem_id in want and store.meta_hash != want[store.dem_id]:
                    raise RuntimeError(f"terrain store {store.dem_id} is not the pinned build")
            self._stacks[key] = stack
        return self._stacks[key]

    def rng(self, seed: int) -> np.random.Generator:
        return np.random.default_rng(seed)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()
