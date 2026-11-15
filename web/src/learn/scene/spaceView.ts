import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Line,
  LineDashedMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Points,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MOON_DRAWN_RADIUS, orbitPath, pinLocal, type V3 } from "../geometry";
import { Label, arrow, glowSprite, starField } from "./textures";
import type { Pose } from "./tween";
import type { SceneFrame, Shared } from "./types";

const ORBIT_SAMPLES = 119;
const v3 = (a: V3) => new Vector3(a[0], a[1], a[2]);

export type SpacePreset = "day" | "explore" | "fly";

export class SpaceView {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(40, 1, 0.05, 600);
  readonly controls: OrbitControls;
  private readonly earth: Mesh;
  private readonly moon: Mesh;
  private readonly pin = new Group();
  private readonly pinHead: Sprite;
  private readonly pinCore: Sprite;
  private readonly orbit: Line;
  private readonly orbitGeo = new BufferGeometry();
  private readonly stars: Points;
  readonly labels: Label[] = [];
  private readonly earthLabel = new Label("Earth", { anchorY: 1 });
  private readonly moonLabel = new Label("Moon", { anchorY: 1 });
  private readonly pinLabel = new Label("Apollo 11", { anchorX: -0.08, anchorY: -0.15, color: "#ffe2a8" });
  private readonly sunLabel = new Label("Sunlight", { color: "#ffd27a", anchorX: 0, anchorY: -0.6 });
  private readonly matrix = new Matrix4();
  private readonly rays = new Group();
  private lastOrbitD = Number.NaN;
  private pinSiteKey = "";
  moonPos = new Vector3();
  follow = false;

  constructor(canvas: HTMLCanvasElement, shared: Shared) {
    const s = this.scene;
    this.stars = starField(300);
    s.add(this.stars);
    const sun = new Mesh(new SphereGeometry(2.5, 32, 16), new MeshBasicMaterial({ color: 0xfff1d0 }));
    sun.position.set(-70, 0, 0);
    s.add(sun);
    const glow = glowSprite(shared.glow, "#ffcf7a");
    glow.scale.setScalar(30);
    glow.position.copy(sun.position);
    s.add(glow);
    const light = new DirectionalLight(0xffffff, 3.2);
    light.position.set(-100, 0, 0);
    s.add(light, light.target, new AmbientLight(0xffffff, 0.06));

    this.earth = new Mesh(new SphereGeometry(1, 64, 32), new MeshLambertMaterial({ map: shared.earth }));
    const earthAxis = new Mesh(
      new CylinderGeometry(0.014, 0.014, 3, 8),
      new MeshBasicMaterial({ color: 0x9fb4d8, transparent: true, opacity: 0.7 }),
    );
    this.earth.add(earthAxis);
    s.add(this.earth);

    this.moon = new Mesh(new SphereGeometry(MOON_DRAWN_RADIUS, 96, 48), new MeshLambertMaterial({ map: shared.moon }));
    const moonAxis = new Mesh(
      new CylinderGeometry(0.01, 0.01, 1.5, 8),
      new MeshBasicMaterial({ color: 0xd0d3da, transparent: true, opacity: 0.75 }),
    );
    this.moon.add(moonAxis);
    s.add(this.moon);

    const stick = new Mesh(
      new CylinderGeometry(0.008, 0.008, MOON_DRAWN_RADIUS * 0.5, 6),
      new MeshBasicMaterial({ color: 0xffd27a }),
    );
    stick.position.y = MOON_DRAWN_RADIUS * 0.25;
    this.pin.add(stick);
    this.pinHead = new Sprite(
      new SpriteMaterial({ map: shared.glow, color: "#ffc35c", transparent: true, depthWrite: false, sizeAttenuation: false }),
    );
    this.pinHead.position.y = MOON_DRAWN_RADIUS * 0.5;
    this.pinCore = new Sprite(
      new SpriteMaterial({ map: shared.disc, color: "#fff4dc", transparent: true, depthWrite: false, sizeAttenuation: false }),
    );
    this.pinCore.position.y = MOON_DRAWN_RADIUS * 0.5;
    this.pin.add(this.pinHead, this.pinCore);
    this.pinLabel.sprite.position.y = MOON_DRAWN_RADIUS * 0.5;
    this.pin.add(this.pinLabel.sprite);
    this.pinLabel.sprite.material.depthTest = false;
    this.pinLabel.sprite.renderOrder = 10;
    this.pinLabel.sprite.onBeforeRender = () => {
      const facing = this.pinWorld().sub(this.moon.position).dot(this.camera.position.clone().sub(this.moon.position)) > 0;
      this.pinLabel.sprite.material.opacity = facing ? 1 : 0;
    };
    this.moon.add(this.pin);

    this.orbitGeo.setAttribute("position", new BufferAttribute(new Float32Array(ORBIT_SAMPLES * 3), 3));
    this.orbit = new Line(
      this.orbitGeo,
      new LineDashedMaterial({ color: 0x8a8d94, dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.45 }),
    );
    this.orbit.frustumCulled = false;
    s.add(this.orbit);

    for (const [y, z] of [
      [0, 0],
      [2.4, -4],
      [-2.4, 4],
    ] as const) {
      const a = arrow(5, 1.1, 0.7, 0xffb627);
      a.position.set(-22, y, z);
      this.rays.add(a);
    }
    s.add(this.sunLabel.sprite);
    s.add(this.rays);

    this.earthLabel.sprite.position.set(0, -1.2, 0);
    s.add(this.earthLabel.sprite, this.moonLabel.sprite);
    this.labels.push(this.earthLabel, this.moonLabel, this.pinLabel, this.sunLabel);

    this.camera.position.set(8, 9, 22);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 45;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.6;
    this.controls.enabled = false;
  }

