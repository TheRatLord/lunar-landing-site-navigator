import { Link } from "react-router-dom";
import type { ViewKind } from "../chapters";
import { SITES, type SiteId } from "../sites";
import { useLearn } from "../store";
import { ArrowLeftIcon, ArrowRightIcon } from "./icons";
import { Toggle } from "./Toggle";

const CHIPS: { id: SiteId; label: string }[] = [
  { id: "apollo11", label: "Apollo 11" },
  { id: "rim", label: "Shackleton rim" },
  { id: "floor", label: "Shackleton floor" },
  { id: "change4", label: "Chang'e 4 (far side)" },
];

export function ExploreCard() {
  const siteId = useLearn((s) => s.siteId);
  const view = useLearn((s) => s.view);
  const speed = useLearn((s) => s.speed);
  const { setSite, setView, setSpeed } = useLearn.getState();
  const polar = siteId === "rim" || siteId === "floor";
  const views = [
    { value: "space", label: "In space" },
    { value: "ground", label: "On the ground" },
    ...(polar ? [{ value: "crater", label: "Close-up" }] : []),
  ];
  return (
    <article className="l-story" aria-labelledby="l-title">
      <div className="l-story-scroll">
        <p className="l-eyebrow">Your turn</p>
        <h1 id="l-title" className="l-title">
          Free explore
        </h1>
        <p className="l-copy">Pick a place, choose how to look, and let a whole year roll by.</p>
        <div className="l-field" role="group" aria-labelledby="l-pick">
          <span id="l-pick" className="l-control-label">
            Place
          </span>
          <div className="l-sitechips">
            {CHIPS.map((c) => (
              <button
                key={c.id}
                type="button"
                className="l-sitechip"
                aria-pressed={siteId === c.id}
                onClick={() => setSite(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="l-site-blurb">{SITES[siteId].blurb}</p>
        </div>
        <div className="l-field l-control">
          <span className="l-control-label">View</span>
          <Toggle label="View" value={view} options={views} onChange={(v) => setView(v as ViewKind)} />
        </div>
        <div className="l-field l-control">
          <span className="l-control-label">Speed</span>
          <Toggle
            label="Speed"
            value={speed > 5 ? "fast" : "slow"}
            options={[
              { value: "slow", label: "Slow" },
              { value: "fast", label: "Fast" },
            ]}
            onChange={(v) => setSpeed(v === "fast" ? 14 : 2)}
          />
        </div>
        <p className="l-prompt">Try it: choose the Shackleton rim, go Fast, and watch a whole year of polar seasons.</p>
        <nav className="l-nav" aria-label="Chapter">
          <Link className="l-btn l-btn-quiet" to="/learn/timing">
            <ArrowLeftIcon size={18} /> Back
          </Link>
        </nav>
        <p className="l-planner-link">
          <Link to="/">
            Want exact times from real Moon maps? Open the Planner, the tool mission engineers use{" "}
            <ArrowRightIcon size={16} />
          </Link>
        </p>
      </div>
    </article>
  );
}
