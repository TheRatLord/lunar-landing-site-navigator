# CLAUDE.md — Lunar Landing Site Navigator (NASA Space Apps 2026)

You are Claude Code working on the **Lunar Landing Site Navigator**, an entry for the NASA Space Apps
Challenge 2026 challenge of the same name ([`problem-statement.md`](problem-statement.md)). Read this file
fully, then [`README.md`](README.md) for what the app does. If the two ever disagree, **this file wins**;
tell your human about the conflict.

**Starting or resuming a session:** read `docs/PROGRESS.md` first and continue from the first unchecked
item. Keep it current after every meaningful step so any fresh session can pick up without re-deriving
context.

**Fresh clone or new machine?** Follow [`docs/SETUP.md`](docs/SETUP.md) first: tools, SPICE kernels,
terrain, running the service and the web app, the analysis agent, and the checks. Walk your human through
it step by step and stop at anything that needs their login, `sudo` or money.

**Don't edit this file's rules** (§1–§3, §12–§14) without your human's explicit OK. Progress goes in
`docs/PROGRESS.md`, not here.

**How this file is laid out.** Sections 1 to 3 and 12 to 14 are the rules. Sections 4 to 11 are the
specification of the parts that already exist: how each one is meant to work, and which document holds the
evidence that it does. Read the section for a part before you change it; they are not a list of things to
do. What is being worked on now is in `docs/PROGRESS.md`.

After every meaningful step: run the checks for what you touched (§12), update `docs/PROGRESS.md`, commit
on your branch, and give your human a 3–6 line summary. **Do not start the next step if the current one's
checks fail.**

---

## 1. Ground rules (non-negotiable)

**Stop and ask your human before:**
- anything that emails or notifies other people (issues, comments that mention someone, invites);
- signing in, creating accounts, entering passwords, or anything needing 2FA (`gh auth login`, the Claude
  Code sign-in the agent runs under): your human does those;
- anything that costs money. **Agent runs spend real money** (a 5.00 USD cap per run by default,
  `LUNARNAV_API_AGENT_MAX_BUDGET_USD`). One short run to check a change is fine; ask before more, and never
  raise or remove the cap without an OK;
- `sudo`, `apt` or anything else that needs root. `scripts/bootstrap.sh` without `--no-sudo` uses `sudo`:
  give your human the command instead of running it;
- deleting branches or files you did not create in this session, force-pushing, or rewriting `main`;
- downloading any single file over 5 GB, or a batch of terrain products (`ingest build --all`): tell your
  human the size first;
- opening the service beyond one trusted operator: a non-loopback bind (`LUNARNAV_API_ALLOW_REMOTE=1`),
  extra CORS origins, the agent sandbox set to `off`, or a wider data-host allowlist for the agent;
- changing a pinned kernel (`MANIFEST` in `src/lunarnav/ephem/kernels.py`) or a terrain product's error
  budget (`PRODUCT_ERRORS` in `src/lunarnav/terrain/sources.py`). Both move every number the app shows.

**Hackathon integrity:**
- This repo is a **Space Apps 2026 submission** and it is **public**: everything committed here is
  published.
- Space Apps allows AI tools **with disclosure**: append one line per meaningful task to `AI_USAGE.md`
  (date, tool = "Claude Code", what you did).
- Cite every dataset, kernel, library and image in `REFERENCES.md` as you use it (name, URL, license/terms).
- No NASA logos or insignia in anything you generate. Any AI-generated image needs a visible "AI-generated"
  mark.

**Security & data hygiene:**
- Never commit secrets: `.env*`, tokens, Claude credentials. The service reads its settings from
  `LUNARNAV_*` environment variables, and none of them belongs in the repo.
- Never commit data. Kernels, terrain, agent runs and the service's cache live in `data/` (or
  `$LUNARNAV_DATA`), which is git-ignored. What is committed is small: the catalogue YAML,
  `src/lunarnav/regional/validation_reference.json`, `web/src/api/openapi.json`, screenshots and the
  validation figures.
- Public data only. No employer code, data, accounts or credentials.
- The agent runs code the model writes. It stays off unless `LUNARNAV_API_AGENT_ENABLED=1`, runs in the OS
  sandbox, and may read only `data/kernels` and `data/dem`. Keep it that way.

