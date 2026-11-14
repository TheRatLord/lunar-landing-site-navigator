import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../components/ui/Icon";
import { useColors } from "../../components/viz/useColors";
import { formatLat, formatLon } from "../../lib/coords";
import { formatSig, withUnit } from "../../lib/format";
import { cssGradient, viridis } from "../../lib/colormaps";
import { Pairs, type Pair } from "../../components/ui/Pairs";
import { GLYPH, VERDICT_WORD, useGridCursor } from "./gridCursor";
import { cellColour, cellReadout, fmtNum, pairs, shortConfiguration, validationDiffers, withMinus, type BracketWidth, type ErrorStats, type LayerSupport, type RegionalCell, type RegionalLayerView, type RegionalLegend } from "./regionalLayer";

const MARK_MIN_PX = 4;

interface HeatmapProps {
  view: RegionalLayerView;
  title: string;
  unit: string;
  support: LayerSupport | null;
}

/** Label–value pairs describing one cell; state words replace sentences. */
function cellPairs(cell: RegionalCell, layer: string, support: LayerSupport | null, unit: string): Pair[] {
  if (cell.verdict) return [["Verdict", VERDICT_WORD[cell.verdict]]];
  if (cell.unreliable) return [["State", "Near boundary"]];
  const range = cell.lo !== null && cell.hi !== null ? `${fmtNum(cell.lo, "")}–${fmtNum(cell.hi, unit)}` : null;
  const rows: Pair[] = [];
  if (support?.point_value === "bracket_only") rows.push(range ? ["Range", range] : [layer.endsWith("_hi") ? "High" : "Low", fmtNum(cell.value, unit)]);
  else if (support?.point_value === "approximate" && range) rows.push(["Value", cell.point !== null ? fmtNum(cell.point, unit) : "none"], ["Range", range]);
  else if (layer.endsWith("_lo") || layer.endsWith("_hi")) {
    rows.push([layer.endsWith("_lo") ? "Low" : "High", fmtNum(cell.value, unit)]);
    if (cell.point !== null) rows.push(["Value", fmtNum(cell.point, unit)]);
  } else rows.push(["Value", fmtNum(cell.value, unit)]);
  if (cell.censored) rows.push(["State", "Censored"]);
  return rows;
}

