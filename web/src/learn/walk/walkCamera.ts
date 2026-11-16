import { Quaternion, Vector3 } from "three";
import { clamp } from "../../lib/scale";
import { RAD } from "../geometry";
import { FollowCamera } from "./followCamera";

export type WalkPov = "first" | "third";

type Ground = (x: number, z: number) => number;

const LOOK_LIMIT = 150;
const LANDING_INTRO_DURATION_MS = 1000;
const LANDING_INTRO_START_OFFSET = { up: 5.5, back: 2 };

export class WalkCamera {
  private readonly follow = new FollowCamera();
  private readonly look = new Vector3();
  pov: WalkPov = "third";
  private yaw = 0;
  private pitch = 0;
  private introMs: number | null = null;
  private readonly introOffset = new Vector3();
  private readonly normalRotation = new Quaternion();

  get camera() {
    return this.follow.camera;
  }

  get settling(): boolean {
    return this.introMs !== null || (this.pov === "third" && this.follow.settling);
  }

  get introActive(): boolean {
    return this.introMs !== null;
  }

  startLandingIntro(focus: Vector3, heading: number, reduced: boolean): void {
    this.introMs = null;
    if (reduced) return;
    const back = (heading + 180) * RAD;
    this.introOffset.set(
      Math.sin(back) * LANDING_INTRO_START_OFFSET.back,
      LANDING_INTRO_START_OFFSET.up,
      -Math.cos(back) * LANDING_INTRO_START_OFFSET.back,
    );
    this.introMs = 0;
    this.applyLandingIntro(focus, 0);
  }

  cancelLandingIntro(): void {
    this.introMs = null;
  }

  setDistance(m: number): void {
    this.follow.setDistance(m);
  }

  setPov(p: WalkPov, focus: Vector3, heading: number, ground: Ground): void {
    this.cancelLandingIntro();
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
    if (reduced) this.cancelLandingIntro();
    if (this.introMs !== null) {
      this.introMs = Math.min(LANDING_INTRO_DURATION_MS, this.introMs + dt * 1000);
      this.applyLandingIntro(focus, this.introMs / LANDING_INTRO_DURATION_MS);
      if (this.introMs >= LANDING_INTRO_DURATION_MS) this.cancelLandingIntro();
    }
  }

  private applyLandingIntro(focus: Vector3, progress: number): void {
    const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - ((2 - 2 * progress) ** 3) / 2;
    const remaining = 1 - eased;
    if (remaining === 0) return;
    const cam = this.camera;
    this.normalRotation.copy(cam.quaternion);
    cam.position.addScaledVector(this.introOffset, remaining);
    cam.lookAt(focus);
    cam.quaternion.slerp(this.normalRotation, 1 - remaining);
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