**Science honesty:**
- Never invent coordinates, dataset names, kernel names, lander parameters or numbers. If you can't verify
  something, say so, log it in `docs/OPEN_QUESTIONS.md`, and pick the safest option.
- Every number shown in the interface, a report or an agent answer comes from the engine and keeps its
  provenance: the `Origin` of a lander or constraint value, the `provenance` of a result, the ledger tag of
  an agent answer. Catalogue entries cite their sources (URL, title, locator) and a confidence; an estimate
  is flagged as one.
- The validation documents in `docs/validation/` report misses as well as hits. Never drop a failing case
  and never tune a parameter to hit a published value. If a change moves a validated number, rerun that
  check and write the new figure into the document.
- Say which numbers are bounds and which are estimates. The horizon's `elev_lo_deg`/`elev_hi_deg` bracket
  the model's horizon; the regional layers' `_lo`/`_hi` are estimated brackets, not bounds.

**Precision budget (avoid rabbit holes):** Sun and Earth directions agree with JPL Horizons to better than
1e-6° (`docs/validation/ephemeris.md` §1). Terrain error is larger by orders of magnitude: shadow boundaries
on real images are off by one to two 20 m cells, 26 to 41 minutes of sunrise or sunset time
(`docs/validation/imagery.md`). Ephemeris and frame details at the arcsecond level (DE440 vs DE441, the
predicted vs the daily Earth orientation kernel) are **out of scope**. Spend the effort on terrain, its
error budget and how the bracket is shown.

---

## 2. Stack (as built)

| Area | Choice |
| --- | --- |
| Python | ≥ 3.12 (`.python-version` pins 3.14) via **uv**; `numpy`, `scipy`, `numba`, `spiceypy`, `rasterio`, `httpx`, `pydantic` v2, `fastapi` + `uvicorn` + `sse-starlette`, `orjson`, `typer`, `pyyaml`, `matplotlib`, `pillow`, `weasyprint`, `claude-agent-sdk`; `ruff` |
| Ephemeris | **NAIF SPICE** generic kernels, pinned by size and SHA-256 (§4); frame **`MOON_ME`** |
| Terrain | **LOLA** GDR polar and global DEMs (PDS, `imbrium.mit.edu`), the 26 **PGDA product 78** 5 m site tiles, and SLDEM2015 / LDEM_512 windows fetched on demand; converted to memory-mapped stores (§5) |
| Engine | `src/lunarnav`: `ephem`, `terrain`, `horizon`, `visibility`, `scenario`, `regional`, `report` |
| Service | FastAPI under `/api/v1` (`lunarnav serve`), loopback only, a `spawn` process pool for jobs, a disk result cache, SSE for progress, OpenAPI; scenarios in SQLite (`data/service/documents.sqlite3`) |
| Reports | Self-contained HTML and PDF (WeasyPrint), figures by matplotlib |
| Agent | Claude Agent SDK through the Claude Code CLI, model id set explicitly (`claude-sonnet-5-5` in `src/lunarnav/agent/config.py`), CLI Bash sandbox required (bubblewrap on Linux) |
| Web | React 19 + TypeScript (strict) + Vite 8, built and run with **bun**; `react-router-dom`, `zustand`, `three` (learn mode, 3D terrain), `react-markdown`; API types generated from the OpenAPI document by `openapi-typescript`; Playwright for screenshots |
| Tests | pytest (engine) and vitest (web): **not set up yet**, see `docs/PROGRESS.md` |
| CI | None yet, see `docs/PROGRESS.md` |
| Hosting | None. It runs on the operator's machine: the service on `127.0.0.1:8000`, the dev server on `:5173` |
| **Not used** | Cloud hosting, stored API keys, a database server, third-party map libraries (the map is our own tile engine in `web/src/workspaces/map/`, drawing tiles from `/api/v1/terrain/tiles`) |

---

## 3. Repo layout

