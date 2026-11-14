# Mission-history site evaluator (MCP server + Vercel AI SDK review board)

Date: 2026-11-14

## Intent

Put ourselves in the shoes of NASA landing-site engineers. When they pick where to land, they look at a set of
public data: terrain and slope, illumination and power, direct-to-Earth visibility, hazards in the landing
ellipse, and the lessons of past landings and launches. This feature gives an LLM that same set of data as MCP
tools and asks it to act as a site-selection review board for a candidate site and date.

It has two halves:

1. **Evaluate**: given a candidate site, date and lander, the LLM calls the tools and writes a reviewed
   verdict per criterion, each claim backed by a tool result, including which past failures the candidate
   resembles.
2. **Backtest**: replay historical landings (successes and failures) through the same evaluator, blinded,
   and score whether it flagged the risks that actually happened. This is the proof that the evaluator works
   and a headline for the demo ("flagged the real risk in N of M past landings").

## Goals

- A standalone MCP server, `lunarnav mcp`, usable by any MCP client (Vercel AI SDK, Claude Desktop, Cursor).
- It exposes the existing engine tools (real SPICE and LOLA numbers, same provenance ledger) plus new
  mission-history tools.
- A curated dataset of historical lunar landings and launch-vehicle records, sourced the same way the
  existing catalog is (URLs, confidence grade).
- A TypeScript evaluator built on the Vercel AI SDK that runs the review board against the MCP server.
- A blinded backtest run with promptfoo, producing a score table.

## Non-goals

- No change to the existing web app or the existing Claude agent in this round.
- No new raster data products (Diviner rock abundance, temperature maps, LEND hydrogen) in v1. Listed as a
  stretch below.
- No hosting on Vercel. The Vercel AI SDK is an open-source npm library and runs locally; no Vercel account
  is needed.

## Anti-goals (would count as failure even if it runs)

- The LLM states numbers it did not get from a tool. Every number in a verdict must trace to a tool call.
- The backtest leaks the answer: the mission name, operator, or the mission's own lessons record reaches the
  model during its own test case.
- Treating every historical failure as a site lesson. Engine faults (Peregrine propellant leak, Luna-25 burn,
  Beresheet gyroscope) are not evidence against a site; only site-related causes may count against one.

## Constraints

- The engine runs on Linux (SPICE kernels, terrain stores, numba). On the user's Windows machine this means
  WSL. The TypeScript evaluator can run on either side as long as it can launch or reach the server.
- `AGENTS.md`: no code comments and no unit tests. The promptfoo backtest is an evaluation of model
  behaviour, not a unit test, and is in scope.
- The `mcp` Python package (2.3.0) is already in `uv.lock` as a dependency of `claude-agent-sdk`; add it as a
  direct dependency rather than a new library.
