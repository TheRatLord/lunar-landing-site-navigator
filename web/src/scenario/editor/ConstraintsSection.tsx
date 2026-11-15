import { useState } from "react";
import { ServiceNotice } from "../../components/ServiceNotice";
import { Button, IconButton } from "../../components/ui/Button";
import { Popover } from "../../components/ui/Popover";
import { Toggle } from "../../components/ui/Fields";
import { Toolstrip } from "../../components/ui/Toolstrip";
import { useScenario } from "../store";
import type { Limit } from "../types";
import { GroupHead, NumberField, OriginMark } from "./controls";
import { USER_ORIGIN, editedOrigin } from "./fieldState";
import { CONSTRAINT_META, PARAMETER_META, type ConstraintMeta } from "./fieldSpecs";
import { usePresets } from "./usePresets";

function PresetPicker() {
  const edit = useScenario((s) => s.edit);
  const presets = usePresets();
  if (presets.status === "loading") return null;
  if (presets.status === "error") return <ServiceNotice error={presets.error} what="Requirement sets" />;
  return (
    <div className="sc-group">
      <GroupHead title="Start from a published set">
        <Popover label="About these" icon="info" align="end" width={320}>
          <div className="origin-tip">
            <span>Past missions’ values or a mission’s published plan, each with its source. None is a requirement of your mission.</span>
          </div>
        </Popover>
      </GroupHead>
      <ul className="sc-presets">
        {presets.data.constraints.map((p) => (
          <li key={p.name} className="sc-preset">
            <span className="sc-preset-name num">{p.name}</span>
            <span className="sc-preset-what">{p.description}</span>
            <Button size="sm" title={`Replace every requirement with ${p.name}`} onClick={() => edit(["constraints"], p.constraints)}>
              Use
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LimitRow({ meta }: { meta: ConstraintMeta }) {
  const limit = useScenario((s) => s.doc?.constraints[meta.key]);
  const edit = useScenario((s) => s.edit);
  const [details, setDetails] = useState(false);
  const active = Boolean(limit);
  const relabel = () => {
    if (limit?.origin && limit.origin.basis !== "user") edit(["constraints", meta.key, "origin"], editedOrigin(limit.origin));
  };
  const noValue = limit && (limit.min === null || limit.min === undefined) && (limit.max === null || limit.max === undefined);
  const sides = meta.side === "min" ? (["min", "max"] as const) : (["max", "min"] as const);

  return (
    <div className={`sc-limit ${active ? "on" : ""}`}>
      <div className="sc-limit-head">
        <Toggle
          checked={active}
          onChange={(on) => edit(["constraints", meta.key], on ? ({ min: null, max: null, unit: meta.unit, label: meta.title, origin: USER_ORIGIN, margin_scale: meta.scale ?? 1 } satisfies Limit) : null)}
          label={<span className="sc-limit-title">{meta.title}</span>}
        />
        <span className="grow" />
        {meta.needsTerrain && <span className="chip">Needs terrain</span>}
        {limit && <OriginMark origin={limit.origin} />}
        <Toolstrip>
          <IconButton icon="info" label="About this requirement" size="sm" pressed={details} onClick={() => setDetails(!details)} />
        </Toolstrip>
      </div>
      {limit && (
        <div className="sc-limit-fields">
          {sides.map((side) => (
            <NumberField key={side} layout="stacked" path={["constraints", meta.key, side]} label={side === "min" ? "At least" : "At most"} unit={limit.unit || undefined} step={meta.decimals >= 2 ? 0.01 : 0.5} nullable onCommit={relabel} />
          ))}
        </div>
      )}
      {noValue && <p className="sc-msg" role="alert">Set at least or at most</p>}
      {details && (
        <div className="sc-details">
          <p className="dim">{meta.what}</p>
          {limit && <NumberField path={["constraints", meta.key, "margin_scale"]} label="Margin scale" min={0} exclusiveMin step={0.1} />}
        </div>
      )}
    </div>
  );
}

export function ConstraintsSection() {
  const params = useScenario((s) => s.doc?.constraints);
  const active = useScenario((s) => CONSTRAINT_META.filter((m) => s.doc?.constraints[m.key]).length);
  if (!params) return null;
  return (
    <div className="sc-section">
      <PresetPicker />
      <div className="sc-group">
        <GroupHead title="Your requirements">
          <span className="dim num">
            {active}/{CONSTRAINT_META.length}
          </span>
        </GroupHead>
        {CONSTRAINT_META.map((m) => (
          <LimitRow key={m.key} meta={m} />
        ))}
      </div>
      <div className="sc-group">
        <GroupHead title="Evaluation settings" />
        {PARAMETER_META.map((m) => (
          <NumberField key={m.key} path={["constraints", m.key, "value"]} label={m.title} unit={m.unit || undefined} min={m.min} max={m.max} step={m.step} origin={params[m.key].origin} />
        ))}
      </div>
    </div>
  );
}