```
lunar-landing-site-navigator/
├── CLAUDE.md                 # this file (rules for agents)
├── AGENTS.md                 # one line: "Follow CLAUDE.md"
├── README.md                 # what this is, how to run
├── AI_USAGE.md  REFERENCES.md  FRICTION_LOG.md
├── problem-statement.md      # the challenge text
├── docs/
│   ├── PROGRESS.md           # what is done, what is next; updated every step
│   ├── OPEN_QUESTIONS.md     # anything unverified, with the interim choice
│   ├── SETUP.md              # from nothing to a pull request
│   ├── decisions/            # one file per decision, numbered
│   ├── validation/           # the evidence: one report per engine part, figures in img/
│   └── research/             # literature and published terrain error
├── src/lunarnav/
│   ├── cli.py                # `lunarnav serve | openapi | kernels | regional | agent | version`
│   ├── constants.py  types.py  # shared constants; cross-module value types (conventions are normative)
│   ├── ephem/                # kernels, ME tables, Sun/Earth/station tracks, time conversion
│   ├── terrain/              # product registry, ingest, stores, projections, the stack, regional windows
│   ├── horizon/              # horizon engine (branch-and-bound), blockers, seams, brute-force reference
│   ├── visibility/           # disc fractions, intervals, terrain-error widening, power, battery, comms
│   ├── scenario/             # models, evaluation, verdicts, scans, slip, ellipse, search, compare
│   ├── regional/             # gridded illumination and Earth-visibility layers (`python -m lunarnav.regional`)
│   ├── report/               # HTML/PDF mission report; computes nothing
│   ├── catalog/              # sites.yaml, landers.yaml, stations.yaml, each entry with sources
│   ├── api/                  # FastAPI app, routes, schemas, jobs, document store, settings
│   └── agent/                # analysis agent harness, engine tools, guard, sandbox config
├── validation/               # scripts behind docs/validation/illumination.md
├── scripts/bootstrap.sh      # system packages, dependencies, kernels, web build
├── web/
│   ├── package.json  vite.config.ts  eslint.config.js  tsconfig.json
│   ├── scripts/              # gen-api.ts, screenshots.ts, map-real.ts
│   ├── docs/screenshots/     # light and dark screenshots used by the README
│   └── src/
│       ├── api/              # client, endpoints, generated/schema.d.ts (generated, never hand-edited)
│       ├── workspaces/       # one folder per page: home, map, site, calendar, compare, ellipse, evidence…
│       ├── learn/            # interactive learn mode
│       ├── scenario/  ask/  agent/  shell/  state/  lib/  components/  styles/
│       └── App.tsx  main.tsx
└── data/                     # git-ignored: kernels/, dem/, runs/, service/
```

**Git workflow:** branch per change (`feat/ellipse-export`, `fix/horizon-seam`), small PRs, conventional
commit messages (`feat(scenario): …`, `fix(terrain): …`), link the issue when there is one (`Closes #3`).
No direct pushes to `main`: every change is a pull request with the checks green. Open the PR, show your
human the summary, and merge (`gh pr merge --squash`) only after they say OK — or once they have told you
"merge green PRs without asking" for the session.

---

## 4. Ephemeris (`src/lunarnav/ephem/`)

- **Kernels are a fixed set** (`MANIFEST` in `kernels.py`): `naif0012.tls`, `pck00011.tpc`, `de440.bsp`,
  `moon_pa_de440_200625.bpc` + `moon_de440_250416.tf`, the Earth orientation pair
  `earth_620120_260806.bpc` (history) and `earth_2026_260806_2126_predict.bpc` (predict), and
  `earthstns_itrf93_260814.bsp` + `earth_topo_260814.tf` for the DSN stations. Each is fetched from NAIF,
  checked against its pinned size and SHA-256, and furnished once per process. NAIF moves superseded files
  to `a_old_versions/`, which is tried next. `lunarnav kernels` downloads and verifies them into
  `data/kernels/`.
- The daily `earth_latest_high_prec.bpc` is **not** used: it changes every day and cannot be pinned. The
  predict kernel's error is under 0.002° of Earth rotation, inside the precision budget.
- All geometry is in **`MOON_ME`** (mean Earth / polar axis), the frame LOLA products and all site
  coordinates use. Sites are planetocentric, east-positive, on the 1737.4 km sphere (`R_MOON_M`).
- `table.py` is the only place SPICE is called for track geometry. It stores site-independent, smooth
  quantities per epoch (Sun and Earth centre from the Moon centre in ME, light time) and the per-site
  direction is derived from them with first-order displaced-observer terms. Cost of that approximation:
  at most 1.2e-9° (`docs/validation/ephemeris.md` §4).
