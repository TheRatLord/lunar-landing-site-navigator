import { Button, IconButton } from "../../components/ui/Button";
import { Segmented } from "../../components/ui/Segmented";
import { addPlanEllipse, useScenario } from "../store";
import { NumberField, OriginBadge } from "./controls";
import { ELLIPSE_FIELDS } from "./fieldSpecs";

export function EllipseEditor() {
  const ellipse = useScenario((s) => s.doc?.ellipse);
  const edit = useScenario((s) => s.edit);
  return (
    <section className="el-ellipse" aria-label="Landing ellipse">
      <div className="el-ellipse-head">
        <h2 className="el-title">Landing ellipse</h2>
        {ellipse && <OriginBadge origin={ellipse.origin} />}
        <span className="grow" />
        {ellipse && <IconButton icon="trash" label="Remove the ellipse" size="sm" onClick={() => edit(["ellipse"], null)} />}
      </div>
      {ellipse ? (
        <>
          <p className="el-about">Where the lander may come down around the target. Edit it here, then sample it.</p>
          <div className="el-ellipse-fields">
            {ELLIPSE_FIELDS.map((f) => (
              <NumberField key={f.field} {...f} layout="stacked" path={["ellipse", f.field]} />
            ))}
          </div>
          <div className="field">
            <span className="field-label">Spread of landings</span>
            <Segmented
              label="Spread of landings"
              size="sm"
              value={ellipse.dispersion}
              onChange={(v) => edit(["ellipse", "dispersion"], v)}
              options={[
                { value: "gaussian", label: "Gaussian" },
                { value: "uniform", label: "Uniform" },
              ]}
            />
          </div>
        </>
      ) : (
        <>
          <p className="el-about">This plan lands on a single point. Add an ellipse to see what share of the possible landing points pass.</p>
          <div>
            <Button variant="primary" icon="plus" onClick={addPlanEllipse}>
              Add ellipse
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
