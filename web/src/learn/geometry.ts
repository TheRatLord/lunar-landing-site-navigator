import { clamp, wrap360 } from "../lib/scale";

export type V3 = [number, number, number];

const AU = 149_597_870.7;
const R_MOON = 1737.4;
const R_EARTH = 6371;
const R_SUN = 695_700;
const I_MOON = 1.543;
const INC = 5.145;
const EPS = 23.439;
const SPACE_SCALE = 14 / 384_400;
export const MOON_DRAWN_RADIUS = 0.546;

export const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const J2000 = Date.UTC(2000, 0, 1, 12);
const DAY_MS = 86_400_000;

const dayOfMs = (ms: number): number => (ms - J2000) / DAY_MS;
export const dayOfIso = (iso: string): number => dayOfMs(Date.parse(iso));
export const dateOfDay = (d: number): Date => new Date(J2000 + d * DAY_MS);

const sind = (a: number) => Math.sin(a * RAD);
const cosd = (a: number) => Math.cos(a * RAD);

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V3): number => Math.sqrt(dot(a, a));
const norm = (a: V3): V3 => scale(a, 1 / len(a));
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const rz = (v: V3, aDeg: number): V3 => {
  const c = cosd(aDeg);
  const s = sind(aDeg);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
};
const rx = (v: V3, aDeg: number): V3 => {
  const c = cosd(aDeg);
  const s = sind(aDeg);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
};

interface Ephem {
  sunGeo: V3;
  moonGeo: V3;
  lambdaSun: number;
  X: V3;
  Y: V3;
  Z: V3;
}

function ephem(d: number): Ephem {
  const g = 357.529 + 0.98560028 * d;
  const L0 = 280.459 + 0.98564736 * d;
  const lambdaSun = L0 + 1.915 * sind(g) + 0.02 * sind(2 * g);
  const Rs = AU * (1.00014 - 0.01671 * cosd(g) - 0.00014 * cosd(2 * g));
  const sunGeo: V3 = [Rs * cosd(lambdaSun), Rs * sind(lambdaSun), 0];

  const Lp = 218.3165 + 13.17639648 * d;
  const Mp = 134.9634 + 13.06499295 * d;
  const F = 93.2721 + 13.22935024 * d;
  const D = 297.8502 + 12.19074912 * d;
  const Om = 125.0446 - 0.05295377 * d;
  const lam =
    Lp +
    6.289 * sind(Mp) +
    1.274 * sind(2 * D - Mp) +
    0.658 * sind(2 * D) +
    0.214 * sind(2 * Mp) -
    0.186 * sind(g) -
    0.114 * sind(2 * F);
  const bet = 5.128 * sind(F) + 0.281 * sind(Mp + F) + 0.278 * sind(Mp - F) + 0.173 * sind(2 * D - F);
  const rm = 385000.6 - 20905.4 * cosd(Mp) - 3699.1 * cosd(2 * D - Mp) - 2956.0 * cosd(2 * D);
  const moonGeo: V3 = [rm * cosd(bet) * cosd(lam), rm * cosd(bet) * sind(lam), rm * sind(bet)];

  const meanDir = rz(rx([cosd(F), sind(F), 0], INC), Om);
  const P: V3 = [-sind(I_MOON) * sind(Om), sind(I_MOON) * cosd(Om), cosd(I_MOON)];
  const Dm = scale(meanDir, -1);
  const X = norm(sub(Dm, scale(P, dot(Dm, P))));
  const Y = cross(P, X);
  return { sunGeo, moonGeo, lambdaSun, X, Y, Z: P };
}

const toBody = (v: V3, e: Ephem): V3 => [dot(v, e.X), dot(v, e.Y), dot(v, e.Z)];

export interface Place {
  lat: number;
  lon: number;
  horizon: (azDeg: number) => number;
}

type SunStatus = "up" | "peeking" | "behindHill" | "eclipse" | "night";

interface SkyBody {
  az: number;
  el: number;
  horizonEl: number;
  frac: number;
}

export interface SkyState {
  sun: SkyBody & { status: SunStatus; radius: number };
  earth: SkyBody & { visible: boolean; litFraction: number; radius: number };
  sepDeg: number;
  eclipsed: number;
  sunlight: number;
}

function discFrac(h: number, r: number): number {
  const x = clamp(h / r, -1, 1);
  return 1 - (Math.acos(x) - x * Math.sqrt(1 - x * x)) / Math.PI;
}

function overlap(sep: number, rS: number, rE: number): number {
  if (sep >= rS + rE) return 0;
  if (sep <= rE - rS) return Math.PI * rS * rS;
  if (sep <= rS - rE) return Math.PI * rE * rE;
  const a = rS * rS * Math.acos(clamp((sep * sep + rS * rS - rE * rE) / (2 * sep * rS), -1, 1));
  const b = rE * rE * Math.acos(clamp((sep * sep + rE * rE - rS * rS) / (2 * sep * rE), -1, 1));
  const k = (-sep + rS + rE) * (sep + rS - rE) * (sep - rS + rE) * (sep + rS + rE);
  return a + b - 0.5 * Math.sqrt(Math.max(0, k));
}