- Apparent directions include light time and stellar aberration. Earth eclipses use the enlarged
  (Danjon) Earth shadow by default, the conservative direction for power; it reproduces published eclipse
  contacts within 4.6 s (§6 of the same document).
- CSPICE is never shared across threads or a forked process: the service loads kernels once in each
  `spawn`-ed worker.

Evidence: [`docs/validation/ephemeris.md`](docs/validation/ephemeris.md).

---

## 5. Terrain (`src/lunarnav/terrain/`)

- **Products** are registered in `sources.py` with their URLs, which were listed on the live servers and
  whose labels were read before use. Global `LDEM_64`; south polar LDEMs from 60°S at 240 m to 87.5°S at
  5 m; north polar LDEMs; the 26 PGDA product 78 tiles at 5 m with their per-pixel total-error rasters. A
  non-polar site gets a 59 m SLDEM2015 window (within ±60° latitude) or an LDEM_512 window (beyond) from
  `python -m lunarnav.terrain.regional`.
- `ingest fetch <dem_id>` downloads (resumable), `ingest build <dem_id>` converts to a store in
  `data/dem/store/<dem_id>/`: `meta.json` plus memory-mapped arrays. Opening a store keeps no file
  descriptor.
- Heights are radii above the 1737.4 km sphere. **Nodata stays NaN**: no hole filling, never 0.
- **`TerrainStack`** presents the stores as one model. Precedence: finest pixel first, then the better
  stated error. The bilinear composite is the terrain model every other part sees. Tile edges and holes
  can only make bounds looser, never wrong.
- **Every product has an error budget** (`ProductError`): 1σ height and horizontal error, each with its
  basis: `published`, `published-method`, `measured` or `assumed`. Figures come from
  `docs/research/terrain-error.md` and `docs/validation/terrain.md` §3.8. `TerrainStack.error_at` gives the
  budget of the store that supplies a height. The terrain package does not widen anything; that is the
  visibility layer's job (§7).
- Without terrain, the engine falls back to a smooth sphere horizon, and says so in the provenance.

Evidence: [`docs/validation/terrain.md`](docs/validation/terrain.md),
[`docs/research/terrain-error.md`](docs/research/terrain-error.md).

---

## 6. Horizon (`src/lunarnav/horizon/`)

