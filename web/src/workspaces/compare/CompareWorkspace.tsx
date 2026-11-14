import { useEffect, useMemo, useState } from "react";
import type { AnalysisState } from "../../api/useAnalysis";
import { isAbort } from "../../api/client";
import {
  PLANNING_ENDPOINTS,
  slipBody,
  type CompareResult,
  type SlipParams,
  type SlipResult,
} from "../../api/planning";
import { useReportPlanning } from "../../api/report";
import { useAnalysis } from "../../api/useAnalysis";
import { usePublishScreenContext } from "../../ask/screenContext";
import { AnalysisStatus, OutOfDate } from "../../components/AnalysisStatus";
import { WorkspaceBoundary } from "../../components/WorkspaceBoundary";
import { Button } from "../../components/ui/Button";
import { Disclosure } from "../../components/ui/Disclosure";
import { EmptyState } from "../../components/ui/EmptyState";
import { Toggle } from "../../components/ui/Fields";
import { PageHeader } from "../../components/ui/PageHeader";
import { Popover } from "../../components/ui/Popover";
import { formatLat, formatLon } from "../../lib/coords";
import { MS_HOUR, parseUtc } from "../../lib/time";
import { useAlternatives } from "../../scenario/alternatives";
import { scenarioApi } from "../../scenario/api";
import { useEditorUi } from "../../scenario/editor/editorUi";
import { routeStackIssues, useScenario } from "../../scenario/store";
import { stackMismatch } from "../../scenario/terrainStack";
import type { Scenario, ScenarioSummary } from "../../scenario/types";
import "../../styles/compare.css";
import { ReportButton } from "../ReportButton";
import { LimitsChip } from "../site/LimitsChip";
import { TerrainStackTag } from "../search/TerrainStackTag";
import { delayLabels, parseSearchDays } from "./delays";
import { Grid, type GridSite } from "./Grid";
import { gridRows, requestedSites, type SiteRef } from "./grid";
import { InputStrip } from "./InputStrip";
import { canTick, compareEntries, compareRequest, pinName, selectScenarios, shortlistRows, tickedPins, type ShortlistContext } from "./items";
import { Matrix } from "./Matrix";
import { matrixHeadingDependent } from "./matrixDiff";
import { BASELINE_SITE, MAX_DETAIL, pinKey, useCompareOptions } from "./options";
import { Shortlist } from "./Shortlist";
import { SiteDelays } from "./SiteDelays";
import { stackKey, useStoredStacks } from "./useStoredStacks";

interface Submitted {
  doc: Scenario;
  params: SlipParams;
  requested: SiteRef[];
  key: string;
}

export function CompareWorkspace() {
  return (
    <WorkspaceBoundary workspace="Compare" usesDraft>
      <Compare />
    </WorkspaceBoundary>
  );
}

function OpenSignal({ onChange }: { onChange: (open: boolean) => void }) {
  useEffect(() => {
    onChange(true);
    return () => onChange(false);
  }, [onChange]);
  return null;
}

