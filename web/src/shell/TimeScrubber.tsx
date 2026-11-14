import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { IconButton } from "../components/ui/Button";
import { DateTimeInput, Select } from "../components/ui/Fields";
import { Menu, type MenuItem } from "../components/ui/Menu";
import { Segmented } from "../components/ui/Segmented";
import { Toolstrip } from "../components/ui/Toolstrip";
import { withUnit } from "../lib/format";
import { clamp } from "../lib/scale";
import { MS_DAY, MS_HOUR, MS_LUNATION, STEP_MS, formatMet, formatUtc, timeTicks, type StepUnit } from "../lib/time";
import { PLAY_SPEEDS, useApp } from "../state/store";

const STEP_OPTIONS = [
  { value: "hour", label: withUnit("1", "h") },
  { value: "day", label: withUnit("1", "d") },
  { value: "lunation", label: withUnit("1", "lun") },
];

const CLOCK_OPTIONS = [
  { value: "utc", label: "UTC" },
  { value: "met", label: "MET" },
];

const STEP_NAME: Record<StepUnit, string> = { hour: "one hour", day: "one Earth day", lunation: "one lunation" };

function speedLabel(s: number): string {
  if (s < 3600) return withUnit(String(s / 60), "min/s");
  if (s < 86400) return withUnit(String(s / 3600), "h/s");
  return withUnit(String(s / 86400), "d/s");
}

const PRESETS = [
  { id: "1l", label: "1 lunation from now", len: MS_LUNATION },
  { id: "3l", label: "3 lunations from now", len: 3 * MS_LUNATION },
  { id: "1y", label: "1 year from now", len: 365.25 * MS_DAY },
  { id: "all", label: "Whole mission", len: null },
];

function rangeLabel(ms: number): string {
  if (ms >= MS_DAY) return withUnit(String(Math.round((ms / MS_DAY) * 10) / 10), "d");
  return withUnit(String(Math.round((ms / MS_HOUR) * 10) / 10), "h");
}

type DragTarget = "time" | "start" | "end";

