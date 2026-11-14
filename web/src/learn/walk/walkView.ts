import { AmbientLight, DirectionalLight, HemisphereLight, Scene, Vector3 } from "three";
import { RAD } from "../geometry";
import type { RealSite } from "../terrain";
import type { SceneFrame, Shared } from "../scene/types";
import { Astronaut } from "./astronaut";
import type { Obstacle } from "./collide";
import { FollowCamera } from "./followCamera";
import { WalkInput } from "./walkInput";
import { WalkSky } from "./walkSky";
import { WalkTerrain } from "./walkTerrain";

const SHADOW_HALF = 75;
const CHEST = 1.2;

export class WalkView {
  readonly scene = new Scene();
  readonly input = new WalkInput();
  private readonly follow = new FollowCamera();
  private readonly terrain = new WalkTerrain();
  private readonly sky: WalkSky;
  private readonly astronaut = new Astronaut();
  private readonly light = new DirectionalLight(0xffffff, 3.4);
  private readonly ambient = new AmbientLight(0xffffff, 0.05);
  private readonly bounce = new HemisphereLight(0x000000, 0x9a9a96, 0);
  private readonly sunDir = new Vector3(0, 1, 0);
  private readonly focus = new Vector3();
  private obstacles: Obstacle[] = [];
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
    this.scene.add(this.sky.group, this.terrain.group, this.astronaut.object, this.light, this.light.target, this.ambient, this.bounce);
  }

  get camera() {
    return this.follow.camera;
  }

  setActive(on: boolean): void {
    this.input.setEnabled(on);
  }

  update(f: SceneFrame): void {
    this.frame = f;
    this.terrain.setSite(f.site as RealSite);
    if (f.site.id !== this.siteId) {
      this.siteId = f.site.id;
      this.input.clear();
      this.obstacles = this.terrain.rockObstacles();
      this.astronaut.reset();
      this.settle();
    }
    this.sky.update(f.sky, f.site, f.d);
    this.sky.sunDir(this.sunDir);
    const sky = f.sky;
    const sunlit = sky.sunlight > 0.02;
    this.light.intensity = 3.4 * sky.sunlight;
    this.light.castShadow = sunlit;
    const earthshine = (0.02 + 0.06 * sky.earth.litFraction) * sky.earth.frac;
    this.ambient.intensity = sunlit ? 0.07 : (Math.PI / 1.6) * Math.max(0.012, earthshine);
    this.bounce.intensity = 0.9 * sky.sunlight * (0.25 + Math.max(0, Math.sin(sky.sun.el * RAD)));
    this.placeLight();
  }

  private settle(): void {
    const a = this.astronaut;
    a.step(0, { forward: 0, turn: 0, jump: false }, this.terrain, [], true);
    this.focus.copy(a.position).setY(a.position.y + CHEST);
    this.follow.snap(this.focus, a.heading, this.ground);
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
    const a = this.astronaut;
    const moving = a.step(dt, this.input.read(), this.terrain, this.obstacles, reduced);
    if (a.atEdge !== this.edge) {
      this.edge = a.atEdge;
      this.onEdge?.(this.edge);
    }
    this.focus.copy(a.position).setY(a.position.y + CHEST);
    this.follow.step(dt, this.focus, a.heading, reduced, this.ground);
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
