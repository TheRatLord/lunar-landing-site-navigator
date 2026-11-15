import { BoxGeometry, CapsuleGeometry, Group, Mesh, MeshLambertMaterial, MeshPhongMaterial, SphereGeometry, Vector3 } from "three";
import { RAD } from "../geometry";
import { clampRadius, pushOut, type Obstacle } from "./collide";
import type { Drive } from "./walkInput";
import type { WalkTerrain } from "./walkTerrain";

export const WALK_RADIUS_M = 400;
const SPEED = 1.5;
const TURN = 110;
const G_MOON = 1.62;
const JUMP_V = 1.3;
const BODY_R = 0.4;
const HOME = new Vector3(0.76, 0, 0.49);

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

export class Astronaut {
  readonly object = new Group();
  readonly position = new Vector3();
  heading = 340;
  kneeling = true;
  atEdge = false;
  private readonly body = new Group();
  private readonly legL: Mesh;
  private readonly legR: Mesh;
  private readonly armL: Mesh;
  private readonly armR: Mesh;
  private vy = 0;
  private lift = 0;
  private phase = 0;

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
    this.body.add(this.legL, this.legR, torso, pack, panel, this.armL, this.armR, helmet, face);
    this.object.add(this.body);
    this.reset();
  }

  reset(): void {
    this.position.copy(HOME);
    this.heading = 340;
    this.kneeling = true;
    this.vy = 0;
    this.lift = 0;
    this.phase = 0;
    this.atEdge = false;
  }

  obstacle(): Obstacle {
    return { x: this.position.x, z: this.position.z, r: BODY_R };
  }

  step(dt: number, d: Drive, terrain: WalkTerrain, obs: Obstacle[], reduced: boolean): boolean {
    const moving = d.forward !== 0 || d.turn !== 0 || d.jump;
    if (moving) this.kneeling = false;
    this.heading = (this.heading + d.turn * TURN * dt + 360) % 360;
    const v = d.forward * SPEED * (d.forward < 0 ? 0.6 : 1);
    let x = this.position.x + Math.sin(this.heading * RAD) * v * dt;
    let z = this.position.z - Math.cos(this.heading * RAD) * v * dt;
    [x, z] = pushOut(x, z, BODY_R, obs);
    let edge: boolean;
    [x, z, edge] = clampRadius(x, z, WALK_RADIUS_M);
    this.atEdge = edge;
    if (d.jump && this.lift <= 0) this.vy = JUMP_V;
    if (this.vy !== 0 || this.lift > 0) {
      this.vy -= G_MOON * dt;
      this.lift = Math.max(0, this.lift + this.vy * dt);
      if (this.lift === 0) this.vy = 0;
    }
    const walking = v !== 0 && this.lift === 0;
    this.phase = walking ? this.phase + dt * 2.6 * Math.PI : 0;
    const hop = walking && !reduced ? Math.abs(Math.sin(this.phase)) * 0.12 : 0;
    this.position.set(x, terrain.heightAt(x, z) + this.lift, z);
    this.pose(hop, walking && !reduced ? Math.sin(this.phase) : 0);
    return moving || this.lift > 0;
  }

  private pose(hop: number, swing: number): void {
    this.object.position.copy(this.position);
    this.object.rotation.y = -this.heading * RAD;
    if (this.kneeling) {
      this.body.position.y = -0.32;
      this.legL.rotation.x = -0.25;
      this.legL.position.set(-0.14, 0.72, -0.28);
      this.legR.rotation.x = 1.45;
      this.legR.position.set(0.14, 0.46, 0.3);
      this.armR.rotation.x = -1.1;
      this.armL.rotation.x = -0.6;
      return;
    }
    this.body.position.y = hop;
    this.legL.position.set(-0.14, 0.42, 0);
    this.legR.position.set(0.14, 0.42, 0);
    this.legL.rotation.x = swing * 0.35;
    this.legR.rotation.x = -swing * 0.35;
    this.armL.rotation.x = -swing * 0.3;
    this.armR.rotation.x = swing * 0.3;
  }
}
