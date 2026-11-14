import { IconButton } from "../../components/ui/Button";
import { Disclosure } from "../../components/ui/Disclosure";
import { Segmented } from "../../components/ui/Segmented";
import { Toolstrip } from "../../components/ui/Toolstrip";
import { MS_DAY, MS_HOUR, MS_LUNATION, formatMet, formatUtc, parseUtc, toIsoUtc } from "../../lib/time";
import { useApp } from "../../state/store";
import { shiftPlanLanding, useScenario } from "../store";
import { GroupHead, NumberField, Readout, UtcField } from "./controls";
import { TransferSection } from "./TransferSection";

const DURATION_PRESETS: Array<{ label: string; hours: number }> = [
  { label: "48 h", hours: 48 },
  { label: "Lunar day", hours: 354 },
  { label: "Lunation", hours: 708.7 },
];

const STEPS: Array<{ label: string; ms: number }> = [
  { label: "1 hour", ms: MS_HOUR },
  { label: "1 day", ms: MS_DAY },
  { label: "1 lunar day", ms: MS_LUNATION },
];

export function TimeSection({ scrubber = false, transferOpen = false }: { scrubber?: boolean; transferOpen?: boolean }) {
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
  const transferTitle = !transfer ? "Launch-to-landing transfer: none" : transfer.kind === "fixed" ? `Launch-to-landing transfer: ${transfer.duration_days ?? "?"} d` : `Launch-to-landing transfer: table, ${transfer.table?.length ?? 0} rows`;

  return (
    <div className="sc-section">
      <div className="sc-group">
        <UtcField
          path={["landing_utc"]}
          label="Landing (UTC)"
          actions={
            scrubber && (
              <Toolstrip>
                <IconButton icon="pin" label="Set to the time shown on the scrubber" size="sm" onClick={() => edit(["landing_utc"], toIsoUtc(Math.round(timeMs / 60_000) * 60_000))} />
                {landing !== null && <IconButton icon="target" label="Move the scrubber to landing" size="sm" onClick={() => setTime(landing)} />}
              </Toolstrip>
            )
          }
        />
        {([-1, 1] as const).map((dir) => (
          <div key={dir} className="sc-row">
            <span className="sc-label">{dir < 0 ? "Earlier by" : "Later by"}</span>
            <div className="sc-control sc-steps">
              {STEPS.map((s) => (
                <button key={s.label} type="button" className="sc-step" disabled={landing === null} onClick={() => shiftPlanLanding(dir * s.ms)}>
                  {dir < 0 ? "−" : "+"} {s.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        {scrubber && landing !== null && <Readout label="Scrubber" value={formatMet(timeMs, landing)} />}
        {launch !== null && <Readout label="Launch" value={formatUtc(launch, { seconds: false })} />}
      </div>

      <div className="sc-group">
        <GroupHead title="Time on the surface" />
        <div className="sc-row">
          <span className="sc-label">Stay</span>
          <div className="sc-control">
            <Segmented
              label="Surface stay presets"
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
        <NumberField path={["mission_duration_h"]} label="Duration" unit="h" min={0} exclusiveMin step={1} />
        {end !== null && <Readout label="Ends" value={formatUtc(end, { seconds: false })} />}
      </div>

      <div className="sc-group">
        <Disclosure key={transferOpen ? "open" : "closed"} title={transferTitle} defaultOpen={transferOpen}>
          <p className="sc-about">How long the trip from launch takes. Only needed to see what a launch delay does to the landing, in Compare.</p>
          <TransferSection />
        </Disclosure>
      </div>
    </div>
  );
}
