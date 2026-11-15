"""``lunarnav`` command line: serve the API, export its OpenAPI schema, manage kernels, run the agent, compute regional layers, run the oracle suite."""

from __future__ import annotations

import json
import os
import platform
import sys
from pathlib import Path
from typing import Annotated

import typer

app = typer.Typer(add_completion=False, no_args_is_help=True, help="Lunar Landing Site Navigator.")


@app.command(
    "agent",
    context_settings={"allow_extra_args": True, "ignore_unknown_options": True, "help_option_names": []},
    help="Claude analysis agent (run, resume, show, list, tools, sandbox-check).",
)
def agent(ctx: typer.Context) -> None:
    from lunarnav.agent.cli import app as agent_app

    agent_app(args=list(ctx.args), prog_name="lunarnav agent")


@app.command(
    "oracle",
    context_settings={"allow_extra_args": True, "ignore_unknown_options": True, "help_option_names": []},
    help="Oracle suite: check the engine against sources outside it (run, fetch, list).",
)
def oracle(ctx: typer.Context) -> None:
    from lunarnav.oracle.cli import app as oracle_app

    oracle_app(args=list(ctx.args), prog_name="lunarnav oracle")


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


@app.command("mcp")
def mcp(
    http: Annotated[int | None, typer.Option("--http", help="Serve streamable HTTP on 127.0.0.1:PORT instead of stdio.")] = None,
    blind_exclude: Annotated[str | None, typer.Option("--blind-exclude", help="Start a blind backtest of this mission id.")] = None,
    no_tools: Annotated[bool, typer.Option("--no-tools", help="Expose only the client control tools (baseline runs).")] = False,
) -> None:
    """Serve the engine and history tools as an MCP server."""
    from lunarnav.mcp_server import serve as serve_mcp

    serve_mcp(http_port=http, blind_exclude=blind_exclude, no_tools=no_tools)


@app.command("history-features")
def history_features() -> None:
    """Precompute terrain and Sun features of every past landing site for `similar_past_landings`."""
    from lunarnav.agent.engine_tools.state import DEFAULT_N_AZ
    from lunarnav.catalog import _all_sites, load_missions
    from lunarnav.history_features import features_path, site_features
    from lunarnav.scenario.horizons import TerrainProvider
    from lunarnav.terrain import TerrainStack

    provider = TerrainProvider(TerrainStack.open(), n_az=DEFAULT_N_AZ)
    sites = {s.id: s for s in _all_sites()}
    out: dict[str, dict] = {}
    for m in load_missions():
        site = sites.get(m.site_id or "") or sites.get(m.target_site_id or "")
        if site is None:
            typer.echo(f"{m.id}: no site, skipped")
            continue
        when = m.landing_utc or site.landing_utc
        try:
            feats = site_features(provider, site.lat_deg, site.lon_deg, when)
        except Exception as exc:  # noqa: BLE001
            typer.echo(f"{m.id}: failed ({type(exc).__name__}: {exc})")
            continue
        out[m.id] = {"site_id": site.id, "lat_deg": site.lat_deg, "lon_deg": site.lon_deg, "landing_utc": when,
                     "features": feats}
        typer.echo(f"{m.id}: " + ", ".join(f"{k}={v}" for k, v in feats.items()))
    path = features_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    typer.echo(f"wrote {path} ({len(out)} missions)")


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
