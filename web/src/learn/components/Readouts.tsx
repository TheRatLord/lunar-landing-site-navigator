import type { ReactNode } from "react";
import { latArg, useLive } from "../derive";
import { skyAt } from "../geometry";
import { chapterOf, useLearn } from "../store";
import { powerWord } from "../timeline";
import { Pop } from "./Pop";
import { BatteryIcon, CloseIcon, BehindHillIcon, EclipseIcon, GlobeIcon, NightIcon, PeekIcon, SunIcon } from "./icons";

function Chip({ tone, on, icon, label }: { tone: string; on: boolean; icon: ReactNode; label: string }) {
  return (
    <span className={`l-chip tone-${tone} ${on ? "is-on" : "is-off"}`}>
      {icon}
      {label}
    </span>
  );
}

function SunChip() {
  const { sky, site } = useLive();
  const d = useLearn((s) => chapterOf(s.chapter).epochD + s.t);
  const lat = useLearn(latArg);
  const setting = skyAt(site, d + 0.05, lat).sun.el < sky.sun.el;
  switch (sky.sun.status) {
    case "up":
      return <Chip tone="sun" on icon={<SunIcon size={16} />} label="Sun up" />;
    case "peeking":
      return <Chip tone="sun" on icon={<PeekIcon size={16} />} label={setting ? "Sunset" : "Sunrise"} />;
    case "eclipse":
      return <Chip tone="eclipse" on icon={<EclipseIcon size={16} />} label="Eclipse" />;
    case "behindHill":
      return <Chip tone="sun" on={false} icon={<BehindHillIcon size={16} />} label={site.id === "floor" ? "Behind wall" : "Behind hill"} />;
    default:
      return <Chip tone="sun" on={false} icon={<NightIcon size={16} />} label="Night" />;
  }
}

function EarthChip() {
  const { sky } = useLive();
  return sky.earth.visible ? (
    <button type="button" className="l-chip tone-earth is-on l-chip-btn" onClick={() => useLearn.setState((s) => ({ lookEarth: s.lookEarth + 1 }))}>
      <GlobeIcon size={16} />
      Earth in sky
    </button>
  ) : (
    <Chip tone="earth" on={false} icon={<GlobeIcon size={16} hollow />} label="No Earth" />
  );
}

function Battery() {
  const { sky, battery } = useLive();
  const landed = !Number.isNaN(battery);
  const seg = !landed || battery <= 0 ? 0 : Math.ceil(battery * 5 - 1e-6);
  const charging = landed && sky.sunlight > 0.05 && battery < 1;
  const tone = !landed ? "dim" : seg === 0 ? "fail" : seg <= 1 ? "warn" : "power";
  const word = !landed ? "Not landed yet" : battery <= 0 ? "Empty" : `${powerWord(battery)}${charging ? ", charging" : ""}`;
  return (
    <div className={`l-battery tone-${tone}`} role="img" aria-label={`Battery: ${word}`}>
      <span className="l-battery-label">Battery</span>
      <BatteryIcon segments={seg} size={88} height={70} />
      <span className="l-battery-word">{word}</span>
    </div>
  );
}

function StatusPops({ sun: showSun, earth: showEarth, battery: showBattery, children }: { sun: boolean; earth: boolean; battery: boolean; children?: ReactNode }) {
  const { sky, battery } = useLive();
  const sun = sky.sunlight > 0.05;
  const earth = sky.earth.frac > 0.05;
  const seg = Number.isNaN(battery) || battery <= 0 ? 0 : Math.ceil(battery * 5 - 1e-6);
  return (
    <div className="l-readouts l-status" role="group" aria-label="Right now">
      {showSun && <Pop side="down" align="end" label={sun ? "Sun: up" : "Sun: not up"} summary={<span className={sun ? "tone-sun" : "is-off"}>{sun ? <SunIcon size={18} /> : <NightIcon size={18} />}</span>}>
        <p className="l-pop-title">The Sun</p>
        <SunChip />
        <p className="l-pop-note">{sun ? "Sunlight here means warmth and solar power." : "No sunlight here right now: cold, and no solar power."}</p>
      </Pop>}
      {showEarth && <Pop side="down" align="end" label={earth ? "Earth: in the sky" : "Earth: not in the sky"} summary={<span className={earth ? "tone-earth" : "is-off"}><GlobeIcon size={18} hollow={!earth} /></span>}>
        <p className="l-pop-title">Earth</p>
        <EarthChip />
        <p className="l-pop-note">{earth ? "With Earth in the sky, a lander can talk straight to home." : "Earth is below the horizon, so there is no direct link home."}</p>
      </Pop>}
      {showBattery && (
        <Pop side="down" align="end" label={`Battery: ${seg} of 5`} summary={<span className="tone-power"><BatteryIcon segments={seg} size={28} height={18} /></span>}>
          <Battery />
        </Pop>
      )}
      {children}
    </div>
  );
}

export function Readouts() {
  const note = useLearn((s) => s.note);
  const chips = chapterOf(useLearn((s) => s.chapter)).chips;
  const walk = useLearn((s) => s.view === "walk");
  const explore = useLearn((s) => s.chapter === "explore");
  const power = chips.includes("power");
  return (
    <StatusPops sun={chips.includes("sun")} earth={chips.includes("earth")} battery={power || (explore && walk)}>
      {note === "showing" && power && (
        <div className="l-note" role="note">
          <p>No sun, no power. India's Chandrayaan-3 never woke up after its first night.</p>
          <button type="button" className="l-note-close" aria-label="Close note" onClick={() => useLearn.setState({ note: "done" })}>
            <CloseIcon size={18} />
          </button>
        </div>
      )}
    </StatusPops>
  );
}
