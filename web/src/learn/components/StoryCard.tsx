import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { STORY, learnPath, type Chapter } from "../chapters";
import { useTimeline } from "../derive";
import { landingOf, useLearn } from "../store";
import { nextEvent } from "../timeline";
import { ChapterControl } from "./ChapterControl";
import { Check } from "./Check";
import { ArrowLeftIcon, ArrowRightIcon } from "./icons";
import { PanelBar } from "./PanelBar";
import { RichText } from "./RichText";

function SunnyDays() {
  const tl = useTimeline();
  const landing = useLearn((s) => landingOf(s));
  const ev = landing === null ? null : nextEvent(tl, "sunset", landing);
  const n = ev && landing !== null ? Math.max(0, Math.floor(ev.t - landing)) : 0;
  return (
    <div className="l-big" id="l-big" aria-live="polite">
      <span className="l-big-cap">Sunny days left after landing</span>
      <span className="l-big-num">{n}</span>
    </div>
  );
}

function BigNumber({ c }: { c: Chapter }) {
  const b = c.big;
  if (b.kind === "none") return null;
  if (b.kind === "sunnyDays") return <SunnyDays />;
  if (b.kind === "headline") {
    return (
      <div className="l-big">
        <span className="l-big-headline">{b.value}</span>
      </div>
    );
  }
  return (
    <div className={`l-big ${b.lean ? "has-lean" : ""}`}>
      <span className={`l-big-num ${b.value.length > 6 ? "is-long" : ""}`}>{b.value}</span>
      <span className="l-big-cap">{b.caption}</span>
      {b.compare && <span className="l-big-compare">{b.compare}</span>}
      {b.lean && <LeanPicture />}
    </div>
  );
}

function Lean({ x, deg, r, label, fill }: { x: number; deg: number; r: number; label: string; fill: string }) {
  const cy = 62;
  const a = (deg * Math.PI) / 180;
  const L = r + 16;
  const dx = Math.sin(a) * L;
  const dy = Math.cos(a) * L;
  return (
    <g>
      <line x1={x} y1={cy - r - 22} x2={x} y2={cy + r + 22} className="l-lean-up" />
      <circle cx={x} cy={cy} r={r} fill={fill} />
      <line x1={x - dx} y1={cy + dy} x2={x + dx} y2={cy - dy} className="l-lean-axis" />
      <text x={x} y={cy + r + 40} textAnchor="middle" className="l-lean-label">
        {label}
      </text>
    </g>
  );
}

function LeanPicture() {
  return (
    <svg className="l-lean" viewBox="0 0 240 140" role="img" aria-label="Earth's spin axis leans 23 degrees. The Moon's leans only 1.5 degrees, almost straight up.">
      <Lean x={64} deg={23.4} r={30} label="Earth: 23°" fill="#3f7fd6" />
      <Lean x={180} deg={1.5} r={22} label="Moon: 1.5°" fill="#9a9a9c" />
    </svg>
  );
}

function ChapterNav({ c }: { c: Chapter }) {
  const i = STORY.findIndex((x) => x.slug === c.slug);
  const prev = STORY[i - 1];
  const next = STORY[i + 1];
  return (
    <nav className="l-nav l-panel-foot" aria-label="Lesson">
      <Link className="l-btn l-btn-quiet" to={learnPath(prev ? prev.slug : "explore")}>
        <ArrowLeftIcon size={18} /> {prev ? "Back" : "Explore"}
      </Link>
      <Link className="l-btn l-btn-primary" to={learnPath(next ? next.slug : "explore")}>
        {next ? "Next lesson" : "Finish"} <ArrowRightIcon size={18} />
      </Link>
    </nav>
  );
}

export function StoryCard({ c }: { c: Chapter }) {
  const interacted = useLearn((s) => s.interacted);
  const [timed, setTimed] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setTimed(true), 8000);
    return () => window.clearTimeout(id);
  }, []);
  const showTake = interacted || timed;
  return (
    <article className="l-story" aria-labelledby="l-title">
      <PanelBar>
        <Link className="l-back" to={learnPath("explore")}>
          <ArrowLeftIcon size={16} /> Explore
        </Link>
        <span className="l-eyebrow">
          Lesson {c.n} of {STORY.length}
        </span>
      </PanelBar>
      <div className="l-story-scroll">
        <h1 id="l-title" className="l-title">
          {c.title}
        </h1>
        <p className="l-copy">
          <RichText text={c.copy} slug={c.slug} />
        </p>
        <div className="l-try">
          <span className="l-try-label">Try it</span>
          <p className="l-try-text">
            <RichText text={c.prompt} slug={c.slug} />
          </p>
          <ChapterControl kind={c.control} />
        </div>
        <BigNumber c={c} />
        <div className={`l-take ${showTake ? "is-on" : ""}`} aria-hidden={!showTake}>
          <span className="l-eyebrow">Remember</span>
          <p>{c.takeaway}</p>
        </div>
        {c.check && <Check slug={c.slug} check={c.check} />}
      </div>
      <ChapterNav c={c} />
    </article>
  );
}
