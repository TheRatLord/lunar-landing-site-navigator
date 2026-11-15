import { useRef, useState, type PointerEvent } from "react";
import { Spinner } from "../../components/ui/Progress";
import type { Interval } from "../../contract/types";
import { clamp } from "../../lib/scale";
import { yearText, type LandingWindow } from "../../scenario/planSearch";
import { useClock, type Stay } from "./clock";
import type { VerdictSpan } from "./scan";
import { dayText, monthTicks, roundToHour } from "./survey";

export interface BarMark {
  key: string;
  t_ms: number;
  n: number;
  verdict: string | null;
}

interface YearBarProps {
  view: LandingWindow;
  window: LandingWindow;
  spans: readonly VerdictSpan[] | null;
  both: readonly Interval[] | null;
  marks: readonly BarMark[];
  stay: Stay;
  preview: Stay | null;
  busy: boolean;
  onPick(ms: number): void;
}

function Playhead({ view }: { view: LandingWindow }) {
  const t = useClock((c) => c.t_ms);
  if (t === null || t < view.first_ms || t >= view.last_ms) return null;
  return <i className="yb-play" style={{ left: `${((t - view.first_ms) / (view.last_ms - view.first_ms)) * 100}%` }} />;
}

export function YearBar({ view, window: win, spans, both, marks, stay, preview, busy, onPick }: YearBarProps) {
  const [hover, setHover] = useState<number | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const span = view.last_ms - view.first_ms;
  const frac = (ms: number) => clamp((ms - view.first_ms) / span, 0, 1);
  const pct = (ms: number) => `${frac(ms) * 100}%`;
  const width = (a: number, b: number) => `${(frac(b) - frac(a)) * 100}%`;
  const ticks = monthTicks(view.first_ms, view.last_ms);
  const whole = win.first_ms <= view.first_ms && win.last_ms >= view.last_ms;
  const at = (e: PointerEvent<HTMLElement>): number => {
    const r = e.currentTarget.getBoundingClientRect();
    return view.first_ms + clamp((e.clientX - r.left) / r.width, 0, 1) * span;
  };
  const bracket = (s: Stay, kind: "stay" | "preview") =>
    s.end_ms <= view.first_ms || s.start_ms >= view.last_ms ? null : <i className="yb-stay" data-kind={kind} style={{ left: pct(s.start_ms), width: width(s.start_ms, s.end_ms) }} />;

  return (
    <div className="yb">
      <div className="yb-head">
        <strong className="yb-year">{yearText(view)}</strong>
        {!whole && <span className="yb-window">{`${dayText(win.first_ms)} – ${dayText(win.last_ms - 1)}`}</span>}
      </div>
      <div
        ref={track}
        className="yb-track"
        title="Click to land then"
        onPointerUp={(e) => {
          if (e.button !== 0 && e.pointerType === "mouse") return;
          onPick(roundToHour(at(e)));
        }}
        onPointerMove={(e) => setHover(at(e))}
        onPointerLeave={() => setHover(null)}
      >
        <div className="yb-lane" data-busy={busy || undefined}>
          {spans
            ? spans.map((iv) => (iv.verdict === "fail" ? null : <i key={iv.start_ms} data-verdict={iv.verdict} style={{ left: pct(iv.start_ms), width: width(iv.start_ms, iv.end_ms) }} />))
            : (both ?? []).map((iv) => <i key={iv.start_ms} data-verdict="both" style={{ left: pct(iv.start_ms), width: width(iv.start_ms, iv.end_ms) }} />)}
          {busy && (
            <span className="yb-wait">
              <Spinner size={10} />
            </span>
          )}
        </div>
        {!whole && (
          <>
            <i className="yb-dim" style={{ left: 0, width: pct(win.first_ms) }} />
            <i className="yb-dim" style={{ left: pct(win.last_ms), right: 0 }} />
          </>
        )}
        {bracket(stay, "stay")}
        {preview && bracket(preview, "preview")}
        {marks.map((m) =>
          m.t_ms < view.first_ms || m.t_ms >= view.last_ms ? null : (
            <span key={m.key} className="yb-mark" data-verdict={m.verdict ?? undefined} style={{ left: pct(m.t_ms) }} title={`#${m.n} · ${dayText(m.t_ms)}`}>
              {m.n}
            </span>
          ),
        )}
        <Playhead view={view} />
        {hover !== null && (
          <span className="yb-hover" style={{ left: pct(hover) }}>
            {dayText(hover)}
          </span>
        )}
      </div>
      <div className="yb-axis" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t.ms} style={{ left: pct(t.ms) }}>
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}
