from __future__ import annotations

import datetime as dt
import json
import subprocess
from pathlib import Path
from typing import Annotated

import typer

app = typer.Typer(add_completion=False, no_args_is_help=True, help="Check the engine against sources outside it.")


def _commit() -> str:
    try:
        root = Path(__file__).resolve().parents[3]
        out = subprocess.run(["git", "-C", str(root), "describe", "--always", "--dirty"], capture_output=True, text=True, check=True)
        return out.stdout.strip()
    except Exception:
        return "unknown"


@app.command()
def run(
    only: Annotated[list[str] | None, typer.Option("--only", help="Run only cases whose id starts with this (repeatable).")] = None,
    report: Annotated[Path | None, typer.Option(help="Write the Markdown report here.")] = None,
    out: Annotated[Path | None, typer.Option(help="Write the results as JSON here (default: validation/oracle/results.json under the data directory).")] = None,
    quick: Annotated[bool, typer.Option("--quick", help="Smaller samples for the raster cases; the report says so.")] = False,
) -> None:
    from lunarnav.oracle.context import Context
    from lunarnav.oracle.report import console, markdown
    from lunarnav.oracle.runner import run as run_suite
    from lunarnav.oracle.runner import score

    results = run_suite(only or (), quick=quick, progress=lambda s: typer.echo(s, err=True))
    sc = score(results)
    ctx = Context()
    meta = {
        "when_utc": dt.datetime.now(dt.UTC).strftime("%Y-%m-%d %H:%M UTC"), "commit": _commit(),
        "stack_hash": ctx.pins["stack_hash"], "quick": quick, "only": list(only or ()),
    }  # fmt: skip
    typer.echo(console(results, sc))
    target = out or ctx.data / "validation" / "oracle" / "results.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({"meta": meta, "score": sc, "results": [r.to_dict() for r in results]}, indent=1), encoding="utf-8")
    if report:
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(markdown(results, sc, meta) + "\n", encoding="utf-8")
        typer.echo(f"wrote {report}")
    failed = sc["all"]["failed"] + sc["all"]["errors"]
    raise typer.Exit(1 if failed else 0)


@app.command()
def fetch() -> None:
    from lunarnav.oracle.fetch import fetch_all

    for line in fetch_all():
        typer.echo(line)


@app.command("list")
def list_cases() -> None:
    from lunarnav.oracle.model import load_cases

    for c in load_cases().values():
        lim = "report only" if c.limit is None else f"{'<=' if c.sense == 'at_most' else '>='} {c.limit:g} {c.unit}"
        typer.echo(f"{c.id:44} {c.kind:14} {lim:22} {c.source}")
