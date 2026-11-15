import { Link } from "react-router-dom";
import { STORY, learnPath } from "../chapters";
import { useLearn, type ChapterKey } from "../store";

export function LessonNav({ current }: { current: ChapterKey | null }) {
  const answers = useLearn((s) => s.answers);
  return (
    <nav className="l-lessons-nav" aria-label="Lessons">
      <span className="l-lessons-label" aria-hidden>
        Lessons
      </span>
      <ol>
        {STORY.map((c) => {
          const done = answers[c.slug]?.correct;
          const here = current === c.slug;
          return (
            <li key={c.slug}>
              <Link
                to={learnPath(c.slug)}
                className={`l-lesson-pill ${here ? "is-here" : ""} ${done ? "is-done" : ""}`}
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
