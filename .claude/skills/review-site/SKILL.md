---
name: review-site
description: Act as the lunar landing site selection review board for one candidate site, landing time, lander and launch vehicle, using the lunarnav MCP server's engine numbers and mission history. Use when the user runs /review-site or asks for a site review.
argument-hint: <lat> <lon> <landing_utc> <lander> <vehicle> [mission_hours]
---

# Site review board

Arguments: `$ARGUMENTS` as `<lat> <lon> <landing_utc> <lander> <vehicle> [mission_hours]`. Mission hours default to 336. If any of the first five are missing, ask for them and stop.

1. Read `evaluator/prompts/review-board.md` and follow it for the whole review. It is the same instruction the backtest uses.
2. Check the `lunarnav` MCP server is connected (its tools are named `mcp__lunarnav__*`). If it is not, tell the user to start it in WSL with `bash ~/wslfast.sh 'uv run lunarnav mcp --http 8765'`, then restart Claude Code or run `/mcp` to reconnect, and stop.
3. Call `mcp__lunarnav__set_blind_mission` with `mission_id: null`, so a backtest left running earlier does not hide history.
4. Call `mcp__lunarnav__record_planner_request` with exactly this text, values filled in:
   `Review this candidate landing: site lat <lat> deg, lon <lon> deg; landing <landing_utc>; lander <lander>; launch vehicle <vehicle>; surface mission <mission_hours> hours.`
5. Work through the eight criteria with `mcp__lunarnav__*` tools only. Do not read repo files for numbers or history; every number and every past-mission fact must come from a tool result with a ledger id.
6. Reply with this markdown and nothing before it:

```
# Site review: <lat>, <lon> at <landing_utc>

**Overall: <rating>** (<tool calls> tool steps, <distinct ledger ids> ledger results)

| Criterion | Rating | Finding | Evidence |
|---|---|---|---|
| slope_tipover | ... | ... | L0001, ... |
| illumination_power | ... | ... | ... |
| earth_link | ... | ... | ... |
| ellipse_hazards | ... | ... | ... |
| terrain_navigation | ... | ... | ... |
| thermal | ... | ... | ... |
| launch_slip | ... | ... | ... |
| past_failures | ... | ... | ... |

## Top risks
- <risk> (echoes: <past mission ids>)
```

Ratings are `go`, `caution`, `no-go` or `unresolved`. Any criterion not `unresolved` must cite at least one ledger id that appeared in a tool result. After the table you may add a short plain-language summary for the audience.
