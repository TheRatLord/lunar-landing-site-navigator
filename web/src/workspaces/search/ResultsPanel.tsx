import { useEffect, useReducer } from "react";
import type { SearchRow } from "../../api/search";
import { Button, IconButton } from "../../components/ui/Button";
import { ProgressBar } from "../../components/ui/Progress";
import { leftText } from "../map/eta";
import { STATE_WORD, marginText } from "../map/overlays";
import "../../styles/search.css";
import { useFindOutOfDate, type FindPlan } from "./findSites";
import { useSearchResults } from "./results";

interface ResultsPanelProps {
  plan: FindPlan;
  selected: number | null;
  onRun(): void;
  onPick(row: SearchRow): void;
}

function useTick(on: boolean): void {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(tick, 5000);
    return () => window.clearInterval(id);
  }, [on]);
}

export function ResultsPanel({ plan, selected, onRun, onPick }: ResultsPanelProps) {
  const phase = useSearchResults((s) => s.phase);
  const progress = useSearchResults((s) => s.progress);
  const startedMs = useSearchResults((s) => s.startedMs);
  const guessS = useSearchResults((s) => s.guessS);
  const error = useSearchResults((s) => s.error);
  const rows = useSearchResults((s) => s.candidates);
  const hasResult = useSearchResults((s) => s.result !== null);
  const shown = useSearchResults((s) => s.shown);
  const setShown = useSearchResults((s) => s.setShown);
  const cancel = useSearchResults((s) => s.cancel);
  const outOfDate = useFindOutOfDate(plan);
  const resultBody = useSearchResults((s) => s.resultBody);
  const current = resultBody !== null && plan.body !== null && JSON.stringify(resultBody) === JSON.stringify(plan.body);
  const running = phase === "running";
  useTick(running);

  return (
    <div className="map-panel se-panel">
      {running && startedMs !== null && (
        <div className="se-run" role="status">
          <div className="se-run-line">
            <span>Searching · {leftText(startedMs, progress, guessS)}</span>
            <Button size="sm" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
          <ProgressBar value={progress ?? 0} label="Search progress" />
        </div>
      )}
      {phase === "error" && (
        <p className="se-error" role="alert">
          Search failed: {error}
        </p>
      )}
      {!running && !current && (
        <div className="se-start">
          <Button size="sm" variant={hasResult ? "default" : "primary"} icon="search" disabled={plan.body === null} onClick={onRun}>
            Find sites
          </Button>
          <span className="se-hint">{plan.reason ?? `${outOfDate ? "Out of date · " : ""}Within ${plan.radiusKm} km of the plan site · ${plan.about}`}</span>
        </div>
      )}
      {hasResult && (
        <>
          <div className="se-head">
            <h2 className="se-count num">
              {rows.length} {rows.length === 1 ? "site" : "sites"}
            </h2>
            <IconButton icon={shown ? "eye" : "eyeOff"} label={shown ? "Hide on map" : "Show on map"} size="sm" pressed={shown} onClick={() => setShown(!shown)} />
          </div>
          <ol className="se-rows" aria-label="Sites found">
            {rows.map((r) => (
              <li key={r.rank}>
                <button type="button" className="se-row" aria-current={selected === r.rank} onClick={() => onPick(r)}>
                  <span className={`se-badge se-badge-${r.state}`}>{r.rank}</span>
                  <span className="se-verdict">{STATE_WORD[r.state]}</span>
                  <span className="se-margin">{marginText(r) ?? ""}</span>
                </button>
              </li>
            ))}
          </ol>
          {rows.length === 0 && <p className="se-hint se-none">No sites in this area</p>}
        </>
      )}
    </div>
  );
}