  update(f: SceneFrame) {
    const sp = f.space;
    this.matrix.makeBasis(v3(sp.earthBasis[0]), v3(sp.earthBasis[1]), v3(sp.earthBasis[2]));
    this.earth.quaternion.setFromRotationMatrix(this.matrix);

    const prevX = this.moonPos.x;
    const prevY = this.moonPos.y;
    const prevZ = this.moonPos.z;
    this.moonPos.set(sp.moonPos[0], sp.moonPos[1], sp.moonPos[2]);
    if (this.follow && this.moon.position.lengthSq() > 0) {
      const dx = this.moonPos.x - prevX;
      const dy = this.moonPos.y - prevY;
      const dz = this.moonPos.z - prevZ;
      this.camera.position.x += dx;
      this.camera.position.y += dy;
      this.camera.position.z += dz;
      this.controls.target.x += dx;
      this.controls.target.y += dy;
      this.controls.target.z += dz;
    }
    this.moon.position.copy(this.moonPos);
    this.matrix.makeBasis(v3(sp.moonBasis[0]), v3(sp.moonBasis[1]), v3(sp.moonBasis[2]));
    this.moon.quaternion.setFromRotationMatrix(this.matrix);
    if (f.chapter === "day") {
      this.rays.scale.setScalar(0.2);
      this.rays.position.set(this.moonPos.x + 17 * 0.2 - 0.8, this.moonPos.y, this.moonPos.z);
    } else {
      this.rays.scale.setScalar(1);
      this.rays.position.set(0, 0, 0);
    }
    const k = this.rays.scale.x;
    this.sunLabel.sprite.position.set(this.rays.position.x - 22 * k, this.rays.position.y + 0.6 * k, this.rays.position.z);
    this.moonLabel.sprite.position.copy(this.moonPos).add(new Vector3(0, -MOON_DRAWN_RADIUS - 0.2, 0));

    const key = `${f.site.id}|${f.site.lat}|${f.site.lon}|${f.lat ?? ""}`;
    if (key !== this.pinSiteKey) {
      this.pinSiteKey = key;
      const lat = f.site.id === "custom" ? (f.lat ?? 0) : f.site.lat;
      const p = pinLocal(lat, f.site.lon, MOON_DRAWN_RADIUS);
      const up = v3(p).normalize();
      this.pin.position.set(p[0], p[1], p[2]);
      this.pin.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), up);
      this.pinLabel.set(f.site.name);
    }
    this.moonLabel.sprite.visible = f.chapter !== "day";

    if (!(Math.abs(f.d - this.lastOrbitD) <= 0.02)) {
      this.lastOrbitD = f.d;
      const pts = orbitPath(f.d, 14.8, (2 * 14.8) / (ORBIT_SAMPLES - 1));
      const arr = this.orbitGeo.getAttribute("position") as BufferAttribute;
      for (let i = 0; i < ORBIT_SAMPLES; i++) {
        const p = pts[Math.min(i, pts.length - 1)]!;
        arr.setXYZ(i, p[0], p[1], p[2]);
      }
      arr.needsUpdate = true;
      this.orbit.computeLineDistances();
    }
  }

  setPinPulse(now: number, reduced: boolean) {
    const k = reduced ? 1 : 1 + 0.18 * Math.sin(now / 260);
    const h = this.viewportH || 800;
    const unit = (2 * Math.tan((this.camera.fov * Math.PI) / 360)) / h;
    this.pinHead.scale.setScalar(34 * unit * k);
    this.pinCore.scale.setScalar(9 * unit);
    const x = this.pin.getWorldPosition(this.tmp).project(this.camera).x;
    this.pinLabel.sprite.center.x = x > 0.3 ? 1.08 : -0.08;
  }

  private readonly tmp = new Vector3();

  viewportH = 800;

  fitLabels(h: number) {
    this.viewportH = h;
    for (const l of this.labels) l.fit(h, this.camera.fov);
    this.setPinPulse(0, true);
  }

  pinWorld(): Vector3 {
    return this.pin.getWorldPosition(new Vector3());
  }

  pose(kind: SpacePreset, phone: boolean): Pose {
    const m = this.moonPos.clone();
    const fov = 40;
    if (kind === "day") {
      const pos = m.clone().add(phone ? new Vector3(0.4, 6.4, 2.8) : new Vector3(0.6, 5.4, 2.4));
      return { pos, target: m.clone(), fov };
    }
    if (kind === "fly") {
      const pin = this.pinWorld();
      const dir = pin.clone().sub(m).normalize();
      const pos = m.clone().addScaledVector(dir, 2.1).add(new Vector3(0, 0.8, 0));
      return { pos, target: m, fov };
    }
    return phone
      ? { pos: new Vector3(0, 50, 33), target: new Vector3(0.5, 0, 1), fov }
      : { pos: new Vector3(0, 36, 26), target: new Vector3(-2.5, 0, 4), fov };
  }

  dispose() {
    this.controls.dispose();
    for (const l of this.labels) l.dispose();
  }
}
