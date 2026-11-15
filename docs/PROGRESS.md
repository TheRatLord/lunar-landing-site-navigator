# Progress

Resume from the first unchecked item. Update after every meaningful step.

- Repo: https://github.com/TheRatLord/lunar-landing-site-navigator (public)
- First commit: `0cef76d` "Lunar Landing Site Navigator" (2026-11-14), the whole app in one commit

## What exists (as of 2026-11-14)

Recorded from the code and the validation documents at commit `0cef76d`; nothing below was rebuilt or rerun
for this list unless it says so.

- [x] Engine (`src/lunarnav`): ephemeris, terrain stores, horizon engine, visibility, scenario layer,
      regional layers, report. Each part has a validation report in `docs/validation/`
- [x] HTTP service (`lunarnav serve`): FastAPI under `/api/v1`, job pool, exports, HTML/PDF reports
- [x] Analysis agent (`lunarnav agent`), off by default, sandboxed, with the answer guard
- [x] Web app (`web/`): overview, map, site, calendar, compare, ellipse, evidence, learn mode; screenshots in
      `web/docs/screenshots/`
- [x] `scripts/bootstrap.sh` (Linux: apt packages, AppArmor profile for the agent sandbox, uv, bun, kernels,
      web build)
- [x] SPICE kernels present in `data/kernels/` on this Mac (9 files, the `MANIFEST` set)
- [ ] Terrain stores: none in `data/dem/` on this Mac, so the engine runs on the smooth sphere here

## Documentation in the house style ✅ (2026-11-14)

- [x] `CLAUDE.md`: rules, stack, layout, spec of each part, conventions, checks. Deleted again in `772c744`
- [x] `AGENTS.md` is the rule file again since `772c744`: no code comments or tests, push straight to `main`
      after `git fetch` and a rebase, never force-push. Decision [0004](decisions/0004-docstrings-and-tests.md)
      no longer applies
- [x] `docs/SETUP.md`, `docs/OPEN_QUESTIONS.md`, `docs/decisions/`, `REFERENCES.md`, `FRICTION_LOG.md`,
      `AI_USAGE.md`
- [x] README: "Where the numbers come from" and "Working on it" sections
- [x] `uv run ruff check .` passes
- [ ] Web checks (`bun run typecheck`, `lint`, `build`) not run: bun is not installed on this Mac and
      `web/node_modules` is empty (FRICTION_LOG)

## Next

Tests are out: `AGENTS.md` forbids them, so the pytest, vitest and CI test items below are dropped.

- [ ] Run the web checks on a machine with bun, or in the dev container, and record the result here
- [ ] Set up pytest: add `pytest` to the `dev` dependency group, `tests/`, and one closed-form test per
      engine part (smooth-sphere horizon, disc fraction at known offsets, interval merging, a verdict margin)
- [ ] Set up vitest in `web/` with one test for a data transform in `web/src/lib/`
- [ ] CI (`.github/workflows/ci.yml`): `uv sync`, `ruff check`, `pytest`; `bun install --frozen-lockfile`,
      `typecheck`, `lint`, `vitest`, `build`; the OpenAPI contract check from `CLAUDE.md` §12. No kernels,
      terrain or model calls in CI
- [ ] Decide whether to apply `ruff format` to the whole codebase in one commit (143 files would change)
      or leave it off (`docs/OPEN_QUESTIONS.md` #2)
- [ ] Fill in `AI_USAGE.md` for the work before 2026-11-14, if AI tools were used (`docs/OPEN_QUESTIONS.md` #1)

## Rover simulation (design, started 2026-11-14)

- [x] Round 1 choices recorded: [decision 0005](decisions/0005-rover-simulation.md)
- [ ] Settle the rest of the design (decision 0005, "Still open") as the increments need it

### Increment 1: ground view on the overview (branch `feat/ground-view`, 2026-11-14)

- [x] Zoom the overview map in past its closest zoom (or press "Stand here") to fly down from 30 km and
      stand at the plan site at the solar array's height (`web/src/workspaces/home/ground/`)
- [x] Terrain from `/terrain/patch`: 4 km at 5 m, 24 km at 40 m, 100 km at 200 m, exact on the sphere;
      beyond 50 km a ring whose top edge is the engine's horizon profile
- [x] Lit only by the engine's Sun direction, cascaded shadow maps; Sun and Earth at their true angular
      sizes from the engine's tracks; follows the overview's time (date buttons, play, timeline drag)
- [x] Checked in headless Chromium (SwiftShader) at De Rosa CR1: fly-down, Sun at 0.8° on the skyline as
      on the card, Face Earth, date change moves the Sun; no console errors. `typecheck`, `eslint` on the
      touched folders and `vite build` pass
- [ ] Removed from the Overview in `c6e352d` (2026-11-15) together with the map's zoom-past-limit hook; the
      code is in git history (`f8d1ab9`, `10c05cd`). Whether to bring it back is open
- [ ] Not done: touch pinch past the limit (only wheel, keyboard and the button); far-terrain shadows
      beyond 50 km; a vitest for `groundMesh.ts` once vitest is set up

## Explorer walk (started 2026-11-14)

Spec `docs/superpowers/specs/2026-11-14-explorer-walk-design.md`, plan `docs/superpowers/plans/2026-11-14-explorer-walk.md`.

- [x] Rename Learn to Explorer (visible text only; routes and code stay `learn`)
- [x] Walk view: terrain, sky, sunlight and shadow
- [x] Astronaut, follow camera, keyboard
- [x] Solar panel and the Battery tile in Walk (taken out in `32e82ce`, restored 2026-11-15)
- [x] Rover and switching
- [x] Hardware at the historical sites and fact cards
- [x] First and third person views for the astronaut and the rover (V or a button)
- [x] Touch controls, rover headlights and helmet lamp (L or a button in the dark), honesty notes for Walk
- [x] View switch back in free exploration (Walk & drive, On the ground, In space, Close-up)
- [x] Rover missions: five playable missions after the last five rovers on the Moon (Yutu, Yutu-2, Pragyan, SORA-Q, Jinchan), three marked tasks each, sources in `REFERENCES.md`
- [ ] Reduced-motion and low-end performance checks

## Integration check (2026-11-15)

Commits on `main` since 2026-11-14 were checked against each other and against the live site.

- [x] Planner on https://lunar.cinne.dev computes on Overview, Site and Compare; the evaluator, MCP server and
      `/review-site` skill are untouched
- [x] Planner tabs are now Overview, Site (with the landing ellipse), Map and Compare, plus Setup and
      Evidence; the calendar became the Overview year strip, area analysis and the Sites tab were removed
- [x] Explorer: view switch, Walk solar panel and Battery tile restored; phone top bar no longer overlaps
- [x] Explorer and Planner linked: "Analyse in Planner" (Explorer, 1024 px and wider) moves the plan's site to
      the Explorer place; "Stand here in Explorer" (Site page) opens the plan's site in Explorer, with the
      engine's horizon and ground patch when they answer in time, flat made-up ground otherwise
- [x] Explorer takes the plan's landing date: its year becomes the landing's year and the time starts at the landing
- [ ] Overview ground view (Alex): removed, see Increment 1 above
- [ ] `AI_USAGE.md` has no entries for the redesign rounds, the oracle suite and the service performance work
      of 2026-11-15; their author should add them

