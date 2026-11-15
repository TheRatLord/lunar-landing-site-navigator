"""PDF from the report HTML with WeasyPrint (no browser, no network).

Determinism: `SOURCE_DATE_EPOCH` is set from the report's generation time while rendering (it fixes the font
subset timestamps), and the file identifier is a hash of the HTML, so identical HTML gives identical bytes.
Resources other than `data:` URLs are refused (`allowed_protocols`): the document is self-contained and rendering never reaches the
network or the file system.
"""

from __future__ import annotations

import hashlib
import os
import re
import threading
from calendar import timegm
from contextlib import contextmanager
from datetime import datetime

import weasyprint
from weasyprint.urls import URLFetcher

from .errors import ReportInputError, parse_generated_utc
from .fonts import check_coverage

_ENV_LOCK = threading.Lock()


@contextmanager
def _source_date(epoch: int):
    with _ENV_LOCK:
        old = os.environ.get("SOURCE_DATE_EPOCH")
        os.environ["SOURCE_DATE_EPOCH"] = str(epoch)
        try:
            yield
        finally:
            if old is None:
                os.environ.pop("SOURCE_DATE_EPOCH", None)
            else:
                os.environ["SOURCE_DATE_EPOCH"] = old


def generated_epoch(html: str) -> int:
    """Unix time of the report's `dcterms.created` metadata."""
    m = re.search(r'<meta name="dcterms\.created" content="([^"]+)"', html)
    if not m:
        raise ReportInputError("the HTML carries no dcterms.created metadata (not a lunarnav report?)")
    return timegm(datetime.strptime(parse_generated_utc(m.group(1)), "%Y-%m-%dT%H:%M:%SZ").timetuple())


def render_pdf(html: str) -> bytes:
    """PDF bytes for `html` (as returned by `render_html`)."""
    check_coverage(html)
    ident = hashlib.md5(html.encode("utf-8"), usedforsecurity=False).digest()
    fetcher = URLFetcher(allowed_protocols=("data",), fail_on_errors=True)
    with _source_date(generated_epoch(html)):
        return weasyprint.HTML(string=html, url_fetcher=fetcher).write_pdf(pdf_identifier=ident)
