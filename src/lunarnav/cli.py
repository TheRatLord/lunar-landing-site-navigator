"""``lunarnav`` command line: serve the API, export its OpenAPI schema, manage kernels, run the agent, compute regional layers."""

from __future__ import annotations

import json
import os
import platform
import sys
from pathlib import Path
from typing import Annotated

import typer

from lunarnav.agent.cli import app as agent_app

app = typer.Typer(add_completion=False, no_args_is_help=True, help="Lunar Landing Site Navigator.")
app.add_typer(agent_app, name="agent", help="Claude analysis agent (run, resume, show, list, tools, sandbox-check).")


@app.command()
def serve(
    host: Annotated[str | None, typer.Option(help="Bind address (default 127.0.0.1 or $LUNARNAV_API_HOST).")] = None,
    port: Annotated[int | None, typer.Option(help="Port (default 8000 or $LUNARNAV_API_PORT).")] = None,
    reload: Annotated[bool, typer.Option("--reload", help="Restart on source changes (development).")] = False,
    allow_remote: Annotated[
        bool,
        typer.Option(
            "--allow-remote",
            help="Permit a non-loopback bind. The agent endpoints run code: only behind your own authentication and isolation.",
        ),
    ] = False,
) -> None:
    """Start the HTTP service (single trusted operator; loopback only unless --allow-remote)."""
    import uvicorn

    from lunarnav.api.settings import Settings

    if host:
        os.environ["LUNARNAV_API_HOST"] = host
    if port:
        os.environ["LUNARNAV_API_PORT"] = str(port)
    if allow_remote:
        os.environ["LUNARNAV_API_ALLOW_REMOTE"] = "1"
    settings = Settings.from_env()
    try:
        settings.check_bind()
    except PermissionError as exc:
        typer.echo(f"error: {exc}", err=True)
        raise typer.Exit(2) from exc
    uvicorn.run(
        "lunarnav.api.app:create_app",
        factory=True,
        host=settings.host,
        port=settings.port,
        reload=reload,
        access_log=False,
        timeout_graceful_shutdown=5,
        log_level="info",
    )


@app.command()
def openapi(
    out: Annotated[Path, typer.Argument(help="Destination file for the OpenAPI JSON.")],
    indent: Annotated[int, typer.Option(help="JSON indentation (0 for compact).")] = 2,
) -> None:
    """Write the service's OpenAPI schema (for generating the web client's types)."""
    from lunarnav.api.app import create_app
    from lunarnav.api.settings import Settings

    settings = Settings.from_env().with_overrides(web_dist=None, preload_kernels=False)
    schema = create_app(settings).openapi()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(schema, indent=indent or None, sort_keys=False) + "\n", encoding="utf-8")
    typer.echo(f"wrote {out} ({len(schema['paths'])} paths)")


@app.command()
def kernels(
    verify: Annotated[bool, typer.Option("--verify", help="Only check files already on disk; download nothing.")] = False,
) -> None:
    """Download (if needed) and verify the pinned SPICE kernels; exit 1 if any is missing or does not match."""
    from lunarnav.ephem.kernels import kernel_dir, verify_kernels

    typer.echo(f"kernel directory: {kernel_dir()}")
    if verify:
        bad = 0
        for spec, status in verify_kernels():
            bad += status != "ok"
            typer.echo(f"{status:16} {spec.name}  {spec.sha256[:16]}…")
        raise typer.Exit(1 if bad else 0)
    from lunarnav.ephem import et_to_utc, load_kernels

    ks = load_kernels()
    for f in ks.files:
        cover = f"{f.coverage_utc[0]} .. {f.coverage_utc[1]}" if f.coverage_utc else ""
        typer.echo(f"ok  {f.name:42} {f.sha256[:16]}…  {cover}")
    typer.echo(f"valid for all kernels: {et_to_utc(ks.valid_et[0], 0)} .. {et_to_utc(ks.valid_et[1], 0)}")


@app.command(
    context_settings={"allow_extra_args": True, "ignore_unknown_options": True, "help_option_names": []},
    help="Regional illumination and visibility layers for a map region (GeoTIFFs + header.json); `lunarnav regional --help` lists the options.",
)
def regional(ctx: typer.Context) -> None:
    """Compute the regional layers; every argument goes to `python -m lunarnav.regional` unchanged."""
    from lunarnav.regional.__main__ import main as regional_main

    raise typer.Exit(regional_main(list(ctx.args)))


@app.command()
def version() -> None:
    """Print package, API and Python versions."""
    from lunarnav.api.routes.meta import SERVICE_VERSION
    from lunarnav.api.versions import code_version

    typer.echo(f"lunarnav {code_version()} (API v1 contract {SERVICE_VERSION}, Python {platform.python_version()})")


def main() -> None:
    """Entry point for ``python -m lunarnav.cli``."""
    app()


if __name__ == "__main__":
    sys.exit(app())