- LLM cost is the Anthropic API (user's key). Default model: Claude (latest Sonnet-class) through
  `@ai-sdk/anthropic`; the model is a config value.

## Approaches considered

- **A. Extend the existing Python Claude agent.** Add tools next to the ~30 existing ones; backtest via
  promptfoo against `lunarnav agent`. Least new code, but no Vercel AI SDK and tied to the Claude Agent SDK.
- **B. Standalone Python MCP server + Vercel AI SDK evaluator (chosen).** Keeps the real engine numbers,
  uses a standard MCP interface any client can use, uses the Vercel AI SDK as the user wanted, and keeps this
  work cleanly separate from the teammate's agent and web app. Costs: two languages, engine needs WSL.
- **C. All TypeScript, precomputed JSON.** Runs on Windows immediately but cannot compute illumination or
  terrain, so it only knows sites computed ahead of time. Kept as the fallback if WSL setup fails.

The user picked **B**.

## Design

### 1. Mission-history data (`src/lunarnav/catalog/`)

New file `missions.yaml`, loaded and validated by a pydantic model in `catalog/models.py`, following the
existing catalog conventions (`sources` with opened URLs, `confidence`).

Per landing attempt:

- `id`, `name`, `site_id` (references `sites.yaml`; most attempts are already there: `im-1-odysseus`,
  `im-2-athena`, `hakuto-r-m1`, `hakuto-r-m2`, `beresheet`, `chandrayaan-2-vikram`, `chandrayaan-3-vikram`,
  `slim`, `luna-25-target`, `peregrine-m1-target`, `blue-ghost-m1`, `change-6`, plus Chang'e 3/4/5 and
  Apollo/Surveyor/Luna successes where useful), `lander_id` (references `landers.yaml` where present),
  `launch_vehicle_id`, `launch_utc`, `landing_utc`.
- `outcome`: `success | partial | failed_landing | failed_before_landing`.
- `causes`: list of `{category, summary, site_related}` where `category` is one of `slope_tipover`,
  `illumination_power`, `terrain_navigation` (e.g. altimeter confused by a crater rim), `thermal`,
  `comms`, `propulsion`, `gnc_software`, `sensor`, `launch_vehicle`, `other`, and `site_related` is a bool.
- `lessons`: short engineering lessons stated as checks a planner could apply to a new site
  (e.g. "landing on a crater wall in low sun left the lander in shadow after tipping").
- `observed`: the facts the backtest scores against (e.g. `tipped: true`, `power_lost_h: …`).

New file `launch_vehicles.yaml`: per vehicle, flight history counts (attempts, failures, partial), each
failure with date, cause and source, and lunar missions flown. Covers at least Falcon 9, Falcon Heavy,
Firefly Alpha (Reaver engine failures), H-IIA, PSLV/GSLV/LVM3, Long March 3B/5, Soyuz, Electron, and
whatever launched the missions in `missions.yaml`.

### 2. MCP server (`src/lunarnav/mcp/`, CLI `lunarnav mcp`)

- Built with the official `mcp` Python package; stdio transport by default, streamable HTTP via
  `--http PORT` for clients on the Windows side.
- Reuses the existing `ToolRegistry` and `invoke()` from `agent/registry.py`: each registered `AgentTool`
  becomes an MCP tool with the same name, description and pydantic JSON schema, so validation, the
  provenance ledger and the output limits all stay identical. A `ToolContext` is built the way
  `agent/session.py` builds it, with a run directory per server process.
- Exposes only `read_only` engine tools plus `build_scenario` and `catalog_search` (scenario building
  is needed before `evaluate_site`). Inbox, ingest and export tools are left out.
- New tools, registered with `agent_tool` so the existing agent could use them too:
  - `historical_landings(filter)`: list attempts with outcome and causes; filter by region, outcome,
    cause category, `site_related`.
  - `mission_lessons(mission_id)`: full causes and lessons of one attempt.
  - `similar_past_landings(scenario_id)`: compares the candidate with every past attempt using engine
    numbers it computes for both (latitude band, ellipse slope stats from `ellipse_statistics`, sun
    elevation at landing and time to sunset from `evaluate_site`, crater/rim setting from `terrain_info`)
    and returns the closest past attempts with which features matched.
  - `launch_vehicle_record(vehicle_id)`: history, failure rate with a simple interval (e.g. Wilson), and
    recent failures.
  - `launch_slip_risk(vehicle_id, landing_utc)`: from the vehicle's history, the chance of a slip and
    typical slip lengths; returns dates that the evaluator can feed into the existing `slip_analysis`.
- **Blind mode**: a server flag `--blind-exclude MISSION_ID` hides that mission (and its site entry's
  name, operator and status text) from every tool's output, so the backtest can run each case without
  leaking the answer.

### 3. Evaluator (`evaluator/`, TypeScript, bun)

- Vercel AI SDK (`ai`) with `@ai-sdk/anthropic` and the SDK's MCP client connecting to `lunarnav mcp`.
- One function `reviewSite({ lat, lon, landingUtc, landerId, launchVehicleId })` runs a multi-step tool
  loop with a "site selection review board" system prompt covering: slope and tip-over, illumination and
  power through the mission, Earth link, ellipse hazards, launch-slip robustness, and resemblance to past
  failures.
- Output is a structured object (`generateObject` / zod schema): per criterion `{ rating: go | caution |
  no-go, finding, evidence: [tool call ids] }`, an overall verdict, and the top risks with the past
  missions they echo.
- A small CLI: `bun run review --site <id or lat,lon> --date … --lander …` printing the review as
  markdown.

### 4. Backtest (`evaluator/backtest/`, promptfoo)

- One test case per mission in `missions.yaml` with a site-related cause plus a set of successes as
  controls.
- Each case starts the MCP server with `--blind-exclude <mission>` and gives the evaluator only
  coordinates, landing time, lander specs and launch vehicle. No names.
- Assertions: for a failure with a site-related cause, the matching criterion must be `caution` or
  `no-go` and its finding must name the right factor; for a success, no `no-go` on that factor.
  Engine/launch-only failures are expected to pass the site criteria.
- Output: promptfoo's table plus a summary line (hit rate on site-related failures, false alarm rate on
  successes) for the demo.

### Calls made after the builder check

- **Time cutoff (my call).** Blind mode hides the tested mission *and every landing or launch record dated
  after its landing*, so IM-1 is never judged with IM-2's lesson. Blind mode also hides site ids, lander
  ids, `sources[].locator` text and status notes, not only names.
- **Which point is evaluated (my call).** The backtest uses the recorded touchdown or impact point from
  `sites.yaml`, framed as "would the evaluator have flagged this exact spot". Planned targets and ellipses
  are recorded in `missions.yaml` where published and used instead when present (`luna-25-target`,
  `peregrine-m1-target`).
- **Terrain resolution (my call).** Each case records the terrain product that covered it. Cases with only
  `lola_global_64ppd` (~470 m/px) are scored in a separate "terrain cannot resolve" group, not in the
  headline hit rate. The headline therefore leans on south-polar cases, which is where the challenge is.
- **Evidence ids (my call).** `evidence` holds the ledger ids (`L0001`…) that `invoke()` already returns in
  `provenance`. The evaluator checks that every finding cites at least one id that exists in the run's
  ledger and rejects the review otherwise. No per-number check in v1.
- **Launch slip data (my call).** `launch_slip_risk` uses the vehicle's failure rate times its documented
  stand-down after past failures (e.g. Firefly Alpha's grounding periods), plus sourced mission-level slip
  records where they exist. No per-launch planned-vs-actual history.
- **Headless assumptions (my call).** In MCP mode there is no user request text, so `build_scenario` will
  mark every custom value as a pending assumption. The server treats the MCP call arguments as the request
  so these are not flagged.

### Decided by the user after the builder check

- **No-tools baseline.** Blinding the tools does not stop the model recognising famous coordinates and dates
  from training. Every backtest case also runs with tools disabled (same blinded prompt), and both scores
  are reported side by side. The demo claim is the gap between the two, not the raw hit rate. Input
  perturbation (shifting dates or coordinates) is not done.
- **Label review before the backtest.** The builder drafts causes, `site_related` flags and the mapping from
  cause category to review criterion in `missions.yaml`, with sources. The user or a teammate reviews that
  file before any backtest run counts. The labels are delivered as a separate step from the evaluator.

### Stretch (only if time allows)

- Diviner rock abundance and surface temperature as extra tools.
- A page in the web app showing a review.

## Left to the builder

- Exact similarity features and weighting inside `similar_past_landings`.
- The review-board prompt wording and the zod schema field names.
- How the TS evaluator launches the server across WSL (stdio through `wsl` or HTTP on localhost).
- Which successes to include as controls.
