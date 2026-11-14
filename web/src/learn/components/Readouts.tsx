import type { ReactNode } from "react";
import { useLive } from "../derive";
import { chapterOf, useLearn } from "../store";
import { powerWord } from "../timeline";
import { BatteryIcon, CloseIcon, BehindHillIcon, EclipseIcon, GlobeIcon, NightIcon, PeekIcon, SunIcon } from "./icons";

function Chip({ tone, icon, long, short }: { tone: string; icon: ReactNode; long: string; short: string }) {
  return (
    <div className={`l-chip tone-${tone}`}>
      {icon}
      <span className="l-chip-long">{long}</span>
      <span className="l-chip-short" aria-hidden>
        {short}
      </span>
    </div>
  );
}

function SunChip() {
  const { sky, site } = useLive();
  const wall = site.id === "floor" ? "the crater wall" : "a hill";
  switch (sky.sun.status) {
    case "up":
      return <Chip tone="sun" icon={<SunIcon />} long="Sun up" short="Sun up" />;
    case "peeking":
      return <Chip tone="sun" icon={<PeekIcon />} long="Sun peeking over the horizon" short="Sun peeking" />;
    case "eclipse":
      return <Chip tone="eclipse" icon={<EclipseIcon />} long="Eclipse, Earth is blocking the Sun" short="Eclipse" />;
    case "behindHill":
      return <Chip tone="dim" icon={<BehindHillIcon />} long={`Sun behind ${wall}`} short="Sun hidden" />;
    default:
      return <Chip tone="dim" icon={<NightIcon />} long="Night, Sun below the horizon" short="Night" />;
  }
}

function EarthChip() {
  const { sky } = useLive();
  return sky.earth.visible ? (
    <Chip tone="earth" icon={<GlobeIcon />} long="Earth in view, you can call home" short="Earth seen" />
  ) : (
    <Chip tone="dim" icon={<GlobeIcon hollow />} long="Earth hidden, no direct call" short="No Earth" />
  );
}

function PowerGauge() {
  const { sky, battery } = useLive();
  const word = powerWord(battery);
  const seg = Number.isNaN(battery) || battery <= 0 ? 0 : Math.ceil(battery * 5 - 1e-6);
  const pct = Math.round(sky.sunlight * 100);
  const charging = sky.sunlight > 0.05 && !Number.isNaN(battery);
  return (
    <div className={`l-chip l-power tone-${Number.isNaN(battery) ? "dim" : seg === 0 ? "fail" : seg <= 1 ? "warn" : "power"}`}>
      <BatteryIcon segments={seg} />
      <span className="l-power-text">
        <span className="l-chip-long">Pretend battery: {word}</span>
        <span className="l-chip-short" aria-hidden>
          {word === "Asleep, battery empty" ? "Asleep" : word === "On the way" ? "Landing" : word === "Almost empty" ? "Almost out" : word}
        </span>
        <span className="l-sunbar" role="img" aria-label={`Sunlight on the solar panels: ${pct} percent`}>
          <span className="l-sunbar-fill" style={{ width: `${pct}%` }} />
        </span>
        <span className="l-sunbar-word" aria-hidden>
          {Number.isNaN(battery) ? "Not landed yet" : charging ? "Sun on the panels" : "No sun on the panels"}
        </span>
      </span>
    </div>
  );
}

export function Readouts() {
  const note = useLearn((s) => s.note);
  const chips = chapterOf(useLearn((s) => s.chapter)).chips;
  return (
    <div className="l-readouts" aria-label="What is happening now">
      <div className="l-chips">
        {chips.includes("sun") && <SunChip />}
        {chips.includes("earth") && <EarthChip />}
        {chips.includes("power") && <PowerGauge />}
      </div>
      {note === "showing" && chips.includes("power") && (
        <div className="l-note" role="note">
          <p>
            With no sunlight, a lander gets too cold and runs out of power. India's Chandrayaan-3 never woke up after its first
            lunar night.
          </p>
          <button type="button" className="l-note-close" aria-label="Close note" onClick={() => useLearn.setState({ note: "done" })}>
            <CloseIcon size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
