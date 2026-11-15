import { useEffect, useRef } from "react";
import { STORY } from "../chapters";
import { useLearn } from "../store";
import { CheckIcon } from "./icons";

export function Finale() {
  const answers = useLearn((s) => s.answers);
  const btn = useRef<HTMLButtonElement>(null);
  const close = () => useLearn.setState({ celebrate: false });
  useEffect(() => {
    btn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const right = STORY.filter((c) => answers[c.slug]?.correct).length;
  return (
    <div className="l-finale-wrap">
      <section className="l-finale" role="dialog" aria-modal="true" aria-labelledby="l-finale-title">
        <ol className="l-finale-marks" aria-hidden>
          {STORY.map((c) => (
            <li key={c.slug} className={answers[c.slug]?.correct ? "is-done" : ""}>
              {answers[c.slug]?.correct ? <CheckIcon size={16} /> : c.n}
            </li>
          ))}
        </ol>
        <h2 id="l-finale-title">You finished the lessons!</h2>
        <p>
          {right} of {STORY.length} questions right. Now drive anywhere on the Moon.
        </p>
        <button ref={btn} type="button" className="l-btn l-btn-primary" onClick={close}>
          Let's go
        </button>
      </section>
    </div>
  );
}
