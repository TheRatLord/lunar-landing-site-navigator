"""Is a report current for the checked-out code?

Every report embeds the SHA-256 over the `lunarnav` source and packaged data files that produced it in its
footer. A report is current when that hash equals the hash of the code that is checked out now. The hash covers the
whole package, so any edit makes earlier reports stale even where it does not change their numbers: regenerate.

A PDF written next to an HTML report carries, as its file identifier, the MD5 of that HTML, so the pair can be checked
to belong together. Nothing here imports WeasyPrint.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

from lunarnav.scenario.provenance import code_version

from .errors import ReportInputError

_HASH = re.compile(r'data-key="prov:source_sha256" data-raw="([0-9a-f]{64})"')
_PDF_ID = re.compile(rb"/ID\s*\[\s*")


def embedded_source_hash(html: str) -> str:
    """The source hash a report's footer records."""
    m = _HASH.search(html)
    if not m:
        raise ReportInputError("the document records no lunarnav source hash (not a lunarnav HTML report?)")
    return m.group(1)


def is_current(html: str) -> bool:
    return embedded_source_hash(html) == code_version()["source_sha256"]


_ESCAPES = {ord("n"): 10, ord("r"): 13, ord("t"): 9, ord("b"): 8, ord("f"): 12, ord("("): 40, ord(")"): 41, ord("\\"): 92}


def _literal_string(data: bytes, start: int) -> bytes:
    """The PDF literal string `( ... )` that begins at `data[start]` (escapes and balanced parentheses handled)."""
    out = bytearray()
    depth, i = 0, start
    while i < len(data):
        c = data[i]
        if c == 0x5C:
            i += 1
            n = data[i]
            if n in _ESCAPES:
                out.append(_ESCAPES[n])
            elif 0x30 <= n <= 0x37:
                j = i
                while j < i + 3 and j < len(data) and 0x30 <= data[j] <= 0x37:
                    j += 1
                out.append(int(data[i:j], 8) & 0xFF)
                i = j - 1
            elif n == 13 and data[i + 1:i + 2] == b"\n":
                i += 1
            elif n not in (10, 13):
                out.append(n)
        elif c == 0x28:
            if depth:
                out.append(c)
            depth += 1
        elif c == 0x29:
            depth -= 1
            if depth == 0:
                return bytes(out)
            out.append(c)
        else:
            out.append(c)
        i += 1
    raise ReportInputError("the PDF's file identifier is truncated")


def pdf_identifier(pdf: bytes) -> str | None:
    """The first element of the PDF's file identifier as hex (WeasyPrint writes it as a literal string), or None."""
    m = _PDF_ID.search(pdf)
    if not m or pdf[m.end():m.end() + 1] != b"(":
        return None
    return _literal_string(pdf, m.end()).hex()


def html_identifier(html_bytes: bytes) -> str:
    return hashlib.md5(html_bytes, usedforsecurity=False).hexdigest()


def pdf_matches_html(pdf: bytes, html_bytes: bytes) -> bool:
    return pdf_identifier(pdf) == html_identifier(html_bytes)


def check_file(path: Path) -> dict:
    """`{"path", "hash", "current", "pdf": None | Path, "pdf_matches": None | bool}` for one HTML report.

    The PDF checked is `<stem>.pdf` next to it, when present."""
    try:
        data = path.read_bytes()
    except OSError as e:
        raise ReportInputError(f"cannot read {path}: {e.strerror or e}") from e
    if not data.lstrip()[:15].lower().startswith((b"<!doctype html", b"<html")):
        raise ReportInputError(f"{path} is not an HTML report (give the .html file; its .pdf is checked alongside)")
    text = data.decode("utf-8")
    digest = embedded_source_hash(text)
    pdf_path = path.with_suffix(".pdf")
    pdf_ok = pdf_matches_html(pdf_path.read_bytes(), data) if pdf_path.is_file() else None
    return {"path": path, "hash": digest, "current": digest == code_version()["source_sha256"],
            "pdf": pdf_path if pdf_path.is_file() else None, "pdf_matches": pdf_ok}


def check_files(paths: list[Path]) -> list[dict]:
    return [check_file(p) for p in paths]
