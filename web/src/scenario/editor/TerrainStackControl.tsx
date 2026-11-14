import { Disclosure } from "../../components/ui/Disclosure";
import { Icon } from "../../components/ui/Icon";
import { Segmented } from "../../components/ui/Segmented";
import { Spinner } from "../../components/ui/Progress";
import { Tooltip } from "../../components/ui/Tooltip";
import { formatNum } from "../../lib/format";
import { useScenario } from "../store";
import { sortedStores, storeCovers, storeFacts, useTerrainStores, type TerrainStoreInfo } from "../terrainStack";
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
  const restricted = chosen !== null;

  const set = (ids: readonly string[] | null) => edit(["terrain_stores"], ids === null ? null : sortedStores(ids));
  const toggle = (demId: string, on: boolean) => {
    const cur = chosen ?? [];
    set(on ? [...cur.filter((x) => x !== demId), demId] : cur.filter((x) => x !== demId));
  };
  const usable = (s: TerrainStoreInfo) => !s.error;
  const rows: TerrainStoreInfo[] = [
    ...(stores ?? []),
    ...(chosen ?? []).filter((c) => stores !== null && !stores.some((s) => s.dem_id === c)).map((c): TerrainStoreInfo => ({ dem_id: c, meta_sha256: "", error: "not installed on the engine" })),
  ];

  return (
    <div className="sc-group">
      <GroupHead title="Terrain stack">
        <Segmented
          label="Terrain stack"
          size="sm"
          value={restricted ? "custom" : "default"}
          onChange={(v) => set(v === "default" ? null : (stores ?? []).filter(usable).map((s) => s.dem_id))}
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
      {stores === null && !error && <Spinner size={14} />}
      {rows.length > 0 && (
        <ol className="sc-stores" aria-label="Terrain stack DEMs, in precedence order">
          {rows.map((s, i) => {
            const on = !chosen || chosen.includes(s.dem_id);
            const out = storeCovers(s, lat, lon) === false;
            const disabled = !restricted || (!on && (out || !usable(s)));
            return (
              <li key={s.dem_id} className={`sc-store ${on ? "" : "off"} ${out ? "out" : ""}`}>
                <label>
                  <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => toggle(s.dem_id, e.target.checked)} />
                  <span className="sc-store-id num">{s.dem_id}</span>
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
                    {s.sigma_z_m != null && ` · σ ${formatNum(s.sigma_z_m, 2)} m`}
                  </span>
                )}
                <span className="faint num sc-store-rank">#{s.precedence ?? i + 1}</span>
              </li>
            );
          })}
        </ol>
      )}
      {rows.length > 0 && (
        <Disclosure title="Coverage" count={rows.length}>
          <ul className="sc-coverage">
            {rows.map((s) => (
              <li key={s.dem_id}>
                <span className="num">{s.dem_id}</span>
                <span className="dim">{storeFacts(s) || "No metadata"}</span>
              </li>
            ))}
          </ul>
        </Disclosure>
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
