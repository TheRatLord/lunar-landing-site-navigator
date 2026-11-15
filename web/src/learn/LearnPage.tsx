import "../styles/learn.css";
import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { CHAPTERS, chapterBySlug, learnPath } from "./chapters";
import { Announcer } from "./components/Announcer";
import { Dock } from "./components/Dock";
import { Finale } from "./components/Finale";
import { LessonNav } from "./components/LessonNav";
import { Readouts } from "./components/Readouts";
import { Stage } from "./components/Stage";
import { StoryCard } from "./components/StoryCard";
import { TimeBar } from "./components/TimeBar";
import { placeFromParams, visitPlanPlace } from "./planPlace";
import { useLearn, type ChapterKey } from "./store";
import { prefersReducedMotion } from "../lib/media";
import { useRememberMode } from "../shell/lastMode";
import { TopBar } from "../shell/TopBar";

function ExploreRoute() {
  const celebrate = useLearn((s) => s.celebrate);
  const navigate = useNavigate();
  const [place] = useState(() => placeFromParams(new URLSearchParams(window.location.search)));
  useEffect(() => {
    useLearn.getState().enterChapter("explore", prefersReducedMotion());
    if (place) {
      visitPlanPlace(place);
      navigate("/learn", { replace: true });
    }
  }, [navigate, place]);
  return (
    <>
      <Readouts />
      <Dock />
      {celebrate && <Finale />}
    </>
  );
}

function ChapterRoute() {
  const { slug } = useParams();
  const c = chapterBySlug(slug);
  const panel = useLearn((s) => s.panel);
  useEffect(() => {
    if (c && c.slug !== "explore") useLearn.getState().enterChapter(c.slug, prefersReducedMotion());
  }, [c]);
  if (!c || c.slug === "explore") return <Navigate to="/learn" replace />;
  return (
    <>
      <Readouts />
      {panel && <StoryCard key={c.slug} c={c} />}
      <TimeBar c={c} />
    </>
  );
}

function currentKey(pathname: string): ChapterKey | null {
  const seg = pathname.replace(/^\/learn\/?/, "").split("/")[0] ?? "";
  if (!seg) return "explore";
  return chapterBySlug(seg)?.slug ?? null;
}

function useKeyboard(current: ChapterKey | null) {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const range = t instanceof HTMLInputElement && t.type === "range";
      if (!range && t?.closest("input, textarea, select, [contenteditable=true]")) return;
      const radio = !!t?.closest("[role=radio]");
      const pressable = radio || !!t?.closest("button, a, summary");
      const s = useLearn.getState();
      const i = CHAPTERS.findIndex((c) => c.slug === currentKey(window.location.pathname));
      if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        const j = Math.max(0, Math.min(CHAPTERS.length - 1, i + (e.key === "]" ? 1 : -1)));
        navigate(learnPath(CHAPTERS[j]!.slug));
        return;
      }
      if (current === null) return;
      if (s.view === "walk" && !range && (e.key === " " || e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End")) return;
      if (e.key === "k" || e.key === "K" || (e.key === " " && !pressable)) {
        e.preventDefault();
        s.togglePlay();
        return;
      }
      if (radio || range) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (s.view === "walk") return;
        e.preventDefault();
        const step = e.shiftKey ? 1 : 0.25;
        s.nudge(e.key === "ArrowLeft" ? -step : step);
      } else if (e.key === "Home") {
        e.preventDefault();
        s.setT(0);
      } else if (e.key === "End") {
        e.preventDefault();
        s.setT(Number.MAX_SAFE_INTEGER);
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (useLearn.getState().view !== "walk") return;
      const t = (e.target as HTMLElement | null)?.closest?.(".l-main button, .l-main input[type=range]");
      if (t) window.setTimeout(() => (document.activeElement === t ? (t as HTMLElement).blur() : undefined), 0);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerup", onPointerUp, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerup", onPointerUp, true);
    };
  }, [current, navigate]);
}

export default function LearnPage() {
  const { pathname } = useLocation();
  const current = currentKey(pathname);
  useKeyboard(current);
  useRememberMode("explorer");
  const view = useLearn((s) => s.view);
  const panel = useLearn((s) => s.panel);
  return (
    <div className={`learn v-${view} ${current === "explore" ? "is-explore" : ""} ${panel ? "" : "panel-hidden"}`}>
      <a className="l-skip" href="#l-main">
        Skip to the controls
      </a>
      <TopBar nav={<LessonNav current={current} />} />
      <main className="l-main" id="l-main">
        <Routes>
          <Route index element={<ExploreRoute />} />
          <Route path="explore" element={<Navigate to="/learn" replace />} />
          <Route path=":slug" element={<ChapterRoute />} />
          <Route path="*" element={<Navigate to="/learn" replace />} />
        </Routes>
        <Stage />
      </main>
      <Announcer />
    </div>
  );
}
