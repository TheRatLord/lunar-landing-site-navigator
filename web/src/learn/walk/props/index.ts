import { Group, type Object3D } from "three";
import type { SiteId } from "../../sites";
import type { PropId } from "../facts";
import { apollo11 } from "./apollo11";
import { blueghost } from "./blueghost";
import { change4 } from "./change4";

export interface PropSpec {
  id: PropId | null;
  object: Object3D;
  x: number;
  z: number;
  r: number;
  walkOver?: boolean;
  decal?: boolean;
}

export function propsFor(site: SiteId): PropSpec[] {
  if (site === "apollo11") return apollo11();
  if (site === "change4") return change4();
  if (site === "blueghost") return blueghost();
  if (site === "rim" || site === "floor") return [{ id: "shackleton", object: new Group(), x: 0, z: 0, r: 0, walkOver: true }];
  return [];
}
