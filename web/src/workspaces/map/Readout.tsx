import { useEffect, useRef } from "react";
import { formatLat, formatLon } from "../../lib/coords";
import { formatNum, formatValue } from "../../lib/format";
import type { CursorBus } from "./cursorBus";
import type { CursorInfo } from "./engine";

const NONE = "–";

interface Cell {
  key: "lat" | "lon" | "x" | "y" | "elev" | "slope";
  label: string;
}

const CELLS: readonly Cell[] = [
  { key: "lat", label: "Lat" },
  { key: "lon", label: "Lon" },
  { key: "x", label: "X" },
  { key: "y", label: "Y" },
  { key: "elev", label: "Elev" },
  { key: "slope", label: "Slope" },
];

function slopeText(h: CursorInfo["height"]): string {
  if (h.state === "loading") return "…";
  if (h.state !== "ok" || h.slope_deg === null || h.baseline_m === null) return NONE;
  const { x, y } = h.baseline_m;
  const base = Math.abs(x - y) <= 0.005 * Math.max(x, y) ? formatValue(x, "m", 0) : `${formatValue(x, "m", 0)} × ${formatValue(y, "m", 0)} (x × y)`;
  return `${formatNum(h.slope_deg, 1)}° over ${base}`;
}

function describe(c: CursorInfo): Record<Cell["key"], string> {
  const h = c.height;
  const elev = h.state === "ok" && h.value_m !== null ? formatValue(h.value_m, "m", 1) : h.state === "loading" ? "…" : NONE;
  return {
    lat: formatLat(c.lat_deg, 4),
    lon: formatLon(c.lon_deg, 4),
    x: c.x_m === null ? NONE : formatValue(c.x_m, "m", 1),
    y: c.y_m === null ? NONE : formatValue(c.y_m, "m", 1),
    elev,
    slope: slopeText(h),
  };
}

/** Cursor readout strip: painted imperatively on every pointer move, hidden while the cursor is off the map. */
export function Readout({ bus }: { bus: CursorBus }) {
  const root = useRef<HTMLDListElement>(null);
  const refs = useRef<Partial<Record<Cell["key"], HTMLElement | null>>>({});

  useEffect(() => {
    const paint = (c: CursorInfo | null) => {
      if (root.current) root.current.hidden = c === null;
      if (!c) return;
      const d = describe(c);
      for (const cell of CELLS) {
        const el = refs.current[cell.key];
        if (el && el.textContent !== d[cell.key]) el.textContent = d[cell.key];
      }
    };
    paint(bus.last);
    return bus.subscribe(paint);
  }, [bus]);

  return (
    <dl ref={root} className="map-readout" aria-label="Cursor readout" hidden>
      {CELLS.map((c) => (
        <div key={c.key} className="map-readout-cell">
          <dt>{c.label}</dt>
          <dd
            ref={(el) => {
              refs.current[c.key] = el;
            }}
          />
        </div>
      ))}
    </dl>
  );
}
