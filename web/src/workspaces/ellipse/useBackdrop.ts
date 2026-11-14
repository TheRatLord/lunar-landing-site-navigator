import { useEffect, useMemo, useState } from "react";
import { fetchTerrainPatch } from "../../api/site";
import { decodePatch, type Patch } from "../site/terrain3d/patch";
import { hillshade } from "./adapt";

const PATCH_N = 161;

interface State {
  key: string;
  patch: Patch | null;
  error: Error | null;
}

export interface Backdrop {
  status: "off" | "loading" | "ok" | "none" | "error";
  image: { url: string; x0: number; x1: number; y0: number; y1: number; resolution: number | null } | null;
  error: Error | null;
}

export function useBackdrop(lat: number, lon: number, sizeM: number, enabled: boolean, dark: boolean): Backdrop {
  const key = enabled ? `${lat}|${lon}|${Math.round(sizeM)}` : "";
  const [st, setSt] = useState<State>({ key: "", patch: null, error: null });

  useEffect(() => {
    if (!enabled) return;
    const ctl = new AbortController();
    fetchTerrainPatch({ lat, lon, size_m: Math.round(sizeM), n: PATCH_N }, ctl.signal).then(
      (buf) => {
        try {
          setSt({ key, patch: decodePatch(buf), error: null });
        } catch (e) {
          setSt({ key, patch: null, error: e instanceof Error ? e : new Error(String(e)) });
        }
      },
      (e: unknown) => {
        if (!ctl.signal.aborted) setSt({ key, patch: null, error: e instanceof Error ? e : new Error(String(e)) });
      },
    );
    return () => ctl.abort();
  }, [enabled, key, lat, lon, sizeM]);

  const patch = st.key === key ? st.patch : null;
  const image = useMemo(() => {
    if (!patch || patch.nodata === patch.n * patch.n) return null;
    const { n, header } = patch;
    const canvas = document.createElement("canvas");
    canvas.width = n;
    canvas.height = n;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.putImageData(new ImageData(hillshade(patch.heights, n, header.spacing_m, dark) as Uint8ClampedArray<ArrayBuffer>, n, n), 0, 0);
    const half = header.spacing_m / 2;
    return {
      url: canvas.toDataURL("image/png"),
      x0: Math.min(...header.east_m) - half,
      x1: Math.max(...header.east_m) + half,
      y0: Math.min(...header.north_m) - half,
      y1: Math.max(...header.north_m) + half,
      resolution: header.effective_resolution_m,
    };
  }, [patch, dark]);

  if (!enabled) return { status: "off", image: null, error: null };
  if (st.key !== key) return { status: "loading", image: null, error: null };
  if (st.error) return { status: "error", image: null, error: st.error };
  return { status: image ? "ok" : "none", image, error: null };
}
