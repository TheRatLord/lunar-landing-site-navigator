import type { ControlKind } from "../chapters";
import { walkWords } from "../sites";
import { useLearn, type Landing } from "../store";
import { prefersReducedMotion } from "../../lib/media";
import { LanderIcon, PauseIcon, PlayIcon } from "./icons";
import { Toggle } from "./Toggle";

const STOPS = [
  { v: 0, label: "Equator" },
  { v: 45, label: "Halfway" },
  { v: 72, label: "Near pole" },
  { v: 89.5, label: "Pole" },
];

function Latitude() {
  const lat = useLearn((s) => s.lat);
  const setLat = useLearn((s) => s.setLat);
  const v = -lat;
  return (
    <div className="l-walk">
      <input
        type="range"
        aria-label="How far south you are"
        className="l-range"
        min={0}
        max={89.5}
        step={0.5}
        value={v}
        style={{ ["--pct" as string]: `${(v / 89.5) * 100}%` }}
        aria-valuetext={walkWords(lat)}
        onChange={(e) => setLat(-Number(e.target.value))}
      />
      <div className="l-toggle l-walk-stops" role="group" aria-label="Jump to a place">
        {STOPS.map((s) => (
          <button
            key={s.v}
            type="button"
            className="l-toggle-btn"
            aria-pressed={Math.abs(v - s.v) < 3}
            onClick={() => setLat(-s.v)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const LANDINGS: { o: Landing; title: string; sub: string }[] = [
  { o: 0, title: "On time", sub: "2 March" },
  { o: 7, title: "1 week late", sub: "9 March" },
  { o: 14, title: "2 weeks late", sub: "16 March" },
];

function LandingChoice() {
  const o = useLearn((s) => s.landingOffset);
  const setLanding = useLearn((s) => s.setLanding);
  return (
    <div className="l-landing" role="radiogroup" aria-label="Landing day">
      {LANDINGS.map((l) => (
        <button
          key={l.o}
          type="button"
          role="radio"
          aria-checked={o === l.o}
          className="l-landing-card"
          onClick={() => {
            setLanding(l.o);
            document.getElementById("l-big")?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
          }}
        >
          <LanderIcon size={26} />
          <span className="l-landing-title">{l.title}</span>
          <span className="l-landing-sub">{l.sub}</span>
        </button>
      ))}
    </div>
  );
}

function PlayControl() {
  const playing = useLearn((s) => s.playing);
  const togglePlay = useLearn((s) => s.togglePlay);
  return (
    <button type="button" className="l-btn l-btn-primary l-try-play" onClick={togglePlay}>
      {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />} {playing ? "Pause" : "Play"}
    </button>
  );
}

export function ChapterControl({ kind }: { kind: ControlKind }) {
  const siteId = useLearn((s) => s.siteId);
  const setSite = useLearn((s) => s.setSite);
  const body =
    kind === "nearFar" ? (
      <Toggle
        label="Where you stand"
        value={siteId === "change4" ? "far" : "near"}
        options={[
          { value: "near", label: "Near side" },
          { value: "far", label: "Far side" },
        ]}
        onChange={(v) => setSite(v === "far" ? "change4" : "apollo11")}
      />
    ) : kind === "rimFloor" ? (
      <Toggle
        label="Which spot"
        value={siteId === "floor" ? "floor" : "rim"}
        options={[
          { value: "rim", label: "Rim" },
          { value: "floor", label: "Floor" },
        ]}
        onChange={(v) => setSite(v === "floor" ? "floor" : "rim")}
      />
    ) : kind === "latitude" ? (
      <Latitude />
    ) : kind === "landing" ? (
      <LandingChoice />
    ) : kind === "none" ? (
      <PlayControl />
    ) : null;
  return body && <div className="l-control">{body}</div>;
}
