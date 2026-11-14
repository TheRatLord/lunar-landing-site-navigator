"""Mission analysis report: engine results in, a self-contained HTML file and a PDF out.

    from lunarnav.report import write_report
    paths = write_report(evaluation, "out/", stem="site-a", provider=provider, scan=scan, slip=slip,
                         comparison=comparison, generated_utc="2026-01-01T00:00:00Z")

The module computes nothing.
"""

from __future__ import annotations

from pathlib import Path

from .errors import ReportInputError
from .fonts import check_coverage
from .html import render_html

__all__ = ["ReportInputError", "write_report"]


def write_report(
    evaluation, directory: str | Path, *, stem: str = "report", provider=None, scan=None, slip=None,
    comparison=None, ellipse=None, search=None, generated_utc: str | None = None, formats: tuple[str, ...] = ("html", "pdf"),
) -> dict[str, Path]:
    """Write `<stem>.html` and/or `<stem>.pdf` into `directory`; returns the paths by format.

    Both files come from one HTML string, so they show identical numbers. WeasyPrint is imported only for a PDF."""
    unknown = set(formats) - {"html", "pdf"}
    if unknown:
        raise ValueError(f"unknown report format(s) {sorted(unknown)}; use 'html' and/or 'pdf'")
    html = render_html(evaluation, provider=provider, scan=scan, slip=slip, comparison=comparison, ellipse=ellipse,
                       search=search, generated_utc=generated_utc)
    if "pdf" in formats:
        check_coverage(html)
    out = Path(directory)
    out.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    if "html" in formats:
        paths["html"] = out / f"{stem}.html"
        paths["html"].write_text(html, encoding="utf-8")
    if "pdf" in formats:
        paths["pdf"] = out / f"{stem}.pdf"
        from .pdf import render_pdf

        paths["pdf"].write_bytes(render_pdf(html))
    return paths
