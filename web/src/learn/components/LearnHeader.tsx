import { Link } from "react-router-dom";
import { ModeSwitch } from "../../shell/ModeSwitch";
import { CHAPTERS, STORY } from "../chapters";
import { useLearn, type ChapterKey } from "../store";
import { CheckIcon, MoonMark } from "./icons";

export function LearnHeader({ current }: { current: ChapterKey | null }) {
  const answers = useLearn((s) => s.answers);
  return (
    <header className="l-header">
      <Link to="/learn" className="l-wordmark" aria-label="Moon Lab, Learn home">
        <MoonMark />
        <span className="l-wordmark-text">
          Moon Lab <span className="l-wordmark-sub">· Learn</span>
        </span>
      </Link>
      <nav className="l-dots" aria-label="Stops">
        {CHAPTERS.map((c) => {
          const done = answers[c.slug]?.correct;
          const label =
            c.slug === "explore" ? "Free explore" : `Chapter ${c.n} of ${STORY.length}: ${c.short}${done ? ", answered" : ""}`;
          const here = current === c.slug;
          return (
            <Link
              key={c.slug}
              to={`/learn/${c.slug}`}
              className={`l-dot ${here ? "is-here" : ""} ${done ? "is-done" : ""} ${c.slug === "explore" ? "is-explore" : ""}`}
              aria-label={label}
              aria-current={here ? "step" : undefined}
              title={c.slug === "explore" ? "Free explore" : c.short}
            >
              <span className="l-dot-mark">{done ? <CheckIcon size={12} /> : null}</span>
            </Link>
          );
        })}
      </nav>
      <div className="l-header-end">
        <ModeSwitch />
      </div>
    </header>
  );
}
