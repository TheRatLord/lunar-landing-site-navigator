import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { usePublishScreenContext } from "../../ask/screenContext";
import { ELLIPSE_LIMITS, ellipseBody, type EllipseParams, type EllipseResult } from "../../api/ellipse";
import { AnalysisStatus, OutOfDate } from "../../components/AnalysisStatus";
import { Button, IconButton } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Field } from "../../components/ui/Fields";
import { Icon } from "../../components/ui/Icon";
import { PageHeader } from "../../components/ui/PageHeader";
import { Spinner } from "../../components/ui/Progress";
import { downloadText, slug } from "../../lib/download";
import { EllipseEditor } from "../../scenario/editor/EllipseEditor";
import { addPlanEllipse, useScenario } from "../../scenario/store";
import type { Ellipse, Scenario } from "../../scenario/types";
import { useApp } from "../../state/store";
import "../../styles/ellipse.css";
import { SiteTabs } from "../site/SiteTabs";
import { countStates, plotHalfWidth, samplesCsv, STATES, STATE_LABEL } from "./adapt";
import { EllipsePlot, type Marker } from "./EllipsePlot";
import { ConstraintTable, PointsPanel, ResultDetails, ResultStats, Warnings } from "./Results";
import { useBackdrop } from "./useBackdrop";
import { useEllipseRun } from "./store";

const paramsFor = (points: string): EllipseParams => ({
  n_samples: points.trim() === "" ? Number.NaN : Number(points),
  seed: 0,
  truncate: true,
  map_cells: null,
  hazard_slope_deg: null,
  hazard_roughness_m: null,
});

