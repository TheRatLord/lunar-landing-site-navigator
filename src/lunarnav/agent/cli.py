"""Command line: ``python -m lunarnav.agent run|resume|show|list``."""

from __future__ import annotations

import asyncio
import json
import signal
import sys
from pathlib import Path
from typing import Annotated

import typer

from . import fsafe
from .config import AgentConfig
from .policy import PermissionPolicy
from .render import Renderer
from .repair import RepairRefused, plan_repairs, repair_heads
from .selfcheck import run_sandbox_check
from .session import AgentSession
from .store import RunPaths, iter_events, list_runs, read_jsonl, run_integrity_problems
from .tools import default_registry, describe_tools

app = typer.Typer(
    add_completion=False, no_args_is_help=True, help="Moonwalker analysis agent."
)

ConfigOpt = Annotated[Path | None, typer.Option("--config", help="YAML file overriding AgentConfig fields.")]
ColorOpt = Annotated[bool, typer.Option("--color/--no-color", help="ANSI colour.")]


def _config(config: Path | None, **overrides: object) -> AgentConfig:
    return AgentConfig.load(config, **{k: v for k, v in overrides.items() if v is not None})


async def _drive(session: AgentSession, prompts: list[str], renderer: Renderer) -> int:
    """Run the prompts as consecutive turns; Ctrl-C interrupts the running turn (twice: abort)."""
    loop = asyncio.get_running_loop()
    presses = 0

    def on_sigint() -> None:
        nonlocal presses
        presses += 1
        if presses > 1:
            raise KeyboardInterrupt
        print("\n^C: interrupting the turn (press again to abort)", file=sys.stderr)
        loop.create_task(session.interrupt())

    loop.add_signal_handler(signal.SIGINT, on_sigint)
    status = 0
    try:
        for prompt in prompts:
            async for event in session.turn(prompt):
                renderer.feed(event)
                if getattr(event, "type", "") == "turn_end" and event.status != "completed":  # type: ignore[attr-defined]
                    status = 1
            if presses:
                break
    finally:
        loop.remove_signal_handler(signal.SIGINT)
        await session.close()
        events = list(iter_events(session.paths.transcript))
        if events:
            renderer.feed(events[-1])
    return status


@app.command()
def run(
    prompt: Annotated[str, typer.Argument(help="What the agent should do.")],
    then: Annotated[
        list[str] | None, typer.Option("--then", help="Follow-up prompt(s) sent in the same session.")
    ] = None,
    model: Annotated[str | None, typer.Option(help="Model id (default from config).")] = None,
    run_id: Annotated[str | None, typer.Option(help="Explicit run id.")] = None,
    config: ConfigOpt = None,
    sandbox: Annotated[str | None, typer.Option(help="auto | off | require")] = None,
    max_budget_usd: Annotated[float | None, typer.Option(help="Stop the run above this cost.")] = None,
    instructions: Annotated[bool, typer.Option("--instructions", help="Print the system prompt.")] = False,
    color: ColorOpt = True,
) -> None:
    """Start a new run, stream it live, and exit when all turns are done."""
    cfg = _config(config, model=model, sandbox=sandbox, max_budget_usd=max_budget_usd)

    async def main() -> int:
        session = await AgentSession.start(cfg, run_id=run_id)
        return await _drive(
            session,
            [prompt, *(then or [])],
            Renderer(sys.stdout, color and sys.stdout.isatty(), instructions),
        )

    raise typer.Exit(asyncio.run(main()))


@app.command()
def resume(
    run_id: Annotated[str, typer.Argument(help="Run to continue.")],
    prompt: Annotated[str, typer.Argument(help="Follow-up message.")],
    config: ConfigOpt = None,
    color: ColorOpt = True,
) -> None:
    """Continue a past run with a new message; the model's context and the workspace are restored."""
    cfg = _config(config)

    async def main() -> int:
        session = await AgentSession.resume(run_id, cfg)
        return await _drive(session, [prompt], Renderer(sys.stdout, color and sys.stdout.isatty()))

    raise typer.Exit(asyncio.run(main()))


@app.command()
def show(
    run_id: Annotated[str, typer.Argument(help="Run id.")],
    config: ConfigOpt = None,
    instructions: Annotated[bool, typer.Option("--instructions", help="Print the system prompt.")] = False,
    as_json: Annotated[bool, typer.Option("--json", help="Print raw JSONL events.")] = False,
    color: ColorOpt = True,
) -> None:
    """Replay a run's transcript."""
    cfg = _config(config)
    paths = RunPaths.open(cfg.runs_dir, run_id)
    if as_json:
        sys.stdout.write(fsafe.read_text(paths.transcript))
        return
    renderer = Renderer(sys.stdout, color and sys.stdout.isatty(), instructions)
    for event in iter_events(paths.transcript):
        renderer.feed(event)
    problems = run_integrity_problems(paths)
    counts = {f.name: len(read_jsonl(f)) for f in (paths.ledger, paths.assumptions, paths.artifacts)}
    print(f"\nledgers: {counts}; hash chains {'OK' if not problems else 'BROKEN: ' + '; '.join(problems)}")


