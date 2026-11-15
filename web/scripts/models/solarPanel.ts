import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Object3D, Vector3, type BufferGeometry, type Material } from "three";
import { toGlb } from "./glb";

const metal = new MeshStandardMaterial({ name: "Aluminium", color: 0xc4c7cc, metalness: 0.35, roughness: 0.45 });
const dark = new MeshStandardMaterial({ name: "Anodised", color: 0x3b3e45, metalness: 0.3, roughness: 0.6 });
const cells = new MeshStandardMaterial({ name: "Cells", color: 0x16235a, metalness: 0.2, roughness: 0.25 });
const backing = new MeshStandardMaterial({ name: "Backing", color: 0xd9d7d0, metalness: 0.05, roughness: 0.8 });
const cable = new MeshStandardMaterial({ name: "Cable", color: 0x1e1f22, metalness: 0, roughness: 0.9 });
const gold = new MeshStandardMaterial({ name: "Foil", color: 0xc8962f, metalness: 0.5, roughness: 0.35 });
const led = new MeshStandardMaterial({ name: "Led", color: 0x3cff7a, emissive: 0x3cff7a, emissiveIntensity: 1.5 });

function part(name: string, geo: BufferGeometry, mat: Material, x: number, y: number, z: number, parent: Object3D): Mesh {
  const m = new Mesh(geo, mat);
  m.name = name;
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function rod(name: string, a: Vector3, b: Vector3, r: number, mat: Material, parent: Object3D): Mesh {
  const len = a.distanceTo(b);
  const m = part(name, new CylinderGeometry(r, r, len, 10), mat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, parent);
  m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

const MAST = 1.6;

function base(root: Group): void {
  part("BasePlate", new CylinderGeometry(0.42, 0.46, 0.05, 6), dark, 0, 0.025, 0, root);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const foot = new Vector3(Math.cos(a) * 0.75, 0.02, Math.sin(a) * 0.75);
    rod(`Leg_${i}`, foot, new Vector3(0, 0.62, 0), 0.022, metal, root);
    part(`Foot_${i}`, new BoxGeometry(0.16, 0.03, 0.16), dark, foot.x, 0.015, foot.z, root);
    part(`Stake_${i}`, new CylinderGeometry(0.012, 0.004, 0.18, 6), metal, foot.x, -0.06, foot.z, root);
  }
  part("Mast", new CylinderGeometry(0.045, 0.05, MAST, 14), metal, 0, MAST / 2, 0, root);
  for (const [i, y] of [0.62, 1.15, 1.48].entries()) part(`Collar_${i}`, new CylinderGeometry(0.065, 0.065, 0.05, 14), dark, 0, y, 0, root);
  rod("CableMast", new Vector3(0.06, 0.1, 0.02), new Vector3(0.06, MAST - 0.1, 0.02), 0.011, cable, root);
  rod("CableGround", new Vector3(0.06, 0.03, 0.02), new Vector3(0.62, 0.03, 0.34), 0.011, cable, root);
  part("JunctionBox", new BoxGeometry(0.26, 0.18, 0.16), backing, 0.7, 0.09, 0.38, root);
  part("JunctionLid", new BoxGeometry(0.27, 0.02, 0.17), dark, 0.7, 0.19, 0.38, root);
  part("StatusLed", new BoxGeometry(0.03, 0.03, 0.01), led, 0.7, 0.12, 0.465, root);
}

function wing(name: string, cx: number, parent: Object3D): void {
  const w = 0.98;
  const h = 0.94;
  const g = new Group();
  g.name = name;
  g.position.x = cx;
  parent.add(g);
  part(`${name}_Backing`, new BoxGeometry(w, h, 0.02), backing, 0, 0, -0.012, g);
  const frame = 0.022;
  part(`${name}_FrameTop`, new BoxGeometry(w + frame, frame, 0.035), metal, 0, h / 2, 0, g);
  part(`${name}_FrameBottom`, new BoxGeometry(w + frame, frame, 0.035), metal, 0, -h / 2, 0, g);
  part(`${name}_FrameLeft`, new BoxGeometry(frame, h, 0.035), metal, -w / 2, 0, 0, g);
  part(`${name}_FrameRight`, new BoxGeometry(frame, h, 0.035), metal, w / 2, 0, 0, g);
  const n = 6;
  const gap = 0.008;
  const cw = (w - frame - gap * (n + 1)) / n;
  const ch = (h - frame - gap * (n + 1)) / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const x = -w / 2 + frame / 2 + gap + cw / 2 + i * (cw + gap);
      const y = -h / 2 + frame / 2 + gap + ch / 2 + j * (ch + gap);
      part(`${name}_Cell_${i}_${j}`, new BoxGeometry(cw, ch, 0.006), cells, x, y, 0.004, g);
    }
  for (const x of [-0.3, 0, 0.3]) part(`${name}_Rib_${x}`, new BoxGeometry(0.03, h - 0.04, 0.04), metal, x, 0, -0.04, g);
}

function head(root: Group): void {
  const head = new Group();
  head.name = "Head";
  head.position.y = MAST;
  root.add(head);
  part("AzimuthDrive", new CylinderGeometry(0.1, 0.1, 0.14, 18), dark, 0, 0.02, 0, head);
  part("AzimuthCap", new CylinderGeometry(0.075, 0.1, 0.04, 18), gold, 0, 0.11, 0, head);
  for (const x of [-0.13, 0.13]) part(`YokeArm_${x > 0 ? "R" : "L"}`, new BoxGeometry(0.035, 0.3, 0.09), metal, x, 0.24, 0, head);
  part("YokeBase", new BoxGeometry(0.3, 0.04, 0.1), metal, 0, 0.11, 0, head);
  const axle = part("ElevationAxle", new CylinderGeometry(0.025, 0.025, 0.36, 12), dark, 0, 0.36, 0, head);
  axle.rotation.z = Math.PI / 2;
  part("ElevationMotor", new CylinderGeometry(0.055, 0.055, 0.08, 14), dark, 0.2, 0.36, 0, head).rotation.z = Math.PI / 2;
  const array = new Group();
  array.name = "Array";
  array.position.set(0, 0.36, 0.06);
  head.add(array);
  part("ArrayMount", new BoxGeometry(0.22, 0.14, 0.05), metal, 0, 0, -0.06, array);
  part("ArraySpar", new BoxGeometry(2.1, 0.05, 0.04), metal, 0, 0, -0.05, array);
  wing("WingLeft", -0.51, array);
  wing("WingRight", 0.51, array);
}

const root = new Group();
root.name = "SolarPanel";
base(root);
head(root);
const glb = await toGlb(root);
for (const dir of ["src/learn/walk/models", "../tools/models/out"]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/solar_panel.glb`, Buffer.from(glb));
}
let tris = 0;
root.traverse((o) => {
  if (o instanceof Mesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position!.count) / 3;
});
console.log(`solar_panel.glb ${glb.byteLength} bytes, ${tris} triangles`);
