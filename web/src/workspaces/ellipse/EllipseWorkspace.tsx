import { wrap360 } from "../../lib/scale";
import { useMemo, useState, type ReactNode } from "react";
import { usePublishScreenContext } from "../../ask/screenContext";
import { ELLIPSE_ENDPOINT, ELLIPSE_LIMITS, DEFAULT_PARAMS, ellipseBody, validateParams, type EllipseBody, type EllipseParams, type EllipseResult } from "../../api/ellipse";
import { usePublishEllipse } from "../../api/report";
import type { TerrainMode } from "../../api/planning";
import { useAnalysis } from "../../api/useAnalysis";
import { AnalysisStatus, OutOfDate } from "../../components/AnalysisStatus";
import { Button, IconButton } from "../../components/ui/Button";
import { Disclosure } from "../../components/ui/Disclosure";
import { EmptyState } from "../../components/ui/EmptyState";
import { Field, Toggle } from "../../components/ui/Fields";
import { Icon } from "../../components/ui/Icon";
import { PageHeader } from "../../components/ui/PageHeader";
import { Segmented } from "../../components/ui/Segmented";
import { Spinner } from "../../components/ui/Progress";
import { downloadText, slug } from "../../lib/download";
import { withUnit } from "../../lib/format";
import { OriginBadge } from "../../scenario/editor/controls";
import { useEditorUi } from "../../scenario/editor/editorUi";
import { useScenario } from "../../scenario/store";
import type { Ellipse, Scenario } from "../../scenario/types";
import { useApp } from "../../state/store";
import "../../styles/ellipse.css";
import { ReportButton } from "../ReportButton";
import { ValidationNote } from "../search/ValidationNote";
import { LimitsChip } from "../site/LimitsChip";
import { SiteTabs } from "../site/SiteTabs";
import { countStates, plotHalfWidth, samplesCsv, STATES, STATE_LABEL } from "./adapt";
import { EllipsePlot, type Marker } from "./EllipsePlot";
import { ConstraintTable, PointsPanel, ResultDetails, ResultStats, Warnings } from "./Results";
import { useBackdrop } from "./useBackdrop";

const TERRAIN: Array<{ value: TerrainMode; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "on", label: "Terrain" },
  { value: "off", label: "Smooth sphere" },
];

const HORIZON_NAME: Record<TerrainMode, string> = { auto: "terrain when available", on: "terrain horizon", off: "smooth sphere" };

interface Draft {
  n: string;
  seed: string;
  cells: string;
  slope: string;
  rough: string;
  truncate: boolean;
}

const INITIAL: Draft = {
  n: String(DEFAULT_PARAMS.n_samples),
  seed: String(DEFAULT_PARAMS.seed),
  cells: String(DEFAULT_PARAMS.map_cells),
  slope: "",
  rough: "",
  truncate: DEFAULT_PARAMS.truncate,
};

const optional = (s: string) => (s.trim() === "" ? null : Number(s));
const toParams = (d: Draft): EllipseParams => ({
  n_samples: d.n.trim() === "" ? Number.NaN : Number(d.n),
  seed: d.seed.trim() === "" ? Number.NaN : Number(d.seed),
  truncate: d.truncate,
  map_cells: optional(d.cells),
  hazard_slope_deg: optional(d.slope),
  hazard_roughness_m: optional(d.rough),
});

const VALIDATION_SOURCES = [{ doc: "validation/scenario", label: "docs/validation/scenario.md, section 9 (Landing-ellipse statistics)" }];
const VALIDATION_PREVIEW = "Pass share is a sample fraction with its sampling error, not an accuracy claim";

