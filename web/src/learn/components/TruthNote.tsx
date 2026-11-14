import { useEffect, useId, useRef, useState } from "react";
import type { ViewKind } from "../chapters";
import type { CraterSource } from "../scene/craterView";
import type { SiteId } from "../sites";
import type { ChapterKey } from "../store";
import type { SiteTerrain } from "../terrain";
import { CloseIcon, InfoIcon } from "./icons";

function lines(view: ViewKind, site: SiteId, chapter: ChapterKey, crater: CraterSource, terrain?: SiteTerrain): string[] {
  const out: string[] = [];
  if (view === "space") {
    out.push(
      "Things are squeezed together to fit on screen. The Moon is really about 30 Earths away, and it is drawn twice as big.",
      "The tilts are real: the Moon 1.5°, its path 5°, Earth 23°.",
    );
  } else if (view === "ground") {
    out.push(
      chapter === "earth"
        ? "Earth is drawn 3 times bigger so it is easy to spot. Where it sits in the sky is real."
        : "The Sun and Earth are the right size and in the right place in the sky.",
      "The glow around the Sun is just for looks.",
    );
    if (site === "custom") out.push("The ground is flat on purpose, so only the Moon's tilt matters.");
    else if (terrain)
      out.push(
        `The ground around you and the hills on the skyline are real, from NASA's laser maps of the Moon (${terrain.pixelM} m squares, ${terrain.patchStores.join(", ")}). Anything smaller, like the small craters, bumps and rocks, is made up.`,
      );
    else out.push("The hills on the skyline are real, from NASA's maps of the Moon. The ground near you and the rocks are made up.");
  } else if (crater === "real") {
    out.push(
      "This is the real shape of Shackleton crater, measured from space by a laser on NASA's Lunar Reconnaissance Orbiter.",
      "Heights are not stretched. The light and shadows come from the real hills.",
    );
  } else {
    out.push("The real map could not load, so this is a look-alike with the right size and depth.");
  }
  if (site === "blueghost") {
    out.push(
      "The battery is pretend. It imagines a solar panel that always turns to face the Sun.",
      "During the eclipse, the view zooms in like binoculars so you can see it.",
    );
  }
  out.push("The Sun and Earth positions use simple math, so they can be off by about the width of the Sun. The Planner uses exact positions.");
  return out;
}

export function TruthNote({
  view,
  site,
  chapter,
  crater,
  terrain,
}: {
  view: ViewKind;
  site: SiteId;
  chapter: ChapterKey;
  crater: CraterSource;
  terrain?: SiteTerrain;
}) {
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
            {lines(view, site, chapter, crater, terrain).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
