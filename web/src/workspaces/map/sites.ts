import type { SiteEntry } from "../../scenario/api";

export type SiteKind = SiteEntry["kind"];
export type Shape = "triangle" | "cross" | "diamond" | "square" | "ring" | "dot";

export interface KindStyle {
  label: string;
  shape: Shape;
  token: string;
  z: number;
}

export const KIND_STYLE: Record<SiteKind, KindStyle> = {
  planned: { label: "Planned", shape: "diamond", token: "c-sun", z: 6 },
  landed: { label: "Landed", shape: "triangle", token: "c-earth", z: 5 },
  not_landed: { label: "Not landed", shape: "square", token: "c-dark", z: 3 },
  impact: { label: "Impact", shape: "cross", token: "c-fail", z: 4 },
  region: { label: "Region", shape: "ring", token: "c-uncertainty", z: 2 },
  poi: { label: "Feature", shape: "dot", token: "text-2", z: 1 },
};

export const KIND_ORDER: readonly SiteKind[] = ["planned", "landed", "not_landed", "impact", "region", "poi"];
