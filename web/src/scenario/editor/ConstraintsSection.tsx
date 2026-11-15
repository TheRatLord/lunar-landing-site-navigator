import { useState } from "react";
import { ServiceNotice } from "../../components/ServiceNotice";
import { Button, IconButton } from "../../components/ui/Button";
import { Toolstrip } from "../../components/ui/Toolstrip";
import { useScenario } from "../store";
import type { Limit } from "../types";
import { GroupHead, NumberField } from "./controls";
import { USER_ORIGIN, editedOrigin } from "./fieldState";
import { formatLimit } from "../../lib/requirements";
import { CONSTRAINT_META, PARAMETER_META, type ConstraintMeta } from "./fieldSpecs";
import { usePresets } from "./usePresets";

const ACRONYMS = new Set(["viper"]);

function presetName(id: string): string {
  const words = id.split("-").map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w));
  const first = words[0] ?? "";
  return [first.charAt(0).toUpperCase() + first.slice(1), ...words.slice(1)].join(" ");
}

function PresetPicker() {
  const edit = useScenario((s) => s.edit);
  const presets = usePresets();
  if (presets.status === "loading") return null;
  if (presets.status === "error") return <ServiceNotice error={presets.error} what="Requirement sets" />;
  return (
    <div className="sc-row">
      <span className="sc-label">Presets</span>
      <div className="sc-control sc-preset-row">
        {presets.data.constraints.map((p) => (
          <Button key={p.name} size="sm" title={p.description.replace(/ deg\b/g, "°")} onClick={() => edit(["constraints"], p.constraints)}>
            {presetName(p.name)}
          </Button>
        ))}
      </div>
    </div>
  );
}

function LimitRow({ meta }: { meta: ConstraintMeta }) {
  const limit = useScenario((s) => s.doc?.constraints[meta.key]);
  const edit = useScenario((s) => s.edit);
  const [details, setDetails] = useState(false);
  if (!limit) return null;
  const relabel = () => {
    if (limit.origin && limit.origin.basis !== "user") edit(["constraints", meta.key, "origin"], editedOrigin(limit.origin));
  };
  const other = meta.side === "min" ? "max" : "min";
  const hasOther = limit[other] !== null && limit[other] !== undefined;
  const sides = hasOther ? ([meta.side, other] as const) : ([meta.side] as const);
  const unit = limit.unit === "deg" ? "°" : limit.unit || undefined;

  return (
    <div className="sc-limit on">
      <div className="sc-limit-head">
        <span className="sc-limit-title">{meta.title}</span>
        {((limit.unit === "h" && Math.max(limit.min ?? 0, limit.max ?? 0) >= 48) || !limit.unit || limit.unit === "fraction") && <span className="faint num">{formatLimit(limit.min, limit.max, limit.unit)}</span>}
        <span className="grow" />
        {sides.map((side) => (
          <NumberField key={side} layout="stacked" path={["constraints", meta.key, side]} label={<span className="sr-only">{side === "min" ? "At least" : "At most"}</span>} unit={`${side === "min" ? "≥" : "≤"}${unit ? ` ${unit}` : ""}`} step={meta.decimals >= 2 ? 0.01 : 0.5} nullable={side !== meta.side} onCommit={relabel} />
        ))}
        <Toolstrip>
          <IconButton icon="info" label="About this requirement" size="sm" pressed={details} onClick={() => setDetails(!details)} />
          <IconButton icon="close" label={`Remove ${meta.title}`} size="sm" onClick={() => edit(["constraints", meta.key], null)} />
        </Toolstrip>
      </div>
      {details && <p className="dim sc-details">{meta.what}</p>}
    </div>
  );
}

function AddRequirement() {
  const edit = useScenario((s) => s.edit);
  const constraints = useScenario((s) => s.doc?.constraints);
  if (!constraints) return null;
  const inactive = CONSTRAINT_META.filter((m) => !constraints[m.key]);
  if (inactive.length === 0) return null;
  return (
    <select
      className="select sc-add-req"
      aria-label="Add requirement"
      value=""
      onChange={(e) => {
        const meta = CONSTRAINT_META.find((m) => m.key === e.target.value);
        if (meta) edit(["constraints", meta.key], { min: meta.side === "min" ? meta.start : null, max: meta.side === "max" ? meta.start : null, unit: meta.unit, label: meta.title, origin: USER_ORIGIN, margin_scale: meta.scale ?? 1 } satisfies Limit);
      }}
    >
      <option value="">Add requirement…</option>
      {inactive.map((m) => (
        <option key={m.key} value={m.key}>
          {m.title}
        </option>
      ))}
    </select>
  );
}

export function EvaluationSettings() {
  const params = useScenario((s) => s.doc?.constraints);
  if (!params) return null;
  return (
    <div className="sc-group">
      <GroupHead title="Evaluation" />
      {PARAMETER_META.filter((m) => m.key !== "sunlit_flux_fraction").map((m) => (
        <NumberField key={m.key} path={["constraints", m.key, "value"]} label={m.title} unit={m.unit || undefined} min={m.min} max={m.max} step={m.step} />
      ))}
    </div>
  );
}

export function ConstraintsSection() {
  const params = useScenario((s) => s.doc?.constraints);
  if (!params) return null;
  return (
    <div className="sc-section">
      <PresetPicker />
      <div className="sc-group">
        {CONSTRAINT_META.map((m) => (
          <LimitRow key={m.key} meta={m} />
        ))}
        <AddRequirement />
      </div>
    </div>
  );
}
