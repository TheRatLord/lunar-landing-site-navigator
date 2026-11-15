import { AmbientLight, CylinderGeometry, DirectionalLight, Group, HemisphereLight, Mesh, MeshBasicMaterial, RingGeometry, Scene, Vector3 } from "three";
import { RAD } from "../geometry";
import type { RealSite } from "../terrain";
import type { SceneFrame, Shared } from "../scene/types";
import { Astronaut } from "./astronaut";
import { pushOut, type Obstacle } from "./collide";
import type { PropId } from "./facts";
import { WalkCamera, type WalkPov } from "./walkCamera";
import { PropSet } from "./props/propSet";
import { ROVER_HEADING, ROVER_HOME, Rover } from "./rover";
import { MISSION_SPOTS, type MissionSpot } from "./missions";
import { SolarPanel } from "./solarPanel";
import { WalkInput, type Drive } from "./walkInput";
import { WalkSky } from "./walkSky";
import { WalkTerrain } from "./walkTerrain";

export type WalkBody = "astronaut" | "rover";
export type WalkControl = { body: "astronaut"; seated: false } | { body: "rover"; seated: boolean };

const SHADOW_HALF = 75;
export const ENTER_ROVER_DISTANCE_M = 2.5;
const EXIT_SIDE_M = -2.1;
const IDLE: Drive = { forward: 0, turn: 0, jump: false };

const lane = (): Obstacle[] =>
  [4, 8, 12].map((d) => ({
    x: ROVER_HOME.x + Math.sin(ROVER_HEADING * RAD) * d,
    z: ROVER_HOME.z - Math.cos(ROVER_HEADING * RAD) * d,
    r: 2,
  }));

export class WalkView {
  readonly scene = new Scene();
  readonly input = new WalkInput();
  private readonly cam = new WalkCamera();
  private readonly terrain = new WalkTerrain();
  private readonly sky: WalkSky;
  private readonly astronaut = new Astronaut();
  private readonly rover = new Rover();
  private readonly panel = new SolarPanel();
  private readonly light = new DirectionalLight(0xffffff, 3.4);
  private readonly ambient = new AmbientLight(0xffffff, 0.05);
  private readonly bounce = new HemisphereLight(0x000000, 0x9a9a96, 0);
  private readonly sunDir = new Vector3(0, 1, 0);
  private readonly focus = new Vector3();
  private readonly eye = new Vector3();
  private readonly look = new Vector3();
  private fixed: Obstacle[] = [];
  private readonly props = new PropSet();
  private near: PropId | null = null;
  onNear: ((id: PropId | null) => void) | null = null;
  onModelReady: (() => void) | null = null;
  onTarget: ((metres: number | null, side: string) => void) | null = null;
  private readonly marker = new Group();
  private target: MissionSpot | null = null;
  private targetM: number | null = null;
  private targetSide = "";
  onRoverNear: ((near: boolean) => void) | null = null;
  private control: WalkControl = { body: "astronaut", seated: false };
  private nearRover = false;
  private frame: SceneFrame | null = null;
  private siteId = "";
  private edge = false;
  onEdge: ((atEdge: boolean) => void) | null = null;

