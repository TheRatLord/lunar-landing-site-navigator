import type { Legend, StoreInfo, TilesetDef } from "../../api/terrain";
import { ServiceNotice } from "../../components/ServiceNotice";
import { Disclosure } from "../../components/ui/Disclosure";
import { Icon } from "../../components/ui/Icon";
import { Spinner } from "../../components/ui/Progress";
import { LayerRow, Opacity, Ramp } from "./LayerRow";
import { legendModel } from "./legend";
import { LAYER_ORDER, useMapStore } from "./mapStore";
import { PreviewLayers, type PreviewLayersProps } from "./PreviewLayers";
import type { Loaded } from "../../api/useLoad";

function LayerRamp({ legend, title }: { legend: Legend; title: string }) {
  const m = legendModel(legend);
  if (!m.gradient || m.ticks.length < 2) return null;
  return <Ramp label={title} gradient={m.gradient} min={m.ticks[0]!.label} max={m.ticks[m.ticks.length - 1]!.label} unit={m.units} />;
}

interface LayersPanelProps extends PreviewLayersProps {
  tileset: TilesetDef | null;
  tilesets: Loaded<unknown>;
  stores: Loaded<{ stores: StoreInfo[] }>;
  onRetryStores(): void;
  tileProblem: { count: number; last: string } | null;
  siteCount: { shown: number; total: number } | null;
}

export function LayersPanel({ tileset, tilesets, stores, onRetryStores, tileProblem, siteCount, ...preview }: LayersPanelProps) {
  const s = useMapStore();

  return (
    <div className="map-panel">
      <section className="map-group" aria-label="Base layers">
        {tilesets.status === "loading" && <Spinner size={12} label="Loading" />}
        {tileset && (
          <ul className="map-rows">
            {LAYER_ORDER.map((id) => {
              const def = tileset.layers.find((l) => l.id === id);
              if (!def) return null;
              const st = s.layers[id];
              const l = def.legend;
              const sun = l.sun_azimuth_deg !== undefined && l.sun_altitude_deg !== undefined ? `${l.sun_azimuth_deg}° · ${l.sun_altitude_deg}°` : null;
              return (
                <LayerRow key={id} on={st.on} label={def.title} onChange={(on) => s.setLayer(id, { on })}>
                  <Opacity label={`${def.title} opacity`} value={st.opacity} onChange={(v) => s.setLayer(id, { opacity: v })} />
                  <LayerRamp legend={l} title={def.title} />
                  {sun && (
                    <span className="map-sun num" role="img" aria-label={`Sun azimuth ${l.sun_azimuth_deg}°, altitude ${l.sun_altitude_deg}°`}>
                      <Icon name="sun" size={12} />
                      {sun}
                    </span>
                  )}
                </LayerRow>
              );
            })}
          </ul>
        )}
        {tileset && (
          <Disclosure title="Tileset">
            <dl className="map-kv">
              <div>
                <dt>Id</dt>
                <dd className="mono">{tileset.id}</dd>
              </div>
              <div>
                <dt>Max level</dt>
                <dd className="num">{tileset.zoom_max}</dd>
              </div>
              <div>
                <dt>Resolution</dt>
                <dd className="num">{formatRes(tileset)}</dd>
              </div>
            </dl>
          </Disclosure>
        )}
        {tileProblem && (
          <p className="map-warn" role="status">
            <Icon name="alert" size={12} />
            <span>
              {tileProblem.count} failed · {tileProblem.last}
            </span>
          </p>
        )}
      </section>

      <PreviewLayers {...preview} />

      <section className="map-group" aria-label="Overlays">
        <ul className="map-rows">
          <LayerRow on={s.graticule} label="Graticule" onChange={(graticule) => s.set({ graticule })} />
          <LayerRow on={s.sites} label="Catalogue sites" onChange={(sites) => s.set({ sites })} tail={siteCount ? <span className="num">{siteCount.shown === siteCount.total ? siteCount.total : `${siteCount.shown} / ${siteCount.total}`}</span> : null} />
          <LayerRow
            on={s.stores}
            label="DEM footprints"
            onChange={(st) => s.set({ stores: st })}
            tail={stores.status === "loading" ? <Spinner size={12} label="Loading" /> : stores.status === "ready" ? <span className="num">{stores.data.stores.length}</span> : null}
          />
        </ul>
        {stores.status === "error" && <ServiceNotice error={stores.error} what="the DEM footprints (GET /api/v1/terrain/stores)" onRetry={onRetryStores} />}
      </section>
    </div>
  );
}

function formatRes(ts: TilesetDef): string {
  const r = ts.resolution_m_or_deg[ts.zoom_max];
  if (r === undefined) return "";
  return ts.units === "m" ? `${r < 10 ? r.toFixed(1) : r.toFixed(0)} m/px` : `${r.toPrecision(2)}°/px`;
}
