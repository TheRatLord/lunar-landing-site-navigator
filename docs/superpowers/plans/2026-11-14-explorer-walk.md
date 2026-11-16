# Explorer Walk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename Learn to Explorer and add a Walk view where the user drives an astronaut or a rover around each preset site, with real hardware at historical sites and a Sun-tracking solar panel.

**Architecture:** A new `web/src/learn/walk/` module owns a self-contained Three.js `WalkView` (terrain grid, sky, light, bodies, props). `LearnScene` creates it lazily as a fourth view kind `"walk"` and runs its render loop continuously while it is active. React overlays under `learn/components/walk/` read and write a few new fields in the existing `useLearn` store.

**Tech Stack:** React 19, TypeScript strict, Three.js, zustand, Vite, bun.

**Spec:** `docs/superpowers/specs/2026-11-14-explorer-walk-design.md`

## Global Constraints

- `AGENTS.md`: no code comments, no tests. Verification is `bun run build` plus headless screenshots.
- Before every push: `git fetch`, rebase onto `origin/main`, reconcile conflicts, then `uv sync --frozen` and `cd web && bun run build` pass. Push to `main`, never force-push. A push deploys https://moonwalker.cinne.dev.
- Explorer must open and Walk must work with no engine reachable.
- No NASA logos or agency insignia on any model. National flags are allowed.
- URLs and code identifiers stay `learn`; only visible text says Explorer.
- New files stay under about 200 lines.
- Scene axes in Walk: x = east (m), y = up (m), z = south (m), origin at the start point on the ground.
- Values from the spec: grid 1 km × 1 km at 5 m (201 × 201); walk radius 400 m; astronaut 1.5 m/s; lunar gravity 1.62 m/s²; rover 4 m/s; shadow box about 150 m around the active body; fact card within 10 m.
- Every task appends one line to `AI_USAGE.md` (date, "Claude Code", what was done) and keeps `docs/PROGRESS.md` current.

## Review Focus

- Keyboard focus in the side panel (a toggle, the timeline slider) while in Walk: arrow keys must act on that control, not move the body, and Tab must still move focus.
- Switching site or leaving Walk mid-move: no stuck key state, no leaked render loop, bodies reset to the start point.
- Engine unreachable or slow at a polar site: Walk opens on procedural ground at once and swaps to the real patch when it arrives without moving the body into the ground.
- Shackleton floor, permanently dark: the scene is black with lights off, readable with lights on, and nothing claims the Sun is up.
- WebGL context lost while walking: the existing restore path rebuilds Walk too.

Each of these is checked by a named step in the task that owns it.

---

### Task 1: Rename Learn to Explorer

**Files:**
- Modify: `web/src/shell/ModeSwitch.tsx:22-26`
- Modify: `README.md:29`, `README.md:124`
- Modify: `AI_USAGE.md`, `docs/PROGRESS.md`
- Commit: `docs/superpowers/specs/2026-11-14-explorer-walk-design.md`, this plan

- [ ] **Step 1:** Change the link text to `Explorer` and its title to `Explorer: walk the Moon and see why landing is hard`. Grep `web/src` and docs for any other visible "Learn"/"learn mode" text and change it; leave identifiers, routes and the `useLearn` store alone.
- [ ] **Step 2:** Run `cd web && bun run build`. Expected: exit 0.
- [ ] **Step 3:** Screenshot `/learn` and `/`; the top bar reads `Planner | Explorer`.
- [ ] **Step 4:** Add a PROGRESS section "Explorer walk" listing the six tasks; AI_USAGE line. Fetch, rebase, `uv sync --frozen`, build, commit `feat(explorer): rename Learn to Explorer`, push.

### Task 2: Walk view with terrain, sky and light (free camera)

**Files:**
- Modify: `web/src/learn/chapters.ts` (`ViewKind`), `web/src/learn/components/Explore.tsx` (View toggle), `web/src/learn/scene/LearnScene.ts`, `web/src/learn/store.ts`
- Create: `web/src/learn/walk/walkTerrain.ts`, `web/src/learn/walk/walkSky.ts`, `web/src/learn/walk/walkView.ts`

