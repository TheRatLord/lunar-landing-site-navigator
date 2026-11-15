import { Link } from "react-router-dom";
import type { AttributionResult } from "../../api/site";
import { ApiError } from "../../api/client";
import { Button, IconButton } from "../../components/ui/Button";
import { Popover } from "../../components/ui/Popover";
import { Spinner } from "../../components/ui/Progress";
import { ServiceNotice } from "../../components/ServiceNotice";
import { whenText } from "../../components/viz/units";
import { formatNum } from "../../lib/format";
import { wrap360 } from "../../lib/scale";
import type { Scenario } from "../../scenario/types";
import { stationShortName, terrainSets } from "./adapt";
import type { AttributionState } from "./useAttribution";

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

function distanceText(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  return `${formatNum(km, km >= 10 ? 0 : 1)} km`;
}

function bearingText(az: number): string {
  return `${COMPASS[Math.round(wrap360(az) / 45) % 8]} (${Math.round(wrap360(az))}°)`;
}

function maskDeg(detail: string | null | undefined): number | null {
  const m = detail ? /mask\s+([\d.]+)\s*deg/i.exec(detail) : null;
  return m ? Number(m[1]) : null;
}

function causeText(ev: NonNullable<AttributionResult["event"]>, scenario: Scenario | null): string {
  if (ev.station) {
    const meta = scenario?.network.stations.find((s) => s.id === ev.station || s.name === ev.station);
    const name = meta?.name ? stationShortName(meta.name) : ev.station.toUpperCase();
    const mask = maskDeg(ev.detail) ?? meta?.rx_mask_deg ?? null;
    if (ev.limiting_side && /station/i.test(ev.limiting_side)) return mask !== null ? `Set by ${name}'s ${formatNum(mask, 0)}° mask` : `Set by ${name}'s elevation mask`;
    return `Set at ${name}`;
  }
  if (ev.limiting_side) return `Set by the ${ev.limiting_side}`;
  return SUN_CAUSE[ev.cause] ?? "No terrain in the way";
}

const SUN_CAUSE: Record<string, string> = {
  "Earth eclipse": "Set by the Earth covering the Sun",
  "smooth-sphere horizon": "Set by the curve of the Moon, not terrain",
  "terrain horizon": "Set by the terrain horizon",
  "horizon at the sphere dip": "Set by the horizon",
  "no horizon limb crossing found near the event": "The Sun grazes the horizon; no single crossing",
};

const BASIS: Record<string, string> = {
  "limb crossing": "First edge of the Sun",
  "half-flux event": "Half the disc",
};

function mapHref(lat: number, lon: number): string {
  return `/map?lat=${lat.toFixed(4)}&lon=${(wrap360(lon + 180) - 180).toFixed(4)}&mark=blocker`;
}

function Details({ result }: { result: AttributionResult }) {
  const ev = result.event;
  if (!ev) return null;
  const sun = ev.kind === "sunset" || ev.kind === "sunrise";
  return (
    <dl className="attr-grid">
      <dt>{sun ? (BASIS[ev.time_basis] ?? "Time") : "Time"}</dt>
      <dd className="num">{whenText(Date.parse(ev.utc))}</dd>
      {ev.eclipse_fraction > 0 && (
        <>
          <dt>Sun covered by Earth</dt>
          <dd className="num">{formatNum(100 * ev.eclipse_fraction, 0)} %</dd>
        </>
      )}
      <dt>Horizon</dt>
      <dd className="num">{formatNum(ev.horizon_elev_deg, 1)}°</dd>
      <dt>{sun ? "Sun elevation" : "Earth elevation"}</dt>
      <dd className="num">{formatNum(ev.object_elev_deg, 1)}°</dd>
    </dl>
  );
}

export interface AttributionBarProps {
  state: AttributionState;
  scenario: Scenario | null;
  onClear: () => void;
  onShow3D: (() => void) | null;
}

export function AttributionBar({ state, scenario, onClear, onShow3D }: AttributionBarProps) {
  if (state.phase === "idle") return null;
  const result = state.result;
  const ev = result?.event ?? null;
  const az = result?.azimuth ?? null;
  const b = terrainSets(ev) ? (ev?.blocker ?? az?.blocker ?? null) : null;
  const dist = ev?.blocker_dist_m ?? az?.blocker_dist_m ?? null;
  const bearing = ev?.az_deg ?? az?.az_deg ?? null;
  const lat = b?.["lat_deg"];
  const lon = b?.["lon_deg"];
  const done = state.phase === "done" && result;

  if (state.phase === "error") {
    return (
      <div className="attr" aria-live="polite">
        {state.error instanceof ApiError ? <ServiceNotice error={state.error} what="the trace" /> : <span role="alert" className="attr-err">Could not trace it</span>}
        <span className="grow" />
        <IconButton icon="close" label="Clear trace" size="sm" onClick={onClear} />
      </div>
    );
  }

  return (
    <div className="attr" aria-live="polite">
      <strong className="attr-label">{state.label}</strong>
      {state.phase === "running" && (
        <span className="attr-state" role="status">
          <Spinner size={12} />
        </span>
      )}
      {done &&
        (!ev && !az ? (
          <span className="faint">Nothing found</span>
        ) : b && dist !== null && bearing !== null ? (
          <>
            <span>
              Terrain {distanceText(dist)} {bearingText(bearing)}
            </span>
            {lat !== undefined && lon !== undefined && (
              <Link to={mapHref(lat, lon)} className="btn btn-sm btn-default">
                Show on map
              </Link>
            )}
            {onShow3D && (
              <Button size="sm" onClick={onShow3D}>
                Show in 3D
              </Button>
            )}
          </>
        ) : ev ? (
          <span>{causeText(ev, scenario)}</span>
        ) : (
          <span className="faint">No terrain in the way</span>
        ))}
      {done && ev && (
        <Popover label="Details" align="end" width={300}>
          <Details result={result} />
        </Popover>
      )}
      <span className="grow" />
      <IconButton icon="close" label="Clear trace" size="sm" onClick={onClear} />
    </div>
  );
}
