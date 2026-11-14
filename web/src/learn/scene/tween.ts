import { Vector3, type PerspectiveCamera } from "three";

export interface Pose {
  pos: Vector3;
  target: Vector3;
  fov: number;
}

const easeInOutCubic = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

export class CameraTween {
  private from: Pose | null = null;
  private to: (() => Pose) | null = null;
  private start = 0;
  private dur = 1200;
  private done: (() => void) | null = null;

  get active(): boolean {
    return this.to !== null;
  }

  run(camera: PerspectiveCamera, target: Vector3, to: () => Pose, dur: number, now: number, done?: () => void) {
    this.from = { pos: camera.position.clone(), target: target.clone(), fov: camera.fov };
    this.to = to;
    this.start = now;
    this.dur = dur;
    this.done = done ?? null;
  }

  cancel() {
    this.to = null;
    this.from = null;
    this.done = null;
  }

  step(camera: PerspectiveCamera, target: Vector3, now: number): boolean {
    if (!this.to || !this.from) return false;
    const x = Math.min(1, (now - this.start) / this.dur);
    const e = easeInOutCubic(x);
    const goal = this.to();
    camera.position.lerpVectors(this.from.pos, goal.pos, e);
    target.lerpVectors(this.from.target, goal.target, e);
    camera.fov = this.from.fov + (goal.fov - this.from.fov) * e;
    camera.updateProjectionMatrix();
    camera.lookAt(target);
    if (x >= 1) {
      const cb = this.done;
      this.cancel();
      cb?.();
      return false;
    }
    return true;
  }
}
