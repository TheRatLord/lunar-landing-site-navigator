import { BoxGeometry, CapsuleGeometry, Group, Mesh, MeshLambertMaterial, MeshPhongMaterial, SphereGeometry, SpotLight, Vector3, type Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import astronautUrl from "./models/improved_astronaut.glb?url";
import { clamp } from "../../lib/scale";
import { RAD } from "../geometry";
import { clampRadius, pushOut, type Obstacle } from "./collide";
import type { Drive } from "./walkInput";
import type { WalkTerrain } from "./walkTerrain";

export const WALK_RADIUS_M = 400;
const ASTRONAUT_SPEED_MULTIPLIER = 1.5; // Original forward speed: 1.5 m/s.
const SPEED = 1.5 * ASTRONAUT_SPEED_MULTIPLIER;
const TURN = 110;
const G_MOON = 1.62;
const JUMP_V = 1.3;
const BODY_R = 0.4;
const HOME = new Vector3(1.6, 0, 0.8);
const STRIDE_METRES = 1.4;
const HIP_LIMIT = 0.55;
const KNEE_LIMIT = 0.85;
const SHOULDER_LIMIT = 0.5;
const ELBOW_LIMIT = 0.55;
const NECK_LIMIT = 0.12;
const ANKLE_LIMIT = 0.6;

const suit = new MeshLambertMaterial({ color: 0xeeeeea });
const dark = new MeshLambertMaterial({ color: 0x55575c });
const visor = new MeshPhongMaterial({ color: 0xc8962f, specular: 0xffe7a8, shininess: 90 });

function part(geo: CapsuleGeometry | BoxGeometry | SphereGeometry, mat: MeshLambertMaterial | MeshPhongMaterial, x: number, y: number, z: number): Mesh {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function joint(root: Group, limb: Object3D, x: number, y: number, z: number): Group {
  const pivot = new Group();
  pivot.position.set(x, y, z);
  root.add(pivot);
  root.updateMatrixWorld(true);
  pivot.attach(limb);
  return pivot;
}

export class Astronaut {
  readonly object = new Group();
  readonly position = new Vector3();
  heading = 340;
  kneeling = false;
  atEdge = false;
  readonly lamp = new SpotLight(0xfff4e0, 0, 28, 0.5, 0.55, 0);
  private readonly body = new Group();
  private readonly fallback = new Group();
  private legL: Object3D;
  private legR: Object3D;
  private armL: Object3D;
  private armR: Object3D;
  private kneeL: Object3D | null = null;
  private kneeR: Object3D | null = null;
  private elbowL: Object3D | null = null;
  private elbowR: Object3D | null = null;
  private ankleL: Object3D | null = null;
  private ankleR: Object3D | null = null;
  private neck: Object3D;
  private vy = 0;
  private lift = 0;
  private phase = 0;
  private stride = 0;
  private moonwalk = 0;
  private airborne = 0;
  private landing = 0;
  onModelReady: (() => void) | null = null;

  constructor() {
    const leg = new CapsuleGeometry(0.12, 0.55, 4, 10);
    this.legL = part(leg, suit, -0.14, 0.42, 0);
    this.legR = part(leg, suit, 0.14, 0.42, 0);
    const torso = part(new CapsuleGeometry(0.27, 0.42, 4, 12), suit, 0, 1.12, 0);
    const pack = part(new BoxGeometry(0.5, 0.62, 0.26), suit, 0, 1.2, 0.3);
    const panel = part(new BoxGeometry(0.28, 0.16, 0.08), dark, 0, 1.12, -0.3);
    const arm = new CapsuleGeometry(0.09, 0.5, 4, 10);
    this.armL = part(arm, suit, -0.38, 1.1, 0);
    this.armR = part(arm, suit, 0.38, 1.1, 0);
    const helmet = part(new SphereGeometry(0.22, 20, 14), suit, 0, 1.66, 0);
    const face = part(new SphereGeometry(0.2, 20, 14, Math.PI * 1.1, Math.PI * 0.8, Math.PI * 0.28, Math.PI * 0.4), visor, 0, 1.66, -0.04);
    this.fallback.add(this.legL, this.legR, torso, pack, panel, this.armL, this.armR, helmet, face);
    this.legL = joint(this.fallback, this.legL, -0.14, 0.78, 0);
    this.legR = joint(this.fallback, this.legR, 0.14, 0.78, 0);
    this.armL = joint(this.fallback, this.armL, -0.38, 1.38, 0);
    this.armR = joint(this.fallback, this.armR, 0.38, 1.38, 0);
    this.neck = joint(this.fallback, helmet, 0, 1.53, 0);
    this.neck.attach(face);
    this.body.add(this.fallback);
    this.lamp.position.set(0, 1.78, -0.12);
    this.lamp.target.position.set(0, 0, -9);
    this.object.add(this.body, this.lamp, this.lamp.target);
    this.reset();
    this.loadModel();
  }

  private loadModel(): void {
    void new GLTFLoader().loadAsync(astronautUrl).then(({ scene }) => {
      const legL = scene.getObjectByName("Leg_L");
      const legR = scene.getObjectByName("Leg_R");
      const armL = scene.getObjectByName("Arm_L");
      const armR = scene.getObjectByName("Arm_R");
      if (!legL || !legR || !armL || !armR) throw new Error("Astronaut model is missing walking pivots");
      const kneeL = new Group();
      const kneeR = new Group();
      const ankleL = new Group();
      const ankleR = new Group();
      const elbowL = new Group();
      const elbowR = new Group();
      kneeL.position.set(0, -0.39, 0);
      kneeR.position.set(0, -0.39, 0);
      ankleL.position.set(0, -0.28, -0.2);
      ankleR.position.set(0, -0.28, -0.2);
      elbowL.position.set(0, -0.305, 0);
      elbowR.position.set(0, -0.305, 0);
      this.legL = joint(scene, legL, -0.14, 0.78, 0);
      this.legR = joint(scene, legR, 0.14, 0.78, 0);
      this.armL = joint(scene, armL, -0.38, 1.38, 0);
      this.armR = joint(scene, armR, 0.38, 1.38, 0);
      this.legL.add(kneeL);
      this.legR.add(kneeR);
      kneeL.add(ankleL);
      kneeR.add(ankleR);
      this.armL.add(elbowL);
      this.armR.add(elbowR);
      scene.updateMatrixWorld(true);
      for (const [side, knee, ankle, elbow] of [["L", kneeL, ankleL, elbowL], ["R", kneeR, ankleR, elbowR]] as const) {
        for (const name of ["LowerLeg", "ShinArmor"]) {
          const piece = scene.getObjectByName(`${name}_${side}`);
          if (piece) knee.attach(piece);
        }
        for (const name of ["Boot", "BootToe", "BootSole"]) {
          const piece = scene.getObjectByName(`${name}_${side}`);
          if (piece) ankle.attach(piece);
        }
        for (const name of ["Forearm", "Glove", "WristRing"]) {
          const piece = scene.getObjectByName(`${name}_${side}`);
          if (piece) elbow.attach(piece);
        }
      }
      const helmet = scene.getObjectByName("HelmetShell");
      if (!helmet) throw new Error("Astronaut model is missing helmet pivot");
      this.neck = joint(scene, helmet, 0, 1.53, 0);
      for (const name of ["VisorFrame", "GoldVisor", "HelmetSidePort_L", "HelmetSidePort_R"]) {
        const piece = scene.getObjectByName(name);
        if (piece) this.neck.attach(piece);
      }
      this.kneeL = kneeL;
      this.kneeR = kneeR;
      this.ankleL = ankleL;
      this.ankleR = ankleR;
      this.elbowL = elbowL;
      this.elbowR = elbowR;
      scene.traverse((part) => {
        if (part instanceof Mesh) {
          part.castShadow = true;
          part.receiveShadow = true;
        }
      });
      this.body.add(scene);
      this.fallback.visible = false;
      this.pose();
      this.onModelReady?.();
    }).catch((error: unknown) => console.warn("Astronaut model unavailable; using procedural fallback", error));
  }

  setLamp(on: boolean): void {
    this.lamp.intensity = on ? 1.8 : 0;
  }

  reset(): void {
    this.position.copy(HOME);
    this.heading = 340;
    this.kneeling = false;
    this.vy = 0;
    this.lift = 0;
    this.phase = 0;
    this.stride = 0;
    this.moonwalk = 0;
    this.airborne = 0;
    this.landing = 0;
    this.atEdge = false;
  }

  obstacle(): Obstacle {
    return { x: this.position.x, z: this.position.z, r: BODY_R };
  }

  placeAt(x: number, z: number, heading: number, terrain: WalkTerrain): void {
    this.position.set(x, terrain.heightAt(x, z), z);
    this.heading = heading;
    this.kneeling = false;
    this.vy = 0;
    this.lift = 0;
    this.phase = 0;
    this.stride = 0;
    this.moonwalk = 0;
    this.airborne = 0;
    this.landing = 0;
    this.pose();
  }

  step(dt: number, d: Drive, terrain: WalkTerrain, obs: Obstacle[], reduced: boolean): boolean {
    const moving = d.forward !== 0 || d.turn !== 0 || d.jump;
    if (moving) this.kneeling = false;
    this.heading = (this.heading + d.turn * TURN * dt + 360) % 360;
    const v = d.forward * SPEED * (d.forward < 0 ? 0.6 : 1);
    let x = this.position.x + Math.sin(this.heading * RAD) * v * dt;
    let z = this.position.z - Math.cos(this.heading * RAD) * v * dt;
    [x, z] = pushOut(x, z, BODY_R, obs);
    const clamped = clampRadius(x, z, WALK_RADIUS_M);
    [x, z] = clamped;
    this.atEdge = clamped[2];
    if (d.jump && this.lift <= 0 && this.vy === 0) {
      this.vy = JUMP_V;
      this.landing = 0;
    }
    if (this.vy !== 0 || this.lift > 0) {
      const nextLift = this.lift + this.vy * dt - 0.5 * G_MOON * dt * dt;
      this.vy -= G_MOON * dt;
      if (nextLift <= 0) {
        if (this.lift > 0) this.landing = 1;
        this.lift = 0;
        this.vy = 0;
      } else this.lift = nextLift;
    }
    const inAir = this.lift > 0 || this.vy > 0;
    const travelled = Math.hypot(x - this.position.x, z - this.position.z);
    const actualSpeed = dt > 0 && v !== 0 ? travelled / dt : 0;
    const targetStride = !reduced && !inAir ? Math.min(1, actualSpeed / (v < 0 ? SPEED * 0.6 : SPEED)) : 0;
    const targetMoonwalk = !reduced && !inAir && v < 0 && actualSpeed > 0.01 ? 1 : 0;
    this.stride += (targetStride - this.stride) * (1 - Math.exp(-dt * (targetStride > this.stride ? 8 : 6)));
    this.moonwalk += (targetMoonwalk - this.moonwalk) * (1 - Math.exp(-dt * 7));
    if (v !== 0 && !inAir && !reduced) this.phase += travelled * (2 * Math.PI / STRIDE_METRES);
    this.airborne += ((inAir && !reduced ? 1 : 0) - this.airborne) * (1 - Math.exp(-dt * (inAir ? 8 : 12)));
    this.landing *= Math.exp(-dt * 12);
    this.position.set(x, terrain.heightAt(x, z) + this.lift, z);
    this.pose();
    return moving || inAir || this.stride > 0.01 || this.moonwalk > 0.01 || this.airborne > 0.01 || this.landing > 0.01;
  }

  private pose(): void {
    this.object.position.copy(this.position);
    this.object.rotation.y = -this.heading * RAD;
    if (this.kneeling) {
      this.body.position.y = -0.32;
      this.body.rotation.set(0, 0, 0);
      this.legL.rotation.x = clamp(-0.25, -HIP_LIMIT, HIP_LIMIT);
      this.legL.position.set(-0.14, 1.08, -0.28);
      this.legR.rotation.x = clamp(0.55, -HIP_LIMIT, HIP_LIMIT);
      this.legR.position.set(0.14, 0.82, 0.3);
      if (this.kneeL) this.kneeL.rotation.x = 0;
      if (this.kneeR) this.kneeR.rotation.x = 0;
      if (this.ankleL) this.ankleL.rotation.x = 0;
      if (this.ankleR) this.ankleR.rotation.x = 0;
      if (this.elbowL) this.elbowL.rotation.x = 0;
      if (this.elbowR) this.elbowR.rotation.x = 0;
      this.armR.rotation.x = clamp(-0.5, -SHOULDER_LIMIT, SHOULDER_LIMIT);
      this.armL.rotation.x = clamp(-0.5, -SHOULDER_LIMIT, SHOULDER_LIMIT);
      this.neck.rotation.set(0, 0, 0);
      return;
    }
    const wave = Math.sin(this.phase);
    const normal = 1 - this.moonwalk;
    const swing = wave * this.stride;
    const moon = this.moonwalk * this.stride;
    this.body.position.y = (1 - Math.cos(2 * this.phase)) * this.stride * normal * 0.025 - this.landing * 0.1;
    this.body.rotation.x = -this.stride * normal * 0.025 + this.airborne * 0.06;
    this.body.rotation.y = -swing * normal * 0.035;
    this.body.rotation.z = swing * normal * 0.02;
    this.legL.position.set(-0.14, 0.78, -Math.cos(this.phase) * moon * 0.3);
    this.legR.position.set(0.14, 0.78, Math.cos(this.phase) * moon * 0.3);
    this.legL.rotation.x = clamp(swing * normal * 0.44 + this.airborne * 0.12, -HIP_LIMIT, HIP_LIMIT);
    this.legR.rotation.x = clamp(-swing * normal * 0.44 + this.airborne * 0.12, -HIP_LIMIT, HIP_LIMIT);
    if (this.kneeL) this.kneeL.rotation.x = clamp(-Math.max(0, Math.cos(this.phase)) * this.stride * normal * 0.46 - Math.max(0, -wave) * moon * 0.36 - this.airborne * 0.42 - this.landing * 0.16, -KNEE_LIMIT, 0);
    if (this.kneeR) this.kneeR.rotation.x = clamp(-Math.max(0, -Math.cos(this.phase)) * this.stride * normal * 0.46 - Math.max(0, wave) * moon * 0.36 - this.airborne * 0.42 - this.landing * 0.16, -KNEE_LIMIT, 0);
    if (this.ankleL) this.ankleL.rotation.x = clamp(-Math.max(0, -wave) * moon * 0.6, -ANKLE_LIMIT, 0);
    if (this.ankleR) this.ankleR.rotation.x = clamp(-Math.max(0, wave) * moon * 0.6, -ANKLE_LIMIT, 0);
    this.armL.rotation.x = clamp(-swing * normal * 0.28 - wave * moon * 0.05 + this.airborne * 0.25, -SHOULDER_LIMIT, SHOULDER_LIMIT);
    this.armR.rotation.x = clamp(swing * normal * 0.28 + wave * moon * 0.05 + this.airborne * 0.25, -SHOULDER_LIMIT, SHOULDER_LIMIT);
    if (this.elbowL) this.elbowL.rotation.x = clamp(this.stride * normal * (0.08 + Math.max(0, -wave) * 0.14) + moon * 0.06, 0, ELBOW_LIMIT);
    if (this.elbowR) this.elbowR.rotation.x = clamp(this.stride * normal * (0.08 + Math.max(0, wave) * 0.14) + moon * 0.06, 0, ELBOW_LIMIT);
    this.neck.rotation.x = clamp(-this.body.rotation.x * 0.35, -NECK_LIMIT, NECK_LIMIT);
    this.neck.rotation.y = clamp(-this.body.rotation.y * 0.5, -NECK_LIMIT, NECK_LIMIT);
  }
}