**Interfaces:**
- Produces: `type ViewKind = "space" | "ground" | "crater" | "walk"`.
- Produces: `class WalkTerrain { readonly mesh: Mesh; setSite(site: RealSite): void; heightAt(x: number, z: number): number; normalAt(x: number, z: number, out: Vector3): Vector3 }`. Polar sites with `site.terrain` use `site.terrain.patch` (via `heightAt` in `terrain.ts`) plus `detailHeight` from `scene/surface.ts`; others use `detailHeight` alone. Material from `lunarSoil` + `regolithAlbedo` + `regolithNormalMap`.
- Produces: `class WalkSky { readonly group: Group; update(sky: SkyState, site: Site): void; sunDir(out: Vector3): Vector3 }` — star field, Sun and Earth discs from `Shared` textures at the angular sizes the ground view uses, and a skyline ring from `site.horizon(az)` beyond the grid.
- Produces: `class WalkView { readonly scene: Scene; readonly camera: PerspectiveCamera; constructor(shared: Shared); update(f: SceneFrame): void; step(dt: number, reduced: boolean): boolean; drag(dxDeg: number, dyDeg: number): void; resize(): void; dispose(): void }`. `step` returns true while anything is moving.
- Consumes: `SceneFrame`, `Shared` (`scene/types.ts`), `skyAt` result in `f.sky`, `ensureTerrain`/`siteById` (`terrain.ts`).

- [ ] **Step 1:** Add `"walk"` to `ViewKind`; in `ExploreCard` add `{ value: "walk", label: "Walk" }` after "On the ground". In `store.setSite`, keep `view` when it is `"walk"`. Make `setView("walk")` call `ensureTerrain(siteId)`.
- [ ] **Step 2:** Implement `WalkTerrain` (201 × 201 `PlaneGeometry` rotated to y-up, heights rewritten in `setSite`, normals recomputed, `receiveShadow` and `castShadow` true).
- [ ] **Step 3:** Implement `WalkSky`. Skyline ring: 720 segments at radius 4000 m, top edge at `4000 · tan(horizon(az))`, dark regolith colour.
- [ ] **Step 4:** Implement `WalkView`: one `DirectionalLight` along `sunDir`, intensity 0 when `f.sky.sun.frac <= 0`; a faint `HemisphereLight` fill scaled by `f.sky.earth.visible ? f.sky.earth.litFraction : 0`; shadow map 2048², orthographic shadow box ±75 m around a focus point (the origin for now). Free orbit camera around the origin until Task 3 replaces it. Re-run `terrain.setSite` when `f.site.id` or `useLearn.getState().terrainRev` changes.
- [ ] **Step 5:** In `LearnScene`: `private walk: WalkView | null`, created on first entry to `"walk"`, rendered in `render()`, stepped in `loop()` with `more = true` while the view is `"walk"`, resized in `resize()`, disposed in `teardown()`, and included in `onRestored` (Review Focus: context loss). Pointer drag on the canvas calls `walk.drag` in Walk.
- [ ] **Step 6:** Build. Screenshot Walk at Apollo 11 at three times (t = 2, 8, 20 days): shadows move and lengthen; Sun and Earth discs present; skyline visible.
- [ ] **Step 7:** Screenshot Walk at Shackleton rim with the engine running and with it stopped (Review Focus: engine unreachable): both render; with the engine, ground uses the patch.
- [ ] **Step 8:** AI_USAGE line, PROGRESS tick, fetch/rebase/checks, commit `feat(explorer): walk view with terrain, sky and sunlight`, push.

### Task 3: Astronaut, follow camera and keyboard

**Files:**
- Create: `web/src/learn/walk/astronaut.ts`, `web/src/learn/walk/followCamera.ts`, `web/src/learn/walk/walkInput.ts`, `web/src/learn/walk/collide.ts`
- Modify: `web/src/learn/walk/walkView.ts`, `web/src/learn/LearnPage.tsx` (`useKeyboard`)

**Interfaces:**
- Produces: `interface Drive { forward: number; turn: number; jump: boolean }` (forward, turn in −1..1).
- Produces: `class WalkInput { constructor(); read(): Drive; setStick(x: number, y: number): void; pressJump(): void; clear(): void; dispose(): void }` — listens on `window` for W A S D, arrows, Space; ignores events whose target is inside `input, textarea, select, button, a, summary, [role=radio], [contenteditable=true]`, or that carry Ctrl/Meta/Alt; `clear()` on `blur` and `visibilitychange`.
- Produces: `interface Obstacle { x: number; z: number; r: number }` and `function pushOut(x: number, z: number, r: number, obs: Obstacle[]): [number, number]` in `collide.ts`, plus `clampRadius(x: number, z: number, max: number): [number, number, boolean]`.
- Produces: `class Astronaut { readonly object: Group; readonly position: Vector3; heading: number; kneeling: boolean; reset(): void; step(dt: number, d: Drive, terrain: WalkTerrain, obs: Obstacle[], reduced: boolean): boolean }` — low-poly from primitives, white suit, backpack, gold visor, no logos; 1.5 m/s; jump `vy = 1.3 m/s` under g = 1.62; hop bob while moving unless reduced; `castShadow` on all meshes.
- Produces: `class FollowCamera { readonly camera: PerspectiveCamera; orbit(dxDeg: number, dyDeg: number): void; step(dt: number, target: Vector3, heading: number, reduced: boolean): void; snap(target: Vector3, heading: number): void }` — behind and above (distance 7 m, pitch 15°, pitch clamped 5..60°), damped unless reduced, never below terrain + 0.5 m.
- Produces on `WalkView`: `onEdge: ((atEdge: boolean) => void) | null`.

