import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { EvaluateResult } from "../../api/site";
import type { AnalysisControls, AnalysisState } from "../../api/useAnalysis";
import { AnalysisStatus } from "../../components/AnalysisStatus";
import { Icon } from "../../components/ui/Icon";
import { PageHeader } from "../../components/ui/PageHeader";
import { Spinner } from "../../components/ui/Progress";
import type { Scenario } from "../../scenario/types";
import { useEllipsePassShare } from "../ellipse/store";
import { DownloadMenu } from "../ReportButton";
import { explorerHref } from "../../learn/planPlace";
import { verdictHeadline } from "../../lib/requirements";
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

const BADGE_ICON = { pass: "check", marginal: "warn", fail: "close" } as const;

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

function EllipseFact({ doc }: { doc: Scenario }) {
  const share = useEllipsePassShare(doc);
  if (share === null) return null;
  return (
    <Fact k="Ellipse">
      <Link to="/site/ellipse">{Math.round(share * 100)}% passes</Link>
    </Fact>
  );
}

export function SiteHeader({ doc, evaluated, result, summary, run }: SiteHeaderProps) {
  const computing = run.phase === "running";
  const known = summary && summary.overall !== "unknown";
  const head = known && !run.stale ? verdictHeadline(summary.overall, summary.outcomes) : null;
  const landing = parseUtc(doc.landing_utc ?? null);
  const tone = summary?.overall;
  const icon = tone === "pass" || tone === "marginal" || tone === "fail" ? BADGE_ICON[tone] : null;
  return (
    <>
      <section className="site-title" aria-live="polite">
        <div className="site-title-row">
          <h1 className="site-title-name">{doc.name || "Untitled plan"}</h1>
          {head ? (
            <p className="site-result">
              <strong className="site-badge" data-tone={tone}>
                {icon && <Icon name={icon} size={14} />}
                {head.word}
              </strong>
              {head.reason && <span className="site-reason">{head.reason}</span>}
            </p>
          ) : (
            <p className="site-result site-result-wait" role={computing ? "status" : undefined}>
              {computing ? (
                <>
                  <Spinner size={14} />
                  Evaluating
                </>
              ) : (
                "Not evaluated"
              )}
            </p>
          )}
        </div>
        <dl className="site-facts">
          <Fact k="Site">{siteLabel(doc.site.name) || "Unnamed site"}</Fact>
          <Fact k="Coordinates">{coords(doc.site.lat_deg, doc.site.lon_deg)}</Fact>
          <Fact k="Landing">{landing === null ? "Not set" : formatUtc(landing, { seconds: false })}</Fact>
          <Fact k="Stay">{hoursOrDays(doc.mission_duration_h)}</Fact>
          <Fact k="Lander">{landerName(doc.profile.name)}</Fact>
          {!run.stale && <EllipseFact doc={doc} />}
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
