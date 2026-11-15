import { create } from "zustand";
import { clamp } from "../lib/scale";
import { CHAPTERS, chapterBySlug, landingT, type Chapter, type ChapterSlug, type Follow, type ViewKind, setExploreYear } from "./chapters";
import type { CraterSource } from "./scene/craterView";
import { termsIn, type TermId } from "./glossary";
import { SITES, type SiteId } from "./sites";
import type { WalkBody } from "./walk/walkView";
import type { WalkPov } from "./walk/walkCamera";
import type { PropId } from "./walk/facts";
import type { MissionId } from "./walk/missions";
import { buildTimeline } from "./timeline";

export type Landing = 0 | 7 | 14;
export type ChapterKey = ChapterSlug;

interface Answer {
  picked: number;
  correct: boolean;
}

export interface LearnState {
  chapter: ChapterKey;
  t: number;
  playing: boolean;
  speed: number;
  siteId: SiteId;
  lat: number;
  landingOffset: Landing;
  view: ViewKind;
  follow: Follow;
  answers: Partial<Record<ChapterSlug, Answer>>;
  visited: boolean;
  termHome: Partial<Record<TermId, ChapterSlug>>;
  note: "never" | "showing" | "done";
  glFailed: boolean;
  /** Bumped whenever a site's real terrain finishes loading (see terrain.ts). */
  terrainRev: number;
  craterTerrain: CraterSource;
  fast: boolean;
  setFast(f: boolean): void;
  celebrate: boolean;
  panel: boolean;
  setPanel(open: boolean): void;
  walkBody: WalkBody;
  walkPov: WalkPov;
  setWalkPov(p: WalkPov): void;
  walkEdge: boolean;
  walkHint: boolean;
  walkLights: boolean;
  lookEarth: number;
  nearProp: PropId | null;
  planPlace: boolean;
  mission: MissionId | null;
  missionStep: number;
  missionFound: string | null;
  missionM: number | null;
  missionSide: string;
  missionPicker: boolean;
  setWalkBody(b: WalkBody): void;
  enterChapter(slug: ChapterKey, reducedMotion: boolean): void;
  setT(t: number): void;
  nudge(dt: number): void;
  togglePlay(): void;
  setPlaying(p: boolean): void;
  setSite(id: SiteId): void;
  setLat(v: number): void;
  setLanding(o: Landing): void;
  setFollow(f: Follow): void;
  setView(v: ViewKind): void;
  answer(slug: ChapterSlug, i: number, correct: boolean): void;
}

export const chapterOf = (key: ChapterKey): Chapter => chapterBySlug(key) ?? CHAPTERS[0]!;

export const landingOf = (s: Pick<LearnState, "chapter" | "landingOffset">): number | null =>
  s.chapter === "timing" ? landingT(s.landingOffset) : null;

const LAST_KEY = "lunarnav.learn.last";
const ANSWERS_KEY = "lunarnav.learn.answers";

function stored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

const exploreSpeed = (view: ViewKind, fast: boolean): number => (view === "walk" ? 0.05 : 1.5) * (fast ? 10 : 1);

function morning(siteId: SiteId, from: number, force: boolean): number {
  const c = chapterOf("explore");
  const tl = buildTimeline(SITES[siteId], 0, c.epochD, c.spanDays, null);
  const lit = (t: number) => (tl.sun[Math.round(t / tl.stepD)] ?? 0) > 0.5;
  const set = tl.events.find((e) => e.kind === "sunset" && e.t > from);
  if (!force && lit(from) && (!set || set.t - from >= 3)) return from;
  const rises = tl.events.filter((e) => e.kind === "sunrise");
  const rise = rises.find((e) => e.t > from) ?? rises[0];
  if (!rise) return from;
  for (const dt of [2, 1, 0.5]) if (lit(rise.t + dt)) return rise.t + dt;
  return rise.t + 0.25;
}

