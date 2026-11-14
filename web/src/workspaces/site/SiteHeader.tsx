import { useMemo } from "react";
import type { EvaluateResult, Observer } from "../../api/site";
import type { AnalysisControls, AnalysisState } from "../../api/useAnalysis";
import { AnalysisStatus } from "../../components/AnalysisStatus";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { PageHeader } from "../../components/ui/PageHeader";
import { Popover } from "../../components/ui/Popover";
import { VerdictChip } from "../../components/ui/VerdictChip";
import { formatSignedValue } from "../../lib/format";
import { useScenario } from "../../scenario/store";
import type { Scenario } from "../../scenario/types";
import { ReportButton } from "../ReportButton";
import { defaultStackIds, nearFieldSeams, seamWarnings, stackWithout, type VerdictSummary } from "./adapt";
import { ExportMenu } from "./ExportMenu";
import { LimitsChip } from "./LimitsChip";
import { EstimatesChip, ProvenancePopover } from "./Provenance";
import { SiteTabs } from "./SiteTabs";
import { useTerrainStores } from "./useTerrainStores";

interface SiteHeaderProps {
  doc: Scenario;
  evaluated: Scenario | null;
  result: EvaluateResult | null;
  summary: VerdictSummary | null;
  run: AnalysisState<EvaluateResult> & AnalysisControls;
  published: Set<string> | null;
  observer: Observer;
}

function Seam({ result, stale }: { result: EvaluateResult; stale: boolean }) {
  const warnings = useMemo(() => seamWarnings(result.warnings), [result.warnings]);
  const seams = useMemo(() => nearFieldSeams(result.provenance), [result.provenance]);
  const stores = useTerrainStores();
  const defaultIds = useMemo(() => defaultStackIds(stores), [stores]);
  const edit = useScenario((s) => s.edit);
  if (warnings.length === 0 || stale) return null;
  return (
    <Popover label="Terrain seam" icon="warn" tone="marginal" align="end" width={420}>
      <div className="stack">
        <ul className="prov-warn" aria-label="Seam warnings">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
        {seams.map((s) => {
          const without = stackWithout(s.otherStore, result.terrain_stack, defaultIds);
          return (
            <Button key={s.otherStore} size="sm" disabled={without === null} onClick={() => without && edit(["terrain_stores"], without)}>
              Evaluate without {s.otherStore}
            </Button>
          );
        })}
      </div>
    </Popover>
  );
}

function Counts({ summary }: { summary: VerdictSummary }) {
  const c = summary.counts;
  return (
    <span className="vs-counts num" aria-label={`${c.pass} pass, ${c.marginal} marginal, ${c.fail} fail, ${c.unevaluated} not evaluated`}>
      <span className="vs-count vs-count-pass">
        <Icon name="check" size={12} strokeWidth={2} />
        {c.pass}
      </span>
      <span className="vs-count vs-count-marginal">
        <Icon name="warn" size={12} strokeWidth={2} />
        {c.marginal}
      </span>
      <span className="vs-count vs-count-fail">
        <Icon name="cross" size={12} strokeWidth={2} />
        {c.fail}
      </span>
      {c.unevaluated > 0 && <span className="vs-count faint">? {c.unevaluated}</span>}
    </span>
  );
}

export function SiteHeader({ doc, evaluated, result, summary, run, published, observer }: SiteHeaderProps) {
  const lim = summary?.limiting ?? null;
  const d = lim?.decimals ?? 2;
  const computing = run.phase === "running";
  const known = summary && summary.overall !== "unknown";

  const stale = run.stale;
  return (
    <PageHeader
      tabs={<SiteTabs />}
      actions={
        <>
          {run.phase !== "error" && <AnalysisStatus state={run} what="the site evaluation" />}
          {result && (
            <>
              <Seam result={result} stale={stale} />
              <EstimatesChip scenario={evaluated} />
              <LimitsChip limits={result.limits} stale={stale} align="end" />
              <ProvenancePopover scenario={evaluated} result={result} />
            </>
          )}
          <ExportMenu scenario={doc} published={published} observer={observer} />
          <ReportButton />
        </>
      }
    >
      {known ? (
        <VerdictChip verdict={summary.overall as Exclude<VerdictSummary["overall"], "unknown">} />
      ) : (
        <span className="chip chip-unknown">
          <Icon name="warn" size={12} strokeWidth={2} />
          <span className="chip-label">{computing ? "Computing" : "Not evaluated"}</span>
        </span>
      )}
      {lim && (
        <span className="vs-limiting">
          <strong className="vs-name">{lim.label}</strong>
          {lim.heading_dependent ? (
            <span className="chip chip-unknown">Depends on heading</span>
          ) : (
            <span className={`num vs-margin vs-margin-${lim.verdict}`}>{formatSignedValue(lim.margin, lim.unit, d)}</span>
          )}
          {lim.margin_worst !== undefined && (
            <span className="num faint vs-worst" aria-label="Worst-case margin">
              worst {formatSignedValue(lim.margin_worst, lim.unit, d)}
            </span>
          )}
        </span>
      )}
      {summary && <Counts summary={summary} />}
    </PageHeader>
  );
}
