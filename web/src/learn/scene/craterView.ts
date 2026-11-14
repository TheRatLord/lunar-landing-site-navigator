import {
  AmbientLight,
  Group,
  BufferAttribute,
  BufferGeometry,
  Line,
  LineDashedMaterial,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Points,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { fetchTerrainPatch } from "../../api/site";
import { decodePatch } from "../../workspaces/site/terrain3d/patch";
import { clamp } from "../../lib/scale";
import { RAD, dirFromAzEl, skyAt, type Place } from "../geometry";
import { SITES } from "../sites";
import { horizonBins } from "./horizonBins";
import { Label, glowSprite, rng, starField } from "./textures";
import type { Pose } from "./tween";
import type { SceneFrame, Shared } from "./types";

export type CraterSource = "real" | "simplified";

const SIZE = 60;
const BINS = 36;
const REAL_N = 193;
const SYNTH_N = 128;
const R_MOON_KM = 1737.4;

function offsetKm(from: Place, to: Place): { x: number; z: number } {
  const unit = (p: Place) => [Math.cos(p.lat * RAD) * Math.cos(p.lon * RAD), Math.cos(p.lat * RAD) * Math.sin(p.lon * RAD), Math.sin(p.lat * RAD)];
  const p0 = unit(from);
  const p = unit(to);
  const c = p0[0]! * p[0]! + p0[1]! * p[1]! + p0[2]! * p[2]!;
  const east = [-Math.sin(from.lon * RAD), Math.cos(from.lon * RAD), 0];
  const north = [-Math.sin(from.lat * RAD) * Math.cos(from.lon * RAD), -Math.sin(from.lat * RAD) * Math.sin(from.lon * RAD), Math.cos(from.lat * RAD)];
  const e = east[0]! * p[0]! + east[1]! * p[1]!;
  const nn = north[0]! * p[0]! + north[1]! * p[1]! + north[2]! * p[2]!;
  const d = R_MOON_KM * Math.acos(clamp(c, -1, 1));
  const l = Math.hypot(e, nn) || 1;
  return { x: (d * e) / l, z: (-d * nn) / l };
}

const RIM = offsetKm(SITES.floor, SITES.rim);
const RIM_KM = Math.hypot(RIM.x, RIM.z);

interface Terrain {
  source: CraterSource;
  n: number;
  heights: Float32Array;
  bins: Float32Array | null;
}

function synthetic(): Terrain {
  const r = rng(17);
  const waves = Array.from({ length: 10 }, () => ({ kx: (r() - 0.5) * 2, kz: (r() - 0.5) * 2, p: r() * 6 }));
  const noise = (x: number, z: number) => {
    let s = 0;
    for (const w of waves) s += Math.sin(x * w.kx * 1.7 + z * w.kz * 1.7 + w.p);
    return s / 3;
  };
  const n = SYNTH_N;
  const cell = SIZE / (n - 1);
  const heights = new Float32Array(n * n);
  const hill = { x: (-RIM.x / RIM_KM) * 28, z: (-RIM.z / RIM_KM) * 28 };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -SIZE / 2 + i * cell;
      const z = -SIZE / 2 + j * cell;
      const rr = Math.hypot(x, z);
      let h = rr < RIM_KM ? -4.2 * (1 - (rr / RIM_KM) ** 2) + 0.25 * (rr / RIM_KM) ** 8 : 0.25 * Math.exp(-(((rr - RIM_KM) / 2) ** 2));
      h -= (rr * rr) / (2 * R_MOON_KM);
      h += 0.6 * Math.exp(-((x - hill.x) ** 2 + (z - hill.z) ** 2) / (2 * 3 * 3));
      h += noise(x, z) * 0.03;
      heights[j * n + i] = h;
    }
  }
  return { source: "simplified", n, heights, bins: null };
}

