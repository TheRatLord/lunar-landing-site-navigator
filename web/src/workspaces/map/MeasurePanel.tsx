import { useMemo } from "react";
import { Button, IconButton } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Toolstrip } from "../../components/ui/Toolstrip";
import { formatLat, formatLon } from "../../lib/coords";
import { useMapStore } from "./mapStore";
import { formatBearing, formatDistance, legs } from "./measure";

export function MeasurePanel() {
  const points = useMapStore((s) => s.measure);
  const mode = useMapStore((s) => s.mode);
  const set = useMapStore((s) => s.set);
  const pop = useMapStore((s) => s.popMeasure);
  const lg = useMemo(() => legs(points), [points]);
  const total = lg[lg.length - 1]?.cumulative_m ?? 0;
  const measuring = mode === "measure";
  const toggle = () => set({ mode: measuring ? "pan" : "measure" });

  if (points.length === 0) {
    return (
      <EmptyState
        icon="ruler"
        title="Click the map to add points"
        action={
          <Button size="sm" variant={measuring ? "default" : "primary"} icon="ruler" aria-pressed={measuring} onClick={toggle}>
            Measure
          </Button>
        }
      />
    );
  }
  return (
    <div className="map-panel">
      <div className="map-measure-bar">
        <Toolstrip>
          <IconButton icon="ruler" label="Measure" shortcut="M" size="sm" pressed={measuring} onClick={toggle} />
          <IconButton icon="reset" label="Remove last point" shortcut="Backspace" size="sm" onClick={pop} />
          <IconButton icon="trash" label="Clear points" shortcut="Esc" size="sm" onClick={() => set({ measure: [] })} />
        </Toolstrip>
        <span className="grow" />
        <span className="map-measure-total num">{formatDistance(total)}</span>
      </div>
      <table className="map-table">
        <caption className="sr-only">Measured points and legs</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Point</th>
            <th scope="col" className="num">
              Leg
            </th>
            <th scope="col" className="num">
              Bearing
            </th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => {
            const leg = lg[i - 1];
            return (
              <tr key={`${p.lat_deg}|${p.lon_deg}|${i}`}>
                <td className="num">{i + 1}</td>
                <td className="num">
                  {formatLat(p.lat_deg, 4)} {formatLon(p.lon_deg, 4)}
                </td>
                <td className="num">{leg ? formatDistance(leg.distance_m) : "–"}</td>
                <td className="num">{leg ? formatBearing(leg.bearing_deg) : "–"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
