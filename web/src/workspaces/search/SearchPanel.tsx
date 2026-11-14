import { useEffect, useId, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePublishScreenContext } from "../../ask/screenContext";
import { usePublishSearch } from "../../api/report";
import {
  MAX_SEARCH_POINTS,
  SEARCH_ENDPOINT,
  checkSearch,
  searchBody,
  searchRows,
  type RegionInput,
  type SearchBody,
  type SearchResult,
  type SearchRow,
} from "../../api/search";
import { useAnalysis } from "../../api/useAnalysis";
import { AnalysisStatus, OutOfDate } from "../../components/AnalysisStatus";
import { Button, IconButton } from "../../components/ui/Button";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { Disclosure } from "../../components/ui/Disclosure";
import { EmptyState } from "../../components/ui/EmptyState";
import { DateTimeInput, Toggle } from "../../components/ui/Fields";
import { PageHeader } from "../../components/ui/PageHeader";
import { Popover } from "../../components/ui/Popover";
import { Segmented } from "../../components/ui/Segmented";
import { Stat } from "../../components/ui/Stat";
import { VerdictChip } from "../../components/ui/VerdictChip";
import { formatLat, formatLon } from "../../lib/coords";
import { formatSigned, formatSignedValue, withUnit } from "../../lib/format";
import { mixedKindsNote } from "../../lib/marginKind";
import { MS_DAY, formatUtc, parseUtc, toIsoUtc } from "../../lib/time";
import { useAlternatives } from "../../scenario/alternatives";
import { useScenario } from "../../scenario/store";
import type { Scenario } from "../../scenario/types";
import { toast } from "../../state/toasts";
import "../../styles/search.css";
import { exploreMapHref } from "../explore/exploreMapHref";
import { ExploreTabs } from "../explore/ExploreTabs";
import { ReportButton } from "../ReportButton";
import { estimatesUsed, type EstimateFlag } from "../site/adapt";
import { LimitsChip } from "../site/LimitsChip";
import { regionFromMapView, useMapView } from "./mapView";
import { searchScenarioKey, useSearchResults } from "./results";
import { SearchGrid } from "./SearchGrid";
import { TerrainStackTag } from "./TerrainStackTag";
import { SearchValidationNote } from "./ValidationNote";

const num = (s: string): number => (s.trim() === "" ? Number.NaN : Number(s));
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

interface ActiveLimit {
  key: string;
  text: string;
  estimate: boolean;
}

function activeLimits(doc: Scenario): ActiveLimit[] {
  const out: ActiveLimit[] = [];
  for (const [key, v] of Object.entries(doc.constraints)) {
    if (!v || typeof v !== "object" || !("margin_scale" in v) || !("label" in v)) continue;
    const parts = [v.min != null ? `≥ ${v.min}` : null, v.max != null ? `≤ ${v.max}` : null].filter(Boolean);
    if (parts.length === 0) continue;
    out.push({ key, text: `${v.label} ${parts.map((p) => withUnit(p!, v.unit)).join(" and ")}`.trim(), estimate: v.origin.basis === "estimate" || v.origin.basis === "derived" || v.origin.basis === "convention" });
  }
  return out;
}

interface NumFieldProps {
  label: string;
  unit?: string;
  value: string;
  onChange: (v: string) => void;
  integer?: boolean;
}

