import type { ReactNode } from "react";
import { useLive } from "../derive";
import { chapterOf, useLearn } from "../store";
import { powerWord } from "../timeline";
import { BatteryIcon, CloseIcon, BehindHillIcon, EclipseIcon, GlobeIcon, NightIcon, PeekIcon, SunIcon } from "./icons";

function Tile({ tone, on, icon, label, says }: { tone: string; on: boolean; icon: ReactNode; label: string; says: string }) {
  return (
    <div className={`l-tile tone-${tone} ${on ? "is-on" : "is-off"}`} role="img" aria-label={says} title={says}>
      <span className="l-tile-icon">{icon}</span>
      <span className="l-tile-label" aria-hidden>
        {label}
      </span>
    </div>
  );
}

function SunTile() {
  const { sky, site } = useLive();
  const wall = site.id === "floor" ? "the crater wall" : "a hill";
  switch (sky.sun.status) {
    case "up":
      return <Tile tone="sun" on icon={<SunIcon size={26} />} label="Sun" says="The Sun is up" />;
    case "peeking":
      return <Tile tone="sun" on icon={<PeekIcon size={26} />} label="Sun" says="The Sun is just peeking over the horizon" />;
    case "eclipse":
      return <Tile tone="eclipse" on icon={<EclipseIcon size={26} />} label="Eclipse" says="Eclipse: Earth is blocking the Sun" />;
    case "behindHill":
      return <Tile tone="sun" on={false} icon={<BehindHillIcon size={26} />} label="Sun" says={`The Sun is hidden behind ${wall}`} />;
    default:
      return <Tile tone="sun" on={false} icon={<NightIcon size={26} />} label="Sun" says="Night: the Sun is down" />;
  }
}

function EarthTile() {
  const { sky } = useLive();
  return sky.earth.visible ? (
    <Tile tone="earth" on icon={<GlobeIcon size={26} />} label="Earth" says="Earth is in the sky, so you can call home" />
  ) : (
    <Tile tone="earth" on={false} icon={<GlobeIcon size={26} hollow />} label="Earth" says="Earth is out of sight, so no direct calls" />
  );
}

function BatteryTile() {
  const { sky, battery } = useLive();
  const landed = !Number.isNaN(battery);
  const seg = !landed || battery <= 0 ? 0 : Math.ceil(battery * 5 - 1e-6);
  const charging = landed && sky.sunlight > 0.05;
  const tone = !landed ? "dim" : seg === 0 ? "fail" : seg <= 1 ? "warn" : "power";
  const says = landed ? `Battery: ${powerWord(battery).toLowerCase()}${charging ? ", charging in the sunlight" : ", not charging"}` : "Not landed yet";
  return (
    <Tile
      tone={tone}
      on={landed}
      icon={
        <span className="l-batt">
          <BatteryIcon segments={seg} size={30} />
          {charging && <span className="l-batt-bolt" aria-hidden />}
        </span>
      }
      label="Battery"
      says={says}
    />
  );
}

export function Readouts() {
  const note = useLearn((s) => s.note);
  const chips = chapterOf(useLearn((s) => s.chapter)).chips;
  return (
    <div className="l-readouts" role="group" aria-label="Right now">
      <div className="l-tiles">
        {chips.includes("sun") && <SunTile />}
        {chips.includes("earth") && <EarthTile />}
        {chips.includes("power") && <BatteryTile />}
      </div>
      {note === "showing" && chips.includes("power") && (
        <div className="l-note" role="note">
          <p>
            With no sunlight, a lander gets too cold and runs out of power. India's Chandrayaan-3 never woke up after its first
            night on the Moon.
          </p>
          <button type="button" className="l-note-close" aria-label="Close note" onClick={() => useLearn.setState({ note: "done" })}>
            <CloseIcon size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
