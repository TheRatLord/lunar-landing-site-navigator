import { useCallback, useEffect, useMemo, useState } from "react";
import { PLANNING_ENDPOINTS, slipBody, type SlipParams, type SlipResult, type SlipRow } from "../../api/planning";
import { useReportPlanning } from "../../api/report";
import { useAnalysis } from "../../api/useAnalysis";
import { usePublishScreenContext } from "../../ask/screenContext";
import { WorkspaceBoundary } from "../../components/WorkspaceBoundary";
import { Button, IconButton } from "../../components/ui/Button";
import { PageHeader } from "../../components/ui/PageHeader";
import { Spinner } from "../../components/ui/Progress";
import { VerdictChip } from "../../components/ui/VerdictChip";
import { downloadText, slug } from "../../lib/download";
import { MS_HOUR, MS_MIN, parseUtc, toIsoUtc } from "../../lib/time";
import { useAlternatives, type Candidate } from "../../scenario/alternatives";
import { usePlanSearch } from "../../scenario/planSearch";
import type { Path } from "../../scenario/path";
import { routeStackIssues, useScenario } from "../../scenario/store";
import type { Scenario } from "../../scenario/types";
import { toast, useToasts } from "../../state/toasts";
import "../../styles/compare.css";
import { AddDate } from "./AddDate";
import { AddSite } from "./AddSite";
import { delayLabels } from "./delays";
import { Grid, type Cell } from "./Grid";
import { STATE_WORD, dateText, dayText, limitingName, marginValue, requestedSites, rowVerdict, sameSite, servedByKey, works, type SiteRef } from "./gridModel";
import { BASELINE_SITE, MAX_SLIP_H, SEARCH_DAYS, normalizeSlips, useCompareOptions } from "./options";

export function CompareWorkspace() {
  return (
    <WorkspaceBoundary workspace="Compare" usesDraft>
      <Compare />
    </WorkspaceBoundary>
  );
}

