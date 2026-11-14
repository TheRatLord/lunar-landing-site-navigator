# Claude Code as the site review board

Date: 2026-11-14. Amends `2026-11-14-mission-history-evaluator-design.md`.

## Intent

The team dropped the plan to call an outside LLM API (Anthropic, OpenRouter, Gemini) from the TypeScript
evaluator. Claude Code itself becomes the review board: it reads our engine numbers and the historical
landing records through the existing `lunarnav mcp` server and writes the per-criterion verdict. No API key is
needed; each person runs it on their own Claude Code login. The blinded backtest (tools vs no-tools baseline)
stays, because its gap is the demo claim.

## Goals

- Live demo: the user opens Claude Code in the repo, types `/review-site <lat> <lon> <date> <lander> <vehicle>`,
  and gets the eight-criterion review backed by ledger ids.
- Backtest: `bun run backtest` replays the 13 cases blinded through headless Claude Code (`claude -p`), with
  and without tools, and prints the same summary table as before.
- Teammates can clone the branch and run both on their own Claude Code accounts.

## Non-goals

- No outside model API, no `ANTHROPIC_API_KEY`, no OpenRouter or Gemini support.
- No change to the MCP server's tools, blind mode, history data or the Python agent.
- No model calls during this build: the user's own usage is nearly spent. Live review and backtest runs are
  left to teammates.

## Anti-goals

- A backtest case that can see the answer: headless Claude Code must not be able to read `missions.yaml`,
  any repo file, the web, or call `set_blind_mission`.
- A headless run picking up personal settings (user `CLAUDE.md`, memory, other MCP servers) that change its
  behaviour between teammates.
- Weakening the evidence check: a review citing ledger ids that never appeared in a tool result is still
  rejected.

## Constraints

- The engine runs only in WSL; the MCP server is reached over HTTP (`lunarnav mcp --http 8765`). Every
  teammate who runs the backtest or the live demo needs the WSL setup, SPICE kernels and terrain data
  locally.
- Claude Code 2.1.301 headless flags used: `-p`, `--output-format stream-json --verbose`, `--json-schema`,
  `--mcp-config`, `--strict-mcp-config`, `--tools ""`, `--allowedTools`, `--disallowedTools`,
  `--system-prompt`, `--setting-sources`, `--no-session-persistence`, `--model`, `--max-turns`.
- `AGENTS.md`: no comments, no tests; verify by running commands.
- Usage: 13 cases × 2 modes on a teammate's plan; runs may need batching (`--filter-first-n`, or a
  `LUNARNAV_EVAL_MAX_STEPS` cap).

## Approaches

- **A. Keep `evaluator/`, replace only the model call (picked by the user).** `review.ts` spawns `claude -p`
  instead of calling the Vercel AI SDK. promptfoo, assertions, summary, schema and `checkEvidence` stay.
- **B. Replace `evaluator/` with a small loop script.** Fewer dependencies, but rewrites scoring and summary
  code that already works.
- Rejected: interactive Claude Code driving the backtest with subagents. The driving session sees the
  answers and subagents can read files, so it leaks.

## Design

1. **One prompt file.** The review-board instructions move from `prompt.ts` to
   `evaluator/prompts/review-board.md`; the baseline prompt to `evaluator/prompts/baseline.md`. Both the
   slash command and the backtest read them, so live and backtest behaviour match.
2. **Live demo.** A project `.mcp.json` at the repo root registers server `lunarnav` at
   `http://127.0.0.1:8765/mcp`. A project skill `.claude/skills/review-site/SKILL.md` takes the five
   arguments (plus optional mission hours), tells Claude Code to follow `review-board.md`, call
   `record_planner_request` with the request text, use only `mcp__lunarnav__*` tools for numbers, and print
   the markdown table `cli.ts` prints today. Blind mode is not used live.
3. **Headless review (`review.ts`).** `reviewSite` keeps its signature. With tools it: sets blind mode and
   records the request through the evaluator's own MCP client (`mcp.ts`, unchanged), then spawns `claude -p`
   from an empty temp directory with the review-board system prompt, a temp `--mcp-config` holding only
   `lunarnav`, `--strict-mcp-config`, `--tools ""` (no built-in tools), `--allowedTools mcp__lunarnav__*`
   minus the two control tools (also listed in `--disallowedTools`), no setting sources, no session
   persistence, `--json-schema` from `ReviewSchema`, and `--output-format stream-json --verbose`. It reads
   ledger ids from the tool results in the stream, takes the structured output from the final result,
   validates it with zod and runs `checkEvidence`. Baseline mode spawns the same command with the baseline
   prompt and no MCP config.
4. **Config.** `LUNARNAV_EVAL_MODEL` maps to `--model` (default `sonnet`), `LUNARNAV_EVAL_MAX_STEPS` to
   `--max-turns`, `LUNARNAV_CLAUDE_BIN` overrides the `claude` executable. `.env.example` loses
   `ANTHROPIC_API_KEY`. `@ai-sdk/anthropic` and `ai` are removed if `@ai-sdk/mcp` works without `ai`;
   otherwise `ai` stays as its peer.
5. **Backtest.** `provider.ts`, `tests.ts`, `promptfooconfig.yaml`, `summary.ts` unchanged apart from
   imports. `cases.json` is generated and committed if the terrain data is ready.
6. **README.** `evaluator/README.md` covers WSL engine setup, starting the HTTP server, the slash command,
   running the backtest on your own Claude Code login, batching for usage limits, the pending label review,
   and the honest framing (the claim is the tools-vs-baseline gap).
7. **Delivery.** Commit on `feat/mission-history-evaluator` and push that branch to `origin`. No PR, no
   merge to `main`.

## Verification without model calls

`bun run typecheck`; start the HTTP server and run the control calls (`set_blind_mission`,
`record_planner_request`) from the evaluator's client; print the exact `claude` argument list the runner
builds and check it. The first live review and backtest are explicitly unverified and left to a teammate.

## Left to the builder

- Exact stream-json parsing and how the structured output is located in the result message.
- Wording of the skill file.
- Whether to finish handoff steps 1–3 (terrain build, `history-features`, `cases.json`) now; they use no
  model calls and the backtest needs them.
