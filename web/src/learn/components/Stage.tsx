import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { describe } from "../describe";
import { frameFrom, timelineFor, useLive } from "../derive";
import { plannerHref } from "../planPlace";
import { missionTarget } from "./walk/MissionPanel";
import { LearnScene } from "../scene/LearnScene";
import { WalkHud } from "./walk/WalkHud";
import { chapterOf, useLearn } from "../store";
import { ensureTerrain, siteById } from "../terrain";
import { sampleAt } from "../timeline";
import { isPhoneLayout, prefersReducedMotion } from "../../lib/media";
import { Compass } from "./Compass";
import { ShowPanel } from "./PanelBar";
import { ArrowDownIcon, ArrowRightIcon, ArrowUpIcon, CrosshairIcon, InfoIcon } from "./icons";
import { SunPath } from "./SunPath";
import { SiteStory } from "./SiteStory";
import { TruthNote } from "./TruthNote";

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
  const below = sky.earth.el < -10 && wants === "earth";
  const body = wants === "earth" ? sky.earth : sky.sun;
  const bodyUp = wants === "earth" ? sky.earth.visible : sky.sun.status !== "night" && sky.sun.status !== "behindHill";
  const overhead = !glFailed && follow !== "free" && bodyUp && body.el - body.radius > look.pitch + look.vfov / 2;
  return (
    <>
      {below && (
        <p className="l-below">
          <ArrowDownIcon size={18} /> Earth is behind the Moon
        </p>
      )}
      {overhead && (
        <p className="l-overhead">
          <ArrowUpIcon size={18} /> {wants === "earth" ? "Earth" : "Sun"} overhead
        </p>
      )}
      <div className="l-look">
        {follow === "free" && bodyUp ? (
          <button type="button" className="l-pill" onClick={() => useLearn.getState().setFollow(wants)}>
            <CrosshairIcon size={18} /> {wants === "earth" ? "Follow Earth" : "Follow the Sun"}
          </button>
        ) : (
          hint && follow !== "free" && <span className="l-hint">Drag to look around</span>
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
  const { view, chapter, siteId, glFailed, craterTerrain, panel } = useLearn(
    useShallow((s) => ({
      view: s.view,
      chapter: s.chapter,
      siteId: s.siteId,
      glFailed: s.glFailed,
      craterTerrain: s.craterTerrain,
      panel: s.panel,
    })),
  );
  useEffect(() => ensureTerrain(siteId), [siteId]);
  const [loading, setLoading] = useState(true);

  function mount(): (() => void) | undefined {
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
      setLoading(false);
      return;
    }
    sceneRef.current = scene;
    scene.onLookChange = (heading, fov, pitch, vfov) => setLook({ heading, fov, pitch, vfov });
    scene.onCraterTerrain = (craterTerrain) => useLearn.setState({ craterTerrain });
    scene.onWalkInteract = () => useLearn.getState().toggleRoverSeat();
    scene.onWalkPov = () => {
      const s = useLearn.getState();
      s.setWalkPov(s.walkPov === "first" ? "third" : "first");
    };
    scene.onWalkLights = () => useLearn.setState({ walkLights: !useLearn.getState().walkLights });
    scene.onWalkEdge = (walkEdge) => useLearn.setState({ walkEdge });
    scene.onWalkNear = (nearProp) => useLearn.setState({ nearProp });
    scene.onWalkTarget = (missionM, missionSide) => useLearn.setState({ missionM, missionSide });
    scene.onRoverNear = (nearRover) => useLearn.setState({ nearRover });
    scene.onWalkActive = () => {
      if (useLearn.getState().walkHint) useLearn.setState({ walkHint: false });
    };
    scene.onUserLook = () => {
      if (useLearn.getState().follow !== "free") useLearn.getState().setFollow("free");
    };
    const main = el.closest<HTMLElement>(".l-main");
    let ro: ResizeObserver | null = null;
    const layout = () => {
      const r = el.getBoundingClientRect();
      const bar = main?.querySelector(".l-dock") ?? main?.querySelector(".l-timebar");
      if (bar) ro?.observe(bar);
      const above = Math.round(Math.max(0, bar ? r.bottom - bar.getBoundingClientRect().top : 0) + 12);
      main?.style.setProperty("--l-above", `${above}px`);
      const safe = parseFloat(getComputedStyle(el).getPropertyValue("--l-safe"));
      scene.resize(r.width, r.height, isPhoneLayout() || !useLearn.getState().panel || !Number.isFinite(safe) ? 0 : safe, above);
    };
    ro = new ResizeObserver(layout);
    ro.observe(el);
    layout();
    let building = false;
    let alive = true;
    let shown = "";
    const later = (fn: () => void) => requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(() => alive && fn(), 0)));
    const push = () => {
      const s = useLearn.getState();
      const f = frameFrom(s, prefersReducedMotion());
      if (f.view === "walk" && !scene.walkReady) {
        if (!building) {
          building = true;
          setLoading(true);
          later(() => {
            scene.buildWalk(frameFrom(useLearn.getState(), prefersReducedMotion()));
            building = false;
            push();
            scene.afterRender(() => alive && setLoading(false));
          });
        }
        scene.update({ ...f, view: scene.currentView === "walk" ? "space" : scene.currentView });
      } else if (f.view === "walk" && scene.currentView === "walk" && f.site.id !== shown) {
        if (!building) {
          building = true;
          setLoading(true);
          later(() => {
            building = false;
            shown = useLearn.getState().siteId;
            push();
            scene.afterRender(() => alive && setLoading(false));
          });
        }
        return;
      } else scene.update(f);
      shown = f.site.id;
      scene.setWalkControl(s.walkControl);
      scene.setWalkPov(s.walkPov);
      scene.setWalkLights(s.walkLights);
      scene.setWalkTarget(missionTarget(s.mission, s.missionStep));
      canvas.style.touchAction = s.view === "ground" ? "pan-y" : "none";
    };
    push();
    if (!building) scene.afterRender(() => alive && setLoading(false));
    const unsub = useLearn.subscribe(push);
    const unsubLook = useLearn.subscribe((s, p) => {
      if (s.lookEarth === p.lookEarth) return;
      const { sky } = frameFrom(s, false);
      if (s.view === "walk" && s.walkPov !== "first") s.setWalkPov("first");
      scene.lookAt(sky.earth.az, sky.earth.el);
    });
    const unsubPanel = useLearn.subscribe((s, p) => {
      if (s.panel !== p.panel || s.chapter !== p.chapter || s.view !== p.view) layout();
    });
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    mq.addEventListener("change", push);
    let labelKey = "";
    const describeTick = () => {
      const s = useLearn.getState();
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
      alive = false;
      window.clearInterval(iv);
      unsub();
      unsubPanel();
      unsubLook();
      mq.removeEventListener("change", push);
      ro?.disconnect();
      scene.dispose();
      canvas.remove();
      sceneRef.current = null;
    };
  }

  useEffect(() => {
    let stop = () => {};
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        raf = 0;
        stop = mount() ?? stop;
      });
    });
    return () => {
      cancelAnimationFrame(raf);
      stop();
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
        if (s.chapter === "explore") t %= c.spanDays;
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
  return (
    <div className={`l-stage view-${view} ${loading && view === "walk" ? "is-building" : ""}`}>
      <div className="l-canvas-host" ref={host}>
        {glFailed && (
          <div className="l-fallback">
            <p>No 3D on this device. The lessons still work.</p>
          </div>
        )}
      </div>
      <div className="l-stage-ui">
        <div className={`l-stage-top${chapter === "explore" ? " l-fold" : ""}`}>
          {chapter === "explore" && (
            <button type="button" className="l-fold-sum l-pill" aria-label="Show info and links">
              <InfoIcon size={18} /> Info
            </button>
          )}
          {!panel && <ShowPanel />}
          <TruthNote view={view} site={siteId} chapter={chapter} crater={craterTerrain} />
          {chapter === "explore" && <SiteStory key={siteId} site={siteId} />}
          {chapter === "explore" && siteId !== "custom" && (
            <Link className="l-pill l-to-planner" to={plannerHref(siteId)}>
              Analyse in Planner <ArrowRightIcon size={16} />
            </Link>
          )}
        </div>
        {chapter === "pole" && (
          <div className="l-pole">
            <PoleDiagram />
          </div>
        )}
        {loading && (
          <p className="l-loading" role="status">
            <span className="l-loading-dot" aria-hidden /> {view === "walk" ? `Landing at ${siteById(siteId).name}…` : "Loading the Moon…"}
          </p>
        )}
        {view === "ground" && <GroundUi look={look} onLook={onLook} />}
        {view === "walk" && !loading && <WalkHud onStick={(x, y) => sceneRef.current?.setWalkStick(x, y)} onJump={() => sceneRef.current?.walkJump()} />}
      </div>
      <p className="sr-only" ref={live} />
    </div>
  );
}
