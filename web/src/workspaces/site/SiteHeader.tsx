import { Link } from "react-router-dom";
import type { EvaluateResult } from "../../api/site";
import type { AnalysisControls, AnalysisState } from "../../api/useAnalysis";
import { AnalysisStatus } from "../../components/AnalysisStatus";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { PageHeader } from "../../components/ui/PageHeader";
import { Spinner } from "../../components/ui/Progress";
import { useScenario } from "../../scenario/store";
import type { Limit, Scenario } from "../../scenario/types";
import { useEllipsePassShare } from "../ellipse/store";
import { DownloadMenu } from "../ReportButton";
import { explorerHref } from "../../learn/planPlace";
import { verdictHeadline } from "../../lib/requirements";
import { siteLabel } from "../../lib/siteName";
import { batteryNote, batteryRisk, type VerdictSummary } from "./adapt";
import { Assumptions } from "./Assumptions";
import { SiteTabs } from "./SiteTabs";

interface SiteHeaderProps {
  doc: Scenario;
  evaluated: Scenario | null;
  result: EvaluateResult | null;
  summary: VerdictSummary | null;
  run: AnalysisState<EvaluateResult> & AnalysisControls;
}

function Notes({ doc, result }: { doc: Scenario; result: EvaluateResult | null }) {
  const edit = useScenario((s) => s.edit);
  const share = useEllipsePassShare(doc);
  const battery = result ? batteryRisk(result, doc) : null;
  if (!battery && share === null) return null;
  const addBattery = () => {
    if (!battery) return;
    const limit: Limit = { min: battery.suggestedMin, max: null, unit: "", label: "Minimum battery state of charge", origin: { basis: "user", label: "", source_url: null, note: "" }, margin_scale: 1 };
    edit(["constraints", "min_state_of_charge"], limit);
  };
  return (
    <div className="vs-notes">
      {battery && (
        <span className="vs-note vs-note-warn">
          <Icon name="battery" size={12} />
          {batteryNote(battery)}
          <Button size="sm" variant="ghost" onClick={addBattery}>
            Make it a requirement
          </Button>
        </span>
      )}
      {share !== null && (
        <Link to="/site/ellipse" className="vs-note vs-note-link">
          {Math.round(share * 100)}% of the landing ellipse passes
        </Link>
      )}
    </div>
  );
}

export function SiteHeader({ doc, evaluated, result, summary, run }: SiteHeaderProps) {
  const computing = run.phase === "running";
  const known = summary && summary.overall !== "unknown";
  const head = known && !run.stale ? verdictHeadline(summary.overall, summary.outcomes, { batteryEveryHeading: summary.batteryEveryHeading, batteryWorst: summary.batteryWorst }) : null;
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
      {!run.stale && <Notes doc={doc} result={result} />}
    </>
  );
}
