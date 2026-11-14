import { PerspectiveCamera, Vector3 } from "three";
import { clamp } from "../../lib/scale";
import { RAD } from "../geometry";

const DIST = 7;
const MIN_PITCH = 5;
const MAX_PITCH = 60;

export class FollowCamera {
  readonly camera = new PerspectiveCamera(55, 1, 0.1, 9000);
  private yawOffset = 0;
  private pitch = 15;
  private dist = DIST;
  private readonly at = new Vector3();
  private readonly goal = new Vector3();
  private yaw = 0;
  settling = false;

  setDistance(m: number): void {
    this.dist = m;
  }

  orbit(dxDeg: number, dyDeg: number): void {
    this.yawOffset -= dxDeg;
    this.pitch = clamp(this.pitch + dyDeg, MIN_PITCH, MAX_PITCH);
  }

  snap(target: Vector3, heading: number, ground: (x: number, z: number) => number): void {
    this.yaw = heading + this.yawOffset;
    this.at.copy(target);
    this.place(ground);
  }

  step(dt: number, target: Vector3, heading: number, reduced: boolean, ground: (x: number, z: number) => number): void {
    const want = heading + this.yawOffset;
    let dy = ((want - this.yaw + 540) % 360) - 180;
    const k = reduced ? 1 : 1 - Math.exp(-dt * 5);
    this.yaw += dy * k;
    this.at.lerp(target, reduced ? 1 : 1 - Math.exp(-dt * 10));
    dy = ((want - this.yaw + 540) % 360) - 180;
    this.settling = Math.abs(dy) > 0.05 || this.at.distanceToSquared(target) > 1e-4;
    this.place(ground);
  }

  private place(ground: (x: number, z: number) => number): void {
    const back = this.yaw + 180;
    const h = this.dist * Math.cos(this.pitch * RAD);
    this.goal.set(
      this.at.x + Math.sin(back * RAD) * h,
      this.at.y + this.dist * Math.sin(this.pitch * RAD),
      this.at.z - Math.cos(back * RAD) * h,
    );
    this.goal.y = Math.max(this.goal.y, ground(this.goal.x, this.goal.z) + 0.5);
    this.camera.position.copy(this.goal);
    this.camera.lookAt(this.at);
  }
}