- [ ] **Step 1:** Implement `collide.ts`, `WalkInput`, `Astronaut`, `FollowCamera`.
- [ ] **Step 2:** Wire into `WalkView`: the shadow box follows the astronaut; `clampRadius` at 400 m sets `onEdge`; `step` returns true while input is non-zero, the body is airborne, or the camera is settling.
- [ ] **Step 3:** In `LearnPage.useKeyboard`, when `useLearn.getState().view === "walk"`, return early for arrows, Space, Home, End (K and `[` `]` still work).
- [ ] **Step 4:** Build. Headless: enter Walk, focus the canvas, hold W for 3 s, press Space; screenshots show the astronaut moved, airborne mid-jump, with its own shadow.
- [ ] **Step 5:** Headless (Review Focus: focus): focus the Speed toggle, press ArrowRight; the astronaut does not move. Press Tab; focus moves to the next control.
- [ ] **Step 6:** Headless (Review Focus: site switch): hold W, switch site while held, release; the astronaut is back at the start and not moving.
- [ ] **Step 7:** AI_USAGE, PROGRESS, fetch/rebase/checks, commit `feat(explorer): walk as an astronaut`, push.

### Task 4: Solar panel and battery in Walk

**Files:**
- Create: `web/src/learn/walk/solarPanel.ts`
- Modify: `web/src/learn/walk/walkView.ts`, `web/src/learn/components/Readouts.tsx`

**Interfaces:**
- Produces: `class SolarPanel { readonly object: Group; readonly obstacle: Obstacle; update(sunDir: Vector3, lit: boolean): void }` — mast and a 2 × 1 m panel at (4, 0, −3) that turns to face `sunDir`; emissive glow when `lit`.
- `lit` is `f.sky.sun.frac > 0.5`, the rule `timeline.ts` uses.

- [ ] **Step 1:** Implement `SolarPanel`; add it and its obstacle in `WalkView`.
- [ ] **Step 2:** In `Readouts`, show `<BatteryTile />` when the chip list has `"power"` or the store's `view === "walk"`.
- [ ] **Step 3:** Build. Screenshots at Apollo 11 day and night: panel faces the Sun and glows by day, dark by night; Battery tile visible.
- [ ] **Step 4:** Screenshot Shackleton floor (Review Focus: dark site): no glow, Sun tile not "up".
- [ ] **Step 5:** AI_USAGE, PROGRESS, fetch/rebase/checks, commit `feat(explorer): solar panel in the walk view`, push.

### Task 5: Rover and switching

**Files:**
- Create: `web/src/learn/walk/rover.ts`, `web/src/learn/components/walk/WalkHud.tsx`
- Modify: `web/src/learn/walk/walkView.ts`, `web/src/learn/walk/walkInput.ts`, `web/src/learn/store.ts`, `web/src/learn/components/Stage.tsx`, `web/src/learn/scene/LearnScene.ts`, `web/src/styles/learn.css`