function Compare() {
  const doc = useScenario((s) => s.doc)!;
  const alternatives = useAlternatives((s) => s.items);
  const removeAlternative = useAlternatives((s) => s.remove);
  const stored = useCompareOptions((s) => s.slips_h);
  const removeSlip = useCompareOptions((s) => s.removeSlip);
  const landingWindow = usePlanSearch((s) => s.window);
  const plannedMs = parseUtc(doc.landing_utc);
  const windowStart = useMemo(() => {
    if (!landingWindow || plannedMs === null) return null;
    const h = Number(((landingWindow.first_ms - plannedMs) / MS_HOUR).toFixed(3));
    return Math.abs(h) <= MAX_SLIP_H ? h : null;
  }, [landingWindow, plannedMs]);
  const slips = useMemo(() => {
    if (!landingWindow || plannedMs === null) return stored;
    const inside = stored.filter((h) => {
      const at = plannedMs + h * MS_HOUR;
      return at >= landingWindow.first_ms - MS_MIN && at <= landingWindow.last_ms + MS_MIN;
    });
    return normalizeSlips(windowStart === null ? inside : [...inside, windowStart]);
  }, [stored, landingWindow, plannedMs, windowStart]);
  const removable = useCallback((h: number) => stored.includes(h), [stored]);

  const sites = useMemo(() => requestedSites(doc.site, alternatives), [doc.site, alternatives]);
  const params = useMemo<SlipParams>(() => {
    const extra = sites.slice(1);
    return {
      slips_h: slips,
      mode: "landing",
      search_days: SEARCH_DAYS,
      spacing_s: 3600,
      alternative_sites: extra.flatMap((s) => (s.catalog_id !== null ? [s.catalog_id] : [])),
      alternative_coordinates: extra.flatMap((s) => (s.catalog_id === null ? [{ name: s.name, lat_deg: s.lat_deg, lon_deg: s.lon_deg }] : [])),
    };
  }, [sites, slips]);
  const body = useMemo(() => slipBody(doc, params, "auto"), [doc, params]);
  const slip = useAnalysis<SlipResult>(PLANNING_ENDPOINTS.slip, body, { debounceMs: 500 });
  useEffect(() => routeStackIssues(slip.error), [slip.error]);
  const setReportSlip = useReportPlanning((s) => s.setSlip);
  useEffect(() => {
    if (slip.result && !slip.stale) setReportSlip(params);
  }, [slip.result, slip.stale, params, setReportSlip]);

  const served = useMemo(() => servedByKey(slip.result, sites), [slip.result, sites]);
  const busy = slip.phase === "running";
  const failed = slip.phase === "error" && slip.error !== null;
  const stale = slip.result !== null && (slip.stale || busy || failed);
  const cellAt = useCallback(
    (key: string, h: number): SlipRow | null => {
      const rows = served.get(key)?.rows ?? [];
      if (!slip.stale) return rows.find((r) => r.slip_h === h) ?? null;
      if (plannedMs === null) return null;
      const at = plannedMs + h * MS_HOUR;
      return rows.find((r) => Math.abs((parseUtc(r.landing_utc ?? null) ?? NaN) - at) < MS_MIN) ?? null;
    },
    [served, slip.stale, plannedMs],
  );

  const planKey = JSON.stringify([doc.landing_utc, doc.site.lat_deg, doc.site.lon_deg, doc.site.catalog_id ?? null, doc.constraints]);
  const [choice, setChoice] = useState<{ cell: Cell; plan: string } | null>(null);
  const selected = choice?.plan === planKey ? choice.cell : null;
  const setSelected = useCallback((cell: Cell | null) => setChoice(cell ? { cell, plan: planKey } : null), [planKey]);
  const pickSite = selected ? sites.find((s) => s.key === selected.site) : undefined;
  const pickRow = selected && pickSite && slips.includes(selected.slip_h) ? cellAt(pickSite.key, selected.slip_h) : null;
  const pick = pickSite && pickRow ? { site: pickSite, row: pickRow } : null;

  usePublishScreenContext({
    where: "Compare",
    summary: `${sites.length} site${sites.length === 1 ? "" : "s"} × ${slips.length} landing date${slips.length === 1 ? "" : "s"}`,
    lines: [`Sites: ${sites.map((s) => s.name).join("; ")}.`, `Landing dates, from the planned landing: ${delayLabels(slips).join(", ")}.`],
  });

  const csv = () => downloadText(`${slug(doc.name)}-compare.csv`, gridCsv(sites, slips, cellAt, plannedMs), "text/csv");

  return (
    <div className="cmp-page" aria-label="Compare page">
      <PageHeader
        actions={
          <>
            {busy && (
              <span className="cmp-busy" role="status">
                <Spinner size={12} />
                Checking
              </span>
            )}
            <Button size="sm" icon="download" disabled={served.size === 0 || stale} onClick={csv}>
              CSV
            </Button>
          </>
        }
      >
        <AddSite present={sites} />
        <AddDate plannedMs={plannedMs} />
      </PageHeader>
      <h1 className="sr-only">Compare</h1>
      <div className="cmp-body">
        {failed && (
          <p className="cmp-notice" role="alert">
            <span>Could not check these dates</span>
            <Button size="sm" variant="ghost" icon="reset" onClick={slip.rerun}>
              Retry
            </Button>
          </p>
        )}
        <section className={`cmp-grid-sec${stale ? " cmp-stale" : ""}`} aria-label="Sites by landing date" aria-busy={busy}>
          <Grid
            sites={sites}
            slips={slips}
            plannedMs={plannedMs}
            cellAt={cellAt}
            selected={pick ? selected : null}
            onSelect={setSelected}
            onRemoveSite={removeAlternative}
            onRemoveSlip={removeSlip}
            removable={removable}
          />
          {sites.length === 1 && <p className="cmp-hint">Add a site to compare</p>}
        </section>
        {pick && selected && plannedMs !== null && (
          <Detail key={`${pick.site.key}:${selected.slip_h}`} site={pick.site} row={pick.row} slip_h={selected.slip_h} landingMs={plannedMs + selected.slip_h * MS_HOUR} stale={stale} onDone={() => setSelected(null)} />
        )}
      </div>
    </div>
  );
}

function Detail({ site, row, slip_h, landingMs, stale, onDone }: { site: SiteRef; row: SlipRow; slip_h: number; landingMs: number; stale: boolean; onDone: () => void }) {
  const plan = site.key === BASELINE_SITE;
  const ok = works(row.state);
  const nextMs = ok ? null : parseUtc(row.next_open_utc ?? null);
  const target = nextMs ?? landingMs;
  const isCurrent = plan && slip_h === 0;
  const sentence = rowVerdict(row);
  const label = ok
    ? isCurrent ? null : plan ? "Use this date" : slip_h === 0 ? "Use this site" : "Use this site and date"
    : nextMs === null ? null : plan ? `Use ${dayText(nextMs)} instead` : `Use this site on ${dayText(nextMs)}`;

  return (
    <section className={`cmp-detail${stale ? " cmp-stale" : ""}`} aria-label="Selected site and date">
      <div className="cmp-detail-head">
        {row.state === "pass" || row.state === "marginal" || row.state === "fail" ? <VerdictChip verdict={row.state} compact /> : <span className="chip">{STATE_WORD[row.state]}</span>}
        <h2 className="cmp-detail-title">
          <span className="ellipsis">{site.name}</span>
          <span className="cmp-detail-date num">{dateText(landingMs)}</span>
        </h2>
      </div>
      <dl className="cmp-facts">
        {sentence && (
          <div>
            <dt>Verdict</dt>
            <dd>{sentence}</dd>
          </div>
        )}
        {!ok && (
          <div>
            <dt>Next date</dt>
            <dd className="num">{nextMs !== null ? dateText(nextMs) : `No date in the next ${SEARCH_DAYS} d`}</dd>
          </div>
        )}
      </dl>
      {label && (
        <Button
          className="cmp-detail-act"
          variant={row.state === "pass" || nextMs !== null ? "primary" : "default"}
          disabled={stale}
          onClick={() => {
            adopt(site, target);
            onDone();
          }}
        >
          {label}
        </Button>
      )}
      <IconButton icon="close" size="sm" className="cmp-detail-close" label="Close" onClick={onDone} />
    </section>
  );
}

