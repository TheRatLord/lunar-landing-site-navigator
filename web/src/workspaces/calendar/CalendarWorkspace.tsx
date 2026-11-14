import { useEffect, useMemo, useState } from "react";
import { PLANNING_ENDPOINTS, scanBody, type ScanParams, type ScanResult, type ScanWindow, type TerrainMode } from "../../api/planning";
import { useAnalysis } from "../../api/useAnalysis";
import { useReportPlanning } from "../../api/report";
import { AnalysisStatus } from "../../components/AnalysisStatus";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { DateTimeInput, Select } from "../../components/ui/Fields";
import { Icon } from "../../components/ui/Icon";
import { PageHeader } from "../../components/ui/PageHeader";
import { Popover } from "../../components/ui/Popover";
import { Spinner } from "../../components/ui/Progress";
import { LimitsChip } from "../site/LimitsChip";
import { LunationCalendar } from "../../components/viz/LunationCalendar";
import { MS_DAY, MS_HOUR, parseUtc, roundToSecond, toIsoUtc, utcText } from "../../lib/time";
import { routeStackIssues, useScenario } from "../../scenario/store";
import { toast } from "../../state/toasts";
import "../../styles/calendar.css";
import { usePublishScreenContext } from "../../ask/screenContext";
import { ReportButton } from "../ReportButton";
import { TerrainStackTag } from "../search/TerrainStackTag";
import { ScanStats, SelectedEpoch, WindowList } from "./ScanPanels";
import { bestCandidateIn, calendarSlots, lunationsOf } from "./adapt";

const SPACINGS = [
  { value: "3600", label: "1 h" },
  { value: "10800", label: "3 h" },
  { value: "21600", label: "6 h" },
];
const TERRAIN: Array<{ value: TerrainMode; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "on", label: "Terrain" },
  { value: "off", label: "Smooth sphere" },
];

export function CalendarWorkspace() {
  const doc = useScenario((s) => s.doc)!;
  const session = useScenario((s) => s.session);
  return (
    <div className="cal" aria-label="Dates page">
      <h1 className="sr-only">Dates: {doc.name}</h1>
      <Opportunities key={session} />
    </div>
  );
}

