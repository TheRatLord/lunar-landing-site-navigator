import { Group } from "three";
import { disposeTree } from "../../../lib/three";
import type { SiteId } from "../../sites";
import type { Obstacle } from "../collide";
import type { PropId } from "../facts";
import type { WalkTerrain } from "../walkTerrain";
import { propsFor, type PropSpec } from "./index";

export class PropSet {
  readonly group = new Group();
  private specs: PropSpec[] = [];

  build(id: SiteId, terrain: WalkTerrain, keepClear: Obstacle[], from: { x: number; z: number }): Obstacle[] {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      disposeTree(c);
    }
    this.specs = propsFor(id);
    for (const p of this.specs) this.group.add(p.object);
    const solid = this.specs.filter((p) => !p.walkOver).map((p) => ({ x: p.x, z: p.z, r: p.r }));
    const paths = this.specs
      .filter((p) => p.id && p.r > 0)
      .flatMap((p) => {
        const len = Math.hypot(p.x - from.x, p.z - from.z);
        const n = Math.ceil(len / 2);
        return Array.from({ length: n + 1 }, (_, i) => ({ x: from.x + ((p.x - from.x) * i) / n, z: from.z + ((p.z - from.z) * i) / n, r: 1 }));
      });
    terrain.setClearings([...keepClear, ...paths, ...solid]);
    return [...terrain.rockObstacles(), ...solid];
  }

  place(terrain: WalkTerrain): void {
    for (const p of this.specs) {
      if (p.decal) {
        for (const c of p.object.children) c.position.y = terrain.heightAt(c.position.x, c.position.z) + 0.02;
      } else p.object.position.set(p.x, terrain.heightAt(p.x, p.z), p.z);
    }
  }

  nearest(x: number, z: number, within: number, seen: (px: number, pz: number) => boolean = () => true): PropId | null {
    let best: PropId | null = null;
    let bestD = Infinity;
    for (const p of this.specs) {
      if (!p.id) continue;
      const d = Math.hypot(x - p.x, z - p.z) - p.r;
      if (d > 2 && !seen(p.x, p.z)) continue;
      if (d <= within && d < bestD) {
        best = p.id;
        bestD = d;
      }
    }
    return best;
  }
}
