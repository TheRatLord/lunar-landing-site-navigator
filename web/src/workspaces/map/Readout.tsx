import { useEffect, useRef } from "react";
import { formatLat, formatLon } from "../../lib/coords";
import { formatNum, formatValue } from "../../lib/format";
import type { CursorBus } from "./cursorBus";
import type { CursorInfo } from "./engine";

const NONE = "–";

interface Cell {
  key: "lat" | "lon" | "elev" | "slope";
  label: string;
}

const CELLS: readonly Cell[] = [
  { key: "lat", label: "Lat" },
  { key: "lon", label: "Lon" },
  { key: "elev", label: "Elev" },
  { key: "slope", label: "Slope" },
];

function slopeText(h: CursorInfo["height"]): string {
  if (h.state === "loading") return "…";
  if (h.state !== "ok" || h.slope_deg === null) return NONE;
  return `${formatNum(h.slope_deg, 1)}°`;
}

function describe(c: CursorInfo): Record<Cell["key"], string> {
  const h = c.height;
  const elev = h.state === "ok" && h.value_m !== null ? formatValue(h.value_m, "m", 1) : h.state === "loading" ? "…" : NONE;
  return {
    lat: formatLat(c.lat_deg, 2),
    lon: formatLon(c.lon_deg, 2),
    elev,
    slope: slopeText(h),
  };
}

export function Readout({ bus, at }: { bus: CursorBus; at?: (lat: number, lon: number) => string | null }) {
  const root = useRef<HTMLDListElement>(null);
  const refs = useRef<Partial<Record<Cell["key"], HTMLElement | null>>>({});
  const extra = useRef<HTMLDivElement>(null);
  const extraText = useRef<HTMLElement>(null);
  const atRef = useRef(at);
  useEffect(() => {
    atRef.current = at;
  });

  useEffect(() => {
    const paint = (c: CursorInfo | null) => {
      if (root.current) root.current.hidden = c === null;
      if (!c) return;
      const d = describe(c);
      for (const cell of CELLS) {
        const el = refs.current[cell.key];
        if (el && el.textContent !== d[cell.key]) el.textContent = d[cell.key];
      }
      const word = atRef.current?.(c.lat_deg, c.lon_deg) ?? null;
      if (extra.current) extra.current.hidden = word === null;
      if (extraText.current && word !== null && extraText.current.textContent !== word) extraText.current.textContent = word;
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
      <div ref={extra} className="map-readout-cell" hidden>
        <dt>Search</dt>
        <dd ref={extraText} />
      </div>
    </dl>
  );
}
