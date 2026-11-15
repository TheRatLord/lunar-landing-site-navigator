import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { terrainApi } from "../../api/terrain";
import { useLoad } from "../../api/useLoad";
import { IconButton } from "../../components/ui/Button";
import type { SiteEntry } from "../../scenario/api";
import { CursorBus } from "../map/cursorBus";
import type { ActiveLayer, AltMark, MapEngine, MapOptions, ScenarioMark, SearchArea } from "../map/engine";
import { MapCanvas } from "../map/MapCanvas";
import { announceSiteMove, siteSnapshot } from "../map/siteMove";
import { viewKindFor } from "../map/urlState";
import "../../styles/map.css";

const loadTilesets = (signal: AbortSignal) => terrainApi.tilesets({ signal });

const LAYERS: ActiveLayer[] = [{ id: "relief", opacity: 1 }];
const OPTIONS: MapOptions = { graticule: false, sites: true, compass: false };
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
  radiusKm?: number | null;
}

export function HomeMap({ site, focus, sites, pinned, onPickSite, onSetPoint, radiusKm }: HomeMapProps) {
  const tilesets = useLoad(loadTilesets);
  const navigate = useNavigate();
  const [engine, setEngine] = useState<MapEngine | null>(null);
  const bus = useMemo(() => new CursorBus(), []);
  const kind = viewKindFor(focus.lat_deg);
  const tilesetList = tilesets.state.status === "ready" ? tilesets.state.data.tilesets : null;
  const renderVersion = tilesets.state.status === "ready" ? tilesets.state.data.render_version : "";
  const mark = useMemo<ScenarioMark>(() => ({ lat_deg: site.lat_deg, lon_deg: site.lon_deg, name: site.name, ellipse: null }), [site.lat_deg, site.lon_deg, site.name]);
  const area = useMemo<SearchArea | null>(() => (radiusKm ? { lat_deg: site.lat_deg, lon_deg: site.lon_deg, radius_m: radiusKm * 1000 } : null), [radiusKm, site.lat_deg, site.lon_deg]);
  const fitRadius = Math.max(FOCUS_RADIUS_M, (radiusKm ?? 0) * 1300);

  useEffect(() => {
    if (!engine || !tilesetList) return;
    const id = window.setTimeout(() => engine.fitAround(focus.lat_deg, focus.lon_deg, fitRadius), 0);
    return () => window.clearTimeout(id);
  }, [engine, tilesetList, focus, fitRadius]);

  const moved = (change: () => void) => {
    const prev = siteSnapshot();
    change();
    announceSiteMove(prev, () => navigate("/site"));
  };

  return (
    <div className="home-map">
      <MapCanvas
        kind={kind}
        initialView={null}
        tilesets={tilesetList}
        renderVersion={renderVersion}
        sites={sites}
        layers={LAYERS}
        options={OPTIONS}
        selectedId={null}
        scenario={mark}
        alternatives={pinned}
        blocker={null}
        pins={[]}
        selectedPin={null}
        area={area}
        probe={null}
        measure={[]}
        mode="choose"
        bus={bus}
        onEngine={setEngine}
        onPickSite={(id) => {
          if (id) moved(() => onPickSite(id));
        }}
        onPickPin={noop}
        onSetSite={(lat, lon) => moved(() => onSetPoint(lat, lon))}
        onMeasure={noop}
      />
      <div className="home-map-tools toolstrip">
        <IconButton icon="plus" size="sm" label="Zoom in" onClick={() => engine?.zoomBy(1)} />
        <IconButton icon="minus" size="sm" label="Zoom out" onClick={() => engine?.zoomBy(-1)} />
        <IconButton icon="target" size="sm" label="Centre on the site" onClick={() => engine?.fitAround(site.lat_deg, site.lon_deg, fitRadius)} />
      </div>
    </div>
  );
}
