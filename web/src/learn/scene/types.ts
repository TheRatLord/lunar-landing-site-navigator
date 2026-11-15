import type { Follow, ViewKind } from "../chapters";
import type { SkyState, SpaceState } from "../geometry";
import type { Site } from "../sites";
import type { ChapterKey } from "../store";

export type { ViewKind };

export interface SceneFrame {
  view: ViewKind;
  d: number;
  site: Site;
  lat?: number;
  sky: SkyState;
  space: SpaceState;
  inset: "ground" | null;
  trail: "earth" | "sunpath" | null;
  follow: Follow;
  reducedMotion: boolean;
  chapter: ChapterKey;
  epochD: number;
  spanDays: number;
  landerAz: number | null;
}

export interface Shared {
  glow: import("three").Texture;
  disc: import("three").Texture;
  ring: import("three").Texture;
  moon: import("three").Texture;
  earth: import("three").Texture;
  regolith: import("three").Texture;
}

export const SPACE_BG = 0x05060a;