export const useLearn = create<LearnState>()((set, get) => ({
  chapter: "explore",
  t: 0,
  playing: false,
  speed: 0.6,
  siteId: "apollo11",
  lat: 0,
  landingOffset: 0,
  view: "space",
  follow: "sun",
  answers: stored<Partial<Record<ChapterSlug, Answer>>>(ANSWERS_KEY, {}),
  visited: stored<string | null>(LAST_KEY, null) !== null,
  termHome: {},
  note: "never",
  glFailed: false,
  terrainRev: 0,
  walkBody: "rover",
  walkPov: "third",
  setWalkPov: (walkPov) => set({ walkPov }),
  walkEdge: false,
  walkHint: true,
  walkLights: false,
  lookEarth: 0,
  nearProp: null,
  planPlace: false,
  mission: null,
  missionStep: 0,
  missionFound: null,
  missionM: null,
  missionSide: "",
  missionPicker: false,
  setWalkBody: (walkBody) => set({ walkBody }),
  craterTerrain: "real",
  fast: false,
  setFast: (fast) => set({ fast, speed: get().chapter === "explore" ? exploreSpeed(get().view, fast) : get().speed }),
  celebrate: false,
  panel: true,
  setPanel: (panel) => set({ panel }),

  enterChapter: (slug, reducedMotion) => {
    const c = chapterOf(slug);
    const termHome = { ...get().termHome };
    if (slug !== "explore") {
      for (const id of termsIn(`${c.copy} ${c.prompt}`)) termHome[id] ??= c.slug;
      try {
        localStorage.setItem(LAST_KEY, JSON.stringify(slug));
      } catch {}
    }
    const explore = slug === "explore";
    if (explore) setExploreYear(null);
    set({
      chapter: slug,
      t: slug === "timing" ? landingT(0) - 0.5 : explore ? morning(c.defaultSite, 0, true) : 0,
      playing: !reducedMotion,
      speed: explore ? exploreSpeed(c.view, false) : c.speed,
      fast: false,
      siteId: c.defaultSite,
      lat: slug === "pole" ? -45 : 0,
      landingOffset: 0,
      view: c.view,
      follow: c.follow,
      termHome,
      visited: get().visited || !explore,
      walkBody: explore ? "rover" : "astronaut",
      walkPov: "third",
      walkEdge: false,
      nearProp: null,
      mission: null,
      missionStep: 0,
      missionFound: null,
      missionPicker: false,
      panel: true,
    });
  },
  setT: (t) => {
    const span = chapterOf(get().chapter).spanDays;
    set({ t: clamp(t, 0, span) });
  },
  nudge: (dt) => get().setT(get().t + dt),
  togglePlay: () => {
    const s = get();
    const span = chapterOf(s.chapter).spanDays;
    const restart = !s.playing && s.t >= span - 1e-6;
    set({ playing: !s.playing, t: restart ? 0 : s.t });
  },
  setPlaying: (p) => set({ playing: p }),
  setSite: (id) => {
    const s = get();
    let view = s.view;
    if (view === "crater" && id !== "rim" && id !== "floor") view = "ground";
    const follow: Follow = s.chapter === "earth" ? "earth" : s.follow === "free" ? chapterOf(s.chapter).follow : s.follow;
    const siteId = SITES[id] ? id : "apollo11";
    const t = s.chapter === "explore" && view === "walk" ? morning(siteId, s.t, false) : s.t;
    set({ siteId, view, follow, t, walkEdge: false, nearProp: null });
  },
  setLat: (lat) => set({ lat }),
  setLanding: (o) => {
    const t = landingT(o) - 0.5;
    set({ landingOffset: o, t, playing: get().playing });
  },
  setFollow: (follow) => set({ follow }),
  setView: (view) => {
    const s = get();
    const explore = s.chapter === "explore";
    set({
      view,
      follow: s.follow === "free" ? "sun" : s.follow,
      speed: explore ? exploreSpeed(view, s.fast) : s.speed,
      t: explore && view === "walk" ? morning(s.siteId, s.t, false) : s.t,
    });
  },
  answer: (slug, i, correct) => {
    const answers = { ...get().answers, [slug]: { picked: i, correct: get().answers[slug]?.correct || correct } };
    set({ answers });
    try {
      localStorage.setItem(ANSWERS_KEY, JSON.stringify(answers));
    } catch {}
  },
}));
