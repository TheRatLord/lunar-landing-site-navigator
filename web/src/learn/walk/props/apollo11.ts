import { CircleGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry } from "three";
import type { PropSpec } from "./index";
import { box, darkGrey, foil, legs, mesh, silver, strut, usFlag } from "./parts";

const LM = { x: -12, z: -8 };
const FLAG = { x: -5.9, z: -13.2 };
const EASEP = { x: -12, z: 9 };
const LRRR = { x: -13.9, z: 4.4 };

function descentStage(): Group {
  const g = new Group();
  const body = mesh(new CylinderGeometry(2.27, 2.27, 1.7, 8), foil, 0, 2.35, 0);
  body.rotation.y = Math.PI / 8;
  g.add(body);
  g.add(mesh(new CylinderGeometry(2.2, 2.2, 0.08, 8), darkGrey, 0, 3.24, 0));
  const skirt = mesh(new ConeGeometry(0.75, 1, 20, 1, true), darkGrey, 0, 1.0, 0);
  g.add(skirt);
  legs(g, 4, 2.0, 2.4, 0.45, 4.7, silver);
  const lx = 3.1;
  for (const s of [-0.28, 0.28]) strut(g, lx + 0.9, 0.35, s, lx - 0.4, 2.2, s, 0.025, silver);
  for (let i = 0; i < 6; i++) {
    const t = (i + 0.5) / 6;
    g.add(box(0.05, 0.03, 0.56, silver, lx + 0.9 - 1.3 * t, 0.35 + 1.85 * t, 0));
  }
  g.add(box(1.0, 0.06, 0.9, silver, lx - 0.7, 2.25, 0));
  return g;
}

function fallenFlag(): Group {
  const g = new Group();
  const pole = mesh(new CylinderGeometry(0.025, 0.025, 2.4, 8), silver, 0, 0.03, 0);
  pole.rotation.z = Math.PI / 2;
  g.add(pole);
  const cloth = new Mesh(new PlaneGeometry(1.52, 0.8), new MeshLambertMaterial({ map: usFlag(), side: DoubleSide }));
  cloth.rotation.x = -Math.PI / 2;
  cloth.position.set(0.35, 0.05, 0.42);
  cloth.receiveShadow = true;
  g.add(cloth);
  g.rotation.y = 0.6;
  return g;
}

function easep(): Group {
  const g = new Group();
  g.add(box(0.8, 0.5, 0.8, foil, 0, 0.25, 0));
  for (const s of [-1, 1]) {
    const p = box(1.1, 0.04, 0.9, new MeshLambertMaterial({ color: 0x1e2c58 }), s * 1.0, 0.55, 0);
    p.rotation.z = s * 0.5;
    g.add(p);
  }
  g.add(mesh(new CylinderGeometry(0.03, 0.03, 0.8, 6), silver, 0.2, 0.9, 0.2));
  return g;
}

function lrrr(): Group {
  const g = new Group();
  g.add(box(0.15, 0.3, 0.15, silver, 0, 0.15, 0));
  const panel = box(0.46, 0.08, 0.46, darkGrey, 0, 0.34, 0);
  panel.rotation.x = -0.35;
  g.add(panel);
  return g;
}

function bootprints(): Group {
  const g = new Group();
  const mat = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false });
  const geo = new CircleGeometry(0.13, 10);
  const path: [number, number][] = [
    [LM.x + 3.5, LM.z],
    [FLAG.x, FLAG.z + 1],
    [LM.x + 3.5, LM.z],
    [LRRR.x, LRRR.z],
    [EASEP.x, EASEP.z - 0.8],
  ];
  for (let k = 0; k < path.length - 1; k++) {
    const [ax, az] = path[k]!;
    const [bx, bz] = path[k + 1]!;
    const n = Math.floor(Math.hypot(bx - ax, bz - az) / 0.7);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const side = i % 2 ? 0.14 : -0.14;
      const ang = Math.atan2(bx - ax, bz - az);
      const m = new Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.scale.set(1, 2, 1);
      m.rotation.z = -ang;
      m.position.set(ax + (bx - ax) * t + Math.cos(ang) * side, 0, az + (bz - az) * t - Math.sin(ang) * side);
      g.add(m);
    }
  }
  return g;
}

export function apollo11(): PropSpec[] {
  return [
    { id: "lm-descent", object: descentStage(), x: LM.x, z: LM.z, r: 3.2 },
    { id: "us-flag", object: fallenFlag(), x: FLAG.x, z: FLAG.z, r: 0.3, walkOver: true },
    { id: "easep", object: easep(), x: EASEP.x, z: EASEP.z, r: 1.1 },
    { id: "lrrr", object: lrrr(), x: LRRR.x, z: LRRR.z, r: 0.4 },
    { id: null, object: bootprints(), x: 0, z: 0, r: 0, walkOver: true, decal: true },
  ];
}
