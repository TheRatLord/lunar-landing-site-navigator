import type { TilesetDef } from "../../api/terrain";
import { Segmented } from "../../components/ui/Segmented";
import { LayerRow, Opacity, Ramp } from "./LayerRow";
import { legendModel } from "./legend";
import { useMapStore, type BaseLayer } from "./mapStore";

const BASES: Array<{ value: BaseLayer; label: string }> = [
  { value: "relief", label: "Relief" },
  { value: "elevation", label: "Elevation" },
  { value: "slope", label: "Slope" },
];

export function LayersPanel({ tileset }: { tileset: TilesetDef | null }) {
  const s = useMapStore();
  const def = s.base === "relief" ? null : (tileset?.layers.find((l) => l.id === s.base) ?? null);
  const m = def ? legendModel(def.legend) : null;

  return (
    <div className="map-panel">
      <section className="map-group" aria-label="Base map">
        <Segmented label="Base map" size="sm" value={s.base} onChange={(v) => s.set({ base: v as BaseLayer })} options={BASES} />
        {def && m?.gradient && m.ticks.length >= 2 && (
          <div className="map-base-detail">
            <Ramp label={def.title} gradient={m.gradient} min={m.ticks[0]!.label} max={m.ticks[m.ticks.length - 1]!.label} unit={m.units === "deg" ? "°" : m.units} />
            <Opacity label={`${def.title} opacity`} value={s.baseOpacity} onChange={(v) => s.set({ baseOpacity: v })} />
          </div>
        )}
      </section>
      <section className="map-group" aria-label="Overlays">
        <ul className="map-rows">
          <LayerRow on={s.graticule} label="Graticule" onChange={(graticule) => s.set({ graticule })} />
          <LayerRow on={s.sites} label="Catalogue sites" onChange={(sites) => s.set({ sites })} />
        </ul>
      </section>
    </div>
  );
}
