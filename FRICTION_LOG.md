# Friction log

Update during the work, not after it: anything that slowed us, how long it cost, and what we do about it.

| Date | Who | Area | What slowed us | Time lost | Decision |
| --- | --- | --- | --- | --- | --- |
| 2026-11-14 | Claude Code | web / tools | bun is not installed on the Mac and `web/node_modules` is empty (the dev container keeps it in a volume), so `bun run typecheck`, `lint` and `build` could not run there. | ~2 min | Run the web checks in the dev container or after installing bun; CI will run them on every PR (`docs/PROGRESS.md`). |
| 2026-11-14 | Claude Code | Python / format | `ruff check` passes but `ruff format --check` would reformat 143 files, so "run the formatter" is not a usable check yet. | ~1 min | Only `ruff check` is a required check; formatting is an open question (`docs/OPEN_QUESTIONS.md` #2). |
