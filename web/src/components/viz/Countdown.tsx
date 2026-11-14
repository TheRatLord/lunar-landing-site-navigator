import type { CountdownKind, CrossingEvent } from "../../contract/types";
import { formatNum } from "../../lib/format";
import { MS_DAY, MS_HOUR, formatUtc } from "../../lib/time";
import { Panel } from "../ui/Panel";
import { Stat } from "../ui/Stat";

export interface CountdownProps {
  events: CrossingEvent[];
  timeMs: number;
  title?: string;
}

const KINDS: Array<{ kind: CountdownKind; label: string; body: "sun" | "earth" }> = [
  { kind: "sunset", label: "Sunlight ends", body: "sun" },
  { kind: "sunrise", label: "Sunlight begins", body: "sun" },
  { kind: "earthset", label: "Contact ends", body: "earth" },
  { kind: "earthrise", label: "Contact begins", body: "earth" },
];

const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function hoursText(ms: number): string {
  const h = Math.max(0, ms) / MS_HOUR;
  return h >= 100 ? h.toFixed(0) : h >= 10 ? h.toFixed(1) : h.toFixed(2);
}

function next(events: CrossingEvent[], kind: CountdownKind, now: number): CrossingEvent | null {
  let best: CrossingEvent | null = null;
  for (const e of events) {
    if (e.kind !== kind || (!e.latest_open && e.latest_ms < now)) continue;
    if (best === null || e.best_ms < best.best_ms) best = e;
  }
  return best;
}

function CountdownCard({ spec, event, timeMs }: { spec: (typeof KINDS)[number]; event: CrossingEvent | null; timeMs: number }) {
  const cls = `cd-card cd-${spec.body}`;
  if (!event) {
    return (
      <div className={`${cls} cd-none`} role="group" aria-label={`${spec.label}, none in the loaded range`}>
        <Stat label={spec.label} value="—" />
      </div>
    );
  }
  const rem = event.best_ms - timeMs;
  const early = event.earliest_ms - timeMs;
  const late = event.latest_ms - timeMs;
  const earlyOpen = event.earliest_open === true;
  const lateOpen = event.latest_open === true;
  const now = (earlyOpen || early <= 0) && rem <= 0;
  const spread = Math.max(1, event.latest_ms - event.earliest_ms);
  const bestFrac = earlyOpen || lateOpen ? 50 : ((event.best_ms - event.earliest_ms) / spread) * 100;
  const bound = (open: boolean, ms: number) => (open ? "unbounded (beyond the analysed span)" : `${hoursText(ms)} hours`);
  const head = event.title ? (event.cause ? `${capFirst(event.title)} (${event.cause})` : capFirst(event.title)) : spec.label;
  const aria = `${head} in ${hoursText(rem)} hours (${formatNum(Math.max(0, rem) / MS_DAY, 3)} Earth days), between ${bound(earlyOpen, early)} and ${bound(lateOpen, late)}`;
  const rangeText = earlyOpen && lateOpen ? "unbounded" : lateOpen ? `≥ ${hoursText(early)} h` : earlyOpen ? `≤ ${hoursText(late)} h` : `${hoursText(early)}–${hoursText(late)} h`;
  return (
    <div className={cls} role="group" aria-label={aria}>
      <Stat label={head} value={now ? "now" : hoursText(rem)} unit={now ? undefined : "h"} sub={formatUtc(event.best_ms, { seconds: false })} />
      <div className="cd-range" aria-hidden="true">
        <div className={`cd-bar ${earlyOpen ? "open-start" : ""} ${lateOpen ? "open-end" : ""}`}>
          <div className="cd-bar-fill" />
          <div className="cd-bar-best" style={{ left: `${bestFrac}%` }} />
        </div>
        <div className="cd-range-text num">{rangeText}</div>
      </div>
    </div>
  );
}

export function Countdown({ events, timeMs, title = "Countdown" }: CountdownProps) {
  return (
    <Panel title={title}>
      <div className="cd-grid">
        {KINDS.map((k) => (
          <CountdownCard key={k.kind} spec={k} event={next(events, k.kind, timeMs)} timeMs={timeMs} />
        ))}
      </div>
    </Panel>
  );
}
