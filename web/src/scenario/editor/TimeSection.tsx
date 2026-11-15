import { Segmented } from "../../components/ui/Segmented";
import { MS_LUNATION } from "../../lib/time";
import { planStay, useScenario } from "../store";
import { whenText } from "../when";
import { NumberField, Readout, UtcField } from "./controls";

const DURATION_PRESETS: Array<{ label: string; hours: number }> = [
  { label: "48 h", hours: 48 },
  { label: "14 days", hours: 336 },
  { label: "Lunar day", hours: Math.round((MS_LUNATION / 3_600_000) * 10) / 10 },
];

export function TimeSection() {
  const doc = useScenario((s) => s.doc);
  const edit = useScenario((s) => s.edit);
  if (!doc) return null;
  const stay = planStay(doc);
  const preset = DURATION_PRESETS.find((p) => p.hours === doc.mission_duration_h);

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
              value={preset?.label ?? ""}
              onChange={(v) => {
                const p = DURATION_PRESETS.find((x) => x.label === v);
                if (p) edit(["mission_duration_h"], p.hours);
              }}
              options={DURATION_PRESETS.map((p) => ({ value: p.label, label: p.label }))}
            />
          </div>
        </div>
        <NumberField path={["mission_duration_h"]} label={<span className="sr-only">Stay in hours</span>} unit="h" min={0} exclusiveMin step={1} />
        {stay && <Readout label="Ends" value={whenText(stay.end_ms)} />}
      </div>
    </div>
  );
}
