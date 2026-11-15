import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Object3D, Vector3, type BufferGeometry, type Material } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { toGlb } from "./glb";

const BASE = "../tools/models/out/improved_cockpit.glb";

const glow = (name: string, color: number, k = 1.2) => new MeshStandardMaterial({ name, color, emissive: color, emissiveIntensity: k, roughness: 0.4 });
const cyan = glow("Display cyan", 0x38d6ff, 1.1);
const cyanDim = glow("Display grid", 0x1b6f8a, 0.8);
const amber = glow("Display amber", 0xffb020, 1.3);
const green = glow("Display green", 0x45e07a, 1.2);
const red = glow("Button red", 0xff4a3d, 0.9);
const yellow = glow("Button yellow", 0xffd23d, 0.7);
const graphite = new MeshStandardMaterial({ name: "Panel graphite", color: 0x26282d, metalness: 0.2, roughness: 0.7 });
const steel = new MeshStandardMaterial({ name: "Switch steel", color: 0xb8bcc4, metalness: 0.6, roughness: 0.35 });
const webbing = new MeshStandardMaterial({ name: "Harness webbing", color: 0x2f4f8f, roughness: 0.9 });
const brass = new MeshStandardMaterial({ name: "Buckle brass", color: 0xc9a14a, metalness: 0.7, roughness: 0.3 });
const rubber = new MeshStandardMaterial({ name: "Rubber", color: 0x1a1b1e, roughness: 0.95 });

function part(name: string, geo: BufferGeometry, mat: Material, x: number, y: number, z: number, parent: Object3D): Mesh {
  const m = new Mesh(geo, mat);
  m.name = name;
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function rod(name: string, a: [number, number, number], b: [number, number, number], r: number, mat: Material, parent: Object3D): Mesh {
  const va = new Vector3(...a);
  const vb = new Vector3(...b);
  const m = part(name, new CylinderGeometry(r, r, va.distanceTo(vb), 10), mat, (va.x + vb.x) / 2, (va.y + vb.y) / 2, (va.z + vb.z) / 2, parent);
  m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), vb.sub(va).normalize());
  return m;
}

const SCREEN_Z = -0.822;
const SCREEN_Y = 1.56;

function navScreen(g: Group): void {
  const x0 = -0.48;
  for (let i = 0; i < 5; i++) part(`NavGridV_${i}`, new BoxGeometry(0.003, 0.2, 0.002), cyanDim, x0 - 0.14 + i * 0.07, SCREEN_Y, SCREEN_Z, g);
  for (let j = 0; j < 4; j++) part(`NavGridH_${j}`, new BoxGeometry(0.3, 0.003, 0.002), cyanDim, x0, SCREEN_Y - 0.075 + j * 0.05, SCREEN_Z, g);
  const route: [number, number][] = [
    [-0.12, -0.08],
    [-0.05, -0.04],
    [0.0, 0.02],
    [0.06, 0.03],
    [0.11, 0.08],
  ];
  for (let i = 0; i < route.length - 1; i++) {
    const [ax, ay] = route[i]!;
    const [bx, by] = route[i + 1]!;
    rod(`NavRoute_${i}`, [x0 + ax, SCREEN_Y + ay, SCREEN_Z + 0.001], [x0 + bx, SCREEN_Y + by, SCREEN_Z + 0.001], 0.003, cyan, g);
  }
  part("NavRover", new BoxGeometry(0.016, 0.016, 0.003), amber, x0 - 0.12, SCREEN_Y - 0.08, SCREEN_Z + 0.002, g);
  part("NavTarget", new BoxGeometry(0.02, 0.02, 0.003), green, x0 + 0.11, SCREEN_Y + 0.08, SCREEN_Z + 0.002, g);
  rod("NavNorth", [x0 + 0.13, SCREEN_Y - 0.09, SCREEN_Z + 0.001], [x0 + 0.13, SCREEN_Y - 0.05, SCREEN_Z + 0.001], 0.003, amber, g);
}

function statusScreen(g: Group): void {
  const fills = [0.82, 0.64, 0.4, 0.92];
  const mats = [green, green, amber, cyan];
  fills.forEach((f, i) => {
    const y = SCREEN_Y + 0.075 - i * 0.05;
    part(`StatusTrack_${i}`, new BoxGeometry(0.26, 0.02, 0.002), cyanDim, 0, y, SCREEN_Z, g);
    part(`StatusBar_${i}`, new BoxGeometry(0.26 * f, 0.02, 0.003), mats[i]!, -0.13 + (0.26 * f) / 2, y, SCREEN_Z + 0.001, g);
  });
}

function commsScreen(g: Group): void {
  const x0 = 0.48;
  for (let i = 0; i < 5; i++) {
    const h = 0.03 + i * 0.03;
    part(`CommsBar_${i}`, new BoxGeometry(0.035, h, 0.003), i < 4 ? green : cyanDim, x0 - 0.1 + i * 0.05, SCREEN_Y - 0.09 + h / 2, SCREEN_Z + 0.001, g);
  }
  rod("CommsMast", [x0 + 0.11, SCREEN_Y - 0.09, SCREEN_Z + 0.001], [x0 + 0.11, SCREEN_Y + 0.05, SCREEN_Z + 0.001], 0.003, cyan, g);
  part("CommsDish", new BoxGeometry(0.05, 0.012, 0.003), cyan, x0 + 0.11, SCREEN_Y + 0.06, SCREEN_Z + 0.001, g);
}

