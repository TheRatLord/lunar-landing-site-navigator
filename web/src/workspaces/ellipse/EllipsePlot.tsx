import { useCallback, useId, useMemo } from "react";
import type { EllipseMapGrid, EllipseSampleRef, EllipseSamples } from "../../api/ellipse";
import { niceScaleBar } from "../map/scaleBar";
import type { Ellipse } from "../../scenario/types";
import { STATES, ellipseOutline, ellipsePoint, indicesByState, mapCells, plotHalfWidth, polygonPath, samplePath, sigmaRings, toPx } from "./adapt";
import type { Backdrop } from "./useBackdrop";

const SIZE = 640;

export type Marker = "centre" | "worst" | "best";

export interface EllipsePlotProps {
  ellipse: Ellipse;
  samples: EllipseSamples | null;
  map: EllipseMapGrid | null;
  refs: Record<Marker, EllipseSampleRef> | null;
  backdrop: Backdrop;
  layers: { terrain: boolean; map: boolean; samples: boolean };
  selected: Marker | null;
  description: string;
}

export function EllipsePlot({ ellipse, samples, map, refs, backdrop, layers, selected, description }: EllipsePlotProps) {
  const uid = useId();
  const half = plotHalfWidth(ellipse);
  const at = useCallback((e: number, n: number) => toPx(e, n, half, SIZE), [half]);
  const mpp = (2 * half) / SIZE;

  const outline = useMemo(() => polygonPath(ellipseOutline(ellipse).map(([e, n]) => at(e, n))), [ellipse, at]);
  const rings = useMemo(
    () => sigmaRings(ellipse).map((r) => ({ ...r, d: polygonPath(ellipseOutline(ellipse, r.k).map(([e, n]) => at(e, n))), label: at(...ellipsePoint(ellipse, ellipse.semi_major_m * r.k, 0)) })),
    [ellipse, at],
  );
  const axis = useMemo(() => {
    const [x0, y0] = at(...ellipsePoint(ellipse, -ellipse.semi_major_m, 0));
    const [x1, y1] = at(...ellipsePoint(ellipse, ellipse.semi_major_m, 0));
    return `M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }, [ellipse, at]);

  const r = !samples ? 3 : samples.state.length <= 600 ? 3.4 : samples.state.length <= 2500 ? 2.5 : 1.8;
  const paths = useMemo(() => {
    if (!samples) return null;
    const groups = indicesByState(samples);
    return STATES.map((s) => ({
      state: s,
      d: samplePath(
        s,
        groups[s].map((i) => at(samples.east_m[i]!, samples.north_m[i]!)),
        r,
      ),
      n: groups[s].length,
    })).filter((g) => g.n > 0);
  }, [samples, at, r]);

  const cells = useMemo(() => (map ? mapCells(map) : []), [map]);
  const cellPx = map ? map.spacing_m / mpp : 0;

  const bar = niceScaleBar(mpp, 70, 170);
  const img = backdrop.image;

  const marks: Array<{ id: Marker; ref: EllipseSampleRef; label: string }> = refs
    ? [
        { id: "centre", ref: refs.centre, label: "Centre" },
        { id: "worst", ref: refs.worst, label: "Worst" },
        { id: "best", ref: refs.best, label: "Best" },
      ]
    : [];

  return (
    <svg className="el-plot" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={description} data-testid="ellipse-plot">
      <defs>
        <clipPath id={`${uid}-clip`}>
          <rect width={SIZE} height={SIZE} />
        </clipPath>
        <pattern id={`${uid}-hatch`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="7" className="el-hatch-marginal" />
        </pattern>
        <pattern id={`${uid}-cross`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="7" className="el-hatch-fail" />
          <line x1="0" y1="0" x2="7" y2="0" className="el-hatch-fail" />
        </pattern>
      </defs>
      <g clipPath={`url(#${uid}-clip)`}>
        <rect className="el-bg" width={SIZE} height={SIZE} />
        {layers.terrain && img && (
          <image
            href={img.url}
            x={at(img.x0, img.y1)[0]}
            y={at(img.x0, img.y1)[1]}
            width={(img.x1 - img.x0) / mpp}
            height={(img.y1 - img.y0) / mpp}
            preserveAspectRatio="none"
            className="el-terrain"
          />
        )}
        <rect className="el-grid-frame" width={SIZE} height={SIZE} />
        <path className="el-cross" d={`M${SIZE / 2} 0V${SIZE}M0 ${SIZE / 2}H${SIZE}`} />

        {layers.map &&
          cells.map((c) => {
            const [x, y] = at(c.east, c.north);
            return (
              <g key={`${c.east}|${c.north}`} className={`el-cell el-cell-${c.state}`}>
                <rect x={x - cellPx / 2} y={y - cellPx / 2} width={cellPx} height={cellPx} />
                {c.state === "marginal" && <rect x={x - cellPx / 2} y={y - cellPx / 2} width={cellPx} height={cellPx} fill={`url(#${uid}-hatch)`} />}
                {c.state === "fail" && <rect x={x - cellPx / 2} y={y - cellPx / 2} width={cellPx} height={cellPx} fill={`url(#${uid}-cross)`} />}
              </g>
            );
          })}

        {rings.map((g) => (
          <g key={g.sigma}>
            <path className="el-ring" d={g.d} />
            <text className="el-label" x={g.label[0] + 4} y={g.label[1] - 4}>
              {g.sigma}σ
            </text>
          </g>
        ))}
        <path className="el-outline" d={outline} />
        <path className="el-axis" d={axis} />

        {layers.samples &&
          paths?.map((g) => (
            <g key={g.state} className={`el-pts el-pts-${g.state}`}>
              <path className="el-halo" d={g.d} strokeWidth={g.state === "pass" ? 2 * r + 2 : 4.2} />
              <path className="el-shape" d={g.d} strokeWidth={g.state === "pass" ? 2 * r : 1.8} />
            </g>
          ))}

        {marks.map((m) => {
          const [x, y] = at(m.ref.east_m, m.ref.north_m);
          const on = selected === m.id;
          return (
            <g key={m.id} className={`el-mark el-mark-${m.id} ${on ? "is-on" : ""}`}>
              <circle cx={x} cy={y} r={on ? 12 : 9} className="el-mark-ring" />
              {m.id === "centre" && <path className="el-mark-plus" d={`M${x - 5} ${y}H${x + 5}M${x} ${y - 5}V${y + 5}`} />}
              <text className="el-mark-text" x={x + 13} y={y - 9}>
                {m.label}
              </text>
            </g>
          );
        })}
      </g>

      <g className="el-north" transform={`translate(${SIZE - 34} 36)`} aria-hidden="true">
        <path d="M0 -22L7 4L0 0L-7 4Z" />
        <text y="22" textAnchor="middle">
          N
        </text>
      </g>
      {bar && (
        <g className="el-scale" transform={`translate(16 ${SIZE - 18})`} aria-hidden="true">
          <path d={`M0 -5V0H${bar.px.toFixed(1)}V-5`} />
          <text x="0" y="-9">
            {bar.label}
          </text>
        </g>
      )}
    </svg>
  );
}
