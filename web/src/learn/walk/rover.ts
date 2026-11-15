import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshLambertMaterial, MeshPhongMaterial, SphereGeometry, SpotLight, Vector3, type Object3D, type Quaternion } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import roverUrl from "./models/improved_rover.glb?url";
import cockpitUrl from "./models/improved_cockpit.glb?url";
import seatedAstronautUrl from "./models/astronaut_seated.glb?url";
import { clamp } from "../../lib/scale";
import { RAD } from "../geometry";
import { clampRadius, pushOut, type Obstacle } from "./collide";
import { WALK_RADIUS_M } from "./astronaut";
import type { Drive } from "./walkInput";
import type { WalkTerrain } from "./walkTerrain";

const TOP_SPEED = 4;
const ACCEL = 1.6;
const TURN = 40;
const HALF_TRACK = 0.95;
const HALF_BASE = 1.25;
const WHEEL_R = 0.42;
const WHEEL_AXIS = new Vector3(1, 0, 0);
const WHEEL_NAMES = ["Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"];
export const ROVER_HOME = new Vector3(-0.6, 0, 1.2);
export const ROVER_HEADING = 310;

const white = new MeshLambertMaterial({ color: 0xdedfe2 });
const grey = new MeshLambertMaterial({ color: 0x6b6e75 });
const tyre = new MeshLambertMaterial({ color: 0x2b2c30 });
const gold = new MeshPhongMaterial({ color: 0xb98a2e, specular: 0xffe0a0, shininess: 60 });
const glass = new MeshPhongMaterial({ color: 0x1d2433, specular: 0x9fb6ff, shininess: 80 });

