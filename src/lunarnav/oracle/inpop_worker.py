from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import spiceypy as spice


def main(folder: str, et_file: str, out_file: str) -> None:
    root = Path(folder)
    for name in sorted(p.name for p in root.iterdir()):
        if name.endswith((".tf", ".tpc", ".bpc")) or (name.endswith(".bsp") and "_time" not in name):
            spice.furnsh(str(root / name))
    et = np.load(et_file)
    sun = np.empty((et.size, 3))
    earth = np.empty((et.size, 3))
    rot = np.empty((et.size, 3, 3))
    for i, t in enumerate(et):
        sun[i], _ = spice.spkpos("10", float(t), "J2000", "CN", "301")
        earth[i], _ = spice.spkpos("399", float(t), "J2000", "CN", "301")
        rot[i] = spice.pxform("J2000", "MOON_PA_INPOP", float(t))
    np.savez(out_file, sun=sun, earth=earth, rot=rot)


if __name__ == "__main__":
    main(*sys.argv[1:4])
