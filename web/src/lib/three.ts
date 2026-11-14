import type { Material, Mesh, Object3D, Texture } from "three";

export function disposeTree(root: Object3D): void {
  root.traverse((o) => {
    const m = o as Mesh;
    m.geometry?.dispose();
    const mats = (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) as (Material & { map?: Texture | null })[];
    for (const mat of mats) {
      mat.map?.dispose();
      mat.dispose();
    }
  });
}
