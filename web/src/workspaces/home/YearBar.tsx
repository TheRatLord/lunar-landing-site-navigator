import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { IconButton } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Progress";
import type { Interval } from "../../contract/types";
import { clamp } from "../../lib/scale";
import { MS_DAY } from "../../lib/time";
import { yearText, type LandingWindow } from "../../scenario/planSearch";
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
  landingMs: number;
  busy: boolean;
  onWindow(w: LandingWindow): void;
  onDraft(w: LandingWindow | null): void;
  onPick(ms: number): void;
  onYear(delta: number): void;
}

type Drag = { mode: "new" | "first" | "last"; x0: number; t0: number; moved: boolean };

const roundDay = (ms: number): number => Math.round(ms / MS_DAY) * MS_DAY;

export function YearBar({ view, window: win, spans, both, marks, landingMs, busy, onWindow, onDraft, onPick, onYear }: YearBarProps) {
  const drag = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<LandingWindow | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const span = view.last_ms - view.first_ms;
  const shown = draft ?? win;
  const frac = (ms: number) => clamp((ms - view.first_ms) / span, 0, 1);
  const pct = (ms: number) => `${frac(ms) * 100}%`;
  const width = (a: number, b: number) => `${(frac(b) - frac(a)) * 100}%`;
  const ticks = monthTicks(view.first_ms, view.last_ms);
  const whole = shown.first_ms <= view.first_ms && shown.last_ms >= view.last_ms;

  const at = (e: PointerEvent<HTMLElement>, el: HTMLElement): number => {
    const r = el.getBoundingClientRect();
    return view.first_ms + clamp((e.clientX - r.left) / r.width, 0, 1) * span;
  };
  const make = (a: number, b: number): LandingWindow => {
    const lo = clamp(roundDay(Math.min(a, b)), view.first_ms, view.last_ms);
    const hi = clamp(roundDay(Math.max(a, b)), view.first_ms, view.last_ms);
    return hi - lo < MS_DAY ? { first_ms: lo, last_ms: Math.min(view.last_ms, lo + MS_DAY) } : { first_ms: lo, last_ms: hi };
  };
  const show = (w: LandingWindow | null) => {
    setDraft(w);
    onDraft(w);
  };

  const track = useRef<HTMLDivElement>(null);
  const onDown = (e: PointerEvent<HTMLElement>, mode: Drag["mode"]) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.stopPropagation();
    const el = track.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    drag.current = { mode, x0: e.clientX, t0: at(e, el), moved: false };
    setHover(null);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = track.current;
    if (!el) return;
    const d = drag.current;
    const t = at(e, el);
    if (!d) return setHover(t);
    if (!d.moved && Math.abs(e.clientX - d.x0) < 4) return;
    d.moved = true;
    if (d.mode === "new") show(make(d.t0, t));
    else if (d.mode === "first") show(make(t, shown.last_ms));
    else show(make(shown.first_ms, t));
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    const el = track.current;
    if (!d || !el) return;
    if (!d.moved) {
      show(null);
      if (d.mode === "new") onPick(roundToHour(at(e, el)));
      return;
    }
    const final = draft;
    show(null);
    if (final) onWindow(final);
  };
  const onKey = (e: KeyboardEvent<HTMLElement>, edge: "first" | "last") => {
    const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const days = (e.shiftKey ? 7 : 1) * step * MS_DAY;
    onWindow(edge === "first" ? make(win.first_ms + days, win.last_ms) : make(win.first_ms, win.last_ms + days));
  };

  return (
    <div className="yb">
      <div className="yb-head">
        <IconButton icon="chevronLeft" size="sm" variant="ghost" label="Previous year" onClick={() => onYear(-1)} />
        <strong className="yb-year">{yearText(view)}</strong>
        <IconButton icon="chevronRight" size="sm" variant="ghost" label="Next year" onClick={() => onYear(1)} />
        {!whole && <span className="yb-window">{`${dayText(shown.first_ms)} – ${dayText(shown.last_ms - 1)}`}</span>}
      </div>
      <div
        ref={track}
        className="yb-track"
        title="Click to land then. Drag to set the landing window."
        onPointerDown={(e) => onDown(e, "new")}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
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
            <i className="yb-dim" style={{ left: 0, width: pct(shown.first_ms) }} />
            <i className="yb-dim" style={{ left: pct(shown.last_ms), right: 0 }} />
          </>
        )}
        <div className="yb-range" style={{ left: pct(shown.first_ms), width: width(shown.first_ms, shown.last_ms) }}>
          <span
            className="yb-handle"
            data-edge="first"
            role="slider"
            tabIndex={0}
            aria-label="Earliest landing"
            aria-valuemin={view.first_ms}
            aria-valuemax={view.last_ms}
            aria-valuenow={shown.first_ms}
            aria-valuetext={dayText(shown.first_ms, true)}
            onPointerDown={(e) => onDown(e, "first")}
            onKeyDown={(e) => onKey(e, "first")}
          />
          <span
            className="yb-handle"
            data-edge="last"
            role="slider"
            tabIndex={0}
            aria-label="Latest landing"
            aria-valuemin={view.first_ms}
            aria-valuemax={view.last_ms}
            aria-valuenow={shown.last_ms}
            aria-valuetext={dayText(shown.last_ms - 1, true)}
            onPointerDown={(e) => onDown(e, "last")}
            onKeyDown={(e) => onKey(e, "last")}
          />
        </div>
        {marks.map((m) =>
          m.t_ms < view.first_ms || m.t_ms >= view.last_ms ? null : (
            <span key={m.key} className="yb-mark" data-verdict={m.verdict ?? undefined} style={{ left: pct(m.t_ms) }} title={`#${m.n} · ${dayText(m.t_ms)}`}>
              {m.n}
            </span>
          ),
        )}
        {landingMs >= view.first_ms && landingMs < view.last_ms && <i className="yb-cursor" style={{ left: pct(landingMs) }} title={`Plan landing · ${dayText(landingMs)}`} />}
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
