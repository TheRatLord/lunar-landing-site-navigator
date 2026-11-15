import type { SearchBody, SearchResult, SiteState } from "../../../api/search";
import { bearing_deg, destination, distance_m } from "../../../lib/projection";
import { parseUtc } from "../../../lib/time";
import { surfacePoint, type CellMesh, type V3 } from "./MoonScene";

export type CellStatus = "outside" | "unchecked" | "steep" | "screened" | "full";
const STATUS: CellStatus[] = ["outside", "unchecked", "steep", "screened", "full"];
const STATE: Record<number, SiteState> = { 0: "fail", 1: "marginal", 2: "pass" };

export const CELL_COLOR: Record<SiteState | "screened" | "steep", string> = {
  pass: "#30d158",
  marginal: "#ffd60a",
  fail: "#ff5a4f",
  unknown: "#8e8e93",
  screened: "#8e8e93",
  steep: "#3a3a40",
};

export interface Lattice {
  lat0: number;
  lon0: number;
  spacing_m: number;
  radius_m: number | null;
  east: number[];
  north: number[];
  status: CellStatus[][];
  state: number[][];
  slope: Array<Array<number | null>>;
  bestEpoch: number[][] | null;
  nPass: number[][] | null;
  epochs_ms: number[];
}

export interface Cell {
  i: number;
  j: number;
  lat_deg: number;
  lon_deg: number;
  status: CellStatus;
  state: SiteState;
  best_ms: number | null;
  nPass: number | null;
  nEpochs: number;
  slope_deg: number | null;
}

const isGrid = (g: unknown): g is Record<string, unknown> => !!g && typeof g === "object";
const num2 = (v: unknown): number[][] | null => (Array.isArray(v) && v.every((r) => Array.isArray(r)) ? (v as number[][]) : null);

export function adaptLattice(result: SearchResult, body: SearchBody): Lattice | null {
  const g = result.grid;
  if (!isGrid(g)) return null;
  const east = g["east_m"];
  const north = g["north_m"];
  const status = num2(g["status"]);
  const state = num2(g["state"]);
  if (!Array.isArray(east) || !Array.isArray(north) || !status || !state || east.length < 1) return null;
  const spacing = body.final_spacing_m;
  const epochs = Array.isArray(g["epochs_utc"]) ? (g["epochs_utc"] as string[]).map((u) => parseUtc(u) ?? Number.NaN) : [];
  return {
    lat0: body.region.lat_deg,
    lon0: body.region.lon_deg,
    spacing_m: spacing,
    radius_m: body.region.radius_m ?? null,
    east: east as number[],
    north: north as number[],
    status: status.map((r) => r.map((s) => STATUS[s] ?? "outside")),
    state,
    slope: (num2(g["slope_deg"]) ?? status.map((r) => r.map(() => null))) as Array<Array<number | null>>,
    bestEpoch: num2(g["best_epoch"]),
    nPass: num2(g["n_epochs_pass"]),
    epochs_ms: epochs,
  };
}

const at = (l: Lattice, e: number, n: number): [number, number] => destination(l.lat0, l.lon0, (Math.atan2(e, n) * 180) / Math.PI, Math.hypot(e, n));

export function cellOf(l: Lattice, i: number, j: number): Cell | null {
  const status = l.status[j]?.[i];
  if (status === undefined || status === "outside") return null;
  const [lat, lon] = at(l, l.east[i]!, l.north[j]!);
  const full = status === "full";
  const be = full ? (l.bestEpoch?.[j]?.[i] ?? -1) : -1;
  const np = full ? (l.nPass?.[j]?.[i] ?? -1) : -1;
  return {
    i,
    j,
    lat_deg: lat,
    lon_deg: lon,
    status,
    state: full ? (STATE[l.state[j]![i]!] ?? "unknown") : "unknown",
    best_ms: be >= 0 ? (l.epochs_ms[be] ?? null) : null,
    nPass: np >= 0 ? np : null,
    nEpochs: l.epochs_ms.length,
    slope_deg: l.slope[j]?.[i] ?? null,
  };
}

export function cellAt(l: Lattice, lat_deg: number, lon_deg: number): Cell | null {
  const d = distance_m(l.lat0, l.lon0, lat_deg, lon_deg);
  const b = (bearing_deg(l.lat0, l.lon0, lat_deg, lon_deg) * Math.PI) / 180;
  const i = Math.round((d * Math.sin(b) - l.east[0]!) / l.spacing_m);
  const j = Math.round((d * Math.cos(b) - l.north[0]!) / l.spacing_m);
  return cellOf(l, i, j);
}

function rgba(hex: string, a: number): [number, number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [lin((v >> 16) & 255), lin((v >> 8) & 255), lin(v & 255), a];
}

export function cellColor(c: Cell): [number, number, number, number] {
  if (c.status === "steep") return rgba(CELL_COLOR.steep, 0.55);
  if (c.status !== "full") return rgba(CELL_COLOR.screened, 0.16);
  if (c.state === "pass") {
    const share = c.nEpochs > 1 && c.nPass !== null ? c.nPass / c.nEpochs : 1;
    return rgba(CELL_COLOR.pass, 0.14 + 0.72 * share);
  }
  return rgba(CELL_COLOR[c.state], c.state === "fail" ? 0.42 : 0.62);
}

export function latticeMesh(l: Lattice): CellMesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const index: number[] = [];
  const h = l.spacing_m * 0.47;
  for (let j = 0; j < l.north.length; j++) {
    for (let i = 0; i < l.east.length; i++) {
      const c = cellOf(l, i, j);
      if (!c) continue;
      const e = l.east[i]!;
      const n = l.north[j]!;
      const base = positions.length / 3;
      for (const [de, dn] of [
        [-h, -h],
        [h, -h],
        [h, h],
        [-h, h],
      ] as const) {
        const [la, lo] = at(l, e + de, n + dn);
        positions.push(...surfacePoint(la, lo, 1 + 7e-5));
      }
      const col = cellColor(c);
      for (let k = 0; k < 4; k++) colors.push(...col);
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors), index: new Uint32Array(index) };
}

export function circle(lat_deg: number, lon_deg: number, radius_m: number, n = 160): V3[] {
  const out: V3[] = [];
  for (let k = 0; k < n; k++) {
    const [la, lo] = destination(lat_deg, lon_deg, (360 * k) / n, radius_m);
    out.push(surfacePoint(la, lo, 1 + 8e-5));
  }
  return out;
}
