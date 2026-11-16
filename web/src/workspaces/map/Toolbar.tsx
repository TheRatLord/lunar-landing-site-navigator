import type { ReactNode, Ref } from "react";
import { IconButton } from "../../components/ui/Button";
import { Popover } from "../../components/ui/Popover";
import { Segmented } from "../../components/ui/Segmented";
import type { SiteEntry } from "../../scenario/api";
import type { MapMode } from "./engine";
import { MapSearch } from "./MapSearch";
import type { ViewKind } from "./urlState";

interface ToolbarProps {
  kind: ViewKind;
  polar: "south" | "north";
  mode: MapMode;
  canFitSite: boolean;
  sites: readonly SiteEntry[];
  searchRef: Ref<HTMLInputElement>;
  layers: ReactNode;
  dockOpen: boolean;
  canDock: boolean;
  onDock(): void;
  onKind(k: ViewKind): void;
  onZoom(dz: number): void;
  onFitSite(): void;
  onMeasure(): void;
  onSite(site: SiteEntry): void;
  onPoint(lat: number, lon: number): void;
}

export function Toolbar(p: ToolbarProps) {
  return (
    <div className="map-float map-float-tl">
      <div className="toolstrip toolstrip-float" role="toolbar" aria-label="Map tools">
        <Segmented
          label="Map view"
          size="sm"
          value={p.kind === "global" ? "global" : p.polar}
          onChange={(v) => p.onKind(v as ViewKind)}
          options={[
            { value: p.polar, label: p.polar === "south" ? "South" : "North" },
            { value: "global", label: "Global" },
          ]}
        />
        <span className="toolstrip-sep" aria-hidden="true" />
        <IconButton icon="plus" label="Zoom in" shortcut="+" size="sm" onClick={() => p.onZoom(1)} />
        <IconButton icon="minus" label="Zoom out" shortcut="−" size="sm" onClick={() => p.onZoom(-1)} />
        <IconButton icon="target" label="Zoom to the selected site" shortcut="F" size="sm" disabled={!p.canFitSite} onClick={p.onFitSite} />
        <IconButton icon="ruler" label="Measure" shortcut="M" size="sm" pressed={p.mode === "measure"} onClick={p.onMeasure} />
        <Popover label="Layers" icon="layers" iconOnly width={260}>
          {p.layers}
        </Popover>
        {!p.dockOpen && p.canDock && <IconButton icon="panelRight" label="Show panel" shortcut="L" size="sm" onClick={p.onDock} />}
      </div>
      <MapSearch sites={p.sites} inputRef={p.searchRef} onSite={p.onSite} onPoint={p.onPoint} />
    </div>
  );
}
