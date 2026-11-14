import type { KeyboardEvent, ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Chapter, TickKind } from "../chapters";
import { useTimeline } from "../derive";
import { dateOfDay } from "../geometry";
import { landingOf, useLearn } from "../store";
import { EclipseIcon, LanderIcon, PauseIcon, PlayIcon, SunriseIcon, SunsetIcon } from "./icons";

const fmt = (d: number, month: "short" | "long") =>
  dateOfDay(d).toLocaleDateString("en-GB", { day: "numeric", month, year: "numeric", timeZone: "UTC" });

const TICK: Record<TickKind, { icon: ReactNode; word: string }> = {
  sunrise: { icon: <SunriseIcon size={16} />, word: "Sunrise" },
  sunset: { icon: <SunsetIcon size={16} />, word: "Sunset" },
  eclipse: { icon: <EclipseIcon size={16} />, word: "Eclipse" },
};

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
  const dense = span > 60;
  const rows: number[] = [];
  const ticks = tl.events.filter((e) => (c.ticks as string[]).includes(e.kind) && e.t > 0.05 && e.t < span - 0.05);
  let lastT = -Infinity;
  for (const e of ticks) {
    const row = !dense && e.t - lastT < span * 0.16 && rows[rows.length - 1] === 0 ? 1 : 0;
    rows.push(row);
    if (row === 0) lastT = e.t;
  }
  const twoRows = rows.includes(1);
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
      <div className={`l-track ${twoRows ? "two-rows" : ""}`}>
        <div className={`l-ticks ${dense ? "is-dense" : ""}`}>
          {ticks.map((e, i) => {
            const k = e.kind as TickKind;
            return (
              <button
                key={`${e.kind}-${i}`}
                type="button"
                className={`l-tick l-tick-${k} row-${rows[i] ?? 0} ${e.t / span < 0.08 ? "at-start" : e.t / span > 0.92 ? "at-end" : ""}`}
                style={{ left: `${(e.t / span) * 100}%` }}
                onClick={() => jump(e.t)}
                aria-label={`Jump to ${TICK[k].word.toLowerCase()}, day ${dayText(e.t).day}`}
                title={dense ? TICK[k].word : undefined}
              >
                {dense ? <span className="l-tick-bar" /> : TICK[k].icon}
                {!dense && <span>{TICK[k].word}</span>}
              </button>
            );
          })}
          {landing !== null && (
            <span className="l-tick l-tick-lander" style={{ left: `${(landing / span) * 100}%` }} aria-hidden>
              <LanderIcon size={18} />
            </span>
          )}
        </div>
        <input
          type="range"
          className="l-range"
          min={0}
          max={span}
          step={1 / 24}
          value={t}
          aria-label="Time in Earth days"
          aria-keyshortcuts="Shift+ArrowRight Shift+ArrowLeft PageUp PageDown"
          onKeyDown={onRangeKey}
          aria-valuetext={valueText}
          style={{ ["--pct" as string]: `${(t / span) * 100}%` }}
          onChange={(e) => setT(Number(e.target.value))}
        />
      </div>
      <div className="l-timelabel" aria-hidden>
        <span className="l-day">Day {day}</span>
        <span className="l-date">{fmt(d, "short")}</span>
      </div>
      {dense && (
        <div className="l-legend" aria-hidden>
          <span className="l-legend-item">
            <span className="l-tick-bar" /> Sunrise
          </span>
          <span className="l-legend-item l-tick-sunset">
            <span className="l-tick-bar" /> Sunset
          </span>
        </div>
      )}
    </div>
  );
}
