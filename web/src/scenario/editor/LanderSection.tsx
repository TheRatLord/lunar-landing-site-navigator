import { Button, IconButton } from "../../components/ui/Button";
import { Disclosure } from "../../components/ui/Disclosure";
import { Toggle } from "../../components/ui/Fields";
import { useScenario } from "../store";
import type { LanderProfile, PanelSpec } from "../types";
import { GroupHead, NumberField } from "./controls";
import { editedOrigin } from "./fieldState";
import { PANEL_FIELDS, PROFILE_ATTITUDE, PROFILE_BATTERY, PROFILE_HEIGHTS, PROFILE_LINK, PROFILE_LOADS, type NumSpec } from "./fieldSpecs";

function ProfileNumber({ spec }: { spec: NumSpec }) {
  const origin = useScenario((s) => s.doc?.profile.origins?.[spec.field]);
  const edit = useScenario((s) => s.edit);
  const relabel = () => {
    if (origin && origin.basis !== "user") edit(["profile", "origins", spec.field], editedOrigin(origin));
  };
  return <NumberField {...spec} path={["profile", ...spec.field.split(".")]} onCommit={relabel} />;
}

function PanelsBlock() {
  const panels = useScenario((s) => s.doc?.profile.panels ?? []);
  const edit = useScenario((s) => s.edit);
  const blank: PanelSpec = { name: `panel ${panels.length + 1}`, normal_body: [0, 0, 1], area_m2: 1, efficiency: 0.28, tracking: false };
  return (
    <div className="sc-group">
      <GroupHead title="Solar panels" />
      <Disclosure title={panels.map((p) => p.name).join(", ") || "None"} count={panels.length}>
        <div className="sc-panels">
          {panels.map((p, i) => (
            <div key={i} className="sc-block">
              <div className="row">
                <input className="input input-compact grow" aria-label={`Panel ${i + 1} name`} value={p.name} onChange={(e) => edit(["profile", "panels", i, "name"], e.target.value)} />
                <Toggle checked={p.tracking ?? false} onChange={(v) => edit(["profile", "panels", i, "tracking"], v)} label="Sun-tracking" />
                <IconButton icon="trash" label={`Remove panel ${i + 1}`} size="sm" disabled={panels.length <= 1} onClick={() => edit(["profile", "panels"], panels.filter((_, k) => k !== i))} />
              </div>
              <div className="sc-fields5">
                {[0, 1, 2].map((j) => (
                  <NumberField key={j} layout="stacked" path={["profile", "panels", i, "normal_body", j]} label={`Normal ${"xyz"[j]}`} step={0.1} />
                ))}
                {PANEL_FIELDS.map((f) => (
                  <NumberField key={f.field} {...f} layout="stacked" path={["profile", "panels", i, f.field]} />
                ))}
              </div>
            </div>
          ))}
          <div>
            <Button size="sm" icon="plus" onClick={() => edit(["profile", "panels"], [...panels, blank])}>
              Add panel
            </Button>
          </div>
        </div>
      </Disclosure>
    </div>
  );
}

function Group({ title, specs, children }: { title: string; specs: NumSpec[]; children?: React.ReactNode }) {
  return (
    <div className="sc-group">
      <GroupHead title={title}>{children}</GroupHead>
      {specs.map((s) => (
        <ProfileNumber key={s.field} spec={s} />
      ))}
    </div>
  );
}

export function LanderSection() {
  const profile = useScenario((s) => s.doc?.profile) as LanderProfile | undefined;
  const edit = useScenario((s) => s.edit);
  if (!profile) return null;
  return (
    <div className="sc-section">
      <Group title="Heights" specs={PROFILE_HEIGHTS} />
      <PanelsBlock />
      <Group title="Attitude" specs={PROFILE_ATTITUDE} />
      <Group title="Battery" specs={PROFILE_BATTERY} />
      <Group title="Loads" specs={PROFILE_LOADS} />
      {profile.link && (
        <Group title="Link budget" specs={PROFILE_LINK}>
          <IconButton icon="trash" label="Remove link budget" size="sm" onClick={() => edit(["profile", "link"], null)} />
        </Group>
      )}
    </div>
  );
}
