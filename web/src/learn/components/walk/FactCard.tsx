import { FACTS } from "../../walk/facts";
import { useLearn } from "../../store";

export function FactCard() {
  const id = useLearn((s) => s.nearProp);
  const f = id ? FACTS[id] : null;
  return (
    <div className="l-fact-slot" aria-live="polite">
      {f && (
        <article className="l-fact" aria-labelledby="l-fact-title">
          <h2 id="l-fact-title" className="l-fact-title">
            {f.title}
          </h2>
          <p className="l-fact-body">{f.body}</p>
          <p className="l-fact-source">
            Source:{" "}
            <a href={f.source.url} target="_blank" rel="noreferrer">
              {f.source.title}
            </a>
          </p>
        </article>
      )}
    </div>
  );
}
