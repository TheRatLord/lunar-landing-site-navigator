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
          <p className="l-fact-body">
            {f.body}{" "}
            <a className="l-fact-source" href={f.source} target="_blank" rel="noreferrer" aria-label="Source (opens in a new tab)">
              Source ↗
            </a>
          </p>
        </article>
      )}
    </div>
  );
}
