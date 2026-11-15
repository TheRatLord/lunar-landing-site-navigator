export type ViewKind = "south" | "north" | "global";

export const viewKindFor = (lat: number): ViewKind => (lat <= -60 ? "south" : lat >= 60 ? "north" : "global");

export function pointFromUrl(params: URLSearchParams): { lat_deg: number; lon_deg: number } | null {
  const lat = Number(params.get("lat") ?? NaN);
  const lon = Number(params.get("lon") ?? NaN);
  if (!params.get("lat") || !params.get("lon") || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) return null;
  return { lat_deg: lat, lon_deg: ((((lon + 180) % 360) + 360) % 360) - 180 };
}
