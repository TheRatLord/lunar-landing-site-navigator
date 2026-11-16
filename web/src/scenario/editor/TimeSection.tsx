import { useState } from "react";
import { Segmented } from "../../components/ui/Segmented";
import { MS_LUNATION } from "../../lib/time";
import { useScenario } from "../store";
import { NumberField, UtcField } from "./controls";

const DURATION_PRESETS: Array<{ label: string; hours: number }> = [
  { label: "2 d", hours: 48 },
  { label: "14 d", hours: 336 },
  { label: "Lunar day", hours: Math.round((MS_LUNATION / 3_600_000) * 10) / 10 },
];

const CUSTOM = "Hours";

export function TimeSection() {
  const doc = useScenario((s) => s.doc);
  const edit = useScenario((s) => s.edit);
  const [custom, setCustom] = useState(false);
  if (!doc) return null;
  const preset = DURATION_PRESETS.find((p) => p.hours === doc.mission_duration_h);
  const boxed = custom || !preset;

  return (
    <div className="sc-section">
      <div className="sc-group">
        <UtcField path={["landing_utc"]} label="Landing" />
        <div className="sc-row">
          <span className="sc-label">Stay</span>
          <div className="sc-control">
            <Segmented
              label="Stay"
              size="sm"
              value={boxed ? CUSTOM : (preset?.label ?? CUSTOM)}
              onChange={(v) => {
                const p = DURATION_PRESETS.find((x) => x.label === v);
                setCustom(!p);
                if (p) edit(["mission_duration_h"], p.hours);
              }}
              options={[...DURATION_PRESETS.map((p) => ({ value: p.label, label: p.label })), { value: CUSTOM, label: CUSTOM }]}
            />
          </div>
        </div>
        {boxed && <NumberField path={["mission_duration_h"]} label={<span className="sr-only">Stay in hours</span>} unit="h" min={0} exclusiveMin step={1} />}
      </div>
    </div>
  );
}
