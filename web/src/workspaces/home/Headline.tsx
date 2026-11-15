import { Link } from "react-router-dom";
import type { EvaluateResult } from "../../api/site";
import type { AnalysisControls, AnalysisState } from "../../api/useAnalysis";
import { Icon } from "../../components/ui/Icon";
import { Spinner } from "../../components/ui/Progress";
import type { Verdict } from "../../contract/types";
import { formatBounds, formatValue } from "../../lib/format";
import { VERDICT_LABEL } from "../../lib/verdict";
import type { VerdictSummary } from "../site/adapt";
import { nextPass, scanAt, type BestLanding, type YearScan } from "./scan";
import { dayText, skyFacts, type Survey } from "./survey";

interface HeadlineProps {
  survey: Survey | null;
  failed: boolean;
  onRetry(): void;
  timeMs: number;
  dragging: boolean;
  requirements: number;
  summary: VerdictSummary | null;
  evaluation: AnalysisState<EvaluateResult> & AnalysisControls;
  scan: YearScan | null;
  best: BestLanding[];
  onJump(ms: number): void;
}

type Tone = Verdict | "unknown";

interface VerdictLine {
  tone: Tone;
  word: string;
  detail: string | null;
  worst?: { value: number; margin: number; limit: string | null; unit: string };
}

function exactLine(s: VerdictSummary): VerdictLine {
  if (s.overall === "unknown") return { tone: "unknown", word: "Not evaluated", detail: null };
  const n = s.counts.pass + s.counts.marginal + s.counts.fail;
  const lim = s.limiting;
  if (s.overall === "pass" || !lim) return { tone: s.overall, word: VERDICT_LABEL[s.overall], detail: n === 1 ? "requirement met" : `all ${n} requirements met` };
  const value = lim.heading_dependent || !Number.isFinite(lim.value) ? null : formatValue(lim.value, lim.unit, 1);
  const lo = lim.limit_range?.[0] ?? (lim.sense === "min" ? lim.limit : undefined);
  const hi = lim.limit_range?.[1] ?? (lim.sense === "max" ? lim.limit : undefined);
  const limit = formatBounds(lo, hi, lim.unit, [lo, hi].every((x) => x === undefined || Number.isInteger(x)) ? 0 : 1);
  const world = lim.worst_world;
  const worstValue = world ? lim.value_worlds?.[world] : null;
  const worst = s.overall === "marginal" && worstValue !== null && worstValue !== undefined && lim.margin_worst !== undefined ? { value: worstValue, margin: lim.margin_worst, limit, unit: lim.unit } : undefined;
  return { tone: s.overall, word: VERDICT_LABEL[s.overall], detail: `${lim.label}${value ? ` ${value}` : ""}${limit ? `, limit ${limit}` : ""}`, worst };
}

export function Headline({ survey, failed, onRetry, timeMs, dragging, requirements, summary, evaluation, scan, best, onJump }: HeadlineProps) {
  const sky = survey ? skyFacts(survey, timeMs) : null;
  const preview = scan && (dragging || (!summary && evaluation.phase === "running")) ? scanAt(scan, timeMs) : null;
  const line: VerdictLine | null =
    requirements === 0
      ? null
      : summary
        ? exactLine(summary)
        : preview
          ? { tone: preview.verdict, word: VERDICT_LABEL[preview.verdict], detail: preview.verdict === "pass" ? null : preview.limiting }
          : null;
  const current = line?.tone ?? null;
  const next = scan && current !== null && current !== "pass" ? nextPass(scan, timeMs) : null;
  const top = best.reduce<BestLanding | null>((a, b) => (!a || b.key > a.key ? b : a), null);
  const showTop = top && dayText(top.t_ms) !== dayText(timeMs) && (next === null || dayText(top.t_ms) !== dayText(next));

  return (
    <section className="home-verdict" aria-live="polite">
      <div className="home-headline">
        {requirements === 0 ? (
          sky ? (
            <p className="home-headline-text">
              <span className="home-tone" data-tone={sky.tone} aria-hidden="true" />
              {sky.text}
            </p>
          ) : failed ? (
            <Failed onRetry={onRetry} />
          ) : (
            <Wait text="Computing the year" />
          )
        ) : line ? (
          <p className="home-headline-text" data-preview={!summary || undefined}>
            <span className="home-tone" data-tone={line.tone} aria-hidden="true" />
            <strong className="home-verdict-word" data-tone={line.tone}>
              {line.word}
            </strong>
            {line.detail && <span className="home-verdict-detail"> · {line.detail}</span>}
          </p>
        ) : failed ? (
          <Failed onRetry={onRetry} />
        ) : (
          <Wait text="Checking requirements" />
        )}
        {line && failed && <Failed onRetry={onRetry} small />}
        {requirements !== 0 && (sky || !failed) && (
          <p className="home-headline-sub">
            {sky ? (
              <>
                <span className={sky.warn ? "home-warn" : undefined}>{sky.text}</span>
                {sky.events && <span className="faint"> · {sky.events}</span>}
              </>
            ) : failed ? null : (
              <span className="faint">
                <Spinner size={12} /> Computing the year
              </span>
            )}
          </p>
        )}
        {requirements === 0 && sky?.events && <p className="home-headline-sub">{sky.events}</p>}
        {scan && (
          <p className="home-headline-when">
            {scan.passFraction > 0 ? <>Meets requirements {Math.round(scan.passFraction * 100)}% of the year</> : <>No date this year meets the requirements</>}
            {next !== null && (
              <>
                {" · Next: "}
                <button type="button" className="home-jump" onClick={() => onJump(next)}>
                  {dayText(next)}
                </button>
              </>
            )}
            {showTop && (
              <>
                {" · "}
                <span className="home-best-key" aria-hidden="true">
                  ◆
                </span>
                {" Best: "}
                <button type="button" className="home-jump" onClick={() => onJump(top.t_ms)}>
                  {dayText(top.t_ms)}
                </button>
              </>
            )}
          </p>
        )}
      </div>
      <Link className="btn btn-primary btn-md home-next" to="/site">
        {requirements === 0 || !summary || summary.overall === "unknown" ? "Open Site" : summary.overall === "pass" ? "See margins on Site" : "See why on Site"}
        <Icon name="chevronRight" size={14} />
      </Link>
    </section>
  );
}

function Failed({ onRetry, small }: { onRetry(): void; small?: boolean }) {
  return (
    <p className={small ? "home-headline-sub home-headline-fail" : "home-headline-text home-headline-fail"} role="alert">
      <span className="home-tone" data-tone="unknown" aria-hidden="true" />
      Couldn't compute
      <button type="button" className="home-jump" onClick={onRetry}>
        Retry
      </button>
    </p>
  );
}

function Wait({ text }: { text: string }) {
  return (
    <p className="home-headline-wait" role="status">
      <Spinner size={14} /> {text}
    </p>
  );
}
