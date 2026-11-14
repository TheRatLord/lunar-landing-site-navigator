"""Minimal PDS3 label reader for the LOLA GDR products (``KEY = value`` pairs)."""

from __future__ import annotations

import re
from pathlib import Path

_KV = re.compile(r"^\s*\^?([A-Z_0-9]+)\s*=\s*(.*)$")
_UNIT = re.compile(r"\s*<[^>]*>\s*$")


def parse_label(path: str | Path) -> dict:
    """Parse a PDS3 label into a flat dict of strings; numbers keep their text and units are dropped.

    Multi-line quoted values are joined. Repeated keys keep the last value (the labels used here
    carry each key once, apart from the map-projection object which has unique keys too).
    """
    out: dict[str, str] = {}
    key: str | None = None
    buf: list[str] = []
    in_quote = False
    for line in Path(path).read_text(errors="replace").splitlines():
        if in_quote:
            buf.append(line.strip())
            if line.count('"') % 2 == 1:
                in_quote = False
                assert key is not None
                out[key] = " ".join(buf).strip().strip('"')
            continue
        if line.lstrip().startswith("/*"):
            continue
        m = _KV.match(line)
        if not m:
            continue
        key, val = m.group(1), m.group(2).strip()
        if val.startswith('"') and val.count('"') % 2 == 1:
            in_quote = True
            buf = [val.lstrip('"')]
            continue
        out[key] = _UNIT.sub("", val).strip().strip('"')
    return out


def label_float(label: dict, key: str) -> float:
    """Numeric value of ``key`` (first token)."""
    return float(label[key].split()[0].rstrip("."))


def label_int(label: dict, key: str) -> int:
    return int(float(label[key].split()[0]))