export function EllipseWorkspace() {
  const doc = useScenario((s) => s.doc)!;
  const show = useEditorUi((s) => s.show);
  const [draft, setDraft] = useState<Draft>(INITIAL);
  const [terrain, setTerrain] = useState<TerrainMode>("auto");
  const [submitted, setSubmitted] = useState<EllipseBody | null>(null);

  const params = useMemo(() => toParams(draft), [draft]);
  const problems = useMemo(() => validateParams(params, doc), [params, doc]);
  const body = useMemo(() => ellipseBody(doc, params, terrain), [doc, params, terrain]);
  const dirty = submitted === null || JSON.stringify(body) !== JSON.stringify(submitted);

  const analysis = useAnalysis<EllipseResult>(ELLIPSE_ENDPOINT, submitted, { debounceMs: 0 });
  const result = analysis.result;
  usePublishEllipse(result !== null ? submitted : null, analysis.stale || dirty || analysis.phase === "running");
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const fieldError = (prefix: string) => problems.find((p) => p.startsWith(prefix)) ?? null;
  const err = { n: fieldError("Samples"), seed: fieldError("Seed"), cells: fieldError("Map nodes"), slope: fieldError("Hazard slope"), rough: fieldError("Hazard roughness") };

  const ell = doc.ellipse;
  const running = analysis.phase === "running";
  const stale = analysis.stale || dirty || running;
  const run = () => {
    if (problems.length === 0) setSubmitted(body);
  };
  usePublishScreenContext({
    where: "Site, Landing accuracy",
    summary: ell ? "" : "no landing ellipse set",
    lines: [
      ell
        ? `The landing ellipse is ${ell.semi_major_m} by ${ell.semi_minor_m} m, major axis azimuth ${ell.azimuth_deg} deg clockwise from north, ${ell.dispersion === "gaussian" ? `Gaussian with axes at ${ell.sigma_level} sigma` : "uniform"}.`
        : "The plan has no landing ellipse.",
      `Sampling: ${draft.n || "no"} points, seed ${draft.seed || "none"}, verdict map ${draft.cells ? `${draft.cells} nodes per side` : "off"}.`,
      `Hazard slope ${draft.slope ? `${draft.slope} deg` : "the plan's slope requirement"}, hazard roughness ${draft.rough ? `${draft.rough} m` : "none"}, horizon model ${HORIZON_NAME[terrain]}.`,
      ...(ell?.dispersion === "gaussian" ? [`Points are ${draft.truncate ? "kept inside" : "not limited to"} the ellipse.`] : []),
    ],
  });

  const outOfDate = result !== null && dirty && !analysis.stale && !running && analysis.phase !== "error";
  const status: ReactNode = outOfDate ? <OutOfDate state={{ ...analysis, rerun: run }} /> : <AnalysisStatus state={analysis} what="the landing-ellipse statistics" />;
  const failed = analysis.phase === "error";
  const advancedError = err.seed ?? err.cells ?? err.slope ?? err.rough;

  return (
    <div className="el" aria-label="Landing accuracy page">
      <h1 className="sr-only">Landing accuracy: {doc.name}</h1>
      <PageHeader
        tabs={<SiteTabs />}
        actions={
          <>
            <ValidationNote preview={VALIDATION_PREVIEW} sources={VALIDATION_SOURCES} />
            {result && <LimitsChip limits={result.limits} stale={stale} align="end" />}
            {result?.samples && (
              <IconButton icon="download" label="Download points CSV" onClick={() => downloadText(`ellipse-${slug(result.scenario_name)}-n${result.n_samples}-seed${result.seed}.csv`, samplesCsv(result), "text/csv")} />
            )}
            <ReportButton />
            <Button type="submit" form="el-form" variant={dirty ? "primary" : "default"} icon="play" disabled={problems.length > 0 || running}>
              Sample ellipse
            </Button>
          </>
        }
      >
        {!failed && status}
      </PageHeader>
      {failed && <div className="el-notice">{status}</div>}
      <div className="el-body">
        <form
          id="el-form"
          className="el-side"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <EllipseSummary ellipse={ell} onEdit={() => show("ellipse")} />
          <div className="el-params">
            <Field label="Points" htmlFor="el-n" error={err.n}>
              <input id="el-n" className="input" type="number" inputMode="numeric" min={ELLIPSE_LIMITS.nSamples.min} max={ELLIPSE_LIMITS.nSamples.max} step={1} aria-invalid={err.n !== null} value={draft.n} onChange={(e) => set("n", e.target.value)} />
            </Field>
            <div className="field">
              <span className="field-label" id="el-horizon-label">
                Horizon
              </span>
              <Segmented label="Horizon model" value={terrain} onChange={(v) => setTerrain(v as TerrainMode)} options={TERRAIN} />
            </div>
            <Disclosure key={advancedError ? "invalid" : "valid"} title="Advanced" defaultOpen={advancedError !== null}>
              <div className="el-advanced">
                <div className="field-row">
                  <Field label="Seed" htmlFor="el-seed" error={err.seed}>
                    <input id="el-seed" className="input" type="number" inputMode="numeric" min={0} step={1} aria-invalid={err.seed !== null} value={draft.seed} onChange={(e) => set("seed", e.target.value)} />
                  </Field>
                  <Field label="Map nodes" htmlFor="el-cells" error={err.cells}>
                    <input
                      id="el-cells"
                      className="input"
                      type="number"
                      inputMode="numeric"
                      min={ELLIPSE_LIMITS.mapCells.min}
                      max={ELLIPSE_LIMITS.mapCells.max}
                      step={1}
                      placeholder="none"
                      aria-invalid={err.cells !== null}
                      value={draft.cells}
                      onChange={(e) => set("cells", e.target.value)}
                    />
                  </Field>
                </div>
                <div className="field-row">
                  <Field label="Hazard slope" htmlFor="el-slope" error={err.slope}>
                    <span className="input-group">
                      <input id="el-slope" className="input" type="number" inputMode="decimal" min={0} max={90} step="any" placeholder="requirement" aria-invalid={err.slope !== null} value={draft.slope} onChange={(e) => set("slope", e.target.value)} />
                      <span className="input-unit">°</span>
                    </span>
                  </Field>
                  <Field label="Roughness" htmlFor="el-rough" error={err.rough}>
                    <span className="input-group">
                      <input id="el-rough" className="input" type="number" inputMode="decimal" min={0} step="any" placeholder="none" aria-invalid={err.rough !== null} value={draft.rough} onChange={(e) => set("rough", e.target.value)} />
                      <span className="input-unit">m</span>
                    </span>
                  </Field>
                </div>
                {ell?.dispersion === "gaussian" && <Toggle checked={draft.truncate} onChange={(v) => set("truncate", v)} label="Keep points inside" />}
              </div>
            </Disclosure>
          </div>
        </form>
        <ResultArea doc={doc} result={result} stale={stale} onEdit={() => show("ellipse")} />
      </div>
    </div>
  );
}

