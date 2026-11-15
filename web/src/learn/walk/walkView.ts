import { AmbientLight, DirectionalLight, Group, HemisphereLight, Scene, Vector3 } from "three";
import { disposeTree } from "../../lib/three";
import { RAD } from "../geometry";
import type { RealSite } from "../terrain";
import type { SceneFrame, Shared } from "../scene/types";
import { Astronaut } from "./astronaut";
import type { Obstacle } from "./collide";
import type { PropId } from "./facts";
import { FollowCamera } from "./followCamera";
import { propsFor, type PropSpec } from "./props";
import { Rover } from "./rover";
import { SolarPanel } from "./solarPanel";
import { WalkInput, type Drive } from "./walkInput";
import { WalkSky } from "./walkSky";
import { WalkTerrain } from "./walkTerrain";

export type WalkBody = "astronaut" | "rover";

const SHADOW_HALF = 75;
const IDLE: Drive = { forward: 0, turn: 0, jump: false };

export class WalkView {
  readonly scene = new Scene();
  readonly input = new WalkInput();
  private readonly follow = new FollowCamera();
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
  private fixed: Obstacle[] = [];
  private readonly propGroup = new Group();
  private props: PropSpec[] = [];
  private near: PropId | null = null;
  onNear: ((id: PropId | null) => void) | null = null;
  private body: WalkBody = "astronaut";
  private frame: SceneFrame | null = null;
  private siteId = "";
  private edge = false;
  onEdge: ((atEdge: boolean) => void) | null = null;

  constructor(shared: Shared) {
    this.sky = new WalkSky(shared);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 2048);
    this.light.shadow.bias = -0.0006;
    this.light.shadow.normalBias = 0.6;
    const cam = this.light.shadow.camera;
    cam.left = -SHADOW_HALF;
    cam.right = SHADOW_HALF;
    cam.top = SHADOW_HALF;
    cam.bottom = -SHADOW_HALF;
    cam.near = 1;
    cam.far = 2000;
    this.scene.add(
      this.sky.group,
      this.terrain.group,
      this.astronaut.object,
      this.rover.object,
      this.panel.object,
      this.propGroup,
      this.light,
      this.light.target,
      this.ambient,
      this.bounce,
    );
  }

  get camera() {
    return this.follow.camera;
  }

  setActive(on: boolean): void {
    this.input.setEnabled(on);
  }

  setBody(b: WalkBody): void {
    if (b === this.body) return;
    this.body = b;
    this.input.clear();
    if (b === "rover") this.astronaut.kneeling = false;
    this.follow.setDistance(b === "rover" ? 10 : 7);
    this.aim();
    if (this.frame?.reducedMotion) this.follow.snap(this.focus, this.heading(), this.ground);
  }

  update(f: SceneFrame): void {
    this.frame = f;
    this.terrain.setSite(f.site as RealSite);
    this.panel.place(this.terrain);
    if (f.site.id !== this.siteId) {
      this.siteId = f.site.id;
      this.input.clear();
      this.buildProps(f.site.id);
      this.astronaut.reset();
      this.rover.reset();
      this.settle();
    }
    this.placeProps();
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

  private buildProps(id: SceneFrame["site"]["id"]): void {
    for (const c of [...this.propGroup.children]) {
      this.propGroup.remove(c);
      disposeTree(c);
    }
    this.props = propsFor(id);
    for (const p of this.props) this.propGroup.add(p.object);
    const solid = this.props.filter((p) => !p.walkOver);
    this.terrain.setClearings([{ x: 0, z: 0, r: 4 }, this.panel.obstacle, ...solid]);
    this.fixed = [...this.terrain.rockObstacles(), this.panel.obstacle, ...solid.map((p) => ({ x: p.x, z: p.z, r: p.r }))];
    this.near = null;
    this.onNear?.(null);
  }

  private placeProps(): void {
    for (const p of this.props) {
      if (p.decal) {
        for (const c of p.object.children) c.position.y = this.terrain.heightAt(c.position.x, c.position.z) + 0.02;
      } else p.object.position.set(p.x, this.terrain.heightAt(p.x, p.z), p.z);
    }
  }

  private checkNear(x: number, z: number): void {
    let best: PropId | null = null;
    let bestD = Infinity;
    for (const p of this.props) {
      if (!p.id) continue;
      const d = Math.hypot(x - p.x, z - p.z) - p.r;
      if (d <= 8 && d < bestD) {
        best = p.id;
        bestD = d;
      }
    }
    if (best !== this.near) {
      this.near = best;
      this.onNear?.(best);
    }
  }

  private heading(): number {
    return this.body === "rover" ? this.rover.heading : this.astronaut.heading;
  }

  private aim(): void {
    if (this.body === "rover") this.focus.copy(this.rover.position).setY(this.rover.position.y + 1.6);
    else this.focus.copy(this.astronaut.position).setY(this.astronaut.position.y + 1.2);
  }

  private settle(): void {
    this.astronaut.step(0, IDLE, this.terrain, [], true);
    this.rover.step(0, IDLE, this.terrain, []);
    this.aim();
    this.follow.snap(this.focus, this.heading(), this.ground);
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
    if (this.body === "rover") {
      moving = this.rover.step(dt, d, this.terrain, [...this.fixed, this.astronaut.obstacle()]);
      this.astronaut.step(dt, IDLE, this.terrain, [], reduced);
      edge = this.rover.atEdge;
    } else {
      moving = this.astronaut.step(dt, d, this.terrain, [...this.fixed, ...this.rover.obstacles()], reduced);
      edge = this.astronaut.atEdge;
    }
    if (edge !== this.edge) {
      this.edge = edge;
      this.onEdge?.(edge);
    }
    this.aim();
    this.checkNear(this.focus.x, this.focus.z);
    this.follow.step(dt, this.focus, this.heading(), reduced, this.ground);
    this.sky.group.position.copy(this.camera.position);
    this.placeLight();
    return moving || this.follow.settling;
  }

  drag(dxDeg: number, dyDeg: number): void {
    this.follow.orbit(dxDeg, dyDeg);
  }

  dispose(): void {
    this.input.dispose();
    this.terrain.dispose();
    this.sky.dispose();
    this.light.shadow.map?.dispose();
  }
}
