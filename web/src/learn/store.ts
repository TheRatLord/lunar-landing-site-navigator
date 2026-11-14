import { create } from "zustand";
import { clamp } from "../lib/scale";
import { CHAPTERS, chapterBySlug, landingT, type Chapter, type ChapterSlug, type Follow, type ViewKind } from "./chapters";
import type { CraterSource } from "./scene/craterView";
import { termsIn, type TermId } from "./glossary";
import { SITES, type SiteId } from "./sites";

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
  interacted: boolean;
  termHome: Partial<Record<TermId, ChapterSlug>>;
  note: "never" | "showing" | "done";
  glFailed: boolean;
  /** Bumped whenever a site's real terrain finishes loading (see terrain.ts). */
  terrainRev: number;
  craterTerrain: CraterSource;
  panel: boolean;
  setPanel(open: boolean): void;
  enterChapter(slug: ChapterKey, reducedMotion: boolean): void;
  setT(t: number): void;
  nudge(dt: number): void;
  togglePlay(): void;
  setPlaying(p: boolean): void;
  setSpeed(s: number): void;
  setSite(id: SiteId): void;
  setLat(v: number): void;
  setLanding(o: Landing): void;
  setView(v: ViewKind): void;
  setFollow(f: Follow): void;
  answer(slug: ChapterSlug, i: number, correct: boolean): void;
}

export const chapterOf = (key: ChapterKey): Chapter => chapterBySlug(key) ?? CHAPTERS[0]!;

export const landingOf = (s: Pick<LearnState, "chapter" | "landingOffset">): number | null =>
  s.chapter === "timing" ? landingT(s.landingOffset) : null;

const LAST_KEY = "lunarnav.learn.last";

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
  answers: {},
  interacted: false,
  termHome: {},
  note: "never",
  glFailed: false,
  terrainRev: 0,
  craterTerrain: "real",
  panel: true,
  setPanel: (panel) => set({ panel }),

  enterChapter: (slug, reducedMotion) => {
    const c = chapterOf(slug);
    const termHome = { ...get().termHome };
    if (slug !== "explore") {
      for (const id of termsIn(`${c.copy} ${c.prompt}`)) termHome[id] ??= c.slug;
      try {
        localStorage.setItem(LAST_KEY, slug);
      } catch {}
    }
    set({
      chapter: slug,
      t: slug === "timing" ? landingT(0) - 0.5 : 0,
      playing: !reducedMotion,
      speed: c.speed,
      siteId: c.defaultSite,
      lat: 0,
      landingOffset: 0,
      view: c.view,
      follow: c.follow,
      interacted: false,
      termHome,
      ...(slug === "explore" ? {} : { panel: true }),
    });
  },
  setT: (t) => {
    const span = chapterOf(get().chapter).spanDays;
    set({ t: clamp(t, 0, span), interacted: true });
  },
  nudge: (dt) => get().setT(get().t + dt),
  togglePlay: () => {
    const s = get();
    const span = chapterOf(s.chapter).spanDays;
    const restart = !s.playing && s.t >= span - 1e-6;
    set({ playing: !s.playing, t: restart ? 0 : s.t, interacted: true });
  },
  setPlaying: (p) => set({ playing: p }),
  setSpeed: (speed) => set({ speed, interacted: true }),
  setSite: (id) => {
    const s = get();
    let view = s.view;
    if (view === "crater" && id !== "rim" && id !== "floor") view = "ground";
    const follow: Follow = s.chapter === "earth" ? "earth" : s.follow === "free" ? chapterOf(s.chapter).follow : s.follow;
    set({ siteId: SITES[id] ? id : "apollo11", view, follow, interacted: true });
  },
  setLat: (lat) => set({ lat, interacted: true }),
  setLanding: (o) => {
    const t = landingT(o) - 0.5;
    set({ landingOffset: o, t, interacted: true, playing: get().playing });
  },
  setView: (view) => set({ view, interacted: true, follow: get().follow === "free" ? "sun" : get().follow }),
  setFollow: (follow) => set({ follow }),
  answer: (slug, i, correct) =>
    set((s) => ({ answers: { ...s.answers, [slug]: { picked: i, correct: s.answers[slug]?.correct || correct } } })),
}));
