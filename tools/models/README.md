# Lunar rover and cockpit model review

These scripts reproduce two proposed GLB models and comparison reconstructions of the current procedural geometry. The current site has no cockpit GLB; `current_inside.glb` represents the seat and front housing shapes from `web/src/learn/walk/rover.ts`.

Models use the same coordinates as the Three.js site: meters, +Y up, rover forward along −Z, root at ground height. The new rover's wheel pivots are `Steer_FL`, `Steer_FR`, `Steer_RL`, and `Steer_RR`. Each contains a `Wheel_*` mesh whose local origin is its wheel center. The cockpit screens are `Screen_Nav`, `Screen_Status`, and `Screen_Comms`.

## Rebuild

Install Python 3.13 and `bpy==5.3.0` in a virtual environment, then run:

```sh
python tools/models/build.py
```

The GLBs and counts go to `tools/models/out/`. Rendered views go to `tools/models/previews/`, which Git ignores.

## Browser preview

Install the existing web dependencies, then serve the repository root:

```sh
cd web && bun install --frozen-lockfile && cd ..
python3 -m http.server 8766 --bind 127.0.0.1
```

Open `http://127.0.0.1:8766/tools/models/preview.html`. Drag to orbit, scroll to zoom, or select a matching view for both models. The Inside view also offers the existing driver eye position.

The Learn rover loads copies of the proposed GLBs from `web/src/learn/walk/models/`. Its procedural geometry remains available while they load and if either file fails to load.

## Solar panel (three.js)

`solar_panel.glb` is built without Blender, from three.js shapes under bun:

```sh
cd web && bun scripts/models/solarPanel.ts
```

It writes the GLB to `web/src/learn/walk/models/` and `tools/models/out/`. The node `Head` turns about +Y to face the
Sun, `Array` tilts about X, and the cell material is named `Cells` so the site can light it while charging.

## Cockpit detail (three.js)

`web/scripts/models/cockpit.ts` reads `out/improved_cockpit.glb` (the Blender build above), adds screen graphics,
switches, belts, footrests, grab handles and an overhead console, and writes the site copy
`web/src/learn/walk/models/improved_cockpit.glb` plus `out/improved_cockpit_detailed.glb`:

```sh
cd web && bun scripts/models/cockpit.ts
```
