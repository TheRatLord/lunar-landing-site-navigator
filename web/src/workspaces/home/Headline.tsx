import type { ReactNode, Ref } from "react";
import { Link } from "react-router-dom";
import type { EvaluateResult } from "../../api/site";
import type { AnalysisControls, AnalysisState } from "../../api/useAnalysis";
import { Icon } from "../../components/ui/Icon";
import { Spinner } from "../../components/ui/Progress";
import type { Verdict } from "../../contract/types";
import { verdictHeadline } from "../../lib/requirements";
import { VERDICT_LABEL } from "../../lib/verdict";
import type { VerdictSummary } from "../site/adapt";
import { nextPass, scanAt, type BestLanding, type YearScan } from "./scan";
import { dayText, skyFacts, type Survey } from "./survey";

interface HeadlineProps {
  subject: string;
  blockRef: Ref<HTMLElement>;
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
  lead: string | null;
  note: string | null;
}

function exactLine(s: VerdictSummary): VerdictLine {
  if (s.overall === "unknown") return { tone: "unknown", word: "Not evaluated", lead: null, note: null };
  const v = verdictHeadline(s.overall, s.outcomes, { batteryEveryHeading: s.batteryEveryHeading, batteryWorst: s.batteryWorst });
  return { tone: s.overall, word: VERDICT_LABEL[s.overall], lead: v?.lead ?? null, note: v?.note ?? null };
}

export function Headline({ subject, blockRef, survey, failed, onRetry, timeMs, dragging, requirements, summary, evaluation, scan, best, onJump }: HeadlineProps) {
  const sky = survey ? skyFacts(survey, timeMs) : null;
  const preview = scan && (dragging || (!summary && evaluation.phase === "running")) ? scanAt(scan, timeMs) : null;
  const line: VerdictLine | null =
    requirements === 0
      ? null
      : summary
        ? exactLine(summary)
        : preview
          ? { tone: preview.verdict, word: VERDICT_LABEL[preview.verdict], lead: preview.verdict === "pass" ? null : preview.limiting, note: null }
          : null;
  const current = line?.tone ?? null;
  const next = scan && current !== null && current !== "pass" ? nextPass(scan, timeMs, survey?.both ?? null) : null;
  const top = best.reduce<BestLanding | null>((a, b) => (!a || b.key > a.key ? b : a), null);
  const showTop = top && dayText(top.t_ms) !== dayText(timeMs) && (next === null || dayText(top.t_ms) !== dayText(next));
  const failing = summary !== null && (summary.overall === "fail" || summary.overall === "marginal");
  const skyLine = sky ? [sky.text, sky.events].filter(Boolean).join(" · ") : null;

  return (
    <>
      <section ref={blockRef} className="home-verdict" aria-live="polite">
        <p className="home-eyebrow">{subject}</p>
        {requirements === 0 ? (
          sky ? (
            <p className="home-headline-text">{sentence(sky.text)}</p>
          ) : failed ? (
            <Failed onRetry={onRetry} />
          ) : (
            <Wait text="Computing the year" />
          )
        ) : line ? (
          <p className="home-headline-text" data-preview={!summary || undefined}>
            <strong className="verdict-word" data-tone={line.tone}>
              {line.word}.
            </strong>
            {line.lead && <span className="home-verdict-detail"> {sentence(line.lead)}</span>}
          </p>
        ) : failed ? (
          <Failed onRetry={onRetry} />
        ) : (
          <Wait text="Checking requirements" />
        )}
        {line && failed && <Failed onRetry={onRetry} small />}
        {line?.note && <p className="home-headline-note">{line.note}</p>}
        {(requirements === 0 ? sky?.events : skyLine) ? (
          <p className="home-headline-sub">
            <span className={requirements !== 0 && sky?.warn ? "home-warn" : undefined}>{requirements === 0 ? sky?.events : skyLine}</span>
          </p>
        ) : requirements !== 0 && !failed && !sky ? (
          <p className="home-headline-sub">
            <Spinner size={12} /> Computing the year
          </p>
        ) : null}
      </section>

      <div className="home-actions">
        {failing && next !== null ? (
          <button type="button" className="btn btn-primary home-cta" onClick={() => onJump(next)}>
            Land {dayText(next)}
          </button>
        ) : failing ? (
          <Link className="btn btn-primary home-cta" to="/map">
            Find a site nearby
          </Link>
        ) : null}
        <Link className={`btn home-cta ${failing ? "btn-default" : "btn-primary"}`} to="/site">
          {requirements === 0 || !summary || summary.overall === "unknown" ? "Open Site" : summary.overall === "pass" ? "See margins" : "See why"}
          <Icon name="chevronRight" size={14} />
        </Link>
      </div>

      {scan && (
        <dl className="home-figures">
          <Figure label={scan.passFraction > 0 ? "of landing dates this year work" : "No date this year works"} value={`${Math.round(scan.passFraction * 100)}%`} />
          {next !== null && <Figure label="Next date that works" value={dayText(next)} onClick={() => onJump(next)} />}
          {showTop && <Figure label={top.verdict === "marginal" ? "Best date (marginal)" : "Best date this year"} value={dayText(top.t_ms)} onClick={() => onJump(top.t_ms)} />}
          {failing && next !== null && (
            <div className="home-figure home-figure-link">
              <Link to="/map">
                Find a site nearby <Icon name="chevronRight" size={12} />
              </Link>
            </div>
          )}
        </dl>
      )}
    </>
  );
}

function Figure({ label, value, onClick }: { label: string; value: ReactNode; onClick?: () => void }) {
  return (
    <div className="home-figure">
      <dd>
        {onClick ? (
          <button type="button" className="home-jump" title="Move the landing to this date" onClick={onClick}>
            {value}
          </button>
        ) : (
          value
        )}
      </dd>
      <dt>{label}</dt>
    </div>
  );
}

function sentence(text: string): string {
  const t = text.trim();
  if (!t) return t;
  const first = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(first) ? first : `${first}.`;
}

function Failed({ onRetry, small }: { onRetry(): void; small?: boolean }) {
  return (
    <p className={small ? "home-headline-sub home-headline-fail" : "home-headline-text home-headline-fail"} role="alert">
      Couldn't compute.
      <button type="button" className="home-jump" onClick={onRetry}>
        Retry
      </button>
    </p>
  );
}

function Wait({ text }: { text: string }) {
  return (
    <p className="home-headline-wait" role="status">
      <Spinner size={16} /> {text}
    </p>
  );
}
