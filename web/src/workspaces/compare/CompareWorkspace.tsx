import { useCallback, useEffect, useMemo, useState } from "react";
import { PLANNING_ENDPOINTS, slipBody, type SlipParams, type SlipResult, type SlipRow } from "../../api/planning";
import { useReportPlanning } from "../../api/report";
import { useAnalysis } from "../../api/useAnalysis";
import { usePublishScreenContext } from "../../ask/screenContext";
import { WorkspaceBoundary } from "../../components/WorkspaceBoundary";
import { Button } from "../../components/ui/Button";
import { PageHeader } from "../../components/ui/PageHeader";
import { Spinner } from "../../components/ui/Progress";
import { VerdictChip } from "../../components/ui/VerdictChip";
import { downloadText, slug } from "../../lib/download";
import { MS_HOUR, MS_MIN, parseUtc, toIsoUtc } from "../../lib/time";
import { useAlternatives, type Candidate } from "../../scenario/alternatives";
import type { Path } from "../../scenario/path";
import { routeStackIssues, useScenario } from "../../scenario/store";
import type { Scenario } from "../../scenario/types";
import { toast } from "../../state/toasts";
import "../../styles/compare.css";
import { AddDate } from "./AddDate";
import { AddSite } from "./AddSite";
import { delayLabels } from "./delays";
import { Grid, type Cell } from "./Grid";
import { STATE_WORD, dateText, dayText, limitingName, marginText, requestedSites, sameSite, servedByKey, works, type SiteRef } from "./gridModel";
import { BASELINE_SITE, MAX_SLIP_H, SEARCH_DAYS, useCompareOptions } from "./options";

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
  const slips = useCompareOptions((s) => s.slips_h);
  const removeSlip = useCompareOptions((s) => s.removeSlip);

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
  const plannedMs = parseUtc(doc.landing_utc);
  const busy = slip.phase === "running";
  const stale = slip.result !== null && (slip.stale || busy);
  const failed = slip.phase === "error" && slip.error !== null;
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

  const [selected, setSelected] = useState<Cell | null>(null);
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
            <span>Could not check these dates: {slip.error!.message}</span>
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
          />
          {sites.length === 1 && <p className="cmp-hint">Add a site to see where else it could land.</p>}
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
  const lim = limitingName(row);
  const margin = marginText(row);
  const label = isCurrent ? null : nextMs !== null ? (plan ? `Use ${dayText(nextMs)} instead` : `Use this site on ${dayText(nextMs)}`) : plan ? "Use this date" : slip_h === 0 ? "Use this site" : "Use this site and date";

  return (
    <section className={`cmp-detail${stale ? " cmp-stale" : ""}`} aria-label="Selected site and date">
      <div className="cmp-detail-head">
        <h2 className="cmp-detail-title">
          {site.name}
          <span className="cmp-detail-date num">{dateText(landingMs)}</span>
        </h2>
        {row.state === "pass" || row.state === "marginal" || row.state === "fail" ? <VerdictChip verdict={row.state} compact /> : <span className="chip">{STATE_WORD[row.state]}</span>}
      </div>
      <dl className="cmp-facts">
        {lim && (
          <div>
            <dt>Limiting</dt>
            <dd>
              {lim}
              {margin && <span className="num cmp-margin"> {margin}</span>}
            </dd>
          </div>
        )}
        {!ok && (
          <div>
            <dt>Next open</dt>
            <dd className="num">{nextMs !== null ? dateText(nextMs) : `None in ${SEARCH_DAYS} d`}</dd>
          </div>
        )}
      </dl>
      {label && (
        <Button
          variant={ok || nextMs !== null ? "primary" : "default"}
          disabled={stale}
          onClick={() => {
            adopt(site, target);
            onDone();
          }}
        >
          {label}
        </Button>
      )}
      {isCurrent && <span className="cmp-detail-note">This is the plan.</span>}
    </section>
  );
}

function adopt(site: SiteRef, landingMs: number): void {
  const store = useScenario.getState();
  const doc: Scenario | null = store.doc;
  const planned = doc ? parseUtc(doc.landing_utc) : null;
  if (!doc || planned === null) return;
  const alt = useAlternatives.getState();
  const opts = useCompareOptions.getState();
  const before = { site: doc.site, landing_utc: doc.landing_utc, name: doc.name, slips: opts.slips_h };
  const landing = Math.round(landingMs / MS_MIN) * MS_MIN;
  const shift = Number(((landing - planned) / MS_HOUR).toFixed(3));
  const changes: Array<[Path, unknown]> = [[["landing_utc"], toIsoUtc(landing)]];
  let keptOld: string | null = null;
  const moving = site.key !== BASELINE_SITE;
  if (moving) {
    const source = alt.items.find((a) => a.id === site.key);
    changes.push(
      [["site", "lat_deg"], site.lat_deg],
      [["site", "lon_deg"], site.lon_deg],
      [["site", "name"], source?.name ?? site.name],
      [["site", "catalog_id"], site.catalog_id ?? undefined],
    );
    if (!store.saved) changes.push([["name"], source?.name ?? site.name]);
    const old: Candidate = {
      id: doc.site.catalog_id ?? `pt-${doc.site.lat_deg.toFixed(5)}_${doc.site.lon_deg.toFixed(5)}`,
      name: doc.site.name || "Previous site",
      lat_deg: doc.site.lat_deg,
      lon_deg: doc.site.lon_deg,
      catalog_id: doc.site.catalog_id ?? null,
    };
    if (!alt.items.some((a) => sameSite(a, old))) {
      alt.add(old);
      keptOld = old.id;
    }
  }
  if (shift !== 0) opts.setSlips(before.slips.map((h) => h - shift).filter((h) => Math.abs(h) <= MAX_SLIP_H));
  store.editMany(changes);
  toast(
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
            [["name"], before.name],
          ]);
          useCompareOptions.getState().setSlips(before.slips);
          if (keptOld) useAlternatives.getState().remove(keptOld);
        },
      },
    },
    10_000,
  );
}

function gridCsv(sites: readonly SiteRef[], slips: readonly number[], cellAt: (key: string, h: number) => SlipRow | null, plannedMs: number | null): string {
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const iso = (ms: number | null) => (ms === null ? "" : toIsoUtc(ms).replace("T", " ").replace(/:00Z$/, ""));
  const lines = [["Site", "Latitude", "Longitude", "Landing (UTC)", "Verdict", "Limiting", "Margin", "Next open (UTC)"].join(",")];
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
          q(marginText(r) ?? ""),
          works(r.state) ? "" : iso(parseUtc(r.next_open_utc ?? null)),
        ].join(","),
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