let lastToast: number | null = null;

function adopt(site: SiteRef, landingMs: number): void {
  const store = useScenario.getState();
  const doc: Scenario | null = store.doc;
  const planned = doc ? parseUtc(doc.landing_utc) : null;
  if (!doc || planned === null) return;
  const alt = useAlternatives.getState();
  const opts = useCompareOptions.getState();
  const before = { site: doc.site, landing_utc: doc.landing_utc, slips: opts.slips_h, items: alt.items };
  const landing = Math.round(landingMs / MS_MIN) * MS_MIN;
  const shift = Number(((landing - planned) / MS_HOUR).toFixed(3));
  const changes: Array<[Path, unknown]> = [[["landing_utc"], toIsoUtc(landing)]];
  if (site.key !== BASELINE_SITE) {
    const source = alt.items.find((a) => a.id === site.key);
    changes.push(
      [["site", "lat_deg"], site.lat_deg],
      [["site", "lon_deg"], site.lon_deg],
      [["site", "name"], source?.name ?? site.name],
      [["site", "catalog_id"], site.catalog_id ?? undefined],
    );
    const old: Candidate = {
      id: doc.site.catalog_id ?? `pt-${doc.site.lat_deg.toFixed(5)}_${doc.site.lon_deg.toFixed(5)}`,
      name: doc.site.name || "Previous site",
      lat_deg: doc.site.lat_deg,
      lon_deg: doc.site.lon_deg,
      catalog_id: doc.site.catalog_id ?? null,
    };
    const rest = alt.items.filter((a) => !sameSite(a, old));
    const at = rest.findIndex((a) => a.id === site.key);
    const items = at >= 0 ? [...rest.slice(0, at), old, ...rest.slice(at + 1)] : [...rest, old];
    useAlternatives.setState({ items });
  }
  if (shift !== 0) opts.setSlips(before.slips.map((h) => h - shift).filter((h) => Math.abs(h) <= MAX_SLIP_H));
  store.editMany(changes);
  if (lastToast !== null) useToasts.getState().dismiss(lastToast);
  lastToast = toast(
    {
      kind: "success",
      title: "Plan updated",
      detail: `${site.name} · ${dateText(landing)}`,
      action: {
        label: "Undo",
        run: () => {
          useScenario.getState().editMany([
            [["site"], before.site],
            [["landing_utc"], before.landing_utc],
          ]);
          useCompareOptions.getState().setSlips(before.slips);
          useAlternatives.setState({ items: before.items });
        },
      },
    },
    10_000,
  );
}

function csvMargin(r: SlipRow): [string, string] {
  const m = marginValue(r);
  if (!m) return ["", ""];
  const pct = m.unit === "fraction";
  return [(pct ? m.value * 100 : m.value).toFixed(1), pct ? "%" : m.unit === "deg" ? "°" : m.unit];
}

function gridCsv(sites: readonly SiteRef[], slips: readonly number[], cellAt: (key: string, h: number) => SlipRow | null, plannedMs: number | null): string {
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const iso = (ms: number | null) => (ms === null ? "" : toIsoUtc(ms).replace("T", " ").replace(/:00Z$/, ""));
  const lines = [["Site", "Latitude", "Longitude", "Landing (UTC)", "Verdict", "Limiting", "Margin", "Margin unit", "Next date (UTC)"].join(",")];
  for (const s of sites) {
    for (const h of slips) {
      const r = cellAt(s.key, h);
      if (!r) continue;
      const landing = plannedMs === null ? parseUtc(r.landing_utc ?? null) : plannedMs + h * MS_HOUR;
      lines.push(
        [
          q(s.name),
          s.lat_deg.toFixed(2),
          s.lon_deg.toFixed(2),
          iso(landing),
          STATE_WORD[r.state],
          q(limitingName(r) ?? ""),
          ...csvMargin(r),
          works(r.state) ? "" : iso(parseUtc(r.next_open_utc ?? null)),
        ].join(","),
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