function NumField({ label, unit, value, onChange, integer }: NumFieldProps) {
  const id = useId();
  return (
    <div className="se-field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <span className="input-group">
        <input
          id={id}
          className="input num"
          inputMode={integer ? "numeric" : "decimal"}
          autoComplete="off"
          spellCheck={false}
          value={value}
          aria-label={unit ? `${label} (${unit})` : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        {unit && (
          <span className="input-unit" aria-hidden="true">
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}

function EpochField({ label, aria, value, onChange }: { label: string; aria: string; value: number; onChange: (ms: number) => void }) {
  const id = useId();
  return (
    <div className="se-field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <DateTimeInput compact id={id} label={aria} value={value} onChange={onChange} />
    </div>
  );
}

function ConstraintsChip({ limits }: { limits: ActiveLimit[] }) {
  if (limits.length === 0) return <span className="chip chip-marginal">No requirements set</span>;
  return (
    <Popover label={plural(limits.length, "requirement")} icon="sliders" width={340}>
      <ul className="se-pop-list" aria-label="Requirements applied">
        {limits.map((l) => (
          <li key={l.key}>
            <span>{l.text}</span>
            {l.estimate && <span className="se-flag">Estimate</span>}
          </li>
        ))}
      </ul>
    </Popover>
  );
}

function EstimatesChip({ estimates }: { estimates: EstimateFlag[] }) {
  if (estimates.length === 0) return null;
  return (
    <Popover label={plural(estimates.length, "estimate")} icon="info" tone="marginal" width={340}>
      <ul className="se-pop-list" aria-label="Plan inputs that are estimates">
        {estimates.map((e) => (
          <li key={e.path}>
            <span>{e.label}</span>
            <span className="se-flag">{e.basis}</span>
          </li>
        ))}
      </ul>
    </Popover>
  );
}

export function SearchPanel() {
  const doc = useScenario((s) => s.doc)!;
  const formId = useId();
  const errorsId = useId();
  const landingMs = parseUtc(doc.landing_utc) ?? Date.UTC(2027, 0, 1);
  const [mode, setMode] = useState<"disc" | "box">("disc");
  const [lat, setLat] = useState(String(doc.site.lat_deg));
  const [lon, setLon] = useState(String(doc.site.lon_deg));
  const [radius, setRadius] = useState("500");
  const [box, setBox] = useState({ south: String(doc.site.lat_deg - 0.01), north: String(doc.site.lat_deg + 0.01), west: String(doc.site.lon_deg - 0.05), east: String(doc.site.lon_deg + 0.05) });
  const [spacing, setSpacing] = useState("50");
  const [topK, setTopK] = useState("20");
  const [windowOn, setWindowOn] = useState(false);
  const [firstMs, setFirstMs] = useState(landingMs);
  const [lastMs, setLastMs] = useState(landingMs + 30 * MS_DAY);
  const [epochH, setEpochH] = useState("12");
  const [submitted, setSubmitted] = useState<SearchBody | null>(null);

  const region: RegionInput =
    mode === "disc"
      ? { kind: "disc", lat_deg: num(lat), lon_deg: num(lon), radius_m: num(radius) }
      : { kind: "box", lat_min: num(box.south), lat_max: num(box.north), lon_min: num(box.west), lon_max: num(box.east) };
  const epochs = windowOn ? { first_utc: toIsoUtc(firstMs), last_utc: toIsoUtc(lastMs), spacing_h: num(epochH) } : null;
  const check = checkSearch(region, num(spacing), num(topK), epochs);
  const limits = useMemo(() => activeLimits(doc), [doc]);
  const estimates = useMemo(() => estimatesUsed(doc), [doc]);

  const analysis = useAnalysis<SearchResult>(SEARCH_ENDPOINT, submitted, { debounceMs: 0 });
  const result = analysis.result;
  const rows = useMemo(() => (result ? searchRows(result) : []), [result]);
  const currentBody = check.errors.length === 0 ? searchBody(doc, region, num(spacing), num(topK), epochs) : null;
  const formChanged = submitted !== null && !analysis.stale && JSON.stringify(currentBody) !== JSON.stringify(submitted);
  const outOfDate = result !== null && (analysis.stale || formChanged || analysis.phase === "running");
  const resultScenarioKey = useMemo(() => searchScenarioKey(submitted?.scenario), [submitted]);
  const setCandidates = useSearchResults((s) => s.setCandidates);
  const setStale = useSearchResults((s) => s.setStale);
  const clearCandidates = useSearchResults((s) => s.clear);
  useEffect(() => {
    if (result === null) clearCandidates();
    else if (outOfDate) setStale(true);
    else setCandidates(rows, resultScenarioKey);
  }, [result, outOfDate, rows, resultScenarioKey, setCandidates, setStale, clearCandidates]);
  usePublishSearch(result !== null ? submitted : null, outOfDate);

  const mapView = useMapView((m) => m.view);
  const fromMap = mapView ? regionFromMapView(mapView) : null;
  const useMapRegion = () => {
    if (!fromMap) return;
    if (fromMap.kind === "disc") {
      setMode("disc");
      setLat(fromMap.lat_deg.toFixed(5));
      setLon(fromMap.lon_deg.toFixed(5));
      setRadius(String(Math.max(1, Math.round(fromMap.radius_m))));
    } else {
      setMode("box");
      setBox({ south: fromMap.south.toFixed(4), north: fromMap.north.toFixed(4), west: fromMap.west.toFixed(4), east: fromMap.east.toFixed(4) });
    }
  };

  const submit = () => {
    if (check.errors.length === 0) setSubmitted(searchBody(doc, region, num(spacing), num(topK), epochs));
  };

  usePublishScreenContext({
    where: "Explore, Find sites",
    summary: mode === "disc" ? "radius around a point" : "bounding box",
    lines: [
      mode === "disc"
        ? `The region is a disc around latitude ${lat || "unset"}, longitude ${lon || "unset"} with radius ${radius || "unset"} m.`
        : `The region is a box from latitude ${box.south || "unset"} to ${box.north || "unset"} and longitude ${box.west || "unset"} to ${box.east || "unset"}.`,
      `Grid spacing ${spacing || "unset"} m, the best ${topK || "unset"} sites are kept.`,
      windowOn
        ? `The search covers landing times from ${toIsoUtc(firstMs)} to ${toIsoUtc(lastMs)}, every ${epochH || "unset"} h.`
        : "The search uses the plan's landing time.",
    ],
  });

  const tooMany = Number.isFinite(check.points) && check.points > MAX_SEARCH_POINTS;
  const failed = analysis.phase === "error";
  const cancelled = submitted !== null && result === null && analysis.phase === "idle";

  return (
    <>
      <PageHeader
        tabs={<ExploreTabs />}
        actions={
          <>
            {formChanged && analysis.phase !== "running" && !failed ? <OutOfDate state={{ ...analysis, rerun: submit }} /> : !failed && <AnalysisStatus state={analysis} what="the site search" />}
            <ReportButton />
            <Button
              type="submit"
              form={formId}
              variant="primary"
              size="sm"
              icon="search"
              disabled={check.errors.length > 0}
              aria-label="Search region"
              aria-describedby={check.errors.length > 0 ? errorsId : undefined}
            >
              Search region
            </Button>
          </>
        }
      >
        <ConstraintsChip limits={limits} />
        <EstimatesChip estimates={estimates} />
      </PageHeader>
      <div className="se">
        <h1 className="sr-only">Find sites: {doc.name}</h1>
        <form
          id={formId}
          className="se-params"
          aria-label="Search region"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="se-line">
            <Segmented
              label="Region shape"
              value={mode}
              onChange={(v) => setMode(v as "disc" | "box")}
              options={[
                { value: "disc", label: "Circle" },
                { value: "box", label: "Box" },
              ]}
            />
            <span className="grow" />
            <IconButton icon="map" label="Use current map view" size="sm" disabled={!fromMap} onClick={useMapRegion} />
          </div>
          {mode === "disc" ? (
            <>
              <div className="se-pair se-pair-tool">
                <NumField label="Latitude" unit="°" value={lat} onChange={setLat} />
                <NumField label="Longitude" unit="°E" value={lon} onChange={setLon} />
                <IconButton
                  icon="target"
                  label="Centre on site"
                  size="sm"
                  onClick={() => {
                    setLat(String(doc.site.lat_deg));
                    setLon(String(doc.site.lon_deg));
                  }}
                />
              </div>
              <NumField label="Radius" unit="m" value={radius} onChange={setRadius} />
            </>
          ) : (
            <div className="se-pair se-pair-box">
              <NumField label="South" unit="°" value={box.south} onChange={(v) => setBox({ ...box, south: v })} />
              <NumField label="North" unit="°" value={box.north} onChange={(v) => setBox({ ...box, north: v })} />
              <NumField label="West" unit="°E" value={box.west} onChange={(v) => setBox({ ...box, west: v })} />
              <NumField label="East" unit="°E" value={box.east} onChange={(v) => setBox({ ...box, east: v })} />
            </div>
          )}

          <div className="se-advanced hairline">
            <Disclosure title="Advanced">
              <div className="se-adv-body">
                <div className="se-pair">
                  <NumField label="Final spacing" unit="m" value={spacing} onChange={setSpacing} />
                  <NumField label="Sites to rank" value={topK} onChange={setTopK} integer />
                </div>
                <Toggle checked={windowOn} onChange={setWindowOn} label="Landing window" />
                {windowOn ? (
                  <>
                    <EpochField label="First" aria="First landing time (UTC)" value={firstMs} onChange={setFirstMs} />
                    <EpochField label="Last" aria="Last landing time (UTC)" value={lastMs} onChange={setLastMs} />
                    <div className="se-pair">
                      <NumField label="Every" unit="h" value={epochH} onChange={setEpochH} />
                    </div>
                  </>
                ) : (
                  <div className="se-kv">
                    <span className="field-label">Landing time (UTC)</span>
                    <span className="num">{formatUtc(landingMs, { seconds: false })}</span>
                  </div>
                )}
              </div>
            </Disclosure>
          </div>

          <div className="se-size hairline" aria-live="polite">
            <Stat label="Grid points" value={Number.isFinite(check.points) ? `≈ ${Math.round(check.points).toLocaleString("en-US")}` : "–"} tone={tooMany ? "fail" : "default"} />
          </div>
          {check.errors.length > 0 && (
            <ul id={errorsId} className="se-errors" role="alert">
              {check.errors.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </form>

        <section className="se-results" aria-label="Search results">
          {failed && (
            <div className="se-notice">
              <AnalysisStatus state={analysis} what="the site search" />
            </div>
          )}
          {result ? (
            <div className={outOfDate ? "se-stale" : undefined}>
              <Results result={result} rows={rows} stale={outOfDate} />
            </div>
          ) : (
            !failed && (
              <div className="se-empty">
                {analysis.phase === "running" ? (
                  <EmptyState icon="clock" title="Searching" />
                ) : cancelled ? (
                  <EmptyState icon="stop" title="Search cancelled" />
                ) : (
                  <EmptyState icon="search" title="Not searched yet" />
                )}
              </div>
            )
          )}
        </section>
      </div>
    </>
  );
}

const MARGIN_NAME = { nominal: "Nominal margin", "worst-case": "Worst-case margin", "heading unknown": "Margin (heading unknown)" } as const;

function marginCell(r: SearchRow) {
  if (r.margin === null || r.normalised === null) return <span className="faint">–</span>;
  const name = (r.marginKind && (MARGIN_NAME as Record<string, string | undefined>)[r.marginKind]) ?? "Margin";
  return (
    <span className="se-margin" aria-label={`${name} ${formatSignedValue(r.margin, r.unit, 2)}`}>
      {formatSignedValue(r.margin, r.unit, 2)}
      {r.marginKind && <span className="faint se-kind">{r.marginKind}</span>}
      {r.headingDependent && !r.marginNote && r.marginKind !== "heading unknown" && <span className="se-flag">heading unknown</span>}
      {r.marginNote && (
        <Popover label="Note" icon="info" tone="marginal" align="end" width={300}>
          <p className="se-pop-text" data-testid="search-margin-note">
            {r.marginNote}
          </p>
        </Popover>
      )}
    </span>
  );
}

function Results({ result, rows, stale }: { result: SearchResult; rows: SearchRow[]; stale: boolean }) {
  const navigate = useNavigate();
  const alternatives = useAlternatives((s) => s.items);
  const addAlternative = useAlternatives((s) => s.add);
  const editMany = useScenario((s) => s.editMany);
  const selectedRank = useSearchResults((s) => s.selectedRank);
  const select = useSearchResults((s) => s.select);
  const clear = useSearchResults((s) => s.clear);

  const altId = (r: SearchRow) => `search-${r.lat_deg.toFixed(5)}_${r.lon_deg.toFixed(5)}`;
  const siteName = (r: SearchRow) => `Search result ${formatLat(r.lat_deg, 3)} ${formatLon(r.lon_deg, 3)}`;
  const where = (r: SearchRow) => `#${r.rank} · ${formatLat(r.lat_deg, 5)} ${formatLon(r.lon_deg, 5)}`;

  const add = (r: SearchRow) => {
    addAlternative({ id: altId(r), name: siteName(r), lat_deg: r.lat_deg, lon_deg: r.lon_deg, catalog_id: null });
    toast({ kind: "success", title: "Added to Compare", detail: where(r) });
  };
  const setSite = (r: SearchRow) => {
    editMany([
      [["site", "lat_deg"], r.lat_deg],
      [["site", "lon_deg"], r.lon_deg],
      [["site", "name"], siteName(r)],
      [["site", "catalog_id"], undefined],
    ]);
    toast({ kind: "success", title: "Site set", detail: `${where(r)} · best landing ${r.landing_utc} · plan landing unchanged` });
  };
  const showOnMap = (r: SearchRow) => {
    select(r.rank);
    navigate(exploreMapHref());
  };

  const multiEpoch = rows.some((r) => r.n_epochs > 1);
  const columns: Column<SearchRow>[] = [
    { key: "rank", header: "#", numeric: true, width: "36px", render: (r) => r.rank },
    { key: "pos", header: "Position", render: (r) => <span className="num">{`${formatLat(r.lat_deg, 5)} ${formatLon(r.lon_deg, 5)}`}</span> },
    {
      key: "state",
      header: "Verdict",
      render: (r) => (r.state === "unknown" ? <span className="faint">No verdict</span> : <VerdictChip verdict={r.state} compact />),
    },
    { key: "margin", header: "Margin", numeric: true, render: marginCell },
    { key: "norm", header: "Normalised margin", numeric: true, render: (r) => (r.normalised === null ? "–" : formatSigned(r.normalised, 3)) },
    {
      key: "limiting",
      header: "Limiting",
      render: (r) =>
        r.limitingKey === null ? (
          <span className="faint">–</span>
        ) : (
          <span className="se-limiting">
            {r.limitingLabel}
            {r.limitBasis && <span className="se-flag">{r.limitBasis}</span>}
          </span>
        ),
    },
    { key: "slope", header: "Slope", unit: "°", numeric: true, render: (r) => (r.slope_deg === null ? "–" : r.slope_deg.toFixed(1)) },
    ...(multiEpoch
      ? ([
          { key: "epochs", header: "Landings passing", numeric: true, render: (r) => `${r.n_epochs_pass}/${r.n_epochs}` },
          { key: "utc", header: "Best landing (UTC)", render: (r) => <span className="num">{r.landing_utc.replace("T", " ").replace(/:00Z$|Z$/, "")}</span> },
        ] satisfies Column<SearchRow>[])
      : []),
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      width: "96px",
      render: (r) => {
        const added = alternatives.some((a) => a.id === altId(r));
        return (
          <span className="toolstrip" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <IconButton
              icon={added ? "check" : "plus"}
              label={added ? "In Compare" : "Add to Compare"}
              aria-label={`${added ? "In Compare" : "Add to Compare"}, rank ${r.rank}`}
              size="sm"
              disabled={added}
              onClick={() => add(r)}
            />
            <IconButton icon="pin" label="Show on map" aria-label={`Show on map, rank ${r.rank}`} size="sm" onClick={() => showOnMap(r)} />
            <IconButton icon="site" label="Use as plan site" aria-label={`Use as plan site, rank ${r.rank}`} size="sm" onClick={() => setSite(r)} />
          </span>
        );
      },
    },
  ];

  const capped = result.levels.filter((l) => l.capped);
  const kindsNote = mixedKindsNote(result.sites.map((x) => x.margin_kind), "sites are listed in the engine's rank order (its precedence)");
  return (
    <>
      <div className="se-toolbar">
        <h2 className="se-count num">{plural(rows.length, "site")}</h2>
        <span className={`chip ${result.provider === "terrain" ? "se-chip-terrain" : ""}`}>{result.provider === "terrain" ? "Terrain horizon" : "Smooth sphere"}</span>
        <TerrainStackTag stack={result.terrain_stack} />
        <SearchValidationNote />
        {result.warnings.length > 0 && (
          <Popover label={plural(result.warnings.length, "warning")} icon="warn" tone="marginal" width={360}>
            <ul className="se-pop-list" aria-label="Engine warnings">
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Popover>
        )}
        <Popover label="Refinement" icon="layers" tone={capped.length > 0 ? "marginal" : "default"} width={360}>
          <div className="se-pop">
            <div className="se-stats">
              <Stat label="Full evaluations" value={result.n_full_evaluations.toLocaleString("en-US")} />
              <Stat label="Exhaustive equivalent" value={`≈ ${result.n_exhaustive_equivalent.toLocaleString("en-US")}`} />
              <Stat label="Compute time" value={result.seconds.toFixed(1)} unit="s" />
            </div>
            {capped.length > 0 && (
              <p className="se-pop-text se-capped">
                Promotion capped at {capped.map((l) => `${l.spacing_m} m`).join(", ")}: some grid points not refined
              </p>
            )}
            <Disclosure title="Method">
              <div className="se-pop-notes">
                <p className="se-pop-text">
                  Each margin is the engine&apos;s margin of the limiting requirement at the site&apos;s best landing time, in that requirement&apos;s unit: named worst-case, nominal or heading unknown as the engine states for that site. The normalised margin is that margin divided by the requirement&apos;s margin scale; the engine ranks by it.
                </p>
                <p className="se-pop-text">
                  The final grid shows the search&apos;s last refinement level, north up; a node&apos;s normalised margin exists only where the full horizon was run. Nodes outside the region are left empty.
                </p>
                {kindsNote && (
                  <p className="se-pop-text" role="note" data-testid="search-kinds-note">
                    {kindsNote}
                  </p>
                )}
              </div>
            </Disclosure>
          </div>
        </Popover>
        <LimitsChip limits={result.limits} stale={stale} />
        <span className="grow" />
        <IconButton icon="eyeOff" label="Hide results on map" size="sm" onClick={clear} />
      </div>
      <div className="se-result-body">
        <div className="se-table">
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => String(r.rank)}
            caption="Ranked sites"
            selectedKey={selectedRank === null ? null : String(selectedRank)}
            onRowClick={(r) => select(selectedRank === r.rank ? null : r.rank)}
            empty="No sites passed"
          />
        </div>
        <SearchGrid result={result} />
      </div>
    </>
  );
}
