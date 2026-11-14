import { AmbientLight, DirectionalLight, Scene, Vector3 } from "three";
import type { RealSite } from "../terrain";
import type { SceneFrame, Shared } from "../scene/types";
import { FollowCamera } from "./followCamera";
import { WalkSky } from "./walkSky";
import { WalkTerrain } from "./walkTerrain";

const SHADOW_HALF = 75;

export class WalkView {
  readonly scene = new Scene();
  private readonly follow = new FollowCamera();
  private readonly terrain = new WalkTerrain();
  private readonly sky: WalkSky;
  private readonly light = new DirectionalLight(0xffffff, 3.4);
  private readonly ambient = new AmbientLight(0xffffff, 0.05);
  private readonly sunDir = new Vector3(0, 1, 0);
  private readonly focus = new Vector3(0, 1.2, 0);
  private heading = 90;
  private frame: SceneFrame | null = null;
  private sunlit = false;

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
    this.scene.add(this.sky.group, this.terrain.group, this.light, this.light.target, this.ambient);
  }

  get camera() {
    return this.follow.camera;
  }

  update(f: SceneFrame): void {
    const first = this.frame === null;
    this.frame = f;
    this.terrain.setSite(f.site as RealSite);
    this.sky.update(f.sky, f.site, f.d);
    this.sky.sunDir(this.sunDir);
    const sky = f.sky;
    this.sunlit = sky.sunlight > 0.02;
    this.light.intensity = 3.4 * sky.sunlight;
    this.light.castShadow = this.sunlit;
    const earthshine = (0.02 + 0.06 * sky.earth.litFraction) * sky.earth.frac;
    this.ambient.intensity = this.sunlit ? 0.07 : (Math.PI / 1.6) * Math.max(0.012, earthshine);
    this.placeLight();
    if (first) this.follow.snap(this.focus, this.heading, this.ground);
  }

  private readonly ground = (x: number, z: number) => this.terrain.heightAt(x, z);

  private placeLight(): void {
    this.light.target.position.set(this.focus.x, this.focus.y, this.focus.z);
    this.light.position.copy(this.sunDir).multiplyScalar(900).add(this.light.target.position);
    this.light.target.updateMatrixWorld();
  }

  step(dt: number, reduced: boolean): boolean {
    this.focus.y = this.terrain.heightAt(this.focus.x, this.focus.z) + 1.2;
    this.follow.step(dt, this.focus, this.heading, reduced, this.ground);
    this.sky.group.position.copy(this.camera.position);
    this.placeLight();
    return this.follow.settling;
  }

  drag(dxDeg: number, dyDeg: number): void {
    this.follow.orbit(dxDeg, dyDeg);
  }

  dispose(): void {
    this.terrain.dispose();
    this.sky.dispose();
    this.light.shadow.map?.dispose();
  }
}
