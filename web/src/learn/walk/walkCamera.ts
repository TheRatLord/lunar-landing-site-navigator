import { Vector3 } from "three";
import { clamp } from "../../lib/scale";
import { RAD } from "../geometry";
import { FollowCamera } from "./followCamera";

export type WalkPov = "first" | "third";

type Ground = (x: number, z: number) => number;

const LOOK_LIMIT = 150;

export class WalkCamera {
  private readonly follow = new FollowCamera();
  private readonly look = new Vector3();
  pov: WalkPov = "third";
  private yaw = 0;
  private pitch = 0;

  get camera() {
    return this.follow.camera;
  }

  get settling(): boolean {
    return this.pov === "third" && this.follow.settling;
  }

  setDistance(m: number): void {
    this.follow.setDistance(m);
  }

  setPov(p: WalkPov, focus: Vector3, heading: number, ground: Ground): void {
    this.pov = p;
    this.yaw = 0;
    this.pitch = 0;
    if (p === "third") this.follow.snap(focus, heading, ground);
  }

  orbit(dxDeg: number, dyDeg: number, freeYaw: boolean): void {
    if (this.pov === "third") {
      this.follow.orbit(dxDeg, dyDeg);
      return;
    }
    if (freeYaw) this.yaw = clamp(this.yaw - dxDeg, -LOOK_LIMIT, LOOK_LIMIT);
    this.pitch = clamp(this.pitch - dyDeg, -80, 60);
  }

  aim(azDeg: number, elDeg: number, heading: number): void {
    this.yaw = clamp(((azDeg - heading + 540) % 360) - 180, -LOOK_LIMIT, LOOK_LIMIT);
    this.pitch = clamp(-elDeg, -80, 60);
  }

  snap(focus: Vector3, eye: Vector3, heading: number, ground: Ground): void {
    if (this.pov === "third") this.follow.snap(focus, heading, ground);
    else this.placeEye(eye, heading);
  }

  step(dt: number, focus: Vector3, eye: Vector3, heading: number, reduced: boolean, ground: Ground): void {
    if (this.pov === "third") this.follow.step(dt, focus, heading, reduced, ground);
    else this.placeEye(eye, heading);
  }

  private placeEye(eye: Vector3, heading: number): void {
    const h = (heading + this.yaw) * RAD;
    const p = this.pitch * RAD;
    const cam = this.camera;
    cam.position.copy(eye);
    this.look.set(eye.x + Math.sin(h) * Math.cos(p), eye.y - Math.sin(p), eye.z - Math.cos(h) * Math.cos(p));
    cam.lookAt(this.look);
  }
}
