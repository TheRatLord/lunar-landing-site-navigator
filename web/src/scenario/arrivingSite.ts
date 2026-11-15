import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { movePlanSite, useScenario } from "./store";

const KEYS = ["site_lat", "site_lon", "site_name", "site_catalog"];

export function useArrivingSite(): void {
  const [params, setParams] = useSearchParams();
  const ready = useScenario((s) => s.doc !== null && s.phase === "idle" && s.pendingLink === null);
  const asked = params.has("site_lat");
  useEffect(() => {
    if (!asked || !ready) return;
    const lat = Number(params.get("site_lat"));
    const lon = Number(params.get("site_lon"));
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90) {
      movePlanSite({
        lat_deg: lat,
        lon_deg: lon,
        name: (params.get("site_name") ?? "").slice(0, 80) || `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`,
        catalog_id: params.get("site_catalog") || null,
      });
    }
    const next = new URLSearchParams(params);
    for (const k of KEYS) next.delete(k);
    setParams(next, { replace: true });
  }, [asked, ready, params, setParams]);
}
