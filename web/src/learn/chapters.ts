import { dayOfIso } from "./geometry";
import type { SiteId } from "./sites";

export type ChapterSlug = "day" | "earth" | "pole" | "crater" | "timing" | "explore";
export type ViewKind = "space" | "ground" | "crater";
export type ControlKind = "none" | "nearFar" | "latitude" | "rimFloor" | "landing" | "explore";
export type Follow = "sun" | "earth" | "free";
export type TickKind = "sunrise" | "sunset" | "eclipse";
type ChipKind = "sun" | "earth" | "power";

export interface QuizCheck {
  question: string;
  options: string[];
  correct: number;
  hint: string;
  explain: string;
}

export type BigNumber =
  | { kind: "static"; value: string; caption: string; compare?: string; lean?: boolean }
  | { kind: "headline"; value: string }
  | { kind: "sunnyDays" }
  | { kind: "none" };

export interface Chapter {
  slug: ChapterSlug;
  n: number;
  title: string;
  short: string;
  copy: string;
  prompt: string;
  epoch: string;
  epochD: number;
  spanDays: number;
  defaultSite: SiteId;
  view: ViewKind;
  control: ControlKind;
  speed: number;
  follow: Follow;
  inset: "ground" | null;
  trail: "earth" | "sunpath" | null;
  ticks: TickKind[];
  chips: ChipKind[];
  big: BigNumber;
  takeaway: string;
  check: QuizCheck | null;
}

const ch = (c: Omit<Chapter, "epochD">): Chapter => ({ ...c, epochD: dayOfIso(c.epoch) });

const LANDING_HOUR = (8 + 34 / 60) / 24;

