import { Link } from "react-router-dom";
import { STORY, chapterBySlug, learnPath, type ViewKind } from "../chapters";
import { SITES, type SiteId } from "../sites";
import { useLearn } from "../store";
import { ArrowRightIcon, CheckIcon } from "./icons";
import { PanelBar } from "./PanelBar";
import { Toggle } from "./Toggle";

const EXPLORE = chapterBySlug("explore")!;

const PLACES: SiteId[] = ["apollo11", "blueghost", "rim", "floor", "change4"];

function Lessons() {
  const answers = useLearn((s) => s.answers);
  const done = STORY.filter((c) => answers[c.slug]?.correct).length;
  const next = STORY.find((c) => !answers[c.slug]?.correct) ?? STORY[0]!;
  const cta = done === 0 ? "Start" : done === STORY.length ? "Again" : "Continue";
  return (
    <section className="l-lessons" aria-labelledby="l-lessons-title">
      <div className="l-lessons-head">
        <h2 id="l-lessons-title" className="l-lessons-title">
          Guided lessons
        </h2>
        <span className="l-lessons-meta">
          {done > 0 ? `${done} of ${STORY.length} done` : `${STORY.length} stops · about 10 min`}
        </span>
      </div>
      <div className="l-lessons-row">
        <ol className="l-lesson-list">
          {STORY.map((c) => {
            const ok = answers[c.slug]?.correct;
            return (
              <li key={c.slug}>
                <Link
                  to={learnPath(c.slug)}
                  className={`l-lesson ${ok ? "is-done" : ""} ${c.slug === next.slug ? "is-next" : ""}`}
                  aria-label={`Lesson ${c.n}: ${c.short}${ok ? ", done" : ""}`}
                  title={c.short}
                >
                  {ok ? <CheckIcon size={14} /> : c.n}
                </Link>
              </li>
            );
          })}
        </ol>
        <Link to={learnPath(next.slug)} className="l-btn l-btn-primary l-lessons-cta">
          {cta} <ArrowRightIcon size={18} />
        </Link>
      </div>
      <p className="l-lessons-next">
        {done === STORY.length ? "All done. " : "Next: "}
        <span>{next.title}</span>
      </p>
    </section>
  );
}

export function ExploreCard() {
  const siteId = useLearn((s) => s.siteId);
  const view = useLearn((s) => s.view);
  const speed = useLearn((s) => s.speed);
  const { setSite, setView, setSpeed, setWalkBody } = useLearn.getState();
  const polar = siteId === "rim" || siteId === "floor";
  const views = [
    { value: "space", label: "Space" },
    { value: "ground", label: "Ground" },
    { value: "walk", label: "Walk & drive" },
    ...(polar ? [{ value: "crater", label: "Close-up" }] : []),
  ];
  return (
    <article className="l-story" aria-labelledby="l-title">
      <PanelBar />
      <div className="l-story-scroll">
        <h1 id="l-title" className="l-title">
          {EXPLORE.title}
        </h1>
        <p className="l-copy">{EXPLORE.copy}</p>
        <div className="l-field" role="group" aria-labelledby="l-pick">
          <span id="l-pick" className="l-control-label">
            Place
          </span>
          <div className="l-sitechips">
            {PLACES.map((id) => (
              <button key={id} type="button" className="l-sitechip" aria-pressed={siteId === id} onClick={() => setSite(id)}>
                <span className="l-sitechip-name">{SITES[id].name}</span>
                <span className="l-sitechip-where">{SITES[id].short}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="l-field l-control">
          <span className="l-control-label">View</span>
          <Toggle label="View" value={view} options={views} onChange={(v) => { if (v === "walk") setWalkBody("rover"); setView(v as ViewKind); }} />
        </div>
        <details className="l-explore-more">
          <summary>Lessons, speed and site details</summary>
          <div className="l-field l-control">
            <span className="l-control-label">Time speed</span>
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
          <p className="l-site-blurb">{SITES[siteId].blurb}</p>
          <Lessons />
          <p className="l-prompt">{EXPLORE.prompt}</p>
          <p className="l-planner-link">
            <Link to="/">
              Want exact times from real Moon maps? Open the Planner, the tool mission engineers use{" "}
              <ArrowRightIcon size={16} />
            </Link>
          </p>
          <p className="l-teacher">
            Works with a keyboard: <kbd>K</kbd> plays or pauses, <kbd>←</kbd> <kbd>→</kbd> move time (add <kbd>Shift</kbd> for a
            whole day), <kbd>[</kbd> <kbd>]</kbd> step through the lessons. In Rover view, use <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or the arrow keys to drive.
          </p>
        </details>
      </div>
    </article>
  );
}