export function skyAt(place: Place, d: number, latOverride?: number): SkyState {
  const e = ephem(d);
  const lat = latOverride ?? place.lat;
  const lon = place.lon;
  const n: V3 = [cosd(lat) * cosd(lon), cosd(lat) * sind(lon), sind(lat)];
  const east: V3 = [-sind(lon), cosd(lon), 0];
  const north: V3 = [-sind(lat) * cosd(lon), -sind(lat) * sind(lon), cosd(lat)];
  const site = scale(n, R_MOON);
  const sunV = sub(toBody(sub(e.sunGeo, e.moonGeo), e), site);
  const earthV = sub(toBody(scale(e.moonGeo, -1), e), site);
  const sunLen = len(sunV);
  const earthLen = len(earthV);
  const s = scale(sunV, 1 / sunLen);
  const w = scale(earthV, 1 / earthLen);
  const azEl = (u: V3): [number, number] => [
    wrap360(Math.atan2(dot(u, east), dot(u, north)) * DEG),
    Math.asin(clamp(dot(u, n), -1, 1)) * DEG,
  ];
  const [azS, elS] = azEl(s);
  const [azE, elE] = azEl(w);
  const rS = Math.asin(R_SUN / sunLen);
  const rE = Math.asin(R_EARTH / earthLen);
  const rSd = rS * DEG;
  const rEd = rE * DEG;
  const hS = place.horizon(azS);
  const hE = place.horizon(azE);
  const sunFrac = discFrac(elS - hS, rSd);
  const earthFrac = discFrac(elE - hE, rEd);
  const sep = Math.acos(clamp(dot(s, w), -1, 1));
  const A = overlap(sep, rS, rE);
  const eclipsed = A / (Math.PI * rS * rS);
  const sunlight = sunFrac * (1 - eclipsed);
  let status: SunStatus;
  if (A > 0 && sunFrac > 0.5) status = "eclipse";
  else if (sunlight >= 0.95) status = "up";
  else if (sunlight > 0.05) status = "peeking";
  else if (discFrac(elS, rSd) > 0.05 && sunFrac <= 0.05) status = "behindHill";
  else status = "night";
  const psi = Math.acos(clamp(dot(norm(e.sunGeo), norm(e.moonGeo)), -1, 1));
  return {
    sun: { az: azS, el: elS, horizonEl: hS, frac: sunFrac, status, radius: rSd },
    earth: {
      az: azE,
      el: elE,
      horizonEl: hE,
      frac: earthFrac,
      visible: elE > hE,
      litFraction: (1 + Math.cos(psi)) / 2,
      radius: rEd,
    },
    sepDeg: sep * DEG,
    eclipsed,
    sunlight,
  };
}

export interface SpaceState {
  lambdaSun: number;
  moonPos: V3;
  moonBasis: [V3, V3, V3];
  earthBasis: [V3, V3, V3];
}

const toThree = (v: V3): V3 => [v[0], v[2], -v[1]];

function displayRotation(lambdaSun: number): (v: V3) => V3 {
  const phi = 180 - lambdaSun;
  return (v: V3) => toThree(rz(v, phi));
}

export function spaceAt(d: number): SpaceState {
  const e = ephem(d);
  const R = displayRotation(e.lambdaSun);
  const theta = 280.46061837 + 360.98564736629 * d;
  const eq: V3 = [cosd(theta), sind(theta), 0];
  const xE: V3 = [eq[0], eq[1] * cosd(EPS) + eq[2] * sind(EPS), -eq[1] * sind(EPS) + eq[2] * cosd(EPS)];
  const PE: V3 = [0, sind(EPS), cosd(EPS)];
  return {
    lambdaSun: e.lambdaSun,
    moonPos: scale(R(e.moonGeo), SPACE_SCALE),
    moonBasis: [R(e.X), R(e.Z), R(scale(e.Y, -1))],
    earthBasis: [R(xE), R(PE), R(scale(cross(PE, xE), -1))],
  };
}

export function orbitPath(d: number, halfSpan = 14.8, stepD = 0.25): V3[] {
  const R = displayRotation(ephem(d).lambdaSun);
  const out: V3[] = [];
  for (let k = -halfSpan; k <= halfSpan + 1e-9; k += stepD) {
    out.push(scale(R(ephem(d + k).moonGeo), SPACE_SCALE));
  }
  return out;
}

export const dirFromAzEl = (azDeg: number, elDeg: number): V3 => [
  sind(azDeg) * cosd(elDeg),
  sind(elDeg),
  -cosd(azDeg) * cosd(elDeg),
];

export const pinLocal = (latDeg: number, lonDeg: number, radius: number): V3 => [
  cosd(latDeg) * cosd(lonDeg) * radius,
  sind(latDeg) * radius,
  -cosd(latDeg) * sind(lonDeg) * radius,
];
