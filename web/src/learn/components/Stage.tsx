import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { describe } from "../describe";
import { frameFrom, timelineFor, useLive } from "../derive";
import { LearnScene } from "../scene/LearnScene";
import { chapterOf, useLearn } from "../store";
import { craterTerrain, ensureCrater, ensureTerrain, siteById } from "../terrain";
import { sampleAt } from "../timeline";
import { isPhoneLayout, prefersReducedMotion, useIsPhone } from "../../lib/media";
import { Compass } from "./Compass";
import { ArrowDownIcon, ArrowUpIcon, CrosshairIcon } from "./icons";
import { SunPath } from "./SunPath";
import { TruthNote } from "./TruthNote";
import { WhereBadge } from "./WhereBadge";

const SAFE_LEFT = 448;

function sentence(): string {
  const s = useLearn.getState();
  const tl = timelineFor(s);
  const f = frameFrom(s, false);
  const power = chapterOf(s.chapter).chips.includes("power");
  return describe(f.site, s.lat, Math.floor(s.t) + 1, f.sky, power ? sampleAt(tl, s.t).battery : null);
}

interface LookState {
  heading: number;
  fov: number;
  pitch: number;
  vfov: number;
}

function GroundUi({ look, onLook }: { look: LookState; onLook: (az: number, el: number) => void }) {
  const { sky } = useLive();
  const follow = useLearn((s) => s.follow);
  const chapter = useLearn((s) => s.chapter);
  const glFailed = useLearn((s) => s.glFailed);
  const [hintDone, setHintDone] = useState<string | null>(null);
  useEffect(() => {
    const id = window.setTimeout(() => setHintDone(chapter), 6000);
    return () => window.clearTimeout(id);
  }, [chapter]);
  const hint = hintDone !== chapter;
  const wants = chapterOf(chapter).follow === "earth" ? "earth" : "sun";
  const h = glFailed ? (wants === "earth" ? sky.earth.az : sky.sun.az) : look.heading;
  const below = sky.earth.el < -10;
  const body = wants === "earth" ? sky.earth : sky.sun;
  const bodyUp = wants === "earth" ? sky.earth.visible : sky.sun.status !== "night" && sky.sun.status !== "behindHill";
  const overhead = !glFailed && follow !== "free" && bodyUp && body.el - body.radius > look.pitch + look.vfov / 2;
  return (
    <>
      {below && (
        <p className="l-below">
          <ArrowDownIcon size={18} /> Earth is below your feet, behind the Moon
        </p>
      )}
      {overhead && (
        <p className="l-overhead">
          <ArrowUpIcon size={18} /> {wants === "earth" ? "Earth" : "The Sun"} is high overhead, above this view
        </p>
      )}
      <div className="l-look">
        {follow === "free" ? (
          <button type="button" className="l-pill" onClick={() => useLearn.getState().setFollow(wants)}>
            <CrosshairIcon size={18} /> {wants === "earth" ? "Follow Earth" : "Follow the Sun"}
          </button>
        ) : (
          hint && <span className="l-hint">Drag to look around</span>
        )}
      </div>
      <Compass heading={h} fov={glFailed ? 60 : look.fov} sky={sky} onLook={onLook} />
    </>
  );
}

function PoleDiagram() {
  const { sky, lat } = useLive();
  const d = useLearn((s) => chapterOf(s.chapter).epochD + s.t);
  return <SunPath lat={lat} d={d} sky={sky} />;
}

