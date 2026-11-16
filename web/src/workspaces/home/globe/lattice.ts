import { destination } from "../../../lib/projection";
import { cellOf, cellShade, latticeAt, type Cell, type Lattice } from "../../search/lattice";
import { surfacePoint, type CellMesh, type V3 } from "./MoonScene";

function rgba(hex: string, a: number): [number, number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [lin((v >> 16) & 255), lin((v >> 8) & 255), lin(v & 255), a];
}

export function cellColor(c: Cell): [number, number, number, number] {
  const { hex, alpha } = cellShade(c);
  return rgba(hex, alpha);
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
        const [la, lo] = latticeAt(l, e + de, n + dn);
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
