import type { ReactNode } from "react";
import { latArg, useLive } from "../derive";
import { skyAt } from "../geometry";
import { chapterOf, useLearn } from "../store";
import { powerWord } from "../timeline";
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

export function Readouts() {
  const note = useLearn((s) => s.note);
  const chips = chapterOf(useLearn((s) => s.chapter)).chips;
  const walk = useLearn((s) => s.view === "walk");
  return (
    <div className="l-readouts" role="group" aria-label="Right now">
      <div className="l-chips">
        {chips.includes("sun") && <SunChip />}
        {chips.includes("earth") && <EarthChip />}
      </div>
      {(chips.includes("power") || walk) && <Battery />}
      {note === "showing" && chips.includes("power") && (
        <div className="l-note" role="note">
          <p>No sun, no power. India's Chandrayaan-3 never woke up after its first night.</p>
          <button type="button" className="l-note-close" aria-label="Close note" onClick={() => useLearn.setState({ note: "done" })}>
            <CloseIcon size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
