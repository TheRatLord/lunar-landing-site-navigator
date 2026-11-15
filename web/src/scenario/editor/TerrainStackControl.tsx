import { useState } from "react";
import { Icon } from "../../components/ui/Icon";
import { Segmented } from "../../components/ui/Segmented";
import { Spinner } from "../../components/ui/Progress";
import { Tooltip } from "../../components/ui/Tooltip";
import { formatNum } from "../../lib/format";
import { useScenario } from "../store";
import { sortedStores, storeCovers, storePlace, useTerrainStores, type TerrainStoreInfo } from "../terrainStack";
import { GroupHead } from "./controls";

export function TerrainStackControl() {
  const chosen = useScenario((s) => s.doc?.terrain_stores ?? null);
  const lat = useScenario((s) => s.doc?.site.lat_deg ?? 0);
  const lon = useScenario((s) => s.doc?.site.lon_deg ?? 0);
  const edit = useScenario((s) => s.edit);
  const { stores, error } = useTerrainStores();
  const issue = useScenario((s) =>
    s.issues
      .filter((i) => i.loc.includes("terrain_stores"))
      .map((i) => i.msg)
      .join("; "),
  );
  const [customView, setCustomView] = useState(false);
  const restricted = chosen !== null || customView;

  const set = (ids: readonly string[] | null) => edit(["terrain_stores"], ids === null ? undefined : sortedStores(ids));
  const toggle = (demId: string, on: boolean) => {
    const cur = chosen ?? (stores ?? []).filter(usable).map((s) => s.dem_id);
    set(on ? [...cur.filter((x) => x !== demId), demId] : cur.filter((x) => x !== demId));
  };
  const usable = (s: TerrainStoreInfo) => !s.error;
  const rows: TerrainStoreInfo[] = [
    ...(stores ?? []),
    ...(chosen ?? []).filter((c) => stores !== null && !stores.some((s) => s.dem_id === c)).map((c): TerrainStoreInfo => ({ dem_id: c, meta_sha256: "", error: "not installed on the engine" })),
  ];

  return (
    <div className="sc-group">
      <GroupHead title="Terrain">
        <Segmented
          label="Terrain stack"
          size="sm"
          value={restricted ? "custom" : "default"}
          onChange={(v) => {
            setCustomView(v === "custom");
            if (v === "default" && chosen !== null) set(null);
          }}
          options={[
            { value: "default", label: "Default" },
            { value: "custom", label: "Custom" },
          ]}
        />
      </GroupHead>
      {error && (
        <p className="sc-msg" role="alert">
          {error}
        </p>
      )}
      {!restricted && <p className="dim sc-summary">Best available at the site</p>}
      {restricted && stores === null && !error && <Spinner size={14} />}
      {restricted && rows.length > 0 && (
        <ol className="sc-stores" aria-label="Terrain data">
          {[...rows].sort((a, b) => Number(storeCovers(a, lat, lon) === false) - Number(storeCovers(b, lat, lon) === false)).map((s) => {
            const on = !chosen || chosen.includes(s.dem_id);
            const out = storeCovers(s, lat, lon) === false;
            const disabled = !on && (out || !usable(s));
            return (
              <li key={s.dem_id} className={`sc-store ${on ? "" : "off"} ${out ? "out" : ""}`}>
                <label>
                  <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => toggle(s.dem_id, e.target.checked)} />
                  <span className="sc-store-id">{storePlace(s)}</span>
                </label>
                {out && (
                  <Tooltip content="No coverage">
                    <span className="sc-store-flag" role="img" aria-label="No coverage at this site">
                      <Icon name="alert" size={14} />
                    </span>
                  </Tooltip>
                )}
                <span className="grow" />
                {s.error ? (
                  <span className="sc-bad sc-store-facts">{s.error}</span>
                ) : (
                  <span className="dim num sc-store-facts">
                    {s.pixel_size_m != null && `${formatNum(s.pixel_size_m, s.pixel_size_m < 10 ? 1 : 0)} m/px`}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {chosen?.length === 0 && (
        <p className="sc-msg" role="alert">
          No DEM chosen
        </p>
      )}
      {issue && (
        <p className="sc-msg" role="alert">
          {issue}
        </p>
      )}
    </div>
  );
}
