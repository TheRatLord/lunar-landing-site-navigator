/**
 * Where the ground view's camera is and where it looks: plain functions, no Three.js. Azimuth is
 * clockwise from north and elevation is above the site's level plane, as in the engine's tracks.
 */

import { skyVector, type Vec3 } from "./groundMesh";

export interface Look {
  headingDeg: number;
  pitchDeg: number;
  fovDeg: number;
}

export const FOV_MIN_DEG = 4;
export const FOV_MAX_DEG = 90;
export const FOV_DEFAULT_DEG = 55;
const PITCH_MAX_DEG = 85;
/** Where the fly-down starts: high enough to see the drawn terrain as a map. */
export const ARRIVE_FROM_M = 30_000;
export const ARRIVE_MS = 3_200;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const wrap360 = (deg: number) => ((deg % 360) + 360) % 360;

/** Turn the look by a drag of (dx, dy) CSS pixels on a canvas `heightPx` tall: the ground follows the pointer. */
export function dragLook(look: Look, dx: number, dy: number, heightPx: number): Look {
  const degPerPx = look.fovDeg / Math.max(heightPx, 1);
  return { ...look, headingDeg: wrap360(look.headingDeg - dx * degPerPx), pitchDeg: clamp(look.pitchDeg + dy * degPerPx, -PITCH_MAX_DEG, PITCH_MAX_DEG) };
}

/** Narrow or widen the field of view by a wheel step. */
export function zoomLook(look: Look, deltaY: number): Look {
  return { ...look, fovDeg: clamp(look.fovDeg * Math.exp(deltaY * 0.0012), FOV_MIN_DEG, FOV_MAX_DEG) };
}

/** A look centred on a body a little above the middle of the picture, so the ground stays in view. */
export function lookToward(look: Look, azDeg: number, elDeg: number): Look {
  return { ...look, headingDeg: wrap360(azDeg), pitchDeg: clamp(elDeg + look.fovDeg * 0.15, -PITCH_MAX_DEG, PITCH_MAX_DEG) };
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * The camera during the fly-down, `t` from 0 (high above, looking straight down) to 1 (standing at
 * `eyeM`, looking along `look`). Height falls on a log scale so the last metres are not rushed; the
 * view tips up to the horizon in the second half.
 */
export function arrivalPose(t: number, look: Look, eyeM: number): { eye: Vec3; forward: Vec3; aboveGroundM: number; fovDeg: number } {
  const u = smooth(clamp(t, 0, 1));
  const height = Math.exp(Math.log(ARRIVE_FROM_M) + (Math.log(Math.max(eyeM, 0.5)) - Math.log(ARRIVE_FROM_M)) * u);
  const tip = smooth(clamp((u - 0.35) / 0.65, 0, 1));
  const pitch = -89.9 + (look.pitchDeg + 89.9) * tip;
  const fov = FOV_DEFAULT_DEG + (look.fovDeg - FOV_DEFAULT_DEG) * tip;
  return { eye: [0, 0, height], forward: skyVector(look.headingDeg, pitch), aboveGroundM: height, fovDeg: fov };
}

/** The camera standing at the site. */
export function standingPose(look: Look, eyeM: number): { eye: Vec3; forward: Vec3; aboveGroundM: number; fovDeg: number } {
  return { eye: [0, 0, eyeM], forward: skyVector(look.headingDeg, look.pitchDeg), aboveGroundM: eyeM, fovDeg: look.fovDeg };
}
