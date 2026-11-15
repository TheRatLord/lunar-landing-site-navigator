import { useId, useState } from "react";
import { DateTimeInput, Select, Toggle } from "../../components/ui/Fields";
import { Icon, type IconName } from "../../components/ui/Icon";
import { formatUtc, parseUtc } from "../../lib/time";
import { useEditorUi, type PlanField } from "../../scenario/editor/editorUi";
import {
  DEFAULT_RADIUS_KM,
  MAX_RADIUS_KM,
  MIN_RADIUS_KM,
  RADIUS_PRESETS_KM,
  RANK_OPTIONS,
  activeRequirements,
  defaultWindow,
  effectiveRank,
  rankLabel,
  usePlanSearch,
  windowDays,
  type LandingWindow,
  type RankBy,
} from "../../scenario/planSearch";
import { useScenario } from "../../scenario/store";
import type { Scenario } from "../../scenario/types";

const day = (ms: number): string => formatUtc(ms, { seconds: false }).slice(0, 10);

export function areaText(radius_km: number | null): string {
  return radius_km === null ? "This point only" : `Or anywhere within ${radius_km} km`;
}

export function windowText(w: LandingWindow | null): string {
  return w === null ? "This time only" : `Or any time ${day(w.first_ms)} to ${day(w.last_ms)}`;
}

export function rankText(rankBy: RankBy, doc: Scenario): string {
  return `Ranked by ${rankLabel(effectiveRank(rankBy, doc))}`;
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
        label="Also consider nearby sites"
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
      <p className="plan-widen-note">{radius === null ? "Find sites needs an area to search." : "Find sites ranks the landing points inside this circle."}</p>
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
      <Toggle checked={win !== null} onChange={(on) => setWindow(on ? defaultWindow(doc) : null)} label="Also consider other landing times" />
      {win !== null && (
        <>
          <div className="plan-widen-row">
            <span className="plan-widen-label">From</span>
            <DateTimeInput compact label="Earliest landing (UTC)" value={win.first_ms} onChange={(first_ms) => setWindow({ ...win, first_ms })} />
          </div>
          <div className="plan-widen-row">
            <span className="plan-widen-label">To</span>
            <DateTimeInput compact label="Latest landing (UTC)" value={win.last_ms} onChange={(last_ms) => setWindow({ ...win, last_ms })} />
          </div>
        </>
      )}
      {bad && (
        <p className="sc-msg" role="alert">
          The latest landing must come after the earliest
        </p>
      )}
      <p className="plan-widen-note">
        {win === null ? "Dates scans a year around the landing; Find sites uses this landing time." : `Dates and Find sites consider every landing in these ${Math.round(windowDays(win))} days.`}
      </p>
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
      <p className="plan-widen-note">
        {none ? "With no requirement switched on, every site and date passes, so they are ranked by hours." : "Passing sites and dates always come first; this orders them within pass, marginal and fail."}
      </p>
    </div>
  );
}

type InputKind = "area" | "window" | "requirements" | "rank";

const INPUT: Record<InputKind, { field: PlanField; icon: IconName; label: string }> = {
  area: { field: "site", icon: "pin", label: "Where" },
  window: { field: "time", icon: "calendar", label: "When" },
  requirements: { field: "constraints", icon: "checklist", label: "Must meet" },
  rank: { field: "constraints", icon: "sliders", label: "Ranked by" },
};

export function PlanInputs({ show, layout = "column", when }: { show: InputKind[]; layout?: "column" | "row"; when?: string }) {
  const doc = useScenario((s) => s.doc);
  const radius = usePlanSearch((s) => s.radius_km);
  const win = usePlanSearch((s) => s.window);
  const rankBy = usePlanSearch((s) => s.rankBy);
  const openField = useEditorUi((s) => s.openField);
  if (!doc) return null;
  const site = doc.site.name || "the plan site";
  const n = activeRequirements(doc);
  const landing = parseUtc(doc.landing_utc);
  const value: Record<InputKind, string> = {
    area: radius === null ? `${site} only` : `Within ${radius} km of ${site}`,
    window: when !== undefined ? when : win === null ? `${landing === null ? doc.landing_utc : formatUtc(landing, { seconds: false })} only` : `Any time ${day(win.first_ms)} to ${day(win.last_ms)}`,
    requirements: n === 0 ? "No requirements" : `${n} requirement${n === 1 ? "" : "s"}`,
    rank: rankLabel(effectiveRank(rankBy, doc)),
  };
  return (
    <ul className="plan-inputs" data-layout={layout} aria-label="Plan choices this page uses">
      {show.map((kind) => {
        const spec = INPUT[kind];
        return (
          <li key={kind}>
            <button type="button" className="plan-input" title="Change on the plan panel" onClick={() => openField(spec.field)}>
              <Icon name={spec.icon} size={12} />
              <span className="plan-input-label">{spec.label}</span>
              <span className="plan-input-value">{value[kind]}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
