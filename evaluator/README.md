# Site review board (Claude Code + lunarnav MCP)

Claude Code acts as a lunar landing site selection review board. It reads real engine numbers (SPICE illumination and Earth visibility, LOLA terrain) and the historical landing and launch records through the `lunarnav` MCP server, and rates a candidate site on eight criteria: `slope_tipover`, `illumination_power`, `earth_link`, `ellipse_hazards`, `terrain_navigation`, `thermal`, `launch_slip`, `past_failures`. Every rating must cite ledger ids (`L0001`…) of the tool results it rests on.

There are two ways to use it:

- **Live review**: `/review-site` inside Claude Code, for the demo.
- **Backtest**: headless Claude Code (`claude -p`) replays 13 past landings blinded, with tools and without tools, and scores whether the board flagged the risks that actually happened.

No API key is needed. Everything runs on your own Claude Code login and uses your plan's usage.

## Setup

1. **Engine (WSL Ubuntu-24.04).** The Python engine only runs on Linux. Follow the main [README](../README.md) for `uv sync`, `uv run lunarnav kernels` (SPICE), and the terrain data:
   ```bash
   uv run python -m lunarnav.terrain.ingest fetch --all
   uv run python -m lunarnav.terrain.ingest build --all
   uv run python -m lunarnav.terrain.ingest build-err --all
   uv run python -m lunarnav.terrain.ingest manifest
   ```
   This is several GB and takes hours. Without it, only the coarse global terrain (about 470 m/px) is available.
2. **Fast start from `/mnt/e` (optional).** Python over a Windows drive is slow. Save this as `~/wslfast.sh` in WSL, with the paths changed to your clone. It runs a command from a Linux-side copy of the code, while the data stays on the Windows drive:
   ```bash
   #!/usr/bin/env bash
   export PATH="$HOME/.local/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin"
   export UV_PROJECT_ENVIRONMENT="$HOME/.venvs/lunarnav"
   export UV_LINK_MODE=copy
   export LUNARNAV_DATA=/mnt/e/SpaceAppChallenge/lunar-landing-site-navigator/data
   SRC=/mnt/e/SpaceAppChallenge/lunar-landing-site-navigator
   DST="$HOME/lunarnav-src"
   mkdir -p "$DST"
   rsync -a --delete --exclude data --exclude .venv --exclude .venv-wsl --exclude node_modules --exclude web --exclude evaluator --exclude .git --exclude .superpowers --exclude __pycache__ --exclude .numba_cache "$SRC/" "$DST/"
   cd "$DST" || exit 1
   eval "$1"
   ```
3. **Claude Code** installed and logged in (`claude --version`).
4. **Evaluator dependencies** (Windows or WSL, needs bun):
   ```bash
   cd evaluator && bun install && cp .env.example .env
   ```
   `.env` settings: `LUNARNAV_MCP_URL` (default `http://127.0.0.1:8765/mcp`), `LUNARNAV_EVAL_MODEL` (passed to `claude --model`, default `sonnet`), `LUNARNAV_EVAL_MAX_STEPS` (`--max-turns`, default 30), `LUNARNAV_CLAUDE_BIN` (path to `claude` if it is not on PATH).

## Start the MCP server

In WSL, and keep it running:

```bash
bash ~/wslfast.sh 'uv run lunarnav mcp --http 8765'
```

or, from the repo root without the helper: `uv run lunarnav mcp --http 8765`. WSL forwards `127.0.0.1:8765` to Windows.

## Live review (demo)

Open Claude Code in the repo root. `.mcp.json` registers the server as `lunarnav`; approve it when Claude Code asks, and check it with `/mcp`. Then:

```
/review-site -85.29 36.3 2027-01-15T12:00Z griffin falcon-heavy 336
```

Arguments: `<lat> <lon> <landing_utc> <lander> <vehicle> [mission_hours]`. The answer is a table with one row per criterion, each showing a rating, a finding and ledger ids, followed by the top risks and the past missions they echo. The skill lives in `.claude/skills/review-site/SKILL.md` and follows the same instructions as the backtest (`evaluator/prompts/review-board.md`).

The same review headless, printed as markdown:

```bash
cd evaluator && bun run review --lat -85.29 --lon 36.3 --date 2027-01-15T12:00Z --lander griffin --vehicle falcon-heavy
```

Add `--no-tools` for the baseline (model knowledge only).

## Backtest

### Before the first run

1. **Label review.** Answer the three open questions in [`docs/superpowers/specs/2026-11-14-history-labels-review.md`](../docs/superpowers/specs/2026-11-14-history-labels-review.md) and fix `src/lunarnav/catalog/missions.yaml` if needed. Results do not count until this is done.
2. **Past-site features and cases.** Run these after the terrain build and after any label change:
   ```bash
   bash ~/wslfast.sh 'uv run lunarnav history-features'
   bash ~/wslfast.sh 'uv run python -m lunarnav.history export-cases' > evaluator/backtest/cases.json
   ```
   South-polar cases should show `"group": "fine"`.

### Run

With the server running:

```bash
cd evaluator
npx promptfoo eval -c backtest/promptfooconfig.yaml --filter-first-n 2 -o backtest/out.json && bun backtest/summary.ts backtest/out.json
```

Start with that two-case dry run. The full run is `bun run backtest`: 13 cases × 2 modes, each tools-mode case up to 30 tool calls. That is a lot of usage, so run it in batches (`--filter-first-n`, or `--filter-pattern <mission id>`) or lower `LUNARNAV_EVAL_MAX_STEPS` if your plan is tight.

### How each case is run

- **Tools mode.** The runner tells the server to blind the tested mission: its record, its site and lander names, and every record dated after it are hidden. Then it starts `claude -p` in an empty temporary folder with:
  - only the `lunarnav` server, and no other MCP servers;
  - no built-in tools (no files, shell or web);
  - no user or project settings;
  - the two control tools (`set_blind_mission`, `record_planner_request`) blocked.

  Claude cannot read `missions.yaml` or anything else that holds the answer. The review must be valid JSON matching the schema, and every cited ledger id must come from a tool result in that run; otherwise the case errors.
- **Baseline mode.** The same blinded prompt, with no MCP server and no tools at all.

**Leak audit.** Grep the tool outputs for the tested mission's name or lander id; skip the server's `data/runs/` ledger, which stores real ids by design.

### Read the summary

```
| Provider / terrain group | Site-related risks flagged | False no-go on clear criteria | Errors |
```

- **Flagged**: for failures with a site-related cause, how often the matching criterion was rated `caution` or `no-go`.
- **False no-go**: how often a criterion with no recorded problem was rated `no-go`.
- **fine / coarse**: whether terrain at lander scale (≤ 20 m/px) covered the site. Coarse cases cannot resolve slope, so they are reported separately and kept out of the headline.

**The claim is the gap between `tools` and `baseline`, not the raw hit rate.** The model may remember famous missions from training, and the baseline measures exactly that. Only site-related causes count against a site; engine, software and sensor failures do not.

## Status

The Claude Code runner was checked without model calls:
- typecheck;
- a fake `claude` executable covering success, invented ledger ids, max turns and missing structured output;
- the error messages for a missing server and a missing binary;
- blind-mode control calls against the live server.

The first real `/review-site` run and the first backtest have not been run yet. If a run fails with "no structured_output", `--json-schema` may need a built-in tool that `--tools ""` removes; report it.
