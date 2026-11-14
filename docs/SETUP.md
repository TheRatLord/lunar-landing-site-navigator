# Developer setup

How to get this repo running, from nothing to a pushed change. Allow about 20 minutes for the service and the
web app; terrain is a separate, larger download.

## 1. Accounts and access

| What | Needed for | You do |
| --- | --- | --- |
| GitHub, write access to `TheRatLord/lunar-landing-site-navigator` | pushing to `main` | `gh auth login` |
| Claude Code CLI, signed in | the analysis agent only (`lunarnav agent`, Ask in the web app) | Sign in with your own account. Agent runs are billed to it |
| Claude Code for development | working on the repo | Start it in the repo root so it reads `AGENTS.md` |

Never share passwords. There are no API keys in this project; everyone uses their own logins.

## 2. Tools

Linux is the supported platform (`scripts/bootstrap.sh` uses `apt`). You need Python 3.12 or later
(`.python-version` pins 3.14), [uv](https://docs.astral.sh/uv/) and [bun](https://bun.sh/).

```sh
scripts/bootstrap.sh            # needs sudo: apt packages, the agent sandbox's AppArmor profile, then everything below
scripts/bootstrap.sh --no-sudo  # uv, bun, Python and web dependencies, kernels, web build; no sandbox
```

On macOS use `--no-sudo` (or install uv and bun yourself and follow section 3 by hand), and leave the agent
off: its sandbox has only been set up on Linux (`docs/OPEN_QUESTIONS.md` #4).

## 3. Get the code, kernels and the web build

```sh
gh repo clone TheRatLord/lunar-landing-site-navigator
cd lunar-landing-site-navigator
uv sync
uv run lunarnav kernels                  # downloads and verifies the 9 pinned SPICE kernels into data/kernels (about 165 MB)
(cd web && bun install && bun run build)
```

All data lives in `data/` (or wherever `$LUNARNAV_DATA` points), which is not in Git.

## 4. Terrain

Without terrain the engine uses a smooth sphere, so horizons are flat. To get real horizons:

```sh
uv run python -m lunarnav.terrain.ingest fetch lola_80s_20m   # one product (south pole 80°S, 20 m)
uv run python -m lunarnav.terrain.ingest build lola_80s_20m   # convert it into a store under data/dem/store/
uv run python -m lunarnav.terrain.ingest build --all          # every registered LOLA and PGDA product: large, ask first
```

The products, their sizes and how each was checked are in `docs/validation/terrain.md`. For a site away from
the poles, `python -m lunarnav.terrain.regional` fetches a window around it (section 3.6 there).

## 5. Run

```sh
uv run lunarnav serve            # API and the built web app on http://127.0.0.1:8000
(cd web && bun run dev)          # web dev server on :5173, proxying /api to :8000
```

The service binds to loopback only. To try the agent, set `LUNARNAV_API_AGENT_ENABLED=1` before
`lunarnav serve`, or run it in the terminal with `uv run lunarnav agent run "..."`. Each run spends money
(5.00 USD cap per run by default). Every setting is a `LUNARNAV_*` variable, documented in
`src/lunarnav/api/settings.py`.

## 6. Checks

Run these before every push (`AGENTS.md`):

```sh
uv run ruff check .
(cd web && bun run typecheck && bun run lint && bun run build)
uv run lunarnav openapi web/src/api/openapi.json && (cd web && bun run gen:api) && git diff --exit-code web/src/api
```

The last line fails if the API changed and the web types were not regenerated. pytest and vitest are not set
up yet (`docs/PROGRESS.md`).

## 7. How we work

1. Read `docs/PROGRESS.md` and pick the first unchecked item, or an issue.
2. Work on `main`. Change, then run the checks for what you touched.
3. Update `docs/PROGRESS.md`; add a line to `AI_USAGE.md` if an AI tool did the task; cite new data in
   `REFERENCES.md`; log anything that slowed you in `FRICTION_LOG.md`.
4. Commit with a conventional message (`feat(scenario): add launch slip to the ellipse view`).
5. `git fetch`; if `origin/main` moved, rebase onto it and reconcile your change with what landed, rerun the checks, then `git push origin main`.
