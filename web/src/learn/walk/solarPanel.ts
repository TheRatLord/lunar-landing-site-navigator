import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshLambertMaterial, MeshPhongMaterial, MeshStandardMaterial, Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Vector3 } from "three";
import panelUrl from "./models/solar_panel.glb?url";
import type { Obstacle } from "./collide";
import type { WalkTerrain } from "./walkTerrain";

const X = 3.5;
const Z = -3.5;
const MAST = 1.6;

type Glow = MeshPhongMaterial | MeshStandardMaterial;

export class SolarPanel {
  readonly object = new Group();
  readonly obstacle: Obstacle = { x: X, z: Z, r: 0.9 };
  onModelReady: (() => void) | null = null;
  private yaw: Object3D;
  private pitch: Object3D;
  private cells: Glow;

  constructor() {
    const simple = new Group();
    const metal = new MeshLambertMaterial({ color: 0xb9bcc2 });
    const mast = new Mesh(new CylinderGeometry(0.05, 0.07, MAST, 10), metal);
    mast.position.y = MAST / 2;
    const foot = new Mesh(new CylinderGeometry(0.5, 0.6, 0.08, 16), metal);
    foot.position.y = 0.04;
    this.cells = new MeshPhongMaterial({ color: 0x1b2a55, specular: 0x8aa0ff, shininess: 70, emissive: 0x000000 });
    const head = new Group();
    head.position.y = MAST;
    const array = new Group();
    array.add(new Mesh(new BoxGeometry(2, 1, 0.05), this.cells));
    head.add(array);
    simple.add(foot, mast, head);
    this.yaw = head;
    this.pitch = array;
    this.shadows(simple);
    this.object.add(simple);
    void new GLTFLoader().loadAsync(panelUrl).then(({ scene }) => {
      const yaw = scene.getObjectByName("Head");
      const pitch = scene.getObjectByName("Array");
      let cells: Glow | null = null;
      scene.traverse((o) => {
        if (o instanceof Mesh && (o.material as MeshStandardMaterial).name === "Cells") cells = o.material as MeshStandardMaterial;
      });
      if (!yaw || !pitch || !cells) return;
      this.shadows(scene);
      yaw.rotation.copy(this.yaw.rotation);
      pitch.rotation.copy(this.pitch.rotation);
      this.yaw = yaw;
      this.pitch = pitch;
      this.cells = cells;
      this.object.remove(simple);
      this.object.add(scene);
      this.onModelReady?.();
    });
  }

  private shadows(root: Object3D): void {
    root.traverse((o) => {
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
    this.yaw.rotation.y = Math.atan2(sunDir.x, sunDir.z);
    this.pitch.rotation.x = -Math.asin(Math.max(0.05, Math.min(1, sunDir.y)));
    this.cells.emissive.setHex(lit ? 0x1c3a8c : 0x000000);
    this.cells.emissiveIntensity = lit ? 0.6 : 0;
  }
}
