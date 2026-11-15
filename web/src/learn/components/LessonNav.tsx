import { useState } from "react";
import { Link } from "react-router-dom";
import { STORY, learnPath } from "../chapters";
import { useLearn, type ChapterKey } from "../store";
import { useIsTouch } from "../touch";

export function LessonNav({ current }: { current: ChapterKey | null }) {
  const answers = useLearn((s) => s.answers);
  const visited = useLearn((s) => s.visited);
  const touch = useIsTouch();
  const [open, setOpen] = useState(false);
  return (
    <nav className="l-lessons-nav" aria-label="Lessons">
      {touch ? (
        <button type="button" className="l-lessons-label" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          Lessons
        </button>
      ) : (
        <Link to={learnPath(STORY[0]!.slug)} className="l-lessons-label" tabIndex={-1} aria-hidden>
          Lessons
        </Link>
      )}
      {touch && open && (
        <ul className="l-lessons-list">
          {STORY.map((c) => (
            <li key={c.slug}>
              <Link to={learnPath(c.slug)} onClick={() => setOpen(false)} aria-current={current === c.slug ? "step" : undefined}>
                <span className="l-title-n">{c.n}</span>
                {c.short}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <ol>
        {STORY.map((c) => {
          const done = answers[c.slug]?.correct;
          const here = current === c.slug;
          return (
            <li key={c.slug}>
              <Link
                to={learnPath(c.slug)}
                className={`l-lesson-pill ${here ? "is-here" : ""} ${done ? "is-done" : ""} ${!visited && c.n === 1 ? "is-start" : ""}`}
                aria-label={`Lesson ${c.n}: ${c.short}${done ? ", done" : ""}`}
                aria-current={here ? "step" : undefined}
                title={c.short}
              >
                {c.n}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
