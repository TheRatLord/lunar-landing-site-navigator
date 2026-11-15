import { useNavigate } from "react-router-dom";
import { STORY, learnPath } from "../chapters";
import { useLearn } from "../store";
import { CheckIcon } from "./icons";
import { Pop } from "./Pop";
import { plainText } from "../glossary";

function BookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" />
    </svg>
  );
}

const firstSentence = (text: string): string => {
  const p = plainText(text);
  const i = p.search(/\.(\s|$)/);
  return i > 0 ? p.slice(0, i + 1) : p;
};

export function LessonsPop() {
  const chapter = useLearn((s) => s.chapter);
  const answers = useLearn((s) => s.answers);
  const navigate = useNavigate();
  const here = STORY.find((c) => c.slug === chapter);
  const done = STORY.filter((c) => answers[c.slug]?.correct).length;
  return (
    <Pop
      side="down"
      align="start"
      label={here ? `Lessons: lesson ${here.n}, ${here.short}` : `Lessons: ${done} of ${STORY.length} done`}
      active={!!here}
      summary={
        <>
          <BookIcon />
          <span className="l-pop-text">{here ? `Lesson ${here.n}` : "Lessons"}</span>
        </>
      }
    >
      <p className="l-pop-title">
        Lessons, {done} of {STORY.length} done
      </p>
      <ul className="l-pop-list">
        {here && (
          <li>
            <button type="button" className="l-pop-opt" onClick={() => navigate(learnPath("explore"))}>
              <strong>Free exploration</strong>
              <span>Walk, drive and visit any landing site</span>
            </button>
          </li>
        )}
        {STORY.map((c) => (
          <li key={c.slug}>
            <button type="button" className="l-pop-opt l-pop-lesson" aria-pressed={c.slug === chapter} onClick={() => navigate(learnPath(c.slug))}>
              <strong>
                <span className="l-title-n">{answers[c.slug]?.correct ? <CheckIcon size={12} /> : c.n}</span>
                {c.short}
              </strong>
              <span>{firstSentence(c.copy)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Pop>
  );
}
