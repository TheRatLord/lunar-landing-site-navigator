# Open questions

Anything unverified goes here, with the conservative choice we made in the meantime. Rows 3 to 11 were
copied on 2026-11-14 from the "not validated" and "limitations" sections of the validation documents named
in each row; those documents stay the full record.

| # | Date | Question | Interim choice | Status |
| --- | --- | --- | --- | --- |
| 1 | 2026-11-14 | `AI_USAGE.md` starts on 2026-11-14. Whether AI tools were used for the code in the first commit (`0cef76d`), and for which tasks, is not recorded anywhere in the repo. | Nothing is claimed either way. The owner fills in the earlier lines before submission. | Open |
| 2 | 2026-11-14 | `ruff check` passes, but `ruff format --check` would reformat 143 files. Is the codebase meant to be formatted by ruff? | Don't reformat files you aren't otherwise changing; `CLAUDE.md` §12 lists only `ruff check`. | Open |
| 3 | 2026-11-14 | Python version: `.python-version` pins 3.14, `pyproject.toml` and the README say ≥ 3.12. Terrain stores use `mmap(trackfd=False)` on ≥ 3.13 and a libc path otherwise; 3.12 on macOS and Windows were not run (`docs/validation/terrain.md` §5). | Develop and run on 3.14, as pinned. CI tests 3.14 first. | Open |
| 4 | 2026-11-14 | The agent sandbox is set up by `scripts/bootstrap.sh` for Linux (bubblewrap, an AppArmor profile). Whether the agent's `require` sandbox starts on macOS was not tried. | Run the agent on Linux or in the dev container. On a Mac use `bootstrap.sh --no-sudo` and leave the agent off. | Open |
| 5 | 2026-11-14 | Mazarico et al. 2011 at CR1: on our 240 m store no post within 3 km reaches the published 89.01 % (best 74.90 %, 476 m away). Cause unknown (`docs/validation/scenario.md` §11.4). | Reported as a miss; nothing tuned. | Open |
| 6 | 2026-11-14 | Earth visibility against the published `AVGVISIB_85S_060M`: p95 error 6.27 points misses the 5-point target; the brightest pixels are about 4 points low (`docs/validation/illumination.md` §3, §8). | Show the Earth fraction with its measured error; never call it validated. | Open |
| 7 | 2026-11-14 | Shadows at cell scale (1–3 cells) and at Shackleton are poorly predicted on real LRO NAC images (IoU 0.093/0.099); the limit is the terrain data (`docs/validation/imagery.md`). | Trust large shadows only. Show the terrain-error bracket, read as "may be lit hours longer than predicted". | Open |
| 8 | 2026-11-14 | Mission checks missing their targets: Blue Ghost sunset +1.9 h (target 1 h), Chandrayaan-3 sunset −5.2 h (target 1–3 h); SLIM recovery days (`docs/validation/scenario.md` §5). | Reported as misses. Battery and state-of-charge results are labelled estimates (no telemetry). | Open |
| 9 | 2026-11-14 | Start year of the published PGDA illumination runs: 2016 assumed, unverified; 2018–2022 give the same within 0.03 points (`docs/validation/illumination.md` §8). | 2016 used, stated as an assumption. | Open |
| 10 | 2026-11-14 | DE440's published lunar-orbit accuracy was recalled, not fetched (`docs/validation/ephemeris.md` §8). | The verified bound is the 2–3 m DE440 vs DE441 difference, inside the precision budget. | Open |
| 11 | 2026-11-14 | The learn mode's globe textures (`web/src/learn/scene/maps/moon.jpg`, `earth.jpg`) are described in the README as "NASA imagery (public domain)", but the exact source files are not recorded. | Listed in `REFERENCES.md` as source not recorded. Find and cite the source before submission, or replace the images with ones whose source is known. | Open |
