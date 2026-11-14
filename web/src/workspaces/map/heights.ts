import { decodeTerrarium } from "../../api/terrain";

export interface HeightTile {
  data: Uint8ClampedArray;
  size: number;
}

function heightAtPixel(t: HeightTile, px: number, py: number): number | null {
  if (px < 0 || py < 0 || px >= t.size || py >= t.size) return null;
  const i = (py * t.size + px) * 4;
  return decodeTerrarium(t.data[i]!, t.data[i + 1]!, t.data[i + 2]!, t.data[i + 3]!);
}

export function heightAt(t: HeightTile, fx: number, fy: number): number | null {
  return heightAtPixel(t, Math.floor(fx), Math.floor(fy));
}

export interface PixelGround {
  x: number;
  y: number;
}

export function slopeAt(t: HeightTile, fx: number, fy: number, pixelM: PixelGround): { slope_deg: number; baseline_m: PixelGround } | null {
  const x = Math.floor(fx);
  const y = Math.floor(fy);
  const xl = Math.max(0, x - 1);
  const xr = Math.min(t.size - 1, x + 1);
  const yu = Math.max(0, y - 1);
  const yd = Math.min(t.size - 1, y + 1);
  const hl = heightAtPixel(t, xl, y);
  const hr = heightAtPixel(t, xr, y);
  const hu = heightAtPixel(t, x, yu);
  const hd = heightAtPixel(t, x, yd);
  const hc = heightAtPixel(t, x, y);
  if (hl === null || hr === null || hu === null || hd === null || hc === null || xr === xl || yd === yu) return null;
  const bx = (xr - xl) * pixelM.x;
  const by = (yd - yu) * pixelM.y;
  const dzdx = (hr - hl) / bx;
  const dzdy = (hd - hu) / by;
  return { slope_deg: (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI, baseline_m: { x: bx, y: by } };
}
