import { Button } from "../../../components/ui/Button";
import { Icon } from "../../../components/ui/Icon";
import { Spinner } from "../../../components/ui/Progress";
import { formatNum } from "../../../lib/format";
import type { GroundPatches } from "./useGroundPatches";

export interface BodyLabel {
  body: "sun" | "earth";
  x: number;
  y: number;
  elDeg: number;
  azDeg: number;
}

interface Body {
  az: number;
  el: number;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (az: number) => COMPASS[Math.round((((az % 360) + 360) % 360) / 45) % 8]!;

interface GroundOverlayProps {
  siteName: string;
  eyeM: number;
  terrain: GroundPatches;
  lost: boolean;
  labels: BodyLabel[];
  headingDeg: number;
  sun: Body | null;
  earth: Body | null;
  onFace(b: Body): void;
  onExit(): void;
}

/** Everything drawn over the ground view: labels on the Sun and Earth, controls and what the picture is made of. */
export function GroundOverlay({ siteName, eyeM, terrain, lost, labels, headingDeg, sun, earth, onFace, onExit }: GroundOverlayProps) {
  return (
    <>
      {labels.map((l) => (
        <div key={l.body} className="ground-label" data-body={l.body} style={{ left: l.x, top: l.y }}>
          <Icon name={l.body} size={12} />
          {l.body === "sun" ? "Sun" : "Earth"} {formatNum(l.elDeg, 1)}°
        </div>
      ))}

      <div className="ground-top">
        <div className="ground-title">
          <strong>{siteName || "Plan site"}</strong>
          <span className="num">
            Eye {formatNum(eyeM, 1)} m above the ground · looking {compass(headingDeg)} {Math.round(headingDeg)}°
          </span>
        </div>
        <div className="ground-actions toolstrip">
          <Button size="sm" icon="sun" disabled={!sun} onClick={() => sun && onFace(sun)}>
            Face the Sun
          </Button>
          <Button size="sm" icon="earth" disabled={!earth} onClick={() => earth && onFace(earth)}>
            Face Earth
          </Button>
          <Button size="sm" icon="map" onClick={onExit} title="Back to the map (Escape)">
            Map
          </Button>
        </div>
      </div>

      {terrain.status === "loading" && (
        <p className="ground-status" role="status">
          <Spinner size={14} /> Loading terrain round the site…
        </p>
      )}
      {terrain.status === "error" && (
        <p className="ground-status" role="alert">
          <Icon name="warn" size={14} /> Could not load the terrain: {terrain.error.message}
        </p>
      )}
      {lost && (
        <p className="ground-status" role="alert">
          <Icon name="warn" size={14} /> The graphics card dropped the picture; it comes back when the browser restores it.
        </p>
      )}

      <div className="ground-notes">
        {terrain.status === "ready" &&
          (terrain.smooth ? (
            <p>
              <Icon name="warn" size={12} /> No terrain data here: the ground is a smooth sphere, as in the engine.
            </p>
          ) : (
            <p>
              Terrain {terrain.resolutionM !== null ? `at ${formatNum(terrain.resolutionM, 0)} m near you` : ""} from {terrain.sources.join(", ")}; out to 50 km, then the engine's horizon line.
            </p>
          ))}
        <p>
          Sun and Earth from the engine's tracks. Shadows are the graphics card's picture; whether this spot is lit is the engine's answer above. A faint fill light shows unlit ground.
        </p>
        <p className="ground-hint">Drag to look around · scroll to zoom · Esc for the map</p>
      </div>
    </>
  );
}
