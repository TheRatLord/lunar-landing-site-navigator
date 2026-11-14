import { useScenario } from "../store";
import { CheckField, ChoiceField, GroupHead, NumberField, OriginMark } from "./controls";
import { ECLIPSE_FIELDS, SAMPLING_FIELDS, TERRAIN_ERROR_FIELDS, type NumSpec } from "./fieldSpecs";
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
