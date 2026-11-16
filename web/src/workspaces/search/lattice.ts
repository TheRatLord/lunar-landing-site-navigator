import type { SearchBody, SearchResult, SiteState } from "../../api/search";
import { bearing_deg, destination, distance_m } from "../../lib/projection";
import { parseUtc } from "../../lib/time";
import { STATE_WORD } from "../map/overlays";
import { dayText } from "../home/survey";

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

export const latticeAt = (l: Lattice, e: number, n: number): [number, number] => destination(l.lat0, l.lon0, (Math.atan2(e, n) * 180) / Math.PI, Math.hypot(e, n));

export function cellOf(l: Lattice, i: number, j: number): Cell | null {
  const status = l.status[j]?.[i];
  if (status === undefined || status === "outside") return null;
  const [lat, lon] = latticeAt(l, l.east[i]!, l.north[j]!);
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

function utcText(ms: number): string {
  const d = new Date(ms);
  return `${dayText(ms, true)}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

export function cellWords(c: Cell): { title: string; lines: string[] } {
  if (c.status === "steep") return { title: "Too steep or rough", lines: ["Left out before the full check: the slope limit rules it out."] };
  if (c.status !== "full") return { title: "Not checked in full", lines: ["A quick, optimistic first pass ranked it too low to check in full. Treat it as unknown, not as a fail."] };
  const lines: string[] = [];
  if (c.best_ms !== null) lines.push(`${c.nEpochs > 1 ? "Best landing" : "Landing"} ${utcText(c.best_ms)}`);
  if (c.nEpochs > 1 && c.nPass !== null) lines.push(`Passes at ${c.nPass} of ${c.nEpochs} landing times searched`);
  if (c.slope_deg !== null) lines.push(`Slope ${c.slope_deg.toFixed(1)}°`);
  return { title: STATE_WORD[c.state], lines };
}

export function cellShade(c: Cell): { hex: string; alpha: number } {
  if (c.status === "steep") return { hex: CELL_COLOR.steep, alpha: 0.55 };
  if (c.status !== "full") return { hex: CELL_COLOR.screened, alpha: 0.16 };
  if (c.state === "pass") {
    const share = c.nEpochs > 1 && c.nPass !== null ? c.nPass / c.nEpochs : 1;
    return { hex: CELL_COLOR.pass, alpha: 0.14 + 0.72 * share };
  }
  return { hex: CELL_COLOR[c.state], alpha: c.state === "fail" ? 0.42 : 0.62 };
}
