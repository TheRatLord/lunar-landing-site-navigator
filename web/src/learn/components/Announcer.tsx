import { useEffect, useRef, useState } from "react";
import { skyAt } from "../geometry";
import { siteOf, latArg, timelineFor } from "../derive";
import { chapterOf, useLearn } from "../store";
import { sampleAt } from "../timeline";

interface Snap {
  key: string;
  sun: string;
  earth: boolean;
  empty: boolean;
}

export function Announcer() {
  const [msg, setMsg] = useState("");
  const lastAt = useRef(0);
  const prev = useRef<Snap | null>(null);
  const queued = useRef<string | null>(null);
  const timer = useRef(0);

  useEffect(() => {
    const say = (text: string) => {
      const now = performance.now();
      const playing = useLearn.getState().playing;
      if (!playing || now - lastAt.current >= 1500) {
        lastAt.current = now;
        setMsg(text);
        return;
      }
      queued.current = text;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (queued.current) {
          lastAt.current = performance.now();
          setMsg(queued.current);
          queued.current = null;
        }
      }, 1500 - (now - lastAt.current));
    };
    const check = () => {
      const s = useLearn.getState();
      if (s.chapter === "intro") {
        prev.current = null;
        return;
      }
      const c = chapterOf(s.chapter);
      const sky = skyAt(siteOf(s), c.epochD + s.t, latArg(s));
      const b = sampleAt(timelineFor(s), s.t).battery;
      const snap: Snap = {
        key: `${s.chapter}|${s.siteId}|${s.lat}|${s.landingOffset}`,
        sun: sky.sun.status === "peeking" ? "up" : sky.sun.status,
        earth: sky.earth.visible,
        empty: b === 0,
      };
      const p = prev.current;
      prev.current = snap;
      const power = c.chips.includes("power");
      if (power && snap.empty && s.note === "never") useLearn.setState({ note: "showing" });
      if (!p || p.key !== snap.key) return;
      const out: string[] = [];
      if (p.sun !== snap.sun) {
        if (snap.sun === "eclipse") out.push("Eclipse started.");
        else if (p.sun === "eclipse" && snap.sun === "up") out.push("The eclipse is over.");
        else if (snap.sun === "night" && (p.sun === "up" || p.sun === "behindHill")) out.push("The Sun set.");
        else if (snap.sun === "behindHill" && p.sun === "up") out.push("The Sun went behind a hill.");
        else if (snap.sun === "up") out.push("The Sun came up.");
      }
      if (p.earth !== snap.earth) out.push(snap.earth ? "Earth rose." : "Earth set.");
      if (power && snap.empty && !p.empty) out.push("Battery empty.");
      if (out.length) say(out.join(" "));
    };
    const unsub = useLearn.subscribe(check);
    return () => {
      unsub();
      window.clearTimeout(timer.current);
    };
  }, []);

  return (
    <p className="sr-only" aria-live="polite" role="status">
      {msg}
    </p>
  );
}
