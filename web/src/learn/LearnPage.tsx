import "../styles/learn.css";
import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { CHAPTERS, chapterBySlug } from "./chapters";
import { Announcer } from "./components/Announcer";
import { ExploreCard } from "./components/Explore";
import { Intro } from "./components/Intro";
import { LearnHeader } from "./components/LearnHeader";
import { Readouts } from "./components/Readouts";
import { Stage } from "./components/Stage";
import { StoryCard } from "./components/StoryCard";
import { TimeBar } from "./components/TimeBar";
import { useLearn, type ChapterKey } from "./store";
import { prefersReducedMotion } from "../lib/media";

const EXPLORE = chapterBySlug("explore")!;

function IntroRoute() {
  useEffect(() => {
    useLearn.getState().enterChapter("intro", prefersReducedMotion());
  }, []);
  return <Intro />;
}

function ExploreRoute() {
  useEffect(() => {
    useLearn.getState().enterChapter("explore", prefersReducedMotion());
  }, []);
  return (
    <>
      <Readouts />
      <ExploreCard />
      <TimeBar c={EXPLORE} />
    </>
  );
}

function ChapterRoute() {
  const { slug } = useParams();
  const c = chapterBySlug(slug);
  useEffect(() => {
    if (c && c.slug !== "explore") useLearn.getState().enterChapter(c.slug, prefersReducedMotion());
  }, [c]);
  if (!c || c.slug === "explore") return <Navigate to="/learn" replace />;
  return (
    <>
      <Readouts />
      <StoryCard key={c.slug} c={c} />
      <TimeBar c={c} />
    </>
  );
}

function currentKey(pathname: string): ChapterKey | null {
  const seg = pathname.replace(/^\/learn\/?/, "").split("/")[0] ?? "";
  if (!seg) return "intro";
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
        if (e.key === "]") navigate(`/learn/${CHAPTERS[Math.min(CHAPTERS.length - 1, i + 1)]!.slug}`);
        else navigate(i <= 0 ? "/learn" : `/learn/${CHAPTERS[i - 1]!.slug}`);
        return;
      }
      if (current === "intro" || current === null) return;
      if (e.key === "k" || e.key === "K" || (e.key === " " && !pressable)) {
        e.preventDefault();
        s.togglePlay();
        return;
      }
      if (radio || range) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, navigate]);
}

export default function LearnPage() {
  const { pathname } = useLocation();
  const current = currentKey(pathname);
  useKeyboard(current);
  const view = useLearn((s) => s.view);
  return (
    <div className={`learn v-${current === "intro" ? "space" : view} ${current === "intro" ? "is-intro" : ""}`}>
      <a className="l-skip" href="#l-main">
        Skip to the lesson
      </a>
      <LearnHeader current={current} />
      <main className="l-main" id="l-main">
        <Routes>
          <Route index element={<IntroRoute />} />
          <Route path="explore" element={<ExploreRoute />} />
          <Route path=":slug" element={<ChapterRoute />} />
          <Route path="*" element={<Navigate to="/learn" replace />} />
        </Routes>
        <Stage />
      </main>
      <Announcer />
    </div>
  );
}
