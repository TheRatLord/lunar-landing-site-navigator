import { Disclosure } from "../../components/ui/Disclosure";
import { Popover } from "../../components/ui/Popover";
import { useColors } from "../../components/viz/useColors";
import { cssGradient, viridis } from "../../lib/colormaps";
import { formatSig } from "../../lib/format";
import { NEAR_BOUNDARY_TEXT } from "../regional/regionalLayer";
import { RegionalValidationNote } from "../regional/RegionalValidationNote";
import { SearchValidationNote } from "../search/ValidationNote";
import { LayerRow, Opacity, Ramp } from "./LayerRow";
import { useMapStore } from "./mapStore";
import { regionalViewNote, type RegionalDrawn } from "./overlays";
import type { ViewKind } from "./urlState";

const RAMP = cssGradient(viridis, 11);
const VERDICT_ROWS = [
  { token: "c-pass", label: "pass" },
  { token: "c-marginal", label: "marginal" },
  { token: "c-fail", label: "fail" },
] as const;

const range = (v: number): string => formatSig(v, 4, { trim: true });

function Swatch({ token }: { token: string }) {
  const colors = useColors();
  return <span className="map-swatch" style={{ background: colors.get(token) }} aria-hidden="true" />;
}

export interface PreviewLayersProps {
  pinCount: number;
  pinsOutOfDate: boolean;
  regional: RegionalDrawn | null;
  regionalOutOfDate: boolean;
  kind: ViewKind;
}

export function PreviewLayers({ pinCount, pinsOutOfDate, regional: drawn, regionalOutOfDate, kind }: PreviewLayersProps) {
  const s = useMapStore();
  const regional = drawn?.view ?? null;
  const grid = regional?.grid;
  const viewNote = s.regional ? regionalViewNote(kind, grid?.hemisphere ?? null, drawn?.scaleWarning ?? null) : null;
  const censored = regional?.legend.kind === "sequential" && regional.cells.some((c) => c.censored);

  const details: string[] = [];
  if (drawn && regional) {
    details.push(drawn.summary);
    if (drawn.bracket !== null) details.push(`Shown as the estimated bracket ${drawn.bracket} the engine computed: this metric has no single point value to draw.`);
    if (drawn.coverage !== null) details.push(drawn.coverage);
    if (drawn.supportNote !== null) details.push(drawn.supportNote);
    const lg = regional.legend;
    if (lg.kind === "sequential") {
      if (lg.horizon) details.push(`The engine makes this layer with the horizon ${lg.horizon}.`);
      details.push(
        lg.own && (lg.own[0] !== lg.min || lg.own[1] !== lg.max)
          ? `Colour scale shared with this metric's value, bracket low and bracket high. This layer's own range, from the engine: ${range(lg.own[0])} to ${range(lg.own[1])}${lg.unit ? ` ${lg.unit}` : ""}.`
          : "Range is the engine's own minimum and maximum for this layer.",
      );
      details.push("Hatched cells are censored: the run touches the edge of the analysed span, so the true value is at least this long. Cells without a value are not drawn.");
    } else details.push("Cells without a verdict are not drawn.");
    if (drawn.unreliable > 0) details.push(`${drawn.unreliable.toLocaleString("en-US")} cells are ${NEAR_BOUNDARY_TEXT}: the engine wrote a value there, and it is not drawn as one.`);
  }

  const regionalTail = (
    <>
      {regionalOutOfDate && <span className="chip chip-marginal">Inputs changed</span>}
      {viewNote !== null && (
        <Popover label="Polar views only" tone="marginal" align="end" width={380}>
          <p className="map-prose" role="status" data-testid="regional-view-note">
            {viewNote}
          </p>
        </Popover>
      )}
      {drawn?.bracket && <span className="chip">Bracket {drawn.bracket}</span>}
      <RegionalValidationNote />
    </>
  );

  return (
    <section className="map-group" aria-label="Previews">
      <ul className="map-rows">
        <LayerRow on={s.regional && regional !== null} disabled={regional === null} label="Regional layer" onChange={(regionalOn) => s.set({ regional: regionalOn })} chips={regionalTail}>
          {drawn && regional && (
            <>
              <Opacity label="Regional layer opacity" value={s.regionalOpacity} min={10} onChange={(v) => s.set({ regionalOpacity: v })} />
              {regional.legend.kind === "sequential" ? (
                <Ramp label={regional.legend.layer} gradient={RAMP} min={range(regional.legend.min)} max={range(regional.legend.max)} unit={regional.legend.unit ?? undefined} />
              ) : (
                <ul className="map-legend-rows" aria-label="Regional layer legend">
                  {regional.legend.entries.map((e) => (
                    <li key={e.verdict}>
                      <Swatch token={e.token} /> {e.label}
                    </li>
                  ))}
                </ul>
              )}
              {(censored || drawn.unreliable > 0) && (
                <ul className="map-legend-rows">
                  {censored && (
                    <li>
                      <span className="map-hatch" aria-hidden="true" /> Censored
                    </li>
                  )}
                  {drawn.unreliable > 0 && (
                    <li>
                      <span className="map-hatch map-hatch-grey" aria-hidden="true" /> <span className="num">{drawn.unreliable.toLocaleString("en-US")}</span> unreliable
                    </li>
                  )}
                </ul>
              )}
              <Disclosure title="Details" count={details.length}>
                <ul className="map-notes">
                  {details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </Disclosure>
            </>
          )}
        </LayerRow>
        <LayerRow
          on={s.pins && pinCount > 0}
          disabled={pinCount === 0}
          label="Site search results"
          onChange={(pins) => s.set({ pins })}
          tail={pinCount > 0 ? <span className="num">{pinCount}</span> : null}
          chips={
            <>
              {pinsOutOfDate && <span className="chip chip-marginal">Inputs changed</span>}
              <SearchValidationNote />
            </>
          }
        >
          <ul className="map-legend-rows" aria-label="Site search results legend">
            {VERDICT_ROWS.map((r) => (
              <li key={r.token}>
                <Swatch token={r.token} /> {r.label}
              </li>
            ))}
          </ul>
        </LayerRow>
      </ul>
    </section>
  );
}
