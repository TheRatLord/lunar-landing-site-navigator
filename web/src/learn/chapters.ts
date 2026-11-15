import { dayOfIso } from "./geometry";
import type { SiteId } from "./sites";

export type ChapterSlug = "day" | "earth" | "pole" | "crater" | "timing" | "explore";
export type ViewKind = "space" | "ground" | "crater" | "walk";
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
  | { kind: "static"; value: string; caption: string; lean?: boolean }
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
  check: QuizCheck | null;
}

const ch = (c: Omit<Chapter, "epochD">): Chapter => ({ ...c, epochD: dayOfIso(c.epoch) });

const EXPLORE_EPOCH = "2026-01-01T00:00:00Z";

const LANDING_HOUR = (8 + 34 / 60) / 24;

export const CHAPTERS: Chapter[] = [
  ch({
    slug: "explore",
    n: 0,
    title: "Explore the Moon",
    short: "Explore",
    copy: "",
    prompt: "",
    epoch: EXPLORE_EPOCH,
    spanDays: 365,
    defaultSite: "apollo11",
    view: "walk",
    control: "explore",
    speed: 0.05,
    follow: "sun",
    inset: null,
    trail: null,
    ticks: ["sunrise", "sunset"],
    chips: ["sun", "earth"],
    big: { kind: "none" },
    check: null,
  }),
  ch({
    slug: "day",
    n: 1,
    title: "A day on the Moon lasts a month",
    short: "A Moon day lasts a month",
    copy: "On the Moon the Sun rises once a month: two weeks of day, then two weeks of night.",
    prompt: "Watch the pin roll into night.",
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
    big: { kind: "static", value: "≈ 15 days", caption: "of sunshine" },
    check: {
      question: "Apollo 11 landed on Day 1. On which day did its Sun set?",
      options: ["Day 2", "Day 14", "Day 29"],
      correct: 1,
      hint: "Play it and read the day when the pin goes dark.",
      explain: "Day 14. The Moon turns once a month, so the Sun stays up for about two weeks.",
    },
  }),
  ch({
    slug: "earth",
    n: 2,
    title: "Earth stays in one spot",
    short: "Earth stays in one spot",
    copy: "One side of the Moon always faces Earth. Stand on that {near-side|near side} and Earth hangs in your sky, with a little {wobble}.",
    prompt: "Now try the {far-side|far side}.",
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
    big: { kind: "none" },
    check: {
      question: "A rover is on the far side. How can it talk to Earth?",
      options: ["Wait until Earth comes up", "Only at night", "Through a relay satellite"],
      correct: 2,
      hint: "Switch to the far side and look for Earth.",
      explain: "Earth never comes up on the far side. China's Chang'e 4 talks to Earth through a relay satellite.",
    },
  }),
  ch({
    slug: "pole",
    n: 3,
    title: "At the pole, the Sun stays low",
    short: "The Sun stays low at the pole",
    copy: "Earth leans a lot. The Moon hardly leans. Near the pole, that keeps the Sun low.",
    prompt: "Slide south and watch the Sun's path.",
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
    big: { kind: "static", value: "1.5°", caption: "Moon's lean", lean: true },
    check: {
      question: "At the pole, what does the Sun do?",
      options: ["Climbs high over your head", "Circles around you, low in the sky", "Never comes up"],
      correct: 1,
      hint: "Slide all the way to the pole and watch the Sun's path.",
      explain: "The Moon is barely tipped, so at the pole the Sun circles just above the horizon, like a lamp on the floor.",
    },
  }),
  ch({
    slug: "crater",
    n: 4,
    title: "Rim or floor?",
    short: "Rim or floor?",
    copy: "Near the pole the Sun is so low that a {crater} wall can block it, like a giant fence.",
    prompt: "Try the {rim}, then the floor.",
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
    big: { kind: "static", value: "11 km", caption: "rim to floor" },
    check: {
      question: "Play a whole month on the crater floor. How much sunshine does it get?",
      options: ["As much as the rim", "A little each day", "None at all"],
      correct: 2,
      hint: "Pick the floor, press play and watch the Sun.",
      explain: "The wall is always taller than the low Sun. The floor has been dark for billions of years, cold enough to keep ice.",
    },
  }),
  ch({
    slug: "timing",
    n: 5,
    title: "Land on the right day",
    short: "Land on the right day",
    copy: "Blue Ghost landed just after sunrise in 2025 and had two weeks of sunshine. On 14 March, Earth hid the Sun: an {eclipse}.",
    prompt: "Pick a landing day. Watch the sunny days.",
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
    check: {
      question: "What happens if you land 2 weeks late?",
      options: ["You still get two weeks of sun", "The Sun sets soon after you land", "The battery charges faster"],
      correct: 1,
      hint: "Pick “2 weeks late” and watch the sunny days.",
      explain: "Sunset comes on the same day whenever you land. Every day late is a day of sunshine lost.",
    },
  }),
];

export const STORY = CHAPTERS.filter((c) => c.slug !== "explore");

export const learnPath = (slug: ChapterSlug): string => (slug === "explore" ? "/learn" : `/learn/${slug}`);

export function chapterBySlug(slug: string | undefined): Chapter | null {
  return CHAPTERS.find((c) => c.slug === slug) ?? null;
}

export const landingT = (offset: number): number => 1 + LANDING_HOUR + offset;

export function setExploreYear(year: number | null): void {
  const c = CHAPTERS.find((x) => x.slug === "explore")!;
  c.epoch = year === null ? EXPLORE_EPOCH : `${year}-01-01T00:00:00Z`;
  c.epochD = dayOfIso(c.epoch);
}
