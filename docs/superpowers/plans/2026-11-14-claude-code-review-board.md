# Claude Code Review Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Vercel AI SDK model call with Claude Code (interactive `/review-site` and headless `claude -p`), keeping the MCP server, promptfoo backtest and evidence check.

**Architecture:** `evaluator/src/review.ts` spawns `claude -p` in an empty temp dir with only the `lunarnav` MCP server and no built-in tools, parses `stream-json` for ledger ids and the `structured_output` result. A project `.mcp.json` and skill give the same review board interactively. Both read one prompt file.

**Tech Stack:** bun + TypeScript, `@ai-sdk/mcp` (control calls only), zod 4, promptfoo, Claude Code 2.1.301, Python `lunarnav mcp --http 8765` in WSL.

**Spec:** `docs/superpowers/specs/2026-11-14-claude-code-review-board-design.md` (amends `2026-11-14-mission-history-evaluator-design.md`)

## Global Constraints

- `AGENTS.md`: no code comments, no tests. Every "verify" step is a command.
- No model calls during the build (no `claude -p`, no `bun run review`, no `bun run backtest`).
- No `ANTHROPIC_API_KEY`, no outside model API.
- Headless runs: `--strict-mcp-config`, `--tools ""`, `--setting-sources ""`, `--no-session-persistence`, cwd = fresh temp dir.
- `record_planner_request` and `set_blind_mission` are never callable by the model.
- Repo stays LF. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Push only `feat/mission-history-evaluator` to `origin`. No PR, no merge.

## Review Focus

- `--tools ""` might also remove the internal tool `--json-schema` uses for structured output; the runner must fail with a clear message naming this if the result has no `structured_output`, so a teammate can report it.
- `claude` not on PATH or not logged in: error must say to install/log in or set `LUNARNAV_CLAUDE_BIN`, not a raw spawn ENOENT.
- MCP server not running at the URL: the runner fails on the control call before spawning `claude`, with the URL in the message.
- A result with `is_error: true` or `subtype` other than `success` (max turns, usage limit): surfaced as the error text, not a zod parse error.
- Live demo and backtest sharing one server: the backtest leaves blind mode set; the provider resets blind to `null` after the run so a following live demo is not blinded.

---

### Task 1: Headless Claude Code runner

**Files:**
- Create: `evaluator/prompts/review-board.md`, `evaluator/prompts/baseline.md`, `evaluator/src/claude.ts`
- Modify: `evaluator/src/prompt.ts`, `evaluator/src/review.ts`, `evaluator/src/cli.ts`, `evaluator/package.json`, `evaluator/.env.example`, `evaluator/backtest/provider.ts`

**Interfaces:**
- Produces: `prompts/review-board.md` (REVIEW_BOARD text plus the old STRUCTURE sentence, since one call now does both), `prompts/baseline.md`.
- Produces in `prompt.ts`: `loadPrompt(name: "review-board" | "baseline"): string`, `requestText(...)` unchanged.
- Produces in `claude.ts`: `claudeArgs(opts: { system: string; schema: object; mcpConfigPath?: string; model: string; maxTurns: number }): string[]` and `runClaude(opts & { prompt: string }): Promise<{ structured: unknown; ledgerIds: string[]; turns: number }>`.
- `reviewSite(input: ReviewInput): Promise<ReviewResult>` keeps its signature; `MODEL` default becomes `"sonnet"`.

