import { useEffect, useMemo, useRef, useState } from "react";
import { reportError } from "../api/client";
import { requestPlanningExport, type PlanningExport } from "../api/planning";
import {
  ReportNotConnected,
  ReportRejected,
  alternativeRefs,
  reportBody,
  requestReport,
  useReportPlanning,
  useReportSurveys,
  SURVEYS,
  surveyAvailability,
  type ReportFormat,
  type ReportInputs,
  type SurveyKind,
} from "../api/report";
import { Button, IconButton } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { Menu, type MenuItem } from "../components/ui/Menu";
import { Spinner } from "../components/ui/Progress";
import { downloadBlob } from "../lib/download";
import { useAlternatives } from "../scenario/alternatives";
import { useScenario } from "../scenario/store";
import { searchPinsCurrent, useSearchResults } from "./search/results";
import { toast } from "../state/toasts";
import { useExportItems } from "./useExportItems";
import "../styles/report.css";

const FORMATS: Array<{ format: ReportFormat; label: string }> = [
  { format: "html", label: "HTML" },
  { format: "pdf", label: "PDF" },
];

/** `exports`: page exports (CSV and the like) listed in the same menu, ahead of the report entries. */
export function ReportButton({ exports = [] }: { exports?: Array<{ kind: PlanningExport; label: string; body: Record<string, unknown> }> }) {
  const doc = useScenario((s) => s.doc);
  const alternatives = useAlternatives((s) => s.items);
  const scan = useReportPlanning((s) => s.scan);
  const slip = useReportPlanning((s) => s.slip);
  const ellipse = useReportSurveys((s) => s.ellipse);
  const search = useReportSurveys((s) => s.search);
  const searchCandidates = useSearchResults((s) => s.candidates);
  const searchScenarioKey = useSearchResults((s) => s.scenarioKey);
  const searchStale = useSearchResults((s) => s.stale);
  const [switchedOff, setSwitchedOff] = useState<Record<SurveyKind, boolean>>({ ellipse: false, search: false });

  const [busy, setBusy] = useState<ReportFormat | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const exportItems = useExportItems(exports, (item) => requestPlanningExport(item.kind, item.body));
  const merged = exports.length > 0;

  const planned = useMemo(() => {
    if (!doc) return null;
    const alts = alternativeRefs(doc, alternatives);
    const terrain = scan?.terrain ?? "auto";
    const searchCurrent = searchPinsCurrent({ candidates: searchCandidates, scenarioKey: searchScenarioKey, stale: searchStale }, doc);
    const availability = {
      ellipse: surveyAvailability("ellipse", ellipse, doc, terrain),
      search: surveyAvailability("search", search && { ...search, stale: search.stale || !searchCurrent }, doc, terrain),
    };
    const offered: SurveyKind[] = [];
    const skipped: Array<{ kind: string; text: string }> = [];
    for (const kind of ["ellipse", "search"] as const) {
      const a = availability[kind];
      if (a.ok) offered.push(kind);
      else skipped.push({ kind, text: a.neverRun ? `${SURVEYS[kind].label}: not computed` : a.reason });
    }
    if (alts.omitted > 0) skipped.push({ kind: "omitted", text: `${alts.omitted} further Compare ${alts.omitted === 1 ? "option" : "options"} left out` });
    const take = (kind: SurveyKind) => {
      const a = availability[kind];
      return a.ok && !switchedOff[kind] ? a.params : null;
    };
    const inputs: ReportInputs = {
      ref: { scenario: doc },
      terrain,
      scan: scan?.params,
      slip,
      compareWith: alts.refs,
      ellipse: take("ellipse"),
      search: take("search"),
    };
    return { inputs, offered, skipped };
  }, [doc, alternatives, scan, slip, ellipse, search, searchCandidates, searchScenarioKey, searchStale, switchedOff]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const run = async (format: ReportFormat) => {
    if (!planned) return;
    const label = FORMATS.find((f) => f.format === format)!.label;
    const ctl = new AbortController();
    abortRef.current = ctl;
    setMessage(null);
    setStage(null);
    setBusy(format);
    try {
      const file = await requestReport(reportBody(planned.inputs, format), {
        signal: ctl.signal,
        onStatus: (s) => setStage(s.stage ?? s.state),
      });
      downloadBlob(file.filename, file.blob);
      toast({
        kind: "success",
        title: `Report downloaded (${label})`,
        detail: file.filename + (file.sha256 ? ` · sha256 ${file.sha256.slice(0, 12)}…` : ""),
      });
    } catch (e) {
      if (e instanceof ReportNotConnected) setMessage(e.message);
      else if (e instanceof ReportRejected) setMessage(`The engine could not build the report: ${e.message}${e.requestId ? ` (request ${e.requestId})` : ""}`);
      else reportError(e, `Could not build the report (${label})`);
    } finally {
      if (abortRef.current === ctl) abortRef.current = null;
      setBusy(null);
      setStage(null);
    }
  };

  const items: MenuItem[] = [
    ...exportItems,
    ...FORMATS.map((f, i) => ({
      id: `report-${f.format}`,
      label: merged ? `Download report (${f.label})` : `Download ${f.label}`,
      icon: "download" as const,
      disabled: !planned,
      divider: merged && i === 0,
      onSelect: () => void run(f.format),
    })),
    ...(planned?.offered ?? []).map((kind, j) => ({
      id: `survey-${kind}`,
      label: SURVEYS[kind].label,
      checked: !switchedOff[kind],
      divider: j === 0,
      keepOpen: true,
      onSelect: () => setSwitchedOff((s) => ({ ...s, [kind]: !s[kind] })),
    })),
  ];

  const footer =
    planned && planned.skipped.length > 0 ? (
      <ul className="rp-status" aria-label="Left out of the report">
        {planned.skipped.map((s) => (
          <li key={s.kind}>
            <Icon name="warn" size={12} />
            <span>{s.text}</span>
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <div className="rp">
      {busy ? (
        <Button size="sm" variant="ghost" aria-busy autoFocus onClick={() => abortRef.current?.abort()}>
          <Spinner size={12} />
          Cancel
        </Button>
      ) : (
        <Menu
          label={merged ? "Export" : "Report"}
          icon={merged ? "download" : "file"}
          align="end"
          width={240}
          items={items}
          footer={footer}
          disabled={items.every((it) => it.disabled)}
        />
      )}
      {busy && stage && (
        <span className="rp-stage" role="status">
          {stage}
        </span>
      )}
      {message && (
        <p className="rp-msg" role="alert">
          <Icon name="warn" size={12} />
          <span>{message}</span>
          <IconButton icon="close" label="Dismiss" size="sm" onClick={() => setMessage(null)} />
        </p>
      )}
    </div>
  );
}
