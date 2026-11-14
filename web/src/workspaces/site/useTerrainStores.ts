import { useEffect, useState } from "react";
import type { TerrainStoreJson } from "../../api/site";
import { metaApi } from "../../api/endpoints";

let cached: Promise<TerrainStoreJson[] | null> | null = null;

export function useTerrainStores(): readonly TerrainStoreJson[] | null {
  const [stores, setStores] = useState<TerrainStoreJson[] | null>(null);
  useEffect(() => {
    let live = true;
    cached ??= metaApi.get().then(
      (m) => {
        const list = m && typeof m === "object" ? (m as { terrain_stores?: unknown }).terrain_stores : undefined;
        return Array.isArray(list) ? (list as TerrainStoreJson[]) : null;
      },
      () => {
        cached = null;
        return null;
      },
    );
    void cached.then((l) => live && setStores(l));
    return () => {
      live = false;
    };
  }, []);
  return stores;
}