- [ ] **Step 1:** Move prompt text to the two markdown files; `prompt.ts` reads them relative to `import.meta.dir`.
- [ ] **Step 2:** Implement `claudeArgs`: `-p`, `--output-format stream-json`, `--verbose`, `--model`, `--max-turns`, `--system-prompt <system>`, `--json-schema <JSON>`, `--tools ""`, `--setting-sources ""`, `--no-session-persistence`; with `mcpConfigPath` also `--mcp-config <path>`, `--strict-mcp-config`, `--allowedTools mcp__lunarnav`, `--disallowedTools mcp__lunarnav__record_planner_request mcp__lunarnav__set_blind_mission`. Binary from `LUNARNAV_CLAUDE_BIN` or `claude`. Prompt goes on stdin.
- [ ] **Step 3:** Implement `runClaude`: make a temp dir (`fs.mkdtemp`), write the MCP config `{"mcpServers":{"lunarnav":{"type":"http","url":<url>}}}` there when tools are on, spawn in that cwd, read stdout lines as JSON; ledger ids via the existing regex over every `type:"user"` line; `turns` = count of `type:"assistant"` lines with a `tool_use` block; take the `type:"result"` line. Errors per Review Focus lines 1, 2 and 4. Remove the temp dir in `finally`.
- [ ] **Step 4:** Rewrite `reviewSite` around `runClaude`: tools mode keeps `connectLunarnav` for `setBlind` and `recordRequest`, needs a URL (`input.url` or `LUNARNAV_MCP_URL`, default `http://127.0.0.1:8765/mcp`); parse with `ReviewSchema`, then `checkEvidence`. Schema JSON via `z.toJSONSchema(ReviewSchema)`. Drop the stdio path from the tools flow (headless Claude needs a URL).
- [ ] **Step 5:** `provider.ts`: after each tools-mode case call `setBlind(null)`. `cli.ts` usage text: drop nothing but mention the server must be running.
- [ ] **Step 6:** `package.json`: remove `ai` and `@ai-sdk/anthropic`; `bun install`. `.env.example`: `LUNARNAV_MCP_URL=http://127.0.0.1:8765/mcp`, `LUNARNAV_EVAL_MODEL=sonnet`, `LUNARNAV_EVAL_MAX_STEPS=30`, `LUNARNAV_CLAUDE_BIN=`.
- [ ] **Step 7: Verify**
  - `bun run typecheck` → no errors.
  - `bun -e 'import {claudeArgs} from "./src/claude"; console.log(JSON.stringify(claudeArgs({system:"x",schema:{},mcpConfigPath:"c.json",model:"sonnet",maxTurns:30})))'` → contains `--strict-mcp-config`, `--tools`,`""`-equivalent empty arg, both control tools under `--disallowedTools`.
  - `LUNARNAV_CLAUDE_BIN=nope bun run review ...` with server down → error names the URL (no model call made).
- [ ] **Step 8: Commit** `feat(evaluator): run the review board through headless Claude Code`

### Task 2: Interactive `/review-site`

**Files:**
- Create: `.mcp.json` (repo root), `.claude/skills/review-site/SKILL.md`

**Interfaces:**
- Consumes: `evaluator/prompts/review-board.md`, MCP tool names `mcp__lunarnav__*`.

- [ ] **Step 1:** `.mcp.json`: `{"mcpServers":{"lunarnav":{"type":"http","url":"http://127.0.0.1:8765/mcp"}}}`.
- [ ] **Step 2:** Skill with frontmatter `name: review-site`, a description, `argument-hint: <lat> <lon> <landing_utc> <lander> <vehicle> [mission_hours]`. Body: read and follow `evaluator/prompts/review-board.md`; call `mcp__lunarnav__set_blind_mission` with `null` then `record_planner_request` with the `requestText` wording; numbers only from `mcp__lunarnav__*` results; output the same markdown table as `cli.ts`; if the server is unreachable, tell the user the start command.
- [ ] **Step 3: Verify:** `.gitignore` does not exclude `.claude/skills` or `.mcp.json` (`git check-ignore -v`), JSON parses (`bun -e 'JSON.parse(require("fs").readFileSync("../.mcp.json","utf8"))'`).
- [ ] **Step 4: Commit** `feat: /review-site Claude Code skill and project MCP config`

### Task 3: Backtest inputs (no model calls)

- [ ] **Step 1:** In WSL: `tail data/terrain-fetch.log data/terrain-build.log`, `ps aux | grep ingest`. If not running and incomplete, restart the handoff's fetch/build chain in the background; do not block on it.
- [ ] **Step 2:** If the terrain manifest is complete: `bash ~/wslfast.sh 'uv run lunarnav history-features'`, then `export-cases > evaluator/backtest/cases.json`; check south-polar cases are `"group": "fine"`. Commit `data(backtest): generated cases`. Otherwise record in the README that `cases.json` must be generated after the terrain build.
- [ ] **Step 3:** Start the HTTP server; from Windows run the evaluator's control calls only: `bun -e` script using `connectLunarnav({url})` → `setBlind("im-1-odysseus")`, `recordRequest("test")`, `setBlind(null)`, list tool count (expect 20). Stop the server.

### Task 4: README and push

**Files:** Create `evaluator/README.md`.

- [ ] **Step 1:** README: what it is; prerequisites (WSL Ubuntu-24.04, uv, bun, Claude Code logged in; SPICE kernels + terrain data, several GB, via `lunarnav.terrain.ingest`); the `~/wslfast.sh` helper; start server; live demo with `/review-site`; backtest (`bun install`, `.env`, `--filter-first-n` batching, usage cost 13×2 runs); how to read the summary; the label review gate (3 open questions in `docs/superpowers/specs/2026-11-14-history-labels-review.md`); honest framing; untested status of the first live run.
- [ ] **Step 2:** Final review of `git diff 9d29655..HEAD` against both specs; fix Critical/Important.
- [ ] **Step 3:** Commit `docs(evaluator): README for the Claude Code review board`, then `git push -u origin feat/mission-history-evaluator`.
