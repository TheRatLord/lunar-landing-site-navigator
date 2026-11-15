# Explorer: walk the Moon as an astronaut or a rover

Date: 2026-11-14. Status: draft for the user's approval.

## Intent

The challenge asks the tool to serve two audiences: mission planners who need detailed numbers fast, and
educators and the general public who are curious why the Moon is so hard to land on. The Planner serves the
first. The learn mode serves the second, and this work makes it the place where a student or a visitor can
*feel* the problem instead of reading about it: stand on the Moon, walk around, drag time, and watch the
shadows swing, stretch and swallow the ground, and see a solar panel stop charging the moment it falls into
shadow.

## Decided by the user

1. **Rename "Learn" to "Explorer".** The top bar reads **Planner | Explorer**.
2. **Free walking on the surface**, like an astronaut, to watch light and shadow change.
3. **A solar panel next to the user.**
4. **Historical sites get their real hardware**: at Apollo 11 the US flag and the lunar module; the same idea
   at the other landing sites.
5. **A rover parked next to the astronaut**, who is working on it when the scene opens. The user can switch
   between the astronaut and the rover and move either one.
6. **The astronaut and the rover stand for "you, visiting today"** (option 1 of three). They appear at every
   site; the hardware on the ground is what was really left there. "How true is this picture?" says so.
7. **Approach C**: a new walk view beside the existing ones; the lessons are not touched.
8. **Two points of view** (added later the same day): the astronaut can be seen from behind (third person) or through its visor (first person), and the rover from behind or from the driver's seat. **V** or a button switches; in first person the astronaut is hidden from the camera but still casts its shadow.

## Goals

- A new view, **Walk**, in Explorer, at every preset site: Apollo 11, Blue Ghost, Chang'e 4, Shackleton
  rim, Shackleton floor.
- Third-person control of an astronaut (low-gravity hops) and of a rover, with a switch between them.
- Light and shadow from the same Sun direction the rest of Explorer uses, following the timeline (play,
  drag, speed).
- A Sun-tracking solar panel at the start point, tied to the Battery tile.
- Real hardware at the historical sites, each with a short fact card when you walk up to it.
- Works with keyboard and mouse, and on touch screens.

## Non-goals

- Changing the five lessons or their views (space, ground, crater close-up).
- Changing URLs. `/learn` stays the route for now; only the visible name changes.
- Engine-computed Sun positions for Explorer. It keeps `geometry.ts`, as today.
- Real terrain at the non-polar sites. Apollo 11, Blue Ghost and Chang'e 4 keep procedural ground near you and
  the real skyline from `horizons.json`. A 59 m SLDEM patch for them is a possible later step.
- A rover performance model (slopes, power draw, traction). The rover drives; it does not simulate.
- Downloaded 3D models.

## Anti-goals (a failure even if it works)

- Inventing history: hardware at a site that was not there, or a fact card with a number we cannot source.
- Any NASA logo or agency insignia on the astronaut, rover or hardware. National flags are fine.
- Breaking the lessons, or making Explorer depend on the engine to open at all.
- A view that is unplayable on a school laptop or a phone.

## Constraints

- Repo rules are in `AGENTS.md`: no code comments, no tests; push straight to `main` after `git fetch` and a
  rebase; `uv sync --frozen` and `cd web && bun run build` must pass. Pushing deploys https://lunar.cinne.dev.
- React 19 + TypeScript strict + Three.js, run with bun. Keep new files small; `groundView.ts` (705 lines) is
  not a pattern to repeat.
- Explorer must keep working with no engine: the polar terrain patch is a bonus when `/terrain/patch`
  answers, and the procedural ground is the fallback, as today.
- Light and dark themes for every new panel; labels on controls; keyboard-operable.
- Log the work in `AI_USAGE.md`; cite in `REFERENCES.md` the sources behind each fact card.

## Approaches considered

| | Approach | Trade-off |
| --- | --- | --- |
| A | Add walking to the existing ground view | Least new code on paper, but its terrain mesh is built around a fixed observer (fine near the centre, coarse further out, height 0 under the observer), and four lessons depend on that view. High risk of breaking lessons; a 705-line file grows further. |
| B | Reuse the Planner's ground view (`workspaces/home/ground/`) | Bigger, more real terrain (4 km at 5 m, 24 km at 40 m) and engine Sun, but it is tied to the Planner's state and needs the engine for everything; Explorer's time, site and battery would have to be rewired. |
| **C** | **A new Walk view beside the existing ones (chosen)** | More code up front, but lessons are untouched, it reuses Explorer's time, Sun/Earth, battery, skyline and polar patch, and it can ship in increments. |

## The design

### Where it lives

- `ViewKind` gains `"walk"`. The Explorer card's View toggle shows **In space · On the ground · Walk** (plus
  **Close-up** at the polar sites). Lessons never select it.
- New folder `web/src/learn/walk/`: the view (`walkView.ts`), terrain (`walkTerrain.ts`), the two
  controllable bodies (`astronaut.ts`, `rover.ts`), the camera (`followCamera.ts`), input (`walkInput.ts`),
  the solar panel (`solarPanel.ts`), site hardware (`props/` one file per site) and fact cards. React overlay
  components go under `learn/components/walk/`. Every file stays roughly under 200 lines.
- `LearnScene` creates the walk view lazily the first time Walk is chosen and disposes it on leaving
  Explorer.

### Terrain

- A uniform grid, 1 km by 1 km at 5 m (201 × 201), so the ground is equally detailed wherever you walk.
- Polar sites: heights from the existing `/terrain/patch` call (`terrain.ts` already fetches 1 km at 5 m);
  the grid uses them directly. Fine procedural detail (small craters, bumps, rocks) is added on top, as the
  ground view does.
