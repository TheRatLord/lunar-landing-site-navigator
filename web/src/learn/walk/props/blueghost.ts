import { CylinderGeometry, Group } from "three";
import type { PropSpec } from "./index";
import { box, cells, darkGrey, foil, legs, mesh, silver } from "./parts";

function lander(): Group {
  const g = new Group();
  const body = mesh(new CylinderGeometry(1.5, 1.6, 1.4, 6), foil, 0, 1.45, 0);
  g.add(body);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const p = box(1.3, 0.9, 0.04, cells, Math.sin(a) * 1.42, 1.5, Math.cos(a) * 1.42);
    p.rotation.y = a;
    g.add(p);
  }
  g.add(mesh(new CylinderGeometry(1.45, 1.45, 0.1, 6), silver, 0, 2.2, 0));
  g.add(mesh(new CylinderGeometry(0.06, 0.06, 0.9, 8), silver, 0.6, 2.65, 0.3));
  g.add(mesh(new CylinderGeometry(0.35, 0.05, 0.15, 16), silver, 0.6, 3.15, 0.3));
  g.add(box(0.4, 0.4, 0.4, darkGrey, -0.6, 2.45, -0.2));
  legs(g, 4, 1.4, 1.0, 0.32, 2.3, silver);
  return g;
}

export function blueghost(): PropSpec[] {
  return [{ id: "blueghost-lander", object: lander(), x: -10, z: -6, r: 2.0 }];
}
