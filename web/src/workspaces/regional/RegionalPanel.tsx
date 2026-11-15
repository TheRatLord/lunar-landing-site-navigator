import { usePublishScreenContext } from "../../ask/screenContext";
import { useEffect, useId, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, apiUrl, reportError } from "../../api/client";
import { deleteExportOutcome, exportDigest } from "../../api/exports";
import {
  METRIC_BY_KEY,
  MAX_REGIONAL_CELLS,
  REGIONAL_ENDPOINT,
  REGIONAL_METRICS,
  checkRegional,
  regionalBody,
  type BoundKind,
  type RegionalBody,
  type RegionalInput,
  type RegionalResult,
} from "../../api/regional";
import { useAnalysis } from "../../api/useAnalysis";
import { Button, IconButton } from "../../components/ui/Button";
import { Disclosure } from "../../components/ui/Disclosure";
import { EmptyState } from "../../components/ui/EmptyState";
import { DateTimeInput, Select } from "../../components/ui/Fields";
import { PageHeader } from "../../components/ui/PageHeader";
import { Popover } from "../../components/ui/Popover";
import { Segmented } from "../../components/ui/Segmented";
import { Stat } from "../../components/ui/Stat";
import { formatSig } from "../../lib/format";
import { MS_DAY, MS_HOUR, parseUtc, toIsoUtc } from "../../lib/time";
import { niceSpacing_m, usePlanSearch } from "../../scenario/planSearch";
import { useScenario } from "../../scenario/store";
import { UNPUBLISHED_BASES } from "../../scenario/types";
import "../../styles/regional.css";
import { AnalysisStatus, OutOfDate } from "../../components/AnalysisStatus";
import { exploreMapHref } from "../explore/exploreMapHref";
import { ExploreTabs } from "../explore/ExploreTabs";
import { RegionalStackTag } from "../search/TerrainStackTag";
import { RegionalValidationNote } from "./RegionalValidationNote";
import { RegionalHeatmap, SupportDetails } from "./RegionalHeatmap";
import {
  type RegionalHeaderInfo,
  type RegionalLayerView,
  bracketWidth,
  layerName,
  layerSupport,
  metricDomain,
  regionalHeaderInfo,
  pointValueAllowed,
  regionalLayer,
  bracketShifts,
  bracketedMetrics,
  type BracketedMetric,
  type LayerSupport,
  pairs,
} from "./regionalLayer";
import { useRegionalLayer } from "./regionalLayerStore";
import { Pairs } from "../../components/ui/Pairs";

const num = (s: string): number => (s.trim() === "" ? Number.NaN : Number(s));

const STEPS = [
  { value: "1800", label: "30 min" },
  { value: "3600", label: "1 h" },
  { value: "7200", label: "2 h" },
  { value: "21600", label: "6 h" },
];

type Shown = BoundKind | "verdict";

const fileKb = (n: number) => `${Math.max(1, Math.round(n / 1024)).toLocaleString("en-US")} kB`;
const count = (n: number) => n.toLocaleString("en-US");

function NumField({ label, value, onChange, unit, placeholder }: { label: string; value: string; onChange: (v: string) => void; unit?: string; placeholder?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <span className="input-group">
        <input id={id} className="input num" inputMode="decimal" autoComplete="off" spellCheck={false} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
        {unit && <span className="input-unit">{unit}</span>}
      </span>
    </div>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: number; onChange: (ms: number) => void }) {
  return (
    <div className="field">
      <span className="field-label" aria-hidden="true">
        {label}
      </span>
      <DateTimeInput compact label={`Period ${label.toLowerCase()} (UTC)`} value={value} onChange={onChange} />
    </div>
  );
}

