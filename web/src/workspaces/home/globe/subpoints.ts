import { useEffect, useState } from "react";
import { isAbort, sendJson } from "../../../api/client";
import type { components } from "../../../api/generated/schema";
import { lowerBound } from "../../../lib/scale";
import { parseUtc, toIsoUtc } from "../../../lib/time";

type SubpointsResponse = components["schemas"]["SubpointsResponse"];

export interface Subpoints {
  t_ms: number[];
  sunLat: number[];
  sunLon: number[];
  earthLat: number[];
  earthLon: number[];
}

const STEP_S = 3 * 3600;

export function useSubpoints(start_ms: number, end_ms: number): Subpoints | null {
  const [data, setData] = useState<{ key: string; value: Subpoints } | null>(null);
  const key = `${start_ms}:${end_ms}`;
  useEffect(() => {
    const ctl = new AbortController();
    sendJson<SubpointsResponse>(
      "/ephemeris/subpoints",
      { start_utc: toIsoUtc(start_ms), end_utc: toIsoUtc(end_ms), step_s: STEP_S, max_points: 4000 },
      { signal: ctl.signal },
    ).then(
      (r) =>
        setData({
          key,
          value: {
            t_ms: r.utc.map((u) => parseUtc(u) ?? Number.NaN),
            sunLat: r.subsolar_lat_deg,
            sunLon: r.subsolar_lon_deg,
            earthLat: r.subearth_lat_deg,
            earthLon: r.subearth_lon_deg,
          },
        }),
      (e: unknown) => {
        if (!isAbort(e)) setData(null);
      },
    );
    return () => ctl.abort();
  }, [key, start_ms, end_ms]);
  return data?.key === key ? data.value : null;
}

const lerpLon = (a: number, b: number, f: number): number => {
  let d = b - a;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  const v = a + d * f;
  return v > 180 ? v - 360 : v <= -180 ? v + 360 : v;
};

export function subpointsAt(s: Subpoints, t_ms: number): { sun: [number, number]; earth: [number, number] } | null {
  const n = s.t_ms.length;
  if (n === 0) return null;
  const k = Math.min(Math.max(lowerBound(s.t_ms, t_ms), 1), n - 1);
  const a = k - 1;
  const span = s.t_ms[k]! - s.t_ms[a]!;
  const f = span > 0 ? Math.min(1, Math.max(0, (t_ms - s.t_ms[a]!) / span)) : 0;
  return {
    sun: [s.sunLat[a]! + (s.sunLat[k]! - s.sunLat[a]!) * f, lerpLon(s.sunLon[a]!, s.sunLon[k]!, f)],
    earth: [s.earthLat[a]! + (s.earthLat[k]! - s.earthLat[a]!) * f, lerpLon(s.earthLon[a]!, s.earthLon[k]!, f)],
  };
}
