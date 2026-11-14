import { useMemo, type KeyboardEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Chapter } from "../chapters";
import { useTimeline } from "../derive";
import { dateOfDay } from "../geometry";
import { landingOf, useLearn } from "../store";
import { EclipseIcon, LanderIcon, PauseIcon, PlayIcon } from "./icons";

const fmt = (d: number, month: "short" | "long") =>
  dateOfDay(d).toLocaleDateString("en-GB", { day: "numeric", month, year: "numeric", timeZone: "UTC" });

function bands(arr: Float32Array, stepD: number, span: number, on: string, off: string): string {
  const stops: string[] = [];
  let start = 0;
  let cur = (arr[0] ?? 0) >= 0.5;
  const pct = (t: number) => `${((Math.min(t, span) / span) * 100).toFixed(3)}%`;
  for (let i = 1; i < arr.length; i++) {
    const v = arr[i]! >= 0.5;
    if (v === cur) continue;
    const t = i * stepD;
    stops.push(`${cur ? on : off} ${pct(start)} ${pct(t)}`);
    start = t;
    cur = v;
  }
  stops.push(`${cur ? on : off} ${pct(start)} 100%`);
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

function dayText(t: number): { day: number; hours: number } {
  const day = Math.floor(t + 1e-6) + 1;
  const hours = Math.floor(((t + 1e-6) % 1) * 24);
  return { day, hours };
}

export function TimeBar({ c }: { c: Chapter }) {
  const { t, playing, chapter, landingOffset } = useLearn(
    useShallow((s) => ({ t: s.t, playing: s.playing, chapter: s.chapter, landingOffset: s.landingOffset })),
  );
  const setT = useLearn((s) => s.setT);
  const togglePlay = useLearn((s) => s.togglePlay);
  const jump = (to: number) => {
    useLearn.getState().setPlaying(false);
    setT(to);
  };
  const onRangeKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const k = e.key;
    let dt = 0;
    if (k === "ArrowLeft" || k === "ArrowDown") dt = e.shiftKey ? -1 : -0.25;
    else if (k === "ArrowRight" || k === "ArrowUp") dt = e.shiftKey ? 1 : 0.25;
    else if (k === "PageDown") dt = -1;
    else if (k === "PageUp") dt = 1;
    if (!dt) return;
    e.preventDefault();
    useLearn.getState().nudge(dt);
  };
  const tl = useTimeline();
  const span = c.spanDays;
  const d = c.epochD + t;
  const { day, hours } = dayText(t);
  const landing = landingOf({ chapter, landingOffset });
  const showEarth = c.chips.includes("earth");
  const sunBands = useMemo(() => bands(tl.sun, tl.stepD, span, "var(--l-day)", "var(--l-night)"), [tl, span]);
  const earthBands = useMemo(() => bands(tl.earth, tl.stepD, span, "var(--c-earth)", "transparent"), [tl, span]);
  const eclipses = c.ticks.includes("eclipse") ? tl.events.filter((e) => e.kind === "eclipse" && e.t > 0.05 && e.t < span - 0.05) : [];
  const valueText = `Day ${day}${hours ? ` and ${hours} hour${hours === 1 ? "" : "s"}` : ""}, ${fmt(d, "long")} on Earth's calendar`;
  return (
    <div className="l-timebar" role="group" aria-label="Time">
      <button
        type="button"
        className="l-play"
        aria-label={playing ? "Pause" : "Play"}
        aria-keyshortcuts="Space"
        onClick={togglePlay}
      >
        {playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
      </button>
      <div className="l-track">
        <div className="l-marks">
          {eclipses.map((e, i) => (
            <button
              key={`eclipse-${i}`}
              type="button"
              className="l-mark l-mark-eclipse"
              style={{ left: `${(e.t / span) * 100}%` }}
              onClick={() => jump(e.t)}
              aria-label={`Jump to the eclipse, day ${dayText(e.t).day}`}
              title="Eclipse"
            >
              <EclipseIcon size={16} />
            </button>
          ))}
          {landing !== null && (
            <span className="l-mark l-mark-lander" style={{ left: `${(landing / span) * 100}%` }} title="Landing" aria-hidden>
              <LanderIcon size={16} />
            </span>
          )}
        </div>
        <div className="l-strips" aria-hidden>
          <span className="l-strip l-strip-sun" style={{ background: sunBands }} />
          {showEarth && (
            <span className="l-strip l-strip-earth" style={{ background: earthBands }} />
          )}
        </div>
        <input
          type="range"
          className="l-range l-range-over"
          min={0}
          max={span}
          step={1 / 24}
          value={t}
          aria-label="Time in Earth days"
          aria-keyshortcuts="Shift+ArrowRight Shift+ArrowLeft PageUp PageDown"
          onKeyDown={onRangeKey}
          aria-valuetext={valueText}
          onChange={(e) => setT(Number(e.target.value))}
        />
      </div>
      <div className="l-timelabel" aria-hidden>
        <span className="l-day">Day {day}</span>
        <span className="l-date">{fmt(d, "short")}</span>
      </div>
      <div className="l-legend" aria-hidden>
        <span className="l-legend-item">
          <span className="l-swatch l-swatch-day" /> Sunlight
        </span>
        <span className="l-legend-item">
          <span className="l-swatch l-swatch-night" /> Dark
        </span>
        {showEarth && (
          <span className="l-legend-item">
            <span className="l-swatch l-swatch-earth" /> Earth in the sky
          </span>
        )}
      </div>
    </div>
  );
}