export function EllipseWorkspace() {
  const doc = useScenario((s) => s.doc)!;
  const run = useEllipseRun();
  const params = useMemo(() => paramsFor(run.points), [run.points]);
  const problems = useMemo(() => {
    const n = params.n_samples;
    const { min, max } = ELLIPSE_LIMITS.nSamples;
    return Number.isInteger(n) && n >= min && n <= max ? [] : [`${min} to ${max.toLocaleString("en-US")}`];
  }, [params]);
  const body = useMemo(() => ellipseBody(doc, params, "auto"), [doc, params]);
  const bodyKey = useMemo(() => JSON.stringify(body), [body]);
  const resultKey = useMemo(() => (run.resultBody ? JSON.stringify(run.resultBody) : null), [run.resultBody]);

  const result = run.result;
  const running = run.phase === "running";
  const dirty = resultKey !== bodyKey;
  const stale = result !== null && (dirty || running);
  const ell = doc.ellipse;
  const start = () => {
    if (problems.length === 0 && ell) run.run(body);
  };
  usePublishScreenContext({
    where: "Site, Landing ellipse",
    summary: ell ? "" : "no landing ellipse set",
    lines: [
      ell
        ? `The landing ellipse is ${ell.semi_major_m} by ${ell.semi_minor_m} m, major axis azimuth ${ell.azimuth_deg}° clockwise from north, ${ell.dispersion === "gaussian" ? `Gaussian with axes at ${ell.sigma_level} sigma` : "uniform"}.`
        : "The plan has no landing ellipse.",
      `Sampling ${run.points || "no"} points.`,
    ],
  });

  const statusState = { ...run, jobId: null, cached: false, stale: false, rerun: start };
  const status = result !== null && dirty && !running && run.phase !== "error" ? <OutOfDate state={statusState} /> : <AnalysisStatus state={statusState} what="the landing ellipse" />;
  const failed = run.phase === "error";

  if (!ell) {
    return (
      <div className="el" aria-label="Landing ellipse page">
        <h1 className="sr-only">Landing ellipse: {doc.name}</h1>
        <PageHeader tabs={<SiteTabs />} />
        <div className="el-main">
          <EmptyState
            icon="ellipse"
            title="What share of the landing area passes?"
            action={
              <Button variant="primary" onClick={addPlanEllipse} icon="plus">
                Add ellipse
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="el" aria-label="Landing ellipse page">
      <h1 className="sr-only">Landing ellipse: {doc.name}</h1>
      <PageHeader
        tabs={<SiteTabs />}
        actions={
          <>
            <Link to="/evidence" className="chip chip-unknown el-validation" title="The pass share is a sample count, not checked against real landings">
              Not validated
            </Link>
            {result?.samples && (
              <IconButton icon="download" label="Download points (CSV)" onClick={() => downloadText(`ellipse-${slug(result.scenario_name)}-${result.n_samples}-points.csv`, samplesCsv(result), "text/csv")} />
            )}
            <Button type="submit" form="el-form" variant={dirty ? "primary" : "default"} icon="play" disabled={problems.length > 0 || running}>
              Run
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
            start();
          }}
        >
          <EllipseEditor />
          <div className="el-params">
            <Field label="Points" htmlFor="el-n" error={problems[0] ?? null}>
              <input
                id="el-n"
                className="input"
                type="number"
                inputMode="numeric"
                min={ELLIPSE_LIMITS.nSamples.min}
                max={ELLIPSE_LIMITS.nSamples.max}
                step={1}
                aria-invalid={problems.length > 0}
                value={run.points}
                onChange={(e) => run.setPoints(e.target.value)}
              />
            </Field>
          </div>
        </form>
        <ResultArea doc={doc} result={result} stale={stale} />
      </div>
    </div>
  );
}

function ResultArea({ doc, result, stale }: { doc: Scenario; result: EllipseResult | null; stale: boolean }) {
  const [selected, setSelected] = useState<Marker | null>(null);
  const dark = useApp((s) => s.theme) === "dark";

  const scenario = (result?.scenario ?? doc) as { ellipse?: Ellipse | null; site?: { lat_deg: number; lon_deg: number } };
  const ellipse = scenario.ellipse ?? null;
  const site = scenario.site ?? null;
  const backdrop = useBackdrop(site?.lat_deg ?? 0, site?.lon_deg ?? 0, ellipse ? 2 * plotHalfWidth(ellipse) : 0, ellipse !== null && site !== null, dark);

  if (!ellipse) return null;

  const counts = result?.samples ? countStates(result.samples) : null;
  const description = `Landing ellipse ${ellipse.semi_major_m} by ${ellipse.semi_minor_m} metres, major axis azimuth ${ellipse.azimuth_deg}°, north up. ${
    counts && result ? STATES.map((s) => `${counts[s]} ${STATE_LABEL[s].toLowerCase()}`).join(", ") + " of " + result.n_samples + " points." : ""
  }`;

  return (
    <div className={`el-main ${result && stale ? "is-stale" : ""}`}>
      {result && <ResultStats result={result} />}
      <div className="el-view">
        <div className="el-plotcol">
          <EllipsePlot
            ellipse={ellipse}
            samples={result?.samples ?? null}
            refs={result ? { centre: result.centre, worst: result.worst, best: result.best } : null}
            backdrop={backdrop}
            showSamples={result !== null}
            selected={selected}
            description={description}
          />
          <div className="el-plotbar">
            {result ? (
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
                {counts && counts.unknown > 0 && (
                  <li>
                    <span className="el-glyph el-glyph-unknown" aria-hidden="true">◆</span> Unknown
                  </li>
                )}
              </ul>
            ) : null}
            <span className="grow" />
            {backdrop.status === "loading" && <Spinner size={12} />}
            {backdrop.status === "error" && (
              <span className="el-relief-error">
                <Icon name="warn" size={12} /> No relief
              </span>
            )}
          </div>
        </div>
        {result && (
          <div className="el-detailcol">
            <Warnings result={result} />
            <PointsPanel result={result} selected={selected} onSelect={setSelected} />
            <ConstraintTable result={result} />
            <ResultDetails result={result} />
          </div>
        )}
      </div>
    </div>
  );
}