function Compare() {
  const doc = useScenario((s) => s.doc)!;
  const savedId = useScenario((s) => s.saved?.id ?? null);
  const showEditor = useEditorUi((s) => s.show);
  const alternatives = useAlternatives((s) => s.items);
  const { slips_h, mode, search_days, pins, togglePin, pin, unpin, clearPins } = useCompareOptions();

  const [stored, setStored] = useState<ScenarioSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    void scenarioApi.list({ limit: 100 }, { signal: ctl.signal }).then(
      (p) => {
        setStored(p.items);
        setListError(null);
      },
      (e: unknown) => {
        if (!isAbort(e)) setListError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => ctl.abort();
  }, [reload, savedId]);

  const params = useMemo<SlipParams>(
    () => ({
      slips_h,
      mode,
      search_days,
      spacing_s: 3600,
      alternative_sites: alternatives.filter((a) => a.catalog_id !== null).map((a) => a.catalog_id!),
      alternative_coordinates: alternatives.filter((a) => a.catalog_id === null).map(({ name, lat_deg, lon_deg }) => ({ name, lat_deg, lon_deg })),
    }),
    [slips_h, mode, search_days, alternatives],
  );
  const currentKey = useMemo(() => JSON.stringify([doc, params]), [doc, params]);
  const requested = useMemo(() => requestedSites(doc, alternatives), [doc, alternatives]);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const slipRequest = useMemo(() => (submitted ? slipBody(submitted.doc, submitted.params, "auto") : null), [submitted]);
  const slip = useAnalysis<SlipResult>(PLANNING_ENDPOINTS.slip, slipRequest, { debounceMs: 0 });
  const shownSlip = useShown(slip, submitted);
  const slipDone = shownSlip?.request ? { result: shownSlip.result, request: shownSlip.request } : null;
  useEffect(() => routeStackIssues(slip.error), [slip.error]);
  const setReportSlip = useReportPlanning((s) => s.setSlip);
  useEffect(() => {
    if (slipDone) setReportSlip(slipDone.request.params);
  }, [slipDone?.request, slipDone?.result, setReportSlip]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = () => {
    if (submitted?.key === currentKey) slip.rerun();
    else setSubmitted({ doc, params, requested, key: currentKey });
  };
  const slipOutOfDate = slipDone !== null && (slip.stale || slipDone.request.key !== currentKey);

  const rows = useMemo(() => (slipDone ? gridRows(slipDone.result, slipDone.request.requested) : []), [slipDone?.result, slipDone?.request]); // eslint-disable-line react-hooks/exhaustive-deps
  const [openSite, setOpenSite] = useState<number | null>(null);
  const detailIndex = openSite !== null && openSite < rows.length ? openSite : null;

  const ctx: ShortlistContext = {
    doc: slipDone?.request.doc ?? doc,
    alternatives,
    stored: stored ?? [],
    slip: slipDone?.result ?? null,
    keys: rows.map((r) => r.key),
  };
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const tickedList = tickedPins(pins, ticked, ctx);
  const tickedKeys = new Set(tickedList.map(pinKey));
  const [detailOpen, setDetailOpen] = useState(false);
  const [differencesOnly, setDifferencesOnly] = useState(false);

  const entries = compareEntries(pins, detailOpen ? tickedKeys : new Set(), ctx);
  const savedPins = pins.flatMap((p) => (p.kind === "saved" ? [p.scenario_id] : []));
  const { stacks, reset: resetStacks } = useStoredStacks(
    savedPins.map((id) => ({ id, version: stored?.find((s) => s.id === id)?.updated_utc ?? "" })),
  );
  const stackAt = (id: string) => stackKey({ id, version: stored?.find((x) => x.id === id)?.updated_utc ?? "" });
  const stacksPending = entries.some((e) => e.pin?.kind === "saved" && !(stackAt(e.pin.scenario_id) in stacks));
  const mismatch = stackMismatch(
    entries.flatMap((e) => {
      if (e.pin?.kind !== "saved") return [{ name: e.name, stores: ctx.doc?.terrain_stores }];
      const s = stacks[stackAt(e.pin.scenario_id)];
      return s === undefined || s === "unread" ? [] : [{ name: e.name, stores: s }];
    }),
  );
  const compareBodyOrNull = mismatch !== null || stacksPending ? null : compareRequest(entries);
  const compare = useAnalysis<CompareResult>(PLANNING_ENDPOINTS.compare, compareBodyOrNull, { debounceMs: 100 });
  const shownCompare = useShown(compare, entries);
  const rowsShort = shortlistRows(pins, ctx, {
    entries: shownCompare?.request ?? [],
    result: shownCompare?.result ?? null,
    problem: compare.phase === "error" && compare.error ? compare.error.message : mismatch ? "Different terrain stacks" : null,
  });

  const tick = (key: string) => {
    const next = new Set(tickedKeys);
    if (next.has(key)) next.delete(key);
    else if (next.size < MAX_DETAIL) next.add(key);
    setTicked(next);
  };

  const shownEntries = shownCompare?.request ?? [];
  const at = tickedList.map((p) => shownEntries.findIndex((e) => e.pin !== null && pinKey(e.pin) === pinKey(p)));
  const matrix = shownCompare && tickedList.length >= 2 && at.every((i) => i >= 0) ? selectScenarios(shownCompare.result, at) : null;
  const matrixItems = at.every((i) => i >= 0) ? at.map((i) => shownEntries[i]!.item) : [];
  const stepNote = matrix && slipDone ? delayStepNote(slipDone.result.limits, shownCompare!.result.limits) : null;

  const slipExport = useMemo(() => {
    if (!slipDone) return [];
    const sb = slipBody(slipDone.request.doc, slipDone.request.params, "auto");
    return [{ kind: "slip-csv" as const, label: "Delay CSV", body: { scenario: sb.scenario, terrain: "auto", slip: slipDone.request.params } }];
  }, [slipDone?.request]); // eslint-disable-line react-hooks/exhaustive-deps
  const matrixExport =
    matrix && matrixItems.length >= 2
      ? [{ kind: "comparison-csv" as const, label: "Comparison CSV", body: { ...matrixItems[0]!, compare_with: matrixItems.slice(1), terrain: "auto" } }]
      : [];

  const pinned = pins.map((p) => pinName(p, { doc, alternatives, stored: stored ?? [] }));
  const place = (s: { name: string; lat_deg: number; lon_deg: number }) => `${s.name || "unnamed site"} (${formatLat(s.lat_deg, 3)}, ${formatLon(s.lon_deg, 3)})`;
  const siteCount = 1 + alternatives.length;
  usePublishScreenContext({
    where: "Compare",
    summary: `${siteCount} site${siteCount === 1 ? "" : "s"} × ${slips_h.length} date${slips_h.length === 1 ? "" : "s"}, ${pinned.length} pinned`,
    lines: [
      `Plan site: ${place(doc.site)}.`,
      alternatives.length > 0 ? `Alternative sites: ${alternatives.map(place).join("; ")}.` : "No alternative sites are added.",
      `Dates, as delays of the planned landing: ${delayLabels(slips_h).join(", ")}.`,
      `The delay applies to the ${mode === "launch" ? "launch, through the transfer" : "landing date"}; the next open date is looked for ${search_days} days ahead.`,
      pinned.length > 0 ? `Shortlisted options: ${pinned.join("; ")}.` : "Nothing is shortlisted.",
    ],
  });

  const [daysText, setDaysText] = useState(String(search_days));
  const daysOk = parseSearchDays(daysText) !== null;
  const noTransfer = mode === "launch" && doc.transfer == null;
  const blocked = noTransfer || !daysOk;
  const running = slip.phase === "running";
  const slipFailed = slip.phase === "error" && slip.error !== null;

  const planned = parseUtc(doc.landing_utc);
  const gridSites: GridSite[] = slipDone
    ? rows.map((r) => ({ key: r.key, name: r.name, lat_deg: r.site.site.lat_deg, lon_deg: r.site.site.lon_deg, planned: r.key === BASELINE_SITE, site: r.site }))
    : requested.map((r) => ({ key: r.key, name: r.name, lat_deg: r.lat_deg, lon_deg: r.lon_deg, planned: r.key === BASELINE_SITE, site: null }));
  const landingAt = (h: number): string | null =>
    slipDone
      ? (rows.flatMap((r) => r.site.rows).find((x) => x.slip_h === h)?.landing_utc ?? null)
      : mode === "landing" && planned !== null
        ? new Date(planned + h * MS_HOUR).toISOString()
        : null;

  const csvItems = [...slipExport, ...matrixExport];
  const optionTotal = requested.length * slips_h.length;
  const retryList = () => {
    resetStacks();
    setReload((n) => n + 1);
  };

  const header = (
    <PageHeader
      actions={
        <>
          {slipOutOfDate && !slip.stale && slip.phase === "done" ? (
            <OutOfDate state={{ ...slip, stale: true, rerun: run }} />
          ) : (
            slipRequest !== null && !slipFailed && <AnalysisStatus state={slip} what="the delay analysis" />
          )}
          {slipDone && <TerrainStackTag stack={slipDone.result.terrain_stack} />}
          {slipDone && <LimitsChip limits={slipDone.result.limits} stale={slipOutOfDate} align="end" />}
          <ReportButton exports={csvItems} />
          {noTransfer && (
            <Button size="sm" variant="ghost" icon="warn" className="cmp-warn-btn" onClick={() => showEditor("transfer")}>
              Set transfer time
            </Button>
          )}
          <Button variant={submitted?.key === currentKey ? "default" : "primary"} icon="play" disabled={blocked || running} onClick={run}>
            Run comparison
          </Button>
        </>
      }
    >
      <span className="cmp-total" aria-live="polite" aria-label={`${requested.length} sites × ${slips_h.length} dates = ${optionTotal} options`}>
        <span className="num cmp-total-n">{optionTotal}</span>
        <span className="cmp-total-unit">options</span>
      </span>
    </PageHeader>
  );

  const shortlist = (
    <section className="cmp-sec" aria-labelledby="cmp-short-title">
      <div className="cmp-sec-head">
        <h2 id="cmp-short-title" className="cmp-sec-title">
          Shortlist
        </h2>
        <span className="cmp-count num">{pins.length}</span>
        {mismatch && (
          <span role="alert">
            <Popover label="Different terrain stacks" icon="alert" tone="fail" width={340}>
              <dl className="cmp-dl">
                {mismatch.map((g) => (
                  <div key={g.ids} className="cmp-dl-row">
                    <dt className="num">{g.stack}</dt>
                    <dd>{g.names.join("; ")}</dd>
                  </div>
                ))}
              </dl>
              <div className="row">
                <Button size="sm" icon="terrain" onClick={() => showEditor("model")}>
                  Edit terrain stack
                </Button>
              </div>
            </Popover>
          </span>
        )}
        {savedPins.length > 0 && !mismatch && <AnalysisStatus state={compare} what="the saved plans' numbers" />}
        <span className="grow" />
        {pins.length > 0 && (
          <Button size="sm" variant="ghost" icon="trash" onClick={clearPins}>
            Clear shortlist
          </Button>
        )}
      </div>
      {rowsShort.length === 0 ? (
        <div className="cmp-empty" data-testid="shortlist-empty">
          <EmptyState icon="pin" title="Click grid cells to shortlist" />
        </div>
      ) : (
        <Shortlist rows={rowsShort} ticked={tickedKeys} canTick={(r) => canTick(r.pin, ctx)} onTick={tick} onUnpin={unpin} />
      )}
    </section>
  );

  const allMetrics = (
    <section className="cmp-sec cmp-metrics" aria-label="All metrics">
      <Disclosure title="All metrics" count={tickedList.length}>
        <OpenSignal onChange={setDetailOpen} />
        {tickedList.length < 2 ? (
          <EmptyState icon="table" title={`2 to ${MAX_DETAIL} options`} />
        ) : (
          <div className="cmp-metrics-body">
            <div className="cmp-toolbar">
              <Toggle checked={differencesOnly} onChange={setDifferencesOnly} label="Differences only" />
              {shownCompare && (
                <>
                  <span className={`chip ${shownCompare.result.provider === "terrain" ? "cmp-chip-terrain" : ""}`}>
                    {shownCompare.result.provider === "terrain" ? "Terrain horizon" : "Smooth sphere"}
                  </span>
                  <TerrainStackTag stack={shownCompare.result.terrain_stack} />
                  <LimitsChip limits={shownCompare.result.limits} stale={compare.stale} />
                  {shownCompare.result.warnings.map((w) => (
                    <span key={w} className="cmp-warn">
                      {w}
                    </span>
                  ))}
                </>
              )}
              <span className="grow" />
              {!mismatch && savedPins.length === 0 && <AnalysisStatus state={compare} what="the comparison" />}
            </div>
            {matrix && shownCompare && (
              <div className={compare.stale ? "cmp-stale" : undefined}>
                <Matrix result={matrix} differencesOnly={differencesOnly} />
              </div>
            )}
            {matrix && (
              <Disclosure title="Method">
                <div className="cmp-method">
                  <p className="cmp-note">
                    Margins are per requirement, in that requirement&apos;s own unit, and named for their case (nominal, worst-case). They are not ranked or joined across requirements or options. A range under a value runs over the three horizon worlds, optimistic to pessimistic terrain.
                  </p>
                  {matrixHeadingDependent(matrix) && (
                    <p className="cmp-note">
                      A requirement that depends on heading has no nominal margin because the lander heading is unknown; its lines are the engine&apos;s note and, when it gives them, the best and the worst single heading (these are not the bounds over headings).
                    </p>
                  )}
                  {stepNote && (
                    <p className="cmp-note" data-testid="step-note">
                      {stepNote}
                    </p>
                  )}
                </div>
              </Disclosure>
            )}
          </div>
        )}
      </Disclosure>
    </section>
  );

  return (
    <div className="cmp-page" aria-label="Compare page">
      {header}
      <h1 className="sr-only">Compare</h1>
      <div className="cmp-body">
        {slipFailed && (
          <div className="cmp-notice">
            <AnalysisStatus state={slip} what="the delay analysis" />
          </div>
        )}
        <InputStrip
          doc={doc}
          stored={stored}
          listError={listError}
          takenSaved={new Set(savedPins)}
          onAddSaved={(id) => pin({ kind: "saved", scenario_id: id })}
          onRetryList={retryList}
          daysText={daysText}
          onDaysText={setDaysText}
        />
        <section className={`cmp-sec cmp-grid-sec${slipOutOfDate ? " cmp-stale" : ""}`} aria-label="Options" data-testid={slipDone ? undefined : "grid-empty"}>
          <Grid
            delays={slipDone ? slipDone.result.slips_h : slips_h}
            sites={gridSites}
            landing={landingAt}
            mode={slipDone ? slipDone.result.mode : mode}
            pins={pins}
            openSite={detailIndex}
            onTogglePin={(site, slip_h) => togglePin({ kind: "cell", site, slip_h })}
            onOpenSite={(i) => setOpenSite((cur) => (cur === i ? null : i))}
          />
        </section>
        {slipDone && detailIndex !== null && (
          <section id="cmp-detail" className={`cmp-sec${slipOutOfDate ? " cmp-stale" : ""}`} aria-label={`Delays of ${rows[detailIndex]!.name}`}>
            <SiteDelays
              result={slipDone.result}
              index={slipDone.result.results.indexOf(rows[detailIndex]!.site)}
              name={rows[detailIndex]!.name}
              onSelect={(i) => setOpenSite(rows.findIndex((r) => r.site === slipDone.result.results[i]))}
              onClose={() => setOpenSite(null)}
            />
          </section>
        )}
        {shortlist}
        {allMetrics}
      </div>
    </div>
  );
}

function useShown<R, S>(analysis: Pick<AnalysisState<R>, "result" | "stale">, request: S): { result: R; request: S } | null {
  const [shown, setShown] = useState<{ result: R; request: S } | null>(null);
  const { result, stale } = analysis;
  if (result !== null && !stale && shown?.result !== result) setShown({ result, request });
  return shown;
}

type StepNote = { id: string; parameters?: Record<string, unknown> | null };

const steps = (limits: readonly StepNote[]): Set<number> =>
  new Set(limits.filter((l) => l.id === "scan.step" && typeof l.parameters?.["step_s"] === "number").map((l) => l.parameters!["step_s"] as number));

function delayStepNote(delayLimits: readonly StepNote[], compareLimits: readonly StepNote[]): string | null {
  const own = steps(compareLimits);
  const extra = [...steps(delayLimits)].filter((s) => !own.has(s));
  if (extra.length === 0 || own.size === 0) return null;
  const list = (xs: Iterable<number>) => [...xs].sort((a, b) => a - b).map((s) => `${s} s`).join(" and ");
  return `The delay analysis behind the grid and the bars evaluated its rows at a signal step of ${list(extra)}; this evaluation used ${list(own)}. Values built from interpolated edge times, such as the dark span, can differ slightly between the two (see the caveat "Edges are interpolated at the signal step").`;
}
