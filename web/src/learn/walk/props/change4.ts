import { CylinderGeometry, Group, Mesh, MeshLambertMaterial, PlaneGeometry } from "three";
import type { PropSpec } from "./index";
import { box, cells, chinaFlag, darkGrey, foil, legs, mesh, silver } from "./parts";

function lander(): Group {
  const g = new Group();
  g.add(box(2.4, 1.3, 2.4, foil, 0, 1.75, 0));
  g.add(box(2.5, 0.08, 2.5, silver, 0, 2.44, 0));
  legs(g, 4, 1.3, 1.4, 0.35, 2.6, silver);
  for (const s of [-1, 1]) {
    const wing = box(1.6, 0.05, 1.1, cells, s * 2.2, 2.3, 0);
    wing.rotation.z = s * -0.25;
    g.add(wing);
  }
  g.add(mesh(new CylinderGeometry(0.05, 0.05, 1.1, 8), silver, 0.7, 3.0, 0.7));
  g.add(box(0.3, 0.22, 0.22, darkGrey, 0.7, 3.6, 0.7));
  const flag = new Mesh(new PlaneGeometry(0.75, 0.5), new MeshLambertMaterial({ map: chinaFlag() }));
  flag.position.set(0, 1.85, 1.205);
  g.add(flag);
  g.add(mesh(new CylinderGeometry(0.6, 0.8, 0.5, 16, 1, true), darkGrey, 0, 0.9, 0));
  return g;
}

function yutu2(): Group {
  const g = new Group();
  g.add(box(0.9, 0.5, 1.3, foil, 0, 0.62, 0));
  for (const s of [-1, 1]) {
    const wing = box(0.7, 0.04, 1.2, cells, s * 0.85, 0.95, 0);
    wing.rotation.z = s * 0.35;
    g.add(wing);
  }
  const wheel = new CylinderGeometry(0.15, 0.15, 0.12, 14).rotateZ(Math.PI / 2);
  for (const s of [-1, 1]) for (const z of [-0.5, 0, 0.5]) g.add(mesh(wheel, darkGrey, s * 0.55, 0.15, z));
  g.add(mesh(new CylinderGeometry(0.03, 0.03, 0.6, 6), silver, 0, 1.15, -0.5));
  g.add(box(0.35, 0.12, 0.12, silver, 0, 1.5, -0.5));
  g.rotation.y = 0.8;
  return g;
}

export function change4(): PropSpec[] {
  return [
    { id: "change4-lander", object: lander(), x: -10, z: -6, r: 2.4 },
    { id: "yutu2", object: yutu2(), x: -4, z: -14, r: 0.9 },
  ];
}
