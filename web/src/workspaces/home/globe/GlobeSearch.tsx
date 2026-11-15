import { useEffect, useReducer } from "react";
import { Button } from "../../../components/ui/Button";
import { ProgressBar } from "../../../components/ui/Progress";
import { usePlanSearch, windowDays } from "../../../scenario/planSearch";
import { leftText } from "../../map/eta";
import { KindGlyph } from "../../map/KindGlyph";
import { KIND_STYLE, type SiteKind } from "../../map/sites";
import { pointName } from "../../map/siteMove";
import { useFindOutOfDate, useFindPlan } from "../../search/findSites";
import { useSearchResults } from "../../search/results";
import { CELL_COLOR, type Lattice } from "./lattice";

const SITE_KEYS: SiteKind[] = ["landed", "planned", "not_landed", "impact", "region"];

const KEYS: Array<{ key: keyof typeof CELL_COLOR; label: string }> = [
  { key: "pass", label: "Pass" },
  { key: "marginal", label: "Marginal" },
  { key: "fail", label: "Fail" },
  { key: "screened", label: "Not checked" },
  { key: "steep", label: "Too steep" },
];

function useTick(on: boolean): void {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [on]);
}

export function GlobeSearch({ lattice, tools = true }: { lattice: Lattice | null; tools?: boolean }) {
  const plan = useFindPlan();
  const outOfDate = useFindOutOfDate(plan);
  const phase = useSearchResults((s) => s.phase);
  const progress = useSearchResults((s) => s.progress);
  const startedMs = useSearchResults((s) => s.startedMs);
  const guessS = useSearchResults((s) => s.guessS);
  const error = useSearchResults((s) => s.error);
  const result = useSearchResults((s) => s.result);
  const resultBody = useSearchResults((s) => s.resultBody);
  const run = useSearchResults((s) => s.run);
  const cancel = useSearchResults((s) => s.cancel);
  const win = usePlanSearch((s) => s.window);
  const running = phase === "running";
  useTick(running);

  const same = resultBody !== null && plan.body !== null && JSON.stringify(resultBody) === JSON.stringify(plan.body);
  const counts = result?.counts ?? null;
  const n = (k: string): number => (counts && typeof counts[k] === "number" ? counts[k] : 0);
  const unchecked = counts ? n("inside_region") - n("evaluated_full") - n("slope_pruned") : 0;
  const where = resultBody ? pointName(resultBody.region.lat_deg, resultBody.region.lon_deg) : null;
  const windowed = (lattice?.epochs_ms.length ?? 0) > 1;
  const scope = `${plan.radiusKm} km around the site · ${win ? `${Math.round(windowDays(win))}-day landing window` : "at the plan's landing time"}`;

  return (
    <section className="globe-search" aria-label="Where to land">
      <p className="globe-search-title">Where to land</p>
      <p className="globe-search-scope">{scope}</p>
      {!tools ? null : running && startedMs !== null ? (
        <div className="globe-search-run" role="status">
          <div className="globe-search-row">
            <span>Searching · {leftText(startedMs, progress, guessS)}</span>
            <Button size="sm" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
          <ProgressBar value={progress ?? 0} label="Search progress" />
        </div>
      ) : (
        <Button size="sm" variant={same ? "default" : "primary"} icon="search" disabled={!plan.body || same} title={plan.reason ?? undefined} onClick={() => plan.body && run(plan.body, plan.guessS)}>
          {same ? "Up to date" : result ? "Search again" : `Find sites · ${plan.about}`}
        </Button>
      )}
      {phase === "error" && error && <p className="globe-search-error">{error}</p>}
      {result && counts && (
        <div className="globe-search-result">
          <p className="globe-search-counts">
            <b>{n("PASS")}</b> pass · <b>{n("MARGINAL")}</b> marginal · <b>{n("FAIL")}</b> fail
            {unchecked > 0 && <> · {unchecked} not checked</>}
            {n("slope_pruned") > 0 && <> · {n("slope_pruned")} too steep</>}
          </p>
          {(outOfDate || !lattice) && <p className="globe-search-note">{outOfDate ? "Out of date: the plan changed since this search." : "No grid in this result."}</p>}
          {where && !outOfDate && <p className="globe-search-note">Around {where}</p>}
        </div>
      )}
      <ul className="globe-site-keys" aria-label="Site symbols">
        {SITE_KEYS.map((k) => (
          <li key={k}>
            <KindGlyph kind={k} size={11} />
            {KIND_STYLE[k].label}
          </li>
        ))}
      </ul>
      {(result || running) && (
        <ul className="globe-keys">
          {KEYS.map((k) =>
            k.key === "pass" && windowed ? (
              <li key={k.key} className="globe-key-wide" title="Paler green passes at fewer of the landing times searched">
                <i className="globe-key-ramp" />
                Pass at few → all times
              </li>
            ) : (
              <li key={k.key}>
                <i style={{ background: CELL_COLOR[k.key] }} />
                {k.label}
              </li>
            ),
          )}
          <li>
            <i className="globe-key-ring" />
            Top ranked
          </li>
          <li>
            <i style={{ background: "#64d2ff" }} />
            Earth overhead
          </li>
        </ul>
      )}
    </section>
  );
}
