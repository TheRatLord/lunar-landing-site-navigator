# AI usage disclosure

Space Apps allows AI tools with disclosure. One line per meaningful task.

The product itself also uses AI: the analysis agent (`lunarnav agent`, Ask in the web app) answers planning
questions with Claude through typed engine tools, and every number in its answers is checked against its
ledger (`CLAUDE.md` §10). That is a feature, not development work, and is not listed below.

Work before 2026-11-14 (the first commit, `0cef76d`) is not recorded here yet (`docs/OPEN_QUESTIONS.md` #1).

| Date (UTC) | Tool | What it did |
| --- | --- | --- |
| 2026-11-14 | Claude Code | Wrote `CLAUDE.md` and the documentation set (`docs/PROGRESS.md`, `docs/OPEN_QUESTIONS.md`, `docs/SETUP.md`, `docs/decisions/`, `REFERENCES.md`, `FRICTION_LOG.md`, this file) from the code and the validation reports; replaced `AGENTS.md` with a pointer to `CLAUDE.md`; added two README sections. |
| 2026-11-14 | Claude Code | Compared Sightline's Three.js terrain stage with the Navigator's 3D view and recorded the round 1 design choices for a rover simulation in `docs/decisions/0005-rover-simulation.md`. |
| 2026-11-14 | Claude Code | Added the ground view to the overview (`web/src/workspaces/home/ground/`): zoom the map all the way in, or press "Stand here", to fly down and stand at the plan site, with LOLA/PGDA terrain lit by the engine's Sun, cascaded shadows, the engine's horizon beyond 50 km, and the Sun and Earth from the engine's tracks; adapted from Sightline's Three.js terrain view. Added an optional zoom-past-limit hook to the map engine. |
| 2026-11-14 | Claude Code | Built the mission-history site review board: `missions.yaml` and `launch_vehicles.yaml` (Wikipedia-sourced, confidence medium, labels pending review), blind mode and history tools (`history.py`, `history_features.py`, `agent/engine_tools/history.py`), the `lunarnav mcp` server, and the `evaluator/` blinded backtest (promptfoo) run through headless Claude Code; added `/review-site` and `.mcp.json`. |
| 2026-11-14 | Claude Code | Pointed `evaluator/README.md` at `scripts/data.sh pull` for terrain; recorded the evaluator's libraries and the mission-history sources in `REFERENCES.md`. |
| 2026-11-14 | Claude Code | Designed and planned the Explorer walk view (`docs/superpowers/specs/2026-11-14-explorer-walk-design.md`, `docs/superpowers/plans/2026-11-14-explorer-walk.md`) and renamed the Learn mode to Explorer in the top bar and README. |
| 2026-11-14 | Claude Code | Added the Explorer Walk view (`web/src/learn/walk/`): a 1 km terrain grid (real LOLA patch at the polar sites, procedural elsewhere), rocks, the real skyline, Sun and Earth in the sky, and sunlight with cast shadows that follow the timeline. |
