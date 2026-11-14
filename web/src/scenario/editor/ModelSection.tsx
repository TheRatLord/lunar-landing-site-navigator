import { Button, IconButton } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { schemaDefaults } from "../normalize";
import { useScenario } from "../store";
import type { Ellipse } from "../types";
import { CheckField, ChoiceField, GroupHead, NumberField, OriginMark } from "./controls";
import { ECLIPSE_FIELDS, ELLIPSE_FIELDS, SAMPLING_FIELDS, TERRAIN_ERROR_FIELDS, type NumSpec } from "./fieldSpecs";
import { TerrainStackControl } from "./TerrainStackControl";

function Fields({ base, specs }: { base: string; specs: NumSpec[] }) {
  return (
    <>
      {specs.map((s) => (
        <NumberField key={s.field} {...s} path={[base, s.field]} />
      ))}
    </>
  );
}

export function EllipseSection() {
  const ellipse = useScenario((s) => s.doc?.ellipse);
  const edit = useScenario((s) => s.edit);
  const enable = () =>
    edit(["ellipse"], {
      ...schemaDefaults("Ellipse"),
      semi_major_m: 100,
      semi_minor_m: 100,
      origin: { ...schemaDefaults("Origin"), basis: "user", label: "Placeholder starting values; replace with your navigation solution" },
    } as Ellipse);
  if (!ellipse)
    return (
      <div className="sc-section">
        <EmptyState
          icon="ellipse"
          title="No landing ellipse"
          action={
            <Button variant="primary" onClick={enable}>
              Add ellipse
            </Button>
          }
        />
      </div>
    );
  return (
    <div className="sc-section">
      <div className="sc-group">
        <GroupHead title="Dispersion">
          <OriginMark origin={ellipse.origin} />
          <IconButton icon="trash" label="Remove ellipse" size="sm" onClick={() => edit(["ellipse"], null)} />
        </GroupHead>
        <Fields base="ellipse" specs={ELLIPSE_FIELDS} />
        <ChoiceField
          path={["ellipse", "dispersion"]}
          label="Distribution"
          options={[
            { value: "gaussian", label: "Gaussian" },
            { value: "uniform", label: "Uniform" },
          ]}
        />
      </div>
    </div>
  );
}

export function ModelSection() {
  const terr = useScenario((s) => s.doc?.terrain_error);
  const eclipse = useScenario((s) => s.doc?.eclipse);
  if (!terr || !eclipse) return null;
  return (
    <div className="sc-section">
      <TerrainStackControl />
      <div className="sc-group">
        <GroupHead title="Terrain error">
          <OriginMark origin={terr.origin} />
        </GroupHead>
        <CheckField path={["terrain_error", "enabled"]} label="Apply" />
        <Fields base="terrain_error" specs={TERRAIN_ERROR_FIELDS} />
      </div>
      <div className="sc-group">
        <GroupHead title="Eclipse">
          <OriginMark origin={eclipse.origin} />
        </GroupHead>
        <ChoiceField
          path={["eclipse", "shadow"]}
          label="Shadow"
          options={[
            { value: "danjon", label: "Danjon" },
            { value: "geometric", label: "Geometric" },
          ]}
        />
        <Fields base="eclipse" specs={ECLIPSE_FIELDS} />
      </div>
      <div className="sc-group">
        <GroupHead title="Sampling" />
        <Fields base="sampling" specs={SAMPLING_FIELDS} />
      </div>
    </div>
  );
}