@app.command("repair-ledger")
def repair_ledger(
    run_id: Annotated[str, typer.Argument(help="Run id.")],
    who: Annotated[str, typer.Option("--who", help="Your name; it is written into the ledger with the repair.")] = "",
    dry_run: Annotated[bool, typer.Option("--dry-run", help="Show what would change and change nothing.")] = False,
    yes: Annotated[bool, typer.Option("--yes", help="Do not ask for confirmation (the plan is still printed).")] = False,
    config: ConfigOpt = None,
) -> None:
    """Repair a ledger left behind by a crash, after showing exactly what is adopted or removed, and record that.

    An operator trust action: it makes the integrity result clean and cannot tell a crash from an edit made with the
    same effect. Repairs an interrupted append (one entry without its recorded head; a sign-off decision is never
    adopted) and a torn last line (removed).
    Refuses (exit 1, nothing changed) otherwise; a broken chain or fewer entries than recorded is what tampering
    looks like.
    """
    cfg = _config(config)
    paths = RunPaths.open(cfg.runs_dir, run_id)
    if not dry_run and not " ".join(who.split()):
        print("not repaired: say who is running the repair (--who)", file=sys.stderr)
        raise typer.Exit(1)
    try:
        plans = plan_repairs(paths)
        for plan in plans:
            print(f"{plan['ledger']}: {plan['reason']} (recorded {plan['from']} -> {plan['count']} entries)")
            if "entry" in plan:
                print(f"  entry adopted ({plan['entry_chars']} characters, sha256 {plan['entry_sha256']}); every key, "
                      "a value cut for display is marked:")
                for key, shown in plan["entry"].items():
                    print(f"    {key}: {shown}")
            if "fragment" in plan:
                print(f"  fragment removed ({plan['fragment_chars']} characters): {plan['fragment']!r}")
        if not plans:
            print("the ledger heads are consistent; nothing to repair")
        elif dry_run:
            print("dry run: nothing was changed")
        else:
            if not yes and not typer.confirm(f"Apply this repair as {who!r}?", default=False):
                print("not repaired: not confirmed", file=sys.stderr)
                raise typer.Exit(1)
            repair_heads(paths, who)
            print(f"repaired and recorded in ledger.jsonl as {who!r}")
    except RepairRefused as exc:
        print(f"not repaired: {exc}", file=sys.stderr)
        raise typer.Exit(1) from exc


@app.command("list")
def list_cmd(config: ConfigOpt = None) -> None:
    """List runs, newest first."""
    cfg = _config(config)
    runs = list_runs(cfg.runs_dir)
    if not runs:
        print(f"no runs under {cfg.runs_dir}")
        return
    for meta in runs:
        cost = f"${meta['cost_usd']:.4f}" if meta.get("cost_usd") is not None else "n/a"
        prompt = (meta.get("first_prompt") or "").replace("\n", " ")[:60]
        print(
            f"{meta['run_id']}  {meta.get('state', '?'):7} {meta.get('status', '?'):11} turns={meta.get('turns', 0)} cost={cost:9} {meta.get('model', '')}  {prompt}"
        )


class _ListedScenarios:
    """A source with nothing in it: only used to show which tools a run with a scenario source gets."""

    def list(self, limit: int) -> list[dict]:
        return []

    def load(self, scenario_id: str) -> dict | None:
        return None


@app.command()
def tools(
    config: ConfigOpt = None, as_json: Annotated[bool, typer.Option("--json")] = False,
    saved_scenarios: Annotated[bool, typer.Option(
        "--saved-scenarios", help="Include the saved-scenario tools (a run has them only when a service supplies a source).")] = False,
) -> None:
    """Print the tool list and permission policy a new run would show the model (the session's own registry)."""
    cfg = _config(config)
    registry = default_registry(_ListedScenarios() if saved_scenarios else None)
    policy = PermissionPolicy(cfg.runs_dir / "<run_id>" / "workspace", cfg, frozenset(registry.mcp_names()))
    infos = [t.model_dump() for t in describe_tools(registry)]
    if as_json:
        print(json.dumps({"tools": infos, "policy": policy.describe()}, indent=2))
    else:
        print("\n".join(f"{t['name']:40} {t['description'][:90]}" for t in infos))
        if not saved_scenarios:
            print("(the saved-scenario tools appear only when a service supplies a scenario source; see --saved-scenarios)")


@app.command("sandbox-check")
def sandbox_check(config: ConfigOpt = None) -> None:
    """Verify with the real CLI that the OS sandbox confines Bash (filesystem and network). Exit 1 on any failure."""
    cfg = _config(config)
    try:
        results = asyncio.run(run_sandbox_check(cfg))
    except RuntimeError as exc:
        print(f"sandbox check could not run: {exc}", file=sys.stderr)
        raise typer.Exit(2) from exc
    for r in results:
        print(f"{'PASS' if r.ok else 'FAIL'}  {r.name:28} expect: {r.expect}")
        if not r.ok:
            print(f"      command: {r.command}\n      output:  {r.output[:300]}")
    failed = [r for r in results if not r.ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} sandbox probes passed")
    raise typer.Exit(1 if failed else 0)
