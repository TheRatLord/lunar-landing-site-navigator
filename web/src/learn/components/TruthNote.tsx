import { useEffect, useId, useRef, useState } from "react";
import type { ViewKind } from "../chapters";
import type { SiteId } from "../sites";
import type { ChapterKey } from "../store";
import { CloseIcon, InfoIcon } from "./icons";

function lines(view: ViewKind, site: SiteId, chapter: ChapterKey): string[] {
  const out: string[] = [];
  if (view === "space") {
    out.push(
      "Sizes and distances are squashed to fit. Really, the Moon is 30 Earths away, and the Sun is 400 times farther still. The Moon is drawn twice as big.",
      "The tilts are real: Moon 1.5°, its path 5°, Earth 23°.",
    );
  } else if (view === "ground") {
    if (chapter === "earth") {
      out.push(
        "Earth is drawn 3 times bigger than it really looks, so it is easy to spot. Its place in the sky is true.",
        "The Sun is shown at its true size. The glow around it is just for show.",
      );
    } else {
      out.push("The Sun and Earth are shown at their true size and position in the sky.", "The glow around the Sun is just for show.");
    }
    if (site === "rim" || site === "floor") out.push("The hill shapes are simplified look-alikes of the real ones.");
    if (site === "custom") out.push("The ground here is made flat on purpose, so only the Moon's lean matters.");
  } else {
    out.push("Real size and depth, smoothed shape.");
  }
  if (site === "blueghost") {
    out.push(
      "The pretend battery assumes a solar panel that always turns to face the Sun.",
      "When Earth slides in front of the Sun, the view zooms in like binoculars so you can see it.",
    );
  }
  out.push(
    "Positions come from simple math. They are close, but can be off by about the width of the Sun in the sky. Real missions use exact data and real Moon maps. That is what the Planner does.",
  );
  return out;
}

export function TruthNote({ view, site, chapter }: { view: ViewKind; site: SiteId; chapter: ChapterKey }) {
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
  return (
    <div className="l-truth" ref={box}>
      <button type="button" className="l-pill" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <InfoIcon size={18} /> How true is this picture?
      </button>
      {open && (
        <div id={id} className="l-truth-pop" role="dialog" aria-label="How true is this picture?">
          <button type="button" className="l-truth-close" aria-label="Close" onClick={() => setOpen(false)}>
            <CloseIcon size={18} />
          </button>
          <ul>
            {lines(view, site, chapter).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