- For each azimuth `az_k = k·360/N` (clockwise from local north, `N = 720` by default) the engine returns
  three numbers on the sphere, with elevation measured from the plane perpendicular to the observer's
  radial: `elev_lo_deg` (highest terrain sample on the exact ray, a true lower bound), `elev_hi_deg` (an
  upper bound over the whole azimuth bin, from max-pyramids) and `elev_deg` (best estimate, the middle of
  `lo` and the ray's own upper bound). Plus `blocker_dist_m`.
- The search is a branch-and-bound over wedges (distance × azimuth offset). It starts 1 m from the observer.
  `min_range_m` can exclude the lander's own footprint; it is off by default.
- **Use `lo`/`hi`, not `elev`, for conservative statements.** Next to steep pixel-scale relief `elev` can sit
  up to about 2° above the true peak (inside the bracket).
- The bracket is the numerical tolerance of the search only. DEM error is added later, by the visibility
  layer.
- Results are cached under keys that include `ENGINE_VERSION` (`horizon-bnb/4` in `engine.py`). **Bump it
  whenever the numerics or the provenance change.**
- The observer stands `mast_height_m` above the terrain: 2 m by default for a `Site`, 0 m by default for the
  regional layers (§9). Say which one a figure uses.

Evidence: [`docs/validation/horizon.md`](docs/validation/horizon.md).

---

## 7. Visibility (`src/lunarnav/visibility/`)

- Pure maths: **no SPICE and no terrain access**. Inputs are `TargetTrack` and `HorizonProfile` from
  `lunarnav.types`, or plain arrays. Keep it that way; it is what makes the layer testable.
- `disc.py`: the visible fraction of the Sun's and Earth's discs above the horizon, with Sun limb
  darkening (`limb_darkening.py`, exponent fitted in `limb_spectrum.py`). The disc is treated in a tangent
  plane: error below 2e-4 for horizons up to 20°.
- `intervals.py`: rise and set events and windows. A feature shorter than the sampling step cannot be
  found; pick the step accordingly.
- `uncertainty.py`: widens the horizon by the terrain error budget, per azimuth, to give the optimistic
  and pessimistic horizons.
- `power.py`, `battery.py`: array power and battery state of charge. No albedo, diffuse light, thermal
  derating or ageing.
- `comms.py`, `link_budget.py`: direct-to-Earth contact windows against station elevation masks, and a
  link budget whose terms the user supplies.

Evidence: [`docs/validation/visibility.md`](docs/validation/visibility.md).

---

## 8. Scenario (`src/lunarnav/scenario/`)

- The planner's answers: `evaluate_scenario` (one landing epoch: verdict, metrics, intervals, series),
  `scan_opportunities` (every candidate landing epoch), `slip_analysis` (what still works if the landing
  moves), plus sensitivity, terrain attribution, landing-ellipse statistics, site search and comparison.
- Numbers come **only** from `ephem`, `visibility` and a horizon provider. The scenario layer combines;
  it does not compute geometry of its own.
- Models are pydantic v2 and round-trip through JSON. `LanderProfile` and `Scenario` carry a
  `schema_version`; a different major version is rejected on load. Units are in field names; times at the
  boundary are ISO-8601 UTC with `Z`.
- Values with provenance carry an `Origin` (published, derived, estimate, user input). Catalogue lander
  profiles are estimates unless flagged published, and the flag travels with every result.
- **Verdicts** are per constraint: value, limit, signed margin, unit and state `pass`, `marginal` or
  `fail`. A case (nominal, optimistic, pessimistic) is a horizon bound and a heading bound taken
  together.
- **Heading is unknown** before landing (`yaw_deg = None`). Then there is no nominal minimum state of
  charge; a constraint that passes at some headings and fails at others is `marginal`, "depends on
  heading", with the best and worst heading.
- The Earth-link antenna height is not published by any operator. The catalogue gives a conservative
  height and an upper bound, so the unknown position is inside the reported range.

Evidence: [`docs/validation/scenario.md`](docs/validation/scenario.md).

---

## 9. Regional layers (`src/lunarnav/regional/`)

- A fast estimate over an area: `python -m lunarnav.regional` (or `lunarnav regional`) writes GeoTIFF layers
  and a `header.json`. **The per-site exact engine is the reference**; a reliable point value comes from the
  site search, not from a layer.
- Shipped defaults: observer 0 m, any part of the Sun's and Earth's discs, 360 azimuths, hourly. Studies
  that assume a raised observer (often 2 m) need `--mast`.
- Each layer has an accuracy class (`supported`, `approximate`, `bracket_only`). The longest shadow and the
  longest Earth outage are `bracket_only`: show the bracket, never the point value.
- The `_lo`/`_hi` layers are **estimated brackets, not bounds**. Cells within 2 cells of a change of terrain
  product are flagged unreliable.
- Every run measures its own error against the exact engine and writes it into `header.json` and the
  GeoTIFF tags, beside the validated figures (`validation_reference.json`) and the configuration those
  hold for.

Evidence: [`docs/validation/illumination.md`](docs/validation/illumination.md), scripts in `validation/`.

---

## 10. Service, reports and the agent (`api/`, `report/`, `agent/`)

- **Service.** `create_app()` in `api/app.py`; routes under `/api/v1`. One trusted operator: it binds to
  loopback and refuses any other address unless `LUNARNAV_API_ALLOW_REMOTE=1`. Settings come from
  `LUNARNAV_*` variables (`api/settings.py` documents each one).
- **Jobs.** Long analyses run in a bounded `spawn` process pool (`api/jobs.py`). Long kinds can never take
  the reserved workers, so a short analysis always finds one. Beyond the queue limit a submission gets
  HTTP 429. Results are JSON files keyed by the SHA-256 of (kind, kind version, request, data versions).
  **Bump a kind's version when its output changes.** Cancellation is cooperative: a job must report
  progress to be cancellable.
- **Contract.** After changing a route or schema, regenerate the contract and the web types together:
  `uv run lunarnav openapi web/src/api/openapi.json && (cd web && bun run gen:api)`.
- **Reports.** `report/` turns engine results into HTML and PDF and **computes nothing**.
- **Agent.** Off by default; every agent endpoint answers 404 while off. It runs under the Claude Code CLI
  with an explicit model id (never the CLI's default, which follows the user's own settings), a spend cap,
  and the CLI Bash sandbox in `require` mode: it refuses to start when the sandbox is unavailable. It
  reaches the engine only through typed tools (`agent/engine_tools/`), and every call is recorded in a
  ledger.
- **The answer guard** (`agent/guard.py`) checks every number, instant and date in a final answer: it must
  appear in a record of the run, be cited with its ledger tag (`[L0012]`, `[L0006#row]`), keep its sign and
  unit, and clock times must be UTC. It catches slips. It does not prove a sentence true.

---

## 11. Web app (`web/`)

- The overview is the home page: move the site on the map, drag the year timeline, pin a site, and see Sun
  and Earth against the horizon, time to sunset and Earthset, and the windows with both. The detailed pages
  (map, site, calendar, compare, ellipse, evidence) sit under "Detailed analysis", next to the learn mode.
- **Every number comes from the API.** The web app formats and draws; it does not compute engine
  quantities. Types come from `src/api/generated/schema.d.ts`, generated from the OpenAPI document.
- Each number links to the validation that measured it (the evidence pages serve `docs/validation/` and
  `docs/research/`).
- The dev server proxies `/api` to `$LUNARNAV_API` or `http://127.0.0.1:8000`; `lunarnav serve` serves the
  built app from `web/dist`.
- Light and dark themes, both kept working. `bun run screenshots` refreshes `web/docs/screenshots/`; refresh
  them when a page shown in the README changes.
- Accessibility basics: labels on controls, enough contrast in both themes, keyboard-operable timeline
  and map.

---

## 12. Coding conventions and checks

- Python: type hints, `from __future__ import annotations`, small pure functions, `ruff check` clean
  (line length 110). IO stays at the edges (`kernels.py`, `terrain/ingest.py`, the stores, `api/`).
- **Docstrings on every public module, class and function, with units** (degrees, metres, hours, UTC),
  in the style already in the code: what it returns, the frame and conventions, and where the evidence is.
  Comments explain *why*, not what.
- Units in names when ambiguous (`elev_deg`, `dist_m`, `range_km`, `_h`, `_w`, `_wh`, `_db`). Times are
  ISO-8601 UTC with `Z` at every boundary and ET (TDB seconds past J2000) inside the engine.
- Value types are frozen dataclasses with `slots=True` (`types.py`); documents are pydantic v2 models.
- TypeScript: strict mode (as in `tsconfig.json`), no `any`, API types imported from the generated schema.
  Keep components under about 200 lines; 31 of 144 are over today, so don't grow them.
- **Tests:** pytest under `tests/` for the engine, vitest beside the code for web data transforms. Write a
  test with every change to engine logic. Tests use synthetic fixtures: no downloads, no network, no
  real terrain, no model calls. Closed-form cases first (a smooth sphere gives horizon −√(2h/R)), then
  known geometry. Neither runner is set up yet (`docs/PROGRESS.md`).
- Prefer boring and readable over clever; judges and future maintainers will read it.

**Checks** (run what covers the files you touched):

```sh
uv run ruff check .                        # engine, service, agent
(cd web && bun run typecheck && bun run lint && bun run build)
uv run lunarnav openapi web/src/api/openapi.json && (cd web && bun run gen:api) && git diff --exit-code web/src/api
```

The last line checks that the contract and the web types are in step. Once pytest and vitest exist, add
`uv run pytest` and `(cd web && bunx vitest run)`. `ruff format` is not applied to the codebase yet: don't
reformat files you aren't otherwise changing.

## 13. When unsure

Write the question to `docs/OPEN_QUESTIONS.md`, choose the conservative option, keep going, and tell your
human in your summary. Never fake data to make the interface look done: use an obvious "pending" state.

## 14. Permissions tip

Claude Code asks before running commands. To reduce prompts, allow routine ones for this project (`git`,
`gh`, `uv`, `bun`, `bunx`, `ruff`, `pytest`), but keep prompts on for `sudo`, `apt`, `rm -rf`, anything that
starts an agent run (it spends money), `lunarnav serve` with `LUNARNAV_API_ALLOW_REMOTE`, and terrain
downloads.
