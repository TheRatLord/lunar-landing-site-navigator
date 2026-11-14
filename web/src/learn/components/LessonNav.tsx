import { Link } from "react-router-dom";
import { CHAPTERS, STORY, learnPath } from "../chapters";
import { useLearn, type ChapterKey } from "../store";
import { CheckIcon } from "./icons";

export function LessonNav({ current }: { current: ChapterKey | null }) {
  const answers = useLearn((s) => s.answers);
  return (
    <nav className="l-dots" aria-label="Explore and lessons">
      {CHAPTERS.map((c) => {
        const done = answers[c.slug]?.correct;
        const label =
          c.slug === "explore" ? "Explore" : `Lesson ${c.n} of ${STORY.length}: ${c.short}${done ? ", answered" : ""}`;
        const here = current === c.slug;
          return (
          <Link
            key={c.slug}
            to={learnPath(c.slug)}
            className={`l-dot ${here ? "is-here" : ""} ${done ? "is-done" : ""} ${c.slug === "explore" ? "is-explore" : ""}`}
            aria-label={label}
            aria-current={here ? "step" : undefined}
            title={c.short}
          >
            <span className="l-dot-mark">{done ? <CheckIcon size={12} /> : null}</span>
          </Link>
        );
      })}
    </nav>
  );
}
