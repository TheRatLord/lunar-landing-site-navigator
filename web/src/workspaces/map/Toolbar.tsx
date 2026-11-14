import { IconButton } from "../../components/ui/Button";
import { Segmented } from "../../components/ui/Segmented";
import type { Hemisphere } from "../../lib/projection";
import { CoordinateEntry } from "./CoordinateEntry";
import type { MapMode } from "./engine";
import { VIEW_KINDS, type ViewKind } from "./urlState";

const VIEW_LABEL: Record<ViewKind, string> = { south: "South", north: "North", global: "Global" };

interface ToolbarProps {
  kind: ViewKind;
  hemisphere: Hemisphere | null;
  mode: MapMode;
  canSet: boolean;
  canFitSite: boolean;
  canUndo: boolean;
  onKind(k: ViewKind): void;
  onMode(m: MapMode): void;
  onZoom(dz: number): void;
  onFitSite(): void;
  onFitRegion(): void;
  onUndo(): void;
  onGo(lat: number, lon: number): void;
}

export function Toolbar(p: ToolbarProps) {
  return (
    <div className="map-float map-float-tl">
      <div className="toolstrip toolstrip-float" role="toolbar" aria-label="Map tools">
        <Segmented label="Map projection" size="sm" value={p.kind} onChange={(v) => p.onKind(v as ViewKind)} options={VIEW_KINDS.map((k) => ({ value: k, label: VIEW_LABEL[k] }))} />
        <span className="toolstrip-sep" aria-hidden="true" />
        <IconButton icon="plus" label="Zoom in" shortcut="+" size="sm" onClick={() => p.onZoom(1)} />
        <IconButton icon="minus" label="Zoom out" shortcut="−" size="sm" onClick={() => p.onZoom(-1)} />
        <IconButton icon="target" label="Zoom to plan site" shortcut="F" size="sm" disabled={!p.canFitSite} onClick={p.onFitSite} />
        <IconButton icon="expand" label="Zoom to region" shortcut="R" size="sm" onClick={p.onFitRegion} />
        <span className="toolstrip-sep" aria-hidden="true" />
        <IconButton icon="site" label="Pick plan site on map" shortcut="S" size="sm" pressed={p.mode === "set"} disabled={!p.canSet} onClick={() => p.onMode(p.mode === "set" ? "pan" : "set")} />
        <IconButton icon="ruler" label="Measure" shortcut="M" size="sm" pressed={p.mode === "measure"} onClick={() => p.onMode(p.mode === "measure" ? "pan" : "measure")} />
        <IconButton icon="reset" label="Undo" shortcut="Ctrl+Z" size="sm" disabled={!p.canUndo} onClick={p.onUndo} />
      </div>
      <CoordinateEntry hemisphere={p.hemisphere} onGo={p.onGo} />
    </div>
  );
}
