import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { EvaluateResult } from "../../api/site";
import type { AnalysisControls, AnalysisState } from "../../api/useAnalysis";
import { AnalysisStatus } from "../../components/AnalysisStatus";
import { Icon } from "../../components/ui/Icon";
import { PageHeader } from "../../components/ui/PageHeader";
import { Spinner } from "../../components/ui/Progress";
import type { Scenario } from "../../scenario/types";
import { DownloadMenu } from "../ReportButton";
import { explorerHref } from "../../learn/planPlace";
import { outcomeMargin, requirementName, verdictHeadline, type RequirementOutcome } from "../../lib/requirements";
import { quantityText } from "../../components/viz/units";
import { siteLabel } from "../../lib/siteName";
import { formatDeg } from "../../lib/format";
import { formatUtc, parseUtc } from "../../lib/time";
import { hoursOrDays } from "../../scenario/when";
import { landerName } from "../../shell/plan/landerFacts";
import type { VerdictSummary } from "./adapt";
import { Assumptions } from "./Assumptions";
import { SiteTabs } from "./SiteTabs";

interface SiteHeaderProps {
  doc: Scenario;
  evaluated: Scenario | null;
  result: EvaluateResult | null;
  summary: VerdictSummary | null;
  run: AnalysisState<EvaluateResult> & AnalysisControls;
}

const TONE_ICON = { pass: "check", marginal: "warn", fail: "cross" } as const;
const TONE_WORD = { pass: "Pass", marginal: "Marginal", fail: "Fail" } as const;

const isTone = (s: string | undefined): s is keyof typeof TONE_ICON => s === "pass" || s === "marginal" || s === "fail";

function coords(lat: number, lon: number): string {
  return `${formatDeg(Math.abs(lat), 2)}${lat < 0 ? "S" : "N"} ${formatDeg(Math.abs(lon), 2)}${lon < 0 ? "W" : "E"}`;
}

function Fact({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="site-fact">
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function showRequirement(key: string) {
  const row = document.getElementById(`req-${key}`);
  if (!row) return;
  row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  row.focus({ preventScroll: true });
}

function Mark({ o }: { o: RequirementOutcome }) {
  if (!isTone(o.state)) return null;
  const m = outcomeMargin(o);
  const name = requirementName(o.key, o.label);
  return (
    <li className="site-mark" data-tone={o.state}>
      <button type="button" onClick={() => showRequirement(o.key)} aria-label={`${name}: ${TONE_WORD[o.state]}${m !== null ? `, margin ${quantityText(m, o.unit, { sign: true })}` : ""}. Show in Requirements`}>
        <Icon name={TONE_ICON[o.state]} size={12} strokeWidth={2.2} />
        <span>{name}</span>
        {m !== null && <span className="site-mark-margin num">{quantityText(m, o.unit, { sign: true })}</span>}
      </button>
    </li>
  );
}

export function SiteHeader({ doc, evaluated, result, summary, run }: SiteHeaderProps) {
  const computing = run.phase === "running";
  const known = summary && summary.overall !== "unknown";
  const unevaluated = summary?.counts.unevaluated ?? 0;
  const head = known && !run.stale ? verdictHeadline(summary.overall, summary.outcomes, unevaluated) : null;
  const landing = parseUtc(doc.landing_utc ?? null);
  const tone = isTone(summary?.overall) ? summary.overall : null;
  return (
    <>
      <section className="site-title" aria-live="polite">
        <h1 className="site-title-name">{doc.name || "Untitled plan"}</h1>
        {head ? (
          <>
            <p className="site-verdict" data-tone={tone ?? undefined}>
              {tone && (
                <span className="site-verdict-icon">
                  <Icon name={TONE_ICON[tone]} size={16} strokeWidth={2.2} />
                </span>
              )}
              <span>
                <span className="sr-only">{head.word}. </span>
                {head.reason ?? head.word}.
              </span>
            </p>
            {summary && summary.outcomes.length + unevaluated > 0 && (
              <ul className="site-marks" aria-label="Requirements">
                {summary.outcomes.map((o) => (
                  <Mark key={o.key} o={o} />
                ))}
                {unevaluated > 0 && <li className="site-mark site-mark-none">{unevaluated} not evaluated</li>}
              </ul>
            )}
          </>
        ) : (
          <p className="site-verdict site-verdict-wait" role={computing ? "status" : undefined}>
            {computing ? (
              <>
                <span className="site-verdict-icon">
                  <Spinner size={14} />
                </span>
                Evaluating
              </>
            ) : (
              "Not evaluated"
            )}
          </p>
        )}
        <dl className="site-facts">
          <Fact k="Site">{siteLabel(doc.site.name) || "Unnamed site"}</Fact>
          <Fact k="Coordinates">{coords(doc.site.lat_deg, doc.site.lon_deg)}</Fact>
          <Fact k="Landing">{landing === null ? "Not set" : formatUtc(landing, { seconds: false })}</Fact>
          <Fact k="Stay">{hoursOrDays(doc.mission_duration_h)}</Fact>
          <Fact k="Lander">{landerName(doc.profile.name)}</Fact>
        </dl>
      </section>
      <PageHeader
        tabs={<SiteTabs />}
        actions={
          <>
            {run.phase === "running" && !run.stale && <AnalysisStatus state={run} what="the site evaluation" />}
            {result && <Assumptions scenario={evaluated} result={result} />}
            <Link className="btn btn-ghost btn-sm" to={explorerHref({ lat: doc.site.lat_deg, lon: doc.site.lon_deg, name: siteLabel(doc.site.name) || "Your plan site", catalogId: doc.site.catalog_id ?? "", utc: doc.landing_utc ?? null })}>
              <Icon name="terrain" size={14} />
              Stand here in Explorer
            </Link>
            <DownloadMenu scenario={doc} />
          </>
        }
      />
    </>
  );
}