export function Stage() {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef<HTMLParagraphElement>(null);
  const sceneRef = useRef<LearnScene | null>(null);
  const [look, setLook] = useState<LookState>({ heading: 0, fov: 60, pitch: 0, vfov: 60 });
  const { view, chapter, siteId, lat, glFailed } = useLearn(
    useShallow((s) => ({ view: s.view, chapter: s.chapter, siteId: s.siteId, lat: s.lat, glFailed: s.glFailed })),
  );
  useLearn((s) => s.terrainRev);
  const terrain = siteById(siteId).terrain;
  useEffect(() => ensureTerrain(siteId), [siteId]);
  useEffect(() => {
    if (view === "crater") ensureCrater();
  }, [view]);
  const craterReal = craterTerrain() !== null;
  const phone = useIsPhone();

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const canvas = document.createElement("canvas");
    canvas.className = "l-canvas";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "A 3D view of the Moon");
    el.prepend(canvas);
    let scene: LearnScene;
    try {
      scene = new LearnScene(canvas, { pixelRatioCap: 2 });
    } catch {
      canvas.remove();
      useLearn.setState({ glFailed: true });
      return;
    }
    sceneRef.current = scene;
    scene.onLookChange = (heading, fov, pitch, vfov) => setLook({ heading, fov, pitch, vfov });
    scene.onUserLook = () => {
      if (useLearn.getState().follow !== "free") useLearn.getState().setFollow("free");
    };
    const layout = () => {
      const r = el.getBoundingClientRect();
      scene.resize(r.width, r.height, isPhoneLayout() ? 0 : SAFE_LEFT);
    };
    const ro = new ResizeObserver(layout);
    ro.observe(el);
    layout();
    const push = () => {
      const s = useLearn.getState();
      scene.update(frameFrom(s, prefersReducedMotion()));
      canvas.style.touchAction = s.view === "ground" ? "pan-y" : "none";
    };
    push();
    const unsub = useLearn.subscribe(push);
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    mq.addEventListener("change", push);
    let labelKey = "";
    const describeTick = () => {
      const s = useLearn.getState();
      if (s.chapter === "intro") return;
      const text = sentence();
      if (live.current) live.current.textContent = text;
      const k = `${s.chapter}|${s.siteId}|${s.playing}`;
      if (!s.playing || k !== labelKey) {
        labelKey = k;
        canvas.setAttribute("aria-label", text);
      }
    };
    const iv = window.setInterval(describeTick, 1000);
    return () => {
      window.clearInterval(iv);
      unsub();
      mq.removeEventListener("change", push);
      ro.disconnect();
      scene.dispose();
      canvas.remove();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      const s = useLearn.getState();
      if (!s.playing) {
        raf = 0;
        return;
      }
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      const c = chapterOf(s.chapter);
      let t = s.t + s.speed * dt;
      if (t >= c.spanDays) {
        if (s.chapter === "intro" || s.chapter === "explore") t %= c.spanDays;
        else {
          useLearn.setState({ t: c.spanDays, playing: false });
          raf = 0;
          return;
        }
      }
      useLearn.setState({ t });
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      if (raf || !useLearn.getState().playing) return;
      last = 0;
      raf = requestAnimationFrame(tick);
    };
    start();
    const unsub = useLearn.subscribe((s, p) => {
      if (s.playing && !p.playing) start();
    });
    return () => {
      unsub();
      cancelAnimationFrame(raf);
    };
  }, []);

  const onLook = (az: number, el: number) => sceneRef.current?.lookAt(az, el);
  const intro = chapter === "intro";
  return (
    <div className={`l-stage view-${view} ${intro ? "is-intro" : ""}`}>
      <div className="l-canvas-host" ref={host}>
        {glFailed && (
          <div className="l-fallback">
            <p>Your device can't show the 3D view, but everything below still works.</p>
          </div>
        )}
      </div>
      {!intro && (
        <div className="l-stage-ui">
          <div className="l-stage-top">
            <TruthNote view={view} site={siteId} chapter={chapter} terrain={terrain} craterReal={craterReal} />
            {chapter === "pole" && !phone && <WhereBadge lat={lat} />}
            {chapter === "pole" && !phone && <PoleDiagram />}
          </div>
          {chapter === "pole" && phone && (
            <div className="l-where-phone">
              <PoleDiagram />
            </div>
          )}
          {view === "ground" && <GroundUi look={look} onLook={onLook} />}
        </div>
      )}
      <p className="sr-only" ref={live} />
    </div>
  );
}
