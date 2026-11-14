# Decision 0005: a 3D rover simulation, from landing to end-of-life

**Status:** design in progress. Round 1 accepted on 2026-11-14 by the owner; later rounds are listed under
"Still open" and get added here as they are settled. Nothing is built yet.

## Where we start

The Navigator answers "is this landing viable?" for a lander that stays put. A rover moves, so its horizon,
power and Earth link change along its path. The team's other entry, Sightline (`../sightline`), has a 3D
terrain stage we want to reuse in approach and feel:

- **Terrain mesh** (`sightline/web/src/lib/terrainMesh.ts`): nested square levels round the site (8 km at
  20 m, 40 km at 100 m, 250 km at 1 km), on the plane tangent at the site in east/north/up metres, each
  vertex scaled along the line from the Moon's centre so curvature is exact. A finer level punches a hole
  in the coarser one, which is lowered a few metres so the two don't flicker.
- **Lighting** (`sightline/web/src/three/TerrainViewer.ts`): one grey material lit only by the
  ephemeris Sun direction; cascaded shadow maps (`CSM`, 4 cascades, 300 km reach) so a far ridge still
  shadows the site at grazing Sun. Faint fill and ambient light are labelled as display aids, not physics.
- **Sky**: Sun and Earth at true angular size when standing, enlarged markers at the end of their sight
  lines from above; Earth's phase from the same Sun vector.
- **Drawing only when asked** (no render loop), context-loss handling, explicit disposal.
- **Geometry apart from drawing**: camera and sky geometry are plain, tested functions
  (`lib/surfaceView.ts`, `lib/camera3d.ts`).
- **Interaction** (`sightline/docs/DESIGN.md`): the place is the page. The stage fills the window, there is
  one control for time (the time river, whose track shows Sun, Earth and both-up bands), drawers float
  over it, and the co-pilot's answers move the stage.

The Navigator already has the pieces underneath: the LNP1 elevation patch (`/api/v1/terrain/patch`, with
sources and error), `LanderProfile` with yaw and tilt, the power, battery and direct-to-Earth models, VIPER
constraints with sources (`scenario/profiles.py`), and the analysis agent with its answer guard. Its own 3D
view (`web/src/workspaces/site/terrain3d/`) uses a CPU shadow mask on a single patch.

## What we decided (round 1)

1. **Scope: a vertical slice for the hackathon.** Landing to end-of-life works end to end, each part crude,
   during Space Apps (Nov 14–15, 2026). The full lifecycle beyond that is a roadmap, not the demo.
2. **It is an engineering what-if, shown with Sightline's feel.** "Realistic" means the lighting, horizons,
   power and comms are the engine's validated numbers with provenance; `CLAUDE.md` §1 science honesty
   applies. The visuals may be stylised. It is not a game.
3. **Control: a waypoint traverse, played back on the time river.** The user places waypoints; the
   simulation runs the traverse against time and the time river scrubs it. Live driving is out. "Suggest a
   route" (the engine plans it, e.g. chasing Sun and Earth) is a later addition.
4. **Rover: a catalogued `RoverProfile`**, beside the landers, every value with an `Origin`. VIPER is the
   first entry; a user-defined generic rover is the second preset. Any figure we cannot source (mass,
   speed, array geometry, battery capacity, mast height) is flagged as an estimate and logged in
   `docs/OPEN_QUESTIONS.md`, never invented.
5. **End-of-life is the first limit broken.** Limits: state of charge below its floor, darkness longer than
   the hibernation limit, Earth silence longer than a set limit. The run ends with the reason, the time and
   the margin, in the same verdict form as the scenario layer's constraints. A mission-length cap stops a
   run that never fails.
6. **Physics in scope:** terrain following (pitch and roll from the height grid), the slope limit
   enforced, array power from the rover's own heading and tilt, a horizon recomputed at the rover's mast
   height along the path for Sun and Earth, battery charge with hibernation through the dark.
   **Out of scope, and labelled as such:** terramechanics (wheel slip, sinkage), thermal, dust, rocks below
   the terrain resolution, ageing. A horizon at every step is too slow, so it is sampled every N metres and
   cached, and N is in the provenance.
7. **Renderer: port Sightline's `TerrainViewer` pattern** into a new rover stage: nested levels fed by
   LNP1 patches, CSM shadows lit by the engine's Sun vector, true-size Sun and Earth, drawing only when
   asked. `terrain3d/` stays as it is. The stage says that its shadows are the GPU's picture and that
   whether the rover is lit is the engine's answer.
8. **Terrain resolution: run anywhere, say what it is.** The stage shows "terrain at X m: hazards smaller
   than this are not modelled" beside the rover. The demo defaults to a site with a PGDA 5 m tile. Which
   terrain products to download for it is decided with the site (none are in `data/dem/` on the Mac today).

## Why

- Waypoints with precomputed playback keep every frame computable ahead of time and checkable, which the
  honesty rules require, and they reuse Sightline's strongest moment: drag time, watch it happen.
- A catalogued profile with `Origin`s is how the Navigator already treats landers, so rover numbers carry
  the same provenance to the screen, the report and the agent.
- The CPU shadow mask in `terrain3d/` does not reach the 250 km a grazing polar Sun needs; Sightline's CSM
  setup already does, and is measured there.

## What it costs

- A new engine part and job kind for the traverse (where exactly is round 2), with tests on closed-form
  cases (a flat plane, a smooth sphere) per `CLAUDE.md` §12.
- Recomputing horizons along a path is the expensive step; the sampling distance trades speed for fidelity
  and has to be stated.
- The Three.js stage is new web code to keep under the ~200-line component guideline.
- Unsourced VIPER figures will show as estimates, which weakens the demo's claims where they matter.

## Still open (later rounds)

- Where the simulation is computed: an engine job (as `CLAUDE.md` §11 implies) or partly in the browser.
- The API contract for a traverse request and its result (time series, events, verdicts, provenance).
- Where the stage sits in the app: the existing `workspaces/mission` (a form today), a new full-window
  route, or the overview.
- How the agent and the ask box take part (e.g. "why did it die?", answers that move the stage).
- What the rover looks like in 3D (procedural model or a sourced model, no insignia).
- The demo site and its terrain products.
- Build order for the slice.
