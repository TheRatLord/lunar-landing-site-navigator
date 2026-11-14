import { useEffect, useState } from "react";
import { fetchTerrainPatch } from "../../../api/site";
import { decodePatch, type Patch } from "../../site/terrain3d/patch";
import { isEmptyPatch, smoothPatch, type LevelSpec } from "./groundMesh";

export type GroundPatches =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | {
      status: "ready";
      /** Finest first, one per level. */
      patches: Patch[];
      /** No terrain store covers the site: every level is the smooth sphere, as in the engine. */
      smooth: boolean;
      /** The finest data spacing actually used near the site (m), from the patch header. */
      resolutionM: number | null;
      sources: string[];
    };

/** The elevation patches for every level round a site, fetched together from `/terrain/patch`. */
export function useGroundPatches(lat: number, lon: number, specs: LevelSpec[]): GroundPatches {
  const key = `${lat},${lon},${specs.map((s) => `${s.sizeM}/${s.n}`).join(",")}`;
  const [state, setState] = useState<{ key: string; value: GroundPatches } | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    Promise.all(specs.map((s) => fetchTerrainPatch({ lat, lon, size_m: s.sizeM, n: s.n }, ctl.signal).then(decodePatch))).then(
      (raw) => {
        const smooth = raw.every(isEmptyPatch);
        const patches = smooth ? raw.map(smoothPatch) : raw;
        const near = raw[0]?.header;
        const sources = [...new Set(raw.flatMap((p) => p.header.sources.map((s) => s.id)))];
        setState({ key, value: { status: "ready", patches, smooth, resolutionM: smooth ? null : (near?.effective_resolution_m ?? null), sources } });
      },
      (e: unknown) => {
        if (ctl.signal.aborted) return;
        setState({ key, value: { status: "error", error: e instanceof Error ? e : new Error(String(e)) } });
      },
    );
    return () => ctl.abort();
    // `key` covers lat, lon and specs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state?.key === key ? state.value : { status: "loading" };
}
