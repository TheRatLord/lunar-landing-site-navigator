import { useMemo, useState, type ReactNode } from "react";
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
import { requirementName } from "../../lib/requirements";
import { siteLabel } from "../../lib/siteName";
import { countStates, limitInfo, marginText, percent, plotHalfWidth, samplesCsv, stateShares, STATES, STATE_LABEL } from "./adapt";
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
  const status = result !== null && dirty && !running && run.phase !== "error" ? <OutOfDate state={statusState} /> : <AnalysisStatus state={statusState} what="the landing ellipse" count={Number(run.points) > 0 ? { verb: "Sampling", total: Number(run.points) } : undefined} />;

  if (!ell) {
    return (
      <div className="el" aria-label="Landing ellipse page">
        <h1 className="sr-only">Landing ellipse: {doc.name}</h1>
        <PageHeader tabs={<SiteTabs />} />
        <div className="el-main">
          <EmptyState
            icon="ellipse"
            title="The lander can touch down anywhere in its landing ellipse. Check how much of it passes."
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

  const form = (
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
        <Button type="submit" form="el-form" className="el-run" variant={dirty ? "primary" : "default"} icon="play" disabled={problems.length > 0 || running}>
          {result ? "Run again" : "Run"}
        </Button>
      </div>
    </form>
  );

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
          </>
        }
      />
      <header className={`el-head${stale ? " is-stale" : ""}`}>
        <p className="el-eyebrow">
          {[siteLabel(doc.site.name ?? "") || "Unnamed site", `${axisText(ell.semi_major_m)} × ${axisText(ell.semi_minor_m)} ellipse`, result ? `${result.n_samples.toLocaleString("en-US")} points` : null].filter(Boolean).join(" · ")}
        </p>
        <EllipseHeadline result={result} />
        <div className="el-status">{status}</div>
      </header>
      <ResultArea doc={doc} result={result} stale={stale} form={form} />
    </div>
  );
}

const axisText = (m: number): string => (m >= 1000 ? `${Number((m / 1000).toFixed(2))} km` : `${Math.round(m)} m`);

function EllipseHeadline({ result }: { result: EllipseResult | null }) {
  if (!result) {
    return (
      <>
        <h2 className="site-headline">Where in the ellipse can it land?</h2>
        <p className="site-headline-note">Run the sample to see what share of the possible landing points meets the requirements.</p>
      </>
    );
  }
  const shares = stateShares(result);
  const pass = shares.pass ?? 0;
  const marginal = shares.marginal ?? 0;
  const tone = pass >= 0.9995 ? "pass" : pass + marginal <= 0.0005 ? "fail" : "marginal";
  const worst = result.worst;
  const limit = worst.limiting ? requirementName(worst.limiting, limitInfo(result.scenario, worst.limiting).label) : null;
  return (
    <>
      <h2 className="site-headline">
        <strong className="verdict-word" data-tone={tone}>
          {tone === "pass" ? "Pass." : tone === "fail" ? "Fail." : `${percent(pass)}.`}
        </strong>{" "}
        {tone === "pass" ? "Every sampled landing point passes." : tone === "fail" ? "No sampled landing point passes." : "of the ellipse passes."}
      </h2>
      <p className="site-headline-note">
        Worst point {marginText(worst)}
        {limit ? ` on ${limit.toLowerCase()}` : ""}
        {marginal > 0.0005 ? ` · ${percent(marginal)} marginal` : ""}
      </p>
    </>
  );
}

function ResultArea({ doc, result, stale, form }: { doc: Scenario; result: EllipseResult | null; stale: boolean; form: ReactNode }) {
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
    <div className={`el-body ${result && stale ? "is-stale" : ""}`}>
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
        {result && (
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
        )}
        {backdrop.status === "loading" && (
          <span className="el-relief">
            <Spinner size={12} />
          </span>
        )}
        {backdrop.status === "error" && (
          <span className="el-relief el-relief-error">
            <Icon name="warn" size={12} /> No relief
          </span>
        )}
      </div>
      <div className="el-rail">
        {form}
        {result && <ResultStats result={result} />}
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
