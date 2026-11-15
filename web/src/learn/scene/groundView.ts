import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  Line,
  LineDashedMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Points,
} from "three";
import { clamp, wrap180, wrap360 } from "../../lib/scale";
import { RAD, dirFromAzEl, skyAt } from "../geometry";
import type { Site } from "../sites";
import { heightAt, type GroundPatch, type RealSite } from "../terrain";
import { detailHeight, lunarSoil, regolithAlbedo, regolithNormalMap, rockColorMap, rockGeometry, rockNormalMap } from "./surface";
import { Label, glowSprite, rng, starField } from "./textures";
import type { SceneFrame, Shared } from "./types";
import { blueGhostLander } from "../walk/props/blueghost";

const EYE = 1.7;
const R_GROUND = 300;
const R_SKIRT = 450;
const R_SUN = 490;
const R_EARTH = 480;
const R_DOME = 470;
/**
 * Real-terrain ground mesh: log-spaced rings from 0.3 m to R_GROUND, so cells are about 2.5 % of their distance
 * (25 cm at 10 m, 7 m at 300 m) and the procedural craters near the observer are resolved.
 */
const REAL_R0 = 0.3;
const REAL_SEGS = 256;
const REAL_Q = 1 + (2 * Math.PI) / REAL_SEGS;
const REAL_RINGS = Math.ceil(Math.log(R_GROUND / REAL_R0) / Math.log(REAL_Q));
const N_ROCKS = 150;
const N_ROCK_SHAPES = 8;
/** Albedo scale of the real ground so a sun-facing slope reads bright under the scene's light (Lambert divides by pi). */
const REAL_ALBEDO = 1.6;
const AZ_N = 720;
const LANDER_M = 16;
const SEGS = 180;

interface Rock {
  mesh: Mesh;
  shadow: Mesh;
  size: number;
  x: number;
  z: number;
}

interface Bump {
  x: number;
  z: number;
  s: number;
  h: number;
}

interface Look {
  yaw: number;
  pitch: number;
}

