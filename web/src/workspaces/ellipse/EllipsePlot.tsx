import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { EllipseSampleRef, EllipseSamples } from "../../api/ellipse";
import { niceScaleBar } from "../map/scaleBar";
import type { Ellipse } from "../../scenario/types";
import { STATES, ellipseOutline, ellipsePoint, indicesByState, plotHalfWidth, polygonPath, samplePath, sigmaRings, toPx } from "./adapt";
import type { Backdrop } from "./useBackdrop";

const SIZE = 640;
const DRAW_ORDER = [...STATES].reverse();

export type Marker = "centre" | "worst" | "best";

export interface EllipsePlotProps {
  ellipse: Ellipse;
  samples: EllipseSamples | null;
  refs: Record<Marker, EllipseSampleRef> | null;
  backdrop: Backdrop;
  showSamples: boolean;
  selected: Marker | null;
  description: string;
}

export function EllipsePlot({ ellipse, samples, refs, backdrop, showSamples, selected, description }: EllipsePlotProps) {
  const uid = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [k, setK] = useState(1);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setK(SIZE / w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const half = plotHalfWidth(ellipse);
  const at = useCallback((e: number, n: number) => toPx(e, n, half, SIZE), [half]);
  const mpp = (2 * half) / SIZE;

  const outline = useMemo(() => polygonPath(ellipseOutline(ellipse).map(([e, n]) => at(e, n))), [ellipse, at]);
  const rings = useMemo(
    () => sigmaRings(ellipse).map((r) => ({ ...r, d: polygonPath(ellipseOutline(ellipse, r.k).map(([e, n]) => at(e, n))), label: at(...ellipsePoint(ellipse, 0, -ellipse.semi_minor_m * r.k)) })),
    [ellipse, at],
  );
  const axis = useMemo(() => {
    const [x0, y0] = at(...ellipsePoint(ellipse, -ellipse.semi_major_m, 0));
    const [x1, y1] = at(...ellipsePoint(ellipse, ellipse.semi_major_m, 0));
    return `M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }, [ellipse, at]);

  const r = k * (!samples ? 3 : samples.state.length <= 600 ? 3.4 : samples.state.length <= 2500 ? 2.5 : 1.8);
  const dense = (samples?.state.length ?? 0) > 600;
  const paths = useMemo(() => {
    if (!samples) return null;
    const groups = indicesByState(samples);
    return DRAW_ORDER.map((s) => ({
      state: s,
      d: samplePath(
        s,
        groups[s].map((i) => at(samples.east_m[i]!, samples.north_m[i]!)),
        r,
      ),
      n: groups[s].length,
    })).filter((g) => g.n > 0);
  }, [samples, at, r]);

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
    <svg ref={svgRef} style={{ "--k": k } as CSSProperties} className={`el-plot${selected ? " has-sel" : ""}`} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={description} data-testid="ellipse-plot">
      <defs>
        <clipPath id={`${uid}-clip`}>
          <rect width={SIZE} height={SIZE} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${uid}-clip)`}>
        <rect className="el-bg" width={SIZE} height={SIZE} />
        {img && (
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

        {rings.map((g) => (
          <path key={g.sigma} className="el-ring" d={g.d} />
        ))}
        <path className="el-outline" d={outline} />
        <path className="el-axis" d={axis} />

        {showSamples &&
          paths?.map((g) => (
            <g key={g.state} className={`el-pts el-pts-${g.state}`}>
              <path className="el-halo" d={g.d} strokeWidth={g.state === "pass" ? 2 * r + 2 * k : 4.2 * k} />
              <path className="el-shape" d={g.d} strokeWidth={g.state === "pass" ? 2 * r : (dense ? 1.3 : 1.8) * k} />
            </g>
          ))}

        {rings.map((g) => (
          <text key={g.sigma} className="el-label" x={g.label[0] + 6 * k} y={g.label[1] + 4 * k}>
            {g.sigma}σ
          </text>
        ))}

        {marks.map((m) => {
          const [x, y] = at(m.ref.east_m, m.ref.north_m);
          const on = selected === m.id;
          return (
            <g key={m.id} className={`el-mark el-mark-${m.id} ${on ? "is-on" : ""}`}>
              <circle cx={x} cy={y} r={(on ? 12 : 9) * k} className="el-mark-halo" />
              <circle cx={x} cy={y} r={(on ? 12 : 9) * k} className="el-mark-ring" />
              {m.id === "centre" && <path className="el-mark-plus" d={`M${x - 5 * k} ${y}H${x + 5 * k}M${x} ${y - 5 * k}V${y + 5 * k}`} />}
              <text className="el-mark-text" textAnchor={m.id === "centre" ? "end" : "start"} x={x + (m.id === "centre" ? -13 : 13) * k} y={y + (m.id === "best" ? 20 : -9) * k}>
                {m.label}
              </text>
            </g>
          );
        })}
      </g>

      <g className="el-north" transform={`translate(${SIZE - 30 * k} ${34 * k}) scale(${k})`} aria-hidden="true">
        <path d="M0 -16L5.5 3L0 0L-5.5 3Z" />
        <text y="17" textAnchor="middle">
          N
        </text>
      </g>
      {bar && (
        <g className="el-scale" transform={`translate(${18 * k} ${SIZE - 18 * k})`} aria-hidden="true">
          <path d={`M0 ${-5 * k}V0H${bar.px.toFixed(1)}V${-5 * k}`} />
          <text x="0" y={-10 * k}>
            {bar.label}
          </text>
        </g>
      )}
    </svg>
  );
}
