import { BufferAttribute, InstancedMesh, Matrix4, Mesh, MeshLambertMaterial, Object3D, PlaneGeometry, Quaternion, Vector3, Group } from "three";
import { heightAt, type RealSite } from "../terrain";
import { detailHeight, lunarSoil, regolithAlbedo, regolithNormalMap, rockColorMap, rockGeometry, rockNormalMap } from "../scene/surface";
import { rng } from "../scene/textures";

export const WALK_HALF_M = 500;
const N = 401;
const STEP = (2 * WALK_HALF_M) / (N - 1);
const N_ROCK_SHAPES = 6;
const ROCKS_PER_SHAPE = 60;

interface Hill {
  x: number;
  z: number;
  s: number;
  h: number;
}

const HILLS: Hill[] = (() => {
  const r = rng(77);
  return Array.from({ length: 40 }, () => ({
    x: (r() - 0.5) * 1100,
    z: (r() - 0.5) * 1100,
    s: 20 + r() * 90,
    h: (r() - 0.5) * (r() < 0.2 ? 9 : 3),
  }));
})();

function rolling(x: number, z: number): number {
  let h = 0;
  for (const b of HILLS) h += b.h * Math.exp(-((x - b.x) ** 2 + (z - b.z) ** 2) / (2 * b.s * b.s));
  return h;
}

export class WalkTerrain {
  readonly group = new Group();
  private readonly geo = new PlaneGeometry(2 * WALK_HALF_M, 2 * WALK_HALF_M, N - 1, N - 1).rotateX(-Math.PI / 2);
  private readonly heights = new Float32Array(N * N);
  private readonly rocks: InstancedMesh[] = [];
  private readonly rockSpots: { x: number; z: number; s: number; y: number; rot: number; tilt: number }[] = [];
  private key = "";
  private clearings: { x: number; z: number; r: number }[] = [];
  real = false;

  constructor() {
    const albedo = regolithAlbedo();
    albedo.repeat.set(1 / 7, 1 / 7);
    const uv = this.geo.getAttribute("uv") as BufferAttribute;
    const pos = this.geo.getAttribute("position") as BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), -pos.getZ(i));
    const mat = lunarSoil(new MeshLambertMaterial({ map: albedo, normalMap: regolithNormalMap(3) }));
    mat.normalScale.set(1.6, 1.6);
    mat.color.setScalar(1.05);
    const mesh = new Mesh(this.geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.group.add(mesh);

    const r = rng(41);
    const rockMat = lunarSoil(new MeshLambertMaterial({ map: rockColorMap(), normalMap: rockNormalMap() }));
    rockMat.color.setScalar(1.15);
    rockMat.normalScale.set(0.6, 0.6);
    for (let k = 0; k < N_ROCK_SHAPES; k++) {
      const im = new InstancedMesh(rockGeometry(51 + k), rockMat, ROCKS_PER_SHAPE);
      im.castShadow = true;
      im.receiveShadow = true;
      this.rocks.push(im);
      this.group.add(im);
    }
    for (let i = 0; i < N_ROCK_SHAPES * ROCKS_PER_SHAPE; i++) {
      const dist = 6 + r() ** 1.6 * 380;
      const az = r() * Math.PI * 2;
      this.rockSpots.push({
        x: Math.sin(az) * dist,
        z: -Math.cos(az) * dist,
        s: 0.1 + r() ** 3.5 * 2.2,
        y: 0,
        rot: r() * Math.PI * 2,
        tilt: (r() - 0.5) * 0.5,
      });
    }
  }

  setSite(site: RealSite): void {
    const key = `${site.id}|${site.terrain ? "dem" : "sim"}`;
    if (key === this.key) return;
    this.key = key;
    const patch = site.terrain?.patch ?? null;
    this.real = !!patch;
    const pos = this.geo.getAttribute("position") as BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const base = patch ? heightAt(patch, x, -z) : rolling(x, z) - rolling(0, 0);
      const n = -z;
      const o = STEP * 0.3;
      const h =
        base + 0.25 * (detailHeight(x - o, n - o) + detailHeight(x + o, n - o) + detailHeight(x - o, n + o) + detailHeight(x + o, n + o));
      this.heights[i] = h;
      pos.setY(i, h);
    }
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
    this.placeRocks();
  }

  setClearings(c: { x: number; z: number; r: number }[]): void {
    this.clearings = c;
    this.placeRocks();
  }

  private cleared(x: number, z: number): boolean {
    return this.clearings.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 2);
  }

  private placeRocks(): void {
    const m = new Matrix4();
    const q = new Quaternion();
    const o = new Object3D();
    const s = new Vector3();
    this.rockSpots.forEach((rk, i) => {
      const im = this.rocks[i % N_ROCK_SHAPES]!;
      o.rotation.set(rk.tilt, rk.rot, rk.tilt * 0.6);
      q.copy(o.quaternion);
      const k = this.cleared(rk.x, rk.z) ? 0 : 1;
      s.set(rk.s * k, rk.s * 0.6 * k, rk.s * 0.9 * k);
      m.compose(new Vector3(rk.x, this.heightAt(rk.x, rk.z) + rk.s * 0.12, rk.z), q, s);
      im.setMatrixAt(Math.floor(i / N_ROCK_SHAPES), m);
    });
    for (const im of this.rocks) {
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    }
  }

  rockObstacles(): { x: number; z: number; r: number }[] {
    return this.rockSpots.filter((rk) => rk.s > 0.6 && !this.cleared(rk.x, rk.z)).map((rk) => ({ x: rk.x, z: rk.z, r: rk.s * 0.8 }));
  }

  heightAt(x: number, z: number): number {
    const fx = Math.min(N - 1.001, Math.max(0, (x + WALK_HALF_M) / STEP));
    const fz = Math.min(N - 1.001, Math.max(0, (z + WALK_HALF_M) / STEP));
    const c = Math.floor(fx);
    const r = Math.floor(fz);
    const tx = fx - c;
    const tz = fz - r;
    const h = this.heights;
    const i = r * N + c;
    if (tx + tz <= 1) return h[i]! + (h[i + 1]! - h[i]!) * tx + (h[i + N]! - h[i]!) * tz;
    return h[i + N + 1]! + (h[i + N]! - h[i + N + 1]!) * (1 - tx) + (h[i + 1]! - h[i + N + 1]!) * (1 - tz);
  }

  normalAt(x: number, z: number, out: Vector3): Vector3 {
    const d = 0.75;
    const hx = this.heightAt(x + d, z) - this.heightAt(x - d, z);
    const hz = this.heightAt(x, z + d) - this.heightAt(x, z - d);
    return out.set(-hx, 2 * d, -hz).normalize();
  }

  dispose(): void {
    this.geo.dispose();
    for (const im of this.rocks) im.dispose();
  }
}