export class GroundView {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.1, 2500);
  readonly insetCamera = new PerspectiveCamera(70, 1, 0.1, 2500);
  private readonly light = new DirectionalLight(0xffffff, 3);
  private readonly ambient = new AmbientLight(0xffffff, 0.05);
  private readonly groundMat: MeshBasicMaterial;
  private readonly groundGeo: BufferGeometry;
  private readonly bumps: Bump[];
  private readonly edgeDrop = new Float32Array(AZ_N);
  private readonly skirtGeo = new BufferGeometry();
  private readonly skirtMat = new MeshLambertMaterial({ color: 0x2a2b30, side: DoubleSide });
  private readonly lineGeo = new BufferGeometry();
  private readonly lineMat = new MeshBasicMaterial({ color: 0xa9aebb, side: DoubleSide, transparent: true, opacity: 0.85 });
  private readonly sunDisc: Sprite;
  private readonly sunGlow: Sprite;
  private readonly earth: Mesh;
  private readonly earthRing: Sprite;
  private readonly stars: Points;
  private readonly rocks: Rock[] = [];
  private readonly sunLabel = new Label("Sun", { anchorY: -1.1, color: "#ffd98a" });
  private readonly earthLabel = new Label("Earth", { anchorY: -0.9, color: "#bcd9ff" });
  private readonly cardinals: Label[] = [];
  readonly labels: Label[] = [];
  private readonly trail: Line;
  private readonly earthMat: ShaderMaterial;
  private trailKey = "";
  private trailStart = 0;
  private trailStep = 1 / 12;
  private readonly pathGroup = new Group();
  private readonly pathAbove: Mesh;
  private readonly pathBelow: Mesh;
  private pathKey = "";
  private pathD = Number.NaN;
  private horizonKey = "";
  private readonly simGround: Mesh;
  private readonly realMat: MeshLambertMaterial;
  private realGround: Mesh | null = null;
  private patch: GroundPatch | null = null;
  private detail0 = 0;
  private relief: [number, number] = [0, 0];
  private readonly lander = blueGhostLander();

  look: Look = { yaw: 90, pitch: 10 };
  inset: Look = { yaw: 90, pitch: 10 };
  free = false;
  target: Look = { yaw: 90, pitch: 10 };
  insetTarget: Look = { yaw: 90, pitch: 10 };
  frame: SceneFrame | null = null;
  phone = false;

  constructor(shared: Shared) {
    const s = this.scene;
    this.stars = starField(1200);
    s.add(this.stars);
    s.add(this.light, this.light.target, this.ambient);
    this.lander.visible = false;
    this.lander.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    s.add(this.lander);

    const br = rng(9);
    this.bumps = Array.from({ length: 30 }, () => ({
      x: (br() - 0.5) * 500,
      z: (br() - 0.5) * 500,
      s: 8 + br() * 40,
      h: (br() - 0.5) * 0.8,
    }));
    this.groundGeo = this.buildGround();
    this.groundMat = new MeshBasicMaterial({ map: shared.regolith, color: 0x777777 });
    this.simGround = new Mesh(this.groundGeo, this.groundMat);
    s.add(this.simGround);
    // Real ground: UVs are metres, so the albedo tiles every 10 m and the bump texture every 3 m.
    const albedo = regolithAlbedo();
    albedo.repeat.set(1 / 7, 1 / 7);
    this.realMat = lunarSoil(new MeshLambertMaterial({ map: albedo, normalMap: regolithNormalMap(3) }));
    this.realMat.normalScale.set(1.6, 1.6);
    this.realMat.color.setScalar(REAL_ALBEDO);

    // Cast shadows from the Sun on the real ground: a tight orthographic box around the 600 m disc, sized in
    // update() from the Sun's elevation. normalBias of about one shadow texel stops acne at grazing light.
    this.light.shadow.mapSize.set(4096, 2048);
    this.light.shadow.bias = -0.0002;
    this.light.shadow.radius = 2;
    this.light.shadow.normalBias = 0.3;

    this.skirtGeo.setAttribute("position", new BufferAttribute(new Float32Array(AZ_N * 2 * 3 + 6), 3));
    this.skirtGeo.setIndex(this.stripIndex());
    s.add(new Mesh(this.skirtGeo, this.skirtMat));
    this.lineGeo.setAttribute("position", new BufferAttribute(new Float32Array(AZ_N * 2 * 3 + 6), 3));
    this.lineGeo.setIndex(this.stripIndex());
    const line = new Mesh(this.lineGeo, this.lineMat);
    line.renderOrder = 2;
    s.add(line);

    const r = rng(21);
    const shapes = Array.from({ length: N_ROCK_SHAPES }, (_, i) => rockGeometry(31 + i));
    const shadowGeo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0);
    const shadowMat = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.72, depthWrite: false });
    const rockMap = rockColorMap();
    const rockNormal = rockNormalMap();
    for (let i = 0; i < N_ROCKS; i++) {
      // Many small stones, few boulders; most of them close, where they can be seen.
      const dist = 3 + r() ** 1.8 * 140;
      const az = r() * 360;
      // Boulders stay a few metres off so none of them fills the view.
      const size = Math.min(0.06 + r() ** 3.2 * 1.3, 0.12 + dist * 0.05);
      const mat = lunarSoil(new MeshLambertMaterial({ map: rockMap, normalMap: rockNormal }));
      mat.color.setScalar(1.1 + (r() - 0.5) * 0.5);
      mat.normalScale.set(0.6, 0.6);
      const mesh = new Mesh(shapes[i % N_ROCK_SHAPES]!, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const x = Math.sin(az * RAD) * dist;
      const z = -Math.cos(az * RAD) * dist;
      const sy = 0.5 + r() * 0.4;
      mesh.userData.base = size * sy * 0.22;
      mesh.scale.set(size * (0.8 + r() * 0.4), size * sy, size * (0.7 + r() * 0.5));
      mesh.rotation.set((r() - 0.5) * 0.5, r() * Math.PI * 2, (r() - 0.5) * 0.5);
      const shadow = new Mesh(shadowGeo, shadowMat);
      s.add(mesh, shadow);
      this.rocks.push({ mesh, shadow, size, x, z });
    }

    this.sunDisc = new Sprite(new SpriteMaterial({ map: shared.disc, color: "#fff7e6", transparent: true }));
    this.sunGlow = glowSprite(shared.glow, "#ffc96b", 0.9);
    this.sunGlow.material.depthTest = true;
    this.sunGlow.renderOrder = 3;
    s.add(this.sunGlow, this.sunDisc);

    this.earthMat = new ShaderMaterial({
      uniforms: { map: { value: shared.earth }, sunDir: { value: new Vector3(1, 0, 0) } },
      vertexShader:
        "varying vec2 vUv; varying vec3 vN; void main() { vUv = uv; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader:
        "uniform sampler2D map; uniform vec3 sunDir; varying vec2 vUv; varying vec3 vN; void main() { vec3 c = texture2D(map, vUv).rgb; float l = max(dot(normalize(vN), sunDir), 0.0); gl_FragColor = vec4(c * (0.05 + 1.3 * l), 1.0);\n#include <colorspace_fragment>\n}",
    });
    this.earth = new Mesh(new SphereGeometry(1, 48, 24), this.earthMat);
    this.earthRing = new Sprite(
      new SpriteMaterial({ map: shared.ring, color: "#5aa8ff", transparent: true, opacity: 0.5, depthWrite: false }),
    );
    s.add(this.earth, this.earthRing);

    const trailGeo = new BufferGeometry();
    trailGeo.setAttribute("position", new BufferAttribute(new Float32Array(3), 3));
    this.trail = new Line(
      trailGeo,
      new LineDashedMaterial({ color: 0x9cc6ff, dashSize: 0.9, gapSize: 1.4, transparent: true, opacity: 0.45 }),
    );
    this.trail.frustumCulled = false;
    s.add(this.trail);

    this.pathAbove = new Mesh(
      new BufferGeometry(),
      new MeshBasicMaterial({ color: 0xffb627, transparent: true, opacity: 0.85, side: DoubleSide, depthWrite: false }),
    );
    this.pathBelow = new Mesh(
      new BufferGeometry(),
      new MeshBasicMaterial({
        color: 0xffb627,
        transparent: true,
        opacity: 0.22,
        side: DoubleSide,
        depthWrite: false,
      }),
    );
    this.pathAbove.frustumCulled = false;
    this.pathBelow.frustumCulled = false;
    this.pathGroup.add(this.pathAbove, this.pathBelow);
    s.add(this.pathGroup);

    s.add(this.sunLabel.sprite, this.earthLabel.sprite);
    for (const [txt, az] of [
      ["N", 0],
      ["E", 90],
      ["S", 180],
      ["W", 270],
    ] as const) {
      const l = new Label(txt, { px: 13, color: "#c9ccd4", bg: "rgba(5,6,10,0.5)", anchorY: 0 });
      l.sprite.userData.az = az;
      this.cardinals.push(l);
      s.add(l.sprite);
    }
    this.labels.push(this.sunLabel, this.earthLabel, ...this.cardinals);
  }

  private stripIndex(): number[] {
    const idx: number[] = [];
    for (let i = 0; i < AZ_N; i++) {
      const a = i * 2;
      const b = a + 2;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    return idx;
  }

  private bumpAt(x: number, z: number): number {
    const rad = Math.hypot(x, z);
    if (rad >= R_GROUND - 1e-6) return 0;
    let y = 0;
    for (const b of this.bumps) y += b.h * Math.exp(-((x - b.x) ** 2 + (z - b.z) ** 2) / (b.s * b.s));
    return y * Math.min(1, rad / 40);
  }

  private dropAt(x: number, z: number): number {
    const f = (wrap360(Math.atan2(x, -z) / RAD) / 360) * AZ_N;
    const i = Math.floor(f) % AZ_N;
    const u = f - Math.floor(f);
    const edge = this.edgeDrop[i]! * (1 - u) + this.edgeDrop[(i + 1) % AZ_N]! * u;
    return ((x * x + z * z) / (R_GROUND * R_GROUND)) * edge;
  }

  private groundAt(x: number, z: number): number {
    return this.patch ? this.groundY(x, z) : this.bumpAt(x, z) + this.dropAt(x, z);
  }

  private buildGround(): BufferGeometry {
    const rings = 40;
    const segs = SEGS;
    const pos: number[] = [0, 0, 0];
    const uv: number[] = [0.5, 0.5];
    for (let i = 1; i <= rings; i++) {
      const rad = R_GROUND * (i / rings) ** 1.7;
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const x = Math.cos(a) * rad;
        const z = Math.sin(a) * rad;
        pos.push(x, i < rings ? this.bumpAt(x, z) : 0, z);
        uv.push(0.5 + x / (2 * R_GROUND), 0.5 - z / (2 * R_GROUND));
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
    for (let i = 1; i < rings; i++) {
      const a0 = 1 + (i - 1) * segs;
      const b0 = 1 + i * segs;
      for (let j = 0; j < segs; j++) {
        const j1 = (j + 1) % segs;
        idx.push(a0 + j, a0 + j1, b0 + j, a0 + j1, b0 + j1, b0 + j);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
    g.setIndex(idx);
    return g;
  }

  /** Ground height (m, scene y) at scene (x, z): the real patch plus the procedural detail, zero under the observer. */
  private groundY(x: number, z: number): number {
    const p = this.patch;
    if (!p) return 0;
    return heightAt(p, x, -z) + detailHeight(x, -z) - this.detail0;
  }

  /** Ground mesh from the LOLA/PGDA patch plus sub-pixel detail, on log-spaced rings around the observer. */
  private buildRealGround(): BufferGeometry {
    const pos: number[] = [0, this.groundY(0, 0), 0];
    const uv: number[] = [0, 0];
    for (let i = 0; i < REAL_RINGS; i++) {
      const rad = Math.min(R_GROUND, REAL_R0 * REAL_Q ** i);
      const twist = (i % 2) * 0.5;
      for (let j = 0; j < REAL_SEGS; j++) {
        const a = ((j + twist) / REAL_SEGS) * Math.PI * 2;
        const x = Math.cos(a) * rad;
        const z = Math.sin(a) * rad;
        pos.push(x, this.groundY(x, z), z);
        uv.push(x, -z);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < REAL_SEGS; j++) idx.push(0, 1 + ((j + 1) % REAL_SEGS), 1 + j);
    for (let i = 1; i < REAL_RINGS; i++) {
      const a0 = 1 + (i - 1) * REAL_SEGS;
      const b0 = 1 + i * REAL_SEGS;
      for (let j = 0; j < REAL_SEGS; j++) {
        const j1 = (j + 1) % REAL_SEGS;
        idx.push(a0 + j, a0 + j1, b0 + j, a0 + j1, b0 + j1, b0 + j);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  private setTerrain(site: RealSite) {
    const p = site.terrain?.patch ?? null;
    this.patch = p;
    this.detail0 = p ? detailHeight(0, 0) : 0;
    if (p) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of p.heights) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      this.relief = [lo, hi];
    }
    if (this.realGround) {
      this.scene.remove(this.realGround);
      this.realGround.geometry.dispose();
      this.realGround = null;
    }
    if (p) {
      this.realGround = new Mesh(this.buildRealGround(), this.realMat);
      this.realGround.receiveShadow = true;
      this.realGround.castShadow = true;
      this.scene.add(this.realGround);
    }
    this.simGround.visible = !p;
  }

  /** Point the shadow camera along the Sun and fit its box to the ground disc (thin, because the Sun is low). */
  private fitShadow(sunVec: Vector3, on: boolean) {
    this.light.castShadow = on;
    if (!on || !this.patch) return;
    const D = 900;
    this.light.position.copy(sunVec).multiplyScalar(D);
    this.light.target.position.set(0, 0, 0);
    this.light.target.updateMatrixWorld();
    const [lo, hi] = this.relief;
    const sinEl = Math.abs(sunVec.y);
    const cosEl = Math.sqrt(Math.max(0, 1 - sinEl * sinEl));
    const reach = R_GROUND * 1.05;
    const cam = this.light.shadow.camera;
    cam.left = -reach;
    cam.right = reach;
    cam.top = Math.min(reach, hi * cosEl + reach * sinEl + 4);
    cam.bottom = Math.max(-reach, lo * cosEl - reach * sinEl - 4);
    cam.near = D - reach - Math.max(Math.abs(lo), Math.abs(hi)) - 10;
    cam.far = D + reach + Math.max(Math.abs(lo), Math.abs(hi)) + 10;
    cam.updateProjectionMatrix();
  }

  private buildHorizon(site: Site) {
    for (let i = 0; i < AZ_N; i++) {
      let lo = Infinity;
      for (let k = -8; k <= 8; k++) lo = Math.min(lo, site.horizon(((i + k) / AZ_N) * 360));
      this.edgeDrop[i] = Math.min(0, EYE + R_GROUND * Math.tan(lo * RAD) - 0.3);
    }
    const gp = this.groundGeo.getAttribute("position") as BufferAttribute;
    for (let v = 0; v < gp.count; v++) {
      const x = gp.getX(v);
      const z = gp.getZ(v);
      gp.setY(v, this.bumpAt(x, z) + this.dropAt(x, z));
    }
    gp.needsUpdate = true;
    this.groundGeo.computeBoundingSphere();
    for (const rk of this.rocks) {
      const y = this.groundAt(rk.x, rk.z);
      rk.mesh.position.set(rk.x, y + (this.patch ? (rk.mesh.userData.base as number) : rk.size * 0.3), rk.z);
      rk.shadow.position.set(rk.x, y + 0.03, rk.z);
    }
    const sk = this.skirtGeo.getAttribute("position") as BufferAttribute;
    const ln = this.lineGeo.getAttribute("position") as BufferAttribute;
    for (let i = 0; i <= AZ_N; i++) {
      const az = (i / AZ_N) * 360;
      const sx = Math.sin(az * RAD);
      const sz = -Math.cos(az * RAD);
      const top = EYE + R_SKIRT * Math.tan(site.horizon(az) * RAD);
      sk.setXYZ(i * 2, sx * R_GROUND, this.patch ? this.groundY(sx * R_GROUND, sz * R_GROUND) : this.edgeDrop[i % AZ_N]!, sz * R_GROUND);
      sk.setXYZ(i * 2 + 1, sx * R_SKIRT, top, sz * R_SKIRT);
      const rr = R_SKIRT - 1;
      const th = 0.55;
      ln.setXYZ(i * 2, sx * rr, top - th, sz * rr);
      ln.setXYZ(i * 2 + 1, sx * rr, top + th * 0.4, sz * rr);
    }
    sk.needsUpdate = true;
    ln.needsUpdate = true;
    this.skirtGeo.computeVertexNormals();
    this.skirtGeo.computeBoundingSphere();
    this.lineGeo.computeBoundingSphere();
  }

  private buildTrail(f: SceneFrame) {
    const step = 1 / 12;
    const start = f.epochD - 30;
    const n = Math.ceil((f.spanDays + 30) / step) + 1;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const s = skyAt(f.site, start + i * step, f.lat);
      const v = dirFromAzEl(s.earth.az, s.earth.el);
      arr[i * 3] = v[0] * R_DOME;
      arr[i * 3 + 1] = v[1] * R_DOME + EYE;
      arr[i * 3 + 2] = v[2] * R_DOME;
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(arr, 3));
    this.trail.geometry.dispose();
    this.trail.geometry = g;
    this.trail.computeLineDistances();
    this.trailStart = start;
    this.trailStep = step;
  }

  private buildPath(f: SceneFrame) {
    const above: number[] = [];
    const below: number[] = [];
    const pts: { p: Vector3; up: boolean }[] = [];
    for (let k = -14.77; k <= 14.77 + 1e-9; k += 0.125) {
      const s = skyAt(f.site, f.d + k, f.lat);
      const v = dirFromAzEl(s.sun.az, s.sun.el);
      pts.push({
        p: new Vector3(v[0] * R_DOME, v[1] * R_DOME + EYE, v[2] * R_DOME),
        up: s.sun.el > s.sun.horizonEl,
      });
    }
    const w = R_DOME * Math.tan(0.22 * RAD);
    const side = new Vector3();
    const tan = new Vector3();
    const out = new Vector3();
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      tan.subVectors(b.p, a.p);
      out.copy(a.p).normalize();
      side.crossVectors(tan, out).normalize().multiplyScalar(w);
      const list = a.up && b.up ? above : below;
      const a1 = a.p.clone().add(side);
      const a2 = a.p.clone().sub(side);
      const b1 = b.p.clone().add(side);
      const b2 = b.p.clone().sub(side);
      list.push(a1.x, a1.y, a1.z, a2.x, a2.y, a2.z, b1.x, b1.y, b1.z, a2.x, a2.y, a2.z, b2.x, b2.y, b2.z, b1.x, b1.y, b1.z);
    }
    this.pathAbove.geometry.dispose();
    this.pathBelow.geometry.dispose();
    const ga = new BufferGeometry();
    ga.setAttribute("position", new BufferAttribute(new Float32Array(above), 3));
    const gb = new BufferGeometry();
    gb.setAttribute("position", new BufferAttribute(new Float32Array(below), 3));
    this.pathAbove.geometry = ga;
    this.pathBelow.geometry = gb;
    this.pathD = f.d;
  }

  basePitch(cam: PerspectiveCamera): number {
    return Math.atan(0.3 * Math.tan((cam.fov * RAD) / 2)) / RAD;
  }

  private followPitch(cam: PerspectiveCamera, el: number, mode: "sun" | "earth" | "flat" | "zoom" = "sun"): number {
    const base = this.basePitch(cam);
    const half = cam.fov / 2;
    if (mode === "zoom") return el;
    if (mode === "flat") return base;
    const cap = Math.atan((this.phone ? 0.6 : 0.45) * Math.tan(half * RAD)) / RAD;
    if (mode === "earth") {
      const p = Math.atan(0.58 * Math.tan(half * RAD)) / RAD;
      return clamp(el > p + half - 8 ? el - half + 10 : p, base, p);
    }
    if (el < base + half - 9) return base;
    return clamp(el - half + 12, base, cap);
  }

  eclipseZoom(f: SceneFrame): boolean {
    return f.chapter === "timing" && f.view === "ground" && f.follow !== "free" && f.sky.sepDeg < 1.6 && f.sky.sun.el > 0;
  }

  update(f: SceneFrame) {
    this.frame = f;
    const sky = f.sky;
    const site = f.site as RealSite;
    const key = `${site.id}|${site.terrain ? "dem" : "sim"}`;
    if (key !== this.horizonKey) {
      this.horizonKey = key;
      this.setTerrain(site);
      this.buildHorizon(site);
    }
    const sunV = dirFromAzEl(sky.sun.az, sky.sun.el);
    const sunVec = new Vector3(sunV[0], sunV[1], sunV[2]);
    this.sunDisc.position.copy(sunVec).multiplyScalar(R_SUN).setY(sunV[1] * R_SUN + EYE);
    const rs = R_SUN * Math.tan(sky.sun.radius * RAD);
    this.sunDisc.scale.setScalar(rs * 2);
    this.sunGlow.position.copy(this.sunDisc.position);
    this.sunGlow.scale.setScalar(rs * 2 * 8);
    this.sunGlow.material.opacity = 0.9 * (1 - sky.eclipsed * 0.95);
    this.sunLabel.sprite.position.copy(this.sunDisc.position);

    const eV = dirFromAzEl(sky.earth.az, sky.earth.el);
    const re = R_EARTH * Math.tan(sky.earth.radius * RAD) * (f.chapter === "earth" ? 3 : 1);
    this.earth.position.set(eV[0] * R_EARTH, eV[1] * R_EARTH + EYE, eV[2] * R_EARTH);
    this.earth.scale.setScalar(re);
    this.earth.rotation.set(0, f.d * 2 * Math.PI * 1.0027, 0.41);
    (this.earthMat.uniforms.sunDir!.value as Vector3).copy(sunVec);
    this.earthLabel.sprite.position.copy(this.earth.position);
    const ringOn = sky.sepDeg < sky.sun.radius + sky.earth.radius + 0.6 && sky.sun.el > -2 ? 1 : 0;
    this.earthRing.position.copy(this.earth.position).multiplyScalar(0.999);
    this.earthRing.scale.setScalar(re * 2 * 1.32);
    const red = ringOn * clamp(1 - (sky.sepDeg - sky.earth.radius) / 1.2, 0, 1);
    this.earthRing.material.color.set(red > 0.05 ? "#ff7a3d" : "#5aa8ff");
    this.earthRing.material.opacity = red > 0.05 ? 0.95 * red : 0.45;
    const close = sky.sepDeg < 3 && sky.sun.el > -1;
    this.sunLabel.sprite.visible = !close;
    this.earthLabel.sprite.visible = !this.eclipseZoom(f);
    this.earthLabel.set(close ? "Earth, with the Sun behind it" : "Earth");

    this.light.position.copy(sunVec).multiplyScalar(this.patch ? 900 : 100);
    this.light.intensity = 3.4 * sky.sunlight;
    const earthshine = (0.02 + 0.06 * sky.earth.litFraction) * sky.earth.frac;
    this.ambient.intensity = sky.sunlight > 0.05 ? 0.35 : 0.06 + earthshine * 3;
    const sinEl = Math.max(0, Math.sin(sky.sun.el * RAD));
    const g = sky.sunlight > 0 ? sky.sunlight * (0.28 + 0.9 * sinEl) + (1 - sky.sunlight) * earthshine : earthshine;
    this.groundMat.color.setScalar(clamp(g, 0.015, 1));
    if (this.patch) {
      // Lambert divides by pi and the real ground is scaled by REAL_ALBEDO: this keeps the night ground as dark as the
      // stylized one (earthshine only) while a sunlit scene keeps some fill light from the surrounding bright slopes.
      // Fill light in daytime stands for sunlight scattered off nearby slopes: low, so cast shadows read black.
      this.ambient.intensity = sky.sunlight > 0.05 ? 0.07 : (Math.PI / REAL_ALBEDO) * Math.max(0.012, earthshine);
      this.fitShadow(sunVec, sky.sunlight > 0.02);
    } else this.light.castShadow = false;
    this.skirtMat.color.set(0x2a2b30);
    this.lineMat.opacity = 0.55 + 0.35 * clamp(g * 3, 0, 1);

    const low = Math.max(sky.sun.el, 0.8);
    const shadowLen = Math.min(80, 1 / Math.tan(low * RAD));
    const showShadow = sky.sunlight > 0.05;
    const away = Math.atan2(-sunV[2], sunV[0]);
    for (const rk of this.rocks) {
      rk.shadow.visible = showShadow && !this.patch;
      rk.shadow.rotation.y = away + Math.PI;
      rk.shadow.scale.set(rk.size * 0.7 * shadowLen, 1, rk.size * 1.2);
    }

    this.lander.visible = f.landerAz !== null;
    if (f.landerAz !== null) {
      const v = dirFromAzEl(f.landerAz, 0);
      const x = v[0] * LANDER_M;
      const z = v[2] * LANDER_M;
      this.lander.position.set(x, this.groundY(x, z), z);
      this.lander.rotation.y = -f.landerAz * RAD;
    }

    const trailOn = f.trail === "earth";
    this.trail.visible = trailOn;
    if (trailOn) {
      const tk = `${f.site.id}|${f.epochD}|${f.spanDays}`;
      if (tk !== this.trailKey) {
        this.trailKey = tk;
        this.buildTrail(f);
      }
      const i0 = Math.max(0, Math.floor((Math.max(f.epochD, f.d - 30) - this.trailStart) / this.trailStep));
      const i1 = Math.max(i0 + 1, Math.floor((f.d - this.trailStart) / this.trailStep));
      this.trail.geometry.setDrawRange(i0, i1 - i0 + 1);
    }
    const pathOn = f.trail === "sunpath";
    this.pathGroup.visible = pathOn;
    if (pathOn) {
      const pk = `${f.site.id}|${(f.lat ?? 0).toFixed(2)}`;
      if (pk !== this.pathKey || Math.abs(f.d - this.pathD) > 1) {
        this.pathKey = pk;
        this.buildPath(f);
      }
    }

    for (const l of this.cardinals) {
      const az = l.sprite.userData.az as number;
      const v = dirFromAzEl(az, 0);
      const h = EYE + 440 * Math.tan(f.site.horizon(az) * RAD);
      l.sprite.position.set(v[0] * 440, h + 2, v[2] * 440);
      const nearSun = Math.abs(wrap180(az - sky.sun.az)) < 7 && sky.sun.el < 5;
      const nearEarth = Math.abs(wrap180(az - sky.earth.az)) < 7 && sky.earth.el < 5;
      l.sprite.visible = !nearSun && !nearEarth;
    }

    const tAz = f.follow === "earth" ? sky.earth.az : sky.sun.az;
    const tEl = f.follow === "earth" ? sky.earth.el : sky.sun.el;
    this.free = f.follow === "free";
    if (!this.free) {
      this.target.yaw = tAz;
      this.target.pitch = this.followPitch(
        this.camera,
        tEl,
        this.eclipseZoom(f) ? "zoom" : f.follow === "earth" ? "earth" : f.trail === "sunpath" ? "flat" : "sun",
      );
    }
    this.insetTarget.yaw = sky.sun.az;
    this.insetTarget.pitch = this.followPitch(this.insetCamera, sky.sun.el);
  }

  snap() {
    this.look = { ...this.target };
    this.inset = { ...this.insetTarget };
    this.apply();
  }

  step(dt: number, reduced: boolean): boolean {
    const k = reduced ? 1 : 1 - Math.exp(-dt * 6);
    let moving = false;
    for (const [cur, tgt] of [
      [this.look, this.target],
      [this.inset, this.insetTarget],
    ] as const) {
      const dy = wrap180(tgt.yaw - cur.yaw);
      const dp = tgt.pitch - cur.pitch;
      if (Math.abs(dy) > 0.02 || Math.abs(dp) > 0.02) {
        cur.yaw = wrap360(cur.yaw + dy * k);
        cur.pitch += dp * k;
        moving = true;
      } else {
        cur.yaw = tgt.yaw;
        cur.pitch = tgt.pitch;
      }
    }
    this.apply();
    return moving;
  }

  private apply() {
    for (const [cam, l] of [
      [this.camera, this.look],
      [this.insetCamera, this.inset],
    ] as const) {
      cam.position.set(0, EYE, 0);
      cam.rotation.order = "YXZ";
      cam.rotation.set(l.pitch * RAD, -l.yaw * RAD, 0);
      cam.updateMatrixWorld();
    }
  }

  drag(dxDeg: number, dyDeg: number) {
    this.free = true;
    this.target.yaw = wrap360(this.target.yaw - dxDeg);
    this.target.pitch = clamp(this.target.pitch + dyDeg, -10, 60);
    this.look.yaw = this.target.yaw;
    this.look.pitch = this.target.pitch;
    this.apply();
  }

  turnTo(az: number, el: number) {
    this.free = true;
    this.target.yaw = wrap360(az);
    this.target.pitch = this.followPitch(this.camera, el);
  }

  fitLabels(h: number, cam: PerspectiveCamera) {
    for (const l of this.labels) l.fit(h, cam.fov);
  }

  dispose() {
    for (const l of this.labels) l.dispose();
    this.realGround?.geometry.dispose();
    this.realMat.dispose();
  }
}

