import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshLambertMaterial, MeshPhongMaterial, Vector3 } from "three";
import type { Obstacle } from "./collide";
import type { WalkTerrain } from "./walkTerrain";

const X = -2.5;
const Z = 5.5;
const MAST = 1.6;

export class SolarPanel {
  readonly object = new Group();
  readonly obstacle: Obstacle = { x: X, z: Z, r: 0.9 };
  private readonly head = new Group();
  private readonly cells: MeshPhongMaterial;
  private readonly look = new Vector3();

  constructor() {
    const metal = new MeshLambertMaterial({ color: 0xb9bcc2 });
    const mast = new Mesh(new CylinderGeometry(0.05, 0.07, MAST, 10), metal);
    mast.position.y = MAST / 2;
    const foot = new Mesh(new CylinderGeometry(0.5, 0.6, 0.08, 16), metal);
    foot.position.y = 0.04;
    this.cells = new MeshPhongMaterial({ color: 0x1b2a55, specular: 0x8aa0ff, shininess: 70, emissive: 0x000000 });
    const panel = new Mesh(new BoxGeometry(2, 1, 0.05), this.cells);
    const frame = new Mesh(new BoxGeometry(2.08, 1.08, 0.03), metal);
    frame.position.z = -0.03;
    const hinge = new Mesh(new BoxGeometry(0.12, 0.12, 0.2), metal);
    hinge.position.z = -0.1;
    this.head.add(panel, frame, hinge);
    this.head.position.y = MAST;
    this.object.add(foot, mast, this.head);
    this.object.traverse((o) => {
      if (o instanceof Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }

  place(terrain: WalkTerrain): void {
    this.object.position.set(X, terrain.heightAt(X, Z), Z);
  }

  update(sunDir: Vector3, lit: boolean): void {
    const up = Math.max(sunDir.y, 0.05);
    this.look.set(sunDir.x, up, sunDir.z).normalize().multiplyScalar(10);
    this.look.add(this.head.getWorldPosition(new Vector3()));
    this.head.lookAt(this.look);
    this.cells.emissive.setHex(lit ? 0x1c3a8c : 0x000000);
    this.cells.emissiveIntensity = lit ? 0.6 : 0;
  }
}
