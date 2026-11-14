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

- [x] `CLAUDE.md`: rules, stack, layout, spec of each part, conventions, checks
- [x] `AGENTS.md` now reads "Follow CLAUDE.md". It used to say "do not ever write comments or tests"; that rule
      is replaced by `CLAUDE.md` §12 (decision [0004](decisions/0004-docstrings-and-tests.md))
- [x] `docs/SETUP.md`, `docs/OPEN_QUESTIONS.md`, `docs/decisions/`, `REFERENCES.md`, `FRICTION_LOG.md`,
      `AI_USAGE.md`
- [x] README: "Where the numbers come from" and "Working on it" sections
- [x] `uv run ruff check .` passes
- [ ] Web checks (`bun run typecheck`, `lint`, `build`) not run: bun is not installed on this Mac and
      `web/node_modules` is empty (FRICTION_LOG)

## Next

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
