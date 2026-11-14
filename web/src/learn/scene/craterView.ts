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
import { clamp } from "../../lib/scale";
import { RAD, dirFromAzEl, skyAt } from "../geometry";
import { SITES } from "../sites";
import { Label, arrow, glowSprite, rng, starField } from "./textures";
import type { Pose } from "./tween";
import type { SceneFrame, Shared } from "./types";

const N = 128;
const SIZE = 60;
const BINS = 36;
const RIM_R = 10.5;
const PIN_AZ = 300;

function heightAt(x: number, z: number, noise: (x: number, z: number) => number): number {
  const r = Math.hypot(x, z);
  let h: number;
  if (r < RIM_R) {
    h = -4.2 * (1 - (r / RIM_R) ** 2) + 0.25 * (r / RIM_R) ** 8;
  } else {
    h = 0.25 * Math.exp(-(((r - RIM_R) / 2) ** 2));
  }
  h -= (r * r) / (2 * 1737.4);
  const hx = Math.sin(PIN_AZ * RAD) * 28;
  const hz = -Math.cos(PIN_AZ * RAD) * 28;
  h += 0.6 * Math.exp(-((x - hx) ** 2 + (z - hz) ** 2) / (2 * 3 * 3));
  h += noise(x, z) * 0.03;
  return h;
}

export class CraterView {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(45, 1, 0.05, 600);
  readonly controls: OrbitControls;
  private readonly geo = new BufferGeometry();
  private readonly heights = new Float32Array(N * N);
  private readonly normals = new Float32Array(N * N * 3);
  private readonly base = new Float32Array(N * N);
  private readonly bins = new Float32Array(N * N * BINS);
  private readonly colors: BufferAttribute;
  private readonly sun: Sprite;
  private readonly sunGlow: Sprite;
  private readonly stars: Points;
  private readonly rimPin: Sprite;
  private readonly floorPin: Sprite;
  private readonly rimLabel = new Label("Rim", { anchorY: -0.7, px: 16 });
  private readonly floorLabel = new Label("Floor", { anchorY: -0.7, px: 16 });
  private readonly distLabel = new Label("about 11 km", { px: 13, color: "#dfe2e8", bg: "rgba(5,6,10,0.55)" });
  private readonly rays = new Group();
  readonly labels: Label[] = [this.rimLabel, this.floorLabel, this.distLabel];
  private readonly rimWeight = new Float32Array(N * N);
  private readonly dark = new Uint8Array(N * N);
  phone = false;
  readonly rimPos: Vector3;
  readonly floorPos: Vector3;
  private lastSun = "";
  private viewportH = 800;

