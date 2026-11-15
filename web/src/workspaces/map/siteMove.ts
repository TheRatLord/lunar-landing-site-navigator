import { formatLat, formatLon } from "../../lib/coords";
import { useScenario, writePlanSite } from "../../scenario/store";
import { toast } from "../../state/toasts";

export interface SiteSnapshot {
  lat_deg: number;
  lon_deg: number;
  name: string;
  catalog_id: string | null;
  planName: string;
}

export const pointName = (lat: number, lon: number): string => `${formatLat(lat, 2)} ${formatLon(lon, 2)}`;

export function siteSnapshot(): SiteSnapshot | null {
  const doc = useScenario.getState().doc;
  if (!doc) return null;
  return { lat_deg: doc.site.lat_deg, lon_deg: doc.site.lon_deg, name: doc.site.name ?? "", catalog_id: doc.site.catalog_id ?? null, planName: doc.name };
}

export function restoreSite(s: SiteSnapshot): void {
  writePlanSite(s.lat_deg, s.lon_deg, s.name, s.catalog_id);
  const st = useScenario.getState();
  if (st.doc && st.doc.name !== s.planName) st.edit(["name"], s.planName);
}

const sameSite = (a: SiteSnapshot, b: SiteSnapshot): boolean => a.lat_deg === b.lat_deg && a.lon_deg === b.lon_deg && a.name === b.name;

export function announceSiteMove(prev: SiteSnapshot | null, openSite: () => void): void {
  const now = siteSnapshot();
  if (!prev || !now || sameSite(prev, now)) return;
  toast(
    {
      kind: "success",
      title: `Plan site: ${now.name || pointName(now.lat_deg, now.lon_deg)}`,
      actions: [
        { label: "Undo", run: () => restoreSite(prev) },
        { label: "Open Site", run: openSite },
      ],
    },
    8000,
  );
}
