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
import { verdictHeadline } from "../../lib/requirements";
import { siteLabel } from "../../lib/siteName";
import { parseUtc } from "../../lib/time";
import { hoursOrDays, whenText } from "../../scenario/when";
import { batteryRisk, type VerdictSummary } from "./adapt";
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
          {!battery.depends
            ? "Battery can run flat (not a requirement)"
            : battery.everyHeading
              ? "Battery runs flat at every heading (not a requirement)"
              : `Battery runs flat at some headings (not a requirement), lowest ${Math.round(battery.low * 100)}–${Math.round((battery.high ?? battery.low) * 100)} %`}
          <Button size="sm" variant="ghost" onClick={addBattery}>
            Add as requirement
          </Button>
        </span>
      )}
      {share !== null && (
        <Link to="/site/ellipse" className="vs-note vs-note-link">
          {Math.round(share * 100)}% of the landing area passes
        </Link>
      )}
    </div>
  );
}

export function SiteHeader({ doc, evaluated, result, summary, run }: SiteHeaderProps) {
  const computing = run.phase === "running";
  const known = summary && summary.overall !== "unknown";
  const head = known && !run.stale ? verdictHeadline(summary.overall, summary.outcomes, { batteryEveryHeading: summary.batteryEveryHeading, batteryWorst: summary.batteryWorst }) : null;
  const landing = parseUtc(doc.landing_utc);
  return (
    <>
      <PageHeader
        tabs={<SiteTabs />}
        actions={
          <>
            {run.phase === "running" && !run.stale && <AnalysisStatus state={run} what="the site evaluation" />}
            {result && <Assumptions scenario={evaluated} result={result} />}
            <DownloadMenu scenario={doc} />
          </>
        }
      />
      <section className="site-verdict" aria-live="polite">
        <p className="site-eyebrow">
          {siteLabel(doc.site.name) || "Unnamed site"}
          {landing !== null && ` · ${whenText(landing)}`} · {hoursOrDays(doc.mission_duration_h)} on the surface
        </p>
        {head ? (
          <>
            <p className="site-headline">
              <strong className="verdict-word" data-tone={summary?.overall}>
                {head.word}.
              </strong>
              {head.lead && ` ${head.lead}.`}
            </p>
            {head.note && <p className="site-headline-note">{head.note}</p>}
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
