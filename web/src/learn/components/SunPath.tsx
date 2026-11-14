import { useMemo } from "react";
import { RAD, skyAt, type SkyState } from "../geometry";
import { SITES } from "../sites";

const W = 220;
const H = 148;
const R = 84;
const CX = W / 2;
const CY = 100;
const TILT = (22 * Math.PI) / 180;

function project(az: number, el: number): [number, number, number] {
  const x = Math.sin(az * RAD) * Math.cos(el * RAD);
  const y = Math.sin(el * RAD);
  const n = Math.cos(az * RAD) * Math.cos(el * RAD);
  return [CX + x * R, CY - (y * Math.cos(TILT) + n * Math.sin(TILT)) * R, el];
}

function pathFor(lat: number, d: number): string {
  const parts: string[] = [];
  let open = false;
  for (let k = -14.77; k <= 14.77 + 1e-9; k += 0.2) {
    const s = skyAt(SITES.custom, d + k, lat);
    const [x, y, el] = project(s.sun.az, s.sun.el);
    if (el < -0.3) {
      open = false;
      continue;
    }
    parts.push(`${open ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`);
    open = true;
  }
  return parts.join(" ");
}

export function SunPath({ lat, d, sky }: { lat: number; d: number; sky: SkyState }) {
  const day = Math.round(d / 2) * 2;
  const path = useMemo(() => pathFor(lat, day), [lat, day]);
  const ry = R * Math.sin(TILT);
  const up = sky.sun.el > -sky.sun.radius;
  const [sx, sy] = project(sky.sun.az, Math.max(0, sky.sun.el));
  const flat = Math.abs(lat) > 80;
  return (
    <figure className="l-sunpath">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={flat ? "Seen from the side, the Sun's path is a flat ring around you, just above the ground." : "Seen from the side, the Sun's path is an arch that rises up over you."}>
        <path d={`M${CX - R} ${CY} A${R} ${R} 0 0 1 ${CX + R} ${CY}`} className="l-sp-dome" />
        <ellipse cx={CX} cy={CY} rx={R} ry={ry} className="l-sp-ground" />
        <path d={path} className="l-sp-path" />
        <circle cx={CX} cy={CY} r={3.5} className="l-sp-you" />
        <text x={CX} y={CY + ry + 14} textAnchor="middle" className="l-sp-text">
          you
        </text>
        <text x={CX + R + 2} y={CY + 4} className="l-sp-text">
          E
        </text>
        <text x={CX - R - 10} y={CY + 4} className="l-sp-text">
          W
        </text>
        {up && <circle cx={sx} cy={sy} r={6} className="l-sp-sun" />}
      </svg>
      <figcaption>The Sun's path, seen from the side</figcaption>
    </figure>
  );
}
