import { IconButton } from "../../components/ui/Button";
import { Segmented } from "../../components/ui/Segmented";
import { Toolstrip } from "../../components/ui/Toolstrip";
import { MS_DAY, MS_HOUR, formatMet, formatUtc, parseUtc, toIsoUtc } from "../../lib/time";
import { useApp } from "../../state/store";
import { useScenario } from "../store";
import { GroupHead, NumberField, Readout, UtcField } from "./controls";

const DURATION_PRESETS: Array<{ label: string; hours: number }> = [
  { label: "48 h", hours: 48 },
  { label: "Lunar day", hours: 354 },
  { label: "Lunation", hours: 708.7 },
];

export function TimeSection() {
  const doc = useScenario((s) => s.doc);
  const edit = useScenario((s) => s.edit);
  const timeMs = useApp((s) => s.timeMs);
  const setTime = useApp((s) => s.setTime);
  if (!doc) return null;
  const landing = parseUtc(doc.landing_utc);
  const end = landing === null ? null : landing + doc.mission_duration_h * MS_HOUR;
  const transfer = doc.transfer;
  const launch = landing !== null && transfer?.kind === "fixed" && transfer.duration_days ? landing - transfer.duration_days * MS_DAY : null;
  const preset = DURATION_PRESETS.find((p) => p.hours === doc.mission_duration_h);

  return (
    <div className="sc-section">
      <div className="sc-group">
        <GroupHead title="Landing" />
        <UtcField
          path={["landing_utc"]}
          label="Landing (UTC)"
          actions={
            <Toolstrip>
              <IconButton icon="pin" label="Set to scrubber time" size="sm" onClick={() => edit(["landing_utc"], toIsoUtc(Math.round(timeMs / 60_000) * 60_000))} />
              {landing !== null && <IconButton icon="target" label="Move scrubber to landing" size="sm" onClick={() => setTime(landing)} />}
            </Toolstrip>
          }
        />
        {landing !== null && <Readout label="Scrubber" value={formatMet(timeMs, landing)} />}
        {launch !== null && <Readout label="Launch" value={formatUtc(launch, { seconds: false })} />}
      </div>

      <div className="sc-group">
        <GroupHead title="Surface mission" />
        <NumberField path={["mission_duration_h"]} label="Duration" unit="h" min={0} exclusiveMin step={1} />
        <div className="sc-row">
          <span />
          <div className="sc-control">
            <Segmented
              label="Duration presets"
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
        {end !== null && <Readout label="Ends" value={formatUtc(end, { seconds: false })} />}
      </div>
    </div>
  );
}
