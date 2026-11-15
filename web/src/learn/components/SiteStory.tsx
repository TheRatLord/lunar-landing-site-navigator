import { useEffect, useId, useRef, useState } from "react";
import { SITE_STORIES } from "../siteStories";
import { SITES, type SiteId } from "../sites";
import { CloseIcon, LanderIcon } from "./icons";

export function SiteStory({ site }: { site: SiteId }) {
  const story = SITE_STORIES[site];
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);
  if (!story) return null;
  return (
    <div className="l-truth l-about" ref={box}>
      <button type="button" className="l-pill" aria-label={`About ${SITES[site].name}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <LanderIcon size={18} />
        <span>About {SITES[site].name}</span>
      </button>
      {open && (
        <div id={id} className="l-truth-pop l-about-pop" role="dialog" aria-label={story.title}>
          <button type="button" className="l-truth-close" aria-label="Close" onClick={() => setOpen(false)}>
            <CloseIcon size={18} />
          </button>
          <h2 className="l-about-title">{story.title}</h2>
          <p className="l-about-when">{story.when}</p>
          {story.crew && (
            <ul className="l-about-crew" aria-label="Crew">
              {story.crew.map((p) => (
                <li key={p.name}>
                  <strong>{p.name}</strong>
                  <span>{p.role}</span>
                </li>
              ))}
            </ul>
          )}
          {story.quote && (
            <blockquote className="l-about-quote">
              <p>“{story.quote.text}”</p>
              <footer>{story.quote.by}</footer>
            </blockquote>
          )}
          <ul className="l-about-facts">
            {story.facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <p className="l-about-sources">
            Sources:{" "}
            {story.sources.map((s, i) => (
              <span key={s.url}>
                {i > 0 && " · "}
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.label}
                </a>
              </span>
            ))}
          </p>
        </div>
      )}
    </div>
  );
}
