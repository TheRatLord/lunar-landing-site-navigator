import { Link } from "react-router-dom";
import { STORY, learnPath, type Chapter } from "../chapters";
import { useTimeline } from "../derive";
import { landingOf, useLearn } from "../store";
import { nextEvent } from "../timeline";
import { ChapterControl } from "./ChapterControl";
import { Check } from "./Check";
import { ArrowLeftIcon, ArrowRightIcon } from "./icons";
import { HidePanel } from "./PanelBar";
import { RichText } from "./RichText";

function SunnyDays() {
  const tl = useTimeline();
  const landing = useLearn((s) => landingOf(s));
  const ev = landing === null ? null : nextEvent(tl, "sunset", landing);
  const n = ev && landing !== null ? Math.max(0, Math.floor(ev.t - landing)) : 0;
  return (
    <div className="l-big" id="l-big" aria-live="polite">
      <span className="l-big-num">{n}</span>
      <span className="l-big-cap">Sunny days left</span>
    </div>
  );
}

function BigNumber({ c }: { c: Chapter }) {
  const b = c.big;
  if (b.kind === "none") return null;
  if (b.kind === "sunnyDays") return <SunnyDays />;
  return (
    <div className={`l-big ${b.lean ? "has-lean" : ""}`}>
      <span className={`l-big-num ${b.value.length > 6 ? "is-long" : ""}`}>{b.value}</span>
      <span className="l-big-cap">{b.caption}</span>
      {b.lean && <LeanPicture />}
    </div>
  );
}

function Lean({ x, deg, r, label, fill }: { x: number; deg: number; r: number; label: string; fill: string }) {
  const cy = 52;
  const a = (deg * Math.PI) / 180;
  const L = r + 14;
  const dx = Math.sin(a) * L;
  const dy = Math.cos(a) * L;
  return (
    <g>
      <line x1={x} y1={cy - r - 18} x2={x} y2={cy + r + 18} className="l-lean-up" />
      <circle cx={x} cy={cy} r={r} fill={fill} />
      <line x1={x - dx} y1={cy + dy} x2={x + dx} y2={cy - dy} className="l-lean-axis" />
      <text x={x} y={cy + r + 34} textAnchor="middle" className="l-lean-label">
        {label}
      </text>
    </g>
  );
}

function LeanPicture() {
  return (
    <svg className="l-lean" viewBox="0 0 240 118" role="img" aria-label="Earth's spin axis leans 23 degrees. The Moon's leans only 1.5 degrees, almost straight up.">
      <Lean x={64} deg={23.4} r={26} label="Earth: 23°" fill="#3f7fd6" />
      <Lean x={180} deg={1.5} r={20} label="Moon: 1.5°" fill="#9a9a9c" />
    </svg>
  );
}

function ChapterNav({ c }: { c: Chapter }) {
  const i = STORY.findIndex((x) => x.slug === c.slug);
  const prev = STORY[i - 1];
  const next = STORY[i + 1];
  return (
    <nav className="l-nav l-panel-foot" aria-label="Lesson">
      <Link className="l-btn l-btn-quiet l-nav-drive" to={learnPath("explore")}>
        Drive
      </Link>
      {prev && (
        <Link className="l-btn l-btn-quiet" to={learnPath(prev.slug)}>
          <ArrowLeftIcon size={18} /> Back
        </Link>
      )}
      {next ? (
        <Link className="l-btn l-btn-primary" to={learnPath(next.slug)}>
          Next <ArrowRightIcon size={18} />
        </Link>
      ) : (
        <Link className="l-btn l-btn-primary" to={learnPath("explore")} onClick={() => useLearn.setState({ celebrate: true })}>
          Done <ArrowRightIcon size={18} />
        </Link>
      )}
    </nav>
  );
}

export function StoryCard({ c }: { c: Chapter }) {
  return (
    <article className="l-story" aria-labelledby="l-title">
      <div className="l-story-scroll">
        <div className="l-story-head">
          <h1 id="l-title" className="l-title">
            <span className="l-title-n">{c.n}</span>
            {c.title}
          </h1>
          <HidePanel />
        </div>
        <p className="l-copy">
          <RichText text={c.copy} slug={c.slug} />
        </p>
        <div className="l-try">
          <p className="l-try-text">
            <RichText text={c.prompt} slug={c.slug} />
          </p>
          <ChapterControl kind={c.control} />
        </div>
        {c.check && <Check slug={c.slug} check={c.check} />}
        <BigNumber c={c} />
      </div>
      <ChapterNav c={c} />
    </article>
  );
}
