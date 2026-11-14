import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { IconButton } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Progress";
import type { Interval } from "../../contract/types";
import { clamp } from "../../lib/scale";
import { MS_DAY, MS_HOUR, MS_LUNATION } from "../../lib/time";
import { dayText, dayTimeText, monthTicks, roundToHour, type Survey } from "./survey";

interface PinnedRowProps {
  label: string;
  sub: string;
  survey: Survey | null;
  failed: boolean;
  start_ms: number;
  end_ms: number;
  onSelect(): void;
  onRemove(): void;
}

interface WindowStripProps {
  start_ms: number;
  end_ms: number;
  timeMs: number;
  survey: Survey | null;
  busy: boolean;
  children?: ReactNode;
  tools?: ReactNode;
  onScrub(ms: number): void;
  onCommit(ms: number): void;
}

type LaneKind = "sun" | "earth" | "both";

function Lane({ kind, list, start, end, lengths }: { kind: LaneKind; list: readonly Interval[]; start: number; end: number; lengths?: boolean }) {
  const span = end - start;
  return (
    <div className={`ws-lane ws-lane-${kind}`}>
      {list.map((iv) => {
        const days = (iv.end_ms - iv.start_ms) / MS_DAY;
        return (
          <i key={iv.start_ms} style={{ left: `${((iv.start_ms - start) / span) * 100}%`, width: `${((iv.end_ms - iv.start_ms) / span) * 100}%` }}>
            {lengths && days >= 6 ? `${Math.round(days)} d` : null}
          </i>
        );
      })}
    </div>
  );
}

export function PinnedRow({ label, sub, survey, failed, start_ms, end_ms, onSelect, onRemove }: PinnedRowProps) {
  return (
    <div className="ws-row ws-block ws-pinned">
      <div className="ws-gutter ws-pin-head">
        <button type="button" className="ws-pin-name" title={`Switch to ${label}`} onClick={onSelect}>
          <strong>{label}</strong>
          <span className="num">{sub}</span>
        </button>
        <IconButton icon="close" size="sm" label={`Unpin ${label}`} onClick={onRemove} />
      </div>
      <div className="ws-lanes">
        <Lane kind="sun" list={survey?.sun ?? []} start={start_ms} end={end_ms} />
        <Lane kind="earth" list={survey?.earth ?? []} start={start_ms} end={end_ms} />
        <Lane kind="both" list={survey?.both ?? []} start={start_ms} end={end_ms} lengths />
        {!survey && (
          <div className="ws-wait" role="status">
            {failed ? "Could not compute this site" : <Spinner size={12} />}
          </div>
        )}
      </div>
    </div>
  );
}

export function WindowStrip({ start_ms, end_ms, timeMs, survey, busy, children, tools, onScrub, onCommit }: WindowStripProps) {
  const dragging = useRef(false);
  const [hover, setHover] = useState<number | null>(null);
  const span = end_ms - start_ms;
  const ticks = monthTicks(start_ms, end_ms);
  const frac = clamp((timeMs - start_ms) / span, 0, 1);

  const at = (e: PointerEvent<HTMLDivElement>): number => {
    const r = e.currentTarget.getBoundingClientRect();
    return roundToHour(start_ms + clamp((e.clientX - r.left) / r.width, 0, 1) * span);
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    setHover(null);
    onScrub(at(e));
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) onScrub(at(e));
    else setHover(at(e));
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    onCommit(at(e));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowLeft" || e.key === "ArrowRight" ? (e.shiftKey ? MS_HOUR : MS_DAY) : e.key === "PageUp" || e.key === "PageDown" ? MS_LUNATION : 0;
    if (step === 0) return;
    e.preventDefault();
    const dir = e.key === "ArrowLeft" || e.key === "PageDown" ? -1 : 1;
    onCommit(roundToHour(clamp(timeMs + dir * step, start_ms, end_ms)));
  };

  return (
    <div className="ws-strip" data-busy={busy}>
      <div className="ws-row ws-axis-row">
        <div className="ws-gutter ws-gutter-tools">{tools}</div>
        <div className="ws-axis" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t.ms} style={{ left: `${((t.ms - start_ms) / span) * 100}%` }}>
              {t.year !== null ? `${t.label} ${t.year}` : t.label}
            </span>
          ))}
        </div>
      </div>

      <div className="ws-row ws-block ws-primary">
        <div className="ws-gutter ws-lane-labels">
          <span className="ws-key ws-key-sun">Sunlight</span>
          <span className="ws-key ws-key-earth">Earth in view</span>
          <span className="ws-key ws-key-both">Both</span>
        </div>
        <div className="ws-lanes">
          <Lane kind="sun" list={survey?.sun ?? []} start={start_ms} end={end_ms} />
          <Lane kind="earth" list={survey?.earth ?? []} start={start_ms} end={end_ms} />
          <Lane kind="both" list={survey?.both ?? []} start={start_ms} end={end_ms} lengths />
          {!survey && (
            <div className="ws-wait" role="status">
              <Spinner size={12} /> Computing a year of Sun and Earth visibility
            </div>
          )}
        </div>
      </div>

      {children}

      <div
        className="ws-scrub"
        role="slider"
        tabIndex={0}
        aria-label="Landing date"
        title="Drag to change the landing date"
        aria-valuemin={start_ms}
        aria-valuemax={end_ms}
        aria-valuenow={timeMs}
        aria-valuetext={dayTimeText(timeMs)}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
      >
        {ticks.map((t) => (
          <i key={t.ms} className="ws-grid" style={{ left: `${((t.ms - start_ms) / span) * 100}%` }} />
        ))}
        {hover !== null && (
          <div className="ws-hover" style={{ left: `${((hover - start_ms) / span) * 100}%` }}>
            <span>{dayText(hover)}</span>
          </div>
        )}
        <div className="ws-cursor" style={{ left: `${frac * 100}%` }}>
          <span>{dayText(timeMs)}</span>
        </div>
      </div>
    </div>
  );
}