- Other sites, and polar sites when the engine is unreachable: procedural ground from `surface.ts`.
- The skyline ring beyond the grid comes from the site's horizon profile, as in the ground view, so the Sun
  rises and sets behind the real hills.
- You can move within 400 m of the start point. At the edge a soft wall stops you and a one-line hint says
  why.

### Light and shadow

- One directional light along `skyAt(site, d).sun`; Earthshine as a faint fill when Earth is up; nothing
  else, so shadows read black, as on the Moon.
- The Sun and Earth discs are drawn in the sky where `skyAt` puts them, at the sizes the ground view uses, so
  you can turn around and find Earth (or, at Chang'e 4, not find it).
- The shadow camera follows the active body, sized to about 150 m around it, so the astronaut's, rover's
  and hardware's shadows are sharp. Terrain beyond that still self-shadows through the existing lighting.
- When the Sun's disc is below the local skyline, the scene is in shadow. At Shackleton floor that is always.
  The astronaut has a helmet lamp and the rover has headlights, both off by default and toggled with **L**,
  so the floor is explorable without pretending it is lit.

### The astronaut

- Low-poly figure built from Three.js primitives: white suit, backpack, gold visor, no logos.
- Moves with a hopping gait; the camera sits behind and above, and mouse drag or touch drag orbits it.
- Speed about 1.5 m/s, a jump under lunar gravity (1.62 m/s²), so a jump hangs in the air the way it really
  would. The figure stands on the ground height under it and cannot walk through hardware (simple circles).
- On load it kneels beside the rover, "working on it", until the user first moves.

### The rover

- Low-poly open rover in a modern style: four wheels, seats, a mast, a high-gain antenna, no logos.
- Arcade driving: about 4 m/s top speed, turns in place slowly, body tilts to the ground under its four
  wheels, cannot drive through hardware.
- Switching (**E**, or the on-screen button) moves control and the camera between the two. The one not in
  control stays where it was left.

### The solar panel

- A panel on a mast next to the start point that turns to face the Sun, which is exactly the assumption the
  existing battery model makes ("a solar panel that always turns to face the Sun").
- It shows charging (a soft glow and the Battery tile's state) when the Sun is above the skyline at the
  site, the same rule `timeline.ts` already uses for the battery. The Battery tile is shown in Walk view.
- Not per-pixel: the panel's state follows the site-level sunlight, which the truth note says.

### Hardware at each site

Only what was really there, built from primitives:

| Site | Hardware |
| --- | --- |
| Apollo 11 | Lunar module descent stage (gold foil body, four legs, ladder), the US flag lying on the ground (Aldrin saw it knocked over by the ascent engine's exhaust), the laser retroreflector, the seismometer, a trail of bootprints |
| Chang'e 4 | The lander, with the Chinese flag on its side; the Yutu-2 rover parked near it, with its card saying it has since driven away |
| Blue Ghost | Firefly's Blue Ghost lander |
| Shackleton rim, floor | Nothing: no one has landed there. The card at the start point says so and why missions want to |

Walking within about 10 m of a piece shows a fact card (name, what it is, one plain-language fact, the
source). The text of each card is written and checked against a cited source before it ships; any claim we
cannot source is left out.

### Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | W A S D or arrow keys | Left on-screen joystick |
| Look around | Mouse drag | Drag on the scene |
| Jump (astronaut) | Space | Jump button |
| Switch astronaut / rover | E | Switch button |
| Lights | L | Lights button |
| Play / pause time | K | The timeline's play button |

In Walk view the arrow keys and Space move and jump instead of nudging time and playing; time stays on K, the
timeline slider and its buttons. Walk keys act only when focus is on the scene or on nothing, with the same
guard the page already uses for inputs, buttons and radios, so Tab still moves focus through the page. A
small controls hint shows on first entry and can be dismissed.

Changing site while in Walk view reloads that site's terrain and hardware and puts both bodies back at the
start point, the astronaut kneeling by the rover again.

### Rename to Explorer

- Visible text only: the mode switch, its tooltip, page headings and copy that say "Learn" or "learn mode",
  and the README and docs that name it. URLs and code identifiers stay as they are.

### Honesty

"How true is this picture?" in Walk view adds:

- The astronaut and rover are you, visiting today; they were not there. The flag, lander and instruments are
  where the real ones are.
- Ground near you is real at the polar sites (with the store names) and made up elsewhere; the skyline is
  real everywhere.
- The panel follows the site's sunlight, not the exact shadow under it.
- The existing line about simple-math Sun and Earth positions stays.

### Accessibility

- Every control has a keyboard path and a label; the switch, jump and light buttons are real buttons.
- With reduced motion: no camera bob, no hopping animation, instant camera switches.
- The Announcer reads the active body, entering or leaving shadow, and fact cards.
- Both themes for the overlay and cards.

## Increments (each one pushed to main when its checks pass)

1. Rename Learn to Explorer.
2. Walk view: uniform terrain, skyline, Sun light and shadow following the timeline, astronaut with the
   follow camera and keyboard control.
3. Solar panel and the Battery tile in Walk view.
4. Rover, switching, the "working on the rover" opening.
5. Site hardware and fact cards, with sources in `REFERENCES.md`.
6. Touch controls, lights, reduced motion, the truth-note lines, performance check on a low-end profile.

Each increment is checked with `bun run build`, `uv sync --frozen`, and headless Chromium screenshots of the
Walk view at each site in both themes, with no console errors.

## Left to the builder

- Exact proportions, colours and polygon budgets of the astronaut, rover and hardware, within "low-poly,
  no logos".
- Placement of hardware around the start point at each site, kept plausible (e.g. the flag a few metres from
  the lander).
- Camera distance, damping and orbit limits.
- How the soft boundary looks.
- The exact wording of the controls hint.
