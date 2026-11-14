"""Bundled report fonts: DejaVu from matplotlib's data directory, subset to a fixed character set.

The report must look the same on every machine and must never pull a system font. DejaVu ships inside the
matplotlib wheel (a project dependency), so it is available wherever the engine runs. Each face is subset
once per process to `UNICODE_RANGES` with fontTools (a WeasyPrint dependency) without touching the font
timestamp, which makes the embedded bytes deterministic. Text outside the subset is refused by
`check_coverage` rather than silently rendered in a fallback font.
"""

from __future__ import annotations

import base64
import io
from functools import cache
from pathlib import Path

import matplotlib
from fontTools import subset as ft_subset
from fontTools.ttLib import TTFont

UNICODE_RANGES: tuple[tuple[int, int], ...] = (
    (0x0020, 0x007E),
    (0x00A0, 0x017F),
    (0x0370, 0x03FF),
    (0x2010, 0x2027),
    (0x2030, 0x205E),
    (0x2190, 0x21FF),
    (0x2200, 0x22FF),
    (0x25A0, 0x25FF),
)

FACES: tuple[tuple[str, str, int, str], ...] = (
    ("DejaVu Sans", "normal", 400, "DejaVuSans.ttf"),
    ("DejaVu Sans", "normal", 700, "DejaVuSans-Bold.ttf"),
    ("DejaVu Sans", "italic", 400, "DejaVuSans-Oblique.ttf"),
    ("DejaVu Sans Mono", "normal", 400, "DejaVuSansMono.ttf"),
)
"""(CSS family, style, weight, file in matplotlib's `fonts/ttf`)."""


def font_dir() -> Path:
    return Path(matplotlib.get_data_path()) / "fonts" / "ttf"


@cache
def subset_font(filename: str) -> bytes:
    """`filename` from `font_dir()` reduced to `UNICODE_RANGES`; deterministic bytes (TrueType)."""
    path = font_dir() / filename
    if not path.is_file():
        raise FileNotFoundError(f"bundled font {path} is missing (matplotlib installation incomplete)")
    font = TTFont(path, recalcTimestamp=False)
    opts = ft_subset.Options()
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    opts.recalc_timestamp = False
    opts.drop_tables = [*opts.drop_tables, "FFTM"]
    opts.hinting = False
    sub = ft_subset.Subsetter(opts)
    sub.populate(unicodes=[c for a, b in UNICODE_RANGES for c in range(a, b + 1)])
    sub.subset(font)
    buf = io.BytesIO()
    font.save(buf)
    return buf.getvalue()


@cache
def covered_codepoints() -> frozenset[int]:
    """Code points present in every subset face (text outside this set cannot be typeset)."""
    sets = []
    for _, _, _, filename in FACES:
        font = TTFont(io.BytesIO(subset_font(filename)))
        sets.append(set(font.getBestCmap()))
    return frozenset(set.intersection(*sets)) | {0x0A, 0x0D, 0x09}


def check_coverage(text: str) -> None:
    """Raise `ReportInputError` naming the characters (and where the first occurs) that the bundled fonts cannot draw.

    The PDF embeds only subsets of the bundled DejaVu faces, cut to the characters the report itself uses, so a
    name in another script cannot be typeset; the HTML file does not need this check."""
    from .errors import ReportInputError

    covered = covered_codepoints()
    missing = sorted({ch for ch in text if ord(ch) not in covered})
    if missing:
        shown = ", ".join(f"U+{ord(c):04X} {c!r}" for c in missing[:8])
        first = next(i for i, ch in enumerate(text) if ord(ch) not in covered)
        context = text[max(0, first - 25):first + 25].replace("\n", " ")
        raise ReportInputError(
            f"the PDF cannot draw these characters: {shown} (near {context!r}). The PDF embeds a Latin font subset only; "
            "use a name in Latin letters, or write the HTML report alone (format html), which a browser draws with its own fonts")


@cache
def font_face_css() -> str:
    """`@font-face` rules with the subset fonts as base64 data URLs."""
    rules = []
    for family, style, weight, filename in FACES:
        data = base64.b64encode(subset_font(filename)).decode("ascii")
        rules.append(
            f"@font-face{{font-family:'{family}';font-style:{style};font-weight:{weight};"
            f"src:url(data:font/ttf;base64,{data}) format('truetype');}}")
    return "\n".join(rules)
