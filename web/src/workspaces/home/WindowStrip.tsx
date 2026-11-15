import { formatQuantity } from "../../lib/requirements";
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { IconButton } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Progress";
import type { Interval } from "../../contract/types";
import type { LandingWindow } from "../../scenario/planSearch";
import { clamp } from "../../lib/scale";
import { MS_DAY, MS_HOUR, MS_LUNATION } from "../../lib/time";
import type { BestLanding, VerdictSpan, YearScan } from "./scan";
import { dayText, dayTimeText, monthTicks, roundToHour, type Survey } from "./survey";

interface PinnedRowProps {
  label: string;
  sub: string;
  survey: Survey | null;
  scan: YearScan | null;
  requirements: boolean;
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
  failed: boolean;
  siteName: string;
  scan: YearScan | null;
  scanState: "off" | "busy" | "failed" | "ready";
  best: BestLanding[];
  landingWindow: LandingWindow | null;
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
            {lengths && days >= 8 ? formatQuantity(days * 24, "h") : null}
          </i>
        );
      })}
    </div>
  );
}

const EDGE = 0.006;

function RequirementLane({ spans, start, end, best, state, onPick }: { spans: readonly VerdictSpan[]; start: number; end: number; best: BestLanding[]; state: WindowStripProps["scanState"]; onPick(ms: number): void }) {
  const span = end - start;
  const top = best.reduce<BestLanding | null>((a, b) => (!a || b.key > a.key ? b : a), null);
  const frac = (ms: number) => (ms - start) / span;
  const pos = (ms: number) => `${frac(ms) * 100}%`;
  return (
    <div className="ws-req">
      <div className="ws-lane ws-lane-req">
        {spans.map((iv) => (
          <i key={iv.start_ms} data-verdict={iv.verdict} style={{ left: pos(iv.start_ms), width: `${((iv.end_ms - iv.start_ms) / span) * 100}%` }} />
        ))}
        {state === "busy" && (
          <span className="ws-req-wait">
            <Spinner size={10} />
          </span>
        )}
      </div>
      {best.map((b) =>
        frac(b.t_ms) < EDGE || frac(b.t_ms) > 1 - EDGE ? null : (
          <button
            key={b.t_ms}
            type="button"
            className="ws-best"
            data-top={b === top || undefined}
            data-verdict={b.verdict}
            style={{ left: pos(b.t_ms) }}
            aria-label={`${b === top ? "Best landing" : b.verdict === "marginal" ? "Marginal, best in this lunar day" : "Best in this lunar day"}: ${dayTimeText(b.t_ms)}`}
            title={`${b === top ? "Best" : b.verdict === "marginal" ? "Marginal" : "Best in this lunar day"} · ${dayText(b.t_ms)}`}
            onClick={() => onPick(b.t_ms)}
          />
        ),
      )}
      {top && frac(top.t_ms) >= EDGE && frac(top.t_ms) <= 1 - EDGE && (
        <span className="ws-best-label" data-flip={frac(top.t_ms) > 0.85 || undefined} style={{ left: pos(top.t_ms) }} aria-hidden="true">
          Best {dayText(top.t_ms)}
        </span>
      )}
    </div>
  );
}

function share(scan: YearScan): string {
  const pct = scan.passFraction * 100;
  return pct > 0 && pct < 0.5 ? "<1%" : `${Math.round(pct)}%`;
}

export function PinnedRow({ label, sub, survey, scan, requirements, failed, start_ms, end_ms, onSelect, onRemove }: PinnedRowProps) {
  const ready = requirements ? scan !== null : survey !== null;
  return (
    <div className="ws-row ws-block ws-pinned">
      <div className="ws-gutter ws-pin-head">
        <button type="button" className="ws-pin-name" title={`Switch to ${label}`} onClick={onSelect}>
          <strong>{label}</strong>
          <span className="num">{requirements && scan ? `Meets ${share(scan)}` : sub}</span>
        </button>
        <IconButton icon="close" size="sm" label={`Unpin ${label}`} onClick={onRemove} />
      </div>
      <div className="ws-lanes">
        {requirements ? (
          <div className="ws-lane ws-lane-req">
            {(scan?.spans ?? []).map((iv) => (
              <i key={iv.start_ms} data-verdict={iv.verdict} style={{ left: `${((iv.start_ms - start_ms) / (end_ms - start_ms)) * 100}%`, width: `${((iv.end_ms - iv.start_ms) / (end_ms - start_ms)) * 100}%` }} />
            ))}
          </div>
        ) : (
          <Lane kind="both" list={survey?.both ?? []} start={start_ms} end={end_ms} lengths />
        )}
        {!ready && (
          <div className="ws-wait" role="status">
            {failed ? null : <Spinner size={12} />}
          </div>
        )}
      </div>
    </div>
  );
}

export function WindowStrip({ start_ms, end_ms, timeMs, survey, busy, failed, siteName, scan, scanState, best, landingWindow, children, tools, onScrub, onCommit }: WindowStripProps) {
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
        <div className="ws-gutter ws-gutter-tools">
          <strong className="ws-site" title={siteName}>
            {siteName}
          </strong>
          {tools}
        </div>
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
          <span className="ws-key ws-key-earth">Earth link</span>
          {scanState === "off" ? <span className="ws-key ws-key-both">Both</span> : (
            <span className="ws-key ws-key-req">
              Meets requirements
              {best.length > 0 && scan && <em className="ws-key-best">◆ best</em>}
            </span>
          )}
        </div>
        <div className="ws-lanes">
          <Lane kind="sun" list={survey?.sun ?? []} start={start_ms} end={end_ms} />
          <Lane kind="earth" list={survey?.earth ?? []} start={start_ms} end={end_ms} />
          {scanState === "off" && <Lane kind="both" list={survey?.both ?? []} start={start_ms} end={end_ms} lengths />}
          {scanState !== "off" && <RequirementLane spans={scan?.spans ?? []} start={start_ms} end={end_ms} best={scan ? best : []} state={scanState} onPick={onCommit} />}
          {!survey && !failed && (
            <div className="ws-wait" role="status">
              <Spinner size={12} />
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
        {landingWindow && landingWindow.last_ms > start_ms && landingWindow.first_ms < end_ms && (
          <i
            className="ws-window"
            style={{ left: `${clamp((landingWindow.first_ms - start_ms) / span, 0, 1) * 100}%`, right: `${(1 - clamp((landingWindow.last_ms - start_ms) / span, 0, 1)) * 100}%` }}
          >
            <span>Window</span>
          </i>
        )}
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