async function real(signal: AbortSignal): Promise<Terrain> {
  const { lat, lon } = SITES.floor;
  const patch = decodePatch(await fetchTerrainPatch({ lat, lon, size_m: SIZE * 1000, n: REAL_N }, signal));
  const n = patch.n;
  if (patch.nodata > n * n * 0.01) throw new Error("Terrain patch has too many gaps");
  const sp = patch.header.spacing_m / 1000;
  const e0 = patch.header.east_m[0] / 1000;
  const n0 = patch.header.north_m[0] / 1000;
  const r2 = 2 * ((patch.header.radius_m || R_MOON_KM * 1000) / 1000);
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const north = n0 - j * sp;
    for (let i = 0; i < n; i++) {
      const east = e0 + i * sp;
      const raw = patch.heights[j * n + i]!;
      heights[j * n + i] = (raw === raw ? raw : patch.min) / 1000 - (east * east + north * north) / r2;
    }
  }
  return { source: "real", n, heights, bins: null };
}

function binsInWorker(t: Terrain, cell: number, signal: AbortSignal): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./craterWorker.ts", import.meta.url), { type: "module" });
    } catch {
      resolve(horizonBins({ heights: t.heights, n: t.n, cell, bins: BINS, maxDist: SIZE * 0.6 }));
      return;
    }
    const stop = () => {
      worker.terminate();
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", stop, { once: true });
    worker.onmessage = (e: MessageEvent<Float32Array>) => {
      signal.removeEventListener("abort", stop);
      worker.terminate();
      resolve(e.data);
    };
    worker.onerror = (e) => {
      signal.removeEventListener("abort", stop);
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage({ heights: t.heights.slice(), n: t.n, cell, bins: BINS, maxDist: SIZE * 0.6 });
  });
}

export class CraterView {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(45, 1, 0.05, 600);
  readonly controls: OrbitControls;
  private readonly geo = new BufferGeometry();
  private readonly mesh: Mesh;
  private n = 2;
  private heights: Float32Array = new Float32Array(4);
  private normals: Float32Array = new Float32Array(12);
  private base: Float32Array = new Float32Array(4);
  private bins: Float32Array = new Float32Array(4 * BINS);
  private colors = new BufferAttribute(new Float32Array(12), 3);
  private rimWeight = new Float32Array(4);
  private dark = new Uint8Array(4);
  private readonly sun: Sprite;
  private readonly sunGlow: Sprite;
  private readonly stars: Points;
  private readonly rimPin: Sprite;
  private readonly floorPin: Sprite;
  private readonly rimLabel = new Label("Rim", { anchorY: -0.7, px: 16 });
  private readonly floorLabel = new Label("Floor", { anchorY: -0.7, px: 16 });
  private readonly distLabel = new Label(`about ${Math.round(RIM_KM)} km`, { px: 13, color: "#dfe2e8", bg: "rgba(5,6,10,0.55)" });
  private readonly line: Line;
  private readonly marks = new Group();
  private readonly abort = new AbortController();
  readonly labels: Label[] = [this.rimLabel, this.floorLabel, this.distLabel];
  phone = false;
  readonly rimPos = new Vector3(RIM.x, 0, RIM.z);
  readonly floorPos = new Vector3(0, -4.2, 0);
  private ready = false;
  private lastSun = "";
  private viewportH = 800;

  constructor(canvas: HTMLCanvasElement, shared: Shared, onTerrain: (source: CraterSource) => void) {
    this.mesh = new Mesh(this.geo, new MeshBasicMaterial({ vertexColors: true }));
    this.mesh.visible = false;
    this.scene.add(this.mesh);
    this.scene.add(new AmbientLight(0xffffff, 0.1));

    this.stars = starField(400);
    this.scene.add(this.stars);

    this.sun = new Sprite(new SpriteMaterial({ map: shared.disc, color: "#fff7e6", transparent: true }));
    this.sun.scale.setScalar(1.6);
    this.sunGlow = glowSprite(shared.glow, "#ffc96b", 0.95);
    this.sunGlow.scale.setScalar(16);
    this.scene.add(this.sunGlow, this.sun);

    const pinMat = () =>
      new SpriteMaterial({ map: shared.glow, color: "#ffc35c", transparent: true, depthTest: false, sizeAttenuation: false });
    this.rimPin = new Sprite(pinMat());
    this.floorPin = new Sprite(pinMat());
    this.rimPin.renderOrder = 8;
    this.floorPin.renderOrder = 8;
    this.rimLabel.sprite.material.depthTest = false;
    this.floorLabel.sprite.material.depthTest = false;
    this.distLabel.sprite.material.depthTest = false;
    this.line = new Line(
      new BufferGeometry(),
      new LineDashedMaterial({ color: 0xe6e8ee, dashSize: 0.5, gapSize: 0.35, transparent: true, opacity: 0.9, depthTest: false }),
    );
    this.line.renderOrder = 7;
    this.marks.add(this.rimPin, this.floorPin, this.rimLabel.sprite, this.floorLabel.sprite, this.line, this.distLabel.sprite);
    this.marks.visible = false;
    this.scene.add(this.marks);

    this.camera.position.set(6, 9, 25);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(this.pose(false).target);
    this.controls.enablePan = false;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 60;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.5;
    this.controls.enabled = false;

    void this.load(onTerrain);
  }

