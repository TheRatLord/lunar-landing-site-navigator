import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  IcosahedronGeometry,
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
import { Label, glowSprite, rng, starField } from "./textures";
import type { SceneFrame, Shared } from "./types";

const EYE = 1.7;
const R_GROUND = 300;
const R_SKIRT = 450;
const R_SUN = 490;
const R_EARTH = 480;
const R_DOME = 470;
const AZ_N = 360;

interface Rock {
  mesh: Mesh;
  shadow: Mesh;
  size: number;
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

    const ground = this.buildGround();
    this.groundMat = new MeshBasicMaterial({ map: shared.regolith, color: 0x777777 });
    s.add(new Mesh(ground, this.groundMat));

    this.skirtGeo.setAttribute("position", new BufferAttribute(new Float32Array(AZ_N * 2 * 3 + 6), 3));
    this.skirtGeo.setIndex(this.stripIndex());
    s.add(new Mesh(this.skirtGeo, this.skirtMat));
    this.lineGeo.setAttribute("position", new BufferAttribute(new Float32Array(AZ_N * 2 * 3 + 6), 3));
    this.lineGeo.setIndex(this.stripIndex());
    const line = new Mesh(this.lineGeo, this.lineMat);
    line.renderOrder = 2;
    s.add(line);

    const r = rng(21);
    const rockGeo = new IcosahedronGeometry(1, 0);
    const shadowGeo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0);
    const shadowMat = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.72, depthWrite: false });
    const rockMat = new MeshLambertMaterial({ color: 0x9a9a9d, flatShading: true });
    for (let i = 0; i < 46; i++) {
      const dist = 9 + r() ** 1.6 * 110;
      const az = r() * 360;
      const size = 0.12 + r() ** 2 * 0.9;
      const mesh = new Mesh(rockGeo, rockMat);
      const x = Math.sin(az * RAD) * dist;
      const z = -Math.cos(az * RAD) * dist;
      mesh.position.set(x, size * 0.35, z);
      mesh.scale.set(size, size * (0.5 + r() * 0.4), size * (0.7 + r() * 0.5));
      mesh.rotation.set(r() * 3, r() * 3, r() * 3);
      const shadow = new Mesh(shadowGeo, shadowMat);
      shadow.position.set(x, 0.03, z);
      s.add(mesh, shadow);
      this.rocks.push({ mesh, shadow, size });
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

  private buildGround(): BufferGeometry {
    const rings = 40;
    const segs = 96;
    const pos: number[] = [0, 0, 0];
    const uv: number[] = [0.5, 0.5];
    const r = rng(9);
    const bumps = Array.from({ length: 30 }, () => ({
      x: (r() - 0.5) * 500,
      z: (r() - 0.5) * 500,
      s: 8 + r() * 40,
      h: (r() - 0.5) * 0.8,
    }));
    for (let i = 1; i <= rings; i++) {
      const rad = R_GROUND * (i / rings) ** 1.7;
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const x = Math.cos(a) * rad;
        const z = Math.sin(a) * rad;
        let y = 0;
        if (i < rings) {
          for (const b of bumps) y += b.h * Math.exp(-((x - b.x) ** 2 + (z - b.z) ** 2) / (b.s * b.s));
          y *= Math.min(1, rad / 40);
        }
        pos.push(x, y, z);
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

  private buildHorizon(site: Site) {
    const sk = this.skirtGeo.getAttribute("position") as BufferAttribute;
    const ln = this.lineGeo.getAttribute("position") as BufferAttribute;
    for (let i = 0; i <= AZ_N; i++) {
      const az = (i / AZ_N) * 360;
      const sx = Math.sin(az * RAD);
      const sz = -Math.cos(az * RAD);
      const top = EYE + R_SKIRT * Math.tan(site.horizon(az) * RAD);
      sk.setXYZ(i * 2, sx * R_GROUND, 0, sz * R_GROUND);
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
    const key = `${f.site.id}`;
    if (key !== this.horizonKey) {
      this.horizonKey = key;
      this.buildHorizon(f.site);
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

    this.light.position.copy(sunVec).multiplyScalar(100);
    this.light.intensity = 3.4 * sky.sunlight;
    const earthshine = (0.02 + 0.06 * sky.earth.litFraction) * sky.earth.frac;
    this.ambient.intensity = sky.sunlight > 0.05 ? 0.35 : 0.06 + earthshine * 3;
    const sinEl = Math.max(0, Math.sin(sky.sun.el * RAD));
    const g = sky.sunlight > 0 ? sky.sunlight * (0.28 + 0.9 * sinEl) + (1 - sky.sunlight) * earthshine : earthshine;
    this.groundMat.color.setScalar(clamp(g, 0.015, 1));
    this.skirtMat.color.set(0x2a2b30);
    this.lineMat.opacity = 0.55 + 0.35 * clamp(g * 3, 0, 1);

    const low = Math.max(sky.sun.el, 0.8);
    const shadowLen = Math.min(80, 1 / Math.tan(low * RAD));
    const showShadow = sky.sunlight > 0.05;
    const away = Math.atan2(-sunV[2], sunV[0]);
    for (const rk of this.rocks) {
      rk.shadow.visible = showShadow;
      rk.shadow.rotation.y = away + Math.PI;
      rk.shadow.scale.set(rk.size * 0.7 * shadowLen, 1, rk.size * 1.2);
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
  }
}