  constructor(shared: Shared) {
    const glow = new MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.9, depthWrite: false });
    const ring = new Mesh(new RingGeometry(1.7, 2.3, 48).rotateX(-Math.PI / 2), glow);
    const beam = new Mesh(new CylinderGeometry(0.12, 0.12, 40, 8), new MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.35, depthWrite: false }));
    beam.position.y = 20;
    this.marker.add(ring, beam);
    this.marker.visible = false;
    this.rover.onModelReady = () => this.onModelReady?.();
    this.panel.onModelReady = () => this.onModelReady?.();
    this.astronaut.onModelReady = () => this.onModelReady?.();
    this.rover.setDriver(false, false);
    this.sky = new WalkSky(shared);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 2048);
    this.light.shadow.bias = -0.0006;
    this.light.shadow.normalBias = 0.6;
    this.light.shadow.radius = 1.5;
    const cam = this.light.shadow.camera;
    cam.left = -SHADOW_HALF;
    cam.right = SHADOW_HALF;
    cam.top = SHADOW_HALF;
    cam.bottom = -SHADOW_HALF;
    cam.near = 1;
    cam.far = 2000;
    cam.layers.enable(1);
    this.scene.add(
      this.sky.group,
      this.terrain.group,
      this.astronaut.object,
      this.rover.object,
      this.panel.object,
      this.props.group,
      this.marker,
      this.light,
      this.light.target,
      this.ambient,
      this.bounce,
    );
  }

  get camera() {
    return this.cam.camera;
  }

  setActive(on: boolean): void {
    this.input.setEnabled(on);
  }

  setControl(control: WalkControl): void {
    if (control.body === this.control.body && control.seated === this.control.seated) return;
    if (this.control.seated && !control.seated && control.body === "astronaut") this.exitAstronaut();
    this.control = control;
    this.input.clear();
    this.astronaut.kneeling = false;
    if (!control.seated) this.astronaut.step(0, IDLE, this.terrain, [], true);
    this.astronaut.object.visible = !control.seated;
    this.cam.setDistance(control.body === "rover" ? 10 : 7);
    this.aim();
    this.applyLayers();
    this.updateRoverNear();
    if (this.frame?.reducedMotion || this.cam.pov === "first") this.cam.snap(this.focus, this.eye, this.heading(), this.ground);
  }

  private exitAstronaut(): void {
    this.rover.object.updateMatrixWorld(true);
    const side = this.rover.object.localToWorld(new Vector3(EXIT_SIDE_M, 0, 0));
    const [x, z] = pushOut(side.x, side.z, 0.4, [...this.fixed, ...this.rover.obstacles()]);
    this.astronaut.placeAt(x, z, this.rover.heading, this.terrain);
  }

  private updateRoverNear(): void {
    const near = this.control.body === "astronaut" && Math.hypot(this.astronaut.position.x - this.rover.position.x, this.astronaut.position.z - this.rover.position.z) <= ENTER_ROVER_DISTANCE_M;
    if (near === this.nearRover) return;
    this.nearRover = near;
    this.onRoverNear?.(near);
  }

  setPov(p: WalkPov): void {
    if (p === this.cam.pov) return;
    this.aim();
    this.cam.setPov(p, this.focus, this.heading(), this.ground);
    this.applyLayers();
    this.cam.snap(this.focus, this.eye, this.heading(), this.ground);
    this.sky.group.position.copy(this.camera.position);
  }

  private applyLayers(): void {
    const hide = this.cam.pov === "first" && this.control.body === "astronaut";
    this.astronaut.object.traverse((o) => o.layers.set(hide ? 1 : 0));
    this.astronaut.lamp.layers.set(0);
    this.rover.setInside(this.cam.pov === "first" && this.control.body === "rover");
    this.rover.setDriver(this.control.seated, this.cam.pov === "first" && this.control.body === "rover");
  }

  setLights(on: boolean): void {
    this.rover.setLights(on);
    this.astronaut.setLamp(on);
  }

  lookAt(azDeg: number, elDeg: number): void {
    if (this.cam.pov !== "first") return;
    if (this.control.body === "astronaut") {
      this.astronaut.kneeling = false;
      this.astronaut.heading = azDeg;
    }
    this.aim();
    this.cam.aim(azDeg, elDeg, this.heading());
    this.cam.snap(this.focus, this.eye, this.heading(), this.ground);
    this.sky.group.position.copy(this.camera.position);
  }

  update(f: SceneFrame): void {
    this.frame = f;
    this.terrain.setSite(f.site as RealSite);
    this.panel.place(this.terrain);
    const placeKey = `${f.site.id}|${f.site.lat}|${f.site.lon}`;
    if (placeKey !== this.siteId) {
      this.siteId = placeKey;
      this.input.clear();
      this.fixed = [...this.props.build(f.site.id, this.terrain, [{ x: 0, z: 0, r: 4 }, this.panel.obstacle, ...lane(), ...MISSION_SPOTS.map((p) => ({ ...p, r: 4 }))], ROVER_HOME), this.panel.obstacle];
      this.near = null;
      this.onNear?.(null);
      this.astronaut.reset();
      this.rover.reset();
      if (this.control.body === "rover") this.astronaut.kneeling = false;
      this.settle();
      this.updateRoverNear();
    }
    this.props.place(this.terrain);
    this.rover.pose(this.terrain);
    this.sky.update(f.sky, f.site, f.d);
    this.sky.sunDir(this.sunDir);
    const sky = f.sky;
    const sunlit = sky.sunlight > 0.02;
    this.light.intensity = 3.4 * sky.sunlight;
    this.light.castShadow = sunlit;
    const earthshine = (0.02 + 0.06 * sky.earth.litFraction) * sky.earth.frac;
    this.ambient.intensity = sunlit ? 0.07 : (Math.PI / 1.6) * Math.max(0.012, earthshine);
    this.panel.update(this.sunDir, sky.sunlight > 0.5);
    this.bounce.intensity = 0.9 * sky.sunlight * (0.25 + Math.max(0, Math.sin(sky.sun.el * RAD)));
    this.placeLight();
  }

  private heading(): number {
    return this.control.body === "rover" ? this.rover.heading : this.astronaut.heading;
  }

  private aim(): void {
    if (this.control.body === "rover") {
      this.focus.copy(this.rover.position).setY(this.rover.position.y + 1.6);
      this.rover.object.updateMatrixWorld();
      this.rover.object.localToWorld(this.eye.set(-0.38, 1.75, -0.1));
    } else {
      const a = this.astronaut;
      this.focus.copy(a.position).setY(a.position.y + 1.2);
      this.eye.set(a.position.x + Math.sin(a.heading * RAD) * 0.12, a.position.y + 1.62, a.position.z - Math.cos(a.heading * RAD) * 0.12);
    }
  }

  private settle(): void {
    this.astronaut.step(0, IDLE, this.terrain, [], true);
    this.rover.step(0, IDLE, this.terrain, []);
    this.aim();
    this.cam.snap(this.focus, this.eye, this.heading(), this.ground);
    this.sky.group.position.copy(this.camera.position);
  }

  private readonly ground = (x: number, z: number) => this.terrain.heightAt(x, z);

  private placeLight(): void {
    this.light.target.position.copy(this.focus);
    this.light.position.copy(this.sunDir).multiplyScalar(900).add(this.focus);
    this.light.target.updateMatrixWorld();
  }

  step(dt: number, reduced: boolean): boolean {
    if (!this.frame) return false;
    const d = this.input.read();
    let moving: boolean;
    let edge: boolean;
    if (this.control.body === "rover") {
      moving = this.rover.step(dt, d, this.terrain, this.control.seated ? this.fixed : [...this.fixed, this.astronaut.obstacle()]);
      if (!this.control.seated) this.astronaut.step(dt, IDLE, this.terrain, [], reduced);
      edge = this.rover.atEdge;
    } else {
      moving = this.astronaut.step(dt, d, this.terrain, [...this.fixed, ...this.rover.obstacles()], reduced);
      edge = this.astronaut.atEdge;
    }
    this.updateRoverNear();
    if (edge !== this.edge) {
      this.edge = edge;
      this.onEdge?.(edge);
    }
    this.aim();
    const cp = this.camera.position;
    this.camera.getWorldDirection(this.look);
    const near = this.props.nearest(this.focus.x, this.focus.z, 9, (px, pz) => {
      const dx = px - cp.x;
      const dz = pz - cp.z;
      const n = Math.hypot(dx, dz);
      const m = Math.hypot(this.look.x, this.look.z);
      return n > 0 && m > 0 && (dx * this.look.x + dz * this.look.z) / (n * m) > Math.cos(35 * RAD);
    });
    if (near !== this.near) {
      this.near = near;
      this.onNear?.(near);
    }
    this.cam.step(dt, this.focus, this.eye, this.heading(), reduced, this.ground);
    this.sky.group.position.copy(this.camera.position);
    this.placeLight();
    this.trackTarget();
    return moving || this.cam.settling;
  }

  drag(dxDeg: number, dyDeg: number): void {
    if (this.cam.pov === "first" && this.control.body === "astronaut") {
      this.astronaut.kneeling = false;
      this.astronaut.heading = (this.astronaut.heading - dxDeg + 360) % 360;
      this.cam.orbit(0, dyDeg, false);
    } else this.cam.orbit(dxDeg, dyDeg, true);
  }

  setTarget(t: MissionSpot | null): void {
    this.target = t;
    this.marker.visible = t !== null;
    this.targetM = null;
    this.trackTarget();
  }

  private trackTarget(): void {
    const t = this.target;
    if (!t) {
      if (this.targetM !== null) this.onTarget?.(null, "");
      this.targetM = null;
      return;
    }
    this.marker.position.set(t.x, this.terrain.heightAt(t.x, t.z) + 0.05, t.z);
    const dx = t.x - this.rover.position.x;
    const dz = t.z - this.rover.position.z;
    const m = Math.round(Math.hypot(dx, dz));
    const rel = (((Math.atan2(dx, -dz) / RAD - this.rover.heading) % 360) + 540) % 360 - 180;
    const side = Math.abs(rel) < 35 ? "ahead" : Math.abs(rel) > 145 ? "behind you" : rel > 0 ? "to your right" : "to your left";
    if (m !== this.targetM || side !== this.targetSide) {
      this.targetM = m;
      this.targetSide = side;
      this.onTarget?.(m, side);
    }
  }

  dispose(): void {
    this.input.dispose();
    this.terrain.dispose();
    this.sky.dispose();
    this.light.shadow.map?.dispose();
  }
}
