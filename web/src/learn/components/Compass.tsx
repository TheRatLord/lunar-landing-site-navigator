import { wrap180 } from "../../lib/scale";
import { compassWord, heightWord } from "../describe";
import type { SkyState } from "../geometry";
import { ArrowDownIcon, GlobeIcon, SunIcon } from "./icons";

const LETTERS: [string, number][] = [
  ["N", 0],
  ["NE", 45],
  ["E", 90],
  ["SE", 135],
  ["S", 180],
  ["SW", 225],
  ["W", 270],
  ["NW", 315],
];

interface Props {
  heading: number;
  fov: number;
  sky: SkyState;
  onLook: (az: number, el: number) => void;
}

const pct = (az: number, heading: number) => 50 + (wrap180(az - heading) / 360) * 100;

function where(az: number, el: number, horizon: number) {
  const h = heightWord(el - horizon);
  return `${compassWord(az)}, ${h}`;
}

export function Compass({ heading, fov, sky, onLook }: Props) {
  const sunUp = sky.sun.el > sky.sun.horizonEl - sky.sun.radius;
  const earthUp = sky.earth.visible;
  const below = sky.earth.el < -10;
  const half = Math.min(100, (fov / 360) * 100) / 2;
  return (
    <div className="l-compass" aria-hidden="false">
      <div className="l-compass-band">
        <div className="l-compass-fov" style={{ left: `${50 - half}%`, width: `${half * 2}%` }} aria-hidden />
        {Array.from({ length: 24 }, (_, i) => i * 15).map((az) => (
          <span key={az} className={`l-compass-tick ${az % 45 === 0 ? "major" : ""}`} style={{ left: `${pct(az, heading)}%` }} />
        ))}
        {LETTERS.map(([l, az]) => (
          <span
            key={l}
            className={`l-compass-letter ${l.length === 1 ? "main" : ""}`}
            style={{ left: `${pct(az, heading)}%` }}
            aria-hidden
          >
            {l}
          </span>
        ))}
        <button
          type="button"
          className={`l-compass-icon sun ${sunUp ? "" : "is-down"}`}
          style={{ left: `${pct(sky.sun.az, heading)}%` }}
          aria-label={`Sun, ${where(sky.sun.az, sky.sun.el, sky.sun.horizonEl)}. Turn to face it.`}
          onClick={() => onLook(sky.sun.az, sky.sun.el)}
        >
          <SunIcon size={20} />
        </button>
        <button
          type="button"
          className={`l-compass-icon earth ${earthUp ? "" : "is-down"}`}
          style={{ left: `${pct(sky.earth.az, heading)}%` }}
          aria-label={
            below
              ? "Earth is below your feet, behind the Moon"
              : `Earth, ${where(sky.earth.az, sky.earth.el, sky.earth.horizonEl)}. Turn to face it.`
          }
          onClick={() => onLook(sky.earth.az, sky.earth.el)}
        >
          {below ? <ArrowDownIcon size={18} /> : <GlobeIcon size={20} hollow={!earthUp} />}
        </button>
      </div>
    </div>
  );
}
