import { useEffect, useId, useRef, useState } from "react";
import type { ViewKind } from "../chapters";
import type { CraterSource } from "../scene/craterView";
import type { SiteId } from "../sites";
import { siteById } from "../terrain";
import { useLearn, type ChapterKey } from "../store";
import { missionById } from "../walk/missions";
import { CloseIcon, InfoIcon } from "./icons";

function lines(view: ViewKind, site: SiteId, chapter: ChapterKey, crater: CraterSource): string[] {
  const out: string[] = [];
  if (view === "space") {
    out.push("Not to scale: the Moon is really 30 Earths away.", "The tilts are real.");
  } else if (view === "ground" || view === "walk") {
    if (chapter === "earth") out.push("Earth is drawn 3 times bigger. Where it sits in the sky is real.");
    if (site === "custom") out.push("The ground is flat on purpose, so only the tilt matters.");
    else if (site === "plan" && !siteById(site).terrain)
      out.push("No laser map loaded for this spot, so the ground and the skyline are made up. The Planner uses the measured horizon.");
    else if (view === "walk")
      out.push(
        siteById(site).terrain
          ? "The ground around you is from NASA laser maps. Rocks and small bumps are made up."
          : "The far hills are from NASA laser maps. The ground near you is made up.",
      );
    else out.push("The hills are from NASA laser maps. Rocks and small craters are made up.");
  } else if (crater === "real") {
    out.push("This is Shackleton's real shape, measured by a laser on NASA's Lunar Reconnaissance Orbiter.");
  } else {
    out.push("The real map could not load, so this is a look-alike with the right size and depth.");
  }
  if (view === "walk") {
    out.push("The astronaut and rover are you, visiting today. They were not really here.");
    if (site === "apollo11" || site === "change4" || site === "blueghost")
      out.push(`The spacecraft and gear on the ground are really here, drawn as simple models about where they stand.${site === "change4" ? " Yutu-2 has since driven away." : ""}`);
    out.push("The lamps are pretend. With them off, the dark is real.");
    const m = missionById(useLearn.getState().mission);
    if (m) out.push(`The ${m.rover} mission is played here with this rover. The real ${m.rover} was smaller and ${m.where}; the markers are made up.`);
    out.push("The glow around the Sun and the faint stars by day are what a camera sees. The Moon has no air to make a glow.");
    out.push("The battery is pretend. Its panel follows the site's sunlight, not the exact shadow on it.");
  }
  if (site === "blueghost" && chapter === "timing") out.push("The battery is pretend.", "The eclipse view is zoomed in.");
  out.push("Sun and Earth can be off by about one Sun-width.");
  return out;
}

export function TruthNote({
  view,
  site,
  chapter,
  crater,
}: {
  view: ViewKind;
  site: SiteId;
  chapter: ChapterKey;
  crater: CraterSource;
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
        <InfoIcon size={18} />
        <span>
          Is this real?
        </span>
      </button>
      {open && (
        <div id={id} className="l-truth-pop" role="dialog" aria-label="Is this real?">
          <button type="button" className="l-truth-close" aria-label="Close" onClick={() => setOpen(false)}>
            <CloseIcon size={18} />
          </button>
          <ul>
            {lines(view, site, chapter, crater).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
