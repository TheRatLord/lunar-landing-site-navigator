import { useRef, useState } from "react";
import type { ChapterSlug, QuizCheck } from "../chapters";
import { useLearn } from "../store";
import { CheckIcon } from "./icons";

export function Check({ slug, check }: { slug: ChapterSlug; check: QuizCheck }) {
  const saved = useLearn((s) => s.answers[slug]);
  const answer = useLearn((s) => s.answer);
  const [picked, setPicked] = useState<number | null>(saved?.picked ?? null);
  const fb = useRef<HTMLParagraphElement>(null);
  const right = picked === check.correct;
  return (
    <section className="l-check" aria-labelledby={`q-${slug}`}>
      <h3 id={`q-${slug}`} className="l-check-q">
        {check.question}
      </h3>
      <div className="l-check-opts">
        {check.options.map((o, i) => {
          const state = picked === i ? (i === check.correct ? "right" : "wrong") : "";
          return (
            <button
              key={o}
              type="button"
              className={`l-opt ${state}`}
              aria-pressed={picked === i}
              onClick={() => {
                setPicked(i);
                answer(slug, i, i === check.correct);
                requestAnimationFrame(() => fb.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
              }}
            >
              <span className="l-opt-mark" aria-hidden>
                {state === "right" ? <CheckIcon size={16} /> : null}
              </span>
              <span>{o}</span>
            </button>
          );
        })}
      </div>
      <p ref={fb} className={`l-check-fb ${picked === null ? "" : right ? "right" : "wrong"}`} aria-live="polite">
        {picked === null ? null : right ? (
          <>
            <CheckIcon size={18} /> <strong>Yes!</strong> {check.explain}
          </>
        ) : (
          check.hint
        )}
      </p>
    </section>
  );
}
