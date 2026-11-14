# Decision 0003: the analysis agent is off by default, sandboxed, and its numbers are checked

**Status:** accepted. Recorded on 2026-11-14 from the code (`src/lunarnav/api/settings.py`,
`src/lunarnav/agent/config.py`, `src/lunarnav/agent/guard.py`); there was no separate record before.

## What we decided

- **Off by default.** The agent's endpoints answer 404 unless `LUNARNAV_API_AGENT_ENABLED=1`, and the web
  app shows Ask only then.
- **Sandboxed.** It runs under the Claude Code CLI with the Bash sandbox in `require` mode: if the sandbox is
  not available, the agent refuses to start. Code it runs may read `data/kernels` and `data/dem` and never
  write them. File sizes are capped (`RLIMIT_FSIZE`). Network access for `fetch_data` is HTTPS only; a
  domain allowlist is optional and empty by default, which means any host.
- **An explicit model and a spend cap.** The model id is set in the code (`DEFAULT_MODEL`), never left to the
  CLI's default, which follows the user's own settings. Each run has a spend limit (5.00 USD by default in
  the service).
- **Typed tools and a ledger.** The agent reaches the engine only through typed tools, and every call is
  recorded.
- **A mechanical answer guard.** Each number, instant and date in a final answer must be in a record of the
  run, cited with its ledger tag (and row, for tables), with its sign and unit, and clock times in UTC.

## Why

The agent runs code a model writes, so it is opt-in and confined. Its answers are about mission planning,
so a number that is not in the record must not slip through. The guard catches slips (a wrong row, a lost
sign, a wrong unit); it does not prove that a sentence is true.

## What it costs

The sandbox has only been set up on Linux (`docs/OPEN_QUESTIONS.md` #4). Each run costs money. The open
network default is a known gap: narrowing it is a one-line change in the config, and widening it is a
stop-and-ask item (`CLAUDE.md` §1).