export function TimeScrubber() {
  const timeMs = useApp((s) => s.timeMs);
  const bounds = useApp((s) => s.bounds);
  const range = useApp((s) => s.range);
  const playing = useApp((s) => s.playing);
  const speed = useApp((s) => s.speed);
  const showMet = useApp((s) => s.showMet);
  const metEpoch = useApp((s) => s.metEpochMs);
  const { setRange, setPlaying, setSpeed, setTime, setShowMet, stepTime } = useApp.getState();
  const [unit, setUnit] = useState<StepUnit>("hour");

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

  const span = bounds.end_ms - bounds.start_ms;
  const frac = (ms: number) => ((ms - bounds.start_ms) / span) * 100;
  const ticks = useMemo(
    () => timeTicks(bounds.start_ms, bounds.end_ms, Math.max(3, Math.floor(width / 120))),
    [bounds, width],
  );

  const applyDrag = useCallback(
    (target: DragTarget, ms: number) => {
      const st = useApp.getState();
      if (target === "time") st.setTime(ms);
      else if (target === "start") st.setRange({ start_ms: clamp(ms, st.bounds.start_ms, st.range.end_ms - 3_600_000), end_ms: st.range.end_ms });
      else st.setRange({ start_ms: st.range.start_ms, end_ms: clamp(ms, st.range.start_ms + 3_600_000, st.bounds.end_ms) });
    },
    [],
  );

  const startDrag = (target: DragTarget) => (e: PointerEvent<HTMLElement>) => {
    const el = rail.current;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).focus();
    const move = (ev: globalThis.PointerEvent) => {
      const r = el.getBoundingClientRect();
      const f = clamp((ev.clientX - r.left) / r.width, 0, 1);
      applyDrag(target, bounds.start_ms + f * span);
    };
    move(e.nativeEvent);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onKey = (target: DragTarget) => (e: KeyboardEvent<HTMLElement>) => {
    const base = target === "time" ? timeMs : target === "start" ? range.start_ms : range.end_ms;
    let delta: number;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") delta = STEP_MS[unit];
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") delta = -STEP_MS[unit];
    else if (e.key === "PageUp") delta = MS_LUNATION;
    else if (e.key === "PageDown") delta = -MS_LUNATION;
    else if (e.key === "Home") return (e.preventDefault(), applyDrag(target, bounds.start_ms));
    else if (e.key === "End") return (e.preventDefault(), applyDrag(target, bounds.end_ms));
    else return;
    e.preventDefault();
    applyDrag(target, base + delta);
  };

  const rangeItems: MenuItem[] = PRESETS.map((p) => ({
    id: p.id,
    label: p.label,
    onSelect: () => setRange(p.len === null ? { ...bounds } : { start_ms: timeMs, end_ms: Math.min(bounds.end_ms, timeMs + p.len) }),
  }));

  const handle = (target: DragTarget, ms: number, label: string, min: number, max: number) => (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={ms}
      aria-valuetext={formatUtc(ms)}
      title={formatUtc(ms)}
      className={`scrub-handle scrub-${target}`}
      style={{ left: `${frac(ms)}%` }}
      onPointerDown={startDrag(target)}
      onKeyDown={onKey(target)}
    />
  );

  const stepName = STEP_NAME[unit];

  return (
    <footer className="scrubber" aria-label="Time scrubber">
      <Toolstrip>
        <IconButton icon="stepBack" label={`Step back ${stepName}`} onClick={() => stepTime(unit, -1)} />
        <IconButton
          icon={playing ? "pause" : "play"}
          label={playing ? "Pause" : "Play"}
          shortcut="Space"
          variant="primary"
          onClick={() => setPlaying(!playing)}
        />
        <IconButton icon="stepFwd" label={`Step forward ${stepName}`} onClick={() => stepTime(unit, 1)} />
      </Toolstrip>
      <Segmented label="Step size" size="sm" value={unit} onChange={(v) => setUnit(v as StepUnit)} options={STEP_OPTIONS} />
      <Select
        aria-label="Playback speed"
        className="scrub-speed"
        value={String(speed)}
        onChange={(v) => setSpeed(Number(v) as (typeof PLAY_SPEEDS)[number])}
        options={PLAY_SPEEDS.map((s) => ({ value: String(s), label: speedLabel(s) }))}
      />
      <Menu label="Analysis range" text={<span className="num">{rangeLabel(range.end_ms - range.start_ms)}</span>} icon="clock" width={200} items={rangeItems} />

      <div className="scrub-track">
        <div ref={rail} className="scrub-rail" onPointerDown={startDrag("time")}>
          <div className="scrub-range" style={{ left: `${frac(range.start_ms)}%`, width: `${frac(range.end_ms) - frac(range.start_ms)}%` }} />
          {ticks.map((t) => (
            <div key={t.ms} className={`scrub-tick ${t.major ? "major" : ""}`} style={{ left: `${frac(t.ms)}%` }}>
              <span>{t.label}</span>
            </div>
          ))}
          {handle("start", range.start_ms, "Analysis range start", bounds.start_ms, range.end_ms)}
          {handle("end", range.end_ms, "Analysis range end", range.start_ms, bounds.end_ms)}
          {handle("time", timeMs, "Selected time", bounds.start_ms, bounds.end_ms)}
        </div>
      </div>

      <div className="scrub-now">
        {showMet ? (
          <output className="scrub-met num" aria-label="Mission elapsed time">
            {formatMet(timeMs, metEpoch)}
          </output>
        ) : (
          <DateTimeInput compact value={timeMs} min={bounds.start_ms} max={bounds.end_ms} onChange={setTime} label="Selected UTC time" />
        )}
      </div>
      <Segmented
        label="Time readout"
        size="sm"
        value={showMet ? "met" : "utc"}
        onChange={(v) => setShowMet(v === "met")}
        options={CLOCK_OPTIONS}
      />
    </footer>
  );
}
