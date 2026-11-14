import { Link } from "react-router-dom";
import type { CountdownKind, CrossingEvent } from "../../contract/types";
import { SITE_ENDPOINTS, type AttributionResult } from "../../api/site";
import { ApiError } from "../../api/client";
import { Button, IconButton } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { Popover } from "../../components/ui/Popover";
import { Spinner } from "../../components/ui/Progress";
import { ServiceNotice } from "../../components/ServiceNotice";
import { NBSP, formatNum } from "../../lib/format";
import { formatUtc } from "../../lib/time";
import { COUNTDOWN_KINDS, KIND_LABEL, eventName, nextCrossing } from "./adapt";
import type { AttributionState } from "./useAttribution";

export interface EventButtonsProps {
  events: readonly CrossingEvent[];
  timeMs: number;
  disabledReason: string | null;
  busy: boolean;
  onAttribute: (kind: CountdownKind, e: CrossingEvent) => void;
}

/** Four attached buttons, one per next horizon event, each tracing the terrain feature that sets it. */
export function EventButtons({ events, timeMs, disabledReason, busy, onAttribute }: EventButtonsProps) {
  return (
    <div className="toolstrip" role="group" aria-label="Trace the terrain behind the next event">
      {COUNTDOWN_KINDS.map((kind) => {
        const e = nextCrossing(events, kind, timeMs);
        const reason = disabledReason ?? (e ? null : `No ${KIND_LABEL[kind].toLowerCase()} after this time`);
        return (
          <Button
            key={kind}
            size="sm"
            variant="ghost"
            icon={kind === "sunset" || kind === "sunrise" ? "sun" : "earth"}
            disabled={!!reason || busy}
            title={reason ?? `${eventName(kind, e)} · ${formatUtc(e!.best_ms)}`}
            onClick={() => e && onAttribute(kind, e)}
          >
            {KIND_LABEL[kind]}
          </Button>
        );
      })}
    </div>
  );
}

function Row({ k, v, unit }: { k: string; v: string; unit?: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd className="num">
        {v}
        {unit ? <span className="faint">{unit.startsWith("°") ? unit : NBSP + unit}</span> : null}
      </dd>
    </>
  );
}

function Details({ result }: { result: AttributionResult }) {
  const ev = result.event;
  const az = result.azimuth;
  return (
    <dl className="attr-grid">
      {ev && (
        <>
          <Row k="Event time" v={ev.utc.replace("T", " ").replace(/\.\d+Z$/, "Z")} />
          <Row k="Time basis" v={ev.time_basis} />
          {ev.eclipse_fraction > 0 && <Row k="Sun covered by the Earth" v={formatNum(100 * ev.eclipse_fraction, 1)} unit="%" />}
          <Row k="Horizon elevation" v={formatNum(ev.horizon_elev_deg, 3)} unit="°" />
          <Row k="Object elevation" v={formatNum(ev.object_elev_deg, 3)} unit="°" />
          {ev.station && <Row k="Station" v={ev.station} />}
          {ev.limiting_side && <Row k="Limiting side" v={ev.limiting_side} />}
        </>
      )}
      {!ev && az && <Row k={`Horizon elevation, ${az.observer}`} v={formatNum(az.horizon_elev_deg, 3)} unit="°" />}
      {ev && (
        <div className="attr-cause">
          <strong>{ev.cause}</strong>
          {!ev.limb_crossing && <span className="chip chip-marginal attr-chip">Not a limb crossing</span>}
          {ev.detail && <p className="faint">{ev.detail}</p>}
        </div>
      )}
    </dl>
  );
}

export interface AttributionBarProps {
  state: AttributionState;
  onClear: () => void;
  onShow3D: () => void;
}

/** The attribution outcome as data: feature, bearing, distance, with links to where the blocker is drawn. */
export function AttributionBar({ state, onClear, onShow3D }: AttributionBarProps) {
  if (state.phase === "idle") return null;
  const result = state.result;
  const ev = result?.event ?? null;
  const az = result?.azimuth ?? null;
  const b = ev?.blocker ?? az?.blocker ?? null;
  const dist = ev?.blocker_dist_m ?? az?.blocker_dist_m ?? null;
  const bearing = ev?.az_deg ?? az?.az_deg ?? null;
  const lat = b?.["lat_deg"];
  const lon = b?.["lon_deg"];
  const height = b?.["height_m"];
  const name = typeof b?.["name"] === "string" ? (b["name"] as string) : null;
  const done = state.phase === "done" && result;

  if (state.phase === "error" && state.error instanceof ApiError && !state.missing) {
    return (
      <div className="attr" aria-live="polite">
        <ServiceNotice error={state.error} what="the blocker attribution" />
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
      {state.phase === "error" &&
        (state.missing ? (
          <span className="chip chip-unknown" role="status">
            <Icon name="plug" size={12} />
            <span className="num">POST {SITE_ENDPOINTS.attribution}</span>
          </span>
        ) : (
          <span role="alert" className="attr-err">
            {state.error?.message}
          </span>
        ))}
      {done && (
        <>
          {!ev && !az ? (
            <span className="faint">{result.message || "none in the analysed span"}</span>
          ) : (
            <>
              {name && <strong>{name}</strong>}
              {lat !== undefined && lon !== undefined && (
                <span className="num">
                  {formatNum(lat, 4)}°, {formatNum(lon, 4)}°{height !== undefined && <span className="faint"> · {formatNum(height, 0)} m</span>}
                </span>
              )}
              {bearing !== null && (
                <span className="num">
                  {formatNum(bearing, 1)}
                  <span className="faint">°</span>
                </span>
              )}
              <span className="num">
                {dist === null ? <span className="faint">smooth sphere</span> : <>{formatNum(dist / 1000, 3)} <span className="faint">km</span></>}
              </span>
              <Link to="/explore" className="btn btn-sm btn-default">
                <Icon name="map" size={14} />
                Show on map
              </Link>
              <Button size="sm" icon="terrain" onClick={onShow3D}>
                Show in 3D
              </Button>
              <Popover label="Details" align="end" width={340}>
                <Details result={result} />
              </Popover>
            </>
          )}
        </>
      )}
      <span className="grow" />
      <IconButton icon="close" label="Clear trace" size="sm" onClick={onClear} />
    </div>
  );
}
