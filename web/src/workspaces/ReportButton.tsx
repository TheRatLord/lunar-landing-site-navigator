import { useEffect, useMemo, useRef, useState } from "react";
import { reportError } from "../api/client";
import { ReportNotConnected, ReportRejected, alternativeRefs, reportBody, requestReport, useReportPlanning, useReportSurveys, surveyAvailability, type ReportFormat, type ReportInputs } from "../api/report";
import { requestExport, type ExportKind } from "../api/site";
import { stageText } from "../components/AnalysisStatus";
import { Button, IconButton } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { Menu, type MenuItem } from "../components/ui/Menu";
import { Spinner } from "../components/ui/Progress";
import { downloadBlob } from "../lib/download";
import { useAlternatives } from "../scenario/alternatives";
import { useScenario } from "../scenario/store";
import type { Scenario } from "../scenario/types";
import { useExportItems } from "./useExportItems";
import "../styles/report.css";

const FORMATS: Array<{ format: ReportFormat; label: string }> = [
  { format: "pdf", label: "Report (PDF)" },
  { format: "html", label: "Report (HTML)" },
];

const SITE_FILES: Array<{ kind: ExportKind; label: string }> = [
  { kind: "aem", label: "Antenna horizon mask (STK AEM)" },
  { kind: "timeseries-csv", label: "Time series (CSV)" },
  { kind: "intervals-csv", label: "Intervals (CSV)" },
  { kind: "metrics-csv", label: "Metrics (CSV)" },
  { kind: "bundle", label: "All files (ZIP)" },
];

function fileSlug(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "plan";
}

function useReport() {
  const doc = useScenario((s) => s.doc);
  const alternatives = useAlternatives((s) => s.items);
  const scan = useReportPlanning((s) => s.scan);
  const slip = useReportPlanning((s) => s.slip);
  const ellipse = useReportSurveys((s) => s.ellipse);
  const search = useReportSurveys((s) => s.search);
  const [busy, setBusy] = useState<ReportFormat | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const inputs = useMemo<ReportInputs | null>(() => {
    if (!doc) return null;
    const terrain = scan?.terrain ?? "auto";
    const take = (kind: "ellipse" | "search", published: typeof ellipse | typeof search) => {
      const a = surveyAvailability(kind, published, doc, terrain);
      return a.ok ? a.params : null;
    };
    return { ref: { scenario: doc }, terrain, scan: scan?.params, slip, compareWith: alternativeRefs(doc, alternatives).refs, ellipse: take("ellipse", ellipse), search: take("search", search) };
  }, [doc, alternatives, scan, slip, ellipse, search]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const run = async (format: ReportFormat) => {
    if (!inputs) return;
    const ctl = new AbortController();
    abortRef.current = ctl;
    setMessage(null);
    setStage(null);
    setBusy(format);
    try {
      const file = await requestReport(reportBody(inputs, format), { signal: ctl.signal, onStatus: (s) => setStage(s.stage ?? null) });
      downloadBlob(file.filename, file.blob);
    } catch (e) {
      if (e instanceof ReportNotConnected || e instanceof ReportRejected) setMessage("Could not build the report");
      else reportError(e, "Could not build the report");
    } finally {
      if (abortRef.current === ctl) abortRef.current = null;
      setBusy(null);
      setStage(null);
    }
  };

  return { ready: inputs !== null, busy, stage, message, clearMessage: () => setMessage(null), cancel: () => abortRef.current?.abort(), run };
}

function Shell({ report, items, label }: { report: ReturnType<typeof useReport>; items: MenuItem[]; label: string }) {
  return (
    <div className="rp">
      {report.busy ? (
        <Button size="sm" variant="ghost" aria-busy autoFocus onClick={report.cancel}>
          <Spinner size={12} />
          {report.stage ? stageText(report.stage) : "Building report"}
          <span className="faint">Cancel</span>
        </Button>
      ) : (
        <Menu label={label} icon="download" align="end" width={280} items={items} disabled={items.every((it) => it.disabled)} />
      )}
      {report.message && (
        <p className="rp-msg" role="alert">
          <Icon name="warn" size={12} />
          <span>{report.message}</span>
          <IconButton icon="close" label="Dismiss" size="sm" onClick={report.clearMessage} />
        </p>
      )}
    </div>
  );
}

export function DownloadMenu({ scenario }: { scenario: Scenario }) {
  const report = useReport();
  const files = useExportItems(SITE_FILES, (item) => requestExport(item.kind, scenario, "auto", { aem_horizon: "antenna" }));
  const items: MenuItem[] = [
    ...FORMATS.map((f) => ({ id: `report-${f.format}`, label: f.label, icon: "file" as const, disabled: !report.ready, onSelect: () => void report.run(f.format) })),
    {
      id: "plan",
      label: "Plan file (JSON)",
      icon: "download",
      divider: true,
      onSelect: () => downloadBlob(`${fileSlug(scenario.name)}.plan.json`, new Blob([JSON.stringify(scenario, null, 2)], { type: "application/json" })),
    },
    ...files,
  ];
  return <Shell report={report} items={items} label="Download" />;
}
