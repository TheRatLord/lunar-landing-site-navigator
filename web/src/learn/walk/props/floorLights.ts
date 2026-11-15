import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, SpotLight } from "three";
import type { PropSpec } from "./index";
import { darkGrey, mesh, silver, strut } from "./parts";

const TOWERS = [
  { x: 8, z: 10 },
  { x: -10, z: 4 },
  { x: 2, z: -12 },
];
const MAST = 4.2;
const lamp = new MeshBasicMaterial({ color: 0xfff3d6 });

function tower(x: number, z: number): Group {
  const g = new Group();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    strut(g, Math.cos(a) * 0.8, 0, Math.sin(a) * 0.8, 0, 1.6, 0, 0.03, silver);
  }
  g.add(mesh(new CylinderGeometry(0.05, 0.07, MAST, 8), silver, 0, MAST / 2, 0));
  const head = new Group();
  head.position.y = MAST;
  head.lookAt(-x, -MAST, -z);
  head.add(mesh(new BoxGeometry(0.9, 0.45, 0.2), darkGrey, 0, 0, -0.05));
  const face = new Mesh(new BoxGeometry(0.8, 0.36, 0.02), lamp);
  face.position.z = 0.06;
  head.add(face);
  g.add(head);
  const light = new SpotLight(0xfff1dc, 2.6, 48, 0.75, 0.6, 0);
  light.position.set(0, MAST, 0);
  light.target.position.set(-x * 0.6, 0, -z * 0.6);
  g.add(light, light.target);
  return g;
}

export function floorLights(): PropSpec[] {
  return TOWERS.map((t) => ({ id: null, object: tower(t.x, t.z), x: t.x, z: t.z, r: 0.9 }));
}
