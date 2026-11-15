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

function Notes({ doc }: { doc: Scenario }) {
  const share = useEllipsePassShare(doc);
  if (share === null) return null;
  return (
    <div className="vs-notes">
      <Link to="/site/ellipse" className="vs-note vs-note-link">
        {Math.round(share * 100)}% of the landing ellipse passes
      </Link>
    </div>
  );
}

export function SiteHeader({ doc, evaluated, result, summary, run }: SiteHeaderProps) {
  const computing = run.phase === "running";
  const known = summary && summary.overall !== "unknown";
  const head = known && !run.stale ? verdictHeadline(summary.overall, summary.outcomes) : null;
  return (
    <>
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
      <section className="site-verdict" aria-live="polite">
        {head ? (
          <>
            <p className="site-headline">
              <strong className="verdict-word" data-tone={summary?.overall}>
                {head.word}.
              </strong>
              {head.lead && ` ${head.lead}.`}
            </p>
            {head.notes[0] && <p className="site-headline-note">{head.notes[0]}</p>}
          </>
        ) : computing ? (
          <p className="site-headline site-headline-wait" role="status">
            <Spinner size={16} />
            Computing
          </p>
        ) : (
          <p className="site-headline site-headline-wait">Not evaluated</p>
        )}
      </section>
      {!run.stale && <Notes doc={doc} />}
    </>
  );
}
