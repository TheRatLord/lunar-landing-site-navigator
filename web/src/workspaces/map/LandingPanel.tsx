import type { ReactNode } from "react";
import type { EllipseResult } from "../../api/ellipse";
import { Button, IconButton } from "../../components/ui/Button";
import { ProgressBar, Spinner } from "../../components/ui/Progress";
import { dayText } from "../../scenario/when";
import { CELL_COLOR } from "../search/lattice";
import type { CellCounts } from "./spatial";
import { bodyWords, kmText, type BodyNow } from "./spatial";

const utc = (ms: number): string => `${dayText(ms)} · ${new Date(ms).toISOString().slice(11, 16)} UTC`;

function since(t: number, start: number): string {
  const h = Math.round((t - start) / 3_600_000);
  if (h <= 0) return "At landing";
  const d = Math.floor(h / 24);
  return `Landing + ${d > 0 ? `${d} d ` : ""}${h % 24} h`;
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;

function Group({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="mp-group" aria-label={title}>
      <div className="mp-group-head">
        <h3>{title}</h3>
        {note && <span className="mp-group-note">{note}</span>}
      </div>
      {children}
    </section>
  );
}

function Swatch({ color, ring }: { color: string; ring?: boolean }) {
  return <i className="mp-swatch" data-ring={ring || undefined} style={{ ["--sw" as string]: color }} aria-hidden="true" />;
}

export interface SearchSummary {
  counts: CellCounts;
  radius_m: number | null;
  spacing_m: number;
  centre: string;
  stale: boolean;
}

export interface EllipseSummary {
  set: boolean;
  phase: "idle" | "running" | "done" | "error";
  progress: number | null;
  result: EllipseResult | null;
  points: string;
  error: string | null;
}

interface LandingPanelProps {
  name: string;
  start_ms: number;
  t_ms: number;
  bodies: BodyNow[] | null;
  smooth: boolean;
  skyError: boolean;
  search: SearchSummary | null;
  searching: boolean;
  ellipse: EllipseSummary;
  onHide(): void;
  onOverview(): void;
  onSite(): void;
  onAddEllipse(): void;
  onCheckEllipse(): void;
  onEllipseDetails(): void;
}

export function LandingPanel(p: LandingPanelProps) {
  const c = p.search?.counts;
  const total = c ? c.pass + c.marginal + c.fail + c.unknown + c.steep + c.screened : 0;
  const rows: Array<{ key: string; label: string; color: string; n: number }> = c
    ? [
        { key: "pass", label: "Passes", color: CELL_COLOR.pass, n: c.pass },
        { key: "marginal", label: "Marginal", color: CELL_COLOR.marginal, n: c.marginal },
        { key: "fail", label: "Fails", color: CELL_COLOR.fail, n: c.fail },
        { key: "steep", label: "Too steep or rough", color: CELL_COLOR.steep, n: c.steep },
        { key: "screened", label: "Not checked in full", color: CELL_COLOR.screened, n: c.screened + c.unknown },
      ]
    : [];
  const e = p.ellipse;
  const r = e.result;
  const passShare = r ? r.state_probability["PASS"] : null;
  const slopeLimit = r?.hazard_limits["slope_deg"] ?? null;

  return (
    <aside className="map-dock" aria-label="Selected landing">
      <div className="map-dock-head">
        <h2 className="map-dock-title">Selected landing</h2>
        <IconButton icon="panelRight" label="Hide panel" shortcut="L" size="sm" onClick={p.onHide} />
      </div>
      <div className="map-tabpanel mp">
        <div className="mp-sel">
          <strong className="mp-sel-name">{p.name}</strong>
          <span className="mp-sel-time num">{utc(p.start_ms)}</span>
          <div className="mp-sel-actions">
            <Button size="sm" variant="ghost" icon="target" onClick={p.onOverview}>
              Overview
            </Button>
            <Button size="sm" variant="ghost" onClick={p.onSite}>
              Open in Site
            </Button>
          </div>
        </div>

        <Group title="Sky" note={<span className="num">{since(p.t_ms, p.start_ms)}</span>}>
          {p.skyError ? (
            <p className="mp-note">Couldn't trace the Sun and Earth.</p>
          ) : !p.bodies ? (
            <p className="mp-note">
              <Spinner size={12} /> Tracing the Sun and Earth
            </p>
          ) : (
            <ul className="mp-rows">
              {p.bodies.map((b) => {
                const w = bodyWords(b);
                return (
                  <li key={b.body} className="mp-body" data-open={b.open || undefined}>
                    <Swatch color={b.body === "sun" ? "var(--c-sun)" : "var(--c-earth)"} ring={b.body === "earth"} />
                    <span className="mp-body-text">
                      <strong>{w.state}</strong>
                      <span className="num">{w.detail}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mp-hint">
            {p.smooth
              ? "No terrain data here: the horizon is a smooth sphere, so no ridge line is drawn."
              : "White lines trace the ridges that form the horizon. Each ray points at the Sun or Earth and ends with a cross where terrain hides it."}
          </p>
        </Group>

        <Group title="Search area" note={p.search ? (p.search.radius_m !== null ? `${kmText(p.search.radius_m)} around ${p.search.centre}` : p.search.centre) : undefined}>
          {p.searching ? (
            <p className="mp-note">
              <Spinner size={12} /> Searching
            </p>
          ) : p.search ? (
            <>
              <ul className="mp-rows">
                {rows
                  .filter((row) => row.n > 0 || row.key === "pass")
                  .map((row) => (
                    <li key={row.key} className="mp-count">
                      <Swatch color={row.color} />
                      <span>{row.label}</span>
                      <span className="num mp-count-n">{total > 0 ? pct(row.n / total) : "–"}</span>
                    </li>
                  ))}
              </ul>
              <p className="mp-hint">
                {p.search.spacing_m >= 1000 ? `${(p.search.spacing_m / 1000).toFixed(1)} km` : `${Math.round(p.search.spacing_m)} m`} grid. Brighter green passes at more of the landing times searched. Hover the map to read a cell.
              </p>
              {p.search.stale && (
                <p className="mp-note mp-stale">
                  The plan changed since this search.{" "}
                  <button type="button" className="mp-link" onClick={p.onOverview}>
                    Search again in the Overview
                  </button>
                </p>
              )}
            </>
          ) : (
            <>
              <p className="mp-note">No search yet. The Overview searches around the site and the result shows here.</p>
              <Button size="sm" icon="search" onClick={p.onOverview}>
                Search in the Overview
              </Button>
            </>
          )}
        </Group>

        <Group title="Landing ellipse">
          {!e.set ? (
            <>
              <p className="mp-note">The lander can touch down anywhere in its ellipse. Add one to check how much of it is safe.</p>
              <Button size="sm" icon="plus" onClick={p.onAddEllipse}>
                Add ellipse
              </Button>
            </>
          ) : e.phase === "running" ? (
            <div className="mp-note">
              <span>
                <Spinner size={12} /> Sampling {e.points} touchdown points
              </span>
              <ProgressBar value={e.progress ?? 0} label="Ellipse progress" />
            </div>
          ) : r ? (
            <>
              <ul className="mp-rows">
                <li className="mp-count">
                  <Swatch color="var(--c-pass)" />
                  <span>Touchdowns that pass</span>
                  <span className="num mp-count-n">{typeof passShare === "number" ? pct(passShare) : "–"}</span>
                </li>
                <li className="mp-count">
                  <Swatch color={CELL_COLOR.steep} />
                  <span>{slopeLimit !== null ? `Steeper than ${slopeLimit}°` : "Hazardous ground"}</span>
                  <span className="num mp-count-n">{typeof r.hazard_fraction === "number" ? pct(r.hazard_fraction) : "no limit"}</span>
                </li>
              </ul>
              <p className="mp-hint">Each dot is one sampled touchdown point, coloured by its verdict.</p>
              <Button size="sm" variant="ghost" onClick={p.onEllipseDetails}>
                Ellipse details
              </Button>
            </>
          ) : (
            <>
              {e.error && <p className="mp-note mp-stale">{e.error}</p>}
              <p className="mp-note">Sample touchdown points across the ellipse to see how much of it passes and how much is too steep.</p>
              <Button size="sm" icon="ellipse" onClick={p.onCheckEllipse}>
                Check {e.points} touchdown points
              </Button>
            </>
          )}
        </Group>
      </div>
    </aside>
  );
}