function switchPanel(g: Group): void {
  const cx = 0.38;
  const y0 = 1.22;
  const z = -0.846;
  part("SwitchPlate", new BoxGeometry(0.62, 0.17, 0.01), graphite, cx, y0, z, g);
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 8; i++) {
      const x = cx - 0.27 + i * 0.077;
      const y = y0 - 0.035 + row * 0.07;
      const base = part(`Switch_${row}_${i}`, new CylinderGeometry(0.009, 0.009, 0.012, 10), steel, x, y, z + 0.009, g);
      base.rotation.x = Math.PI / 2;
      const up = (i + row) % 3 !== 0;
      rod(`SwitchLever_${row}_${i}`, [x, y, z + 0.014], [x, y + (up ? 0.022 : -0.022), z + 0.03], 0.0035, steel, g);
      part(`SwitchLed_${row}_${i}`, new BoxGeometry(0.012, 0.006, 0.004), up ? green : amber, x, y + 0.028, z + 0.007, g);
    }
  for (const x of [cx - 0.33, cx + 0.33]) part(`SwitchGuard_${x > cx ? "R" : "L"}`, new BoxGeometry(0.012, 0.17, 0.04), steel, x, y0, z + 0.018, g);
}

function handController(g: Group): void {
  const x = 0;
  const z = -0.18;
  part("HandBase", new CylinderGeometry(0.045, 0.055, 0.03, 16), rubber, x, 1.215, z, g);
  rod("HandStem", [x, 1.23, z], [x, 1.33, z - 0.02], 0.014, steel, g);
  rod("HandBar", [x - 0.07, 1.34, z - 0.022], [x + 0.07, 1.34, z - 0.022], 0.018, rubber, g);
  part("HandButtonRed", new CylinderGeometry(0.012, 0.012, 0.012, 12), red, x - 0.035, 1.362, z - 0.022, g);
  part("HandButtonYellow", new CylinderGeometry(0.01, 0.01, 0.012, 12), yellow, x + 0.035, 1.362, z - 0.022, g);
}

function seats(g: Group): void {
  for (const [side, x] of [
    ["L", -0.39],
    ["R", 0.39],
  ] as const) {
    rod(`LapBelt_${side}`, [x - 0.23, 1.16, 0.12], [x + 0.23, 1.16, 0.12], 0.012, webbing, g);
    part(`Buckle_${side}`, new BoxGeometry(0.07, 0.05, 0.016), brass, x, 1.165, 0.105, g);
    rod(`ShoulderBelt_${side}`, [x - 0.17, 1.78, 0.52], [x + 0.02, 1.17, 0.11], 0.01, webbing, g);
    const rest = part(`Footrest_${side}`, new BoxGeometry(0.34, 0.02, 0.2), rubber, x, 1.02, -0.74, g);
    rest.rotation.x = -0.55;
    rod(`ToeLoop_${side}`, [x - 0.15, 1.08, -0.67], [x + 0.15, 1.08, -0.67], 0.008, steel, g);
  }
}

function overhead(g: Group): void {
  part("OverheadConsole", new BoxGeometry(0.5, 0.05, 0.18), graphite, 0, 1.955, -0.95, g);
  for (let i = 0; i < 5; i++) {
    const x = -0.18 + i * 0.09;
    part(`OverheadSwitch_${i}`, new BoxGeometry(0.018, 0.02, 0.03), steel, x, 1.922, -0.95, g);
    part(`OverheadLed_${i}`, new BoxGeometry(0.01, 0.004, 0.01), i % 2 ? amber : green, x, 1.928, -1.0, g);
  }
  for (const [side, x] of [
    ["L", -0.68],
    ["R", 0.68],
  ] as const)
    for (const z of [-0.35, 0.3]) {
      rod(`Grab_${side}_${z}_a`, [x, 1.99, z - 0.09], [x, 1.9, z - 0.09], 0.011, rubber, g);
      rod(`Grab_${side}_${z}_b`, [x, 1.99, z + 0.09], [x, 1.9, z + 0.09], 0.011, rubber, g);
      rod(`Grab_${side}_${z}_c`, [x, 1.9, z - 0.09], [x, 1.9, z + 0.09], 0.013, rubber, g);
    }
  part("WindshieldCamera", new BoxGeometry(0.08, 0.05, 0.06), graphite, 0, 1.965, -1.23, g);
  const lens = part("WindshieldLens", new CylinderGeometry(0.016, 0.016, 0.02, 12), steel, 0, 1.965, -1.265, g);
  lens.rotation.x = Math.PI / 2;
}

const buf = readFileSync(BASE);
const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
const detail = new Group();
detail.name = "CockpitDetail";
navScreen(detail);
statusScreen(detail);
commsScreen(detail);
switchPanel(detail);
handController(detail);
seats(detail);
overhead(detail);
gltf.scene.add(detail);
const glb = await toGlb(gltf.scene);
for (const [dir, file] of [
  ["src/learn/walk/models", "improved_cockpit.glb"],
  ["../tools/models/out", "improved_cockpit_detailed.glb"],
]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${file}`, Buffer.from(glb));
}
let tris = 0;
gltf.scene.traverse((o) => {
  if (o instanceof Mesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position!.count) / 3;
});
console.log(`improved_cockpit.glb ${glb.byteLength} bytes, ${tris} triangles`);
