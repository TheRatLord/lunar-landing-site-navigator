# Mission-History Site Evaluator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone MCP server exposing the lunarnav engine plus a historical-landings/launch-record dataset, a Vercel AI SDK "site review board" evaluator that uses it, and a blinded promptfoo backtest with a no-tools baseline.

**Architecture:** Python side: two new sourced YAML catalogs, a history module with blind filtering, five new `agent_tool`s, and `lunarnav mcp` which serves a chosen subset of the existing `ToolRegistry` over the official `mcp` package, reusing `invoke()` so validation and the provenance ledger stay identical. TypeScript side (`evaluator/`, bun): an MCP client + Claude tool loop that produces a structured review, a CLI, and a promptfoo provider/config for the backtest.

**Tech Stack:** Python 3.12, uv, pydantic, `mcp` (2.3.x, already in `uv.lock`), typer; bun, TypeScript, `ai` (Vercel AI SDK), `@ai-sdk/anthropic`, the AI SDK MCP client, zod, promptfoo.

**Spec:** `docs/superpowers/specs/2026-11-14-mission-history-evaluator-design.md`

## Global Constraints

- `AGENTS.md`: **no code comments and no unit tests.** Docstrings follow the existing style (the codebase uses them). Verification in this plan is by running commands, never by adding test files. The promptfoo backtest is a model evaluation and is allowed.
- Engine runs on Linux (WSL on the user's machine). Every `uv run` command below runs in WSL from the repo root.
- Catalog entries follow `src/lunarnav/catalog/models.py` conventions: every entry has `sources` (opened URLs with `title` and `locator`) and `confidence` (`high | medium | low | unverified`).
- Every number in a review must trace to a ledger id (`L0001` style) returned in a tool result's `provenance.ledger_id`.
- Blind mode hides the tested mission **and every mission/launch record dated after its landing**, plus that mission's site id, name, operator, status, notes and `sources[].locator` text; landers appear under an anonymous alias.
- Engine faults are not site evidence: only causes with `site_related: true` may count against a site.
- Default model: latest Sonnet-class Claude via `@ai-sdk/anthropic`, read from `LUNARNAV_EVAL_MODEL`; key from `ANTHROPIC_API_KEY`.
- No Vercel hosting; no changes to `web/` or to the existing agent's behaviour (new tools are added to the registry list but the existing agent only gains them, nothing changes for existing tools).
- Do not commit or push without the user's go-ahead; work on branch `feat/mission-history-evaluator`.

## Review Focus

1. A candidate at the exact coordinates of a famous failure (e.g. IM-1 at -80.13, 1.44) in blind mode: no tool output may contain "Odysseus", "IM-1", "Intuitive", `im-1-odysseus` or `nova-c`. → leak check in Task 5 Step 4 and Task 8 Step 3.
2. A candidate far from the south pole (only `lola_global_64ppd` coverage): the review must say slope cannot be resolved instead of rating it `go`. → `terrain_resolution_m` field in Task 4, prompt rule + check in Task 7 Step 5.
3. A review whose finding cites no ledger id or a non-existent one: rejected, not printed as valid. → Task 7 Step 4.
4. A launch vehicle with zero recorded failures (e.g. a new vehicle with 2 flights): `launch_vehicle_record` must return a wide interval, not 0%. → Wilson interval check in Task 4 Step 4.
5. The MCP server launched from Windows bun while the engine is in WSL: must work over `--http`. → Task 7 Step 6 runs the CLI against `--http`.

---

### Task 1: History catalog schema and loaders

**Files:**
- Modify: `src/lunarnav/catalog/models.py` (append new models)
- Modify: `src/lunarnav/catalog/__init__.py` (new loaders, `__all__`)
- Create: `src/lunarnav/catalog/missions.yaml`
- Create: `src/lunarnav/catalog/launch_vehicles.yaml`

**Interfaces:**
- Produces:
  - `CauseCategory(StrEnum)`: `slope_tipover, illumination_power, terrain_navigation, thermal, comms, propulsion, gnc_software, sensor, launch_vehicle, other`
  - `Criterion = Literal["slope_tipover","illumination_power","earth_link","ellipse_hazards","terrain_navigation","thermal","launch_slip","past_failures"]`
  - `Cause(BaseModel)`: `category: CauseCategory, summary: str, site_related: bool`
  - `MissionEntry(CatalogEntry)`: `id, name, site_id: str | None, target_site_id: str | None, lander_id: str | None, launch_vehicle_id: str | None, launch_utc: str | None, landing_utc: str | None, outcome: Literal["success","partial","failed_landing","failed_before_landing"], causes: list[Cause], lessons: list[str], observed: dict[str, Any]`
  - `LaunchFailure(BaseModel)`: `date_utc: str, summary: str, stand_down_days: int | None, sources_idx: int | None`
  - `LaunchVehicleEntry(CatalogEntry)`: `id, name, operator, attempts: int, failures: int, partial: int, counted_through: str (YYYY-MM-DD), failures_detail: list[LaunchFailure], lunar_missions: list[str]`
  - `HistoryDoc`: `criterion_map: dict[CauseCategory, Criterion | None]` read from the top-level `criterion_map:` key of `missions.yaml`
  - `load_missions() -> tuple[MissionEntry, ...]`, `load_launch_vehicles() -> tuple[LaunchVehicleEntry, ...]`, `load_criterion_map() -> dict[CauseCategory, Criterion | None]`, all `@cache`d like `load_sites`.
  - Validators: `site_id`/`target_site_id` must exist in `load_sites()`, `lander_id` in `load_landers()`, `launch_vehicle_id` in `load_launch_vehicles()` (cross-check inside the loaders, raise `ValueError` naming the entry).

- [ ] **Step 1: Add the models and loaders.** Reuse `CatalogEntry` (gives `id`, `name`, `sources`, `confidence`, `notes`) and the `_UTC_RE` check for the UTC fields. `criterion_map` default content:

```yaml
criterion_map:
  slope_tipover: slope_tipover
  illumination_power: illumination_power
  terrain_navigation: terrain_navigation
  thermal: thermal
  comms: earth_link
  launch_vehicle: launch_slip
  propulsion: null
  gnc_software: null
  sensor: null
  other: null
```

- [ ] **Step 2: Add two seed entries per file** so the loaders have data: `im-2-athena` (site `im-2-athena`, lander `nova-c`, vehicle `falcon-9`) and `peregrine-m1` (target `peregrine-m1-target`, `failed_before_landing`, cause `propulsion`, `site_related: false`, vehicle `vulcan-centaur`); vehicles `falcon-9` and `vulcan-centaur`, each with real sources.

- [ ] **Step 3: Verify the loaders.**

Run: `uv run python -c "from lunarnav.catalog import load_missions, load_launch_vehicles, load_criterion_map as m; print(len(load_missions()), len(load_launch_vehicles()), m()['comms'])"`
Expected: `2 2 earth_link`

Run: `uv run ruff check src/lunarnav/catalog`
Expected: no errors.

- [ ] **Step 4: Commit** `feat(catalog): mission history and launch vehicle schema`

---

### Task 2: Draft the history data (then stop for label review)

**Files:**
- Modify: `src/lunarnav/catalog/missions.yaml`
- Modify: `src/lunarnav/catalog/launch_vehicles.yaml`
- Modify (only if a site is missing): `src/lunarnav/catalog/sites.yaml`

**Interfaces:**
- Consumes: Task 1 schema.
- Produces: the labelled dataset the backtest scores against.

- [ ] **Step 1: Missions.** At minimum, with opened sources for every cause: `im-1-odysseus`, `im-2-athena`, `hakuto-r-m1`, `hakuto-r-m2`, `beresheet`, `chandrayaan-2-vikram`, `chandrayaan-3-vikram`, `slim`, `luna-25`, `peregrine-m1`, `blue-ghost-m1`, `change-6`; add Chang'e 3/4/5 and two or three Apollo/Surveyor successes as controls if their sites exist in `sites.yaml`. Use published targets in `target_site_id` where one exists (`luna-25-target`, `peregrine-m1-target`). `observed` keys used by the backtest: `tipped: bool`, `power_lost: bool`, `impacted: bool`, `landed_upright: bool`.
- [ ] **Step 2: Launch vehicles.** Every vehicle referenced by a mission, plus `firefly-alpha` (Reaver failures with stand-down days), `falcon-heavy`, `h-iia`, `pslv`, `gslv-mk2`, `lvm3`, `long-march-3b`, `long-march-5`, `soyuz-2-1b`, `electron`. `counted_through` is the date the counts were read.
- [ ] **Step 3: Verify.** Run the Task 1 Step 3 command; expected counts ≥ 12 missions and ≥ 12 vehicles, no `ValueError`.
- [ ] **Step 4: Write `docs/superpowers/specs/2026-11-14-history-labels-review.md`**: one table row per mission (id, outcome, cause categories, `site_related`, mapped criterion, source link) for the reviewer.
- [ ] **Step 5: Commit** `data(catalog): draft mission history and launch records`
- [ ] **Step 6: STOP. Ask the user to review the labels table** (spec: labels reviewed before any backtest run counts). Apply their corrections and recommit before Task 8 Step 4.

---

### Task 3: History query module with blind filtering

**Files:**
- Create: `src/lunarnav/history.py`
- Modify: `src/lunarnav/catalog/__init__.py` (blind hook)

**Interfaces:**
- Consumes: Task 1 loaders.
- Produces:
  - `@dataclass(frozen=True) Blind: exclude_mission_id: str, cutoff_utc: str, hidden_site_ids: frozenset[str], lander_alias: dict[str, str]`
  - `set_blind(mission_id: str | None) -> Blind | None` in `lunarnav.history`: computes the cutoff from that mission's `landing_utc` (or `launch_utc` if no landing), hidden sites = sites of that mission and of every mission at or after the cutoff, lander alias = `{"<id>": "lander-<a,b,…>"}` for every lander; stores it in a module-level variable and calls `lunarnav.catalog.set_hidden(...)`; `None` clears.
  - `lunarnav.catalog.set_hidden(site_ids: frozenset[str], lander_alias: dict[str, str]) -> None`: makes `load_sites()` drop hidden ids and `load_landers()` return entries renamed to the alias with `name`, `operator`, `missions`, `notes` and `sources[].locator` blanked. Implement by clearing the `@cache` of both loaders and filtering inside them.
  - `visible_missions() -> list[MissionEntry]`: missions dated strictly before the cutoff, excluding the tested one; all missions when not blind.
  - `visible_vehicle(vehicle_id: str) -> LaunchVehicleEntry`: in blind mode, `failures_detail` after the cutoff is dropped and `failures` recounted from what remains; `attempts` cannot be recounted from the data, so it is kept only when `counted_through` is before the cutoff and is otherwise `None`, with the record tools then reporting failures without a rate.
  - `resolve_lander(alias_or_id: str) -> str`: maps an alias back to the real id for engine calls.

- [ ] **Step 1: Implement** the above. `build_scenario` must still accept the alias as `lander`: call `resolve_lander` at the start of `build_scenario`'s handler in `agent/engine_tools/scenario_build.py` (one-line change, no-op outside blind mode).
- [ ] **Step 2: Verify the cutoff and leak rules.**

Run: `uv run python -c "from lunarnav import history as h; from lunarnav.catalog import load_sites, load_landers; h.set_blind('im-1-odysseus'); ids={s.id for s in load_sites()}; print('im-1-odysseus' in ids, 'im-2-athena' in ids, [m.id for m in h.visible_missions()][:3], 'nova-c' in {l.id for l in load_landers()})"`
Expected: `False False [...] False` and the visible list contains no mission landing on or after 2024-02-22.

- [ ] **Step 3: Commit** `feat(history): blind-aware mission and launch history queries`

---

### Task 4: History agent tools

**Files:**
- Create: `src/lunarnav/agent/engine_tools/history.py`
- Modify: `src/lunarnav/agent/engine_tools/__init__.py` (add `history_tools()` to `engine_tools()`)
- Create: `src/lunarnav/history_features.py` (feature precompute)
- Modify: `src/lunarnav/cli.py` (command `history-features`)

**Interfaces:**
- Consumes: Task 3 functions; existing engine functions used by `ellipse_statistics`, `evaluate_site`, `terrain_info` handlers.
- Produces (all `agent_tool`, `read_only=True`, outputs subclass `EngineOutput`/`ToolOutput` and declare `ROW_LISTS`):
  - `historical_landings` — input `region: Literal["south_polar","north_polar","nonpolar","any"]="any", outcome: str|None, category: CauseCategory|None, site_related: bool|None, limit: int=30`; output rows `{id, outcome, landing_utc, lat_deg, lon_deg, causes, mapped_criteria}`. Blind: names shown as given in the entry only when not blind; in blind mode every *visible* mission keeps its name (only the tested and later ones are hidden).
  - `mission_lessons` — input `mission_id: str`; output the full entry (causes, lessons, observed, sources). Unknown or hidden id → `ToolError("unknown mission")` (same message for both, so hiding is not revealed).
  - `similar_past_landings` — input `scenario_id: str, terrain: str="stock", top_k: int=5`; output rows `{mission_id, distance, matched: list[str], outcome, site_related_causes}` plus `candidate_features`. Features per site: `abs_lat_deg`, `sun_elev_at_landing_deg`, `hours_to_sunset`, `ellipse_slope_p95_deg`, `local_relief_m`, `terrain_resolution_m`. Past-site features come from `data/history_features.json` (written by `lunarnav history-features`); candidate features computed live with the same functions. Distance: z-scored Euclidean over features present for both; `matched` lists features within 0.5 σ.
  - `launch_vehicle_record` — input `vehicle_id: str`; output `{attempts, failures, partial, failure_rate, wilson_95: [lo, hi], recent_failures, counted_through}`.
  - `launch_slip_risk` — input `vehicle_id: str, landing_utc: str`; output `{p_failure, typical_stand_down_days: [p50, max], slip_dates_utc: list[str]}` where `slip_dates_utc` = landing + each recorded stand-down length, ready for `slip_analysis`.
- `lunarnav history-features [--out data/history_features.json]`: computes features for every mission with a site; prints one line per mission; missing terrain → feature `null`, never fails the whole run.

- [ ] **Step 1: Implement the five tools and the precompute command.** Every tool output includes `terrain_resolution_m` where terrain is involved so the evaluator can tell "cannot resolve".
- [ ] **Step 2: Run the precompute.**

Run: `uv run lunarnav history-features`
Expected: one line per mission with numbers for south-polar sites (resolution ≤ 20 m) and `terrain_resolution_m ≈ 470` for non-polar ones; file `data/history_features.json` written.

- [ ] **Step 3: Smoke the tools through the registry** (no test files: a one-off command):

Run: `uv run python -c "import asyncio; from lunarnav.agent.engine_tools import engine_tools; print(sorted(t.name for t in engine_tools() if t.name in {'historical_landings','mission_lessons','similar_past_landings','launch_vehicle_record','launch_slip_risk'}))"`
Expected: all five names.

- [ ] **Step 4: Wilson check for a zero-failure vehicle** (Review Focus 4). Pick a vehicle with 0 failures in the data and call `launch_vehicle_record` via the MCP server in Task 5 Step 4; expected `failure_rate == 0` and `wilson_95[1] > 0.2` for fewer than 10 attempts.
- [ ] **Step 5: Commit** `feat(agent): history, similarity and launch record tools`

---

### Task 5: `lunarnav mcp` server

**Files:**
- Create: `src/lunarnav/mcp_server.py`
- Modify: `src/lunarnav/cli.py` (command `mcp`)
- Modify: `pyproject.toml` (`"mcp>=2.3"` in `dependencies`)

**Interfaces:**
- Consumes: `ToolRegistry`, `invoke`, `ToolContext` (`agent/registry.py`), `RunPaths.create`, `new_run_id`, `JsonlLedger`, `EventLog` (`agent/store.py`), `EventBus` (`agent/bus.py`), `AgentConfig.load` (`agent/config.py`), `UserPrompt` (`agent/events.py`), Task 3 `set_blind`.
- Produces:
  - CLI: `lunarnav mcp [--http PORT] [--blind-exclude MISSION_ID] [--no-tools]`
  - `EXPOSED = ("catalog_search","build_scenario","evaluate_site","scan_opportunities","slip_analysis","rank_alternative_sites","sensitivity","attribute_event","compare_scenarios","illumination_stats","horizon_profile","terrain_info","ephemeris_track","ellipse_statistics","search_sites","historical_landings","mission_lessons","similar_past_landings","launch_vehicle_record","launch_slip_risk")`
  - Extra server-only tool `record_planner_request(text: str)`: emits a `UserPrompt` event into the run transcript so `typed_inputs.user_request()` sees the request (spec: headless assumptions). Not meant for the model; the evaluator calls it directly.
  - Each MCP result: one text content item with `json.dumps(payload)`; `isError` from `invoke`.
  - Run directory: `RunPaths.create(config.runs_dir, "mcp-" + new_run_id())`; the server prints the run path to stderr on start.

- [ ] **Step 1: Implement** with the low-level server of the installed `mcp` package (`list_tools` returns `Tool(name, description, inputSchema=item.input_model.model_json_schema())`; `call_tool` → `invoke(item, ctx, args)`), stdio by default, streamable HTTP on `127.0.0.1:PORT` with `--http`. Check the installed `mcp` version's API before writing (2.x may rename helpers); stick to the low-level server since schemas already exist. `--no-tools` exposes nothing but `record_planner_request` (baseline runs).
- [ ] **Step 2: List tools.**

Run: `npx -y @modelcontextprotocol/inspector --cli uv run lunarnav mcp --method tools/list | grep -c '"name"'`
Expected: `21`.

- [ ] **Step 3: Call a real engine tool end-to-end.**

Run: `npx -y @modelcontextprotocol/inspector --cli uv run lunarnav mcp --method tools/call --tool-name catalog_search --tool-arg query=Shackleton`
Expected: JSON rows with sites and a `provenance.ledger_id` of `L0001`.

- [ ] **Step 4: Blind leak check** (Review Focus 1).

Run: `npx -y @modelcontextprotocol/inspector --cli uv run lunarnav mcp --blind-exclude im-1-odysseus --method tools/call --tool-name historical_landings | grep -iE "odysseus|im-1|intuitive|nova-c|athena" ; echo exit=$?`
Expected: no matches, `exit=1`. Repeat with `catalog_search near_lat_deg=-80.13 near_lon_deg=1.44 radius_km=50`.

- [ ] **Step 5: Commit** `feat(mcp): standalone lunarnav MCP server`

---

### Task 6: Evaluator scaffold and MCP connection

**Files:**
- Create: `evaluator/package.json`, `evaluator/tsconfig.json`, `evaluator/.env.example`
- Create: `evaluator/src/mcp.ts`

**Interfaces:**
- Produces:
  - `connectLunarnav(opts: { blindExclude?: string; noTools?: boolean; url?: string }): Promise<{ tools: ToolSet; recordRequest(text: string): Promise<void>; close(): Promise<void> }>` — `url` set → HTTP transport to a running `lunarnav mcp --http`; otherwise stdio spawning `LUNARNAV_MCP_CMD` (default `uv run lunarnav mcp`, on Windows `wsl -e bash -lc "cd <repo> && uv run lunarnav mcp"`) with the blind/no-tools flags appended. `tools` excludes `record_planner_request`.

- [ ] **Step 1: Scaffold** with bun: deps `ai`, `@ai-sdk/anthropic`, the AI SDK MCP client package for the installed `ai` major (`@ai-sdk/mcp` `createMCPClient`; older majors export `experimental_createMCPClient` from `ai`), `@modelcontextprotocol/sdk` (stdio transport), `zod`; dev `typescript`, `@types/bun`, `promptfoo`. Scripts: `review`, `backtest`, `typecheck`.
- [ ] **Step 2: Implement `connectLunarnav`.**
- [ ] **Step 3: Verify.**

Run: `cd evaluator && bun install && bun run typecheck && bun -e "import {connectLunarnav} from './src/mcp'; const c = await connectLunarnav({}); console.log(Object.keys(c.tools).length); await c.close()"`
Expected: `20`.

- [ ] **Step 4: Commit** `feat(evaluator): MCP client for lunarnav`

---

### Task 7: Review board and CLI

**Files:**
- Create: `evaluator/src/schema.ts`, `evaluator/src/prompt.ts`, `evaluator/src/review.ts`, `evaluator/src/cli.ts`

**Interfaces:**
- Consumes: `connectLunarnav` (Task 6).
- Produces:
  - `schema.ts`: `CRITERIA` (the 8 `Criterion` keys from Task 1, same spelling), `Rating = "go"|"caution"|"no-go"|"unresolved"`, `ReviewSchema` (zod): `{ criteria: Record<Criterion, { rating: Rating; finding: string; evidence: string[] }>, overall: Rating, topRisks: { risk: string; echoes: string[] }[] }`.
  - `review.ts`: `reviewSite(input: { lat: number; lon: number; landingUtc: string; landerId: string; launchVehicleId: string; missionHours?: number; blindExclude?: string; noTools?: boolean; url?: string }): Promise<{ review: Review; ledgerIds: string[]; steps: number }>`.
  - `cli.ts`: `bun run review --lat … --lon … --date … --lander … --vehicle … [--hours 336] [--url http://127.0.0.1:8765/mcp]` prints the review as markdown.

- [ ] **Step 1: `prompt.ts`** — the review-board system prompt. Required rules (exact meaning, wording free): use tools for every number; cite ledger ids in `evidence`; `unresolved` when `terrain_resolution_m > 20` for slope/hazard criteria; only `site_related` causes count against the site; call `launch_slip_risk` then `slip_analysis` for `launch_slip`; call `similar_past_landings` for `past_failures`.
- [ ] **Step 2: `review.ts`** — two phases: `generateText` with `tools`, `stopWhen`/`maxSteps` 30, collecting every `provenance.ledger_id` from tool results; then `generateObject` with `ReviewSchema` over the transcript. `recordRequest` is called first with the human-readable request. `noTools` runs phase 2 only on the prompt.
- [ ] **Step 3: `cli.ts`.**
- [ ] **Step 4: Evidence check** (Review Focus 3): after phase 2, every criterion not `unresolved` must have ≥ 1 evidence id and every id must be in `ledgerIds`; otherwise throw `InvalidReview` listing the offenders. Skip this check when `noTools`.
- [ ] **Step 5: Run a south-polar and a non-polar review.**

Run: `cd evaluator && bun run review --lat -85.29 --lon 36.3 --date 2027-01-15T12:00Z --lander griffin --vehicle falcon-heavy --hours 336`
Expected: 8 criteria with ratings, every non-`unresolved` one citing `L…` ids.

Run: `bun run review --lat 18.56 --lon 61.81 --date 2027-03-02T08:00Z --lander blue-ghost --vehicle falcon-9`
Expected: `slope_tipover` and `ellipse_hazards` are `unresolved` (Review Focus 2).

- [ ] **Step 6: HTTP mode** (Review Focus 5): in WSL `uv run lunarnav mcp --http 8765`; from Windows `bun run review … --url http://127.0.0.1:8765/mcp`. Expected: same output shape.
- [ ] **Step 7: Commit** `feat(evaluator): site review board and CLI`

---

### Task 8: Blinded backtest with baseline

**Files:**
- Create: `evaluator/backtest/cases.ts` (generator), `evaluator/backtest/provider.ts`, `evaluator/backtest/promptfooconfig.yaml`, `evaluator/backtest/summary.ts`

**Interfaces:**
- Consumes: `reviewSite` (Task 7); `missions.yaml` via `uv run python -c` export (below).
- Produces:
  - `uv run python -m lunarnav.history export-cases > evaluator/backtest/cases.json` (add `export-cases` to `history.py`'s `__main__`): per mission with a site: `{mission_id, lat, lon, landing_utc, lander_alias, launch_vehicle_id, expected: {criterion: "flag"|"clear"}}` where `flag` = mapped criterion of a `site_related` cause, `clear` = the site criteria for successes; non-site failures expect `clear` on site criteria.
  - `provider.ts`: promptfoo custom provider; `config.mode: "tools" | "baseline"`; calls `reviewSite({... , blindExclude: mission_id, noTools: mode==="baseline"})`; returns the review JSON as `output`.
  - `promptfooconfig.yaml`: two providers (tools, baseline) × all cases; assertion (javascript): for each `flag` criterion the rating is `caution` or `no-go`; for each `clear` criterion it is not `no-go`; cases whose site has `terrain_resolution_m > 20` are tagged `group: coarse`.
  - `summary.ts`: reads promptfoo's JSON output and prints, per provider: hit rate on `site_related` failures, false-alarm rate on successes, separately for `group: coarse`.

- [ ] **Step 1: Implement the case export and the backtest files.**
- [ ] **Step 2: Dry run on two cases** (`--filter-first-n 2`): `cd evaluator && npx promptfoo eval -c backtest/promptfooconfig.yaml --filter-first-n 2 -o backtest/out.json && bun backtest/summary.ts backtest/out.json`. Expected: a table with both providers.
- [ ] **Step 3: Leak audit**: grep every run directory created by the dry run for the tested mission's name/id/lander id. Run: `grep -rilE "odysseus|nova-c" <runs dir printed by the server>/mcp-* || echo clean`. Expected: `clean`.
- [ ] **Step 4: Full run — only after Task 2 Step 6 label review is done.** `npx promptfoo eval -c backtest/promptfooconfig.yaml -o backtest/out.json && bun backtest/summary.ts backtest/out.json`. Expected: a summary line per provider, e.g. `tools: 6/8 site failures flagged, 1/5 false alarms | baseline: …`.
- [ ] **Step 5: Write `evaluator/README.md`**: setup (WSL engine, key, `bun install`), `review` usage, backtest usage, how to read the summary, and the honest framing (the claim is the tools-vs-baseline gap).
- [ ] **Step 6: Commit** `feat(evaluator): blinded backtest with no-tools baseline`
