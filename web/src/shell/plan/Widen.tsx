import { useId, useState } from "react";
import { DateTimeInput, Select, Toggle } from "../../components/ui/Fields";
import {
  DEFAULT_RADIUS_KM,
  MAX_RADIUS_KM,
  MIN_RADIUS_KM,
  RADIUS_PRESETS_KM,
  RANK_OPTIONS,
  activeRequirements,
  defaultWindow,
  effectiveRank,
  usePlanSearch,
  type LandingWindow,
  type RankBy,
} from "../../scenario/planSearch";
import { useScenario } from "../../scenario/store";
import { spanText } from "../../scenario/when";

export function areaText(radius_km: number | null): string | null {
  return radius_km === null ? null : `Within ${radius_km} km`;
}

export function windowText(w: LandingWindow | null): string | null {
  return w === null ? null : `Any time ${spanText(w.first_ms, w.last_ms)}`;
}

export function AreaControl() {
  const radius = usePlanSearch((s) => s.radius_km);
  const setRadius = usePlanSearch((s) => s.setRadius);
  const [draft, setDraft] = useState<string | null>(null);
  const id = useId();
  const text = draft ?? (radius === null ? "" : String(radius));
  const value = Number(text);
  const bad = draft !== null && !(Number.isFinite(value) && value >= MIN_RADIUS_KM && value <= MAX_RADIUS_KM);
  return (
    <div className="plan-widen">
      <Toggle
        checked={radius !== null}
        onChange={(on) => {
          setDraft(null);
          setRadius(on ? DEFAULT_RADIUS_KM : null);
        }}
        label="Search radius"
      />
      {radius !== null && (
        <div className="plan-widen-row">
          <label className="plan-widen-label" htmlFor={id}>
            Within
          </label>
          <span className="input-group plan-widen-input">
            <input
              id={id}
              className="input num"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              value={text}
              aria-invalid={bad ? true : undefined}
              onChange={(e) => {
                const next = e.target.value;
                const km = Number(next);
                setDraft(next);
                if (next.trim() !== "" && Number.isFinite(km) && km >= MIN_RADIUS_KM && km <= MAX_RADIUS_KM) setRadius(km);
              }}
              onBlur={() => setDraft(null)}
            />
            <span className="input-unit" aria-hidden="true">
              km
            </span>
          </span>
          <span className="sc-steps plan-widen-presets">
            {RADIUS_PRESETS_KM.map((km) => (
              <button
                key={km}
                type="button"
                className="sc-step"
                aria-pressed={radius === km}
                onClick={() => {
                  setDraft(null);
                  setRadius(km);
                }}
              >
                {km}
              </button>
            ))}
          </span>
        </div>
      )}
      {bad && (
        <p className="sc-msg" role="alert">
          Use a radius from {MIN_RADIUS_KM} to {MAX_RADIUS_KM} km
        </p>
      )}
    </div>
  );
}

export function WindowControl() {
  const doc = useScenario((s) => s.doc);
  const win = usePlanSearch((s) => s.window);
  const setWindow = usePlanSearch((s) => s.setWindow);
  if (!doc) return null;
  const bad = win !== null && win.last_ms <= win.first_ms;
  return (
    <div className="plan-widen">
      <Toggle checked={win !== null} onChange={(on) => setWindow(on ? defaultWindow(doc) : null)} label="Search a landing window" />
      {win !== null && (
        <>
          <div className="plan-widen-row">
            <span className="plan-widen-label">From</span>
            <DateTimeInput compact label="Earliest landing" value={win.first_ms} onChange={(first_ms) => setWindow({ ...win, first_ms })} />
          </div>
          <div className="plan-widen-row">
            <span className="plan-widen-label">To</span>
            <DateTimeInput compact label="Latest landing" value={win.last_ms} onChange={(last_ms) => setWindow({ ...win, last_ms })} />
          </div>
        </>
      )}
      {bad && (
        <p className="sc-msg" role="alert">
          “To” must come after “From”
        </p>
      )}
    </div>
  );
}

export function RankControl() {
  const doc = useScenario((s) => s.doc);
  const rankBy = usePlanSearch((s) => s.rankBy);
  const setRankBy = usePlanSearch((s) => s.setRankBy);
  if (!doc) return null;
  const none = activeRequirements(doc) === 0;
  const options = RANK_OPTIONS.filter((o) => !(none && o.value === "margin")).map((o) => ({ value: o.value, label: o.label }));
  return (
    <div className="plan-widen plan-rank">
      <div className="plan-widen-row">
        <span className="plan-widen-label">Rank by</span>
        <Select aria-label="Rank sites and dates by" value={effectiveRank(rankBy, doc)} options={options} onChange={(v) => setRankBy(v as RankBy)} />
      </div>
    </div>
  );
}
