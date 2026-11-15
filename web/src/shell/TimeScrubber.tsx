import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { IconButton } from "../components/ui/Button";
import { clamp } from "../lib/scale";
import { MS_DAY, MS_HOUR, timeTicks } from "../lib/time";
import { planStay, useScenario } from "../scenario/store";
import { whenText } from "../scenario/when";
import { useApp } from "../state/store";

export function togglePlay(): void {
  const { playing, timeMs, setTime, setPlaying } = useApp.getState();
  const doc = useScenario.getState().doc;
  const stay = doc ? planStay(doc) : null;
  if (!stay) return;
  if (!playing && (timeMs < stay.start_ms || timeMs >= stay.end_ms)) setTime(stay.start_ms);
  setPlaying(!playing);
}

export function TimeScrubber() {
  const timeMs = useApp((s) => s.timeMs);
  const playing = useApp((s) => s.playing);
  const doc = useScenario((s) => s.doc);
  const setTime = useApp((s) => s.setTime);
  const stay = doc ? planStay(doc) : null;

  const rail = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const start = stay?.start_ms ?? 0;
  const end = stay?.end_ms ?? 1;
  const span = Math.max(1, end - start);
  const ticks = useMemo(() => timeTicks(start, end, Math.max(3, Math.floor(width / 110))), [start, end, width]);
  const frac = (ms: number) => clamp((ms - start) / span, 0, 1) * 100;
  const go = (ms: number) => setTime(clamp(ms, start, end));

  const startDrag = (e: PointerEvent<HTMLElement>) => {
    const el = rail.current;
    if (!el || !stay) return;
    e.preventDefault();
    el.querySelector<HTMLElement>(".scrub-handle")?.focus();
    const move = (ev: globalThis.PointerEvent) => {
      const r = el.getBoundingClientRect();
      go(start + clamp((ev.clientX - r.left) / r.width, 0, 1) * span);
    };
    move(e.nativeEvent);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    const step = e.shiftKey || e.key === "PageUp" || e.key === "PageDown" ? MS_DAY : MS_HOUR;
    if (e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "PageUp") go(timeMs + step);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown" || e.key === "PageDown") go(timeMs - step);
    else if (e.key === "Home") go(start);
    else if (e.key === "End") go(end);
    else return;
    e.preventDefault();
  };

  return (
    <footer className="scrubber" aria-label="Time scrubber">
      <IconButton icon={playing ? "pause" : "play"} label={playing ? "Pause" : "Play"} shortcut="Space" variant="primary" disabled={!stay} onClick={togglePlay} />
      <div className="scrub-track">
        <div ref={rail} className="scrub-rail" onPointerDown={startDrag}>
          {ticks.map((t) => (
            <div key={t.ms} className={`scrub-tick ${t.major ? "major" : ""}`} style={{ left: `${frac(t.ms)}%` }}>
              <span>{t.label}</span>
            </div>
          ))}
          <div className="scrub-fill" style={{ width: `${frac(timeMs)}%` }} />
          <div
            role="slider"
            tabIndex={0}
            aria-label="Time"
            aria-orientation="horizontal"
            aria-valuemin={start}
            aria-valuemax={end}
            aria-valuenow={clamp(timeMs, start, end)}
            aria-valuetext={whenText(timeMs)}
            className="scrub-handle"
            style={{ left: `${frac(timeMs)}%` }}
            onKeyDown={onKey}
          />
        </div>
      </div>
      <output className="scrub-now num" aria-label="Time shown">
        {whenText(timeMs)}
      </output>
    </footer>
  );
}