function box(w: number, h: number, d: number, mat: MeshLambertMaterial | MeshPhongMaterial, x: number, y: number, z: number): Mesh {
  const m = new Mesh(new BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

export class Rover {
  readonly object = new Group();
  readonly position = new Vector3();
  heading = ROVER_HEADING;
  atEdge = false;
  private readonly chassis = new Group();
  private readonly model = new Group();
  private readonly driver = new Group();
  private readonly lights = new Group();
  private readonly wheels: Object3D[] = [];
  private readonly wheelRest: Quaternion[] = [];
  private speed = 0;
  private roll = 0;
  private readonly mast: Mesh[] = [];
  private readonly modelMast: Object3D[] = [];
  private readonly lamps: SpotLight[] = [];
  private inside = false;
  private driverHidden = false;
  onModelReady: (() => void) | null = null;

  setInside(on: boolean): void {
    this.inside = on;
    for (const m of this.mast) m.visible = !on;
    for (const m of this.modelMast) m.visible = !on;
  }

  setDriver(on: boolean, hideFromCamera: boolean): void {
    this.driver.visible = on;
    this.driverHidden = hideFromCamera;
    this.driver.traverse((part) => part.layers.set(hideFromCamera ? 1 : 0));
  }

  setLights(on: boolean): void {
    for (const l of this.lamps) l.intensity = on ? 2.2 : 0;
  }

  constructor() {
    const c = this.chassis;
    c.add(box(1.7, 0.18, 2.9, white, 0, 0.62, 0));
    c.add(box(1.5, 0.3, 0.6, gold, 0, 0.85, 1.05));
    for (const x of [-0.38, 0.38]) {
      c.add(box(0.52, 0.1, 0.5, grey, x, 0.78, -0.15));
      c.add(box(0.52, 0.55, 0.08, grey, x, 1.05, 0.12));
    }
    c.add(box(0.9, 0.5, 0.25, grey, 0, 0.98, -0.95));
    c.add(box(0.7, 0.28, 0.04, glass, 0, 1.0, -1.09));
    const mast = new Mesh(new CylinderGeometry(0.04, 0.05, 1.3, 8), grey);
    mast.position.set(0.55, 1.35, -1.1);
    const cam = box(0.32, 0.16, 0.16, white, 0.55, 2.02, -1.1);
    const dish = new Mesh(new SphereGeometry(0.42, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.32), white);
    dish.rotation.x = -Math.PI / 2.4;
    dish.position.set(-0.45, 1.75, 1.0);
    const dishPole = new Mesh(new CylinderGeometry(0.03, 0.03, 0.9, 8), grey);
    dishPole.position.set(-0.45, 1.25, 1.0);
    c.add(mast, cam, dish, dishPole);
    this.mast.push(mast, cam);
    for (const x of [-0.5, 0.5]) {
      const lamp = new SpotLight(0xfff2dc, 0, 45, 0.55, 0.6, 0);
      lamp.position.set(x, 0.9, -1.5);
      lamp.target.position.set(x * 3, 0, -16);
      this.lights.add(lamp, lamp.target);
      this.lamps.push(lamp);
    }
    const wheelGeo = new CylinderGeometry(WHEEL_R, WHEEL_R, 0.3, 20).rotateZ(Math.PI / 2);
    for (const [x, z] of [
      [-HALF_TRACK, -HALF_BASE],
      [HALF_TRACK, -HALF_BASE],
      [-HALF_TRACK, HALF_BASE],
      [HALF_TRACK, HALF_BASE],
    ] as const) {
      const w = new Mesh(wheelGeo, tyre);
      w.position.set(x, WHEEL_R, z);
      this.wheels.push(w);
      this.wheelRest.push(w.quaternion.clone());
      c.add(w);
      c.add(box(0.36, 0.06, 0.95, white, x, WHEEL_R + 0.48, z));
    }
    this.model.visible = false;
    this.object.add(c, this.model, this.driver, this.lights);
    this.object.traverse((o) => {
      if (o instanceof Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.object.rotation.order = "YXZ";
    this.reset();
    this.loadModels();
  }

  private loadModels(): void {
    const loader = new GLTFLoader();
    void loader.loadAsync(seatedAstronautUrl).then(({ scene }) => {
      this.driver.add(scene);
      scene.traverse((part) => {
        if (part instanceof Mesh) {
          part.castShadow = true;
          part.receiveShadow = true;
        }
      });
      this.setDriver(this.driver.visible, this.driverHidden);
      this.onModelReady?.();
    }).catch((error: unknown) => console.warn("Seated astronaut model unavailable", error));
    void Promise.all([loader.loadAsync(roverUrl), loader.loadAsync(cockpitUrl)]).then(([rover, cockpit]) => {
      const wheels: Object3D[] = [];
      for (const name of WHEEL_NAMES) {
        const wheel = rover.scene.getObjectByName(name);
        if (!wheel) throw new Error(`Missing rover wheel ${name}`);
        wheels.push(wheel);
      }
      const mast: Object3D[] = [];
      for (const name of ["MastPole", "MastCameraHousing", "MastCameraLens"]) {
        const part = rover.scene.getObjectByName(name);
        if (!part) throw new Error(`Missing rover mast part ${name}`);
        mast.push(part);
      }
      for (const name of ["Screen_Nav", "Screen_Status", "Screen_Comms"]) {
        if (!cockpit.scene.getObjectByName(name)) throw new Error(`Missing cockpit screen ${name}`);
      }
      this.model.add(rover.scene, cockpit.scene);
      this.model.traverse((o) => {
        if (o instanceof Mesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      this.wheels.splice(0, this.wheels.length, ...wheels);
      this.wheelRest.splice(0, this.wheelRest.length, ...wheels.map((wheel) => wheel.quaternion.clone()));
      this.modelMast.push(...mast);
      this.chassis.visible = false;
      this.model.visible = true;
      this.setInside(this.inside);
      this.syncWheels();
      this.onModelReady?.();
    }).catch((error: unknown) => console.warn("Rover models unavailable; using procedural fallback", error));
  }

  private syncWheels(): void {
    for (let i = 0; i < this.wheels.length; i++) {
      this.wheels[i]!.quaternion.setFromAxisAngle(WHEEL_AXIS, -this.roll).multiply(this.wheelRest[i]!);
    }
  }

  reset(): void {
    this.position.copy(ROVER_HOME);
    this.heading = ROVER_HEADING;
    this.speed = 0;
    this.atEdge = false;
  }

  obstacles(): Obstacle[] {
    const h = this.heading * RAD;
    const fx = Math.sin(h) * 0.75;
    const fz = -Math.cos(h) * 0.75;
    const p = this.position;
    return [
      { x: p.x + fx, z: p.z + fz, r: 1.0 },
      { x: p.x - fx, z: p.z - fz, r: 1.0 },
    ];
  }

  step(dt: number, d: Drive, terrain: WalkTerrain, obs: Obstacle[]): boolean {
    const want = d.forward * TOP_SPEED * (d.forward < 0 ? 0.5 : 1);
    const dv = want - this.speed;
    this.speed += clamp(dv, -ACCEL * 2 * dt, ACCEL * dt * (Math.abs(want) > Math.abs(this.speed) ? 1 : 2));
    if (Math.abs(this.speed) < 0.02 && want === 0) this.speed = 0;
    this.heading = (this.heading + d.turn * TURN * dt * (this.speed < -0.05 ? -1 : 1) + 360) % 360;
    let x = this.position.x + Math.sin(this.heading * RAD) * this.speed * dt;
    let z = this.position.z - Math.cos(this.heading * RAD) * this.speed * dt;
    const [px, pz] = pushOut(x, z, 1.5, obs);
    const into = ((px - x) * Math.sin(this.heading * RAD) - (pz - z) * Math.cos(this.heading * RAD)) * Math.sign(this.speed);
    const len = Math.abs(this.speed * dt);
    if (into < -1e-4 && len > 1e-6) {
      const cap = TOP_SPEED * Math.sqrt(clamp(1 + into / len, 0, 1));
      this.speed = Math.sign(this.speed) * Math.min(Math.abs(this.speed), cap);
    }
    const clamped = clampRadius(px, pz, WALK_RADIUS_M);
    [x, z] = clamped;
    this.atEdge = clamped[2];
    this.position.set(x, 0, z);
    this.roll += (this.speed * dt) / WHEEL_R;
    this.pose(terrain);
    return this.speed !== 0 || d.turn !== 0;
  }

  pose(terrain: WalkTerrain): void {
    const h = this.heading * RAD;
    const fx = Math.sin(h);
    const fz = -Math.cos(h);
    const rx = Math.cos(h);
    const rz = Math.sin(h);
    const p = this.position;
    const at = (f: number, r: number) => terrain.heightAt(p.x + fx * f + rx * r, p.z + fz * f + rz * r);
    const fl = at(HALF_BASE, -HALF_TRACK);
    const fr = at(HALF_BASE, HALF_TRACK);
    const bl = at(-HALF_BASE, -HALF_TRACK);
    const br = at(-HALF_BASE, HALF_TRACK);
    const pitch = Math.atan2((fl + fr - bl - br) / 2, 2 * HALF_BASE);
    const roll = Math.atan2((fl + bl - fr - br) / 2, 2 * HALF_TRACK);
    p.y = (fl + fr + bl + br) / 4;
    this.object.position.copy(p);
    this.object.rotation.set(pitch, -h, -roll);
    this.syncWheels();
  }
}
