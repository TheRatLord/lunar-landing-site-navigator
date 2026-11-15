import { useEffect, useMemo, useRef } from "react";
import { GRID_STATE, STATUS_OUTSIDE, searchGrid, type SearchGridView, type SearchResult } from "../../api/search";
import { Icon } from "../../components/ui/Icon";
import { useColors } from "../../components/viz/useColors";
import { GLYPH, VERDICT_WORD as WORD, useGridCursor } from "../regional/gridCursor";
import { withMinus } from "../regional/regionalLayer";

const TOKEN = { pass: "c-pass", marginal: "c-marginal", fail: "c-fail" } as const;
const STATUS_TOKEN: Record<number, string> = { 1: "c-terrain-fill", 2: "c-dark", 3: "c-terrain" };

const n1 = (v: number) => withMinus(v.toFixed(1));

function cellText(g: SearchGridView, row: number, col: number): string {
  const status = g.status[row]![col]!;
  const where = `${n1(g.east_m[col]!)} m east, ${n1(g.north_m[row]!)} m north of the region's anchor`;
  if (status === STATUS_OUTSIDE) return `${where} · outside the region`;
  const verdict = GRID_STATE[g.state[row]![col]!];
  const score = g.score[row]![col] ?? null;
  const slope = g.slope_deg[row]![col] ?? null;
  const ranked = g.rank_value?.[row]?.[col] ?? null;
  return [
    where,
    g.statusText[status] ?? `status ${status}`,
    verdict ? `${WORD[verdict]}` : "no final verdict",
    ranked !== null ? `${ranked.toFixed(1)} h of the ranked total` : null,
    score !== null ? `normalised margin ${withMinus(score.toFixed(2))}` : null,
    slope !== null ? `slope ${slope.toFixed(1)}°` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function SearchGrid({ result }: { result: SearchResult }) {
  const g = useMemo(() => searchGrid(result), [result]);
  if (!g) return null;
  return <GridPicture g={g} />;
}

function GridPicture({ g }: { g: SearchGridView }) {
  const colors = useColors();
  const ref = useRef<HTMLCanvasElement>(null);
  const ny = g.north_m.length;
  const nx = g.east_m.length;
  const { cursor, scale, handlers } = useGridCursor(ny, nx, true);
  const counts = useMemo(() => {
    const c = { pass: 0, marginal: 0, fail: 0 };
    for (let r = 0; r < ny; r++)
      for (let k = 0; k < nx; k++) {
        const v = GRID_STATE[g.state[r]![k]!];
        if (v && g.status[r]![k] !== STATUS_OUTSIDE) c[v]++;
      }
    return c;
  }, [g, nx, ny]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let r = 0; r < ny; r++)
      for (let c = 0; c < nx; c++) {
        const status = g.status[r]![c]!;
        if (status === STATUS_OUTSIDE) continue;
        const verdict = GRID_STATE[g.state[r]![c]!];
        const token = verdict ? TOKEN[verdict] : STATUS_TOKEN[status];
        if (!token) continue;
        ctx.fillStyle = colors.get(token);
        ctx.fillRect(c * scale, (ny - 1 - r) * scale, scale, scale);
      }
  }, [g, colors, scale, nx, ny]);

  const readout = cursor ? cellText(g, cursor.row, cursor.col) : "";
  const codes = Object.keys(g.statusCounts)
    .map(Number)
    .filter((c) => c !== STATUS_OUTSIDE)
    .sort((a, b) => b - a);

  return (
    <figure className="se-grid">
      <div className="se-grid-box">
        <canvas
          ref={ref}
          className="se-canvas"
          width={nx * scale}
          height={ny * scale}
          style={{ aspectRatio: `${nx} / ${ny}` }}
          tabIndex={0}
          role="img"
          aria-label={`Final grid: ${nx} by ${ny} nodes, north up. ${counts.pass} pass, ${counts.marginal} marginal, ${counts.fail} fail.`}
          {...handlers}
        />
      </div>
      <figcaption className="se-grid-cap">
        <div className="se-grid-size num">
          {nx} × {ny}
        </div>
        <ul className="se-legend" aria-label="Legend: final grid">
          {(["pass", "marginal", "fail"] as const).map((v) => (
            <li key={v} className={`se-leg se-leg-${v}`}>
              <Icon name={GLYPH[v]} size={12} strokeWidth={2} />
              <span>{WORD[v]}</span>
              <span className="num se-leg-n">{counts[v].toLocaleString("en-US")}</span>
            </li>
          ))}
          {codes
            .filter((c) => c !== 4)
            .map((c) => (
              <li key={c} className="se-leg">
                <span className="se-grid-swatch" style={{ background: `var(--${STATUS_TOKEN[c]})` }} aria-hidden="true" />
                <span>{(g.statusText[c] ?? `status ${c}`).replace(/^./, (x) => x.toUpperCase())}</span>
                <span className="num se-leg-n">{(g.statusCounts[c] ?? 0).toLocaleString("en-US")}</span>
              </li>
            ))}
        </ul>
        <div className="se-readout num" role="status">
          {readout}
        </div>
      </figcaption>
    </figure>
  );
}