export function RegionalPanel() {
  const doc = useScenario((s) => s.doc);
  const uid = useId();
  const navigate = useNavigate();
  const landingMs = (doc && parseUtc(doc.landing_utc)) ?? Date.UTC(2027, 0, 1);
  const durationMs = doc ? doc.mission_duration_h * MS_HOUR : 30 * MS_DAY;
  const [lat, setLat] = useState(doc ? doc.site.lat_deg.toFixed(5) : "-89.5");
  const [lon, setLon] = useState(doc ? doc.site.lon_deg.toFixed(5) : "0");
  const [plan] = useState(() => usePlanSearch.getState());
  const side_m = plan.radius_km === null ? 5000 : Math.min(200_000, plan.radius_km * 2000);
  const [size, setSize] = useState(String(side_m));
  const [spacing, setSpacing] = useState(String(niceSpacing_m(side_m / 2)));
  const [startMs, setStartMs] = useState(plan.window?.first_ms ?? landingMs);
  const [stopMs, setStopMs] = useState(plan.window?.last_ms ?? landingMs + durationMs);
  const [step, setStep] = useState("3600");
  const [mast, setMast] = useState("0");
  const [metric, setMetric] = useState("sunlit_fraction");
  const [limitOp, setLimitOp] = useState<">=" | "<=">(">=");
  const [limitValue, setLimitValue] = useState("");
  const [submitted, setSubmitted] = useState<{
    body: RegionalBody;
    metric: string;
    inline: boolean;
  } | null>(null);
  const [bound, setBound] = useState<Shown>("value");

  const limitOn = limitValue.trim() !== "";
  const input: RegionalInput = {
    lat_deg: num(lat),
    lon_deg: num(lon),
    size_m: num(size),
    spacing_m: num(spacing),
    start_utc: toIsoUtc(startMs),
    stop_utc: toIsoUtc(stopMs),
    step_s: num(step),
    mast_height_m: num(mast),
    metric,
    limit: limitOn ? { op: limitOp, value: num(limitValue) } : null,
  };
  const check = checkRegional(input);
  const spec = METRIC_BY_KEY[metric]!;

  const analysis = useAnalysis<RegionalResult>(REGIONAL_ENDPOINT, submitted?.body ?? null, { debounceMs: 0 });
  const result = analysis.result;
  const currentBody = check.errors.length === 0 ? regionalBody(input, check.inlineOk) : null;
  const formChanged = submitted !== null && !analysis.stale && JSON.stringify(currentBody) !== JSON.stringify(submitted.body);
  const outOfDate = result !== null && (analysis.stale || formChanged || analysis.phase === "running");
  const submit = () => {
    if (check.errors.length === 0) {
      setSubmitted({
        body: regionalBody(input, check.inlineOk),
        metric,
        inline: check.inlineOk,
      });
      setBound("value");
    }
  };
  const shown = submitted?.metric ?? metric;
  const shownSpec = METRIC_BY_KEY[shown] ?? spec;

  const info = useMemo(() => (result ? regionalHeaderInfo(result) : null), [result]);
  const support = useMemo(() => (result ? layerSupport(result, shown) : null), [result, shown]);
  const hasVerdict = result !== null && "verdict" in result.inline;
  const effBound: Shown = bound === "verdict" ? (hasVerdict ? "verdict" : "value") : bound === "value" && !pointValueAllowed(support) ? "lo" : bound;
  const layer = effBound === "verdict" ? "verdict" : layerName(shown, effBound);
  const view = useMemo(() => {
    if (!result) return null;
    return regionalLayer(result, layer, layer === "verdict" ? null : metricDomain(result, shown));
  }, [result, layer, shown]);
  const published = analysis.phase === "done" && !analysis.stale && submitted !== null && result !== null;
  useEffect(() => {
    if (!published || !submitted || !result) {
      useRegionalLayer.setState({ shown: null });
      return;
    }
    useRegionalLayer.setState({
      shown: { result, request: submitted.body, stale: formChanged, metric: shown, layer, domain: layer === "verdict" ? null : metricDomain(result, shown), support },
    });
  }, [published, submitted, result, shown, layer, support, formChanged]);
  const arrayHeight = doc?.profile.array_height_m;
  const arrayBasis = doc?.profile.origins?.["array_height_m"]?.basis;

  const title = view ? (view.legend.kind === "verdict" ? "Verdict against the threshold" : `${shownSpec.label}${effBound === "value" || shownSpec.exact ? "" : ` (${effBound === "lo" ? "bracket low" : "bracket high"})`}`) : "";

  usePublishScreenContext({
    where: "Explore, Regional layer",
    summary: spec.label,
    lines: [
      `The region is a square of side ${size || "unset"} m around latitude ${lat || "unset"}, longitude ${lon || "unset"}, with ${spacing || "unset"} m cells.`,
      `The period runs from ${toIsoUtc(startMs)} to ${toIsoUtc(stopMs)} in steps of ${step} s, with a mast height of ${mast || "unset"} m.`,
      `The metric selected is ${spec.label}${spec.unit ? ` (${spec.unit})` : ""}.`,
      ...(limitOn ? [`A pass threshold is asked for: at ${limitOp === ">=" ? "least" : "most"} ${limitValue} ${spec.unit}.`] : []),
    ],
  });

  const formId = `${uid}-form`;
  const tooMany = Number.isFinite(check.cells) && check.cells > MAX_REGIONAL_CELLS;
  const layerOptions = [
    ...(shownSpec.exact
      ? [{ value: "value", label: "Value" }]
      : [
          { value: "lo", label: "Low" },
          { value: "value", label: "Value", disabled: !pointValueAllowed(support) },
          { value: "hi", label: "High" },
        ]),
    ...(hasVerdict ? [{ value: "verdict", label: "Verdict" }] : []),
  ];
  const shownErrors = tooMany ? check.errors.filter((m) => !m.startsWith("This is ")) : check.errors;
  const unitSuffix = spec.unit && spec.unit !== "fraction" ? spec.unit : undefined;

  return (
    <>
      <h1 className="sr-only">Regional layer</h1>
      <PageHeader
        tabs={<ExploreTabs />}
        actions={
          <>
            {formChanged && analysis.phase !== "running" && analysis.phase !== "error" ? (
              <OutOfDate state={{ ...analysis, rerun: submit }} />
            ) : (
              <AnalysisStatus state={analysis} what="the regional layers" />
            )}
            <RegionalValidationNote />
            <Button
              type="submit"
              form={formId}
              variant="primary"
              size="sm"
              icon="play"
              disabled={check.errors.length > 0}
              aria-describedby={shownErrors.length > 0 ? `${uid}-errors` : undefined}
            >
              Compute layer
            </Button>
          </>
        }
      />
      <div className="rg-body">
        <form
          id={formId}
          className="rg-params"
          aria-label="Region and period"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="field-row">
            <NumField label="Latitude" value={lat} onChange={setLat} unit="°" />
            <NumField label="Longitude" value={lon} onChange={setLon} unit="°E" />
          </div>
          <div className="field-row">
            <NumField label="Side" value={size} onChange={setSize} unit="m" />
            <NumField label="Cell spacing" value={spacing} onChange={setSpacing} unit="m" />
          </div>
          <div className="field-row">
            <TimeField label="Start" value={startMs} onChange={setStartMs} />
            <TimeField label="End" value={stopMs} onChange={setStopMs} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${uid}-metric`}>
              Metric
            </label>
            <Select
              id={`${uid}-metric`}
              aria-label="Metric"
              value={metric}
              options={REGIONAL_METRICS.map((m) => ({
                value: m.key,
                label: `${m.label}${m.unit ? ` (${m.unit})` : ""}`,
              }))}
              onChange={setMetric}
            />
          </div>
          <div className="rg-cells" aria-live="polite">
            {Number.isFinite(check.cells) && check.side >= 1 && (
              <Stat
                label="Cells"
                value={count(check.cells)}
                tone={tooMany ? "fail" : "default"}
                sub={tooMany ? `max ${count(MAX_REGIONAL_CELLS)}` : `${check.side} × ${check.side}${check.inlineOk ? "" : " · GeoTIFF download only"}`}
              />
            )}
          </div>
          <div className="rg-advanced">
            <Disclosure title="Advanced">
              <div className="rg-adv-body">
                <div className="field-row">
                  <div className="field">
                    <label className="field-label" htmlFor={`${uid}-step`}>
                      Time step
                    </label>
                    <Select id={`${uid}-step`} aria-label="Time step" value={step} options={STEPS} onChange={setStep} />
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor={`${uid}-mast`}>
                      Mast height
                    </label>
                    <span className="rg-mast">
                      <span className="input-group grow">
                        <input id={`${uid}-mast`} className="input num" inputMode="decimal" autoComplete="off" value={mast} onChange={(e) => setMast(e.target.value)} />
                        <span className="input-unit">m</span>
                      </span>
                      {typeof arrayHeight === "number" && (
                        <IconButton icon="battery" label={`Array height, ${arrayHeight} m`} size="sm" pressed={num(mast) === arrayHeight} onClick={() => setMast(String(arrayHeight))} />
                      )}
                    </span>
                    {typeof arrayHeight === "number" && arrayBasis && UNPUBLISHED_BASES.has(arrayBasis) && num(mast) === arrayHeight && (
                      <span className="chip chip-marginal rg-est" title={`Array height basis: ${arrayBasis}`}>
                        {arrayBasis}
                      </span>
                    )}
                  </div>
                </div>
                <div className="field">
                  <label className="field-label" htmlFor={`${uid}-limit`}>
                    Pass threshold
                  </label>
                  <span className="rg-limit">
                    <Select
                      aria-label="Threshold direction"
                      className="rg-limit-op"
                      value={limitOp}
                      options={[
                        { value: ">=", label: "≥" },
                        { value: "<=", label: "≤" },
                      ]}
                      onChange={(v) => setLimitOp(v as ">=" | "<=")}
                    />
                    <span className="input-group grow">
                      <input
                        id={`${uid}-limit`}
                        className="input num"
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder={spec.unit === "fraction" ? "0–1" : "none"}
                        value={limitValue}
                        onChange={(e) => setLimitValue(e.target.value)}
                      />
                      {unitSuffix && <span className="input-unit">{unitSuffix}</span>}
                    </span>
                  </span>
                </div>
              </div>
            </Disclosure>
          </div>
          {shownErrors.length > 0 && (
            <ul id={`${uid}-errors`} role="alert" className="rg-errors">
              {shownErrors.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </form>

        <section className={`rg-stage${outOfDate ? " rg-stale" : ""}`} aria-label="Regional layer">
          {!result ? (
            <EmptyState icon="layers" title={analysis.phase === "running" ? "Computing" : "No layer yet"} />
          ) : (
            <>
              <div className="rg-toolbar">
                {submitted?.inline !== false && (
                  <Segmented label="Layer shown" size="sm" value={effBound} options={layerOptions} onChange={(v) => setBound(v as Shown)} />
                )}
                <span className="grow" />
                <RegionalStackTag result={result} />
                {info && <DetailsPopover info={info} bracketed={bracketedMetrics(result)} support={support} shown={shown} hasVerdict={hasVerdict} layers={result.layers.length} view={view} />}
                <FilesPopover result={result} />
                {view && (
                  <Button size="sm" icon="map" onClick={() => navigate(mapHref(view.grid.hemisphere))}>
                    Show on map
                  </Button>
                )}
              </div>
              {submitted && !submitted.inline ? (
                <EmptyState icon="download" title="GeoTIFF download only" />
              ) : view ? (
                <RegionalHeatmap view={view} title={title} unit={shownSpec.unit} support={support} />
              ) : (
                <EmptyState icon="layers" title="Too large to draw here" />
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}

/** The Map tab on the polar view of the layer, keeping the map's own query when it already shows that view. */
function mapHref(hemisphere: string): string {
  const href = exploreMapHref();
  return new URLSearchParams(href.split("?")[1] ?? "").get("view") === hemisphere ? href : `/explore?view=${hemisphere}`;
}

function FilesPopover({ result }: { result: RegionalResult }) {
  const [removed, setRemoved] = useState<RegionalResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const gone = removed === result;
  const digest = result.layers.length > 0 ? exportDigest(result.layers[0]!.file.url) : null;
  const n = result.layers.length;
  const remove = async () => {
    if (!digest) return;
    if (!window.confirm(`Delete ${n} GeoTIFF file${n === 1 ? "" : "s"} and the run header from the engine?`)) return;
    setBusy(true);
    setProblem(null);
    const outcome = await deleteExportOutcome(digest);
    if (outcome.removed) setRemoved(result);
    else {
      setProblem(outcome.problem);
      if (!(outcome.error instanceof ApiError)) reportError(outcome.error, "Could not delete the files");
    }
    setBusy(false);
  };
  return (
    <Popover label={`${n} file${n === 1 ? "" : "s"}`} icon="download" align="end" width={680}>
      <div className="rg-pop-head">
        <span className="rg-pop-title">GeoTIFF layers</span>
        {gone ? (
          <span className="chip">Deleted</span>
        ) : (
          <Button size="sm" variant="ghost" icon="trash" disabled={busy || !digest} onClick={() => void remove()}>
            {busy ? "Deleting files…" : "Delete files"}
          </Button>
        )}
      </div>
      {problem && (
        <p className="rg-bad" role="alert">
          {problem}
        </p>
      )}
      <table className="table rg-table">
        <caption className="sr-only">Regional layers with the engine&apos;s statistics</caption>
        <thead>
          <tr>
            <th scope="col">Layer</th>
            <th scope="col" className="num-col">
              Min
            </th>
            <th scope="col" className="num-col">
              Mean
            </th>
            <th scope="col" className="num-col">
              Max
            </th>
            <th scope="col" className="num-col">
              No data
            </th>
            <th scope="col">File</th>
          </tr>
        </thead>
        <tbody>
          {result.layers.map((l) => (
            <tr key={l.name}>
              <th scope="row">{l.name}</th>
              <td className="num-col num">{l.min === null ? "–" : formatSig(l.min, 4)}</td>
              <td className="num-col num">{l.mean === null ? "–" : formatSig(l.mean, 4)}</td>
              <td className="num-col num">{l.max === null ? "–" : formatSig(l.max, 4)}</td>
              <td className="num-col num">{count(l.n_nodata)}</td>
              <td>
                {gone ? (
                  <span className="faint">deleted</span>
                ) : (
                  <a href={apiUrl(l.file.url)} download={l.file.name} className="rg-file">
                    <span>{l.file.name}</span>
                    <span className="faint num">{fileKb(l.file.size_bytes)}</span>
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Popover>
  );
}

const STEP_H = (s: number) => (s % 3600 === 0 ? `${s / 3600} h` : `${s} s`);

function DetailsPopover({
  info,
  bracketed,
  support,
  shown,
  hasVerdict,
  layers,
  view,
}: {
  info: RegionalHeaderInfo;
  bracketed: readonly BracketedMetric[];
  support: LayerSupport | null;
  shown: string;
  hasVerdict: boolean;
  layers: number;
  view: RegionalLayerView | null;
}) {
  const { warnings, coverage, cellsFlagged, flagRadius, calibration, run, timing, grid, provenance } = info;
  const shifts = calibration ? bracketShifts(calibration, bracketed) : null;
  const width = bracketWidth(info, shown);
  const g = view?.grid;
  const gridRows = pairs(
    g && ["Cells", `${g.n_rows} × ${g.n_cols} · ${g.spacing_m} m`],
    g && ["Up", "+y of the grid"],
    grid?.crs && ["Projection", <code key="crs">{grid.crs}</code>],
    grid?.registration && ["Registration", grid.registration],
    ["Layers", count(layers)],
  );
  const coverageRows = pairs(
    coverage && ["With terrain", count(coverage.cells_with_terrain)],
    coverage && ["Without terrain", count(coverage.cells_without_terrain)],
    cellsFlagged !== null && ["Near boundary", count(cellsFlagged)],
    flagRadius && ["Boundary radius", `${flagRadius.cells} cells · ${flagRadius.m} m`],
  );
  const runRows = pairs(
    run?.n_epochs != null && ["Time samples", count(run.n_epochs)],
    run?.step_s != null && ["Step", STEP_H(run.step_s)],
    run?.mast_height_m != null && ["Mast", `${run.mast_height_m} m`],
    run?.sun_rule && ["Sun rule", run.sun_rule],
    run?.earth_rule && ["Earth rule", run.earth_rule],
    run?.n_az != null && ["Azimuths", count(run.n_az)],
    run?.engine && ["Horizon engine", run.engine],
    run?.config_hash && ["Configuration", run.config_hash.slice(0, 12)],
    timing && ["Wall time", `${timing.wall_s.toFixed(1)} s${timing.cells !== null ? ` · ${count(timing.cells)} cells` : ""}`],
    provenance && ["Code", provenance.code ?? "not stated"],
    provenance?.packageSourceSha256 && ["Source sha256", `${provenance.packageSourceSha256.slice(0, 12)}…`],
  );
  return (
    <Popover label={warnings.length > 0 ? `${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : "Details"} icon={warnings.length > 0 ? "alert" : "info"} tone={warnings.length > 0 ? "marginal" : "default"} align="end" width={520}>
      {warnings.length > 0 && (
        <ul className="rg-warnings" aria-label="Engine warnings for this run">
          {warnings.map((w) => (
            <li key={w}>
              <span className="rg-warn-icon" aria-hidden="true">
                ▲
              </span>
              {w}
            </li>
          ))}
        </ul>
      )}
      <Disclosure title="Grid" count={gridRows.length}>
        <Pairs className="rg-dl" rows={gridRows} />
      </Disclosure>
      {coverageRows.length > 0 && (
        <Disclosure title="Coverage" count={coverageRows.length}>
          <Pairs className="rg-dl" rows={coverageRows} />
        </Disclosure>
      )}
      {(support || width) && (
        <Disclosure title="Accuracy">
          <SupportDetails support={support} width={width} />
        </Disclosure>
      )}
      {calibration && (
        <Disclosure title="Bracket calibration">
          <Pairs
            className="rg-dl"
            rows={[
              ["Cells", count(calibration.n_cells)],
              calibration.quantile !== null && ["Quantile", `${(calibration.quantile * 100).toFixed(0)} %`],
              shifts && ["Horizon lowered", shifts.lowered.replace(/^[+\u2212]/, "")],
              shifts && ["Horizon raised", shifts.raised.replace(/^[+\u2212]/, "")],
            ]}
          />
          {shifts && shifts.perLayer.length > 0 && (
            <table className="table rg-table" aria-label="Horizon shift behind each layer's bracket">
              <thead>
                <tr>
                  <th scope="col">Layer</th>
                  <th scope="col">Low</th>
                  <th scope="col">High</th>
                </tr>
              </thead>
              <tbody>
                {shifts.perLayer.map((s) => (
                  <tr key={s.layer}>
                    <th scope="row">{METRIC_BY_KEY[s.layer]?.label ?? s.layer}</th>
                    <td className="num">{s.low ?? "not stated"}</td>
                    <td className="num">{s.high ?? "not stated"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Disclosure>
      )}
      {hasVerdict && (
        <Disclosure title="Verdict rule">
          <Pairs
            className="rg-dl"
            rows={[
              ["Pass", "pessimistic bracket end meets the threshold"],
              ["Marginal", "threshold inside the bracket"],
              ["Fail", "optimistic bracket end misses the threshold"],
            ]}
          />
        </Disclosure>
      )}
      {runRows.length > 0 && (
        <Disclosure title="Run" count={runRows.length}>
          <Pairs className="rg-dl" rows={runRows} />
        </Disclosure>
      )}
    </Popover>
  );
}