export function RegionalHeatmap({ view, title, unit, support }: HeatmapProps) {
  const colors = useColors();
  const ref = useRef<HTMLCanvasElement>(null);
  const { grid, cells, legend } = view;
  const { cursor, setCursor, scale, handlers } = useGridCursor(grid.n_rows, grid.n_cols, false);
  const byIndex = useMemo(() => {
    const a = new Array<RegionalCell | undefined>(grid.n_rows * grid.n_cols);
    for (const c of cells) a[c.row * grid.n_cols + c.col] = c;
    return a;
  }, [cells, grid]);
  const nUnreliable = useMemo(() => cells.filter((c) => c.unreliable).length, [cells]);
  const nCensored = useMemo(() => cells.filter((c) => c.censored && !c.unreliable).length, [cells]);
  const gridKey = `${grid.n_rows}:${grid.n_cols}:${grid.x0_m}:${grid.y0_m}:${grid.spacing_m}`;
  const [seenGrid, setSeenGrid] = useState(gridKey);
  if (seenGrid !== gridKey) {
    setSeenGrid(gridKey);
    setCursor(null);
  }

  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;
    g.clearRect(0, 0, canvas.width, canvas.height);
    for (const c of cells) {
      const fill = cellColour(c, legend, colors.get);
      if (!fill) continue;
      g.fillStyle = fill;
      g.fillRect(c.col * scale, c.row * scale, scale, scale);
    }
    if (scale < MARK_MIN_PX) return;
    const marks = [
      [(c: RegionalCell) => c.unreliable, "rgba(0,0,0,0.8)", true],
      [(c: RegionalCell) => c.censored && !c.unreliable, "rgba(0,0,0,0.75)", false],
    ] as const;
    for (const [pick, dark, cross] of marks) {
      for (const [style, width] of [[dark, 2.5], ["rgba(255,255,255,0.95)", 1]] as const) {
        g.strokeStyle = style;
        g.lineWidth = width;
        g.beginPath();
        for (const c of cells) {
          if (!pick(c)) continue;
          if (cross) {
            g.moveTo(c.col * scale + 1, c.row * scale + 1);
            g.lineTo((c.col + 1) * scale - 1, (c.row + 1) * scale - 1);
          }
          g.moveTo(c.col * scale + 1, (c.row + 1) * scale - 1);
          g.lineTo((c.col + 1) * scale - 1, c.row * scale + 1);
        }
        g.stroke();
      }
    }
  }, [cells, legend, colors, scale]);

  const cell = cursor ? byIndex[cursor.row * grid.n_cols + cursor.col] : undefined;
  const pairs: Pair[] | null = !cursor
    ? null
    : [
        ["Row", cursor.row],
        ["Col", cursor.col],
        ...(cell
          ? ([["Lat", formatLat(cell.lat_deg, 5)], ["Lon", formatLon(cell.lon_deg, 5)], ...cellPairs(cell, view.layer, support, unit)] as Pair[])
          : ([["State", "No data"]] as Pair[])),
      ];
  const aria = !cursor ? "" : cell ? ` Row ${cursor.row}, column ${cursor.col}: ${cell.verdict ? VERDICT_WORD[cell.verdict] : cellReadout(cell, view.layer, { support, unit })}` : ` Row ${cursor.row}, column ${cursor.col}: no data`;

  return (
    <figure className="rg-heat">
      <div className="rg-heat-area">
        <canvas
          ref={ref}
          className="rg-canvas"
          width={grid.n_cols * scale}
          height={grid.n_rows * scale}
          style={{ ["--rg-ratio" as string]: `${grid.n_cols} / ${grid.n_rows}`, ["--rg-ratio-n" as string]: grid.n_cols / grid.n_rows }}
          tabIndex={0}
          role="img"
          aria-label={`${title}: ${grid.n_rows} by ${grid.n_cols} cells of ${grid.spacing_m} m, ${cells.length} with data.${aria}`}
          {...handlers}
        />
      </div>
      <figcaption className="rg-heat-foot">
        <Legend legend={legend} title={title} unit={unit} />
        <ul className="rg-marks" aria-label="Cell markers">
          {(
            [
              ["nodata", "No data", view.nodata],
              ["boundary", "Near boundary", nUnreliable],
              ["censored", "Censored", nCensored],
            ] as const
          ).map(([kind, label, n]) =>
            n > 0 ? (
              <li key={kind} className="rg-mark">
                <span className={`rg-swatch rg-swatch-${kind}`} aria-hidden="true" />
                {label}
                <span className="num faint">{n.toLocaleString("en-US")}</span>
              </li>
            ) : null,
          )}
        </ul>
        <div className="rg-readout num" role="status">
          {pairs?.map(([k, v]) => (
            <span key={k} className="rg-pair">
              <span className="rg-pair-k">{k}</span>
              {v}
            </span>
          ))}
        </div>
      </figcaption>
    </figure>
  );
}

const RAMP = cssGradient(viridis, 9);

