import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";
import { toGlb } from "./glb";

const std = (name: string, color: number, metalness = 0.2, roughness = 0.6) => new MeshStandardMaterial({ name, color, metalness, roughness });
const golds = [std("Foil gold", 0xc9962e, 0.45, 0.35), std("Foil gold dark", 0xb07f22, 0.45, 0.4), std("Foil gold light", 0xd9ad4a, 0.45, 0.32)];
const black = std("Thermal black", 0x1c1c20, 0.1, 0.8);
const silver = std("Aluminium", 0xc4c7cc, 0.35, 0.45);
const grey = std("Structure grey", 0x5a5d64, 0.25, 0.6);
const white = std("Radiator white", 0xe6e4de, 0.05, 0.75);
const cellMat = std("Cells", 0x16235a, 0.2, 0.25);
const nozzle = new MeshStandardMaterial({ name: "Nozzle", color: 0x4a3f36, metalness: 0.3, roughness: 0.5, side: DoubleSide });
const lens = std("Lens", 0x101418, 0.6, 0.2);

function part(name: string, geo: BufferGeometry, mat: Material, x: number, y: number, z: number, parent: Object3D): Mesh {
  const m = new Mesh(geo, mat);
  m.name = name;
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function rod(name: string, a: Vector3, b: Vector3, r: number, mat: Material, parent: Object3D): Mesh {
  const m = part(name, new CylinderGeometry(r, r, a.distanceTo(b), 10), mat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, parent);
  m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
const along = (a: number, r: number, y: number, t = 0) => v(Math.cos(a) * r - Math.sin(a) * t, y, Math.sin(a) * r + Math.cos(a) * t);

function cellPanel(name: string, w: number, h: number, nx: number, ny: number, parent: Object3D): Group {
  const g = new Group();
  g.name = name;
  parent.add(g);
  part(`${name}_Back`, new BoxGeometry(w, 0.02, h), white, 0, -0.012, 0, g);
  const gap = 0.012;
  const cw = (w - gap * (nx + 1)) / nx;
  const ch = (h - gap * (ny + 1)) / ny;
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      part(`${name}_Cell_${i}_${j}`, new BoxGeometry(cw, 0.006, ch), cellMat, -w / 2 + gap + cw / 2 + i * (cw + gap), 0.002, -h / 2 + gap + ch / 2 + j * (ch + gap), g);
  for (const [k, z] of [-h / 2, h / 2].entries()) part(`${name}_Frame_${k}`, new BoxGeometry(w + 0.02, 0.03, 0.02), silver, 0, 0, z, g);
  return g;
}

function legSet(name: string, root: Object3D, angles: number[], bodyR: number, topY: number, lowY: number, padR: number, padSpan: number, probes: boolean[]): void {
  angles.forEach((a, i) => {
    const pad = along(a, padSpan, 0.12);
    rod(`${name}_Primary_${i}`, along(a, bodyR * 0.85, topY), pad.clone().setY(0.16), 0.07, silver, root);
    const knee = along(a, bodyR + (padSpan - bodyR) * 0.62, 0.7);
    for (const t of [-1, 1]) rod(`${name}_Secondary_${i}_${t}`, along(a, bodyR, lowY, t * bodyR * 0.42), knee, 0.035, silver, root);
    rod(`${name}_Downlock_${i}`, along(a, bodyR * 0.95, lowY + 0.3), knee, 0.028, grey, root);
    part(`${name}_Pad_${i}`, new CylinderGeometry(padR, padR * 0.82, 0.13, 20), silver, pad.x, 0.065, pad.z, root);
    if (probes[i]) {
      const tip = along(a, padSpan + 1.2, 0.03, 0.2);
      rod(`${name}_Probe_${i}`, along(a, padSpan + padR * 0.7, 0.08), tip, 0.012, silver, root);
    }
  });
}

function apolloLm(): Group {
  const root = new Group();
  root.name = "ApolloLmDescent";
  const bodyR = 2.1;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const c = along(a, bodyR * Math.cos(Math.PI / 8), 2.37);
    const panel = part(`Facet_${i}`, new BoxGeometry(0.03, 1.62, 2 * bodyR * Math.sin(Math.PI / 8) + 0.02), i % 2 ? black : golds[i % 3]!, c.x, c.y, c.z, root);
    panel.rotation.y = -a;
  }
  part("Core", new CylinderGeometry(bodyR * 0.96, bodyR * 0.96, 1.6, 8), golds[1]!, 0, 2.37, 0, root).rotation.y = Math.PI / 8;
  part("BandTop", new CylinderGeometry(bodyR + 0.02, bodyR + 0.02, 0.08, 8), silver, 0, 3.18, 0, root).rotation.y = Math.PI / 8;
  part("BandBottom", new CylinderGeometry(bodyR + 0.02, bodyR + 0.02, 0.08, 8), silver, 0, 1.56, 0, root).rotation.y = Math.PI / 8;
  part("TopDeck", new CylinderGeometry(bodyR - 0.05, bodyR - 0.05, 0.06, 8), grey, 0, 3.25, 0, root).rotation.y = Math.PI / 8;
  for (let i = 0; i < 4; i++) {
    const p = along((i / 4) * Math.PI * 2 + Math.PI / 4, 1.1, 3.33);
    part(`InterstageFitting_${i}`, new BoxGeometry(0.22, 0.12, 0.22), silver, p.x, p.y, p.z, root);
  }
  part("EngineSkirt", new CylinderGeometry(0.62, 0.55, 0.22, 24), black, 0, 1.45, 0, root);
  part("EngineBell", new CylinderGeometry(0.36, 0.76, 0.85, 28, 1, true), nozzle, 0, 0.98, 0, root);
  legSet("Leg", root, [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2], bodyR, 3.0, 1.6, 0.47, 4.3, [false, true, true, true]);
  const lx = 3.1;
  for (const s of [-0.28, 0.28]) rod(`LadderRail_${s > 0 ? "R" : "L"}`, v(lx + 0.95, 0.4, s), v(lx - 0.45, 2.95, s), 0.025, silver, root);
  for (let i = 0; i < 9; i++) {
    const t = (i + 0.5) / 9;
    part(`Rung_${i}`, new BoxGeometry(0.05, 0.03, 0.56), silver, lx + 0.95 - 1.4 * t, 0.4 + 2.55 * t, 0, root);
  }
  part("Porch", new BoxGeometry(1.0, 0.06, 0.9), silver, lx - 0.75, 3.0, 0, root);
  for (const s of [-0.43, 0.43]) {
    rod(`PorchRailPost_${s > 0 ? "R" : "L"}`, v(lx - 0.35, 3.0, s), v(lx - 0.35, 3.55, s), 0.018, silver, root);
    rod(`PorchRail_${s > 0 ? "R" : "L"}`, v(lx - 0.35, 3.55, s), v(lx - 1.1, 3.55, s), 0.018, silver, root);
  }
  part("Plaque", new BoxGeometry(0.02, 0.24, 0.3), silver, lx - 0.15, 1.45, 0, root);
  const mesaAt = along(-Math.PI / 4, bodyR * Math.cos(Math.PI / 8) + 0.25, 1.85);
  const mesa = part("Mesa", new BoxGeometry(0.06, 0.9, 1.2), silver, mesaAt.x, mesaAt.y, mesaAt.z, root);
  mesa.rotation.y = Math.PI / 4;
  mesa.rotation.z = -0.5;
  for (const [i, a] of [Math.PI / 4, (3 * Math.PI) / 4].entries()) {
    const p = along(a, bodyR * Math.cos(Math.PI / 8) + 0.02, 2.0);
    const bay = part(`ScienceBay_${i}`, new BoxGeometry(0.04, 0.7, 1.0), grey, p.x, p.y, p.z, root);
    bay.rotation.y = -a;
  }
  return root;
}

function change4Lander(): Group {
  const root = new Group();
  root.name = "Change4Lander";
  part("Body", new BoxGeometry(2.4, 1.3, 2.4), golds[0]!, 0, 1.75, 0, root);
  for (const [i, [x, z, ry]] of ([
    [1.21, 0, Math.PI / 2],
    [-1.21, 0, Math.PI / 2],
    [0, -1.21, 0],
  ] as const).entries())
    part(`Radiator_${i}`, new BoxGeometry(1.6, 0.9, 0.02), white, x, 1.8, z, root).rotation.y = ry;
  for (let i = 0; i < 6; i++) part(`FoilSeam_${i}`, new BoxGeometry(2.42, 0.02, 2.42), golds[(i % 2) + 1]!, 0, 1.2 + i * 0.22, 0, root);
  part("TopDeck", new BoxGeometry(2.5, 0.08, 2.5), silver, 0, 2.44, 0, root);
  part("EngineBell", new CylinderGeometry(0.25, 0.55, 0.6, 24, 1, true), nozzle, 0, 0.85, 0, root);
  legSet("Leg", root, [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4], 1.3, 2.2, 1.2, 0.35, 2.6, [false, false, false, false]);
  for (const s of [-1, 1]) {
    const hinge = new Group();
    hinge.name = `WingHinge_${s > 0 ? "R" : "L"}`;
    hinge.position.set(s * 1.25, 2.45, 0);
    hinge.rotation.z = s * -0.3;
    root.add(hinge);
    const wing = cellPanel(`Wing_${s > 0 ? "R" : "L"}`, 1.6, 1.2, 4, 6, hinge);
    wing.position.x = s * 0.82;
  }
  rod("CameraMast", v(0.7, 2.48, 0.7), v(0.7, 3.55, 0.7), 0.045, silver, root);
  part("CameraHead", new BoxGeometry(0.32, 0.2, 0.22), grey, 0.7, 3.65, 0.7, root);
  for (const s of [-0.07, 0.07]) {
    const l = part(`CameraLens_${s > 0 ? "R" : "L"}`, new CylinderGeometry(0.035, 0.035, 0.05, 12), lens, 0.7 + s, 3.65, 0.83, root);
    l.rotation.x = Math.PI / 2;
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const b = v(-0.6 + Math.cos(a) * 0.25, 2.48, -0.6 + Math.sin(a) * 0.25);
    rod(`LfsAntenna_${i}`, b, v(b.x + Math.cos(a) * 1.6, 3.4, b.z + Math.sin(a) * 1.6), 0.012, silver, root);
  }
  for (const s of [-0.45, 0.45]) rod(`Ramp_${s > 0 ? "R" : "L"}`, v(s, 2.4, 1.2), v(s, 0.05, 3.6), 0.04, silver, root);
  part("RampDeck", new BoxGeometry(0.95, 0.03, 0.4), grey, 0, 2.38, 1.35, root);
  return root;
}

function yutu2(): Group {
  const root = new Group();
  root.name = "Yutu2";
  part("Body", new BoxGeometry(0.85, 0.42, 1.3), golds[0]!, 0, 0.66, 0, root);
  part("Deck", new BoxGeometry(0.88, 0.03, 1.33), white, 0, 0.89, 0, root);
  for (const s of [-1, 1]) {
    const hinge = new Group();
    hinge.name = `WingHinge_${s > 0 ? "R" : "L"}`;
    hinge.position.set(s * 0.45, 0.9, 0);
    hinge.rotation.z = s * -0.35;
    root.add(hinge);
    cellPanel(`Wing_${s > 0 ? "R" : "L"}`, 0.7, 1.2, 3, 5, hinge).position.x = s * 0.36;
  }
  const wheel = new CylinderGeometry(0.15, 0.15, 0.12, 18).rotateZ(Math.PI / 2);
  for (const s of [-1, 1]) {
    rod(`Rocker_${s}`, v(s * 0.5, 0.55, -0.55), v(s * 0.5, 0.45, 0.3), 0.025, silver, root);
    rod(`Bogie_${s}`, v(s * 0.5, 0.45, 0.05), v(s * 0.5, 0.3, 0.55), 0.025, silver, root);
    for (const z of [-0.5, 0, 0.5]) {
      part(`Wheel_${s}_${z}`, wheel, grey, s * 0.55, 0.15, z, root);
      part(`Hub_${s}_${z}`, new CylinderGeometry(0.05, 0.05, 0.14, 10).rotateZ(Math.PI / 2), silver, s * 0.55, 0.15, z, root);
    }
  }
  rod("Mast", v(0, 0.9, -0.5), v(0, 1.45, -0.5), 0.03, silver, root);
  part("PancamHead", new BoxGeometry(0.36, 0.12, 0.12), white, 0, 1.5, -0.5, root);
  for (const s of [-0.12, 0.12]) {
    const l = part(`Pancam_${s > 0 ? "R" : "L"}`, new CylinderGeometry(0.03, 0.03, 0.04, 12), lens, s, 1.5, -0.57, root);
    l.rotation.x = Math.PI / 2;
  }
  const dish = part("Antenna", new ConeGeometry(0.16, 0.08, 18, 1, true), white, 0.25, 1.15, 0.4, root);
  dish.rotation.x = -0.6;
  rod("AntennaBoom", v(0.25, 0.9, 0.4), v(0.25, 1.1, 0.4), 0.015, silver, root);
  return root;
}

function blueGhost(): Group {
  const root = new Group();
  root.name = "BlueGhost";
  part("Body", new CylinderGeometry(1.45, 1.55, 1.4, 6), golds[0]!, 0, 1.45, 0, root);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const holder = new Group();
    holder.name = `SidePanel_${i}`;
    holder.position.set(Math.sin(a) * 1.44, 1.5, Math.cos(a) * 1.44);
    holder.rotation.set(Math.PI / 2, a, 0, "YXZ");
    root.add(holder);
    cellPanel(`Side_${i}`, 1.25, 0.9, 5, 3, holder);
  }
  part("TopDeck", new CylinderGeometry(1.48, 1.48, 0.1, 6), white, 0, 2.2, 0, root);
  part("Drill", new BoxGeometry(0.35, 0.5, 0.35), grey, -0.7, 2.5, -0.2, root);
  rod("DrillBoom", v(-0.7, 2.75, -0.2), v(-1.4, 2.6, -0.4), 0.03, silver, root);
  part("Telescope", new CylinderGeometry(0.12, 0.12, 0.45, 16), white, 0.3, 2.45, -0.75, root).rotation.x = 0.5;
  rod("AntennaMast", v(0.6, 2.25, 0.3), v(0.6, 3.05, 0.3), 0.05, silver, root);
  const dish = part("Dish", new SphereGeometry(0.36, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.32), white, 0.6, 3.05, 0.3, root);
  dish.rotation.x = Math.PI;
  part("Camera", new BoxGeometry(0.18, 0.14, 0.18), grey, -0.2, 2.35, 0.9, root);
  part("EngineBell", new CylinderGeometry(0.22, 0.45, 0.5, 24, 1, true), nozzle, 0, 0.55, 0, root);
  legSet("Leg", root, [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4], 1.4, 1.9, 0.95, 0.32, 2.3, [false, false, false, false]);
  return root;
}

const outputs: [string, () => Group][] = [
  ["apollo11_lm.glb", apolloLm],
  ["change4_lander.glb", change4Lander],
  ["yutu2.glb", yutu2],
  ["blue_ghost.glb", blueGhost],
];
for (const [file, build] of outputs) {
  const root = build();
  const glb = await toGlb(root);
  for (const dir of ["src/learn/walk/models", "../tools/models/out"]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/${file}`, Buffer.from(glb));
  }
  let tris = 0;
  root.traverse((o) => {
    if (o instanceof Mesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position!.count) / 3;
  });
  console.log(`${file} ${glb.byteLength} bytes, ${tris} triangles`);
}