function EllipseSummary({ ellipse, onEdit }: { ellipse: Ellipse | null | undefined; onEdit: () => void }) {
  return (
    <section className="el-ellipse" aria-label="Landing ellipse">
      <div className="el-ellipse-head">
        <h2 className="el-title">Ellipse</h2>
        {ellipse && <OriginBadge origin={ellipse.origin} />}
        <span className="grow" />
        <IconButton icon="sliders" label="Edit ellipse" size="sm" onClick={onEdit} />
      </div>
      {ellipse && (
        <dl className="el-dl">
          <div className="el-dl-row">
            <dt>Semi-major</dt>
            <dd className="num">{withUnit(String(ellipse.semi_major_m), "m")}</dd>
          </div>
          <div className="el-dl-row">
            <dt>Semi-minor</dt>
            <dd className="num">{withUnit(String(ellipse.semi_minor_m), "m")}</dd>
          </div>
          <div className="el-dl-row">
            <dt>Azimuth</dt>
            <dd className="num">{String(Math.round(wrap360(ellipse.azimuth_deg))).padStart(3, "0")}°</dd>
          </div>
          <div className="el-dl-row">
            <dt>Dispersion</dt>
            <dd>{ellipse.dispersion === "gaussian" ? "Gaussian" : "Uniform"}</dd>
          </div>
          {ellipse.dispersion === "gaussian" && (
            <div className="el-dl-row">
              <dt>Axes at</dt>
              <dd className="num">{ellipse.sigma_level}σ</dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}

function ResultArea({ doc, result, stale, onEdit }: { doc: Scenario; result: EllipseResult | null; stale: boolean; onEdit: () => void }) {
  const [layers, setLayers] = useState({ terrain: true, map: true, samples: true });
  const [selected, setSelected] = useState<Marker | null>(null);
  const dark = useApp((s) => s.theme) === "dark";

  const scenario = (result?.scenario ?? doc) as { ellipse?: Ellipse | null; site?: { lat_deg: number; lon_deg: number } };
  const ellipse = scenario.ellipse ?? null;
  const site = scenario.site ?? null;
  const useTerrain = ellipse !== null && site !== null && (layers.terrain || result === null);
  const backdrop = useBackdrop(site?.lat_deg ?? 0, site?.lon_deg ?? 0, ellipse ? 2 * plotHalfWidth(ellipse) : 0, useTerrain, dark);

  if (!ellipse) {
    return (
      <div className="el-main">
        <EmptyState
          icon="ellipse"
          title="No landing ellipse in this plan"
          action={
            <Button onClick={onEdit} icon="sliders">
              Add ellipse
            </Button>
          }
        />
      </div>
    );
  }
  if (!result && backdrop.status !== "ok" && backdrop.status !== "loading") {
    return (
      <div className="el-main">
        <EmptyState icon="ellipse" title="Not sampled yet" />
      </div>
    );
  }

  const counts = result?.samples ? countStates(result.samples) : null;
  const description = `Landing ellipse ${ellipse.semi_major_m} by ${ellipse.semi_minor_m} metres, major axis azimuth ${ellipse.azimuth_deg} degrees, north up. ${
    counts && result ? STATES.map((s) => `${counts[s]} ${STATE_LABEL[s].toLowerCase()}`).join(", ") + " of " + result.n_samples + " points." : ""
  }`;
  const toggle = (k: keyof typeof layers) => setLayers((l) => ({ ...l, [k]: !l[k] }));

  return (
    <div className={`el-main ${result && stale ? "is-stale" : ""}`}>
      {result && <ResultStats result={result} />}
      <div className="el-view">
        <div className="el-plotcol">
          <EllipsePlot
            ellipse={ellipse}
            samples={result?.samples ?? null}
            map={result?.map ?? null}
            refs={result ? { centre: result.centre, worst: result.worst, best: result.best } : null}
            backdrop={backdrop}
            layers={result ? layers : { terrain: true, map: false, samples: false }}
            selected={selected}
            description={description}
          />
          {result && (
            <div className="el-plotbar">
              <ul className="el-keys" aria-label="Legend">
                <li>
                  <span className="el-glyph el-glyph-pass" aria-hidden="true">●</span> Pass
                </li>
                <li>
                  <span className="el-glyph el-glyph-marginal" aria-hidden="true">▲</span> Marginal
                </li>
                <li>
                  <span className="el-glyph el-glyph-fail" aria-hidden="true">✕</span> Fail
                </li>
                <li>
                  <span className="el-glyph el-glyph-unknown" aria-hidden="true">◆</span> Unknown
                </li>
              </ul>
              <span className="grow" />
              {backdrop.status === "loading" && <Spinner size={12} />}
              {backdrop.status === "error" && (
                <span className="el-relief-error">
                  <Icon name="warn" size={12} /> {backdrop.error?.message ?? "Could not load relief"}
                </span>
              )}
              <div className="toolstrip" role="group" aria-label="Plot layers">
                <Button size="sm" variant="ghost" icon="terrain" aria-pressed={layers.terrain} disabled={backdrop.status === "none" || backdrop.status === "error"} onClick={() => toggle("terrain")}>
                  Terrain
                </Button>
                <Button size="sm" variant="ghost" icon="layers" aria-pressed={layers.map} disabled={!result.map} onClick={() => toggle("map")}>
                  Verdict map
                </Button>
                <Button size="sm" variant="ghost" icon="target" aria-pressed={layers.samples} disabled={!result.samples} onClick={() => toggle("samples")}>
                  Points
                </Button>
              </div>
            </div>
          )}
        </div>
        {result && (
          <div className="el-detailcol">
            <Warnings result={result} />
            <PointsPanel result={result} selected={selected} onSelect={setSelected} />
            <ConstraintTable result={result} />
            <ResultDetails result={result} relief={backdrop.image?.resolution ?? null} />
          </div>
        )}
      </div>
    </div>
  );
}
