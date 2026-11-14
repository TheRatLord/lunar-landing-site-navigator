interface PatchSource {
  id: string;
  pixel_size_m: number;
  projection: string;
  level?: number | null;
  level_pixel_size_m?: number | null;
}

interface PatchCorner {
  lat_deg: number;
  lon_deg: number;
}

interface PatchHeader {
  format: "LNP1";
  lat_deg: number;
  lon_deg: number;
  size_m: number;
  n: number;
  spacing_m: number;
  radius_m: number;
  east_m: [number, number];
  north_m: [number, number];
  corners: { nw: PatchCorner; ne: PatchCorner; sw: PatchCorner; se: PatchCorner };
  data_offset: number;
  dtype: "float32le";
  sources: PatchSource[];
  height_range_m: [number, number] | null;
  n_nodata: number;
  effective_resolution_m: number | null;
  notes?: string;
  curvature?: string;
}

export interface Patch {
  header: PatchHeader;
  n: number;
  heights: Float32Array;
  nodata: number;
  min: number;
  max: number;
}

export class PatchFormatError extends Error {
  constructor(message: string) {
    super(`Terrain patch: ${message}`);
    this.name = "PatchFormatError";
  }
}

const PREAMBLE = 8;

export function decodePatch(buf: ArrayBuffer): Patch {
  if (buf.byteLength < PREAMBLE) throw new PatchFormatError("truncated (no header)");
  const view = new DataView(buf);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "LNP1") throw new PatchFormatError(`unknown magic "${magic}", expected "LNP1"`);
  const hlen = view.getUint32(4, true);
  if (PREAMBLE + hlen > buf.byteLength) throw new PatchFormatError("header runs past the end of the buffer");
  let header: PatchHeader;
  try {
    header = JSON.parse(new TextDecoder("utf-8").decode(new Uint8Array(buf, PREAMBLE, hlen))) as PatchHeader;
  } catch {
    throw new PatchFormatError("header is not valid JSON");
  }
  const n = header.n;
  if (!Number.isInteger(n) || n < 2) throw new PatchFormatError(`invalid sample count n=${String(n)}`);
  const offset = header.data_offset;
  const bytes = n * n * 4;
  if (offset + bytes > buf.byteLength) throw new PatchFormatError(`expected ${n * n} samples, buffer holds ${Math.floor((buf.byteLength - offset) / 4)}`);
  const heights = offset % 4 === 0 ? new Float32Array(buf, offset, n * n) : new Float32Array(buf.slice(offset, offset + bytes));
  let nodata = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i]!;
    if (h !== h) nodata++;
    else {
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  return { header, n, heights, nodata, min, max };
}