function Opportunities() {
  const doc = useScenario((s) => s.doc)!;
  const edit = useScenario((s) => s.edit);
  const landingMs = parseUtc(doc.landing_utc);

  const [startMs, setStartMs] = useState(() => (landingMs ?? Date.UTC(2027, 0, 1)) - 30 * MS_DAY);
  const [endMs, setEndMs] = useState(() => (landingMs ?? Date.UTC(2027, 0, 1)) + 335 * MS_DAY);
  const [spacing, setSpacing] = useState("3600");
  const [terrain, setTerrain] = useState<TerrainMode>("auto");
  const [submitted, setSubmitted] = useState<ScanParams>({ start_utc: toIsoUtc(startMs), end_utc: toIsoUtc(endMs), spacing_s: 3600 });
  const [pickedMs, setPickedMs] = useState<number | null>(null);

  const rangeOk = endMs > startMs;
  const dirty = toIsoUtc(startMs) !== submitted.start_utc || toIsoUtc(endMs) !== submitted.end_utc || Number(spacing) !== submitted.spacing_s;

  const body = useMemo(() => scanBody({ ...doc, landing_utc: submitted.start_utc }, submitted, terrain), [doc, submitted, terrain]);
  const analysis = useAnalysis<ScanResult>(PLANNING_ENDPOINTS.scan, body, { debounceMs: 400 });
  const scan = analysis.result;
  useEffect(() => routeStackIssues(analysis.error), [analysis.error]);
  const setReportScan = useReportPlanning((s) => s.setScan);
  useEffect(() => {
    if (scan) setReportScan(submitted, terrain);
  }, [scan, submitted, terrain, setReportScan]);

  usePublishScreenContext({
    where: "Dates",
    summary: "",
    lines: [
      `The candidate landing times run from ${toIsoUtc(startMs)} to ${toIsoUtc(endMs)}, spaced ${SPACINGS.find((o) => o.value === spacing)?.label ?? `${spacing} s`} apart.`,
      `Horizon model: ${TERRAIN.find((o) => o.value === terrain)?.label ?? terrain}.`,
    ],
  });

  const slots = useMemo(() => (scan ? calendarSlots(scan) : []), [scan]);
  const lunations = useMemo(() => (scan ? lunationsOf(scan) : []), [scan]);

  const selectedMs = pickedMs ?? landingMs;
  const select = (slotMs: number) => {
    if (!scan) return;
    const i = bestCandidateIn(scan, slotMs, slotMs + scan.calendar.bin_h * MS_HOUR);
    setPickedMs(i >= 0 ? scan.candidates.t_ms[i]! : slotMs);
  };
  const setLanding = (ms: number) => {
    const rounded = roundToSecond(ms);
    edit(["landing_utc"], toIsoUtc(rounded));
    setPickedMs(null);
    toast({ kind: "success", title: "Landing set", detail: utcText(rounded) });
  };
  const selectWindow = (w: ScanWindow) => {
    const ms = parseUtc(w.best_utc);
    if (ms !== null) setPickedMs(ms);
  };
  const runScan = () => {
    if (rangeOk) setSubmitted({ start_utc: toIsoUtc(startMs), end_utc: toIsoUtc(endMs), spacing_s: Number(spacing) });
  };

  const failed = analysis.phase === "error";
  const status = <AnalysisStatus state={analysis} what="the landing-date scan" />;
  const exportBody = { scenario: body.scenario, terrain, scan: submitted };

  return (
    <>
      <form
        className="cal-form"
        onSubmit={(e) => {
          e.preventDefault();
          runScan();
        }}
      >
        <PageHeader
          actions={
            <>
              {!failed && status}
              {scan?.provider !== undefined && terrain === "auto" && <span className="chip">{scan.provider === "terrain" ? "Terrain" : "Smooth sphere"}</span>}
              {scan && <TerrainStackTag stack={scan.terrain_stack} />}
              {scan && scan.warnings.length > 0 && (
                <Popover
                  label={`${scan.warnings.length} ${scan.warnings.length === 1 ? "warning" : "warnings"}`}
                  icon="alert"
                  tone="marginal"
                  align="end"
                >
                  <ul className="cal-warnings">
                    {scan.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </Popover>
              )}
              {scan && <LimitsChip limits={scan.limits} stale={analysis.stale} align="end" />}
              <ReportButton
                exports={
                  scan
                    ? [
                        { kind: "calendar-csv", label: "Calendar CSV", body: exportBody },
                        { kind: "opportunities-csv", label: "Windows CSV", body: exportBody },
                      ]
                    : []
                }
              />
              <Button type="submit" size="sm" variant={dirty ? "primary" : "default"} icon="play" disabled={!rangeOk || !dirty}>
                Scan dates
              </Button>
            </>
          }
        >
          <div className={`cal-range ${rangeOk ? "" : "is-bad"}`} role="group" aria-label="Candidate range">
            <DateTimeInput compact label="First candidate (UTC)" value={startMs} onChange={setStartMs} />
            <Icon name="chevronRight" size={12} />
            <DateTimeInput compact label="Last candidate (UTC)" value={endMs} onChange={setEndMs} />
            {!rangeOk && <span className="sr-only" role="alert">The last candidate must come after the first.</span>}
          </div>
          <Select className="cal-select" aria-label="Candidate spacing" value={spacing} options={SPACINGS} onChange={setSpacing} />
          <Select className="cal-select" aria-label="Horizon model" value={terrain} options={TERRAIN} onChange={(v) => setTerrain(v as TerrainMode)} />
        </PageHeader>
      </form>

      {failed && <div className="cal-fail">{status}</div>}

      {scan && (
        <div className={`cal-body ${analysis.stale ? "is-stale" : ""}`}>
          <div className="cal-main">
            <ScanStats scan={scan} />
            <div className="cal-cal">
              <LunationCalendar
                slots={slots}
                epochMs={lunations[0]?.start_ms ?? startMs}
                lunations={lunations}
                slotMs={scan.calendar.bin_h * MS_HOUR}
                selectedMs={selectedMs}
                onSelect={select}
                title="Lunations"
              />
            </div>
          </div>
          <aside className="cal-rail">
            <SelectedEpoch
              scan={scan}
              selectedMs={selectedMs}
              landingMs={landingMs}
              onSetLanding={setLanding}
              doc={doc}
              terrain={terrain}
              current={!analysis.stale && analysis.phase === "done"}
            />
            <WindowList scan={scan} selectedMs={selectedMs} onSelect={selectWindow} />
          </aside>
        </div>
      )}
      {!scan && analysis.phase === "running" && (
        <div className="cal-wait" role="status">
          <Spinner />
        </div>
      )}
      {!scan && analysis.phase === "idle" && (
        <EmptyState
          icon="calendar"
          title="Not scanned yet"
          action={
            <Button icon="play" onClick={runScan} disabled={!rangeOk}>
              Scan dates
            </Button>
          }
        />
      )}
    </>
  );
}
