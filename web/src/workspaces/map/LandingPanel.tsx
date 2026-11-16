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

const pct = (v: number): string => (v > 0 && v < 0.005 ? "<1%" : `${Math.round(v * 100)}%`);

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

function Swatch({ color, ring, round }: { color: string; ring?: boolean; round?: boolean }) {
  return <i className="mp-swatch" data-ring={ring || undefined} data-round={round || undefined} style={{ ["--sw" as string]: color }} aria-hidden="true" />;
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
        { key: "steep", label: "Too steep", color: CELL_COLOR.steep, n: c.steep },
        { key: "screened", label: "Unchecked", color: CELL_COLOR.screened, n: c.screened + c.unknown },
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
            <p className="mp-note">Couldn't load the sky.</p>
          ) : !p.bodies ? (
            <p className="mp-note">
              <Spinner size={12} /> Loading
            </p>
          ) : (
            <ul className="mp-rows">
              {p.bodies.map((b) => {
                const w = bodyWords(b);
                return (
                  <li key={b.body} className="mp-row" data-open={b.open || undefined}>
                    <Swatch color={b.body === "sun" ? "var(--c-sun)" : "var(--c-earth)"} ring={b.body === "earth"} round />
                    <span className="mp-row-label">{w.name}</span>
                    <span className="mp-row-sub num">{w.detail}</span>
                    <strong className="mp-row-value">{w.state}</strong>
                  </li>
                );
              })}
            </ul>
          )}
          {p.smooth && <p className="mp-hint">No terrain here: smooth-sphere horizon.</p>}
        </Group>

        <Group title="Search" note={p.search ? `${p.search.radius_m !== null ? `${kmText(p.search.radius_m)} · ` : ""}${kmText(p.search.spacing_m)} cells` : undefined}>
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
                    <li key={row.key} className="mp-row">
                      <Swatch color={row.color} />
                      <span className="mp-row-label">{row.label}</span>
                      <span className="num mp-row-value">{total > 0 ? pct(row.n / total) : "–"}</span>
                    </li>
                  ))}
              </ul>
              {p.search.stale && (
                <p className="mp-note mp-stale">
                  Out of date ·{" "}
                  <button type="button" className="mp-link" onClick={p.onOverview}>
                    Search again
                  </button>
                </p>
              )}
            </>
          ) : (
            <div className="mp-line">
              <span className="mp-note">None yet</span>
              <Button size="sm" variant="ghost" icon="search" onClick={p.onOverview}>
                Search in Overview
              </Button>
            </div>
          )}
        </Group>

        <Group title="Landing ellipse" note={r ? `${r.n_samples} touchdowns` : undefined}>
          {!e.set ? (
            <div className="mp-line">
              <span className="mp-note">None set</span>
              <Button size="sm" variant="ghost" icon="plus" onClick={p.onAddEllipse}>
                Add
              </Button>
            </div>
          ) : e.phase === "running" ? (
            <ProgressBar value={e.progress ?? 0} label="Checking the ellipse" />
          ) : r ? (
            <>
              <ul className="mp-rows">
                <li className="mp-row">
                  <Swatch color="var(--c-pass)" />
                  <span className="mp-row-label">Passes</span>
                  <span className="num mp-row-value">{typeof passShare === "number" ? pct(passShare) : "–"}</span>
                </li>
                <li className="mp-row">
                  <Swatch color={CELL_COLOR.steep} />
                  <span className="mp-row-label">{slopeLimit !== null ? `Steeper than ${slopeLimit}°` : "Too steep"}</span>
                  <span className="num mp-row-value">{typeof r.hazard_fraction === "number" ? pct(r.hazard_fraction) : "–"}</span>
                </li>
              </ul>
              <Button size="sm" variant="ghost" onClick={p.onEllipseDetails}>
                Details
              </Button>
            </>
          ) : (
            <>
              {e.error && <p className="mp-note mp-stale">{e.error}</p>}
              <Button size="sm" icon="ellipse" onClick={p.onCheckEllipse}>
                Check ellipse
              </Button>
            </>
          )}
        </Group>
      </div>
    </aside>
  );
}
