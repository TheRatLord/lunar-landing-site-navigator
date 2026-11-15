import type { CountdownKind, CrossingEvent } from "../../contract/types";
import { Icon } from "../ui/Icon";
import { Panel } from "../ui/Panel";
import { Spinner } from "../ui/Progress";
import { spanText, whenText } from "./units";

export interface CountdownProps {
  events: CrossingEvent[];
  timeMs: number;
  title?: string;
  onTrace?: (kind: CountdownKind, event: CrossingEvent) => void;
  tracing?: CountdownKind | null;
  startMs?: number;
  endMs?: number;
}

export const KIND_LABEL: Record<CountdownKind, string> = { sunset: "Sunset", sunrise: "Sunrise", earthset: "Earth link ends", earthrise: "Earth link begins" };

const KINDS: readonly CountdownKind[] = ["sunset", "sunrise", "earthset", "earthrise"];
const NONE_LABEL: Record<CountdownKind, string> = { sunset: "sunset", sunrise: "sunrise", earthset: "end of Earth link", earthrise: "new Earth link" };
const BODY: Record<CountdownKind, "sun" | "earth"> = { sunset: "sun", sunrise: "sun", earthset: "earth", earthrise: "earth" };

function next(events: readonly CrossingEvent[], kind: CountdownKind, now: number, start: number): CrossingEvent | null {
  let best: CrossingEvent | null = null;
  for (const e of events) {
    if (e.kind !== kind || (!e.latest_open && e.latest_ms < now) || e.best_ms < start) continue;
    if (best === null || e.best_ms < best.best_ms) best = e;
  }
  return best;
}

function rangeText(e: CrossingEvent): string | null {
  if (e.earliest_open || e.latest_open) return "earliest–latest open";
  const a = whenText(e.earliest_ms, { year: false });
  const b = whenText(e.latest_ms, { year: false });
  if (a === b) return null;
  const [da, ta] = [a.slice(0, a.lastIndexOf(" ")), a.slice(a.lastIndexOf(" ") + 1).replace(/\u00a0UTC$/, "")];
  const db = b.slice(0, b.lastIndexOf(" "));
  return `earliest–latest ${da} ${ta}–${da === db ? b.slice(b.lastIndexOf(" ") + 1) : b}`;
}

function Row({ kind, event, timeMs, onTrace, busy }: { kind: CountdownKind; event: CrossingEvent; timeMs: number; onTrace?: CountdownProps["onTrace"]; busy: boolean }) {
  const rem = event.best_ms - timeMs;
  const now = rem <= 0;
  const range = rangeText(event);
  const body = (
    <>
      <span className={`cd-dot cd-${BODY[kind]}`} aria-hidden="true" />
      <span className="cd-name">{KIND_LABEL[kind]}</span>
      <span className="cd-in num">{now ? "now" : `in ${spanText(rem)}`}</span>
      <span className="cd-when num">
        {whenText(event.best_ms)}
        {range && <span className="cd-range"> · {range}</span>}
      </span>
      {onTrace && <span className="cd-act">{busy ? <Spinner size={12} /> : <Icon name="search" size={12} />}</span>}
    </>
  );
  if (!onTrace) return <li className="cd-row">{body}</li>;
  return (
    <li>
      <button type="button" className="cd-row cd-btn" onClick={() => onTrace(kind, event)} title="Trace what sets it">
        {body}
      </button>
    </li>
  );
}

export function Countdown({ events, timeMs, title = "Next events", onTrace, tracing = null, startMs = -Infinity, endMs }: CountdownProps) {
  const found = KINDS.map((k) => ({ kind: k, event: next(events, k, timeMs, startMs - 60_000) }));
  const shown = found.filter((f): f is { kind: CountdownKind; event: CrossingEvent } => f.event !== null).sort((a, b) => a.event.best_ms - b.event.best_ms);
  const missing = found.filter((f) => f.event === null).map((f) => NONE_LABEL[f.kind]);
  const list = missing.length > 1 ? `${missing.slice(0, -1).join(", ")} or ${missing[missing.length - 1]}` : missing[0];
  return (
    <Panel title={title} scroll={false}>
      <ul className="cd-list">
        {shown.map((f) => (
          <Row key={f.kind} kind={f.kind} event={f.event} timeMs={timeMs} onTrace={onTrace} busy={tracing === f.kind} />
        ))}
      </ul>
      {missing.length > 0 && (
        <p className="cd-none">
          No {list} {endMs !== undefined ? `before ${whenText(endMs, { year: false }).replace(/ \d\d:\d\d\u00a0UTC$/, "")}` : "later in the mission"}
        </p>
      )}
    </Panel>
  );
}