**Interfaces:**
- Produces in store: `type WalkBody = "astronaut" | "rover"`; `walkBody: WalkBody`; `setWalkBody(b: WalkBody): void`; reset to `"astronaut"` in `enterChapter` and `setSite`.
- Produces: `class Rover { readonly object: Group; readonly position: Vector3; heading: number; reset(): void; step(dt: number, d: Drive, terrain: WalkTerrain, obs: Obstacle[]): boolean; obstacle(): Obstacle }` — modern open rover, four wheels, seats, mast, dish, no logos; 4 m/s, turn rate 40°/s, pitch and roll from the four wheel heights; starts at (2.5, 0, 0) heading north.
- `WalkInput` adds `E` → `onSwitch` callback.
- `WalkView.setBody(b: WalkBody): void` moves the camera target and the shadow focus; the idle body becomes an obstacle. The astronaut starts kneeling beside the rover and stands on the first non-zero `Drive`.
- `LearnScene.setWalkBody(b)` forwards to the view; `Stage` subscribes to `walkBody` and calls it.
- `WalkHud`: shown only in Walk; a "Switch to rover / Switch to astronaut" button, the dismissible controls hint (text in the spec's controls table), the edge hint from `onEdge`.

- [ ] **Step 1:** Implement `Rover`, store fields, `setBody`, the kneel opening, E key.
- [ ] **Step 2:** Implement `WalkHud` and its CSS using the existing learn tokens.
- [ ] **Step 3:** Build. Headless: opening shows the astronaut kneeling by the rover; press E, hold W 3 s; the rover moved and tilts on slopes; press E; control returns to the astronaut where it was left.
- [ ] **Step 4:** AI_USAGE, PROGRESS, fetch/rebase/checks, commit `feat(explorer): rover and switching`, push.

### Task 6: Hardware at the historical sites and fact cards

**Files:**
- Create: `web/src/learn/walk/props/index.ts`, `web/src/learn/walk/props/apollo11.ts`, `web/src/learn/walk/props/change4.ts`, `web/src/learn/walk/props/blueghost.ts`, `web/src/learn/walk/facts.ts`, `web/src/learn/components/walk/FactCard.tsx`
- Modify: `web/src/learn/walk/walkView.ts`, `web/src/learn/store.ts`, `web/src/learn/components/walk/WalkHud.tsx`, `REFERENCES.md`

**Interfaces:**
- Produces: `type PropId = "lm-descent" | "us-flag" | "lrrr" | "seismometer" | "bootprints" | "change4-lander" | "yutu2" | "blueghost-lander" | "no-landing"`.
- Produces: `interface PropSpec { id: PropId; object: Group; x: number; z: number; r: number }` and `function propsFor(id: SiteId): PropSpec[]`. Shackleton rim and floor return only `no-landing` (an invisible marker at the start).
- Produces: `FACTS: Record<PropId, { title: string; body: string; source: { title: string; url: string } }>` — each body one or two plain sentences, each checked against its source before commit; a claim without a source is dropped.
- Store: `nearProp: PropId | null`; `WalkView.onNear` sets it when the active body is within 10 m of a prop (nearest wins).
- Apollo 11 layout: descent stage at (−12, 0, −8), flag lying flat about 8 m from it, retroreflector and seismometer further out, bootprints between them. Chang'e 4: lander at (−10, 0, −6) with the national flag on its side, Yutu-2 at (−4, 0, −14). Blue Ghost: lander at (−10, 0, −6).

- [ ] **Step 1:** Write `facts.ts` with sources (NASA history pages for Apollo 11, CNSA/peer-reviewed or NASA pages for Chang'e 4, Firefly/NASA CLPS pages for Blue Ghost). Add each source to `REFERENCES.md`.
- [ ] **Step 2:** Build the props from primitives; add them and their obstacles in `WalkView`, rebuilt on site change.
- [ ] **Step 3:** `FactCard` in `WalkHud`, announced through the existing `Announcer`.
- [ ] **Step 4:** Build. Screenshots at Apollo 11, Chang'e 4, Blue Ghost next to each prop with its card; Shackleton rim shows the "no landing" card at the start.
- [ ] **Step 5:** AI_USAGE, PROGRESS, fetch/rebase/checks, commit `feat(explorer): landing-site hardware and fact cards`, push.

### Task 7: Touch, lights, reduced motion, honesty and polish

**Files:**
- Create: `web/src/learn/components/walk/TouchPad.tsx`
- Modify: `web/src/learn/walk/walkView.ts`, `web/src/learn/walk/astronaut.ts`, `web/src/learn/walk/rover.ts`, `web/src/learn/walk/walkInput.ts`, `web/src/learn/store.ts`, `web/src/learn/components/walk/WalkHud.tsx`, `web/src/learn/components/TruthNote.tsx`, `web/src/learn/components/Announcer.tsx`, `web/src/styles/learn.css`, `README.md`

**Interfaces:**
- Store: `walkLights: boolean; toggleWalkLights(): void`, reset with the body.
- `WalkView.setLights(on: boolean)`: a `SpotLight` helmet lamp (20 m) and two rover headlights (40 m), no shadows.
- `TouchPad`: shown when `matchMedia("(pointer: coarse)")` matches; left joystick → `WalkInput.setStick`, Jump, Switch, Lights buttons, all real `<button>`s with labels.

- [ ] **Step 1:** Lights (L key and button), `TouchPad`.
- [ ] **Step 2:** Reduced motion: no hop bob, no camera damping, instant switch.
- [ ] **Step 3:** TruthNote lines for Walk exactly as listed in the spec's Honesty section; Announcer messages for body switch, entering/leaving shadow, fact cards.
- [ ] **Step 4:** Build. Headless at 375 × 812 with touch: joystick moves the astronaut; Shackleton floor with lights off is black and with lights on is readable (Review Focus: dark site).
- [ ] **Step 5:** Performance: headless with CPU throttling ×4; Walk keeps rendering without long frames over 100 ms in a 10 s walk.
- [ ] **Step 6:** README: describe Explorer and Walk. AI_USAGE, PROGRESS done, fetch/rebase/checks, commit `feat(explorer): touch, lights and honesty notes for walk`, push.