export const CHAPTERS: Chapter[] = [
  ch({
    slug: "day",
    n: 1,
    title: "A Moon day lasts a month",
    short: "A Moon day lasts a month",
    copy:
      "Earth spins once a day. The Moon turns once a month. So a {lunar-day|day} at Apollo 11 lasts about two weeks, and so does the night. With no air to hold heat, days are hotter than boiling water and nights colder than anywhere on Earth. Apollo 11 landed early in the Moon's morning on purpose: the low Sun made long {shadow|shadows}, so the crew could see bumps and rocks, and it was not yet too hot.",
    prompt: "Press play, or drag the slider. Watch the pin.",
    epoch: "1969-07-20T20:17:00Z",
    spanDays: 30,
    defaultSite: "apollo11",
    view: "space",
    control: "none",
    speed: 2,
    follow: "sun",
    inset: "ground",
    trail: null,
    ticks: ["sunrise", "sunset"],
    chips: ["sun"],
    big: { kind: "static", value: "≈ 15 Earth days", caption: "of sunshine, then about the same of night" },
    takeaway: "One Moon day ≈ one Earth month: two weeks of light, two weeks of dark.",
    check: {
      question: "The Sun just rose at Apollo 11. When will it set?",
      options: ["About 12 hours", "About two weeks", "About a year"],
      correct: 1,
      hint: "Think about how long the Moon takes to turn around once.",
      explain: "The Moon turns once a month, so the Sun stays up for about two weeks.",
    },
  }),
  ch({
    slug: "earth",
    n: 2,
    title: "Earth hangs still in the sky",
    short: "Earth hangs still",
    copy:
      "The Moon spins exactly as fast as it {orbit|goes around} Earth. So one side, the {near-side|near side}, always faces us. Stand there, and Earth hangs in your sky, rocking just a little. That rocking is called {wobble}. Go to the {far-side|far side} and Earth never rises at all. China's Chang'e 4 (say “chahng-uh”) landed there in 2019 and had to talk to Earth through a {relay-satellite|relay satellite}.",
    prompt: "Try it: watch Earth stay put while the Sun moves. Then switch to the far side.",
    epoch: "2026-01-12T00:00:00Z",
    spanDays: 30,
    defaultSite: "apollo11",
    view: "ground",
    control: "nearFar",
    speed: 2,
    follow: "earth",
    inset: null,
    trail: "earth",
    ticks: ["sunrise", "sunset"],
    chips: ["earth"],
    big: { kind: "headline", value: "Earth: same spot all month" },
    takeaway: "Where you land decides whether you can ever see Earth, and so whether you can call home directly.",
    check: {
      question: "Your rover is on the far side. Can it radio Earth directly?",
      options: ["Yes, at night", "Only when Earth rises", "Never, it needs a helper satellite"],
      correct: 2,
      hint: "Switch to the far side and look for Earth in the sky.",
      explain: "From the far side, Earth is always below the horizon, so messages must bounce off a relay satellite.",
    },
  }),
  ch({
    slug: "pole",
    n: 3,
    title: "At the pole, the Sun skims the ground",
    short: "The Sun skims the pole",
    copy:
      "Earth {tilt|leans} over a lot. That is why we have seasons. The Moon's {axis} barely leans at all. So near the pole, the Sun never gets high. It drives around you in a circle, just above the {horizon}, like a lamp on the floor. Here the ground is made flat, so only the lean matters.",
    prompt: "Try it: walk toward the south pole and watch the Sun's path flatten.",
    epoch: "2026-01-05T00:00:00Z",
    spanDays: 30,
    defaultSite: "custom",
    view: "ground",
    control: "latitude",
    speed: 2,
    follow: "sun",
    inset: null,
    trail: "sunpath",
    ticks: [],
    chips: ["sun"],
    big: { kind: "static", value: "1.5°", caption: "how far the Moon leans", compare: "Earth leans 23°", lean: true },
    takeaway: "Near the poles, the Sun is always on the horizon, so any little hill can block it.",
    check: {
      question: "Why does the Sun stay so low at the south pole?",
      options: [
        "The Sun is dimmer there",
        "The Moon is barely tilted, so at the pole the Sun circles along the horizon",
        "Earth is in the way",
      ],
      correct: 1,
      hint: "Look at how far the Moon leans compared with Earth.",
      explain: "With almost no lean, the Sun at the pole goes around you instead of up and over.",
    },
  }),
  ch({
    slug: "crater",
    n: 4,
    title: "About ten kilometres change everything",
    short: "Ten kilometres matter",
    copy:
      "Because the Sun only skims the horizon here, a {crater} wall is like a giant fence. On the {rim}, you sit above the fence, so the Sun shines most of the time and Earth often peeks over the edge. Down on the floor, the wall is always higher than the Sun. It has been dark there for billions of years. That is where ice can hide, which is exactly why missions want to land nearby.",
    prompt: "Try it: switch between the rim and the floor, then press play.",
    epoch: "2026-01-05T00:00:00Z",
    spanDays: 30,
    defaultSite: "rim",
    view: "crater",
    control: "rimFloor",
    speed: 2,
    follow: "sun",
    inset: "ground",
    trail: null,
    ticks: ["sunrise", "sunset"],
    chips: ["sun", "earth"],
    big: { kind: "static", value: "11 km", caption: "a two-hour walk" },
    takeaway: "At the pole, a short drive can flip a site from sunny to dark forever.",
    check: {
      question: "Two spots about 11 km apart: crater rim and crater floor. Which one gets sunlight?",
      options: ["The rim", "The floor", "Both the same"],
      correct: 0,
      hint: "Remember how low the Sun is at the pole. What does a tall wall do to low light?",
      explain: "The rim sits above the crater wall, so the low Sun reaches it. The floor is always in shadow.",
    },
  }),
  ch({
    slug: "timing",
    n: 5,
    title: "Land on the wrong day and you run out of sun",
    short: "A few days matter",
    copy:
      "In 2025, the Blue Ghost {lander} touched down on a flat, dark plain called the Sea of Crises, just after sunrise. So it had a whole two weeks of sunlight to work. If it had launched a week late, it would have had half as long. Two weeks late, and it would land right at sunset, with its battery soon empty. Watch 14 March: Earth slid in front of the Sun, and for a few hours the lander was in Earth's shadow, an {eclipse}.",
    prompt: "Try it: pick a landing day and watch the pretend battery. {solar-panel|Solar panels} only charge in sunlight.",
    epoch: "2025-03-01T00:00:00Z",
    spanDays: 30,
    defaultSite: "blueghost",
    view: "ground",
    control: "landing",
    speed: 1,
    follow: "sun",
    inset: null,
    trail: null,
    ticks: ["sunrise", "eclipse", "sunset"],
    chips: ["sun", "power"],
    big: { kind: "sunnyDays" },
    takeaway: "Missions aim to land just after sunrise. Every day of delay is a day of sunshine lost.",
    check: {
      question: "Your launch slips one week. What happens at a sunny site near the equator?",
      options: ["Nothing changes", "You get about half as many sunny days before night", "You get more sun"],
      correct: 1,
      hint: "Does the Sun wait for you? Look at the landing-day cards.",
      explain: "The Sun sets on the same day no matter when you arrive, so arriving late leaves fewer sunny days.",
    },
  }),
  ch({
    slug: "explore",
    n: 6,
    title: "Free explore",
    short: "Free explore",
    copy: "Pick a place, choose how to look, and let a whole year roll by. Try the Shackleton rim at Fast speed and watch the seasons.",
    prompt: "",
    epoch: "2026-01-01T00:00:00Z",
    spanDays: 365,
    defaultSite: "apollo11",
    view: "space",
    control: "explore",
    speed: 2,
    follow: "sun",
    inset: null,
    trail: null,
    ticks: ["sunrise", "sunset"],
    chips: ["sun", "earth"],
    big: { kind: "none" },
    takeaway: "",
    check: null,
  }),
];

export const STORY = CHAPTERS.filter((c) => c.slug !== "explore");

export function chapterBySlug(slug: string | undefined): Chapter | null {
  return CHAPTERS.find((c) => c.slug === slug) ?? null;
}

export const INTRO: Chapter = {
  ...CHAPTERS[0]!,
  slug: "explore",
  n: 0,
  title: "",
  epoch: "2026-01-26T00:00:00Z",
  epochD: dayOfIso("2026-01-26T00:00:00Z"),
  spanDays: 29.53,
  speed: 0.25,
  inset: null,
  ticks: [],
  check: null,
};

export const landingT = (offset: number): number => 1 + LANDING_HOUR + offset;
