from __future__ import annotations

from collections.abc import Iterator

import httpx
import yaml

from lunarnav.oracle.context import sha256
from lunarnav.oracle.model import HERE
from lunarnav.terrain.paths import data_root


def fetch_all() -> Iterator[str]:
    pins = yaml.safe_load((HERE / "pins.yaml").read_text(encoding="utf-8"))
    root = data_root() / "validation" / "reference"
    for name, spec in pins["downloads"].items():
        path = root / spec["path"]
        if path.exists() and sha256(path) == spec["sha256"]:
            yield f"ok       {name}"
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".part")
        with httpx.stream("GET", spec["url"], follow_redirects=True, timeout=120.0, headers={"User-Agent": "lunarnav-oracle"}) as r:
            r.raise_for_status()
            with tmp.open("wb") as f:
                for block in r.iter_bytes(1 << 20):
                    f.write(block)
        got = sha256(tmp)
        if got != spec["sha256"]:
            tmp.unlink()
            raise RuntimeError(f"{name}: downloaded file has SHA-256 {got}, pinned {spec['sha256']}")
        tmp.replace(path)
        yield f"fetched  {name}"