  private async load(onTerrain: (source: CraterSource) => void) {
    const signal = this.abort.signal;
    let t: Terrain;
    try {
      t = await real(signal);
      t.bins = await binsInWorker(t, SIZE / (t.n - 1), signal);
    } catch {
      if (signal.aborted) return;
      t = synthetic();
    }
    if (signal.aborted) return;
    this.apply(t);
    onTerrain(t.source);
  }

  private apply(t: Terrain) {
    const n = t.n;
    const cell = SIZE / (n - 1);
    const ref = this.sample(t.heights, n, RIM.x, RIM.z);
    const heights = t.heights.map((h) => h - ref);
    const bins = t.bins ?? horizonBins({ heights, n, cell, bins: BINS, maxDist: SIZE * 0.6 });
    const r = rng(23);
    const pos = new Float32Array(n * n * 3);
    const base = new Float32Array(n * n);
    const normals = new Float32Array(n * n * 3);
    const rimWeight = new Float32Array(n * n);
    const dark = new Uint8Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const x = -SIZE / 2 + i * cell;
        const z = -SIZE / 2 + j * cell;
        pos[k * 3] = x;
        pos[k * 3 + 1] = heights[k]!;
        pos[k * 3 + 2] = z;
        base[k] = (0.78 + (r() - 0.5) * 0.08) * clamp((29 - Math.hypot(x, z)) / 6, 0, 1);
        const hl = heights[j * n + Math.max(0, i - 1)]!;
        const hr = heights[j * n + Math.min(n - 1, i + 1)]!;
        const hd = heights[Math.max(0, j - 1) * n + i]!;
        const hu = heights[Math.min(n - 1, j + 1) * n + i]!;
        const nx = -(hr - hl) / (2 * cell);
        const nz = -(hu - hd) / (2 * cell);
        const l = Math.hypot(nx, 1, nz);
        normals[k * 3] = nx / l;
        normals[k * 3 + 1] = 1 / l;
        normals[k * 3 + 2] = nz / l;
        rimWeight[k] = clamp(1.6 - Math.hypot(x - RIM.x, z - RIM.z), 0, 1);
        let lowest = 90;
        for (let b = 0; b < BINS; b++) lowest = Math.min(lowest, bins[k * BINS + b]!);
        dark[k] = lowest > 2 ? 1 : 0;
      }
    }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let q = 0;
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        idx.set([a, a + n, a + 1, a + 1, a + n, a + n + 1], q);
        q += 6;
      }
    }
    this.n = n;
    this.heights = heights;
    this.normals = normals;
    this.base = base;
    this.bins = bins;
    this.rimWeight = rimWeight;
    this.dark = dark;
    this.colors = new BufferAttribute(new Float32Array(n * n * 3), 3);
    this.geo.setAttribute("position", new BufferAttribute(pos, 3));
    this.geo.setAttribute("color", this.colors);
    this.geo.setIndex(new BufferAttribute(idx, 1));
    this.geo.computeBoundingSphere();

    this.rimPos.y = this.sampleH(this.rimPos.x, this.rimPos.z) + 0.05;
    this.floorPos.y = this.sampleH(0, 0) + 0.05;
    this.rimPin.position.copy(this.rimPos);
    this.floorPin.position.copy(this.floorPos);
    this.rimLabel.sprite.position.copy(this.rimPos);
    this.floorLabel.sprite.position.copy(this.floorPos);
    this.line.geometry.setFromPoints([this.rimPos.clone().add(new Vector3(0, 0.15, 0)), this.floorPos.clone().add(new Vector3(0, 0.15, 0))]);
    this.line.computeLineDistances();
    this.distLabel.sprite.position.copy(this.rimPos).add(this.floorPos).multiplyScalar(0.5).add(new Vector3(0, 0.4, 0));
    this.mesh.visible = true;
    this.marks.visible = true;
    this.ready = true;
    this.lastSun = "";
  }

  private sample(h: Float32Array, n: number, x: number, z: number): number {
    const cell = SIZE / (n - 1);
    const fi = (x + SIZE / 2) / cell;
    const fj = (z + SIZE / 2) / cell;
    const i = clamp(Math.floor(fi), 0, n - 2);
    const j = clamp(Math.floor(fj), 0, n - 2);
    const u = fi - i;
    const v = fj - j;
    return (
      h[j * n + i]! * (1 - u) * (1 - v) +
      h[j * n + i + 1]! * u * (1 - v) +
      h[(j + 1) * n + i]! * (1 - u) * v +
      h[(j + 1) * n + i + 1]! * u * v
    );
  }

  private sampleH(x: number, z: number): number {
    return this.sample(this.heights, this.n, x, z);
  }

  update(f: SceneFrame, now: number) {
    const centre = skyAt(SITES.floor, f.d);
    const az = centre.sun.az;
    const el = centre.sun.el;
    const sv = dirFromAzEl(az, el);
    const dist = 85;
    this.sun.position.set(sv[0] * dist, sv[1] * dist, sv[2] * dist);
    this.sunGlow.position.copy(this.sun.position);
    const rimLit = skyAt(SITES.rim, f.d).sunlight;
    const key = `${az.toFixed(2)}|${el.toFixed(3)}|${rimLit.toFixed(2)}`;
    if (this.ready && key !== this.lastSun) {
      this.lastSun = key;
      const fb = az / (360 / BINS);
      const b0 = Math.floor(fb) % BINS;
      const b1 = (b0 + 1) % BINS;
      const u = fb - Math.floor(fb);
      const col = this.colors.array as Float32Array;
      for (let k = 0; k < this.n * this.n; k++) {
        const hz = this.bins[k * BINS + b0]! * (1 - u) + this.bins[k * BINS + b1]! * u;
        const own = clamp((el - hz) / 0.5 + 0.5, 0, 1);
        const w = this.rimWeight[k]!;
        const lit = own * (1 - w) + rimLit * w;
        const nd = this.normals[k * 3]! * sv[0] + this.normals[k * 3 + 1]! * sv[1] + this.normals[k * 3 + 2]! * sv[2];
        const c = this.dark[k] ? this.base[k]! * 0.006 : this.base[k]! * (0.03 + lit * (0.22 + 0.75 * Math.max(0, nd)));
        col[k * 3] = c;
        col[k * 3 + 1] = c;
        col[k * 3 + 2] = c * 1.02;
      }
      this.colors.needsUpdate = true;
    }
    const sel = f.site.id === "floor" ? "floor" : "rim";
    const unit = (2 * Math.tan((this.camera.fov * Math.PI) / 360)) / this.viewportH;
    const pulse = f.reducedMotion ? 1.15 : 1 + 0.25 * Math.sin(now / 240);
    this.rimPin.scale.setScalar(unit * (sel === "rim" ? 40 * pulse : 24));
    this.floorPin.scale.setScalar(unit * (sel === "floor" ? 40 * pulse : 24));
    this.rimPin.material.color.set(sel === "rim" ? "#ffffff" : "#7d838f");
    this.floorPin.material.color.set(sel === "floor" ? "#ffffff" : "#7d838f");
    this.distLabel.sprite.visible = !this.phone;
  }

  fitLabels(h: number) {
    this.viewportH = h;
    for (const l of this.labels) l.fit(h, this.camera.fov);
  }

  pose(phone: boolean): Pose {
    const az = Math.atan2(-RIM.x, RIM.z) + 40 * RAD;
    const R = phone ? 33 : 26;
    return {
      pos: new Vector3(Math.sin(az) * R, phone ? 12 : 9.5, -Math.cos(az) * R),
      target: new Vector3(RIM.x * 0.15, -1.8, RIM.z * 0.15),
      fov: 45,
    };
  }

  dispose() {
    this.abort.abort();
    this.controls.dispose();
    for (const l of this.labels) l.dispose();
  }
}