  constructor(canvas: HTMLCanvasElement, shared: Shared) {
    const r = rng(17);
    const waves = Array.from({ length: 10 }, () => ({ kx: (r() - 0.5) * 2, kz: (r() - 0.5) * 2, p: r() * 6 }));
    const noise = (x: number, z: number) => {
      let s = 0;
      for (const w of waves) s += Math.sin(x * w.kx * 1.7 + z * w.kz * 1.7 + w.p);
      return s / 3;
    };
    const pos = new Float32Array(N * N * 3);
    const cell = SIZE / (N - 1);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = -SIZE / 2 + i * cell;
        const z = -SIZE / 2 + j * cell;
        const h = heightAt(x, z, noise);
        const k = j * N + i;
        this.heights[k] = h;
        pos[k * 3] = x;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = z;
        const rr = Math.hypot(x, z);
        const fade = clamp((29 - rr) / 6, 0, 1);
        this.base[k] = (0.78 + (r() - 0.5) * 0.08) * fade;
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const hl = this.heights[j * N + Math.max(0, i - 1)]!;
        const hr = this.heights[j * N + Math.min(N - 1, i + 1)]!;
        const hd = this.heights[Math.max(0, j - 1) * N + i]!;
        const hu = this.heights[Math.min(N - 1, j + 1) * N + i]!;
        const nx = -(hr - hl) / (2 * cell);
        const nz = -(hu - hd) / (2 * cell);
        const l = Math.hypot(nx, 1, nz);
        this.normals[k * 3] = nx / l;
        this.normals[k * 3 + 1] = 1 / l;
        this.normals[k * 3 + 2] = nz / l;
      }
    }
    this.computeBins(cell);
    const rx = Math.sin(PIN_AZ * RAD) * RIM_R;
    const rz = -Math.cos(PIN_AZ * RAD) * RIM_R;
    for (let k = 0; k < N * N; k++) {
      const x = pos[k * 3]!;
      const z = pos[k * 3 + 2]!;
      this.rimWeight[k] = clamp(1.6 - Math.hypot(x - rx, z - rz), 0, 1);
      let lowest = 90;
      for (let b = 0; b < BINS; b++) lowest = Math.min(lowest, this.bins[k * BINS + b]!);
      this.dark[k] = lowest > 2 ? 1 : 0;
    }
    const idx: number[] = [];
    for (let j = 0; j < N - 1; j++) {
      for (let i = 0; i < N - 1; i++) {
        const a = j * N + i;
        idx.push(a, a + N, a + 1, a + 1, a + N, a + N + 1);
      }
    }
    this.geo.setAttribute("position", new BufferAttribute(pos, 3));
    this.colors = new BufferAttribute(new Float32Array(N * N * 3), 3);
    this.geo.setAttribute("color", this.colors);
    this.geo.setIndex(idx);
    this.scene.add(new Mesh(this.geo, new MeshBasicMaterial({ vertexColors: true })));
    this.scene.add(new AmbientLight(0xffffff, 0.1));

    this.stars = starField(400);
    this.scene.add(this.stars);

    this.sun = new Sprite(new SpriteMaterial({ map: shared.disc, color: "#fff7e6", transparent: true }));
    this.sun.scale.setScalar(1.6);
    this.sunGlow = glowSprite(shared.glow, "#ffc96b", 0.95);
    this.sunGlow.scale.setScalar(16);
    this.scene.add(this.sunGlow, this.sun);

    this.rimPos = new Vector3(Math.sin(PIN_AZ * RAD) * RIM_R, 0, -Math.cos(PIN_AZ * RAD) * RIM_R);
    this.rimPos.y = this.sampleH(this.rimPos.x, this.rimPos.z) + 0.05;
    this.floorPos = new Vector3(0, this.sampleH(0, 0) + 0.05, 0);
    const pinMat = () =>
      new SpriteMaterial({ map: shared.glow, color: "#ffc35c", transparent: true, depthTest: false, sizeAttenuation: false });
    this.rimPin = new Sprite(pinMat());
    this.floorPin = new Sprite(pinMat());
    this.rimPin.position.copy(this.rimPos);
    this.floorPin.position.copy(this.floorPos);
    this.rimPin.renderOrder = 8;
    this.floorPin.renderOrder = 8;
    this.rimLabel.sprite.position.copy(this.rimPos);
    this.floorLabel.sprite.position.copy(this.floorPos);
    this.rimLabel.sprite.material.depthTest = false;
    this.floorLabel.sprite.material.depthTest = false;
    this.distLabel.sprite.material.depthTest = false;
    this.scene.add(this.rimPin, this.floorPin, this.rimLabel.sprite, this.floorLabel.sprite);

    const lg = new BufferGeometry().setFromPoints([
      this.rimPos.clone().add(new Vector3(0, 0.15, 0)),
      this.floorPos.clone().add(new Vector3(0, 0.15, 0)),
    ]);
    const line = new Line(
      lg,
      new LineDashedMaterial({ color: 0xe6e8ee, dashSize: 0.5, gapSize: 0.35, transparent: true, opacity: 0.9, depthTest: false }),
    );
    line.computeLineDistances();
    line.renderOrder = 7;
    this.distLabel.sprite.position.copy(this.rimPos).add(this.floorPos).multiplyScalar(0.5).add(new Vector3(0, 0.4, 0));
    this.scene.add(line, this.distLabel.sprite);

    for (const y of [3.5, 5, 6.5]) {
      const a = arrow(6, 1.4, 1, 0xffb627);
      a.position.set(-9, y, 0);
      this.rays.add(a);
    }
    this.scene.add(this.rays);

    this.camera.position.set(6, 9, 25);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(-2, -1.5, -1);
    this.controls.enablePan = false;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 60;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.5;
    this.controls.enabled = false;
  }

  private sampleH(x: number, z: number): number {
    const cell = SIZE / (N - 1);
    const fi = (x + SIZE / 2) / cell;
    const fj = (z + SIZE / 2) / cell;
    const i = clamp(Math.floor(fi), 0, N - 2);
    const j = clamp(Math.floor(fj), 0, N - 2);
    const u = fi - i;
    const v = fj - j;
    const h = this.heights;
    return (
      h[j * N + i]! * (1 - u) * (1 - v) +
      h[j * N + i + 1]! * u * (1 - v) +
      h[(j + 1) * N + i]! * (1 - u) * v +
      h[(j + 1) * N + i + 1]! * u * v
    );
  }

  private computeBins(cell: number) {
    const steps = 48;
    const stepKm = 0.6;
    const offI = new Float32Array(BINS * steps);
    const offJ = new Float32Array(BINS * steps);
    for (let b = 0; b < BINS; b++) {
      const az = b * 10 * RAD;
      for (let s = 0; s < steps; s++) {
        const dist = (s + 1) * stepKm;
        offI[b * steps + s] = (Math.sin(az) * dist) / cell;
        offJ[b * steps + s] = (-Math.cos(az) * dist) / cell;
      }
    }
    const h = this.heights;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const h0 = h[k]!;
        for (let b = 0; b < BINS; b++) {
          let best = -90;
          for (let s = 0; s < steps; s++) {
            const fi = i + offI[b * steps + s]!;
            const fj = j + offJ[b * steps + s]!;
            if (fi < 0 || fj < 0 || fi > N - 1.001 || fj > N - 1.001) break;
            const ii = fi | 0;
            const jj = fj | 0;
            const u = fi - ii;
            const v = fj - jj;
            const q = jj * N + ii;
            const hh = (h[q]! * (1 - u) + h[q + 1]! * u) * (1 - v) + (h[q + N]! * (1 - u) + h[q + N + 1]! * u) * v;
            const ang = Math.atan2(hh - h0, (s + 1) * stepKm) / RAD;
            if (ang > best) best = ang;
          }
          this.bins[k * BINS + b] = best;
        }
      }
    }
  }

  update(f: SceneFrame, now: number) {
    const rim = skyAt(SITES.rim, f.d);
    const az = rim.sun.az;
    const el = rim.sun.el;
    const sv = dirFromAzEl(az, el);
    const dist = 85;
    this.sun.position.set(sv[0] * dist, sv[1] * dist, sv[2] * dist);
    this.sunGlow.position.copy(this.sun.position);
    this.rays.rotation.y = Math.atan2(sv[2], -sv[0]);
    const rimLit = rim.sunlight;
    const key = `${az.toFixed(2)}|${el.toFixed(3)}|${rimLit.toFixed(2)}`;
    if (key !== this.lastSun) {
      this.lastSun = key;
      const fb = az / 10;
      const b0 = Math.floor(fb) % BINS;
      const b1 = (b0 + 1) % BINS;
      const u = fb - Math.floor(fb);
      const col = this.colors.array as Float32Array;
      for (let k = 0; k < N * N; k++) {
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

  pose(phone: boolean, d: number): Pose {
    const az = (skyAt(SITES.rim, d).sun.az - 60) * RAD;
    const R = phone ? 33 : 26;
    return {
      pos: new Vector3(Math.sin(az) * R, phone ? 12 : 9.5, -Math.cos(az) * R),
      target: new Vector3(-1.5, -1.8, -1),
      fov: 45,
    };
  }

  dispose() {
    this.controls.dispose();
    for (const l of this.labels) l.dispose();
  }
}