function Legend({ legend, title, unit }: { legend: RegionalLegend; title: string; unit: string }) {
  if (legend.kind === "verdict") {
    return (
      <ul className="rg-legend" aria-label={`Legend: ${title}`}>
        {legend.entries.map((e) => (
          <li key={e.code} className={`rg-leg rg-leg-${e.verdict}`}>
            <Icon name={GLYPH[e.verdict]} size={12} strokeWidth={2} />
            {VERDICT_WORD[e.verdict]}
          </li>
        ))}
      </ul>
    );
  }
  if (!Number.isFinite(legend.min) || !Number.isFinite(legend.max)) return <span className="rg-scale faint">No range</span>;
  if (legend.min === legend.max)
    return (
      <div className="rg-scale" role="group" aria-label={`Legend: ${title}`}>
        <span className="rg-ramp rg-ramp-flat" style={{ background: viridis(0.5) }} aria-hidden="true" />
        <span className="num">{fmtNum(legend.min, unit)}</span>
      </div>
    );
  return (
    <div className="rg-scale" role="group" aria-label={`Legend: ${title}`}>
      <span className="num">{fmtNum(legend.min, unit)}</span>
      <span className="rg-ramp" style={{ background: RAMP }} aria-hidden="true" />
      <span className="num">{fmtNum(legend.max, unit)}</span>
    </div>
  );
}

const POINT_LABEL: Record<string, string> = {
  supported: "Point value",
  approximate: "Approximate",
  bracket_only: "Range only",
  exact_input: "Exact input",
};

const sig3 = (v: number): string => formatSig(v, 3, { trim: true });
const stat = (v: number | null, unit: string | null): string => (v === null ? "—" : withUnit(withMinus(sig3(v)), unit));

function ErrorTable({ caption, title, e, unit }: { caption: string; title?: string; e: ErrorStats; unit: string | null }) {
  const cols: Array<[string, number | null]> = [
    ["Mean", e.mean_signed],
    ["Mean abs", e.mean_abs],
    ["p95", e.p95_abs],
    ["p99", e.p99_abs],
    ["Max", e.max_abs],
  ];
  const shown = cols.filter(([, v], i) => v !== null || i === 1);
  return (
    <table className="rg-error-table">
      <caption title={title}>
        {caption}
        {unit && <span className="faint"> · {unit}</span>}
      </caption>
      <thead>
        <tr>
          {shown.map(([h]) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          {shown.map(([h, v]) => (
            <td key={h} className="num">
              {stat(v, null)}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

/** Accuracy facts of one layer: point-value support, bracket width, run and validation errors. */
export function SupportDetails({ support, width }: { support: LayerSupport | null; width: BracketWidth | null }) {
  const v = support?.validation ?? null;
  const run = support?.run_error ?? null;
  const cov = v?.bracket_coverage ?? null;
  const widthUnit = width?.unit ?? support?.error_unit ?? "";
  const rows = pairs(
    support && ["Reading", POINT_LABEL[support.point_value] ?? support.point_value],
    width && ["Bracket width, median", stat(width.p50, widthUnit)],
    width && ["Bracket width, p95", stat(width.p95, widthUnit)],
    width?.max != null && ["Bracket width, max", stat(width.max, widthUnit)],
    width?.shareWider5 != null && ["Wider than 5 points", `${(width.shareWider5 * 100).toFixed(1)} %`],
    cov && ["Bracket coverage", `${(cov.coverage * 100).toFixed(2)} % of ${cov.cells.toLocaleString("en-US")}`],
    cov && ["Misses", cov.misses.toLocaleString("en-US")],
    cov?.calibration_target != null && ["Calibrated for", `${(cov.calibration_target * 100).toFixed(0)} %`],
    v?.configuration && ["Validated at", shortConfiguration(v.configuration)],
  );
  return (
    <div className="rg-support">
      <Pairs className="rg-dl" rows={rows} />
      {support?.note && <p className="rg-support-note">{support.note}</p>}
      {v && validationDiffers(support) && <span className="chip chip-marginal">Differs from this run</span>}
      {run && (
        <ErrorTable
          caption={`This run, ${run.n_cells === null ? "calibration" : run.n_cells.toLocaleString("en-US")} cells`}
          title={support?.run_measured_on ?? undefined}
          e={run}
          unit={support?.error_unit ?? null}
        />
      )}
      {v?.measured_error && (
        <ErrorTable caption={`Validation${v.measured_by ? `, ${v.measured_by}` : ""}`} title={v.configuration ?? undefined} e={v.measured_error} unit={support?.error_unit ?? null} />
      )}
    </div>
  );
}
