import type { ReactNode } from "react";
import { Toggle } from "../../components/ui/Fields";

/** One layer row: toggle and name, optional trailing items, and (when on) its controls underneath. */
export function LayerRow({ on, label, onChange, tail, chips, disabled, children }: { on: boolean; label: string; onChange(v: boolean): void; tail?: ReactNode; chips?: ReactNode; disabled?: boolean; children?: ReactNode }) {
  return (
    <li className="map-layer" data-on={on} data-disabled={disabled || undefined}>
      <div className="map-layer-head">
        <span className="map-layer-toggle" inert={disabled}>
          <Toggle checked={on} onChange={onChange} label={label} />
        </span>
        {tail && <span className="map-layer-tail">{tail}</span>}
      </div>
      {chips && <div className="map-layer-chips">{chips}</div>}
      {on && children}
    </li>
  );
}

/** Opacity slider without a visible label. */
export function Opacity({ label, value, min = 0, onChange }: { label: string; value: number; min?: number; onChange(v: number): void }) {
  const pct = Math.round(value * 100);
  return (
    <div className="slider map-opacity">
      <input type="range" aria-label={label} min={min} max={100} step={5} value={pct} style={{ ["--pct" as string]: `${((pct - min) / (100 - min)) * 100}%` }} onChange={(e) => onChange(Number(e.target.value) / 100)} />
      <output className="num slider-out">{pct}%</output>
    </div>
  );
}

/** Compact colour ramp: gradient bar, min and max values, unit. */
export function Ramp({ gradient, min, max, unit, label }: { gradient: string; min: string; max: string; unit?: string; label: string }) {
  return (
    <div className="map-ramp" role="img" aria-label={`${label}: ${min} to ${max}${unit ? ` ${unit}` : ""}`}>
      <div className="map-ramp-bar" style={{ background: gradient }} />
      <div className="map-ramp-ends num" aria-hidden="true">
        <span>{min}</span>
        <span>
          {max}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
    </div>
  );
}
