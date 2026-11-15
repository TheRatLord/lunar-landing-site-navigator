import { Mesh, type Group, type Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const loader = new GLTFLoader();

export const propModels: { onReady: (() => void) | null } = { onReady: null };

export function swapIn(group: Group, url: string, keep: Object3D[] = []): Group {
  void loader
    .loadAsync(url)
    .then(({ scene }) => {
      scene.traverse((o) => {
        if (o instanceof Mesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      for (const c of [...group.children]) if (!keep.includes(c)) group.remove(c);
      group.add(scene);
      propModels.onReady?.();
    })
    .catch((e: unknown) => console.warn("Prop model unavailable; keeping the simple shape", e));
  return group;
}
