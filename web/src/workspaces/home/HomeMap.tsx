import { useEffect, useMemo, useState } from "react";
import { terrainApi } from "../../api/terrain";
import { useLoad } from "../../api/useLoad";
import { IconButton } from "../../components/ui/Button";
import type { SiteEntry } from "../../scenario/api";
import { CursorBus } from "../map/cursorBus";
import type { ActiveLayer, AltMark, MapEngine, ScenarioMark } from "../map/engine";
import { MapCanvas } from "../map/MapCanvas";
import { viewKindFor } from "../map/urlState";
import "../../styles/map.css";

const loadTilesets = (signal: AbortSignal) => terrainApi.tilesets({ signal });
const loadStores = (signal: AbortSignal) => terrainApi.stores({ signal });

const LAYERS: ActiveLayer[] = [{ id: "relief", opacity: 1 }];
const FOCUS_RADIUS_M = 45_000;
const noop = () => undefined;

export interface MapFocus {
  lat_deg: number;
  lon_deg: number;
  nonce: number;
}

interface HomeMapProps {
  site: { lat_deg: number; lon_deg: number; name: string };
  focus: MapFocus;
  sites: SiteEntry[];
  pinned: AltMark[];
  onPickSite(id: string): void;
  onSetPoint(lat: number, lon: number): void;
  /** Go down to the ground at the site: the "Stand here" button, or zooming in past the closest zoom. */
  onStand?: () => void;
  hint?: string;
}

export function HomeMap({ site, focus, sites, pinned, onPickSite, onSetPoint, onStand, hint }: HomeMapProps) {
  const tilesets = useLoad(loadTilesets);
  const stores = useLoad(loadStores);
  const [engine, setEngine] = useState<MapEngine | null>(null);
  const bus = useMemo(() => new CursorBus(), []);
  const kind = viewKindFor(focus.lat_deg);
  const tilesetList = tilesets.state.status === "ready" ? tilesets.state.data.tilesets : null;
  const renderVersion = tilesets.state.status === "ready" ? tilesets.state.data.render_version : "";
  const storeList = useMemo(() => (stores.state.status === "ready" ? stores.state.data.stores : []), [stores.state]);
  const mark = useMemo<ScenarioMark>(() => ({ lat_deg: site.lat_deg, lon_deg: site.lon_deg, name: site.name, ellipse: null }), [site.lat_deg, site.lon_deg, site.name]);

  useEffect(() => {
    if (!engine || !tilesetList) return;
    const id = window.setTimeout(() => engine.fitAround(focus.lat_deg, focus.lon_deg, kind === "global" ? 600_000 : FOCUS_RADIUS_M), 0);
    return () => window.clearTimeout(id);
  }, [engine, tilesetList, focus, kind]);

  return (
    <div className="home-map">
      <MapCanvas
        kind={kind}
        initialView={null}
        tilesets={tilesetList}
        renderVersion={renderVersion}
        stores={storeList}
        sites={sites}
        layers={LAYERS}
        graticule
        showStores={false}
        showSites
        selectedId={null}
        scenario={mark}
        alternatives={pinned}
        blocker={null}
        pins={[]}
        selectedPin={null}
        regional={null}
        regionalOpacity={0}
        measure={[]}
        mode="choose"
        bus={bus}
        onEngine={setEngine}
        onPickSite={(id) => {
          if (id) onPickSite(id);
        }}
        onPickPin={noop}
        onSetSite={onSetPoint}
        onMeasure={noop}
        onView={noop}
        onTileProblem={noop}
        onZoomPastLimit={onStand ?? noop}
      />
      <div className="home-map-tools toolstrip">
        <IconButton icon="plus" size="sm" label="Zoom in" onClick={() => engine?.zoomBy(1)} />
        <IconButton icon="minus" size="sm" label="Zoom out" onClick={() => engine?.zoomBy(-1)} />
        <IconButton icon="target" size="sm" label="Centre on the site" onClick={() => engine?.fitAround(site.lat_deg, site.lon_deg, FOCUS_RADIUS_M)} />
        {onStand && <IconButton icon="terrain" size="sm" label="Stand here: the view from the ground at the site" onClick={onStand} />}
      </div>
      <p className="home-map-hint">{hint ?? "Click to move the site · zoom in fully to stand there"}</p>
    </div>
  );
}
